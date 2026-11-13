const Room = require('../models/Room');
const User = require('../models/User');
const { redisClient } = require('./cacheService');

let localMemoryRoomsCache = null;
let lastCacheTimestamp = 0;
const LOCAL_CACHE_TTL_MS = 3000;

async function generateUnique6DigitId() {
    let attempts = 0;
    while (attempts < 30) {
        const id = Math.floor(100000 + Math.random() * 900000).toString();
        const existingRoom = await Room.findOne({ $or: [{ displayRoomId: id }, { roomId: id }] }).lean();
        const existingUser = await User.findOne({ $or: [{ roomId: id }, { numericId: Number(id) }] }).lean();
        if (!existingRoom && !existingUser) return id;
        attempts++;
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function resolveTrueOwnerUid(inputUid) {
    const clean = String(inputUid || '').trim();
    if (!clean) return '';
    if (/^\d+$/.test(clean)) {
        const numericVal = Number(clean);
        const userDoc = await User.findOne({ numericId: numericVal }).lean();
        if (userDoc && userDoc.uid) {
            return String(userDoc.uid).trim();
        }
    }
    const userDoc = await User.findOne({ $or: [{ uid: clean }, { _id: clean.match(/^[0-9a-fA-F]{24}$/) ? clean : null }] }).lean();
    if (userDoc && userDoc.uid) {
        return String(userDoc.uid).trim();
    }
    return clean;
}

async function cleanupDuplicateRooms() {
    try {
        const rooms = await Room.find({}).sort({ updatedAt: -1 }).lean();
        const seenOwners = new Set();
        for (const r of rooms) {
            const owner = r.ownerUid || r.roomId;
            if (!owner) continue;
            const resolved = await resolveTrueOwnerUid(owner);
            if (seenOwners.has(resolved) || seenOwners.has(owner)) {
                await Room.deleteOne({ _id: r._id });
            } else {
                seenOwners.add(resolved);
                seenOwners.add(owner);
            }
        }

        // Zero-Trust: Reset stale empty rooms so 0 user rooms are never marked live with fake heat
        await Room.updateMany(
            { $or: [{ onlineCount: { $lte: 0 } }, { onlineCount: null }] },
            { $set: { isLive: false, onlineCount: 0, heatScore: 0 } }
        );
    } catch (e) {
        console.error('Cleanup duplicate rooms error:', e);
    }
}

const RoomService = {
    async getLiveRooms() {
        await cleanupDuplicateRooms();
        const now = Date.now();
        if (localMemoryRoomsCache && (now - lastCacheTimestamp) < LOCAL_CACHE_TTL_MS) {
            return { source: 'memory_cache', rooms: localMemoryRoomsCache };
        }

        const activeRooms = await Room.find({
            isLive: true,
            onlineCount: { $gte: 1 },
            heatScore: { $gte: 10 },
            isBlocked: { $ne: true }
        })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();

        const formattedRooms = [];
        for (const r of activeRooms) {
            let ownerNumericId = "";
            let ownerLevel = 1;
            const ownerUid = r.ownerUid || r.roomId;
            if (ownerUid) {
                const ownerUser = await User.findOne({ $or: [{ uid: ownerUid }, { roomId: ownerUid }] }).lean();
                if (ownerUser) {
                    if (ownerUser.numericId) ownerNumericId = String(ownerUser.numericId);
                    if (ownerUser.level) ownerLevel = ownerUser.level;
                }
            }

            const liveCount = Number(r.onlineCount || 0);
            const heat = Number(r.heatScore || 0);
            formattedRooms.push({
                id: r.displayRoomId || r.roomId || r._id,
                publicRoomId: r.displayRoomId || r.roomId,
                roomId: r.roomId || r.ownerUid,
                title: r.roomName || 'Voice Room',
                roomName: r.roomName || 'Voice Room',
                category: r.category || 'Voice Party',
                announcement: r.announcement || 'Welcome!',
                ownerId: r.ownerUid || '',
                ownerUid: r.ownerUid || '',
                coOwners: Array.isArray(r.coOwners) ? r.coOwners : [],
                admins: Array.isArray(r.admins) ? r.admins : [],
                ownerNumericId: ownerNumericId || r.displayRoomId || '102030',
                roomLevel: ownerLevel,
                photoUri: r.roomPhotoUrl || '',
                roomPhotoUrl: r.roomPhotoUrl || '',
                backgroundUrl: r.backgroundUrl || '',
                participantCount: liveCount,
                onlineCount: liveCount,
                speakerSlots: 16,
                tags: r.category || '#Chill,#Talk,#Hindi',
                roomHeat: heat,
                isLive: (liveCount > 0 && heat >= 10 && !r.isBlocked)
            });
        }

        localMemoryRoomsCache = formattedRooms;
        lastCacheTimestamp = now;
        return { source: 'mongodb', rooms: formattedRooms };
    },

    async getOwnerRoom(uid) {
        const cleanUid = String(uid || '').trim();
        if (!cleanUid) return null;
        const resolvedUid = await resolveTrueOwnerUid(cleanUid);

        let room = await Room.findOne({ $or: [{ ownerUid: resolvedUid }, { roomId: resolvedUid }, { ownerUid: cleanUid }, { roomId: cleanUid }] }).lean();
        if (!room) return null;

        if (!room.roomId || room.roomId !== resolvedUid) {
            await Room.updateOne({ _id: room._id }, { $set: { roomId: resolvedUid, ownerUid: resolvedUid } });
            room.roomId = resolvedUid;
            room.ownerUid = resolvedUid;
        }
        return room;
    },

    async createOrUpdateRoom(data) {
        await cleanupDuplicateRooms();
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
            displayRoomId
        } = data || {};

        const rawUid = String(ownerUid || '').trim();
        if (!rawUid) {
            throw new Error('Missing ownerUid');
        }

        const cleanUid = await resolveTrueOwnerUid(rawUid);
        if (!cleanUid) {
            throw new Error('Invalid ownerUid resolved');
        }

        const effectiveTitle = (roomName || 'Voice Party').trim();
        const effectiveCover = roomPhotoUrl || roomCover || "";

        // Deduplication: Find all rooms matching this owner
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
            room.isLive = true;
            room.onlineCount = Math.max(1, room.onlineCount || 1);
            room.heatScore = Math.max(10, room.heatScore || 10);
            room.updatedAt = new Date();
            await room.save();
        } else {
            const sixDigitId = (displayRoomId && String(displayRoomId).trim().length > 0) ? String(displayRoomId).trim() : await generateUnique6DigitId();
            room = await Room.create({
                roomId: cleanUid,
                ownerUid: cleanUid,
                displayRoomId: sixDigitId,
                roomName: effectiveTitle,
                roomPhotoUrl: effectiveCover,
                backgroundUrl: backgroundUrl || "",
                category: category || "Voice Party",
                announcement: announcement || "Welcome to my room!",
                isLocked: Boolean(isLocked),
                pinCode: pinCode || "",
                isLive: false,
                onlineCount: 0,
                heatScore: 0
            });
        }

        // Sync displayRoomId directly onto the owner's User document for instant lookup
        if (room && room.displayRoomId) {
            try {
                await User.updateOne(
                    { uid: cleanUid },
                    { $set: { roomId: String(room.displayRoomId).trim() } }
                );
            } catch (_) {}
        }

        localMemoryRoomsCache = null;
        return room.toObject();
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

        localMemoryRoomsCache = null;
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
        return room;
    },

    async searchRooms(query) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) return [];
        const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');

        const matched = await Room.find({
            isBlocked: { $ne: true },
            $or: [
                { displayRoomId: regex },
                { roomId: regex },
                { ownerUid: regex },
                { roomName: regex },
                { category: regex }
            ]
        })
            .sort({ isLive: -1, onlineCount: -1, updatedAt: -1 })
            .limit(30)
            .lean();

        const results = [];
        for (const r of matched) {
            let ownerNumericId = '';
            let ownerLevel = 1;
            const ownerUid = r.ownerUid || r.roomId;
            if (ownerUid) {
                const ownerUser = await User.findOne({ $or: [{ uid: ownerUid }, { roomId: ownerUid }] }).lean();
                if (ownerUser) {
                    if (ownerUser.numericId) ownerNumericId = String(ownerUser.numericId);
                    if (ownerUser.level) ownerLevel = ownerUser.level;
                }
            }
            results.push({
                id: r.displayRoomId || r.roomId || r._id,
                publicRoomId: r.displayRoomId || r.roomId,
                roomId: r.roomId || r.ownerUid,
                title: r.roomName || 'Voice Room',
                roomName: r.roomName || 'Voice Room',
                category: r.category || 'Voice Party',
                announcement: r.announcement || 'Welcome!',
                ownerId: r.ownerUid || '',
                ownerUid: r.ownerUid || '',
                coOwners: Array.isArray(r.coOwners) ? r.coOwners : [],
                admins: Array.isArray(r.admins) ? r.admins : [],
                ownerNumericId: ownerNumericId || r.displayRoomId || '102030',
                roomLevel: ownerLevel,
                photoUri: r.roomPhotoUrl || '',
                roomPhotoUrl: r.roomPhotoUrl || '',
                backgroundUrl: r.backgroundUrl || '',
                participantCount: Number(r.onlineCount || 0),
                onlineCount: Number(r.onlineCount || 0),
                speakerSlots: 16,
                tags: r.category || '#Chill,#Talk,#Hindi',
                roomHeat: Number(r.heatScore || 0),
                isLive: Boolean(r.isLive)
            });
        }
        return results;
    },

    async resolveRoomUid(displayId) {
        const clean = String(displayId || '').trim();
        if (!clean) return null;
        const room = await Room.findOne({
            $or: [
                { displayRoomId: clean },
                { roomId: clean },
                { ownerUid: clean }
            ]
        }).select('ownerUid roomId').lean();
        if (room && (room.ownerUid || room.roomId)) {
            return room.ownerUid || room.roomId;
        }
        if (/^\d+$/.test(clean)) {
            const userDoc = await User.findOne({ numericId: Number(clean) }).select('uid').lean();
            if (userDoc && userDoc.uid) return String(userDoc.uid).trim();
        }
        return null;
    },

    async kickUser(roomId, targetUserId, durationHours = 3, hostName = 'Host', requesterUid = '') {
        const cacheService = require('./cacheService');
        const roomRoleHelper = require('./roomRoleHelper');
        const cleanRoomId = String(roomId || '').trim();
        const cleanTargetId = String(targetUserId || '').trim();
        if (!cleanRoomId || !cleanTargetId) throw new Error('Missing roomId or targetUserId');

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        });
        if (!room) throw new Error('Room not found');

        const roomMeta = roomRoleHelper.cacheRoomRoles(room);
        const targetIds = await roomRoleHelper.resolveUserIdentifiers(cleanTargetId);
        const targetRole = roomRoleHelper.resolveUserRoleFromMetaSync(targetIds, roomMeta);

        if (targetRole === 'owner') {
            const err = new Error('Room Owner cannot be kicked out!');
            err.statusCode = 403;
            throw err;
        }
        if (requesterUid && String(requesterUid).trim()) {
            const actorRole = await roomRoleHelper.resolveUserRoleInRoom(requesterUid, roomMeta);
            if (!roomRoleHelper.canModerate(actorRole, targetRole)) {
                const err = new Error('Insufficient permissions to kick this user.');
                err.statusCode = 403;
                throw err;
            }
        }

        const expiry = Date.now() + (Number(durationHours) || 3) * 3600 * 1000;
        room.kickouts = (room.kickouts || []).filter(k => !targetIds.has(String(k.userId || '').trim()) && k.expiryTimestamp > Date.now());
        targetIds.forEach((tid) => {
            room.kickouts.push({
                userId: tid,
                kickedBy: hostName,
                expiryTimestamp: expiry
            });
        });

        // Clear seat in MongoDB doc
        if (room.seats && Array.isArray(room.seats)) {
            for (const s of room.seats) {
                if (s && s.userId && (targetIds.has(String(s.userId).trim()) || (s.userCustomId && targetIds.has(String(s.userCustomId).trim())))) {
                    s.userId = null;
                    s.name = null;
                    s.userName = null;
                    s.avatar = null;
                    s.userAvatar = null;
                    s.userCustomId = '';
                    s.isSpeaking = false;
                }
            }
        }
        await room.save();

        // Vacate occupant in 0ms RAM seats & participants + broadcast immediately
        const canonicalId = room.ownerUid || room.roomId || room.displayRoomId || cleanRoomId;
        const seats = cacheService.getOrCreateRoomSeats(canonicalId);
        const roomChannelManager = require('../sockets/managers/roomChannelManager');
        const broadcastTargets = new Set([canonicalId, room.roomId, room.displayRoomId, cleanRoomId].filter(Boolean));

        seats.forEach((seat, idx) => {
            if (!seat || !seat.userId) return;
            const sUid = String(seat.userId || '').trim();
            const sCustom = String(seat.userCustomId || '').trim();
            if (targetIds.has(sUid) || (sCustom && targetIds.has(sCustom))) {
                seat.userId = null;
                seat.seatedAt = null;
                seat.userName = null;
                seat.userAvatar = null;
                seat.userCustomId = '';
                seat.isSpeaking = false;
                seat.isMuted = Boolean(seat.isMicTurnedOff);
                const packet = {
                    type: 'seat:update',
                    roomId: canonicalId,
                    seatIndex: idx,
                    userId: '',
                    userName: '',
                    userAvatar: '',
                    userCustomId: '',
                    isLocked: Boolean(seat.isLocked),
                    isMuted: Boolean(seat.isMuted),
                    isMicTurnedOff: Boolean(seat.isMicTurnedOff),
                    isSpeaking: false,
                    kickedUserId: cleanTargetId
                };
                broadcastTargets.forEach(ch => roomChannelManager.broadcastToRoom(ch, packet));
            }
        });

        const roomParticipants = cacheService.getRoomParticipants(canonicalId);
        targetIds.forEach(tid => roomParticipants.delete(tid));
        for (const [pKey, pVal] of roomParticipants.entries()) {
            if (targetIds.has(String(pVal.userId || '').trim()) || (pVal.numericId && targetIds.has(String(pVal.numericId).trim()))) {
                roomParticipants.delete(pKey);
            }
        }

        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalId,
            ownerUid: roomMeta?.ownerUid || '',
            coOwners: roomMeta?.coOwners || [],
            admins: roomMeta?.admins || [],
            heatScore: cacheService.calculateRoomHeat(roomParticipants),
            onlineCount: roomParticipants.size,
            participants: Array.from(roomParticipants.values())
        };
        const kickedPacket = {
            type: 'room:kicked',
            roomId: canonicalId,
            targetUserId: cleanTargetId,
            kickedBy: hostName,
            expiryTimestamp: expiry
        };
        broadcastTargets.forEach((ch) => {
            roomChannelManager.broadcastToRoom(ch, statePacket);
            roomChannelManager.broadcastToRoom(ch, kickedPacket);
        });

        return { success: true, expiryTimestamp: expiry };
    },

    async isUserKicked(roomId, userId) {
        const cleanRoomId = String(roomId || '').trim();
        const cleanUserId = String(userId || '').trim();
        if (!cleanRoomId || !cleanUserId) return false;

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        }).lean();
        if (!room) {
            return { isKicked: false, expiryTimestamp: 0, remainingSeconds: 0, hostName: '' };
        }
        const now = Date.now();
        const activeKick = (room.kickouts || []).find(k => k.userId === cleanUserId && k.expiryTimestamp > now);
        if (!activeKick) {
            return { isKicked: false, expiryTimestamp: 0, remainingSeconds: 0, hostName: '' };
        }
        const remainingSeconds = Math.max(0, Math.round((activeKick.expiryTimestamp - now) / 1000));
        return {
            isKicked: true,
            expiryTimestamp: activeKick.expiryTimestamp,
            remainingSeconds,
            hostName: activeKick.kickedBy || 'Host'
        };
    },

    async unbanUser(roomId, userId) {
        const cleanRoomId = String(roomId || '').trim();
        const cleanUserId = String(userId || '').trim();
        if (!cleanRoomId || !cleanUserId) return { success: false };

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        });
        if (!room) return { success: false };
        room.kickouts = (room.kickouts || []).filter(k => k.userId !== cleanUserId);
        await room.save();
        return { success: true };
    },

    async updateMemberRole(roomId, targetUserId, newRole, requesterUid = '') {
        const cacheService = require('./cacheService');
        const roomRoleHelper = require('./roomRoleHelper');
        const cleanRoomId = String(roomId || '').trim();
        const cleanTargetId = String(targetUserId || '').trim();
        const roleRaw = String(newRole || '').trim().toLowerCase();
        if (!cleanRoomId || !cleanTargetId) throw new Error('Missing parameters');

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        });
        if (!room) throw new Error('Room not found');

        const roomMeta = roomRoleHelper.cacheRoomRoles(room);
        const targetIds = await roomRoleHelper.resolveUserIdentifiers(cleanTargetId);
        const targetCurrentRole = roomRoleHelper.resolveUserRoleFromMetaSync(targetIds, roomMeta);
        const desiredNormalized = roomRoleHelper.normalizeRoleName(roleRaw);

        if (requesterUid && String(requesterUid).trim()) {
            const actorRole = await roomRoleHelper.resolveUserRoleInRoom(requesterUid, roomMeta);
            if (!roomRoleHelper.canAssignRole(actorRole, desiredNormalized, targetCurrentRole)) {
                const err = new Error('Forbidden: You do not have authority to assign this role.');
                err.statusCode = 403;
                throw err;
            }
        } else if (targetCurrentRole === 'owner' || desiredNormalized === 'owner') {
            const err = new Error('Forbidden: Room Owner role cannot be reassigned.');
            err.statusCode = 403;
            throw err;
        }

        const canonicalTargetUid = await resolveTrueOwnerUid(cleanTargetId);

        // Clean all matching identifiers from both coOwners and admins first
        room.coOwners = (room.coOwners || []).filter(u => !targetIds.has(String(u || '').trim()));
        room.admins = (room.admins || []).filter(u => !targetIds.has(String(u || '').trim()));

        if (desiredNormalized === 'co_owner') {
            room.coOwners.push(canonicalTargetUid || cleanTargetId);
        } else if (desiredNormalized === 'admin') {
            room.admins.push(canonicalTargetUid || cleanTargetId);
        }

        await room.save();
        const updatedMeta = roomRoleHelper.cacheRoomRoles(room);
        const canonicalId = room.ownerUid || room.roomId || room.displayRoomId || cleanRoomId;
        const displayRole = roomRoleHelper.toDisplayRole(desiredNormalized, false);

        const roomParticipants = cacheService.getRoomParticipants(canonicalId);
        for (const [pKey, pVal] of roomParticipants.entries()) {
            const pMatch = targetIds.has(String(pVal.userId || '').trim()) ||
                (pVal.numericId && targetIds.has(String(pVal.numericId).trim()));
            if (pMatch) {
                pVal.role = roomRoleHelper.toDisplayRole(desiredNormalized, Boolean(pVal.onSeat));
                roomParticipants.set(pKey, pVal);
            }
        }

        try {
            const roomChannelManager = require('../sockets/managers/roomChannelManager');
            const broadcastTargets = new Set([canonicalId, room.roomId, room.displayRoomId, cleanRoomId].filter(Boolean));
            const rolePacket = {
                type: 'room:role_update',
                roomId: canonicalId,
                targetUserId: canonicalTargetUid || cleanTargetId,
                newRole: displayRole,
                ownerUid: updatedMeta?.ownerUid || '',
                coOwners: updatedMeta?.coOwners || [],
                admins: updatedMeta?.admins || []
            };
            const statePacket = {
                type: 'room:state_update',
                roomId: canonicalId,
                ownerUid: updatedMeta?.ownerUid || '',
                coOwners: updatedMeta?.coOwners || [],
                admins: updatedMeta?.admins || [],
                heatScore: cacheService.calculateRoomHeat(roomParticipants),
                onlineCount: roomParticipants.size,
                participants: Array.from(roomParticipants.values())
            };
            broadcastTargets.forEach((ch) => {
                roomChannelManager.broadcastToRoom(ch, rolePacket);
                roomChannelManager.broadcastToRoom(ch, statePacket);
            });
        } catch (_) {}

        localMemoryRoomsCache = null;
        return { success: true, role: displayRole, coOwners: room.coOwners, admins: room.admins };
    }
};

module.exports = RoomService;
