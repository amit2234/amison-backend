const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: WALLET TRANSACTIONS LEDGER (Immutable Passbook)
// ============================================================================
const walletTransactionSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true, index: true },
    type: {
        type: String,
        enum: ['GIFT_SEND', 'GIFT_MULTI', 'CONVERT_DIAMOND_TO_COIN', 'WITHDRAW_DIAMOND', 'GUILD_TRANSFER', 'ADMIN_ADJUST'],
        required: true,
        index: true
    },
    senderUid: { type: String, required: true, index: true },
    receiverUid: { type: String, default: '', index: true },
    recipientUids: { type: [String], default: [] },
    giftId: { type: String, default: '' },
    giftName: { type: String, default: '' },
    multiplier: { type: Number, default: 1 },
    coinsDelta: { type: Number, default: 0 },
    diamondsDelta: { type: Number, default: 0 },
    senderCoinsAfter: { type: Number, default: 0 },
    senderDiamondsAfter: { type: Number, default: 0 },
    roomId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'wallet_transactions' });

walletTransactionSchema.index({ senderUid: 1, createdAt: -1 });
walletTransactionSchema.index({ receiverUid: 1, createdAt: -1 });

const WalletTransaction = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = WalletTransaction;
module.exports.WalletTransaction = WalletTransaction;
module.exports.Transaction = WalletTransaction;
module.exports.walletTransactionSchema = walletTransactionSchema;