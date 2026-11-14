const WebSocket = require('ws');
const messagingCache = require('./messaging.cache');
const messagingService = require('./messaging.service');
const { verifyWebSocketConnection } = require('../../middleware/authMiddleware');
const { OFFICIAL_SENDER_ID } = require('./messaging.constants');

/**
 * Dedicated 1-to-1 Personal Chat & Online Presence WebSocket Gateway
 * Path: '/ws/chat' (Multiplexed via server.on('upgrade') with noServer: true)
 */
function setupChatSocket(server) {
    const wss = new WebSocket.Server({ noServer: true });
    console.log('📡 [MessagingSocket] Dedicated 1-to-1 Personal Chat & Online Presence Server running on /ws/chat');

    wss.on('connection', (ws, req) => {
        let currentUserId = null;
        let currentConversationId = null;
        ws._verifiedUid = '';

        ws._authPromise = verifyWebSocketConnection(req, { requireMongoUser: true })
            .then(({ verifiedUid }) => {
                ws._verifiedUid = verifiedUid;
                currentUserId = verifiedUid;
                messagingCache.setUserOnline(currentUserId, ws);
                console.log(`[MessagingSocket] Verified user online: ${currentUserId}`);
                return verifiedUid;
            })
            .catch((authErr) => {
                console.warn('[MessagingSocket] Rejected unauthorized socket:', authErr?.message || authErr);
                try { ws.close(4001, 'Unauthorized'); } catch (_) {}
                return '';
            });

        ws.on('message', async (rawMessage) => {
            try {
                if (ws._authPromise) {
                    await ws._authPromise;
                }
                if (!ws._verifiedUid) {
                    try { ws.close(4001, 'Unauthorized'); } catch (_) {}
                    return;
                }
                currentUserId = ws._verifiedUid;

                const rawStr = rawMessage.toString().trim();
                if (rawStr === 'ping') {
                    ws.send('pong');
                    return;
                }
                if (rawStr === 'pong') return;

                const data = JSON.parse(rawStr);

                // 1. User joins conversation room or registers (strictly bound to verifiedUid)
                if (data.type === 'dm:join' || data.type === 'user:register' || data.type === 'auth:register') {
                    currentConversationId = data.conversationId || currentConversationId;
                    messagingCache.setUserOnline(currentUserId, ws);
                }

                // 2. Real-Time Typing Indicator Event
                else if (data.type === 'dm:typing') {
                    const recipientId = await messagingService.resolveCanonicalUid(data.recipientId);
                    if (recipientId && recipientId !== OFFICIAL_SENDER_ID) {
                        messagingCache.emitToUser(recipientId, {
                            type: 'dm:typing_update',
                            conversationId: data.conversationId || currentConversationId || '',
                            userId: currentUserId,
                            isTyping: Boolean(data.isTyping)
                        });
                    }
                }

                // 3. Fast 1-to-1 Real-Time Message Send (with mediaUrl + reply forwarding)
                else if (data.type === 'dm:send') {
                    const recipientId = await messagingService.resolveCanonicalUid(data.recipientId);
                    const numericId = Number(data.id) || Number(data.clientMessageId) || Date.now();
                    const cleanMedia = String(data.mediaUrl || data.imageUrl || '').trim();
                    const convId = messagingService.buildConversationId(currentUserId, recipientId || '');

                    const messagePacket = {
                        type: 'dm:receive',
                        id: numericId,
                        messageId: String(data.clientMessageId || numericId),
                        conversationId: convId || data.conversationId || '',
                        senderId: currentUserId,
                        senderName: String(data.senderName || 'User').trim(),
                        senderAvatar: String(data.senderAvatar || '').trim(),
                        text: String(data.text || ''),
                        mediaUrl: cleanMedia,
                        imageUrl: cleanMedia,
                        isPrivatePhoto: Boolean(data.isPrivatePhoto),
                        replyToUser: String(data.replyToUser || ''),
                        replyToText: String(data.replyToText || ''),
                        messageType: data.messageType || 'text',
                        timestamp: Number(data.timestamp) || Date.now()
                    };

                    ws.send(JSON.stringify({
                        type: 'dm:ack',
                        clientMessageId: data.clientMessageId,
                        status: 'sent',
                        timestamp: Date.now()
                    }));

                    if (recipientId && recipientId !== OFFICIAL_SENDER_ID && recipientId !== currentUserId) {
                        messagingCache.emitToUser(recipientId, messagePacket);
                    }
                }

                // 4. Online Status Query
                else if (data.type === 'user:status_check') {
                    const targetId = await messagingService.resolveCanonicalUid(data.targetUserId);
                    const isOnline = targetId ? messagingCache.isUserOnline(targetId) : false;
                    ws.send(JSON.stringify({
                        type: 'user:status_result',
                        targetUserId: targetId,
                        isOnline
                    }));
                }

                // 5. Keep-Alive Heartbeat Ping/Pong
                else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                }
            } catch (err) {
                console.error('[MessagingSocket] Error parsing message:', err.message);
            }
        });

        ws.on('close', () => {
            if (currentUserId && messagingCache.getOnlineUserSocket(currentUserId) === ws) {
                messagingCache.removeUserOnline(currentUserId);
            }
        });

        ws.on('error', (err) => {
            console.warn('[MessagingSocket] Socket warning:', err.message);
        });
    });

    return wss;
}

setupChatSocket.emitToUser = messagingCache.emitToUser;

module.exports = { setupChatSocket };
