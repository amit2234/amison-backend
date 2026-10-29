const WebSocket = require('ws');

// Online users ka record rakhne ke liye map
const onlineUsers = new Map();

function setupChatSocket(server) {
    // 1. WebSocket server create karo '/ws/chat' path par
    const wss = new WebSocket.Server({ server, path: '/ws/chat' });

    console.log('📡 WebSocket Server initialized on path /ws/chat');

    wss.on('connection', (ws) => {
        let currentUserId = null;
        let currentConvId = null;

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());

                // 1. User ne chat join ki
                if (data.type === 'dm:join') {
                    currentUserId = data.userId;
                    currentConvId = data.conversationId;
                    onlineUsers.set(currentUserId, ws);
                    console.log(`✅ User online: ${currentUserId}`);
                }

                // 2. User typing kar raha hai (Live Animation)
                else if (data.type === 'dm:typing') {
                    const receiverSocket = onlineUsers.get(data.recipientId);
                    if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
                        receiverSocket.send(JSON.stringify({
                            type: 'dm:typing_update',
                            conversationId: data.conversationId,
                            userId: data.senderId,
                            isTyping: data.isTyping
                        }));
                    }
                }

                // 3. User ne message send kiya
                else if (data.type === 'dm:send') {
                    const receiverSocket = onlineUsers.get(data.recipientId);

                    const packet = {
                        type: 'dm:receive',
                        conversationId: data.conversationId,
                        senderId: data.senderId,
                        senderName: data.senderName,
                        senderAvatar: data.senderAvatar,
                        text: data.text,
                        timestamp: Date.now()
                    };

                    // Sender ko confirmation bhejo
                    ws.send(JSON.stringify({
                        type: 'dm:ack',
                        status: 'sent',
                        timestamp: Date.now()
                    }));

                    // Receiver ko turant message push karo
                    if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
                        receiverSocket.send(JSON.stringify(packet));
                    }
                }

                // 4. Render keepalive ping
                else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }

            } catch (err) {
                console.error('Socket message parse error:', err);
            }
        });

        ws.on('close', () => {
            if (currentUserId) {
                onlineUsers.delete(currentUserId);
                console.log(`❌ User offline: ${currentUserId}`);
            }
        });
    });
}

module.exports = setupChatSocket;
