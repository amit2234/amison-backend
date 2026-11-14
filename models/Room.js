const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: ROOMS COLLECTION (100% MongoDB Atlas + Redis In-Memory)
// Permanent link with Owner UID - 5-Digit Display ID (10000+) - 16-Seat Grid
// ============================================================================
const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true, index: true }, // Strictly equal to ownerUid for permanent 1:1 link
    ownerUid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    ownerName: { type: String, default: "Host" },
    displayRoomId: { type: String, required: true, unique: true, index: true }, // Sequential 5-digit room display ID starting 10000 (e.g. "10131")
    roomName: { type: String, required: true, trim: true, default: "Voice Party" }, // Room Title / Name
    roomPhotoUrl: { type: String, default: "" }, // Room profile photo URL
    roomCover: { type: String, default: "" }, // Alias for room photo URL
    backgroundUrl: { type: String, default: "" }, // Room custom background URL
    category: { type: String, default: "Voice Party" },
    announcement: { type: String, default: "Welcome to my live room!" },
    isLocked: { type: Boolean, default: false },
    pinCode: { type: String, default: "" },
    isLive: { type: Boolean, default: false, index: true },
    onlineCount: { type: Number, default: 0 },
    heatScore: { type: Number, default: 0, index: true },
    totalCoinsEarned: { type: Number, default: 0, min: 0 },
    isBlocked: { type: Boolean, default: false, index: true },
    level: { type: Number, default: 1 },
    speakerSlots: { type: Number, enum: [4, 8, 12, 16], default: 8 },
    lockedSeats: { type: [Number], default: [] },
    coOwners: { type: [String], default: [] },
    admins: { type: [String], default: [] },
    kickouts: {
        type: [{
            userId: { type: String, required: true },
            kickedBy: { type: String, default: "" },
            expiryTimestamp: { type: Number, required: true }
        }],
        default: []
    },
    // 16-Seat Grid (4x4) Stage Management (Compatible with both index/seatIndex and name/userName)
    seats: {
        type: [{
            index: { type: Number, default: 0 },
            seatIndex: { type: Number, default: 0 },
            userId: { type: String, default: null },
            name: { type: String, default: null },
            userName: { type: String, default: null },
            avatar: { type: String, default: null },
            userAvatar: { type: String, default: null },
            userCustomId: { type: String, default: "" },
            level: { type: Number, default: 1 },
            gender: { type: String, default: "Male" },
            isLocked: { type: Boolean, default: false },
            isMuted: { type: Boolean, default: false },
            isMicTurnedOff: { type: Boolean, default: false },
            isSpeaking: { type: Boolean, default: false },
            avatarFrame: { type: String, default: null },
            avatarFrameUrl: { type: String, default: null },
            seatLabel: { type: String, default: "" }
        }],
        default: () => Array.from({ length: 16 }, (_, i) => ({
            index: i,
            seatIndex: i,
            userId: null,
            name: null,
            userName: null,
            avatar: null,
            userAvatar: null,
            userCustomId: "",
            level: 1,
            gender: "Male",
            isLocked: false,
            isMuted: false,
            isMicTurnedOff: false,
            isSpeaking: false,
            avatarFrame: null,
            avatarFrameUrl: null,
            seatLabel: (i + 1).toString()
        }))
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'rooms', timestamps: true });

roomSchema.index({ ownerUid: 1, roomId: 1, displayRoomId: 1, heatScore: -1 });

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

module.exports = Room;
module.exports.Room = Room;
module.exports.roomSchema = roomSchema;