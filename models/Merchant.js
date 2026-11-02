const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: MERCHANTS & COIN SELLERS
// Authorized Resellers with dedicated Selling Stock vault
// ============================================================================
const merchantSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    numericId: { type: String, required: true, index: true }, // 9-digit display numeric ID
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: "" },
    sellingStock: { type: Number, default: 0, min: 0 }, // Active Selling Stock in Coins
    totalSold: { type: Number, default: 0, min: 0 }, // Total coins sold/transferred to users
    totalAllocated: { type: Number, default: 0, min: 0 }, // Total stock received from Super Admin
    status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active', index: true },
    role: { type: String, enum: ['seller', 'marchent', 'master_merchant'], default: 'seller', index: true },
    dailyTransferLimit: { type: Number, default: 10000000 }, // Default 10M coins daily quota
    dailyTransferredToday: { type: Number, default: 0 },
    lastResetDate: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    assignedBy: { type: String, default: 'Super Master' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'merchants' });

merchantSchema.index({ status: 1, role: 1 });

const Merchant = mongoose.models.Merchant || mongoose.model('Merchant', merchantSchema);

module.exports = Merchant;