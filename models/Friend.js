const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: FRIEND / FOLLOW COLLECTION (Follow/Unfollow relationship)
// ============================================================================
const followSchema = new mongoose.Schema({
    followerUid: { type: String, required: true, index: true }, // User who follows
    followingUid: { type: String, required: true, index: true }, // User being followed
    createdAt: { type: Date, default: Date.now }
}, { collection: 'follows' });

// Composite unique index to prevent duplicate follows and ensure lightning-fast lookups
followSchema.index({ followerUid: 1, followingUid: 1 }, { unique: true });

const Follow = mongoose.models.Follow || mongoose.model('Follow', followSchema);

module.exports = Follow;
module.exports.Follow = Follow;
module.exports.Friend = Follow;
module.exports.followSchema = followSchema;