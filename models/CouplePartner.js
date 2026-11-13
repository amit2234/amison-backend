const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: COUPLE PARTNER (CP) BONDS
// 100% Backend-driven, zero Firestore dependency.
// Deterministic bondId: cp_{minUid}_{maxUid} to guarantee single active bond per pair.
// ============================================================================
const couplePartnerSchema = new mongoose.Schema({
    bondId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userAId: {
        type: String,
        required: true,
        index: true
    },
    userBId: {
        type: String,
        required: true,
        index: true
    },
    userA: {
        uid: { type: String, required: true },
        displayId: { type: String, default: '' },
        name: { type: String, required: true },
        avatar: { type: String, default: '' },
        gender: { type: String, default: 'Male' }
    },
    userB: {
        uid: { type: String, required: true },
        displayId: { type: String, default: '' },
        name: { type: String, required: true },
        avatar: { type: String, default: '' },
        gender: { type: String, default: 'Female' }
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'DISBANDED', 'PENDING_TERMINATION'],
        default: 'ACTIVE',
        index: true
    },
    connectedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    totalXp: {
        type: Number,
        default: 0,
        min: 0
    },
    level: {
        type: Number,
        default: 1,
        min: 1,
        max: 10
    },
    affectionScore: {
        type: Number,
        default: 0,
        min: 0
    },
    dailyXp: {
        type: Number,
        default: 0
    },
    weeklyXp: {
        type: Number,
        default: 0
    },
    monthlyXp: {
        type: Number,
        default: 0
    },
    lastGiftTimestamp: {
        type: Date,
        default: null
    }
}, {
    collection: 'couple_partners',
    timestamps: true
});

couplePartnerSchema.index({ userAId: 1, status: 1 });
couplePartnerSchema.index({ userBId: 1, status: 1 });
couplePartnerSchema.index({ totalXp: -1, status: 1 });

const CouplePartner = mongoose.models.CouplePartner || mongoose.model('CouplePartner', couplePartnerSchema);

module.exports = CouplePartner;
