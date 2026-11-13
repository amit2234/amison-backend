const mongoose = require('mongoose');

const LevelConfigSchema = new mongoose.Schema({
    levelId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    category: {
        type: String,
        required: true,
        enum: ['USER', 'ROOM', 'CP', 'SM'],
        index: true
    },
    levelNumber: {
        type: Number,
        required: true,
        min: 0
    },
    index: {
        type: Number,
        default: 1
    },
    xpRequired: {
        type: Number,
        required: true,
        min: 0
    },
    iconUrl: {
        type: String,
        default: ''
    },
    cloudinaryPublicId: {
        type: String,
        default: ''
    },
    badgeColor: {
        type: String,
        default: '#8B5CF6'
    },
    roomPerks: {
        adminCount: { type: Number, default: 3 },
        coAdminCount: { type: Number, default: 0 },
        passwordEnabled: { type: Boolean, default: false },
        gamesEnabled: { type: Boolean, default: false },
        rewardType: { type: String, enum: ['None', 'Frame', 'Entrance', 'Theme'], default: 'None' },
        rewardUrl: { type: String, default: '' }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    updatedBy: {
        type: String,
        default: 'admin'
    }
}, { timestamps: true });

LevelConfigSchema.index({ category: 1, levelNumber: 1 }, { unique: true });

module.exports = mongoose.model('LevelConfig', LevelConfigSchema);
