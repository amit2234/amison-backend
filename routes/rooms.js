const express = require('express');
const router = express.Router();
const Room = require('../models/Room');

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

// 1. GET /api/rooms/owner/:uid - Fetch or auto-ensure User's permanent room
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

// 2. POST /api/rooms/create - Create or update room tied to ownerUid with 6-digit displayId
async function handleCreateRoom(req, res) {
    try {
        const {
            ownerUid,
            roomName,
            roomPhotoUrl,
            backgroundUrl,
            category,
            announcement,
            isLocked,
            pinCode
        } = req.body || {};

        const cleanUid = String(ownerUid || '').trim();
        if (!cleanUid) {
            return res.status(400).json({ success: false, error: 'Missing ownerUid' });
        }
        if (!roomName || !roomName.trim()) {
            return res.status(400).json({ success: false, error: 'Room name is required' });
        }

        let room = await Room.findOne({ $or: [{ ownerUid: cleanUid }, { roomId: cleanUid }] });

        if (room) {
            room.roomId = cleanUid;
            room.ownerUid = cleanUid;
            room.roomName = roomName.trim();
            if (roomPhotoUrl !== undefined) room.roomPhotoUrl = roomPhotoUrl;
            if (backgroundUrl !== undefined) room.backgroundUrl = backgroundUrl;
            if (category) room.category = category;
            if (announcement !== undefined) room.announcement = announcement;
            if (isLocked !== undefined) room.isLocked = Boolean(isLocked);
            if (pinCode !== undefined) room.pinCode = pinCode;
            room.updatedAt = new Date();
            await room.save();
        } else {
            const sixDigitId = await generateUnique6DigitId();
            room = await Room.create({
                roomId: cleanUid,
                ownerUid: cleanUid,
                displayRoomId: sixDigitId,
                roomName: roomName.trim(),
                roomPhotoUrl: roomPhotoUrl || "",
                backgroundUrl: backgroundUrl || "",
                category: category || "Voice Party",
                announcement: announcement || "Welcome to my room!",
                isLocked: Boolean(isLocked),
                pinCode: pinCode || "",
                isLive: true,
                heatScore: 10
            });
        }

        return res.json({ success: true, room: room.toObject() });
    } catch (e) {
        console.error('[Rooms Route] Create room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/create', handleCreateRoom);
router.post('/create-or-update', handleCreateRoom);

// 3. GET /api/rooms/explore - List active live rooms for Explore tab
router.get('/explore', async (req, res) => {
    try {
        const rooms = await Room.find({ isLive: true, heatScore: { $gte: 10 } })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();
        return res.json({ success: true, rooms: rooms || [] });
    } catch (e) {
        console.error('[Rooms Route] Explore rooms error:', e);
        return res.status(500).json({ rooms: [], success: false, error: e.message });
    }
});

// 4. GET /api/rooms/:id - Fetch room by 6-digit displayRoomId, ownerUid, or roomId
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