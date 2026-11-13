const mongoose = require('mongoose');

const AgencyHostSchema = new mongoose.Schema({
    agencyId: {
        type: String,
        required: true,
        index: true
    },
    hostUid: {
        type: String,
        required: true,
        unique: true
    },
    hostNumericId: {
        type: String,
        required: true,
        index: true
    },
    hostName: {
        type: String,
        default: ''
    },
    hostAvatar: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['Active', 'Kicked', 'Pending'],
        default: 'Active'
    },
    totalGiftingReceived: {
        type: Number,
        default: 0
    },
    joinedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

AgencyHostSchema.index({ agencyId: 1, status: 1 });

module.exports = mongoose.model('AgencyHost', AgencyHostSchema);
