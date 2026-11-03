const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: MERCHANTS & COIN SELLERS (Coin Finance Vault)
// Stores financial vault state. User profile details (name, numericId, avatar, email)
// are stored in the 'users' collection and referenced via 'uid'.
// ============================================================================
const merchantSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID matching users collection
    sellingStock: { 
        type: Number, 
        default: 50000, 
        min: 0 
        // Note: sellingStock is protected and cannot be directly edited by users/merchants
    }, 
    totalSold: { type: Number, default: 0, min: 0 }, 
    dailyTransferLimit: { type: Number, default: 10000 }, 
    dailyTransferredToday: { type: Number, default: 0 }, 
    status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active', index: true },
    roleTagline: { type: String, default: 'Authorized Seller' }, // Seller level / badge tagline (like user level tag)
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'merchants' });

merchantSchema.index({ status: 1 });

const Merchant = mongoose.models.Merchant || mongoose.model('Merchant', merchantSchema);

module.exports = Merchant;