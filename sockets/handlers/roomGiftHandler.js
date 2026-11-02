const giftService = require('../../services/giftService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles In-Room Real-Time Gifting Execution and Animation Triggering
 */
const roomGiftHandler = {
    async handleSendGift(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.roomId || '').trim();
        const senderUid = String(data.senderId || meta?.userId || '').trim();

        try {
            const result = await giftService.sendGift({
                senderId: senderUid,
                receiverId: data.receiverId,
                giftId: data.giftId,
                giftCost: data.giftCost || data.coinCost,
                multiplier: data.multiplier || 1,
                roomId,
                giftName: data.giftName,
                targetMicIndex: data.targetMicIndex !== undefined ? data.targetMicIndex : -1,
                txId: data.txId
            });

            ws.send(JSON.stringify({
                type: 'gift:ack',
                success: true,
                transactionId: result.transactionId,
                remainingCoins: result.remainingCoins,
                giftId: data.giftId
            }));
        } catch (giftErr) {
            console.warn('[RoomGiftHandler] Gift execution failed:', giftErr.message);
            ws.send(JSON.stringify({
                type: 'gift:ack',
                success: false,
                error: giftErr.message,
                remainingCoins: giftErr.remainingCoins
            }));
        }
    }
};

module.exports = roomGiftHandler;