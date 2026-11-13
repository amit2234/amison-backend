const mongoose = require('mongoose');
const { DirectConversation, DirectMessage } = require('../models/Message');
const cacheService = require('./cacheService');

/**
 * Messaging Service
 * High-performance 0-Trust message persistence and inbox unread management
 */
const messagingService = {
    /**
     * Fetch Zegocloud Chat AppId from newop_zego_config
     */
    async getActiveZegoChatConfig() {
        try {
            const newopZegoService = require('./newopZegoService');
            const cfg = await newopZegoService.getZegoConfig();
            return {
                chatAppId: cfg.chatAppId || 0,
                rtcAppId: cfg.rtcAppId || 0
            };
        } catch (e) {
            return { chatAppId: 0, rtcAppId: 0 };
        }
    },

    /**
     * Deterministic conversationId generator
     */
    buildConversationId(uid1, uid2) {
        const a = String(uid1 || '').trim();
        const b = String(uid2 || '').trim();
        if (a === 'AMISON_OFFICIAL') {
            return b && b !== 'AMISON_OFFICIAL' ? `conv_amison_official_${b}` : 'conv_amison_official';
        }
        if (b === 'AMISON_OFFICIAL') {
            return a && a !== 'AMISON_OFFICIAL' ? `conv_amison_official_${a}` : 'conv_amison_official';
        }
        return a < b ? `${a}_${b}` : `${b}_${a}`;
    },

    /**
     * Send a direct message
     */
    async sendMessage(data) {
        const {
            messageId,
            conversationId: rawConvId,
            senderId,
            senderName,
            senderAvatar,
            receiverId,
            receiverName,
            receiverAvatar,
            text,
            imageUrl,
            isPrivatePhoto,
            replyToUser,
            replyToText,
            timestamp
        } = data || {};

        const cleanSender = String(senderId || '').trim();
        const cleanReceiver = String(receiverId || '').trim();
        const cleanText = String(text || '');
        const cleanImg = String(imageUrl || '');

        if (!cleanSender || !cleanReceiver || (!cleanText && !cleanImg)) {
            throw new Error('Missing senderId, receiverId, or message content');
        }

        const convId = (rawConvId && String(rawConvId).trim()) || this.buildConversationId(cleanSender, cleanReceiver);
        const nowMillis = Date.now();
        const msgId = Number(messageId) > 0 ? Number(messageId) : nowMillis;
        const formattedTime = timestamp || new Date(nowMillis).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const displayLastText = cleanImg && !cleanText ? '🖼️ [Photo]' : cleanText;

        // Redis & in-memory unread sync
        const nextReceiverUnread = await cacheService.incrementUnread(cleanReceiver, convId);
        await cacheService.clearUnread(cleanSender, convId);

        // Upsert message doc
        const messageDoc = await DirectMessage.findOneAndUpdate(
            { conversationId: convId, messageId: msgId },
            {
                $setOnInsert: {
                    messageId: msgId,
                    conversationId: convId,
                    participants: [cleanSender, cleanReceiver],
                    senderId: cleanSender,
                    receiverId: cleanReceiver,
                    createdAt: new Date(nowMillis)
                },
                $set: {
                    senderName: senderName || 'User',
                    senderAvatar: senderAvatar || '',
                    receiverName: receiverName || 'User',
                    text: cleanText,
                    imageUrl: cleanImg,
                    isPrivatePhoto: Boolean(isPrivatePhoto),
                    replyToUser: replyToUser || '',
                    replyToText: replyToText || '',
                    timestamp: formattedTime,
                    status: 'Delivered'
                }
            },
            { upsert: true, new: true, lean: true }
        );

        // Update direct_conversations
        const updateConvFields = {
            conversationId: convId,
            participants: [cleanSender, cleanReceiver],
            lastMessage: displayLastText,
            lastSenderId: cleanSender,
            lastTimestamp: formattedTime,
            timeMillis: nowMillis,
            readParticipants: [cleanSender],
            [`unreadCounts.${cleanSender}`]: 0,
            isOfficial: cleanSender === 'AMISON_OFFICIAL' || cleanReceiver === 'AMISON_OFFICIAL',
            updatedAt: new Date(nowMillis)
        };

        if (senderName || senderAvatar) {
            updateConvFields[`userProfiles.${cleanSender}`] = {
                name: senderName || 'User',
                avatarUrl: senderAvatar || ''
            };
        }
        if (receiverName || receiverAvatar) {
            updateConvFields[`userProfiles.${cleanReceiver}`] = {
                name: receiverName || 'User',
                avatarUrl: receiverAvatar || ''
            };
        }

        await DirectConversation.findOneAndUpdate(
            { conversationId: convId },
            {
                $set: updateConvFields,
                $inc: { [`unreadCounts.${cleanReceiver}`]: 1 }
            },
            { upsert: true, new: true, lean: true }
        );

        const zegoConfig = await this.getActiveZegoChatConfig();

        return {
            success: true,
            conversationId: convId,
            messageId: msgId,
            status: 'Delivered',
            receiverUnreadCount: nextReceiverUnread,
            zegoChatAppId: zegoConfig.chatAppId,
            message: messageDoc
        };
    },

    /**
     * Mark conversation and messages as read
     */
    async markRead(convId, cleanUid) {
        await cacheService.clearUnread(cleanUid, convId);

        await DirectConversation.updateOne(
            { conversationId: convId },
            {
                $set: { [`unreadCounts.${cleanUid}`]: 0 },
                $addToSet: { readParticipants: cleanUid }
            }
        );

        await DirectMessage.updateMany(
            { conversationId: convId, receiverId: cleanUid, isRead: false },
            { $set: { isRead: true, status: 'Read' } }
        );

        return { success: true, conversationId: convId, unreadCount: 0 };
    },

    /**
     * Recall a message
     */
    async recallMessage(convId, msgId) {
        await DirectMessage.updateOne(
            { conversationId: convId, messageId: msgId },
            {
                $set: {
                    text: '🚫 [This message was recalled]',
                    imageUrl: '',
                    isRecalled: true
                }
            }
        );

        return { success: true };
    },

    /**
     * Delete message or conversation
     */
    async deleteMessageOrConversation({ convId, cleanUid, msgId, deleteConversation }) {
        if (deleteConversation) {
            await DirectConversation.deleteOne({ conversationId: convId });
            await DirectMessage.deleteMany({ conversationId: convId });
            if (cleanUid) await cacheService.clearUnread(cleanUid, convId);
            return { success: true, deletedConversation: true };
        }

        if (msgId && cleanUid) {
            await DirectMessage.updateOne(
                { conversationId: convId, messageId: msgId },
                { $addToSet: { deletedFor: cleanUid } }
            );
        }

        return { success: true };
    }
};

module.exports = messagingService;
