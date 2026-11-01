const mongoose = require('mongoose');

const storeItemSchema = new mongoose.Schema({
    itemId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    category: { 
        type: String, 
        required: true, 
        enum: [
            "EntranceEffect", 
            "Frames", 
            "TextBubble", 
            "Theme", 
            "ProfileCard", 
            "EntryTag", 
            "VipId", 
            "Rings"
        ],
        index: true 
    },
    name: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    iconEmoji: { type: String, default: "🎁" },
    mediaUrl: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    previewGradient: [{ type: String }],
    description: { type: String, default: "" },
    rarity: { 
        type: String, 
        enum: ["Common", "Rare", "Epic", "Legendary", "Mythic", "Supreme"], 
        default: "Epic" 
    },
    validityDays: { type: Number, default: 30 }, // 0 = Permanent
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 10 }
}, { 
    collection: 'store_items',
    timestamps: true 
});

const StoreItem = mongoose.models.StoreItem || mongoose.model('StoreItem', storeItemSchema);

module.exports = StoreItem;