const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: ROOMS COLLECTION
// Permanent link with Owner UID - 6-Digit Display ID - 16-Seat Grid
// ============================================================================
const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true, index: true }, // Strictly equal to ownerUid for permanent 1:1 link
    ownerUid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    displayRoomId: { type: String, required: true, unique: true, index: true }, // Exact 6-digit room display ID (e.g. "100251")
    roomName: { type: String, required: true, trim: true }, // Room Title / Name
    roomPhotoUrl: { type: String, default: "" }, // Room profile photo URL
    backgroundUrl: { type: String, default: "" }, // Room custom background URL
    category: { type: String, default: "Voice Party" },
    announcement: { type: String, default: "Welcome to my live room!" },
    isLocked: { type: Boolean, default: false },
    pinCode: { type: String, default: "" },
    isLive: { type: Boolean, default: true },
    onlineCount: { type: Number, default: 1 },
    heatScore: { type: Number, default: 0, index: true },
    totalCoinsEarned: { type: Number, default: 0, min: 0 },
    // 16-Seat Grid (4x4) Stage Management
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

roomSchema.index({ ownerUid: 1, roomId: 1, displayRoomId: 1, heatScore: -1 });

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

module.exports = Room;
module.exports.Room = Room;
module.exports.roomSchema = roomSchema;