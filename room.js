const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ============================================================================
// MONGOOSE SCHEMA: ROOMS COLLECTION (Permanent link with User UID - 6-Digit ID)
// ============================================================================
const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true, index: true }, // Strictly equal to ownerUid for permanent 1:1 link
    ownerUid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID / User A UID
    displayRoomId: { type: String, required: true, unique: true, index: true }, // Exact 6-digit room display ID (e.g., "100251")
    roomName: { type: String, required: true, trim: true }, // User entered room name
    roomPhotoUrl: { type: String, default: "" }, // Cloudinary room profile photo URL
    category: { type: String, default: "Voice Party" },
    announcement: { type: String, default: "Welcome to my live room!" },
    isLocked: { type: Boolean, default: false },
    pinCode: { type: String, default: "" },
    isLive: { type: Boolean, default: true },
    onlineCount: { type: Number, default: 1 },
    heatScore: { type: Number, default: 0, index: true },
    totalCoinsEarned: { type: Number, default: 0, min: 0 },
    // 🔥 16-Seat Grid (4x4) Stage Management
    seats: {
        type: [{
            index: { type: Number, required: true },
            userId: { type: String, default: null },
            name: { type: String, default: null },
            avatar: { type: String, default: null },
            isLocked: { type: Boolean, default: false },
            isMuted: { type: Boolean, default: false },
            seatLabel: { type: String, default: "" }
        }],
        default: () => Array.from({ length: 16 }, (_, i) => ({
            index: i,
            userId: null,
            name: null,
            avatar: null,
            isLocked: false,
            isMuted: false,
            seatLabel: (i + 1).toString()
        }))
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'rooms' });

roomSchema.index({ ownerUid: 1, roomId: 1, displayRoomId: 1, heatScore: 1 });

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

// ============================================================================
// API ENDPOINTS (/api/rooms/*)
// ============================================================================

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

// 1. GET /api/rooms/owner/:uid: Fetch or auto-ensure User's permanent room
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
        console.error('[Room Engine] Fetch owner room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// 2. POST /api/rooms/create: Create or update room tied to ownerUid with 6-digit displayId & custom name/photo
router.post('/create', async (req, res) => {
    try {
        const {
            ownerUid,
            roomName,
            roomPhotoUrl,
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

        // Check if room already exists for this ownerUid
        let room = await Room.findOne({ $or: [{ ownerUid: cleanUid }, { roomId: cleanUid }] });

        if (room) {
            // Update existing room while keeping the same 6-digit displayRoomId and ownerUid permanent link
            room.roomId = cleanUid;
            room.ownerUid = cleanUid;
            room.roomName = roomName.trim();
            if (roomPhotoUrl !== undefined) room.roomPhotoUrl = roomPhotoUrl;
            if (category) room.category = category;
            if (announcement !== undefined) room.announcement = announcement;
            if (isLocked !== undefined) room.isLocked = Boolean(isLocked);
            if (pinCode !== undefined) room.pinCode = pinCode;
            room.updatedAt = new Date();
            await room.save();
        } else {
            // Create new room with roomId = ownerUid and 6-digit displayRoomId permanently linked to ownerUid
            const sixDigitId = await generateUnique6DigitId();
            room = await Room.create({
                roomId: cleanUid,
                ownerUid: cleanUid,
                displayRoomId: sixDigitId,
                roomName: roomName.trim(),
                roomPhotoUrl: roomPhotoUrl || "",
                category: category || "Voice Party",
                announcement: announcement || "Welcome to my room!",
                isLocked: Boolean(isLocked),
                pinCode: pinCode || "",
                isLive: true,
                heatScore: 10 // Initial owner entry heat
            });
        }

        return res.json({ success: true, room: room.toObject() });
    } catch (e) {
        console.error('[Room Engine] Create room error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Alias for backwards compatibility with create-or-update
router.post('/create-or-update', async (req, res) => {
    req.url = '/create';
    return router.handle(req, res);
});

// 3. GET /api/rooms/explore: List active live rooms for Explore tab (heatScore >= 10)
router.get('/explore', async (req, res) => {
    try {
        const rooms = await Room.find({ isLive: true, heatScore: { $gte: 10 } })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();
        return res.json({ success: true, rooms: rooms || [] });
    } catch (e) {
        console.error('[Room Engine] Explore rooms error:', e);
        return res.status(500).json({ rooms: [], success: false, error: e.message });
    }
});

// 4. GET /api/rooms/:id: Fetch room by displayRoomId or ownerUid
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
        console.error('[Room Engine] Fetch room details error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
