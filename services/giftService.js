const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const WalletTransaction = require('../models/Transaction');
const cacheService = require('./cacheService');

// Redis Atomic Lua Script for Sub-Millisecond Gift Transfer
// KEYS[1]: wallet:coins:{senderUid}
// KEYS[2]: wallet:diamonds:{receiverUid}
// KEYS[3]: wallet:tx:{txId}
// ARGV[1]: coinCost, ARGV[2]: diamondReward, ARGV[3]: ttlSeconds
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
 * Resolves a user document by Permanent Auth UID or 9-digit numericId
 */
async function resolveUser(rawId) {
    if (!rawId) return null;
    const clean = String(rawId).trim();
    const numId = Number(clean);
    const query = (!isNaN(numId) && numId > 0 && /^\d+$/.test(clean))
        ? { $or: [{ uid: clean }, { numericId: numId }] }
        : { uid: clean };
    return await User.findOne(query).lean();
}

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
    txId: clientTxId
}) {
    if (!senderId || !receiverId) {
        throw new Error('Missing senderId or receiverId');
    }

    const safeMultiplier = Math.max(1, Math.min(9999, Math.floor(Number(multiplier) || 1)));
    const rawCost = Math.floor(Number(giftCost) || 0);
    if (rawCost <= 0) {
        throw new Error('Invalid gift cost (0-Trust rejected)');
    }

    const totalCoinCost = rawCost;
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
        // Optional Redis Lua Fast-Path
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
                // fallback to MongoDB Atomic Engine
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

        // Write immutable Passbook Ledger record asynchronously
        WalletTransaction.create({
            txId,
            type: 'GIFT_SEND',
            senderUid: canonicalSenderUid,
            receiverUid: canonicalReceiverUid,
            giftId: String(giftId || ''),
            giftName: String(giftName || ''),
            multiplier: safeMultiplier,
            coinsDelta: -totalCoinCost,
            diamondsDelta: diamondReward,
            senderCoinsAfter: Number(updatedSender.coins) || 0,
            senderDiamondsAfter: Number(updatedSender.diamonds) || 0,
            roomId: String(roomId || '')
        }).catch(() => {});

        return {
            success: true,
            message: 'Gift sent successfully',
            transactionId: txId,
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

        // Credit each recipient atomically
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

/**
 * 0-Trust Atomic Diamond to Coin Conversion
 */
async function convertDiamondsToCoins({ uid, diamondsToConvert, txId: clientTxId }) {
    const diamonds = Math.floor(Number(diamondsToConvert) || 0);
    if (!uid || diamonds <= 0) {
        throw new Error('Invalid conversion amount');
    }

    const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();
    if (!cacheService.checkAndMarkIdempotency(txId)) {
        const err = new Error('Duplicate conversion request blocked');
        err.status = 409;
        throw err;
    }

    const userDoc = await resolveUser(uid);
    if (!userDoc) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }

    const coinsGained = Math.max(1, Math.floor((diamonds * 70) / 100));

    return await cacheService.withUserLock(userDoc.uid, async () => {
        const updatedUser = await User.findOneAndUpdate(
            { uid: userDoc.uid, diamonds: { $gte: diamonds } },
            {
                $inc: { diamonds: -diamonds, coins: coinsGained },
                $set: { updatedAt: new Date() }
            },
            { new: true }
        ).lean();

        if (!updatedUser) {
            const err = new Error('Insufficient Diamonds balance');
            err.status = 400;
            throw err;
        }

        await cacheService.syncWalletCache(updatedUser.uid, updatedUser.coins, updatedUser.diamonds);

        const NewopUserControl = mongoose.models.NewopUserControl;
        if (NewopUserControl) {
            await NewopUserControl.findOneAndUpdate(
                { uid: updatedUser.uid },
                { $set: { goldCoin: updatedUser.coins, diamond: updatedUser.diamonds, updatedAt: new Date() } },
                { upsert: true }
            ).catch(() => {});
        }

        WalletTransaction.create({
            txId,
            type: 'CONVERT_DIAMOND_TO_COIN',
            senderUid: updatedUser.uid,
            receiverUid: updatedUser.uid,
            coinsDelta: coinsGained,
            diamondsDelta: -diamonds,
            senderCoinsAfter: Number(updatedUser.coins) || 0,
            senderDiamondsAfter: Number(updatedUser.diamonds) || 0
        }).catch(() => {});

        return {
            success: true,
            transactionId: txId,
            coins: Number(updatedUser.coins) || 0,
            diamonds: Number(updatedUser.diamonds) || 0,
            coinsGained
        };
    });
}

/**
 * 0-Trust Atomic Diamond Withdrawal
 */
async function withdrawDiamonds({ uid, diamondsToWithdraw, method = 'UPI', txId: clientTxId }) {
    const diamonds = Math.floor(Number(diamondsToWithdraw) || 0);
    if (!uid || diamonds <= 0) {
        throw new Error('Invalid withdrawal amount');
    }

    const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();
    if (!cacheService.checkAndMarkIdempotency(txId)) {
        const err = new Error('Duplicate withdrawal request blocked');
        err.status = 409;
        throw err;
    }

    const userDoc = await resolveUser(uid);
    if (!userDoc) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }

    return await cacheService.withUserLock(userDoc.uid, async () => {
        const updatedUser = await User.findOneAndUpdate(
            { uid: userDoc.uid, diamonds: { $gte: diamonds } },
            {
                $inc: { diamonds: -diamonds },
                $set: { updatedAt: new Date() }
            },
            { new: true }
        ).lean();

        if (!updatedUser) {
            const err = new Error('Insufficient Diamonds balance');
            err.status = 400;
            throw err;
        }

        await cacheService.syncWalletCache(updatedUser.uid, updatedUser.coins, updatedUser.diamonds);

        const NewopUserControl = mongoose.models.NewopUserControl;
        if (NewopUserControl) {
            await NewopUserControl.findOneAndUpdate(
                { uid: updatedUser.uid },
                { $set: { goldCoin: updatedUser.coins, diamond: updatedUser.diamonds, updatedAt: new Date() } },
                { upsert: true }
            ).catch(() => {});
        }

        WalletTransaction.create({
            txId,
            type: 'WITHDRAW_DIAMOND',
            senderUid: updatedUser.uid,
            coinsDelta: 0,
            diamondsDelta: -diamonds,
            senderCoinsAfter: Number(updatedUser.coins) || 0,
            senderDiamondsAfter: Number(updatedUser.diamonds) || 0
        }).catch(() => {});

        return {
            success: true,
            transactionId: txId,
            coins: Number(updatedUser.coins) || 0,
            diamonds: Number(updatedUser.diamonds) || 0
        };
    });
}

module.exports = {
    sendGift,
    sendMultiGift,
    convertDiamondsToCoins,
    withdrawDiamonds,
    resolveUser
};