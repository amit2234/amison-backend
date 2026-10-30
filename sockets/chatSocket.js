const WebSocket = require('ws');
const cacheService = require('../services/cacheService');

/**
 * Dedicated 1-to-1 Personal Chat & Online Presence WebSocket Server
 * Path: '/ws/chat'
 */
function setupChatSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/chat' });
    console.log('📡 [ChatSocket] Dedicated 1-to-1 Personal Chat & Online Presence Server running on /ws/chat');

    wss.on('connection', (ws, req) => {
        let currentUserId = null;
        let currentConversationId = null;

        try {
            const urlObj = new URL(req.url, 'http://localhost');
            const queryUserId = urlObj.searchParams.get('userId');
            const headerUserId = req.headers['x-user-id'];
            currentUserId = (queryUserId || headerUserId || '').trim();
            if (currentUserId) {
                cacheService.setUserOnline(currentUserId, ws);
                console.log(`[ChatSocket] User registered online: ${currentUserId}`);
            }
        } catch (e) {
            console.error('[ChatSocket] Error parsing connection request:', e.message);
        }

        ws.on('message', async (rawMessage) => {
            try {
                const data = JSON.parse(rawMessage.toString());

                // 0. General user registration / association
                if (data.userId && !currentUserId) {
                    currentUserId = String(data.userId).trim();
                    cacheService.setUserOnline(currentUserId, ws);
                }

                // 1. User joins conversation room or registers
                if (data.type === 'dm:join' || data.type === 'user:register' || data.type === 'auth:register') {
                    currentUserId = data.userId ? String(data.userId).trim() : currentUserId;
                    currentConversationId = data.conversationId || currentConversationId;
                    if (currentUserId) {
                        cacheService.setUserOnline(currentUserId, ws);
                    }
                }

                // 2. Real-Time Typing Indicator Event
                else if (data.type === 'dm:typing') {
                    const recipientId = data.recipientId ? String(data.recipientId).trim() : null;
                    const recipientSocket = recipientId ? cacheService.getOnlineUserSocket(recipientId) : null;

                    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                        recipientSocket.send(JSON.stringify({
                            type: 'dm:typing_update',
                            conversationId: data.conversationId,
                            userId: data.senderId,
                            isTyping: Boolean(data.isTyping)
                        }));
                    }
                }

                // 3. Fast 1-to-1 Real-Time Message Send
                else if (data.type === 'dm:send') {
                    const recipientId = data.recipientId ? String(data.recipientId).trim() : null;
                    const recipientSocket = recipientId ? cacheService.getOnlineUserSocket(recipientId) : null;

                    const messagePacket = {
                        type: 'dm:receive',
                        messageId: data.clientMessageId || `${Date.now()}`,
                        conversationId: data.conversationId,
                        senderId: data.senderId,
                        senderName: data.senderName || 'User',
                        senderAvatar: data.senderAvatar || '',
                        text: data.text || '',
                        messageType: data.messageType || 'text',
                        timestamp: data.timestamp || Date.now()
                    };

                    ws.send(JSON.stringify({
                        type: 'dm:ack',
                        clientMessageId: data.clientMessageId,
                        status: 'sent',
                        timestamp: Date.now()
                    }));

                    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                        recipientSocket.send(JSON.stringify(messagePacket));
                    }
                }

                // 4. Online Status Query
                else if (data.type === 'user:status_check') {
                    const targetId = data.targetUserId ? String(data.targetUserId).trim() : null;
                    const isOnline = targetId ? cacheService.isUserOnline(targetId) : false;
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
                console.error('[ChatSocket] Error parsing message:', err.message);
            }
        });

        ws.on('close', () => {
            if (currentUserId) {
                cacheService.removeUserOnline(currentUserId);
            }
        });

        ws.on('error', (err) => {
            console.warn('[ChatSocket] Socket warning:', err.message);
        });
    });
}

/**
 * Direct real-time unicast to a specific user UID's connected WebSocket
 */
setupChatSocket.emitToUser = cacheService.emitToUser;

module.exports = setupChatSocket;