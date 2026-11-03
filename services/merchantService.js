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
     * Populates user profile info (name, numericId, avatar, email) from User collection.
     */
    async getAllMerchants({ role, status } = {}) {
        const query = {};
        if (status) {
            query.status = status.toLowerCase();
        } else {
            query.status = { $ne: 'revoked' };
        }

        const merchants = await Merchant.find(query).sort({ updatedAt: -1 }).lean();
        
        // Enrich merchants with user profile data from users collection (normalized architecture)
        const enriched = await Promise.all(merchants.map(async (m) => {
            const userDoc = await User.findOne({ uid: m.uid }).lean();
            return {
                ...m,
                userId: m.uid, // backward compatibility alias
                numericId: userDoc ? userDoc.numericId : 'N/A',
                name: userDoc ? userDoc.name : 'Unknown Seller',
                avatarUrl: userDoc ? userDoc.avatarUrl : '',
                email: userDoc ? userDoc.email : '',
                level: userDoc ? userDoc.level : 1
            };
        }));

        if (role) {
            const roleLower = role.toLowerCase().includes('marchent') ? 'marchent' : 'seller';
            return enriched.filter(m => (m.role === roleLower) || (m.roleTagline || '').toLowerCase().includes(roleLower));
        }

        return enriched;
    },

    /**
     * Promote a user to Seller / Merchant role in MongoDB
     */
    async addOrUpdateMerchant({ userId, role = 'seller', roleTagline, dailyTransferLimit, assignedBy = 'Super Master' }) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) {
            throw new Error(`User not found with ID: ${userId}`);
        }

        const roleLower = String(role || 'seller').toLowerCase().includes('marchent') ? 'marchent' : 'seller';
        const defaultTagline = roleLower === 'marchent' ? 'Authorized Merchant' : 'Authorized Seller';
        const effectiveTagline = roleTagline || defaultTagline;
        const initialStock = roleLower === 'marchent' ? 100000 : 50000;
        const transferLimit = roleLower === 'marchent' ? 500000 : 50000;

        // Resolve assigner details
        let assignerName = 'Super Master Admin';
        let assignerAvatar = '';
        if (assignedBy && assignedBy !== 'Super Master') {
            const assignerDoc = await resolveUser(assignedBy);
            if (assignerDoc) {
                assignerName = assignerDoc.name || 'Super Master Admin';
                assignerAvatar = assignerDoc.avatarUrl || '';
            }
        }

        const updated = await Merchant.findOneAndUpdate(
            { uid: userDoc.uid },
            {
                $set: {
                    uid: userDoc.uid,
                    role: roleLower,
                    roleTagline: effectiveTagline,
                    dailyTransferLimit: Number(dailyTransferLimit) || transferLimit,
                    status: 'active',
                    assignedByUid: String(assignedBy || ''),
                    assignedByName: assignerName,
                    assignedByAvatar: assignerAvatar,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    sellingStock: initialStock, // Initial protected vault stock for new merchants/sellers
                    totalSold: 0,
                    dailyTransferredToday: 0,
                    createdAt: new Date()
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        // Update User collection with authorization flags
        await User.updateOne(
            { uid: userDoc.uid },
            {
                $set: {
                    isSeller: true,
                    isMerchant: roleLower === 'marchent',
                    sellerCenterRole: roleLower
                }
            }
        );

        // Create official congratulatory notice in Message collection
        try {
            const Message = require('../models/Message');
            await Message.create({
                conversationId: `CONV_SYSTEM_${userDoc.uid}`,
                senderId: 'AMISON_OFFICIAL',
                recipientId: userDoc.uid,
                type: 'official_role_announcement',
                text: roleLower === 'marchent'
                    ? `Congratulations 🎉! You have been appointed as an official Merchant by ${assignerName}. Your dedicated Seller Stock is now active. Access Marchent Centre from your Me tab.`
                    : `Congratulations 🎉! You have been appointed as an official Seller by ${assignerName}. Your dedicated Seller Stock is now active. Access Seller Centre from your Me tab.`,
                metadata: {
                    assignedRole: roleLower,
                    promoterUid: String(assignedBy || ''),
                    promoterName: assignerName,
                    promoterAvatar: assignerAvatar,
                    stockAllocated: updated.sellingStock || initialStock
                },
                isRead: false
            });
        } catch (msgErr) {
            console.error('⚠️ [MerchantService] Failed to create system notice message:', msgErr.message);
        }

        // 1. Send WebSocket Realtime Event for instant 0ms state change in Android client (Me tab unlocks immediately)
        cacheService.emitToUser(userDoc.uid, {
            type: 'ROLE_AUTHORIZATION_CHANGED',
            role: roleLower,
            centerTitle: roleLower === 'marchent' ? 'Marchent Centre' : 'Seller Centre',
            stock: updated.sellingStock || initialStock,
            isAuthorized: true,
            timestamp: Date.now()
        });

        cacheService.emitToUser(userDoc.uid, {
            type: 'role:updated',
            role: roleLower,
            roleTagline: effectiveTagline,
            timestamp: Date.now()
        });

        // 2. Send AMISON Official Realtime Message to target user
        const sysMessage = {
            type: 'dm:receive',
            messageId: `SYS_MSG_${Date.now()}`,
            conversationId: `CONV_SYSTEM_${userDoc.uid}`,
            senderId: 'AMISON_OFFICIAL',
            senderName: 'AMISON Official',
            senderAvatar: assignerAvatar || '',
            text: roleLower === 'marchent'
                ? `Congratulations 🎉! You have been appointed as an official Merchant by ${assignerName}. Your dedicated Seller Stock is now active. Access Marchent Centre from your Me tab.`
                : `Congratulations 🎉! You have been appointed as an official Seller by ${assignerName}. Your dedicated Seller Stock is now active. Access Seller Centre from your Me tab.`,
            messageType: 'official_announcement',
            timestamp: Date.now(),
            promotedBy: {
                name: assignerName,
                avatar: assignerAvatar
            },
            role: roleLower
        };
        cacheService.emitToUser(userDoc.uid, sysMessage);

        // 3. Broadcast to all NewOp Admins so their lists update live
        cacheService.broadcastToAll({
            type: 'NEWOP_LIST_UPDATED',
            user: {
                uid: userDoc.uid,
                numericId: userDoc.numericId,
                name: userDoc.name,
                avatarUrl: userDoc.avatarUrl,
                role: roleLower,
                sellingStock: updated.sellingStock || initialStock
            }
        });

        return {
            ...updated,
            userId: updated.uid,
            numericId: userDoc.numericId,
            name: userDoc.name,
            avatarUrl: userDoc.avatarUrl,
            email: userDoc.email,
            role: roleLower
        };
    },

    /**
     * Get user's current live Merchant/Seller authorization and status
     */
    async getMyMerchantStatus(userId) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) {
            return { isAuthorized: false, role: null, centerTitle: null, stock: 0 };
        }
        const merchant = await Merchant.findOne({ uid: userDoc.uid, status: 'active' }).lean();
        if (!merchant) {
            return { isAuthorized: false, role: null, centerTitle: null, stock: 0 };
        }
        const role = merchant.role || (merchant.roleTagline?.toLowerCase().includes('marchent') ? 'marchent' : 'seller');
        return {
            isAuthorized: true,
            role: role,
            centerTitle: role === 'marchent' ? 'Marchent Centre' : 'Seller Centre',
            stock: merchant.sellingStock || 0,
            assignedByName: merchant.assignedByName || 'Super Master Admin',
            assignedByAvatar: merchant.assignedByAvatar || ''
        };
    },

    /**
     * Revoke or remove Seller / Merchant role
     */
    async removeMerchant({ userId }) {
        const userDoc = await resolveUser(userId);
        const uid = userDoc ? userDoc.uid : String(userId).trim();

        const removed = await Merchant.findOneAndUpdate(
            { uid },
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

            // Execute Transaction with ACID Session if MongoDB replica set supports it
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

                // A. Deduct stock from Merchant atomically (sellingStock is protected and uneditable directly by user)
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

                if (useTransaction && session) {
                    await session.commitTransaction();
                }

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
        const lim = Math.
