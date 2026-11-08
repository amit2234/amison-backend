const Room = require('../models/Room');
const User = require('../models/User');
const { redisClient } = require('./cacheService');

let localMemoryRoomsCache = null;
let lastCacheTimestamp = 0;
const LOCAL_CACHE_TTL_MS = 3000;

async function generateUnique6DigitId() {
    let attempts = 0;
    while (attempts < 20) {
        const id = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = await Room.findOne({ displayRoomId: id });
        if (!existing) return id;
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

        const activeRooms = await Room.find({ isLive: true })
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

            const liveCount = Math.max(1, r.onlineCount || 1);
            const heat = r.heatScore > 0 ? r.heatScore : Math.max(10, liveCount * 10);
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
                isLive: !r.isBlocked
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
                isLive: true,
                onlineCount: 1,
                heatScore: 10
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
            { $set: { isLive: false, onlineCount: 0 } }
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

    async kickUser(roomId, targetUserId, durationHours = 3, hostName = 'Host') {
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

        const expiry = Date.now() + (Number(durationHours) || 3) * 3600 * 1000;
        room.kickouts = (room.kickouts || []).filter(k => k.userId !== cleanTargetId && k.expiryTimestamp > Date.now());
        room.kickouts.push({
            userId: cleanTargetId,
            kickedBy: hostName,
            expiryTimestamp: expiry
        });

        // If target user is on a seat, clear that seat
        if (room.seats && Array.isArray(room.seats)) {
            for (const s of room.seats) {
                if (s.userId === cleanTargetId) {
                    s.userId = null;
                    s.name = null;
                    s.avatar = null;
                }
            }
        }
        await room.save();

        try {
            const roomChannelManager = require('../sockets/managers/roomChannelManager');
            roomChannelManager.broadcastToRoom(room.roomId || room.displayRoomId, {
                type: 'room:kicked',
                targetUserId: cleanTargetId,
                kickedBy: hostName,
                expiryTimestamp: expiry
            });
        } catch (_) {}

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
        const cleanRoomId = String(roomId || '').trim();
        const cleanTargetId = String(targetUserId || '').trim();
        const role = String(newRole || '').trim().toLowerCase();
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

        // Clean from both coOwners and admins first
        room.coOwners = (room.coOwners || []).filter(u => u !== cleanTargetId);
        room.admins = (room.admins || []).filter(u => u !== cleanTargetId);

        if (role === 'co-owner' || role === 'co_owner' || role === 'coowner') {
            room.coOwners.push(cleanTargetId);
        } else if (role === 'admin' || role === 'moderator') {
            room.admins.push(cleanTargetId);
        }

        await room.save();

        try {
            const roomChannelManager = require('../sockets/managers/roomChannelManager');
            roomChannelManager.broadcastToRoom(room.roomId || room.displayRoomId, {
                type: 'room:role_update',
                targetUserId: cleanTargetId,
                newRole: role
            });
        } catch (_) {}

        return { success: true, role };
    }
};

module.exports = RoomService;