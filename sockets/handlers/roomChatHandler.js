const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles In-Room Live Chat Messages
 */
const roomChatHandler = {
    handleRoomChat(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const roomId = meta?.canonicalRoomId || roomChannelManager.getCanonicalId(rawRoomId) || rawRoomId;

        if (!roomId) return;

        const messageText = String(data.text || data.message || '');
        const mediaUrl = String(data.mediaUrl || '').trim();
        if (messageText.trim().length === 0 && mediaUrl.length === 0) return;

        const chatPacket = {
            type: 'room:chat_receive',
            id: data.id || String(Date.now()),
            roomId,
            rawRoomId,
            senderId: data.senderId || meta?.userId || '',
            senderName: data.senderName || 'User',
            senderAvatar: data.senderAvatar || '',
            text: messageText,
            message: messageText,
            mediaUrl,
            badge: data.badge || '',
            timestamp: Date.now()
        };

        // O(1) Broadcast live chat packet to room members across both canonical & alias IDs
        roomChannelManager.broadcastToRoom(roomId, chatPacket);
        if (rawRoomId && rawRoomId !== roomId) {
            roomChannelManager.broadcastToRoom(rawRoomId, chatPacket);
        }
    },

    handleRoomTyping(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const roomId = meta?.canonicalRoomId || roomChannelManager.getCanonicalId(rawRoomId) || rawRoomId;
        if (!roomId) return;

        const typingPacket = {
            type: 'room:typing',
            roomId,
            userId: data.userId || meta?.userId || '',
            userName: data.userName || 'User',
            isTyping: Boolean(data.isTyping)
        };
        roomChannelManager.broadcastToRoom(roomId, typingPacket);
    }
};

module.exports = roomChatHandler;
