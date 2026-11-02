const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const MerchantTransaction = require('../models/MerchantTransaction');
const WalletTransaction = require('../models/Transaction');
const cacheService = require('./cacheService');
const { resolveUser } = require('../utils/userResolver');

const merchantService = {
    /**
     * Get all registered Merchants & Sellers for Newop Management
     */
    async getAllMerchants({ role, status } = {}) {
        const query = {};
        if (role) query.role = role.toLowerCase();
        if (status) {
            query.status = status.toLowerCase();
        } else {
            query.status = { $ne: 'revoked' };
        }
        return await Merchant.find(query).sort({ updatedAt: -1 }).lean();
    },

    /**
     * Promote a user to Seller or Marchent role in MongoDB
     */
    async addOrUpdateMerchant({ userId, role = 'seller', assignedBy = 'Super Master' }) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) {
            throw new Error(`User not found with ID: ${userId}`);
        }

        const validRole = role.toLowerCase() === 'marchent' ? 'marchent' : 'seller';

        const updated = await Merchant.findOneAndUpdate(
            { userId: userDoc.uid },
            {
                $set: {
                    userId: userDoc.uid,
                    numericId: String(userDoc.numericId),
                    name: userDoc.name || 'User',
                    avatarUrl: userDoc.avatarUrl || '',
                    role: validRole,
                    status: 'active',
                    assignedBy,
                    updatedAt: new Date()
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return updated;
    },

    /**
     * Revoke or remove Seller / Marchent role
     */
    async removeMerchant({ userId, role }) {
        const userDoc = await resolveUser(userId);
        const uid = userDoc ? userDoc.uid : String(userId).trim();

        const query = { userId: uid };
        if (role) {
            query.role = role.toLowerCase();
        }

        const removed = await Merchant.findOneAndUpdate(
            query,
            {
                $set: {
                    status: 'revoked',
                    updatedAt: new Date()
                }
            },
            { new: true }
        ).lean();

        return removed;
    },

    /**
     * Super Admin allocates Selling Stock to a Merchant
     */
    async allocateStock({ adminUid, targetUserId, amount, note = '' }) {
        const numAmount = Math.floor(Number(amount) || 0);
        if (numAmount <= 0) {
            throw new Error('Stock amount must be greater than 0');
        }

        const userDoc = await resolveUser(targetUserId);
        if (!userDoc) {
            throw new Error(`Target user not found: ${targetUserId}`);
        }

        const merchantDoc = await Merchant.findOne({ userId: userDoc.uid });
        if (!merchantDoc || merchantDoc.status === 'revoked') {
            throw new Error('Target user is not registered as an active Merchant or Seller');
        }

        const stockBefore = merchantDoc.sellingStock;
        const stockAfter = stockBefore + numAmount;

        merchantDoc.sellingStock = stockAfter;
        merchantDoc.totalAllocated = (merchantDoc.totalAllocated || 0) + numAmount;
        merchantDoc.updatedAt = new Date();
        await merchantDoc.save();

        const txId = `TX_ALLOC_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await MerchantTransaction.create({
            txId,
            merchantId: merchantDoc.userId,
            merchantNumericId: merchantDoc.numericId,
            merchantName: merchantDoc.name,
            targetUserId: merchantDoc.userId,
            targetNumericId: merchantDoc.numericId,
            targetName: merchantDoc.name,
            coins: numAmount,
            merchantStockBefore: stockBefore,
            merchantStockAfter: stockAfter,
            txType: 'ADMIN_ALLOCATE',
            status: 'SUCCESS',
            note: note || `Admin ${adminUid || 'Super Master'} allocated ${numAmount} coins stock`
        });

        return {
            success: true,
            merchant: merchantDoc.toObject(),
            allocatedAmount: numAmount,
            newStock: stockAfter,
            txId
        };
    },

    /**
     * 100% Zero-Trust & Hack-Proof Merchant User Recharge
     * Uses Redis / In-memory Mutex Lock + MongoDB ACID Transaction Session
     */
    async rechargeUser({ merchantUid, targetUserId, coins, idempotencyKey, note = '' }) {
        const coinsToTransfer = Math.floor(Number(coins) || 0);
        if (coinsToTransfer <= 0) {
            throw new Error('Coins amount must be greater than 0');
        }

        // 1. Resolve calling merchant
        const merchantUserDoc = await resolveUser(merchantUid);
        if (!merchantUserDoc) {
            const err = new Error('Merchant user not found');
            err.status = 404;
            throw err;
        }

        // 2. Resolve target receiver user
        const targetUserDoc = await resolveUser(targetUserId);
        if (!targetUserDoc) {
            const err = new Error(`Target user not found with ID: ${targetUserId}`);
            err.status = 404;
            throw err;
        }

        if (merchantUserDoc.uid === targetUserDoc.uid) {
            throw new Error('Cannot transfer stock coins to your own account');
        }

        const txId = (idempotencyKey && String(idempotencyKey).trim()) || `TX_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        // 3. Check Idempotency Key (Anti-Replay / Double Request protection)
        if (!cacheService.checkAndMarkIdempotency(txId)) {
            const err = new Error('Duplicate recharge request blocked');
            err.status = 409;
            throw err;
        }

        // 4. Redis / In-Memory Mutex Lock on Merchant UID (Anti-Double-Spending)
        return await cacheService.withUserLock(merchantUserDoc.uid, async () => {
            // Check merchant active status & sufficient stock
            const merchant = await Merchant.findOne({ userId: merchantUserDoc.uid });
            if (!merchant || merchant.status !== 'active') {
                const err = new Error('You are not authorized as an active Merchant or Seller');
                err.status = 403;
                throw err;
            }

            if (merchant.sellingStock < coinsToTransfer) {
                const err = new Error(`Insufficient selling stock! You have ${merchant.sellingStock} coins available.`);
                err.status = 400;
                throw err;
            }

            // Execute Transaction with ACID Session if MongoDB replica set supports it
            let session = null;
            let useTransaction = false;

            try {
                session = await mongoose.startSession();
                session.startTransaction();
                useTransaction = true;
            } catch (sessErr) {
                // Standalone fallback if replica set not configured
                useTransaction = false;
                if (session) session.endSession();
                session = null;
            }

            try {
                const sessionOpts = useTransaction ? { session } : {};

                // A. Deduct stock from Merchant atomically
                const updatedMerchant = await Merchant.findOneAndUpdate(
                    {
                        userId: merchantUserDoc.uid,
                        sellingStock: { $gte: coinsToTransfer }
                    },
                    {
                        $inc: {
                            sellingStock: -coinsToTransfer,
                            totalSold: coinsToTransfer,
                            dailyTransferredToday: coinsToTransfer
                        },
                        $set: { updatedAt: new Date() }
                    },
                    { new: true, ...sessionOpts }
                ).lean();

                if (!updatedMerchant) {
                    throw new Error('Transaction aborted: Insufficient selling stock during atomic execution');
                }

                // B. Credit coins to target user atomically
                const updatedUser = await User.findOneAndUpdate(
                    { uid: targetUserDoc.uid },
                    {
                        $inc: { coins: coinsToTransfer },
                        $set: { updatedAt: new Date() }
                    },
                    { new: true, ...sessionOpts }
                ).lean();

                if (!updatedUser) {
                    throw new Error('Target user account not found during atomic execution');
                }

                // C. Create immutable Merchant Transaction Audit record
                const txRecord = await MerchantTransaction.create([{
                    txId,
                    idempotencyKey: txId,
                    merchantId: merchant.userId,
                    merchantNumericId: merchant.numericId,
                    merchantName: merchant.name,
                    targetUserId: targetUserDoc.uid,
                    targetNumericId: String(targetUserDoc.numericId),
                    targetName: targetUserDoc.name || 'User',
                    coins: coinsToTransfer,
                    merchantStockBefore: merchant.sellingStock,
                    merchantStockAfter: updatedMerchant.sellingStock,
                    userCoinsBefore: targetUserDoc.coins || 0,
                    userCoinsAfter: updatedUser.coins,
                    txType: 'MERCHANT_RECHARGE',
                    status: 'SUCCESS',
                    note: note || `Recharged by Seller ${merchant.name} (${merchant.numericId})`
                }], sessionOpts);

                // D. Record in General Wallet Transactions for recipient user's passbook
                await WalletTransaction.create([{
                    txId: `WTX_${txId}`,
                    type: 'ADMIN_ADJUST',
                    senderUid: merchantUserDoc.uid,
                    receiverUid: targetUserDoc.uid,
                    coinsDelta: coinsToTransfer,
                    diamondsDelta: 0,
                    senderCoinsAfter: updatedMerchant.sellingStock,
                    roomId: '',
                    createdAt: new Date()
                }], sessionOpts);

                // Commit session
                if (useTransaction && session) {
                    await session.commitTransaction();
                }

                // E. Sync In-Memory Cache
                await cacheService.syncWalletCache(targetUserDoc.uid, updatedUser.coins, updatedUser.diamonds || 0);

                return {
                    success: true,
                    txId,
                    coinsTransferred: coinsToTransfer,
                    remainingStock: updatedMerchant.sellingStock,
                    targetUser: {
                        uid: targetUserDoc.uid,
                        numericId: targetUserDoc.numericId,
                        name: targetUserDoc.name,
                        newBalance: updatedUser.coins
                    },
                    createdAt: new Date().toISOString()
                };

            } catch (txError) {
                if (useTransaction && session) {
                    try {
                        await session.abortTransaction();
                    } catch (_) {}
                }
                throw txError;
            } finally {
                if (session) {
                    session.endSession();
                }
            }
        });
    },

    /**
     * Get transaction history for a specific Merchant
     */
    async getMerchantHistory({ userId, limit = 50 }) {
        const userDoc = await resolveUser(userId);
        const uid = userDoc ? userDoc.uid : String(userId).trim();

        return await MerchantTransaction.find({
            $or: [{ merchantId: uid }, { targetUserId: uid }]
        })
            .sort({ createdAt: -1 })
            .limit(Number(limit) || 50)
            .lean();
    },

    /**
     * Get all merchant transactions for Newop History Tab
     */
    async getAllTransactions({ limit = 100, page = 1 } = {}) {
        const lim = Math.min(Number(limit) || 100, 200);
        const skip = (Math.max(Number(page) || 1, 1) - 1) * lim;

        const [items, total] = await Promise.all([
            MerchantTransaction.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(lim)
                .lean(),
            MerchantTransaction.countDocuments({})
        ]);

        return { items, total, page: Number(page) || 1, limit: lim };
    },

    /**
     * Get details for single Merchant including live stock
     */
    async getMerchantDetails(userId) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) return null;

        const merchant = await Merchant.findOne({ userId: userDoc.uid, status: { $ne: 'revoked' } }).lean();
        return merchant;
    }
};

module.exports = merchantService;