const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles In-Room Live Chat Messages
 */
const roomChatHandler = {
    handleRoomChat(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.roomId || '').trim();

        if (!roomId) return;

        // O(1) Broadcast live chat packet only to room members
        roomChannelManager.broadcastToRoom(roomId, {
            type: 'room:chat_receive',
            roomId,
            senderId: data.senderId || meta?.userId || '',
            senderName: data.senderName || 'User',
            senderAvatar: data.senderAvatar || '',
            text: data.text || data.message || '',
            timestamp: Date.now()
        });
    }
};

module.exports = roomChatHandler;