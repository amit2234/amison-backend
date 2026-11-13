const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: DIAMOND_LEDGERS (Double-Entry Immutable Accounting)
// Every single diamond minted, transferred, burned, or cashed out is recorded here.
// ============================================================================
const diamondLedgerSchema = new mongoose.Schema({
    transactionId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    idempotencyKey: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    displayUserId: { 
        type: String, 
        required: true, 
        index: true 
    },
    userName: { 
        type: String, 
        default: '' 
    },
    
    direction: { 
        type: String, 
        enum: ['CREDIT', 'DEBIT'], 
        required: true, 
        index: true 
    },
    amount: { 
        type: Number, 
        required: true, 
        min: 1 
    },
    
    balanceBefore: { 
        type: Number, 
        required: true 
    },
    balanceAfter: { 
        type: Number, 
        required: true 
    },
    
    sourceType: {
        type: String,
        enum: [
            'GIFT_RECEIVED',           // Normal host gift share
            'AGENCY_COMMISSION',        // Agency master cut
            'LUCKY_BOX_REWARD',         // Platform event
            'COIN_EXCHANGE_DEBIT',      // Diamonds converted back to coins
            'WITHDRAWAL_REQUEST_HOLD',  // Locked for payout
            'WITHDRAWAL_REJECT_REFUND', // Payout failed, returned
            'WITHDRAWAL_COMPLETED',     // Permanently settled
            'ADMIN_MANUAL_MINT',        // Admin added diamonds
            'ADMIN_MANUAL_BURN',        // Admin seized/deducted
            'FRAUD_ROLLBACK'            // System fraud reversal
        ],
        required: true,
        index: true
    },
    
    referenceId: { 
        type: String, 
        default: '' 
    },
    performedBy: { 
        type: String, 
        default: 'SYSTEM' 
    },
    
    remarks: { 
        type: String, 
        default: '' 
    },
    metadata: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    }
}, { 
    collection: 'diamond_ledgers',
    timestamps: { createdAt: true, updatedAt: false } 
});

diamondLedgerSchema.index({ userId: 1, createdAt: -1 });
diamondLedgerSchema.index({ displayUserId: 1, createdAt: -1 });
diamondLedgerSchema.index({ sourceType: 1, createdAt: -1 });
diamondLedgerSchema.index({ createdAt: -1 });

const DiamondLedger = mongoose.models.DiamondLedger || mongoose.model('DiamondLedger', diamondLedgerSchema);

module.exports = DiamondLedger;
