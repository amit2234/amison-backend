const mongoose = require('mongoose');

const giftCategorySchema = new mongoose.Schema({
    categoryId: {
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
    sortOrder: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },
    createdBy: {
        type: String,
        default: 'system'
    }
}, {
    collection: 'gift_categories',
    timestamps: true
});

giftCategorySchema.index({ isActive: 1, isDeleted: 1, sortOrder: 1 });

const GiftCategory = mongoose.models.GiftCategory || mongoose.model('GiftCategory', giftCategorySchema);

module.exports = GiftCategory;