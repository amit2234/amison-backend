const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: REEL COMMENTS COLLECTION
// Connected directly to existing User collection via uid (Firebase Permanent Auth UID)
// ============================================================================
const reelCommentSchema = new mongoose.Schema({
    commentId: { type: String, required: true, unique: true, index: true },
    reelId: { type: String, required: true, index: true },
    userUid: { type: String, required: true, index: true },
    numericId: { type: Number, default: 0 },
    userName: { type: String, default: "User" },
    userAvatar: { type: String, default: "" },
    commentText: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: -1 }
});

reelCommentSchema.index({ reelId: 1, createdAt: -1 });

const ReelComment = mongoose.models.ReelComment || mongoose.model('ReelComment', reelCommentSchema);

module.exports = ReelComment;
