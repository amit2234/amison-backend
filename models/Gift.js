const mongoose = require('mongoose');

const giftSchema = new mongoose.Schema({
    giftId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    coinPrice: { 
        type: Number, 
        required: true, 
        min: 1,
        default: 100 
    },
    category: { 
        type: String, 
        default: 'Popular', 
        index: true 
    },
    iconEmoji: { 
        type: String, 
        default: '🎁' 
    },
    iconUrl: { 
        type: String, 
        default: '' 
    },
    animationUrl: { 
        type: String, 
        default: '' 
    },
    animationType: { 
        type: String, 
        enum: ['SVGA_ANIMATION', 'GIF_ANIMATION', 'SVG_ANIMATION', 'PAG_ANIMATION', 'LOTTIE_ANIMATION', 'CUSTOM_MEDIA'],
        default: 'SVGA_ANIMATION' 
    },
    mediaFormat: {
        type: String,
        default: 'SVGA'
    },
    isBroadcast: {
        type: Boolean,
        default: false
    },
    isActive: { 
        type: Boolean, 
        default: true, 
        index: true 
    },
    sortOrder: { 
        type: Number, 
        default: 0 
    },
    isLucky: { 
        type: Boolean, 
        default: false 
    },
    luckyMultiplierMax: { 
        type: Number, 
        default: 1 
    },
    description: { 
        type: String, 
        default: '' 
    },
    createdBy: { 
        type: String, 
        default: 'admin' 
    }
}, { 
    collection: 'gifts',
    timestamps: true 
});

// Compound Index for Ultra-Fast Sorted Catalog Queries
giftSchema.index({ isActive: 1, category: 1, sortOrder: 1 });

const Gift = mongoose.models.Gift || mongoose.model('Gift', giftSchema);

module.exports = Gift;