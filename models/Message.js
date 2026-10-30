const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: DIRECT CONVERSATIONS (Inbox List Collection)
// ============================================================================
const directConversationSchema = new mongoose.Schema({
    conversationId: { type: String, required: true, unique: true, index: true },
    participants: { type: [String], required: true, index: true },
    userProfiles: {
        type: Map,
        of: new mongoose.Schema({
            name: { type: String, default: "" },
            avatarUrl: { type: String, default: "" }
        }, { _id: false }),
        default: {}
    },
    lastMessage: { type: String, default: "" },
    lastSenderId: { type: String, default: "" },
    lastTimestamp: { type: String, default: "" },
    timeMillis: { type: Number, default: () => Date.now(), index: true },
    unreadCounts: {
        type: Map,
        of: Number,
        default: {}
    },
    readParticipants: { type: [String], default: [] },
    chatTheme: { type: String, default: "#EFF1F5" },
    isOfficial: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now, index: true }
}, { collection: 'direct_conversations' });

directConversationSchema.index({ participants: 1, timeMillis: -1 });

const DirectConversation = mongoose.models.DirectConversation || mongoose.model('DirectConversation', directConversationSchema);

// ============================================================================
// MONGOOSE SCHEMA: DIRECT MESSAGES (1-to-1 Private Messages History)
// ============================================================================
const directMessageSchema = new mongoose.Schema({
    messageId: { type: Number, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    participants: { type: [String], required: true, index: true },
    senderId: { type: String, required: true, index: true },
    senderName: { type: String, default: "User" },
    senderAvatar: { type: String, default: "" },
    receiverId: { type: String, required: true, index: true },
    receiverName: { type: String, default: "" },
    text: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    isPrivatePhoto: { type: Boolean, default: false },
    replyToUser: { type: String, default: "" },
    replyToText: { type: String, default: "" },
    timestamp: { type: String, default: "Now" },
    status: { type: String, enum: ['Sent', 'Delivered', 'Read'], default: 'Delivered' },
    isRead: { type: Boolean, default: false, index: true },
    isRecalled: { type: Boolean, default: false },
    deletedFor: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'direct_messages' });

directMessageSchema.index({ conversationId: 1, messageId: 1 }, { unique: true });
directMessageSchema.index({ conversationId: 1, createdAt: 1 });

const DirectMessage = mongoose.models.DirectMessage || mongoose.model('DirectMessage', directMessageSchema);

module.exports = {
    DirectConversation,
    DirectMessage,
    Message: DirectMessage,
    Conversation: DirectConversation
};