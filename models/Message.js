const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: MESSAGES (Direct Messages & Amison Official Notices)
// Zero-trust MongoDB message persistence with sender & recipient indexing
// ============================================================================
const messageSchema = new mongoose.Schema({
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true }, // Auth UID or "AMISON_OFFICIAL"
    recipientId: { type: String, required: true, index: true }, // Target user Auth UID
    text: { type: String, required: true, trim: true },
    type: { 
        type: String, 
        enum: ['text', 'official_notice', 'official_role_announcement', 'official_couple_invite', 'gift', 'system'], 
        default: 'text',
        index: true
    },
    metadata: {
        assignedRole: { type: String, default: '' }, // 'seller' or 'marchent'
        promoterUid: { type: String, default: '' },
        promoterName: { type: String, default: 'Amison Management' },
        promoterAvatar: { type: String, default: '' }, // Cloudinary Image URL
        stockAllocated: { type: Number, default: 0 },
        badge: { type: String, default: '' },
        invitationId: { type: String, default: '' },
        senderUid: { type: String, default: '' },
        senderName: { type: String, default: '' },
        senderAvatar: { type: String, default: '' },
        proposalText: { type: String, default: '' }
    },
    isRead: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'messages' });

messageSchema.index({ recipientId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, createdAt: -1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

module.exports = Message;