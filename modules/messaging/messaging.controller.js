const messagingService = require('./messaging.service');

const messagingController = {
    async getConversations(req, res) {
        try {
            const cleanUid = String(req.callerUid || '').trim();
            const result = await messagingService.getConversations(cleanUid);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            if (code >= 500) console.error('[MessagingController] Fetch conversations error:', e);
            return res.status(code).json({ success: false, conversations: [], error: e.message });
        }
    },

    async sendMessage(req, res) {
        try {
            const payload = {
                ...(req.body || {}),
                senderId: req.callerUid
            };
            const result = await messagingService.sendMessage(payload);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            if (code >= 500) console.error('[MessagingController] Send error:', e);
            return res.status(code).json({ success: false, error: e.message });
        }
    },

    async getHistory(req, res) {
        try {
            const convId = String(req.params.conversationId || '').trim();
            const viewerUid = String(req.callerUid || '').trim();
            const result = await messagingService.getHistory(convId, viewerUid, req.query.limit);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            if (code >= 500) console.error('[MessagingController] Fetch history error:', e);
            return res.status(code).json({ success: false, messages: [], error: e.message });
        }
    },

    async markRead(req, res) {
        try {
            const { conversationId } = req.body || {};
            const convId = String(conversationId || '').trim();
            const cleanUid = String(req.callerUid || '').trim();
            const result = await messagingService.markRead(convId, cleanUid);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            if (code >= 500) console.error('[MessagingController] Mark read error:', e);
            return res.status(code).json({ success: false, error: e.message });
        }
    },

    async recallMessage(req, res) {
        try {
            const { conversationId, messageId } = req.body || {};
            const convId = String(conversationId || '').trim();
            const msgId = Number(messageId);
            const callerUid = String(req.callerUid || '').trim();

            if (!convId || !msgId) {
                return res.status(400).json({ success: false, error: 'Missing conversationId or messageId' });
            }

            const result = await messagingService.recallMessage(convId, msgId, callerUid);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            if (code >= 500) console.error('[MessagingController] Recall error:', e);
            return res.status(code).json({ success: false, error: e.message });
        }
    },

    async deleteMessage(req, res) {
        try {
            const { conversationId, messageId, deleteConversation } = req.body || {};
            const convId = String(conversationId || '').trim();
            const cleanUid = String(req.callerUid || '').trim();

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
            const code = e.statusCode || 500;
            if (code >= 500) console.error('[MessagingController] Delete error:', e);
            return res.status(code).json({ success: false, error: e.message });
        }
    },

    async setTheme(req, res) {
        try {
            const { conversationId, chatTheme } = req.body || {};
            const convId = String(conversationId || '').trim();
            const callerUid = String(req.callerUid || '').trim();
            if (!convId || !chatTheme) {
                return res.status(400).json({ success: false, error: 'Missing conversationId or chatTheme' });
            }

            const result = await messagingService.setTheme(convId, chatTheme, callerUid);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            return res.status(code).json({ success: false, error: e.message });
        }
    },

    async getTheme(req, res) {
        try {
            const convId = String(req.params.conversationId || '').trim();
            const callerUid = String(req.callerUid || '').trim();
            const result = await messagingService.getTheme(convId, callerUid);
            return res.json(result);
        } catch (e) {
            const code = e.statusCode || 500;
            return res.status(code).json({ success: false, chatTheme: '#EFF1F5', error: e.message });
        }
    }
};

module.exports = messagingController;
