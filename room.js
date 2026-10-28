const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ============================================================================
// MONGOOSE SCHEMA: ROOMS COLLECTION (Permanent link with User UID - Zero Loss)
// ============================================================================
const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true, index: true },
    ownerUid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    ownerNumericId: { type: Number, required: true, index: true }, // 9-digit public ID
    ownerName: { type: String, default: "Host" },
    ownerAvatar: { type: String, default: "" },
    roomName: { type: String, default: "My Live Room", trim: true },
    roomNotice: { type: String, default: "Welcome to my live room! Enjoy streaming & chatting." },
    roomCover: { type: String, default: "" },
    roomType: { type: String, enum: ['PUBLIC', 'PRIVATE', 'LOCKED'], default: 'PUBLIC' },
    roomPassword: { type: String, default: "" },
    seatCount: { type: Number, default: 8 },
    isLive: { type: Boolean, default: true },
    zegoRoomId: { type: String, default: "" },
    onlineCount: { type: Number, default: 1 },
    totalCoinsEarned: { type: Number, default: 0, min: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'rooms' });

roomSchema.index({ ownerUid: 1, roomId: 1 });

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

// ============================================================================
// API ENDPOINTS (/api/rooms/*)
// ============================================================================

// 1. GET /api/rooms/owner/:uid: Fetch or auto-ensure User's permanent room (0 data loss)
router.get('/owner/:uid', async (req, res) => {
    try {
        const uid = String(req.params.uid || '').trim();
        if (!uid) {
            return res.status(400).json({ success: false, error: 'Missing owner UID' });
        }

        let room = await Room.findOne({ ownerUid: uid }).lean();
        if (!room) {
            // Auto-create default room tied to this UID if not exists
            const numericId = Math.floor(100000000 + Math.random() * 900000000);
            const newRoomId = `room_${uid}_${Date.now().toString().slice(-6)}`;
            room = await Room.create({
                roomId: newRoomId,
                ownerUid: uid,
                ownerNumericId: numericId,
                ownerName: "Host",
                roomName: "My Live Voice Room",
                zegoRoomId: newRoomId
            });
            room = room.toObject();
        }

        return res.json({ success: true, room });
    } catch (e) {
        console.error('[Room Engine] Fetch owner room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// 2. POST /api/rooms/create-or-update: Create or update room tied to ownerUid
router.post('/create-or-update', async (req, res) => {
    try {
        const {
            ownerUid,
            ownerNumericId,
            ownerName,
            ownerAvatar,
            roomName,
            roomNotice,
            roomCover,
            roomType,
            roomPassword,
            seatCount,
            isLive
        } = req.body || {};

        const cleanUid = String(ownerUid || '').trim();
        if (!cleanUid) {
            return res.status(400).json({ success: false, error: 'Missing ownerUid' });
        }

        const numId = Number(ownerNumericId) || Math.floor(100000000 + Math.random() * 900000000);
        const defaultRoomId = `room_${cleanUid}_${Date.now().toString().slice(-6)}`;

        const updateData = {
            ownerNumericId: numId,
            updatedAt: new Date()
        };
        if (ownerName) updateData.ownerName = ownerName.trim();
        if (ownerAvatar !== undefined) updateData.ownerAvatar = ownerAvatar;
        if (roomName) updateData.roomName = roomName.trim();
        if (roomNotice !== undefined) updateData.roomNotice = roomNotice;
        if (roomCover !== undefined) updateData.roomCover = roomCover;
        if (roomType) updateData.roomType = roomType;
        if (roomPassword !== undefined) updateData.roomPassword = roomPassword;
        if (seatCount) updateData.seatCount = Number(seatCount) || 8;
        if (isLive !== undefined) updateData.isLive = Boolean(isLive);

        let room = await Room.findOneAndUpdate(
            { ownerUid: cleanUid },
            {
                $setOnInsert: {
                    roomId: defaultRoomId,
                    ownerUid: cleanUid,
                    zegoRoomId: defaultRoomId,
                    createdAt: new Date()
                },
                $set: updateData
            },
            { upsert: true, new: true, lean: true }
        );

        return res.json({ success: true, room });
    } catch (e) {
        console.error('[Room Engine] Create or update room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// 3. GET /api/rooms/explore: List active live rooms for Explore tab
router.get('/explore', async (req, res) => {
    try {
        const rooms = await Room.find({ isLive: true })
            .sort({ onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();
        return res.json({ success: true, rooms: rooms || [] });
    } catch (e) {
        console.error('[Room Engine] Explore rooms error:', e);
        return res.status(500).json({ success: false, rooms: [], error: e.message });
    }
});

// 4. GET /api/rooms/:roomId: Fetch specific room details by roomId
router.get('/:roomId', async (req, res) => {
    try {
        const roomId = String(req.params.roomId || '').trim();
        if (!roomId) {
            return res.status(400).json({ success: false, error: 'Missing roomId' });
        }
        const room = await Room.findOne({ $or: [{ roomId }, { ownerUid: roomId }] }).lean();
        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }
        return res.json({ success: true, room });
    } catch (e) {
        console.error('[Room Engine] Fetch room by ID error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
