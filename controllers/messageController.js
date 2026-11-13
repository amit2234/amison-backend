const { DirectConversation, DirectMessage } = require('../models/Message');
const messagingService = require('../services/messagingService');

/**
 * Controller for Handling Message Transmissions, History, Reactions, and Recalls
 */
const messageController = {
    /**
     * POST /api/messages/send
     */
    async sendMessage(req, res) {
        try {
            const result = await messagingService.sendMessage(req.body);
            return res.json(result);
        } catch (e) {
            console.error('[MessageController] Send error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    /**
     * GET /api/messages/history/:conversationId
     */
    async getHistory(req, res) {
        try {
            const convId = String(req.params.conversationId || '').trim();
            const viewerUid = String(req.query.uid || '').trim();
            const limit = Math.min(Math.max(Number(req.query.limit) || 100, 10), 250);

            if (!convId) {
                return res.status(400).json({ success: false, messages: [], error: 'Missing conversationId' });
            }

            const query = { conversationId: convId };
            if (viewerUid) {
                query.deletedFor = { $ne: viewerUid };
            }

            const docs = await DirectMessage.find(query)
                .sort({ messageId: -1 })
                .limit(limit)
                .lean();

            const messages = docs.reverse().map(m => ({
                id: Number(m.messageId) || new Date(m.createdAt).getTime(),
                conversationId: m.conversationId,
                senderId: m.senderId || '',
                senderName: m.senderName || 'User',
                senderAvatar: m.senderAvatar || '',
                receiverId: m.receiverId || '',
                text: m.isRecalled ? '🚫 [This message was recalled]' : (m.text || ''),
                imageUrl: m.isRecalled ? '' : (m.imageUrl || ''),
                isPrivatePhoto: Boolean(m.isPrivatePhoto),
                replyToUser: m.replyToUser || '',
                replyToText: m.replyToText || '',
                timestamp: m.timestamp || 'Now',
                status: m.isRead ? 'Read' : (m.status || 'Delivered'),
                isRead: Boolean(m.isRead),
                isRecalled: Boolean(m.isRecalled)
            }));

            return res.json({
                success: true,
                conversationId: convId,
                messages
            });
        } catch (e) {
            console.error('[MessageController] Fetch history error:', e);
            return res.status(500).json({ success: false, messages: [], error: e.message });
        }
    },

    /**
     * POST /api/messages/read
     */
    async markRead(req, res) {
        try {
            const { conversationId, uid } = req.body || {};
            const convId = String(conversationId || '').trim();
            const cleanUid = String(uid || '').trim();

            if (!convId || !cleanUid) {
                return res.status(400).json({ success: false, error: 'Missing conversationId or uid' });
            }

            const result = await messagingService.markRead(convId, cleanUid);
            return res.json(result);
        } catch (e) {
            console.error('[MessageController] Mark read error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    /**
     * POST /api/messages/recall
     */
    async recallMessage(req, res) {
        try {
            const { conversationId, messageId } = req.body || {};
            const convId = String(conversationId || '').trim();
            const msgId = Number(messageId);

            if (!convId || !msgId) {
                return res.status(400).json({ success: false, error: 'Missing conversationId or messageId' });
            }

            const result = await messagingService.recallMessage(convId, msgId);
            return res.json(result);
        } catch (e) {
            console.error('[MessageController] Recall error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    /**
     * POST /api/messages/delete
     */
    async deleteMessage(req, res) {
        try {
            const { conversationId, messageId, uid, deleteConversation } = req.body || {};
            const convId = String(conversationId || '').trim();
            const cleanUid = String(uid || '').trim();

            if (!convId) {
                return res.status(400).json({ success: false, error: 'Missing conversationId' });
            }

            const result = await messagingService.deleteMessageOrConversation({
                convId,
                cleanUid,
                msgId: Number(messageId),
                deleteConversation: Boolean(deleteConversation)
            });

            return res.json(result);
        } catch (e) {
            console.error('[MessageController] Delete error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    /**
     * POST /api/messages/theme & GET /api/messages/theme/:conversationId
     */
    async setTheme(req, res) {
        try {
            const { conversationId, chatTheme } = req.body || {};
            const convId = String(conversationId || '').trim();
            if (!convId || !chatTheme) {
                return res.status(400).json({ success: false, error: 'Missing conversationId or chatTheme' });
            }

            await DirectConversation.updateOne(
                { conversationId: convId },
                { $set: { chatTheme: String(chatTheme).trim() } },
                { upsert: true }
            );

            return res.json({ success: true, conversationId: convId, chatTheme });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async getTheme(req, res) {
        try {
            const convId = String(req.params.conversationId || '').trim();
            const doc = await DirectConversation.findOne({ conversationId: convId }).select('chatTheme').lean();
            return res.json({
                success: true,
                chatTheme: doc?.chatTheme || '#EFF1F5'
            });
        } catch (e) {
            return res.json({ success: false, chatTheme: '#EFF1F5' });
        }
    }
};

module.exports = messageController;
