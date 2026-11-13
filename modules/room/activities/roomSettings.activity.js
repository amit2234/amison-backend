const Room = require('../../../models/Room');
const User = require('../../../models/User');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const { VALID_STAGE_CAPACITIES, DEFAULT_STAGE_CAPACITY, normalizeStageCapacity } = require('../room.constants');
const { channelManager, resolveTrueOwnerUid, generateUnique6DigitId, getBroadcastTargets } = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');
const roomDiscoveryActivity = require('./roomDiscovery.activity');

/**
 * Room Settings & Live Snapshot Activity
 * Handles Room Metadata CRUD, Wallpaper/Title/Notice Real-Time Updates,
 * and Instant REST Snapshot (GET /api/rooms/:id/state).
 */
const roomSettingsActivity = {
    async getOwnerRoom(uid) {
        const cleanUid = String(uid || '').trim();
        if (!cleanUid) return null;
        const resolvedUid = await resolveTrueOwnerUid(cleanUid);

        const room = await Room.findOne({
            $or: [{ ownerUid: resolvedUid }, { roomId: resolvedUid }, { ownerUid: cleanUid }, { roomId: cleanUid }]
        }).lean();
        if (!room) return null;

        if (!room.roomId || room.roomId !== resolvedUid) {
            await Room.updateOne({ _id: room._id }, { $set: { roomId: resolvedUid, ownerUid: resolvedUid } });
            room.roomId = resolvedUid;
            room.ownerUid = resolvedUid;
        }
        return room;
    },

    async createOrUpdateRoom(data) {
        await roomDiscoveryActivity.cleanupDuplicateRooms();
        const {
            ownerUid,
            roomName,
            roomPhotoUrl,
            roomCover,
            backgroundUrl,
            category,
            announcement,
            isLocked,
            pinCode,
            displayRoomId,
            speakerSlots
        } = data || {};

        const rawUid = String(ownerUid || '').trim();
        if (!rawUid) throw new Error('Missing ownerUid');

        const cleanUid = await resolveTrueOwnerUid(rawUid);
        if (!cleanUid) throw new Error('Invalid ownerUid resolved');

        const effectiveTitle = (roomName || 'Voice Party').trim();
        const effectiveCover = roomPhotoUrl || roomCover || '';

        const duplicates = await Room.find({
            $or: [
                { ownerUid: cleanUid },
                { roomId: cleanUid },
                { ownerUid: rawUid },
                { roomId: rawUid }
            ]
        }).sort({ updatedAt: -1 });

        let room = null;
        if (duplicates && duplicates.length > 0) {
            room = duplicates[0];
            for (let i = 1; i < duplicates.length; i++) {
                try {
                    await Room.deleteOne({ _id: duplicates[i]._id });
                } catch (_) {}
            }
        }

        if (room) {
            room.roomId = cleanUid;
            room.ownerUid = cleanUid;
            if (roomName && String(roomName).trim().length > 0) {
                room.roomName = effectiveTitle;
            }
            if (effectiveCover) room.roomPhotoUrl = effectiveCover;
            if (backgroundUrl !== undefined) room.backgroundUrl = backgroundUrl;
            if (category) room.category = category;
            if (announcement !== undefined) room.announcement = announcement;
            if (isLocked !== undefined) room.isLocked = Boolean(isLocked);
            if (pinCode !== undefined) room.pinCode = pinCode;
            if (displayRoomId !== undefined && String(displayRoomId).trim().length > 0) {
                room.displayRoomId = String(displayRoomId).trim();
            }
            const parsedRequestedSlots = Number(speakerSlots);
            if (speakerSlots !== undefined && speakerSlots !== null && VALID_STAGE_CAPACITIES.includes(parsedRequestedSlots)) {
                room.speakerSlots = parsedRequestedSlots;
            }
            room.isLive = true;
            room.onlineCount = Math.max(1, room.onlineCount || 1);
            room.heatScore = Math.max(10, room.heatScore || 10);
            room.updatedAt = new Date();
            await room.save();
        } else {
            const sixDigitId = (displayRoomId && String(displayRoomId).trim().length > 0)
                ? String(displayRoomId).trim()
                : await generateUnique6DigitId();
            room = await Room.create({
                roomId: cleanUid,
                ownerUid: cleanUid,
                displayRoomId: sixDigitId,
                roomName: effectiveTitle,
                roomPhotoUrl: effectiveCover,
                backgroundUrl: backgroundUrl || '',
                category: category || 'Voice Party',
                announcement: announcement || 'Welcome to my room!',
                speakerSlots: normalizeStageCapacity(speakerSlots, DEFAULT_STAGE_CAPACITY),
                isLocked: Boolean(isLocked),
                pinCode: pinCode || '',
                isLive: false,
                onlineCount: 0,
                heatScore: 0
            });
        }

        if (room && room.displayRoomId) {
            channelManager.registerAlias(room.displayRoomId, cleanUid);
            channelManager.registerAlias(room.roomId, cleanUid);
            try {
                await User.updateOne(
                    { uid: cleanUid },
                    { $set: { roomId: String(room.displayRoomId).trim() } }
                );
            } catch (_) {}
        }

        const roomObj = room.toObject();
        roomRoleHelper.cacheRoomRoles(roomObj);
        const authoritativeSlots = normalizeStageCapacity(roomObj.speakerSlots, DEFAULT_STAGE_CAPACITY);
        if (speakerSlots !== undefined && speakerSlots !== null && VALID_STAGE_CAPACITIES.includes(Number(speakerSlots))) {
            roomStateCache.setSpeakerSlots(cleanUid, authoritativeSlots);
            roomStateCache.persistCapacityToRedisAsync(cleanUid, authoritativeSlots);
        }

        // Push live room metadata/wallpaper/notice updates to anyone currently inside the room
        const targets = getBroadcastTargets(cleanUid, roomObj.displayRoomId, null, roomObj);
        channelManager.broadcastToRoomTargets(targets, {
            type: 'room:settings_updated',
            roomId: cleanUid,
            displayRoomId: roomObj.displayRoomId || '',
            roomName: roomObj.roomName || '',
            announcement: roomObj.announcement || '',
            backgroundUrl: roomObj.backgroundUrl || '',
            roomPhotoUrl: roomObj.roomPhotoUrl || '',
            speakerSlots: authoritativeSlots,
            isLocked: Boolean(roomObj.isLocked),
            timestamp: Date.now()
        });

        roomDiscoveryActivity.invalidateCache();
        return roomObj;
    },

    async closeRoom(ownerUid, roomId) {
        const cleanUid = String(ownerUid || '').trim();
        const cleanRoomId = String(roomId || '').trim();
        const resolvedUid = cleanUid ? await resolveTrueOwnerUid(cleanUid) : '';

        await Room.updateMany(
            {
                $or: [
                    { ownerUid: resolvedUid },
                    { ownerUid: cleanUid },
                    { roomId: cleanRoomId },
                    { displayRoomId: cleanRoomId }
                ]
            },
            { $set: { isLive: false, onlineCount: 0, heatScore: 0 } }
        );

        roomDiscoveryActivity.invalidateCache();
        return true;
    },

    async getRoomById(id) {
        const cleanId = String(id || '').trim();
        if (!cleanId) return null;
        const resolved = await resolveTrueOwnerUid(cleanId);

        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanId },
                { ownerUid: resolved },
                { roomId: resolved },
                { ownerUid: cleanId },
                { roomId: cleanId }
            ]
        }).lean();

        if (room) {
            const canonicalId = String(room.ownerUid || room.roomId || cleanId).trim();
            if (room.displayRoomId) channelManager.registerAlias(room.displayRoomId, canonicalId);
            if (room.roomId) channelManager.registerAlias(room.roomId, canonicalId);
            roomRoleHelper.cacheRoomRoles(room);
        }
        return room;
    },

    /**
     * Authoritative Live Room State Snapshot for REST GET /api/rooms/:id/state
     * Returns live RAM/Redis seats + participants + onlineCount + roles immediately,
     * even before the Android client finishes its WebSocket handshake.
     */
    async getRoomStateSnapshot(id) {
        const cleanId = String(id || '').trim();
        if (!cleanId) return null;

        const room = await this.getRoomById(cleanId);
        const canonicalId = room
            ? String(room.ownerUid || room.roomId || room.displayRoomId || cleanId).trim()
            : await channelManager.getCanonicalIdAsync(cleanId) || cleanId;

        await roomStateCache.hydrateFromRedisIfEmpty(canonicalId);
        const roomMeta = roomRoleHelper.cacheRoomRoles(room) || await roomRoleHelper.resolveRoomRolesMeta(canonicalId, room);
        const snapshot = roomStateCache.buildRoomSnapshot(canonicalId, room, roomMeta);

        return {
            ...snapshot,
            room: room || null
        };
    }
};

module.exports = roomSettingsActivity;
