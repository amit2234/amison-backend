const crypto = require('crypto');
const mongoose = require('mongoose');
const DiamondBalance = require('../models/DiamondBalance');
const DiamondLedger = require('../models/DiamondLedger');
const DiamondAdjustment = require('../models/DiamondAdjustment');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const cacheService = require('./cacheService');
const { resolveUser } = require('../utils/userResolver');

class DiamondFinanceService {
    /**
     * Sync initial User collection balances into DiamondBalance if not existing
     */
    async syncMissingBalances() {
        try {
            // Find users who have diamonds > 0 or exist in Users but not in DiamondBalance
            const users = await User.find({ diamonds: { $gt: 0 } }).limit(200).lean();
            if (users && users.length > 0) {
                const bulkOps = users.map(u => ({
                    updateOne: {
                        filter: { userId: u.uid },
                        update: {
                            $setOnInsert: {
                                userId: u.uid,
                                displayUserId: String(u.numericId || ''),
                                userName: u.name || 'User',
                                avatarUrl: u.avatarUrl || '',
                                userRole: u.role || 'host',
                                availableDiamonds: Number(u.diamonds) || 0,
                                totalEarnedLifetime: Number(u.diamonds) || 0
                            }
                        },
                        upsert: true
                    }
                }));
                await DiamondBalance.bulkWrite(bulkOps, { ordered: false }).catch(() => {});
            }
        } catch (e) {
            console.warn('[DiamondFinanceService] syncMissingBalances notice:', e.message);
        }
    }

    /**
     * 1. Platform Balance Sheet Overview
     */
    async getOverview() {
        await this.syncMissingBalances();

        const [balanceStats] = await DiamondBalance.aggregate([
            {
                $group: {
                    _id: null,
                    totalCirculation: { $sum: "$availableDiamonds" },
                    totalFrozen: { $sum: "$frozenDiamonds" },
                    totalEarnedLifetime: { $sum: "$totalEarnedLifetime" },
                    totalWithdrawnLifetime: { $sum: "$totalWithdrawnLifetime" },
                    totalAccounts: { $sum: 1 }
                }
            }
        ]) || [];

        // 24-Hour Inflow / Outflow from Immutable Ledger
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent24h = await DiamondLedger.aggregate([
            { $match: { createdAt: { $gte: yesterday } } },
            {
                $group: {
                    _id: "$direction",
                    sum: { $sum: "$amount" }
                }
            }
        ]);

        const minted24h = recent24h.find(r => r._id === 'CREDIT')?.sum || 0;
        const cashedOut24h = recent24h.find(r => r._id === 'DEBIT')?.sum || 0;

        return {
            totalCirculation: balanceStats?.totalCirculation || 0,
            totalFrozen: balanceStats?.totalFrozen || 0,
            totalAccounts: balanceStats?.totalAccounts || 0,
            totalCashedOut: balanceStats?.totalWithdrawnLifetime || 0,
            minted24h,
            cashedOut24h,
            netCirculationChange24h: minted24h - cashedOut24h
        };
    }

    /**
     * 2. Top Diamond Holders List (Searchable, Filterable, Paginated)
     */
    async getTopHolders({ page = 1, limit = 50, search = '', role = 'ALL' }) {
        await this.syncMissingBalances();

        const query = {};
        if (search && search.trim()) {
            const term = search.trim();
            query.$or = [
                { displayUserId: { $regex: term, $options: 'i' } },
                { userName: { $regex: term, $options: 'i' } }
            ];
        }

        if (role && role !== 'ALL') {
            query.userRole = role.toLowerCase();
        }

        const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));
        const safeLimit = Math.min(100, Math.max(1, Number(limit)));

        const [total, holders] = await Promise.all([
            DiamondBalance.countDocuments(query),
            DiamondBalance.find(query)
                .sort({ availableDiamonds: -1, createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .lean()
        ]);

        return {
            total,
            page: Number(page),
            pages: Math.ceil(total / safeLimit),
            holders: holders.map(h => ({
                id: h.userId,
                userId: h.userId,
                displayUserId: h.displayUserId || '',
                userName: h.userName || 'User',
                avatarUrl: h.avatarUrl || '',
                userRole: h.userRole || 'host',
                availableDiamonds: h.availableDiamonds || 0,
                frozenDiamonds: h.frozenDiamonds || 0,
                totalEarnedLifetime: h.totalEarnedLifetime || 0,
                walletStatus: h.walletStatus || 'ACTIVE',
                lastTransactionAt: h.lastTransactionAt || h.updatedAt
            }))
        };
    }

    /**
     * 3. Immutable Diamond Ledger Transactions
     */
    async getLedger({ page = 1, limit = 50, userId = '', displayUserId = '', sourceType = '' }) {
        const query = {};
        if (userId) query.userId = userId;
        if (displayUserId) query.displayUserId = displayUserId;
        if (sourceType && sourceType !== 'ALL') query.sourceType = sourceType;

        const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));
        const safeLimit = Math.min(100, Math.max(1, Number(limit)));

        const [total, ledgers] = await Promise.all([
            DiamondLedger.countDocuments(query),
            DiamondLedger.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .lean()
        ]);

        return {
            total,
            page: Number(page),
            pages: Math.ceil(total / safeLimit),
            ledgers: ledgers.map(l => ({
                transactionId: l.transactionId,
                userId: l.userId,
                displayUserId: l.displayUserId,
                userName: l.userName || '',
                direction: l.direction,
                amount: l.amount,
                balanceBefore: l.balanceBefore,
                balanceAfter: l.balanceAfter,
                sourceType: l.sourceType,
                referenceId: l.referenceId || '',
                performedBy: l.performedBy,
                remarks: l.remarks || '',
                createdAt: l.createdAt
            }))
        };
    }

    /**
     * 4. Admin Manual Diamond Adjustment (MINT / BURN with Atomic Safety & Audit Log)
     */
    async adjustDiamonds({ targetDisplayUserId, actionType, amount, reason, adminEmail, adminUid, ipAddress }) {
        if (!targetDisplayUserId || !actionType || !amount || Number(amount) <= 0) {
            throw new Error('Invalid adjustment payload: targetDisplayUserId, actionType, and positive amount are required');
        }

        const safeAction = String(actionType).toUpperCase().trim();
        if (safeAction !== 'MINT' && safeAction !== 'BURN') {
            throw new Error('actionType must be either MINT or BURN');
        }

        const numAmount = Math.floor(Number(amount));
        const cleanTargetId = String(targetDisplayUserId).trim();

        // 1. Resolve target user in database
        const userDoc = await resolveUser(cleanTargetId);
        if (!userDoc) {
            throw new Error(`Target user '${cleanTargetId}' not found in MongoDB`);
        }

        const canonicalUid = userDoc.uid;
        const displayId = String(userDoc.numericId || cleanTargetId);
        const userName = userDoc.name || 'User';

        // 2. Execute under Per-User Atomic Mutex Lock
        return await cacheService.withUserLock(canonicalUid, async () => {
            // Find or create current DiamondBalance
            let balanceDoc = await DiamondBalance.findOne({ userId: canonicalUid });
            if (!balanceDoc) {
                balanceDoc = new DiamondBalance({
                    userId: canonicalUid,
                    displayUserId: displayId,
                    userName,
                    avatarUrl: userDoc.avatarUrl || '',
                    userRole: userDoc.role || 'host',
                    availableDiamonds: Number(userDoc.diamonds) || 0,
                    totalEarnedLifetime: Number(userDoc.diamonds) || 0
                });
            }

            const beforeBalance = balanceDoc.availableDiamonds;
            let afterBalance = beforeBalance;

            if (safeAction === 'MINT') {
                afterBalance = beforeBalance + numAmount;
                balanceDoc.availableDiamonds = afterBalance;
                balanceDoc.totalEarnedLifetime += numAmount;
            } else if (safeAction === 'BURN') {
                if (beforeBalance < numAmount) {
                    throw new Error(`Insufficient diamond balance: User has ${beforeBalance} diamonds, cannot burn ${numAmount}`);
                }
                afterBalance = beforeBalance - numAmount;
                balanceDoc.availableDiamonds = afterBalance;
            }

            balanceDoc.userName = userName;
            balanceDoc.displayUserId = displayId;
            balanceDoc.lastTransactionAt = new Date();
            await balanceDoc.save();

            // Sync with User & Wallet collections in MongoDB
            await User.findOneAndUpdate(
                { uid: canonicalUid },
                { $set: { diamonds: afterBalance, updatedAt: new Date() } }
            );

            await Wallet.findOneAndUpdate(
                { uid: canonicalUid },
                { $set: { diamonds: afterBalance, updatedAt: new Date() } },
                { upsert: true }
            );

            // Sync Redis cache
            await cacheService.syncWalletCache(canonicalUid, userDoc.coins, afterBalance);

            // Record Double-Entry Ledger Entry
            const txId = `DIA_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
            const ledgerEntry = await DiamondLedger.create({
                transactionId: txId,
                idempotencyKey: `IDEM_${txId}`,
                userId: canonicalUid,
                displayUserId: displayId,
                userName,
                direction: safeAction === 'MINT' ? 'CREDIT' : 'DEBIT',
                amount: numAmount,
                balanceBefore: beforeBalance,
                balanceAfter: afterBalance,
                sourceType: safeAction === 'MINT' ? 'ADMIN_MANUAL_MINT' : 'ADMIN_MANUAL_BURN',
                performedBy: adminEmail || 'Super Master',
                remarks: reason || `Admin manual ${safeAction.toLowerCase()}`
            });

            // Record Audit Record
            await DiamondAdjustment.create({
                adjustmentId: txId,
                targetUserId: canonicalUid,
                targetDisplayUserId: displayId,
                targetUserName: userName,
                actionType: safeAction,
                amount: numAmount,
                reason: reason || `Admin manual balance ${safeAction.toLowerCase()}`,
                adminEmail: adminEmail || 'admin@newop.internal',
                adminUid: adminUid || '',
                ipAddress: ipAddress || ''
            });

            return {
                transactionId: txId,
                userId: canonicalUid,
                displayUserId: displayId,
                userName,
                actionType: safeAction,
                amount: numAmount,
                balanceBefore: beforeBalance,
                balanceAfter: afterBalance,
                createdAt: ledgerEntry.createdAt
            };
        });
    }

    /**
     * 5. Freeze or Unfreeze User Diamond Wallet
     */
    async setWalletStatus({ targetDisplayUserId, status, reason, adminEmail, adminUid, ipAddress }) {
        const cleanTargetId = String(targetDisplayUserId).trim();
        const userDoc = await resolveUser(cleanTargetId);
        if (!userDoc) {
            throw new Error(`Target user '${cleanTargetId}' not found`);
        }

        const canonicalUid = userDoc.uid;
        const validStatuses = ['ACTIVE', 'FROZEN_BY_ADMIN', 'UNDER_INVESTIGATION'];
        const safeStatus = validStatuses.includes(status) ? status : 'ACTIVE';

        const updated = await DiamondBalance.findOneAndUpdate(
            { userId: canonicalUid },
            { 
                $set: { 
                    walletStatus: safeStatus,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    userId: canonicalUid,
                    displayUserId: String(userDoc.numericId || cleanTargetId),
                    userName: userDoc.name || 'User',
                    availableDiamonds: Number(userDoc.diamonds) || 0
                }
            },
            { upsert: true, new: true }
        );

        // Audit Record
        const adjId = `ADJ_STATUS_${Date.now()}`;
        await DiamondAdjustment.create({
            adjustmentId: adjId,
            targetUserId: canonicalUid,
            targetDisplayUserId: String(userDoc.numericId || cleanTargetId),
            targetUserName: userDoc.name || 'User',
            actionType: safeStatus === 'ACTIVE' ? 'UNFREEZE' : 'FREEZE',
            amount: 0,
            reason: reason || `Wallet status set to ${safeStatus}`,
            adminEmail: adminEmail || 'admin@newop.internal',
            adminUid: adminUid || '',
            ipAddress: ipAddress || ''
        });

        return {
            userId: canonicalUid,
            displayUserId: updated.displayUserId,
            walletStatus: updated.walletStatus
        };
    }
}

module.exports = new DiamondFinanceService();