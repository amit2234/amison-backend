const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const WalletTransaction = require('../models/Transaction');
const Gift = require('../models/Gift');
const cacheService = require('./cacheService');
const { resolveUser } = require('../utils/userResolver');
const walletExchangeService = require('./walletExchangeService');

// Redis Atomic Lua Script for Sub-Millisecond Gift Transfer
const LUA_ATOMIC_GIFT = `
if redis.call("EXISTS", KEYS[3]) == 1 then
    return {-2, tonumber(redis.call("GET", KEYS[1]) or "0"), tonumber(redis.call("GET", KEYS[2]) or "0")}
end
local senderCoins = tonumber(redis.call("GET", KEYS[1]) or "-1")
if senderCoins < 0 then
    return {-3, 0, 0}
end
local cost = tonumber(ARGV[1])
if senderCoins < cost then
    return {-1, senderCoins, 0}
end
redis.call("SETEX", KEYS[3], tonumber(ARGV[3]), "1")
local newSenderCoins = redis.call("DECRBY", KEYS[1], cost)
local newReceiverDiamonds = redis.call("INCRBY", KEYS[2], tonumber(ARGV[2]))
return {1, newSenderCoins, newReceiverDiamonds}
`;

/**
 * 0-Trust Atomic Gift Transfer Logic
 */
async function sendGift({
    senderId,
    receiverId,
    giftId = '',
    giftCost,
    multiplier = 1,
    roomId = '',
    giftName = '',
    targetMicIndex = -1,
    txId: clientTxId
}) {
    if (!senderId || !receiverId) {
        throw new Error('Missing senderId or receiverId');
    }

    const safeMultiplier = Math.max(1, Math.min(9999, Math.floor(Number(multiplier) || 1)));

    let resolvedGift = null;
    if (giftId) {
        try {
            resolvedGift = await Gift.findOne({ giftId: String(giftId).trim(), isActive: true }).lean();
        } catch (_) {}
    }

    const finalGiftName = (resolvedGift && resolvedGift.name) || giftName || 'Gift';
    const unitCost = (resolvedGift && resolvedGift.coinPrice) || Math.floor(Number(giftCost) || 0);
    const totalCoinCost = Math.floor(Number(unitCost) * safeMultiplier);
    if (totalCoinCost <= 0) {
        throw new Error('Invalid gift cost (0-Trust rejected)');
    }
    const finalIconUrl = (resolvedGift && resolvedGift.iconUrl) || '';
    const finalAnimUrl = (resolvedGift && resolvedGift.animationUrl) || '';
    const finalAnimType = (resolvedGift && resolvedGift.animationType) || 'SVGA_ANIMATION';

    const diamondReward = Math.max(1, Math.floor((totalCoinCost * 70) / 100));
    const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();

    if (!cacheService.checkAndMarkIdempotency(txId)) {
        const error = new Error('Duplicate transaction blocked by 0-Trust guard');
        error.status = 409;
        throw error;
    }

    const senderDoc = await resolveUser(senderId);
    if (!senderDoc) {
        const error = new Error('Sender account not found');
        error.status = 404;
        throw error;
    }
    const receiverDoc = await resolveUser(receiverId);
    const canonicalSenderUid = senderDoc.uid;
    const canonicalReceiverUid = receiverDoc ? receiverDoc.uid : String(receiverId).trim();

    return await cacheService.withUserLock(canonicalSenderUid, async () => {
        // Redis Lua Fast-Path
        const redis = cacheService.redisClient;
        if (redis && redis.status === 'ready') {
            try {
                const luaRes = await redis.eval(
                    LUA_ATOMIC_GIFT,
                    3,
                    `wallet:coins:${canonicalSenderUid}`,
                    `wallet:diamonds:${canonicalReceiverUid}`,
                    `wallet:tx:${txId}`,
                    totalCoinCost,
                    diamondReward,
                    300
                );
                if (Array.isArray(luaRes) && luaRes[0] === -1) {
                    const err = new Error('Insufficient Gold Coins balance');
                    err.remainingCoins = luaRes[1];
                    err.status = 400;
                    throw err;
                }
            } catch (redisErr) {
                if (redisErr.status) throw redisErr;
            }
        }

        // MongoDB WiredTiger Document-Level Atomic Deduction ($inc with $gte guard)
        const isSelfGift = canonicalSenderUid === canonicalReceiverUid;
        const updateOps = isSelfGift
            ? {
                $inc: { coins: -totalCoinCost, diamonds: diamondReward },
                $set: { updatedAt: new Date() }
            }
            : {
                $inc: { coins: -totalCoinCost },
                $set: { updatedAt: new Date() }
            };

        const updatedSender = await User.findOneAndUpdate(
            { uid: canonicalSenderUid, coins: { $gte: totalCoinCost } },
            updateOps,
            { new: true }
        ).lean();

        if (!updatedSender) {
            const latestSender = await User.findOne({ uid: canonicalSenderUid }).lean();
            const currentCoins = latestSender ? (Number(latestSender.coins) || 0) : 0;
            await cacheService.syncWalletCache(canonicalSenderUid, currentCoins, latestSender?.diamonds);
            const err = new Error('Insufficient Gold Coins balance');
            err.remainingCoins = currentCoins;
            err.status = 400;
            throw err;
        }

        let updatedReceiverDiamonds = Number(updatedSender.diamonds) || 0;
        if (!isSelfGift && receiverDoc) {
            const updatedReceiver = await User.findOneAndUpdate(
                { uid: canonicalReceiverUid },
                {
                    $inc: { diamonds: diamondReward },
                    $set: { updatedAt: new Date() }
                },
                { new: true }
            ).lean();
            updatedReceiverDiamonds = updatedReceiver ? (Number(updatedReceiver.diamonds) || 0) : diamondReward;
            await cacheService.syncWalletCache(canonicalReceiverUid, updatedReceiver?.coins, updatedReceiverDiamonds);
        }

        await cacheService.syncWalletCache(canonicalSenderUid, updatedSender.coins, updatedSender.diamonds);

        // Sync with newop_users collection if loaded
        const NewopUserControl = mongoose.models.NewopUserControl;
        if (NewopUserControl) {
            await NewopUserControl.findOneAndUpdate(
                { uid: canonicalSenderUid },
                { $set: { goldCoin: updatedSender.coins, diamond: updatedSender.diamonds, updatedAt: new Date() } },
                { upsert: true }
            ).catch(() => {});
            if (!isSelfGift && receiverDoc) {
                await NewopUserControl.findOneAndUpdate(
                    { uid: canonicalReceiverUid },
                    { $set: { diamond: updatedReceiverDiamonds, updatedAt: new Date() } },
                    { upsert: true }
                ).catch(() => {});
            }
        }

        // Passbook Ledger logging
        WalletTransaction.create({
            txId,
            type: 'GIFT_SEND',
            senderUid: canonicalSenderUid,
            receiverUid: canonicalReceiverUid,
            giftId: String(giftId || ''),
            giftName: finalGiftName,
            multiplier: safeMultiplier,
            coinsDelta: -totalCoinCost,
            diamondsDelta: diamondReward,
            senderCoinsAfter: Number(updatedSender.coins) || 0,
            senderDiamondsAfter: Number(updatedSender.diamonds) || 0,
            roomId: String(roomId || '')
        }).catch(() => {});

        // Broadcast 60fps animation & fly gift to room WebSockets
        if (roomId) {
            try {
                const setupRoomSocket = require('../sockets/roomSocket');
                if (typeof setupRoomSocket.broadcastRoomGift === 'function') {
                    setupRoomSocket.broadcastRoomGift({
                        roomId: String(roomId).trim(),
                        senderId: canonicalSenderUid,
                        senderName: senderDoc.name || 'User',
                        senderAvatar: senderDoc.profilePhoto || senderDoc.avatar || '',
                        receiverId: canonicalReceiverUid,
                        receiverName: receiverDoc ? receiverDoc.name : 'Host',
                        receiverAvatar: receiverDoc ? (receiverDoc.profilePhoto || receiverDoc.avatar || '') : '',
                        targetMicIndex: targetMicIndex !== undefined ? Number(targetMicIndex) : -1,
                        giftId: String(giftId || ''),
                        giftName: finalGiftName,
                        iconUrl: finalIconUrl,
                        animationUrl: finalAnimUrl,
                        animationType: finalAnimType,
                        multiplier: safeMultiplier,
                        timestamp: Date.now()
                    });
                }
            } catch (wsErr) {
                console.warn('[GiftService] WebSocket broadcast error:', wsErr.message);
            }
        }

        return {
            success: true,
            message: 'Gift sent successfully',
            transactionId: txId,
            giftName: finalGiftName,
            remainingCoins: Number(updatedSender.coins) || 0,
            senderDiamonds: Number(updatedSender.diamonds) || 0,
            receiverDiamonds: updatedReceiverDiamonds
        };
    });
}

/**
 * 0-Trust Atomic Multi-Recipient Gift Transfer (All-Mic / Multi-Seat)
 */
async function sendMultiGift({
    senderId,
    recipientIds = [],
    giftId = '',
    costPerRecipient,
    totalCost,
    roomId = '',
    giftName = '',
    txId: clientTxId
}) {
    if (!senderId || !Array.isArray(recipientIds) || recipientIds.length === 0) {
        throw new Error('Invalid multi-gift parameters');
    }

    const cleanRecipients = [...new Set(recipientIds.map(r => String(r).trim()).filter(Boolean))];
    const perUserCost = Math.max(1, Math.floor(Number(costPerRecipient) || (Number(totalCost) / cleanRecipients.length) || 0));
    const computedTotalCost = perUserCost * cleanRecipients.length;
    if (computedTotalCost <= 0) {
        throw new Error('Invalid gift cost');
    }

    const diamondPerRecipient = Math.max(1, Math.floor((perUserCost * 70) / 100));
    const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();

    if (!cacheService.checkAndMarkIdempotency(txId)) {
        const err = new Error('Duplicate multi-gift blocked');
        err.status = 409;
        throw err;
    }

    const senderDoc = await resolveUser(senderId);
    if (!senderDoc) {
        const err = new Error('Sender not found');
        err.status = 404;
        throw err;
    }
    const canonicalSenderUid = senderDoc.uid;

    return await cacheService.withUserLock(canonicalSenderUid, async () => {
        const updatedSender = await User.findOneAndUpdate(
            { uid: canonicalSenderUid, coins: { $gte: computedTotalCost } },
            {
                $inc: { coins: -computedTotalCost },
                $set: { updatedAt: new Date() }
            },
            { new: true }
        ).lean();

        if (!updatedSender) {
            const latest = await User.findOne({ uid: canonicalSenderUid }).lean();
            const err = new Error('Insufficient Gold Coins balance');
            err.remainingCoins = latest ? (Number(latest.coins) || 0) : 0;
            err.status = 400;
            throw err;
        }

        for (const rawRecId of cleanRecipients) {
            const recDoc = await resolveUser(rawRecId);
            if (recDoc) {
                const updatedRec = await User.findOneAndUpdate(
                    { uid: recDoc.uid },
                    { $inc: { diamonds: diamondPerRecipient }, $set: { updatedAt: new Date() } },
                    { new: true }
                ).lean();
                if (updatedRec) {
                    await cacheService.syncWalletCache(updatedRec.uid, updatedRec.coins, updatedRec.diamonds);
                }
            }
        }

        await cacheService.syncWalletCache(canonicalSenderUid, updatedSender.coins, updatedSender.diamonds);

        WalletTransaction.create({
            txId,
            type: 'GIFT_MULTI',
            senderUid: canonicalSenderUid,
            recipientUids: cleanRecipients,
            giftId: String(giftId || ''),
            giftName: String(giftName || ''),
            coinsDelta: -computedTotalCost,
            diamondsDelta: diamondPerRecipient * cleanRecipients.length,
            senderCoinsAfter: Number(updatedSender.coins) || 0,
            senderDiamondsAfter: Number(updatedSender.diamonds) || 0,
            roomId: String(roomId || '')
        }).catch(() => {});

        return {
            success: true,
            message: 'Multi-gift sent successfully',
            transactionId: txId,
            remainingCoins: Number(updatedSender.coins) || 0
        };
    });
}

module.exports = {
    sendGift,
    sendMultiGift,
    convertDiamondsToCoins: walletExchangeService.convertDiamondsToCoins,
    withdrawDiamonds: walletExchangeService.withdrawDiamonds,
    resolveUser
};