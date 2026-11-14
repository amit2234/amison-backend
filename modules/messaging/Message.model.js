const mongoose = require('mongoose');
const { DEFAULT_CHAT_THEME } = require('./messaging.constants');

// ============================================================================
// MONGOOSE SCHEMA: MESSAGES (Official System Notices & Announcements)
// ============================================================================
const messageSchema = new mongoose.Schema({
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    text: { type: String, required: true, trim: true },
    type: {
        type: String,
        enum: ['text', 'official_notice', 'official_role_announcement', 'official_couple_invite', 'gift', 'system'],
        default: 'text',
        index: true
    },
    metadata: {
        assignedRole: { type: String, default: '' },
        promoterUid: { type: String, default: '' },
        promoterName: { type: String, default: 'Amison Management' },
        promoterAvatar: { type: String, default: '' },
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

// ============================================================================
// MONGOOSE SCHEMA: DIRECT MESSAGE (1-on-1 Chats, Replies, Media, Recall, Soft-Delete)
// ============================================================================
const directMessageSchema = new mongoose.Schema({
    messageId: { type: Number, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    participants: [{ type: String, index: true }],
    senderId: { type: String, required: true, index: true },
    receiverId: { type: String, required: true, index: true },
    senderName: { type: String, default: 'User' },
    senderAvatar: { type: String, default: '' },
    receiverName: { type: String, default: 'User' },
    text: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    isPrivatePhoto: { type: Boolean, default: false },
    replyToUser: { type: String, default: '' },
    replyToText: { type: String, default: '' },
    timestamp: { type: String, default: '' },
    status: { type: String, default: 'Delivered' },
    isRead: { type: Boolean, default: false, index: true },
    isRecalled: { type: Boolean, default: false },
    deletedFor: [{ type: String, index: true }],
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'direct_messages' });

directMessageSchema.index({ conversationId: 1, messageId: -1 });

// ============================================================================
// MONGOOSE SCHEMA: DIRECT CONVERSATION (Inbox list, unread counts, themes)
// ============================================================================
const directConversationSchema = new mongoose.Schema({
    conversationId: { type: String, required: true, unique: true, index: true },
    participants: [{ type: String, index: true }],
    lastMessage: { type: String, default: '' },
    lastSenderId: { type: String, default: '' },
    lastTimestamp: { type: String, default: '' },
    timeMillis: { type: Number, default: Date.now, index: true },
    readParticipants: [{ type: String }],
    deletedConversationFor: [{ type: String, index: true }],
    unreadCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    userProfiles: { type: mongoose.Schema.Types.Mixed, default: {} },
    isOfficial: { type: Boolean, default: false },
    chatTheme: { type: String, default: DEFAULT_CHAT_THEME },
    updatedAt: { type: Date, default: Date.now, index: true }
}, { collection: 'direct_conversations' });

directConversationSchema.index({ participants: 1, timeMillis: -1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const DirectMessage = mongoose.models.DirectMessage || mongoose.model('DirectMessage', directMessageSchema);
const DirectConversation = mongoose.models.DirectConversation || mongoose.model('DirectConversation', directConversationSchema);

Message.Message = Message;
Message.DirectMessage = DirectMessage;
Message.DirectConversation = DirectConversation;

module.exports = Message;
module.exports.Message = Message;
module.exports.DirectMessage = DirectMessage;
module.exports.DirectConversation = DirectConversation;
