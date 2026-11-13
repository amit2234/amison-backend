const mongoose = require('mongoose');

const WithdrawRequestSchema = new mongoose.Schema({
    requestId: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    numericId: {
        type: String,
        required: true,
        index: true
    },
    userName: {
        type: String,
        default: 'User'
    },
    userAvatar: {
        type: String,
        default: ''
    },
    diamonds: {
        type: Number,
        required: true,
        min: 1
    },
    inrAmount: {
        type: Number,
        required: true,
        min: 1
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: ['UPI', 'BANK', 'PAYTM'],
        default: 'UPI'
    },
    upiId: {
        type: String,
        default: ''
    },
    bankDetails: {
        accountHolderName: { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        ifscCode: { type: String, default: '' },
        bankName: { type: String, default: '' }
    },
    phone: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['Pending', 'Successful', 'Reject'],
        default: 'Pending'
    },
    screenshotUrl: {
        type: String,
        default: ''
    },
    cloudinaryPublicId: {
        type: String,
        default: ''
    },
    transactionRef: {
        type: String,
        default: ''
    },
    rejectReason: {
        type: String,
        default: ''
    },
    adminUid: {
        type: String,
        default: ''
    },
    approvedAt: {
        type: Date
    }
}, { timestamps: true });

WithdrawRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('WithdrawRequest', WithdrawRequestSchema);
