const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: DIAMOND_ADJUSTMENTS (Admin Operation Audit Trail)
// Tracks who modified user diamonds, why, when, and from what IP address.
// ============================================================================
const diamondAdjustmentSchema = new mongoose.Schema({
    adjustmentId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    targetUserId: { 
        type: String, 
        required: true, 
        index: true 
    },
    targetDisplayUserId: { 
        type: String, 
        required: true, 
        index: true 
    },
    targetUserName: { 
        type: String, 
        default: '' 
    },
    actionType: { 
        type: String, 
        enum: ['MINT', 'BURN', 'FREEZE', 'UNFREEZE'], 
        required: true 
    },
    amount: { 
        type: Number, 
        default: 0 
    },
    reason: { 
        type: String, 
        required: true 
    },
    adminEmail: { 
        type: String, 
        default: 'admin@newop.internal' 
    },
    adminUid: { 
        type: String, 
        default: '' 
    },
    ipAddress: { 
        type: String, 
        default: '' 
    },
    status: { 
        type: String, 
        enum: ['APPLIED', 'REVERTED'], 
        default: 'APPLIED' 
    }
}, { 
    collection: 'diamond_adjustments',
    timestamps: true 
});

diamondAdjustmentSchema.index({ targetDisplayUserId: 1, createdAt: -1 });
diamondAdjustmentSchema.index({ createdAt: -1 });

const DiamondAdjustment = mongoose.models.DiamondAdjustment || mongoose.model('DiamondAdjustment', diamondAdjustmentSchema);

module.exports = DiamondAdjustment;
