const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Merchant = require('../../models/Merchant');
const MerchantTransaction = require('../../models/MerchantTransaction');
const WalletTransaction = require('../../models/Transaction');
const cacheService = require('../cacheService');
const { resolveUser } = require('../../utils/userResolver');

const merchantTransferService = {
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

        const merchantDoc = await Merchant.findOne({ uid: userDoc.uid });
        if (!merchantDoc || merchantDoc.status === 'revoked') {
            throw new Error('Target user is not registered as an active Merchant or Seller');
        }

        const stockBefore = merchantDoc.sellingStock;
        const stockAfter = stockBefore + numAmount;

        merchantDoc.sellingStock = stockAfter;
        merchantDoc.updatedAt = new Date();
        await merchantDoc.save();

        const txId = `TX_ALLOC_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await MerchantTransaction.create({
            txId,
            merchantId: userDoc.uid,
            merchantNumericId: String(userDoc.numericId),
            merchantName: userDoc.name,
            targetUserId: userDoc.uid,
            targetNumericId: String(userDoc.numericId),
            targetName: userDoc.name,
            coins: numAmount,
            merchantStockBefore: stockBefore,
            merchantStockAfter: stockAfter,
            txType: 'ADMIN_ALLOCATE',
            status: 'SUCCESS',
            note: note || `Admin ${adminUid || 'Super Master'} allocated ${numAmount} coins stock`
        });

        return {
            success: true,
            merchant: {
                ...merchantDoc.toObject(),
                userId: userDoc.uid,
                numericId: userDoc.numericId,
                name: userDoc.name,
                avatarUrl: userDoc.avatarUrl
            },
            allocatedAmount: numAmount,
            newStock: stockAfter,
            txId
        };
    },

    /**
     * 100% Zero-Trust & Hack-Proof Merchant User Recharge / Stock Transfer
     */
    async rechargeUser({ merchantUid, targetUserId, coins, transferType = 'COINS', idempotencyKey, note = '' }) {
        const coinsToTransfer = Math.floor(Number(coins) || 0);
        if (coinsToTransfer <= 0) {
            throw new Error('Coins amount must be greater than 0');
        }

        const normTransferType = String(transferType || 'COINS').toUpperCase() === 'STOCK' ? 'STOCK' : 'COINS';

        const merchantUserDoc = await resolveUser(merchantUid);
        if (!merchantUserDoc) {
            const err = new Error('Merchant user not found');
            err.status = 404;
            throw err;
        }

        const targetUserDoc = await resolveUser(targetUserId);
        if (!targetUserDoc) {
            const err = new Error(`Target user not found with ID: ${targetUserId}`);
            err.status = 404;
            throw err;
        }

        if (normTransferType === 'STOCK' && merchantUserDoc.uid === targetUserDoc.uid) {
            throw new Error('Cannot transfer seller stock to your own seller stock');
        }

        const txId = (idempotencyKey && String(idempotencyKey).trim()) || `TX_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        return await cacheService.withUserLock(merchantUserDoc.uid, async () => {
            let merchant = await Merchant.findOne({ uid: merchantUserDoc.uid });
            if (!merchant) {
                merchant = await Merchant.create({
                    uid: merchantUserDoc.uid,
                    sellingStock: 50000,
                    status: 'active',
                    roleTagline: 'Authorized Seller'
                });
            } else if (merchant.status !== 'active') {
                const err = new Error('You are not authorized as an active Merchant or Seller');
                err.status = 403;
                throw err;
            }

            if (merchant.sellingStock < coinsToTransfer) {
                const err = new Error(`Insufficient selling stock! You have ${merchant.sellingStock} coins available.`);
                err.status = 400;
                throw err;
            }

            let session = null;
            let useTransaction = false;

            try {
                session = await mongoose.startSession();
                session.startTransaction();
                useTransaction = true;
            } catch (sessErr) {
                useTransaction = false;
                if (session) session.endSession();
                session = null;
            }

            try {
                const sessionOpts = useTransaction ? { session } : {};

                // 1. Deduct from Seller's Selling Stock
                const updatedMerchant = await Merchant.findOneAndUpdate(
                    {
                        uid: merchantUserDoc.uid,
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

                if (normTransferType === 'STOCK') {
                    // STOCK TRANSFER: Transfer coins from Seller Stock to Target Seller's Stock
                    const targetMerchant = await Merchant.findOneAndUpdate(
                        { uid: targetUserDoc.uid },
                        {
                            $inc: { sellingStock: coinsToTransfer },
                            $set: { updatedAt: new Date(), status: 'active' },
                            $setOnInsert: {
                                role: 'seller',
                                roleTagline: 'Authorized Seller',
                                totalSold: 0,
                                dailyTransferredToday: 0,
                                createdAt: new Date()
                            }
                        },
                        { upsert: true, new: true, ...sessionOpts }
                    ).lean();

                    await User.updateOne(
                        { uid: targetUserDoc.uid },
                        {
                            $set: {
                                isSeller: true,
                                sellerCenterRole: targetMerchant.role || 'seller',
                                updatedAt: new Date()
                            }
                        },
                        sessionOpts
                    );

                    await MerchantTransaction.create([{
                        txId,
                        idempotencyKey: txId,
                        merchantId: merchantUserDoc.uid,
                        merchantNumericId: String(merchantUserDoc.numericId),
                        merchantName: merchantUserDoc.name,
                        targetUserId: targetUserDoc.uid,
                        targetNumericId: String(targetUserDoc.numericId),
                        targetName: targetUserDoc.name || 'Seller',
                        coins: coinsToTransfer,
                        merchantStockBefore: merchant.sellingStock,
                        merchantStockAfter: updatedMerchant.sellingStock,
                        userCoinsBefore: (targetMerchant.sellingStock || coinsToTransfer) - coinsToTransfer,
                        userCoinsAfter: targetMerchant.sellingStock || coinsToTransfer,
                        txType: 'STOCK_TRANSFER',
                        status: 'SUCCESS',
                        note: note || `Stock Transfer from Seller ${merchantUserDoc.name} (${merchantUserDoc.numericId})`
                    }], sessionOpts);

                    if (useTransaction && session) {
                        await session.commitTransaction();
                    }

                    return {
                        success: true,
                        txId,
                        transferType: 'STOCK',
                        coinsTransferred: coinsToTransfer,
                        remainingStock: updatedMerchant.sellingStock,
                        targetUser: {
                            uid: targetUserDoc.uid,
                            numericId: targetUserDoc.numericId,
                            name: targetUserDoc.name,
                            newBalance: targetMerchant.sellingStock
                        },
                        createdAt: new Date().toISOString()
                    };

                } else {
                    // NORMAL COINS RECHARGE: Transfer coins from Seller Stock to Target User's Normal Coins Wallet
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

                    await MerchantTransaction.create([{
                        txId,
                        idempotencyKey: txId,
                        merchantId: merchantUserDoc.uid,
                        merchantNumericId: String(merchantUserDoc.numericId),
                        merchantName: merchantUserDoc.name,
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
                        note: note || `Recharged by Seller ${merchantUserDoc.name} (${merchantUserDoc.numericId})`
                    }], sessionOpts);

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

                    if (useTransaction && session) {
                        await session.commitTransaction();
                    }

                    await cacheService.syncWalletCache(targetUserDoc.uid, updatedUser.coins, updatedUser.diamonds || 0);

                    return {
                        success: true,
                        txId,
                        transferType: 'COINS',
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
                }
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
    }
};

module.exports = merchantTransferService;
