const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const { redisClient } = require('../services/cacheService');

// In-Memory Micro-Cache for Double-Caching (Zero network overhead)
let localMemoryRoomsCache = null;
let lastCacheTimestamp = 0;
const LOCAL_CACHE_TTL_MS = 3000; // 3 seconds window

// Helper to generate unique 6-digit display ID (e.g. 100251)
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

/**
 * 1. GET /api/rooms/live
 * Fetches all live voice rooms with Double-Caching (Memory -> Upstash Redis -> MongoDB Atlas)
 */
router.get('/live', async (req, res) => {
    try {
        const now = Date.now();

        // Level 1: In-Process Node.js Memory Cache (0ms response)
        if (localMemoryRoomsCache && (now - lastCacheTimestamp) < LOCAL_CACHE_TTL_MS) {
            return res.json({
                success: true,
                source: 'memory_cache',
                rooms: localMemoryRoomsCache
            });
        }

        // Level 2: Upstash Redis Cache (1-2ms response)
        if (redisClient && redisClient.status === 'ready') {
            try {
                const cached = await redisClient.get('rooms:active:list');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    localMemoryRoomsCache = parsed;
                    lastCacheTimestamp = now;
                    return res.json({
                        success: true,
                        source: 'redis_cache',
                        rooms: parsed
                    });
                }
            } catch (redisErr) {
                console.warn('Redis cache get error:', redisErr.message);
            }
        }

        // Level 3: MongoDB Atlas Fallback Query
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

        // Update Level 1 & Level 2 Caches
        localMemoryRoomsCache = formattedRooms;
        lastCacheTimestamp = now;

        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.set('rooms:active:list', JSON.stringify(formattedRooms), 'EX', 10);
            } catch (redisSetErr) {
                console.warn('Redis cache set failed:', redisSetErr.message);
            }
        }

        return res.json({
            success: true,
            source: 'mongodb',
            rooms: formattedRooms
        });
    } catch (e) {
        console.error('[Rooms Route] Fetch live rooms error:', e);
        return res.status(500).json({ success: false, error: e.message, rooms: [] });
    }
});

/**
 * 2. GET /api/rooms/owner/:uid - Fetch or auto-ensure User's permanent room
 */
router.get('/owner/:uid', async (req, res) => {
    try {
        const uid = String(req.params.uid || '').trim();
        if (!uid) {
            return res.status(400).json({ success: false, error: 'Missing owner UID' });
        }

        let room = await Room.findOne({ $or: [{ ownerUid: uid }, { roomId: uid }] }).lean();
        if (!room) {
            return res.json({ success: true, exists: false, room: null });
        }
        if (!room.roomId) {
            await Room.updateOne({ _id: room._id }, { $set: { roomId: uid } });
            room.roomId = uid;
        }

        return res.json({ success: true, exists: true, room });
    } catch (e) {
        console.error('[Rooms Route] Fetch owner room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 3. POST /api/rooms/create & /create-or-update
 * Host creates or updates their room. Invalidates Redis cache immediately.
 */
async function handleCreateRoom(req, res) {
    try {
        const {
            ownerUid,
            roomName,
            roomPhotoUrl,
            roomCover,
            backgroundUrl,
            category,
            announcement,
            tags,
            isLocked,
            pinCode
        } = req.body || {};

        const cleanUid = String(ownerUid || '').trim();
        if (!cleanUid) {
            return res.status(400).json({ success: false, error: 'Missing ownerUid' });
        }

        const effectiveTitle = (roomName || 'Voice Party').trim();
        const effectiveCover = roomPhotoUrl || roomCover || "";

        // Find all rooms for this user and deduplicate if multiple exist
        const duplicates = await Room.find({ $or: [{ ownerUid: cleanUid }, { roomId: cleanUid }] }).sort({ updatedAt: -1 });
        let room = null;

        if (duplicates && duplicates.length > 0) {
            room = duplicates[0];
            // Remove any duplicate extra room documents for the same user
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

        // Invalidate Redis Cache & Local Memory Cache immediately
        localMemoryRoomsCache = null;
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del('rooms:active:list');
            } catch (_) {}
        }

        return res.json({ success: true, room: room.toObject() });
    } catch (e) {
        console.error('[Rooms Route] Create room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/create', handleCreateRoom);
router.post('/create-or-update', handleCreateRoom);

/**
 * 4. POST /api/rooms/close - Host leaves or closes room
 */
router.post('/close', async (req, res) => {
    try {
        const { ownerUid, roomId } = req.body || {};
        const cleanUid = String(ownerUid || '').trim();
        const cleanRoomId = String(roomId || '').trim();

        await Room.updateOne(
            { $or: [{ ownerUid: cleanUid }, { roomId: cleanRoomId }, { displayRoomId: cleanRoomId }] },
            { $set: { isLive: false, onlineCount: 0 } }
        );

        // Invalidate Redis Cache & Local Memory Cache immediately
        localMemoryRoomsCache = null;
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del('rooms:active:list');
            } catch (_) {}
        }

        return res.json({ success: true, message: 'Room closed successfully' });
    } catch (e) {
        console.error('[Rooms Route] Close room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 5. GET /api/rooms/explore - Legacy route alias
 */
router.get('/explore', async (req, res) => {
    try {
        const rooms = await Room.find({ isLive: true })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();
        return res.json({ success: true, rooms: rooms || [] });
    } catch (e) {
        return res.status(500).json({ rooms: [], success: false, error: e.message });
    }
});

/**
 * 6. GET /api/rooms/:id - Fetch room by displayRoomId, ownerUid, or roomId
 */
router.get('/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) {
            return res.status(400).json({ success: false, error: 'Missing room ID' });
        }
        const room = await Room.findOne({ $or: [{ displayRoomId: id }, { ownerUid: id }, { roomId: id }] }).lean();
        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }
        return res.json({ success: true, room });
    } catch (e) {
        console.error('[Rooms Route] Fetch room details error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;