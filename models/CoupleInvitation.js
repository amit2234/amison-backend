const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: COUPLE PARTNER INVITATIONS
// Tracks invite proposals, 24-hour expiration, and official message references.
// ============================================================================
const coupleInvitationSchema = new mongoose.Schema({
    invitationId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    senderId: {
        type: String,
        required: true,
        index: true
    },
    receiverId: {
        type: String,
        required: true,
        index: true
    },
    senderProfile: {
        name: { type: String, default: 'User' },
        avatar: { type: String, default: '' },
        displayId: { type: String, default: '' },
        gender: { type: String, default: 'Male' }
    },
    receiverProfile: {
        name: { type: String, default: 'User' },
        avatar: { type: String, default: '' },
        displayId: { type: String, default: '' },
        gender: { type: String, default: 'Female' }
    },
    status: {
        type: String,
        enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
        default: 'PENDING',
        index: true
    },
    proposalText: {
        type: String,
        default: 'Would you like to be my Couple Partner on Amison?'
    },
    officialMessageId: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    }
}, {
    collection: 'couple_invitations',
    timestamps: true
});

coupleInvitationSchema.index({ receiverId: 1, status: 1, createdAt: -1 });
coupleInvitationSchema.index({ senderId: 1, status: 1, createdAt: -1 });

const CoupleInvitation = mongoose.models.CoupleInvitation || mongoose.model('CoupleInvitation', coupleInvitationSchema);

module.exports = CoupleInvitation;
