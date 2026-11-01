const mongoose = require('mongoose');

const storePurchaseSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    itemId: { type: String, required: true },
    category: { type: String, required: true },
    pricePaid: { type: Number, required: true },
    validityDays: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    purchasedAt: { type: Date, default: Date.now }
}, {
    collection: 'store_purchases'
});

const StorePurchase = mongoose.models.StorePurchase || mongoose.model('StorePurchase', storePurchaseSchema);

module.exports = StorePurchase;