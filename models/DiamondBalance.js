const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: DIAMOND_BALANCES (100% Zero-Trust MongoDB Atlas)
// Stores live diamond balances, frozen funds, and lifetime audit stats
// ============================================================================
const diamondBalanceSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    }, // Canonical Firebase Auth UID or permanent User ID
    displayUserId: { 
        type: String, 
        required: true, 
        index: true 
    }, // 9-digit numeric display ID
    userName: { 
        type: String, 
        default: '' 
    },
    avatarUrl: { 
        type: String, 
        default: '' 
    },
    userRole: { 
        type: String, 
        enum: ['host', 'agency', 'user', 'merchant', 'admin'], 
        default: 'host' 
    },
    
    // Core Balances
    availableDiamonds: { 
        type: Number, 
        default: 0, 
        min: 0,
        index: true 
    },
    frozenDiamonds: { 
        type: Number, 
        default: 0, 
        min: 0 
    }, // In pending withdrawal
    totalEarnedLifetime: { 
        type: Number, 
        default: 0, 
        min: 0 
    },
    totalWithdrawnLifetime: { 
        type: Number, 
        default: 0, 
        min: 0 
    },
    totalConvertedToCoins: { 
        type: Number, 
        default: 0, 
        min: 0 
    },
    
    // Status & Security
    walletStatus: { 
        type: String, 
        enum: ['ACTIVE', 'FROZEN_BY_ADMIN', 'UNDER_INVESTIGATION'], 
        default: 'ACTIVE' 
    },
    lastTransactionAt: { 
        type: Date, 
        default: Date.now 
    }
}, { 
    collection: 'diamond_balances',
    timestamps: true 
});

diamondBalanceSchema.index({ availableDiamonds: -1 });
diamondBalanceSchema.index({ displayUserId: 1 });

const DiamondBalance = mongoose.models.DiamondBalance || mongoose.model('DiamondBalance', diamondBalanceSchema);

module.exports = DiamondBalance;