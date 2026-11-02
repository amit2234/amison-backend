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
    // If inputUid is numeric, resolve to actual user's Firebase Auth UID if possible
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

const RoomService = {
    async getLiveRooms() {
        const now = Date.now();
        if (localMemoryRoomsCache && (now - lastCacheTimestamp) < LOCAL_CACHE_TTL_MS) {
            return { source: 'memory_cache', rooms: localMemoryRoomsCache };
        }

        if (redisClient && redisClient.status === 'ready') {
            try {
                const cached = await redisClient.get('rooms:active:list');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    localMemoryRoomsCache = parsed;
                    lastCacheTimestamp = now;
                    return { source: 'redis_cache', rooms: parsed };
                }
            } catch (err) {
                console.warn('Redis cache get error:', err.message);
            }
        }

        const activeRooms = await Room.find({ isLive: true })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();

        const formattedRooms = activeRooms.map(r => ({
            id: r.displayRoomId || r.roomId || r._id,
            publicRoomId: r.displayRoomId || r.roomId,
            roomId: r.roomId || r.ownerUid,
            title: r.roomName || 'Voice Room',
            roomName: r.roomName || 'Voice Room',
            category: r.category || 'Voice Party',
            announcement: r.announcement || 'Welcome!',
            ownerId: r.ownerUid || '',
            ownerUid: r.ownerUid || '',
            photoUri: r.roomPhotoUrl || '',
            roomPhotoUrl: r.roomPhotoUrl || '',
            backgroundUrl: r.backgroundUrl || '',
            participantCount: r.onlineCount || 1,
            speakerSlots: 16,
            tags: r.category || '#Chill,#Talk,#Hindi',
            roomHeat: r.heatScore || 10,
            isLive: true
        }));

        localMemoryRoomsCache = formattedRooms;
        lastCacheTimestamp = now;

        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.set('rooms:active:list', JSON.stringify(formattedRooms), 'EX', 10);
            } catch (err) {
                console.warn('Redis cache set failed:', err.message);
            }
        }

        return { source: 'mongodb', rooms: formattedRooms };
    },

    async getAllRoomsAdmin() {
        const rooms = await Room.find({}).sort({ updatedAt: -1 }).limit(200).lean();
        return rooms;
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
        const {
            ownerUid,
            roomName,
            roomPhotoUrl,
            roomCover,
            backgroundUrl,
            category,
            announcement,
            isLocked,
            pinCode
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

        // Deduplication: Find all rooms matching this ownerUid or roomId
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
            // Remove any extra duplicates to ensure strictly 1 room per user
            for (let i = 1; i < duplicates.length; i++) {
                try {
                    await Room.deleteOne({ _id: duplicates[i]._id });
                } catch (_) {}
            }
        }

        if (room) {
            room.roomId = cleanUid;
            room.ownerUid = cleanUid;
            room.roomName = effectiveTitle;
            if (effectiveCover) room.roomPhotoUrl = effectiveCover;
            if (backgroundUrl !== undefined) room.backgroundUrl = backgroundUrl;
            if (category) room.category = category;
            if (announcement !== undefined) room.announcement = announcement;
            if (isLocked !== undefined) room.isLocked = Boolean(isLocked);
            if (pinCode !== undefined) room.pinCode = pinCode;
            room.isLive = true;
            room.updatedAt = new Date();
            await room.save();
        } else {
            // Clean any stray numeric ownerUid documents
            const numericStray = await Room.findOne({ ownerUid: rawUid }).lean();
            if (numericStray) {
                try {
                    await Room.deleteOne({ _id: numericStray._id });
                } catch (_) {}
            }

            const sixDigitId = await generateUnique6DigitId();
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
                heatScore: 10
            });
        }

        localMemoryRoomsCache = null;
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del('rooms:active:list');
            } catch (_) {}
        }

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
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del('rooms:active:list');
            } catch (_) {}
        }
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
    }
};

module.exports = RoomService;