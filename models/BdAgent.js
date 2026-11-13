const mongoose = require('mongoose');

const BdAgentSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    numericId: {
        type: String,
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    avatar: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['Active', 'Suspended', 'Pending'],
        default: 'Active',
        index: true
    },
    commissionPercent: {
        type: Number,
        default: 5.0
    },
    monthlyTarget: {
        type: Number,
        default: 10000000 // 10M Coins
    },
    currentMonthAchieved: {
        type: Number,
        default: 0
    },
    assignedAgenciesCount: {
        type: Number,
        default: 0
    },
    assignedBy: {
        type: String,
        default: 'super_admin'
    }
}, { timestamps: true });

module.exports = mongoose.model('BdAgent', BdAgentSchema);
