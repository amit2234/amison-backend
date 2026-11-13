const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: MERCHANTS & COIN SELLERS (Coin Finance Vault)
// Stores financial vault state. User profile details (name, numericId, avatar, email)
// are stored in the 'users' collection and referenced via 'uid'.
// ============================================================================
const merchantSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true }, // Permanent Firebase Auth UID matching users collection
    sellingStock: { 
        type: Number, 
        default: 50000, 
        min: 0 
        // Note: sellingStock is protected and cannot be directly edited by users/merchants
    }, 
    totalSold: { type: Number, default: 0, min: 0 }, 
    dailyTransferLimit: { type: Number, default: 10000 }, 
    dailyTransferredToday: { type: Number, default: 0 }, 
    role: { 
        type: String, 
        enum: ['seller', 'marchent'], 
        default: 'seller', 
        index: true 
    },
    status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active' },
    roleTagline: { type: String, default: 'Authorized Seller' }, // Seller level / badge tagline (like user level tag)
    assignedByUid: { type: String, default: '' },
    assignedByName: { type: String, default: 'Super Master Admin' },
    assignedByAvatar: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'merchants' });

merchantSchema.index({ role: 1, status: 1 });

const Merchant = mongoose.models.Merchant || mongoose.model('Merchant', merchantSchema);

module.exports = Merchant;
