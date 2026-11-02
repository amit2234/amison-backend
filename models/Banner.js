const mongoose = require('mongoose');

/**
 * Banner Model (MongoDB Atlas)
 * Zero Firestore - 100% dynamic banner management for Home and Login screens.
 */
const bannerSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    subtitle: {
        type: String,
        default: '',
        trim: true
    },
    imageUrl: {
        type: String,
        required: true,
        trim: true
    },
    cloudinaryPublicId: {
        type: String,
        default: ''
    },
    // Target screen placement: 'HOME' = Home / Explore Carousel, 'LOGIN' = Auth / Login Screen Banner
    placement: {
        type: String,
        enum: ['HOME', 'LOGIN'],
        default: 'HOME',
        index: true
    },
    // Click action link / deep-link (e.g. "https://...", "amison://room/123", "amison://event/rich")
    actionUrl: {
        type: String,
        default: '',
        trim: true
    },
    // Display priority: Lower number = higher priority (1 appears first)
    priority: {
        type: Number,
        default: 1,
        index: true
    },
    // Active status toggle (Admin can pause banner without deleting)
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    createdAdminId: {
        type: String,
        default: 'SYSTEM'
    }
}, {
    timestamps: true
});

// Compound index for ultra-fast query execution (active banners sorted by priority)
bannerSchema.index({ placement: 1, isActive: 1, priority: 1, createdAt: -1 });

module.exports = mongoose.model('Banner', bannerSchema);