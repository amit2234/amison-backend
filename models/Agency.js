const mongoose = require('mongoose');

const AgencySchema = new mongoose.Schema({
    agencyId: {
        type: String,
        required: true,
        unique: true
    },
    agencyName: {
        type: String,
        required: true,
        trim: true
    },
    logoUrl: {
        type: String,
        default: ''
    },
    ownerUid: {
        type: String,
        required: true,
        index: true
    },
    ownerNumericId: {
        type: String,
        required: true,
        index: true
    },
    ownerName: {
        type: String,
        default: ''
    },
    ownerPhone: {
        type: String,
        default: ''
    },
    bdAgentId: {
        type: String,
        default: '',
        index: true
    },
    bdAgentName: {
        type: String,
        default: ''
    },
    commissionPercent: {
        type: Number,
        default: 20.0,
        min: 0,
        max: 100
    },
    monthlyTargetCoins: {
        type: Number,
        default: 50000000
    },
    currentMonthCoins: {
        type: Number,
        default: 0
    },
    totalHostsCount: {
        type: Number,
        default: 0
    },
    totalEarningsUsd: {
        type: Number,
        default: 0.0
    },
    status: {
        type: String,
        enum: ['Active', 'Blocked', 'Pending'],
        default: 'Active'
    },
    createdBy: {
        type: String,
        default: 'super_admin'
    }
}, { timestamps: true });

AgencySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Agency', AgencySchema);
