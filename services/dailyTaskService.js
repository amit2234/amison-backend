const crypto = require('crypto');
const mongoose = require('mongoose');
const DailyTaskUser = require('../models/DailyTaskUser');
const DailyTaskLog = require('../models/DailyTaskLog');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/Transaction');
const cacheService = require('./cacheService');
const { resolveUser } = require('./gifting/userResolver');

const SPIN_COST_POINTS = 2000;
const MIC_TARGET_SECONDS = 3600;

// Standard 16 Sectors matching Solana 3D Wheel geometry
const WHEEL_SECTORS = [
    { id: 0, label: '100', sublabel: 'COIN', points: 100, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 100 },
    { id: 1, label: '500', sublabel: 'COIN', points: 500, type: 'coin', color: '#fef08a', glow: '#eab308', weight: 60 },
    { id: 2, label: '150', sublabel: 'COIN', points: 150, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 75 },
    { id: 3, label: 'FREE', sublabel: 'SPIN', points: 0, type: 'free_spin', color: '#f5d0fe', glow: '#d946ef', weight: 40 },
    { id: 4, label: '100', sublabel: 'COIN', points: 100, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 100 },
    { id: 5, label: '1000', sublabel: 'COIN', points: 1000, type: 'coin', color: '#fef08a', glow: '#f59e0b', weight: 18 },
    { id: 6, label: '150', sublabel: 'COIN', points: 150, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 75 },
    { id: 7, label: '500', sublabel: 'COIN', points: 500, type: 'coin', color: '#fef08a', glow: '#eab308', weight: 60 },
    { id: 8, label: '100', sublabel: 'COIN', points: 100, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 100 },
    { id: 9, label: '2000', sublabel: 'JACKPOT', points: 2000, type: 'jackpot', color: '#ffd700', glow: '#f59e0b', weight: 5 },
    { id: 10, label: '150', sublabel: 'COIN', points: 150, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 75 },
    { id: 11, label: 'FREE', sublabel: 'SPIN', points: 0, type: 'free_spin', color: '#f5d0fe', glow: '#d946ef', weight: 40 },
    { id: 12, label: '100', sublabel: 'COIN', points: 100, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 100 },
    { id: 13, label: '500', sublabel: 'COIN', points: 500, type: 'coin', color: '#fef08a', glow: '#eab308', weight: 60 },
    { id: 14, label: '150', sublabel: 'COIN', points: 150, type: 'coin', color: '#ffffff', glow: '#38bdf8', weight: 75 },
    { id: 15, label: '1000', sublabel: 'COIN', points: 1000, type: 'coin', color: '#fef08a', glow: '#f59e0b', weight: 17 },
];

/**
 * Returns current date key formatted in Asia/Kolkata IST (Midnight 00:00:00 rollover)
 */
function getTodayISTDateKey() {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return formatter.format(now); // "YYYY-MM-DD"
    } catch {
        return new Date().toISOString().slice(0, 10);
    }
}

/**
 * Returns yesterday's IST date key cleanly using pure UTC calendar math
 */
function getPreviousISTDateKey(dateKey) {
    const parts = String(dateKey || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    }
    const utcMs = Date.UTC(parts[0], parts[1] - 1, parts[2]) - 86400000;
    return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * Selects a winning sector using cryptographically strong server-authoritative RNG weights
 */
function rollServerRNGSector() {
    const totalWeight = WHEEL_SECTORS.reduce((sum, s) => sum + s.weight, 0);
    let rand = crypto.randomInt(0, totalWeight);
    for (const sec of WHEEL_SECTORS) {
        if (rand < sec.weight) {
            return sec;
        }
        rand -= sec.weight;
    }
    return WHEEL_SECTORS[0];
}

/**
 * Resolves verified user account in MongoDB Users collection. Throws 404 if missing.
 */
async function requireCanonicalUser(rawUid) {
    const userDoc = await resolveUser(rawUid);
    if (!userDoc || !userDoc.uid) {
        const err = new Error('User account not found');
        err.status = 404;
        throw err;
    }
    return userDoc;
}

class DailyTaskService {
    /**
     * Internal helper (must be called inside cacheService.withUserLock(canonicalUid))
     * Ensures DailyTaskUser record exists and resets daily tasks on IST midnight rollover.
     */
    static async _ensureTodayRecord(canonicalUid, numericId = 0) {
        const todayKey = getTodayISTDateKey();

        let taskUser = await DailyTaskUser.findOneAndUpdate(
            { uid: canonicalUid },
            {
                $setOnInsert: {
                    uid: canonicalUid,
                    numericId: Number(numericId) || 0,
                    currentDateKey: todayKey,
                    pointsBalance: 0,
                    totalPointsEarned: 0,
                    freeSpinsAvailable: 0,
                    consecutiveDays: 1,
                    lastLoginDateKey: '',
                    dailyLoginClaimed: false,
                    dailyLoginPoints: 0,
                    micSecondsToday: 0,
                    micTaskClaimed: false,
                    micTaskPoints: 0,
                    updatedAt: new Date()
                }
            },
            { upsert: true, new: true }
        );

        // Atomic Midnight Day Rollover Check
        if (taskUser.currentDateKey !== todayKey) {
            const yesterdayKey = getPreviousISTDateKey(todayKey);
            const isConsecutive = (taskUser.lastLoginDateKey === yesterdayKey);
            const nextStreak = isConsecutive ? (Number(taskUser.consecutiveDays) || 0) + 1 : 1;

            const rolled = await DailyTaskUser.findOneAndUpdate(
                { uid: canonicalUid, currentDateKey: { $ne: todayKey } },
                {
                    $set: {
                        numericId: Number(numericId) || taskUser.numericId || 0,
                        consecutiveDays: nextStreak,
                        currentDateKey: todayKey,
                        dailyLoginClaimed: false,
                        dailyLoginPoints: 0,
                        micSecondsToday: 0,
                        micTaskClaimed: false,
                        micTaskPoints: 0,
                        lastMicHeartbeatAt: null,
                        updatedAt: new Date()
                    }
                },
                { new: true }
            );
            if (rolled) {
                taskUser = rolled;
            } else {
                taskUser = await DailyTaskUser.findOne({ uid: canonicalUid });
            }
        }

        return taskUser;
    }

    /**
     * Flushes genuine server-measured mic seconds if user is currently seated on a live room stage mic.
     * Returns { seated: boolean, elapsedFlushed: number }
     */
    static async _flushActiveSeatMicSeconds(canonicalUid, numericId) {
        const numStr = numericId ? String(numericId) : '';
        let totalElapsed = 0;
        let isCurrentlySeated = false;
        const now = Date.now();

        for (const seats of cacheService.roomSeatsMap.values()) {
            if (!Array.isArray(seats)) continue;
            for (const seat of seats) {
                if (!seat || !seat.userId) continue;
                const seatUid = String(seat.userId).trim();
                const seatCustom = String(seat.userCustomId || '').trim();
                const matches = (seatUid === canonicalUid) || (numStr && (seatUid === numStr || seatCustom === numStr));
                if (matches) {
                    isCurrentlySeated = true;
                    if (seat.seatedAt) {
                        const elapsedSec = Math.floor((now - Number(seat.seatedAt)) / 1000);
                        if (elapsedSec > 0) {
                            totalElapsed += Math.min(elapsedSec, 3600);
                            seat.seatedAt = now;
                        }
                    } else {
                        seat.seatedAt = now;
                    }
                }
            }
        }

        if (totalElapsed > 0) {
            const todayKey = getTodayISTDateKey();
            await DailyTaskUser.findOneAndUpdate(
                { uid: canonicalUid, currentDateKey: todayKey },
                {
                    $inc: { micSecondsToday: totalElapsed },
                    $set: { lastMicHeartbeatAt: new Date(now), updatedAt: new Date(now) }
                }
            );
        }

        return { seated: isCurrentlySeated, elapsedFlushed: totalElapsed };
    }

    /**
     * Returns full authoritative status object formatted for H5 / Client UI.
     * Keeps Daily Task Points strictly separate from real Wallet Gold Coins (User.coins).
     */
    static async getStatus(rawUid) {
        const userDoc = await requireCanonicalUser(rawUid);

        return await cacheService.withUserLock(userDoc.uid, async () => {
            await this._ensureTodayRecord(userDoc.uid, userDoc.numericId);
            await this._flushActiveSeatMicSeconds(userDoc.uid, userDoc.numericId);

            const taskUser = await DailyTaskUser.findOne({ uid: userDoc.uid }).lean();
            const freshUser = await User.findOne({ uid: userDoc.uid }).lean();
            const currentCoins = Math.max(0, Number(freshUser ? freshUser.coins : userDoc.coins) || 0);

            const micSeconds = Math.max(0, Number(taskUser?.micSecondsToday) || 0);
            const micMinutes = Math.floor(micSeconds / 60);
            const micPercentage = Math.min(100, Math.round((micSeconds / MIC_TARGET_SECONDS) * 100));

            return {
                uid: userDoc.uid,
                pointsBalance: Math.max(0, Number(taskUser?.pointsBalance) || 0),
                freeSpinsAvailable: Math.max(0, Number(taskUser?.freeSpinsAvailable) || 0),
                consecutiveDays: Math.max(1, Number(taskUser?.consecutiveDays) || 1),
                spinCostPoints: SPIN_COST_POINTS,
                currentCoins,
                tasks: {
                    dailyLogin: {
                        claimed: Boolean(taskUser?.dailyLoginClaimed),
                        canClaim: !taskUser?.dailyLoginClaimed,
                        pointsEarned: Number(taskUser?.dailyLoginPoints) || 0,
                        minReward: 200,
                        maxReward: 500
                    },
                    mic60Min: {
                        claimed: Boolean(taskUser?.micTaskClaimed),
                        canClaim: !taskUser?.micTaskClaimed && micSeconds >= MIC_TARGET_SECONDS,
                        currentMinutes: micMinutes,
                        currentSeconds: micSeconds,
                        targetMinutes: 60,
                        percentage: micPercentage,
                        pointsEarned: Number(taskUser?.micTaskPoints) || 0,
                        minReward: 500,
                        maxReward: 1000
                    }
                }
            };
        });
    }

    /**
     * Claims Daily Login reward (200 - 500 Daily Points, strictly once per IST day, 100% atomic)
     */
    static async claimDailyLogin(rawUid) {
        const userDoc = await requireCanonicalUser(rawUid);
        const todayKey = getTodayISTDateKey();

        return await cacheService.withUserLock(userDoc.uid, async () => {
            await this._ensureTodayRecord(userDoc.uid, userDoc.numericId);

            const awardedPoints = crypto.randomInt(200, 501);

            const updated = await DailyTaskUser.findOneAndUpdate(
                {
                    uid: userDoc.uid,
                    currentDateKey: todayKey,
                    dailyLoginClaimed: false
                },
                {
                    $set: {
                        dailyLoginClaimed: true,
                        dailyLoginPoints: awardedPoints,
                        lastLoginDateKey: todayKey,
                        updatedAt: new Date()
                    },
                    $inc: {
                        pointsBalance: awardedPoints,
                        totalPointsEarned: awardedPoints
                    }
                },
                { new: true }
            ).lean();

            if (!updated) {
                return {
                    success: false,
                    status: 400,
                    message: 'Aaj ka daily login task already claim ho chuka hai! Kal raat 12 baje dobara aayega.'
                };
            }

            await DailyTaskLog.create({
                uid: userDoc.uid,
                actionType: 'CLAIM_LOGIN',
                dateKey: todayKey,
                pointsDelta: awardedPoints,
                details: { points: awardedPoints }
            });

            return {
                success: true,
                awardedPoints,
                newPointsBalance: updated.pointsBalance,
                currentCoins: Math.max(0, Number(userDoc.coins) || 0),
                message: `Badhai ho! Aapko ${awardedPoints} Daily Points mile!`
            };
        });
    }

    /**
     * Records elapsed mic seconds from internal WebSocket stage events only.
     * Resolves canonical UID safely if rawUserId is a 9-digit numericId or Auth UID.
     */
    static async recordMicTime(rawUserId, seconds) {
        const cleanSeconds = Math.floor(Number(seconds) || 0);
        if (!rawUserId || cleanSeconds <= 0) return;

        const userDoc = await resolveUser(rawUserId);
        if (!userDoc || !userDoc.uid) return;

        const safeDelta = Math.max(1, Math.min(cleanSeconds, 3600));
        const todayKey = getTodayISTDateKey();

        await cacheService.withUserLock(userDoc.uid, async () => {
            await this._ensureTodayRecord(userDoc.uid, userDoc.numericId);
            await DailyTaskUser.findOneAndUpdate(
                { uid: userDoc.uid, currentDateKey: todayKey },
                {
                    $inc: { micSecondsToday: safeDelta },
                    $set: { lastMicHeartbeatAt: new Date(), updatedAt: new Date() }
                }
            );
        });
    }

    /**
     * Zero-Trust API endpoint handler for mic heartbeat:
     * Never trusts client-provided seconds; only flushes verified room-seat duration on the server.
     */
    static async heartbeatMicFromRoomSeat(rawUid) {
        const userDoc = await requireCanonicalUser(rawUid);

        return await cacheService.withUserLock(userDoc.uid, async () => {
            await this._ensureTodayRecord(userDoc.uid, userDoc.numericId);
            const flush = await this._flushActiveSeatMicSeconds(userDoc.uid, userDoc.numericId);
            if (!flush.seated) {
                return {
                    success: false,
                    status: 400,
                    message: 'Voice room me mic par baithne ke baad hi mic time count hoga.'
                };
            }
            const taskUser = await DailyTaskUser.findOne({ uid: userDoc.uid }).lean();
            const micSeconds = Math.max(0, Number(taskUser?.micSecondsToday) || 0);
            return {
                success: true,
                currentMinutes: Math.floor(micSeconds / 60),
                currentSeconds: micSeconds
            };
        });
    }

    /**
     * Claims 60-Minute on Mic reward (500 - 1000 Daily Points once server-verified 3600s completed)
     */
    static async claimMicTask(rawUid) {
        const userDoc = await requireCanonicalUser(rawUid);
        const todayKey = getTodayISTDateKey();

        return await cacheService.withUserLock(userDoc.uid, async () => {
            await this._ensureTodayRecord(userDoc.uid, userDoc.numericId);
            await this._flushActiveSeatMicSeconds(userDoc.uid, userDoc.numericId);

            const awardedPoints = crypto.randomInt(500, 1001);

            const updated = await DailyTaskUser.findOneAndUpdate(
                {
                    uid: userDoc.uid,
                    currentDateKey: todayKey,
                    micTaskClaimed: false,
                    micSecondsToday: { $gte: MIC_TARGET_SECONDS }
                },
                {
                    $set: {
                        micTaskClaimed: true,
                        micTaskPoints: awardedPoints,
                        updatedAt: new Date()
                    },
                    $inc: {
                        pointsBalance: awardedPoints,
                        totalPointsEarned: awardedPoints
                    }
                },
                { new: true }
            ).lean();

            if (!updated) {
                const current = await DailyTaskUser.findOne({ uid: userDoc.uid }).lean();
                if (current?.micTaskClaimed) {
                    return {
                        success: false,
                        status: 400,
                        message: 'Mic task already claim ho chuka hai!'
                    };
                }
                const micMinutes = Math.floor((Number(current?.micSecondsToday) || 0) / 60);
                return {
                    success: false,
                    status: 400,
                    message: `Abhi sirf ${micMinutes}/60 minute hue hain. 60 minute pure hone ke baad hi claim kar sakte hain.`
                };
            }

            await DailyTaskLog.create({
                uid: userDoc.uid,
                actionType: 'CLAIM_MIC_60M',
                dateKey: todayKey,
                pointsDelta: awardedPoints,
                details: { points: awardedPoints, micSeconds: updated.micSecondsToday }
            });

            return {
                success: true,
                awardedPoints,
                newPointsBalance: updated.pointsBalance,
                currentCoins: Math.max(0, Number(userDoc.coins) || 0),
                message: `Shandaar! Mic par 60 min complete karne par aapko ${awardedPoints} Daily Points mile!`
            };
        });
    }

    /**
     * 100% Zero-Trust Atomic Wheel Spin:
     * - Prevents double-spend / replay / race conditions via idempotency + per-user lock + conditional $gte atomic deduction
     * - Uses crypto.randomInt for server-authoritative RNG
     * - Credits won Gold Coins atomically into main User.coins wallet + Redis cache + NewopUserControl + WalletTransaction
     */
    static async spin(rawUid, clientTxId = '') {
        const userDoc = await requireCanonicalUser(rawUid);
        const todayKey = getTodayISTDateKey();
        const txId = (clientTxId && String(clientTxId).trim()) || crypto.randomUUID();

        if (clientTxId && !cacheService.checkAndMarkIdempotency(`spin:${userDoc.uid}:${txId}`, 60000)) {
            return {
                success: false,
                status: 409,
                message: 'Duplicate spin request blocked by 0-Trust guard.'
            };
        }

        return await cacheService.withUserLock(userDoc.uid, async () => {
            await this._ensureTodayRecord(userDoc.uid, userDoc.numericId);

            // 1. Atomic Conditional Deduction (Free Spin first, else 2000 Daily Points)
            let usedFreeSpin = false;
            let postDeductTaskUser = await DailyTaskUser.findOneAndUpdate(
                { uid: userDoc.uid, freeSpinsAvailable: { $gte: 1 } },
                { $inc: { freeSpinsAvailable: -1 }, $set: { updatedAt: new Date() } },
                { new: true }
            ).lean();

            if (postDeductTaskUser) {
                usedFreeSpin = true;
            } else {
                postDeductTaskUser = await DailyTaskUser.findOneAndUpdate(
                    { uid: userDoc.uid, pointsBalance: { $gte: SPIN_COST_POINTS } },
                    { $inc: { pointsBalance: -SPIN_COST_POINTS }, $set: { updatedAt: new Date() } },
                    { new: true }
                ).lean();
            }

            if (!postDeductTaskUser) {
                const currentTaskUser = await DailyTaskUser.findOne({ uid: userDoc.uid }).lean();
                return {
                    success: false,
                    status: 400,
                    pointsBalance: Math.max(0, Number(currentTaskUser?.pointsBalance) || 0),
                    freeSpinsAvailable: Math.max(0, Number(currentTaskUser?.freeSpinsAvailable) || 0),
                    message: 'Spin karne ke liye 2,000 Daily Points ki zaroorat hai!'
                };
            }

            // 2. Cryptographic Server-Authoritative RNG
            const sector = rollServerRNGSector();
            let finalTaskUser = postDeductTaskUser;
            let coinsAwarded = 0;

            if (sector.type === 'free_spin') {
                finalTaskUser = await DailyTaskUser.findOneAndUpdate(
                    { uid: userDoc.uid },
                    { $inc: { freeSpinsAvailable: 1 }, $set: { updatedAt: new Date() } },
                    { new: true }
                ).lean() || postDeductTaskUser;
            } else if (sector.points > 0) {
                coinsAwarded = sector.points;
            }

            // 3. Atomic Credit to Main User Gold Coin Wallet (users.coins)
            let updatedCoinBalance = Math.max(0, Number(userDoc.coins) || 0);
            if (coinsAwarded > 0) {
                let updatedUser = null;
                try {
                    updatedUser = await User.findOneAndUpdate(
                        { uid: userDoc.uid },
                        { $inc: { coins: coinsAwarded }, $set: { updatedAt: new Date() } },
                        { new: true }
                    ).lean();
                } catch (creditErr) {
                    updatedUser = null;
                    console.error('❌ [DailyTask Spin] Error crediting User.coins:', creditErr.message);
                }

                if (!updatedUser) {
                    // Compensating atomic rollback of deducted spin cost if wallet credit fails
                    const rollbackInc = usedFreeSpin ? { freeSpinsAvailable: 1 } : { pointsBalance: SPIN_COST_POINTS };
                    await DailyTaskUser.findOneAndUpdate(
                        { uid: userDoc.uid },
                        { $inc: rollbackInc, $set: { updatedAt: new Date() } }
                    ).catch(() => {});
                    throw new Error('Failed to credit Gold Coins atomically. Spin points refunded.');
                }

                updatedCoinBalance = Math.max(0, Number(updatedUser.coins) || 0);

                // Sync Redis hot wallet cache so gift engine sees newly won coins in 0ms
                await cacheService.syncWalletCache(userDoc.uid, updatedCoinBalance, updatedUser.diamonds);

                // Keep NewopUserControl & legacy Wallet synced with authoritative User.coins
                const NewopUserControl = mongoose.models.NewopUserControl;
                if (NewopUserControl) {
                    await NewopUserControl.findOneAndUpdate(
                        { uid: userDoc.uid },
                        { $set: { goldCoin: updatedCoinBalance, diamond: Number(updatedUser.diamonds) || 0, updatedAt: new Date() } },
                        { upsert: true }
                    ).catch(() => {});
                }
                await Wallet.findOneAndUpdate(
                    { uid: userDoc.uid },
                    { $set: { coins: updatedCoinBalance, numericId: userDoc.numericId, updatedAt: new Date() } },
                    { upsert: true }
                ).catch(() => {});

                // Immutable Wallet Passbook Ledger Entry
                WalletTransaction.create({
                    txId,
                    type: 'DAILY_TASK_WHEEL_WIN',
                    senderUid: userDoc.uid,
                    receiverUid: userDoc.uid,
                    giftName: `Daily Task Wheel (${sector.label} ${sector.sublabel})`,
                    coinsDelta: coinsAwarded,
                    diamondsDelta: 0,
                    senderCoinsAfter: updatedCoinBalance,
                    senderDiamondsAfter: Number(updatedUser.diamonds) || 0
                }).catch(() => {});
            } else {
                const latestUser = await User.findOne({ uid: userDoc.uid }).lean();
                updatedCoinBalance = Math.max(0, Number(latestUser?.coins) || 0);
            }

            // 4. Record DailyTask Audit Log
            await DailyTaskLog.create({
                uid: userDoc.uid,
                actionType: coinsAwarded > 0 ? 'SPIN_COIN_WIN' : 'SPIN_FREE_TICKET',
                dateKey: todayKey,
                pointsDelta: usedFreeSpin ? 0 : -SPIN_COST_POINTS,
                coinsDelta: coinsAwarded,
                freeSpinsDelta: usedFreeSpin ? (sector.type === 'free_spin' ? 0 : -1) : (sector.type === 'free_spin' ? 1 : 0),
                details: {
                    txId,
                    sectorId: sector.id,
                    sectorLabel: sector.label,
                    sectorSublabel: sector.sublabel,
                    usedFreeSpin
                }
            });

            return {
                success: true,
                txId,
                sector,
                usedFreeSpin,
                newPointsBalance: Math.max(0, Number(finalTaskUser?.pointsBalance) || 0),
                newCoinBalance: updatedCoinBalance,
                freeSpinsAvailable: Math.max(0, Number(finalTaskUser?.freeSpinsAvailable) || 0)
            };
        });
    }
}

module.exports = DailyTaskService;
