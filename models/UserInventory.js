const mongoose = require('mongoose');

const ownedItemSchema = new mongoose.Schema({
    itemId: { type: String, required: true },
    category: { type: String, required: true },
    purchasedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null }, // null = Permanent
    validityDays: { type: Number, default: 30 }
}, { _id: false });

const userInventorySchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    ownedItems: [ownedItemSchema],
    equipped: {
        frame: {
            itemId: { type: String, default: null },
            mediaUrl: { type: String, default: null }
        },
        entrance: {
            itemId: { type: String, default: null },
            mediaUrl: { type: String, default: null }
        },
        bubble: {
            itemId: { type: String, default: null },
            mediaUrl: { type: String, default: null }
        },
        theme: {
            itemId: { type: String, default: "theme_amison_light" },
            mediaUrl: { type: String, default: null }
        },
        profileCard: {
            itemId: { type: String, default: null },
            mediaUrl: { type: String, default: null }
        },
        entryTag: {
            tagText: { type: String, default: null }
        },
        vipId: {
            vipNumber: { type: String, default: null },
            expiresAt: { type: Date, default: null }
        },
        ring: {
            itemId: { type: String, default: null },
            expiresAt: { type: Date, default: null }
        }
    }
}, { 
    collection: 'user_inventories',
    timestamps: true 
});

const UserInventory = mongoose.models.UserInventory || mongoose.model('UserInventory', userInventorySchema);

module.exports = UserInventory;
