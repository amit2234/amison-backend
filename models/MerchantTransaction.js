const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: MERCHANT TRANSACTIONS AUDIT LEDGER (Immutable)
// ============================================================================
const merchantTxSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, default: null, sparse: true, index: true },
    merchantId: { type: String, required: true, index: true }, // UID
    merchantNumericId: { type: String, default: '' },
    merchantName: { type: String, default: '' },
    targetUserId: { type: String, required: true, index: true }, // UID
    targetNumericId: { type: String, default: '' },
    targetName: { type: String, default: '' },
    coins: { type: Number, required: true, min: 1 },
    merchantStockBefore: { type: Number, default: 0 },
    merchantStockAfter: { type: Number, default: 0 },
    userCoinsBefore: { type: Number, default: 0 },
    userCoinsAfter: { type: Number, default: 0 },
    txType: {
        type: String,
        enum: ['ADMIN_ALLOCATE', 'MERCHANT_RECHARGE', 'ADMIN_REVOKE'],
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['SUCCESS', 'FAILED', 'ROLLBACK'],
        default: 'SUCCESS',
        index: true
    },
    note: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'merchant_transactions' });

merchantTxSchema.index({ merchantId: 1, createdAt: -1 });
merchantTxSchema.index({ targetUserId: 1, createdAt: -1 });

const MerchantTransaction = mongoose.models.MerchantTransaction || mongoose.model('MerchantTransaction', merchantTxSchema);

module.exports = MerchantTransaction;