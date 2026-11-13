const { channelManager, getBroadcastTargets } = require('../room.channel.manager');

/**
 * Room Chat Activity (Fast-Lane)
 * 0-DB-Wait O(1) Real-Time Broadcast for In-Room Chat Messages, Media Chat & Typing Indicators.
 * Completely isolated from Stage Seat Lock, MongoDB Persistence, and Gift Transactions.
 */
const roomChatActivity = {
    handleRoomChat(data, ws) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const canonicalRoomId = meta?.canonicalRoomId || channelManager.getCanonicalId(rawRoomId) || rawRoomId;

        if (!canonicalRoomId) return;

        const messageText = String(data.text || data.message || '');
        const mediaUrl = String(data.mediaUrl || '').trim();
        if (messageText.trim().length === 0 && mediaUrl.length === 0) return;

        const chatPacket = {
            type: 'room:chat_receive',
            id: data.id || String(Date.now()),
            roomId: canonicalRoomId,
            rawRoomId,
            senderId: ws?._verifiedUid || data.senderId || meta?.userId || '',
            senderName: data.senderName || meta?.userName || 'User',
            senderAvatar: data.senderAvatar || '',
            text: messageText,
            message: messageText,
            mediaUrl,
            badge: data.badge || '',
            timestamp: Date.now()
        };

        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta);
        channelManager.broadcastToRoomTargets(targets, chatPacket);
    },

    handleRoomTyping(data, ws) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const canonicalRoomId = meta?.canonicalRoomId || channelManager.getCanonicalId(rawRoomId) || rawRoomId;
        if (!canonicalRoomId) return;

        const typingPacket = {
            type: 'room:typing',
            roomId: canonicalRoomId,
            userId: ws?._verifiedUid || data.userId || meta?.userId || '',
            userName: data.userName || meta?.userName || 'User',
            isTyping: Boolean(data.isTyping)
        };

        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta);
        channelManager.broadcastToRoomTargets(targets, typingPacket);
    }
};

module.exports = roomChatActivity;
