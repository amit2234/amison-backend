const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: WALLET COLLECTION (User Coins, Diamonds, Balance)
// ============================================================================
const walletSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    numericId: { type: Number, index: true }, // Display ID
    coins: { type: Number, default: 0, min: 0 }, // Gold Coins Balance
    diamonds: { type: Number, default: 0, min: 0 }, // Diamonds Balance
    rechargeTotal: { type: Number, default: 0, min: 0 }, // Cumulative recharge
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'wallets' });

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
module.exports.Wallet = Wallet;
module.exports.walletSchema = walletSchema;