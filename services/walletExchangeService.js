const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const WalletTransaction = require('../models/Transaction');
const cacheService = require('./cacheService');
const { resolveUser } = require('../utils/userResolver');

/**
 * Wallet Exchange Service
 * Handles 0-Trust Diamond to Gold Coin Conversions and UPI Cashout Withdrawals
 */
const walletExchangeService = {
    /**
     * 0-Trust Atomic Diamond to Coin Conversion
     */
    async convertDiamondsToCoins({ uid, diamondsToConvert, txId: clientTxId }) {
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
    },

    /**
     * 0-Trust Atomic Diamond Withdrawal (UPI Cashout)
     */
    async withdrawDiamonds({ uid, diamondsToWithdraw, method = 'UPI', txId: clientTxId }) {
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
};

module.exports = walletExchangeService;