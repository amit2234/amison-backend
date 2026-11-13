const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: REELS COLLECTION
// Connected directly to existing User collection via uid (Firebase Permanent Auth UID)
// ============================================================================
const reelSchema = new mongoose.Schema({
    reelId: { type: String, required: true, unique: true, index: true }, // e.g. "post_1730880000"
    
    // 🔑 Permanent connection to existing Users collection via Firebase Auth UID
    userUid: { type: String, required: true, index: true }, // e.g. "0CGOW3uw5hNr4nC0zXQmASPqRUn2"
    numericId: { type: Number, required: true },            // e.g. 102030
    userName: { type: String, required: true },             // e.g. "Amit"
    userAvatar: { type: String, default: "" },              // Profile Photo URL
    userLevel: { type: Number, default: 1 },                // Level
    gender: { type: String, default: "Male" },              // Gender
    
    // Cloudinary HLS Media Fields
    cloudinaryPublicId: { type: String, default: "" },
    videoHlsUrl: { type: String, required: true },          // .m3u8 adaptive stream URL
    coverUrl: { type: String, required: true },              // Poster frame .jpg
    mediaType: { type: String, enum: ['VIDEO', 'PHOTO'], default: 'VIDEO' },
    durationSeconds: { type: Number, default: 30 },          // 0-30s crop
    
    // Description & Hashtags
    caption: { type: String, default: "" },
    hashtags: { type: String, default: "" },
    fullDescription: { type: String, default: "" },          // @amit Night vibes #amison
    musicTitle: { type: String, default: "Original Sound" },
    musicCoverUrl: { type: String, default: "" },
    
    // Real-time Engagement Counters
    likesCount: { type: Number, default: 0, index: -1 },
    commentsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },
    
    isPublished: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now, index: -1 }
});

reelSchema.index({ isPublished: 1, createdAt: -1 });
reelSchema.index({ userUid: 1, createdAt: -1 });

const Reel = mongoose.models.Reel || mongoose.model('Reel', reelSchema);

module.exports = Reel;
