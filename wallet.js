const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const router = express.Router();

// ============================================================================
// REDIS + IN-MEMORY ATOMIC ENGINE (StarMaker / Bigo Live High-Speed Architecture)
// ============================================================================
let redisClient = null;
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '';

if (REDIS_URL) {
    try {
        const Redis = require('ioredis');
        redisClient = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 2,
            enableReadyCheck: true,
            lazyConnect: false
        });
        redisClient.on('connect', () => console.log('[Wallet Redis] Connected to high-speed Redis cluster'));
        redisClient.on('error', (err) => console.warn('[Wallet Redis] Notice:', err.message));
    } catch (e) {
        console.warn('[Wallet Redis] ioredis initialization skipped, using MongoDB Atomic Engine:', e.message);
    }
}

// In-memory Idempotency & Per-User Lock Queue (Fallback + 1st-layer 0ms Replay Protection)
const processedTxIds = new Map(); // txId -> timestamp
const userLocks = new Map();      // uid -> Promise chain

// Cleanup expired idempotency keys every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of processedTxIds.entries()) {
        if (ts < cutoff) processedTxIds.delete(key);
    }
}, 5 * 60 * 1000);

/**
 * Serializes concurrent operations for the same user on a single Node instance
 * while MongoDB $inc + $gte filter enforces cross-instance atomic safety.
 */
function withUserLock(uid, fn) {
    const prev = userLocks.get(uid) || Promise.resolve();
    const next = prev.then(() => fn()).catch((err) => {
        throw err;
    }).finally(() => {
        if (userLocks.get(uid) === next) {
            userLocks.delete(uid);
        }
    });
    userLocks.set(uid, next);
    return next;
}

// ============================================================================
// REDIS ATOMIC LUA SCRIPTS (0ms Lock-Free Execution)
// ============================================================================
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

// ============================================================================
// MONGOOSE SCHEMA: WALLET TRANSACTIONS LEDGER (Immutable Passbook)
// ============================================================================
const walletTransactionSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true, index: true },
    type: {
        type: String,
        enum: ['GIFT_SEND', 'GIFT_MULTI', 'CONVERT_DIAMOND_TO_COIN', 'WITHDRAW_DIAMOND', 'GUILD_TRANSFER', 'ADMIN_ADJUST'],
        required: true,
        index: true
    },
    senderUid: { type: String, required: true, index: true },
    receiverUid: { type: String, default: '', index: true },
    recipientUids: { type: [String], default: [] },
    giftId: { type: String, default: '' },
    giftName: { type: String, default: '' },
    multiplier: { type: Number, default: 1 },
    coinsDelta: { type: Number, default: 0 },
    diamondsDelta: { type: Number, default: 0 },
    senderCoinsAfter: { type: Number, default: 0 },
    senderDiamondsAfter: { type: Number, default: 0 },
    roomId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'wallet_transactions' });

const WalletTransaction = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);

const getCoreUserModel = () => mongoose.models.User;

/**
 * Warms or updates Redis cache for a user's wallet
 */
async function syncRedisWallet(uid, coins, diamonds) {
    if (!redisClient || redisClient.status !== 'ready' || !uid) return;
    try {
        const pipeline = redisClient.pipeline();
        if (coins !== undefined && coins !== null) {
            pipeline.set(`wallet:coins:${uid}`, Math.max(0, Math.floor(Number(coins) || 0)));
        }
        if (diamonds !== undefined && diamonds !== null) {
            pipeline.set(`wallet:diamonds:${uid}`, Math.max(0, Math.floor(Number(diamonds) || 0)));
        }
        await pipeline.exec();
    } catch (e) {
        // non-fatal
    }
}

/**
 * Resolves a user document by Permanent Auth UID or 9-digit numericId
 */
async function resolveUserByUidOrNumericId(User, rawId) {
    if (!rawId) return null;
    const clean = String(rawId).trim();
    const numId = Number(clean);
    const query = (!isNaN(numId) && numId > 0 && /^\d+$/.test(clean))
        ? { $or: [{ uid: clean }, { numericId: numId }] }
        : { uid: clean };
    return await User.findOne(query).lean();
}

/**
 * Checks 0-Trust Idempotency to block Replay Attacks / duplicate rapid clicks
 */
function checkAndMarkIdempotency(txId) {
    if (!txId) return true;
    if (processedTxIds.has(txId)) {
        return false;
    }
    processedTxIds.set(txId, Date.now());
    return true;
}

// ============================================================================
// 1. GET /api/wallet/:uid
// Returns authoritative Coins & Diamonds balance for Login & Me -> Wallet
// ============================================================================
router.get('/wallet/:uid', async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) return res.status(500).json({ success: false, error: 'User model not ready' });

        const user = await resolveUserByUidOrNumericId(User, req.params.uid);
        if (!user) {
            return res.status(404).json({ success: false, coins: 0, diamonds: 0, error: 'User not found' });
        }

        const coins = Math.max(0, Number(user.coins) || 0);
        const diamonds = Math.max(0, Number(user.diamonds) || 0);

        syncRedisWallet(user.uid, coins, diamonds);

        return res.json({
            success: true,
            uid: user.uid,
            numericId: user.numericId,
            coins,
            diamonds
        });
    } catch (e) {
        console.error('[Wallet Engine] GET /wallet/:uid error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 2. POST /api/gift/send
// 0-Trust Atomic Gift Transaction (1s Multiple Combo Gifting Safe)
// ============================================================================
router.post('/gift/send', async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) return res.status(500).json({ success: false, message: 'Server database initializing' });

        const {
            senderId,
            receiverId,
            giftId,
            giftCost,
            multiplier = 1,
            roomId = '',
            giftName = '',
            txId: clientTxId
        } = req.body;

        if (!senderId || !receiverId) {
            return res.status(400).json({ success: false, message: 'Missing senderId or receiverId' });
        }

        const safeMultiplier = Math.max(1, Math.min(9999, Math.floor(Number(multiplier) || 1)));
        const rawCost = Math.floor(Number(giftCost) || 0);
        if (rawCost <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid gift cost (0-Trust rejected)' });
        }

        const totalCoinCost = rawCost;
        const diamondReward = Math.max(1, Math.floor((totalCoinCost * 70) / 100));

        const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();
        if (!checkAndMarkIdempotency(txId)) {
            return res.status(409).json({ success: false, message: 'Duplicate transaction blocked by 0-Trust guard' });
        }

        const senderDoc = await resolveUserByUidOrNumericId(User, senderId);
        if (!senderDoc) {
            return res.status(404).json({ success: false, message: 'Sender account not found' });
        }
        const receiverDoc = await resolveUserByUidOrNumericId(User, receiverId);
        const canonicalSenderUid = senderDoc.uid;
        const canonicalReceiverUid = receiverDoc ? receiverDoc.uid : String(receiverId).trim();

        const result = await withUserLock(canonicalSenderUid, async () => {
            if (redisClient && redisClient.status === 'ready') {
                try {
                    const luaRes = await redisClient.eval(
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
                        return {
                            ok: false,
                            code: 'INSUFFICIENT_FUNDS',
                            remainingCoins: luaRes[1]
                        };
                    }
                } catch (redisErr) {
                    // Fallback seamlessly to MongoDB Atomic Engine
                }
            }

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
                await syncRedisWallet(canonicalSenderUid, currentCoins, latestSender?.diamonds);
                return {
                    ok: false,
                    code: 'INSUFFICIENT_FUNDS',
                    remainingCoins: currentCoins
                };
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
                await syncRedisWallet(canonicalReceiverUid, updatedReceiver?.coins, updatedReceiverDiamonds);
            }

            await syncRedisWallet(canonicalSenderUid, updatedSender.coins, updatedSender.diamonds);

            const NewopUserControl = mongoose.models.NewopUserControl;
            if (NewopUserControl) {
                await NewopUserControl.findOneAndUpdate(
                    { uid: canonicalSenderUid },
                    { $set: { goldCoin: updatedSender.coins, diamond: updatedSender.diamonds, updatedAt: new Date() } },
                    { upsert: true }
                );
                if (!isSelfGift && receiverDoc) {
                    await NewopUserControl.findOneAndUpdate(
                        { uid: canonicalReceiverUid },
                        { $set: { diamond: updatedReceiverDiamonds, updatedAt: new Date() } },
                        { upsert: true }
                    );
                }
            }

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
                ok: true,
                remainingCoins: Number(updatedSender.coins) || 0,
                senderDiamonds: Number(updatedSender.diamonds) || 0,
                receiverDiamonds: updatedReceiverDiamonds
            };
        });

        if (!result.ok) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient Gold Coins balance',
                remainingCoins: result.remainingCoins
            });
        }

        return res.json({
            success: true,
            message: 'Gift sent successfully',
            transactionId: txId,
            remainingCoins: result.remainingCoins,
            senderDiamonds: result.senderDiamonds,
            receiverDiamonds: result.receiverDiamonds
        });
    } catch (e) {
        console.error('[Wallet Engine] POST /gift/send error:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================================
// 3. POST /api/gift/send-multi
// 0-Trust Atomic Multi-Recipient Gift (All-Mic / Multi-Seat Combo Gifting)
// ============================================================================
router.post('/gift/send-multi', async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) return res.status(500).json({ success: false, message: 'Server database initializing' });

        const {
            senderId,
            recipientIds = [],
            giftId = '',
            costPerRecipient,
            totalCost,
            roomId = '',
            giftName = '',
            txId: clientTxId
        } = req.body;

        if (!senderId || !Array.isArray(recipientIds) || recipientIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid multi-gift parameters' });
        }

        const cleanRecipients = [...new Set(recipientIds.map(r => String(r).trim()).filter(Boolean))];
        const perUserCost = Math.max(1, Math.floor(Number(costPerRecipient) || (Number(totalCost) / cleanRecipients.length) || 0));
        const computedTotalCost = perUserCost * cleanRecipients.length;
        if (computedTotalCost <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid gift cost' });
        }

        const diamondPerRecipient = Math.max(1, Math.floor((perUserCost * 70) / 100));
        const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();
        if (!checkAndMarkIdempotency(txId)) {
            return res.status(409).json({ success: false, message: 'Duplicate multi-gift blocked' });
        }

        const senderDoc = await resolveUserByUidOrNumericId(User, senderId);
        if (!senderDoc) {
            return res.status(404).json({ success: false, message: 'Sender not found' });
        }
        const canonicalSenderUid = senderDoc.uid;

        const result = await withUserLock(canonicalSenderUid, async () => {
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
                return { ok: false, remainingCoins: latest ? (Number(latest.coins) || 0) : 0 };
            }

            for (const rawRecId of cleanRecipients) {
                const recDoc = await resolveUserByUidOrNumericId(User, rawRecId);
                if (recDoc) {
                    const updatedRec = await User.findOneAndUpdate(
                        { uid: recDoc.uid },
                        { $inc: { diamonds: diamondPerRecipient }, $set: { updatedAt: new Date() } },
                        { new: true }
                    ).lean();
                    if (updatedRec) {
                        await syncRedisWallet(updatedRec.uid, updatedRec.coins, updatedRec.diamonds);
                    }
                }
            }

            await syncRedisWallet(canonicalSenderUid, updatedSender.coins, updatedSender.diamonds);

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

            return { ok: true, remainingCoins: Number(updatedSender.coins) || 0 };
        });

        if (!result.ok) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient Gold Coins balance',
                remainingCoins: result.remainingCoins
            });
        }

        return res.json({
            success: true,
            message: 'Multi-gift sent successfully',
            transactionId: txId,
            remainingCoins: result.remainingCoins
        });
    } catch (e) {
        console.error('[Wallet Engine] POST /gift/send-multi error:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================================
// 4. POST /api/wallet/convert
// 0-Trust Atomic Conversion: Diamonds -> Gold Coins (Me -> Wallet -> Convert)
// ============================================================================
router.post('/wallet/convert', async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) return res.status(500).json({ success: false, message: 'Server database initializing' });

        const { uid, diamondsToConvert, txId: clientTxId } = req.body;
        const diamonds = Math.floor(Number(diamondsToConvert) || 0);
        if (!uid || diamonds <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid conversion amount' });
        }

        const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();
        if (!checkAndMarkIdempotency(txId)) {
            return res.status(409).json({ success: false, message: 'Duplicate conversion request blocked' });
        }

        const userDoc = await resolveUserByUidOrNumericId(User, uid);
        if (!userDoc) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const coinsGained = Math.max(1, Math.floor((diamonds * 70) / 100));

        const updatedUser = await withUserLock(userDoc.uid, async () => {
            return await User.findOneAndUpdate(
                { uid: userDoc.uid, diamonds: { $gte: diamonds } },
                {
                    $inc: { diamonds: -diamonds, coins: coinsGained },
                    $set: { updatedAt: new Date() }
                },
                { new: true }
            ).lean();
        });

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Insufficient Diamonds balance' });
        }

        await syncRedisWallet(updatedUser.uid, updatedUser.coins, updatedUser.diamonds);

        const NewopUserControl = mongoose.models.NewopUserControl;
        if (NewopUserControl) {
            await NewopUserControl.findOneAndUpdate(
                { uid: updatedUser.uid },
                { $set: { goldCoin: updatedUser.coins, diamond: updatedUser.diamonds, updatedAt: new Date() } },
                { upsert: true }
            );
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

        return res.json({
            success: true,
            transactionId: txId,
            coins: Number(updatedUser.coins) || 0,
            diamonds: Number(updatedUser.diamonds) || 0,
            coinsGained
        });
    } catch (e) {
        console.error('[Wallet Engine] POST /wallet/convert error:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================================
// 5. POST /api/wallet/withdraw
// 0-Trust Atomic Diamond Withdrawal (Me -> Wallet -> Withdraw)
// ============================================================================
router.post('/wallet/withdraw', async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) return res.status(500).json({ success: false, message: 'Server database initializing' });

        const { uid, diamondsToWithdraw, method = 'UPI', txId: clientTxId } = req.body;
        const diamonds = Math.floor(Number(diamondsToWithdraw) || 0);
        if (!uid || diamonds <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' });
        }

        const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();
        if (!checkAndMarkIdempotency(txId)) {
            return res.status(409).json({ success: false, message: 'Duplicate withdrawal request blocked' });
        }

        const userDoc = await resolveUserByUidOrNumericId(User, uid);
        if (!userDoc) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const updatedUser = await withUserLock(userDoc.uid, async () => {
            return await User.findOneAndUpdate(
                { uid: userDoc.uid, diamonds: { $gte: diamonds } },
                {
                    $inc: { diamonds: -diamonds },
                    $set: { updatedAt: new Date() }
                },
                { new: true }
            ).lean();
        });

        if (!updatedUser) {
            return res.status(400).json({ success: false, message: 'Insufficient Diamonds balance' });
        }

        await syncRedisWallet(updatedUser.uid, updatedUser.coins, updatedUser.diamonds);

        const NewopUserControl = mongoose.models.NewopUserControl;
        if (NewopUserControl) {
            await NewopUserControl.findOneAndUpdate(
                { uid: updatedUser.uid },
                { $set: { goldCoin: updatedUser.coins, diamond: updatedUser.diamonds, updatedAt: new Date() } },
                { upsert: true }
            );
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

        return res.json({
            success: true,
            transactionId: txId,
            coins: Number(updatedUser.coins) || 0,
            diamonds: Number(updatedUser.diamonds) || 0
        });
    } catch (e) {
        console.error('[Wallet Engine] POST /wallet/withdraw error:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = {
    router,
    syncRedisWallet
};
