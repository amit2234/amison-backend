const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: REEL_LIKES COLLECTION
// Stores user likes linked with userUid to prevent any data loss
// ============================================================================
const reelLikeSchema = new mongoose.Schema({
    reelId: { type: String, required: true, index: true },
    userUid: { type: String, required: true, index: true }, // Permanent Firebase Auth UID
    createdAt: { type: Date, default: Date.now }
});

reelLikeSchema.index({ reelId: 1, userUid: 1 }, { unique: true });

const ReelLike = mongoose.models.ReelLike || mongoose.model('ReelLike', reelLikeSchema);

module.exports = ReelLike;
