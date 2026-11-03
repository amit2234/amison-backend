const mongoose = require('mongoose');

const AgencySettlementSchema = new mongoose.Schema({
    settlementId: {
        type: String,
        required: true,
        unique: true
    },
    agencyId: {
        type: String,
        required: true,
        index: true
    },
    agencyName: {
        type: String,
        required: true
    },
    ownerUid: {
        type: String,
        required: true
    },
    monthYear: {
        type: String, // e.g. "2026-11"
        required: true,
        index: true
    },
    totalCoinsTarget: {
        type: Number,
        default: 0
    },
    achievedCoins: {
        type: Number,
        default: 0
    },
    commissionPercent: {
        type: Number,
        default: 0
    },
    payoutAmountUsd: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Paid', 'Rejected'],
        default: 'Pending',
        index: true
    },
    processedBy: {
        type: String,
        default: 'system'
    },
    paidAt: {
        type: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('AgencySettlement', AgencySettlementSchema);