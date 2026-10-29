const WebSocket = require('ws');

// In-Memory map to track active connections: userId => WebSocket
const onlineUsers = new Map();

/**
 * Sets up High-Speed Real-Time Chat WebSocket Server on path '/ws/chat'
 * Supports:
 * - 0ms Message delivery between online users
 * - Real-time live typing animation events
 * - Automatic Keepalive Pings (Render 25s keepalive)
 * - Safe disconnect and cleanup
 */
function setupChatSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/chat' });

    console.log('📡 [ChatSocket] Real-Time WebSocket Server initialized on /ws/chat');

    wss.on('connection', (ws, req) => {
        let currentUserId = null;
        let currentConversationId = null;

        ws.on('message', (rawMessage) => {
            try {
                const data = JSON.parse(rawMessage.toString());

                // 1. User joins conversation room
                if (data.type === 'dm:join') {
                    currentUserId = data.userId ? String(data.userId).trim() : null;
                    currentConversationId = data.conversationId;
                    if (currentUserId) {
                        onlineUsers.set(currentUserId, ws);
                        console.log(`[ChatSocket] User online: ${currentUserId}`);
                    }
                }

                // 2. Real-Time Typing Animation Event (Bouncing wave bubble)
                else if (data.type === 'dm:typing') {
                    const recipientId = data.recipientId ? String(data.recipientId).trim() : null;
                    const recipientSocket = recipientId ? onlineUsers.get(recipientId) : null;

                    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                        recipientSocket.send(JSON.stringify({
                            type: 'dm:typing_update',
                            conversationId: data.conversationId,
                            userId: data.senderId,
                            isTyping: Boolean(data.isTyping)
                        }));
                    }
                }

                // 3. Fast Real-Time Message Send
                else if (data.type === 'dm:send') {
                    const recipientId = data.recipientId ? String(data.recipientId).trim() : null;
                    const recipientSocket = recipientId ? onlineUsers.get(recipientId) : null;

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

                    // Send instant ACK back to sender (Double-tick / delivered status)
                    ws.send(JSON.stringify({
                        type: 'dm:ack',
                        clientMessageId: data.clientMessageId,
                        status: 'sent',
                        timestamp: Date.now()
                    }));

                    // Push directly to recipient's active screen in ~10ms
                    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                        recipientSocket.send(JSON.stringify(messagePacket));
                    }
                }

                // 4. Render Keep-Alive Heartbeat Ping/Pong
                else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                }

            } catch (err) {
                console.error('[ChatSocket] Error parsing message:', err.message);
            }
        });

        ws.on('close', () => {
            if (currentUserId) {
                onlineUsers.delete(currentUserId);
                console.log(`[ChatSocket] User disconnected: ${currentUserId}`);
            }
        });

        ws.on('error', (err) => {
            console.warn('[ChatSocket] Socket warning:', err.message);
        });
    });
}

module.exports = setupChatSocket;
