const giftService = require('../../../services/giftService');
const { channelManager, getBroadcastTargets } = require('../room.channel.manager');

/**
 * Room Gift Activity (Isolated Wallet & Animation Execution)
 * Failures here reply only to sender with `gift:ack` and never affect Chat, Seats, or Locks.
 */
const roomGiftActivity = {
    async handleSendGift(data, ws) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const canonicalRoomId = meta?.canonicalRoomId || channelManager.getCanonicalId(rawRoomId) || rawRoomId;
        const senderUid = String(ws?._verifiedUid || data.senderId || meta?.userId || '').trim();

        try {
            const result = await giftService.sendGift({
                senderId: senderUid,
                receiverId: data.receiverId,
                giftId: data.giftId,
                giftCost: data.giftCost || data.coinCost,
                multiplier: data.multiplier || 1,
                roomId: canonicalRoomId,
                giftName: data.giftName,
                targetMicIndex: data.targetMicIndex !== undefined ? data.targetMicIndex : -1,
                txId: data.txId
            });

            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'gift:ack',
                    success: true,
                    transactionId: result.transactionId,
                    remainingCoins: result.remainingCoins,
                    giftId: data.giftId
                }));
            }
        } catch (giftErr) {
            console.warn('[RoomGiftActivity] Gift execution failed:', giftErr.message);
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'gift:ack',
                    success: false,
                    error: giftErr.message,
                    remainingCoins: giftErr.remainingCoins
                }));
            }
        }
    },

    broadcastRoomGift(payload = {}) {
        const rawRoomId = String(payload.roomId || '').trim();
        if (!rawRoomId) return;
        const canonicalRoomId = channelManager.getCanonicalId(rawRoomId) || rawRoomId;

        const giftPacket = {
            type: 'room:gift_broadcast',
            roomId: canonicalRoomId,
            senderId: payload.senderId,
            senderName: payload.senderName,
            senderAvatar: payload.senderAvatar,
            receiverId: payload.receiverId,
            receiverName: payload.receiverName,
            receiverAvatar: payload.receiverAvatar,
            targetMicIndex: payload.targetMicIndex !== undefined ? payload.targetMicIndex : -1,
            giftId: payload.giftId,
            giftName: payload.giftName,
            iconUrl: payload.iconUrl,
            animationUrl: payload.animationUrl,
            animationType: payload.animationType,
            multiplier: payload.multiplier || 1,
            timestamp: payload.timestamp || Date.now()
        };

        const chatPacket = {
            type: 'room:chat_receive',
            roomId: canonicalRoomId,
            senderId: payload.senderId,
            senderName: payload.senderName,
            senderAvatar: payload.senderAvatar,
            text: `sent ${payload.giftName || 'Gift'} x${payload.multiplier || 1} to ${payload.receiverName || 'Host'}`,
            isGiftNotice: true,
            giftIcon: payload.iconUrl,
            timestamp: Date.now()
        };

        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId);
        channelManager.broadcastToRoomTargets(targets, giftPacket);
        channelManager.broadcastToRoomTargets(targets, chatPacket);
    }
};

module.exports = roomGiftActivity;
