const DailyTaskUser = require('../models/DailyTaskUser');
const DailyTaskLog = require('../models/DailyTaskLog');
const Wallet = require('../models/Wallet');

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
 * Returns yesterday's IST date key
 */
function getPreviousISTDateKey(dateKey) {
    const d = new Date(dateKey);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * Selects a winning sector using server-authoritative RNG weights
 */
function rollServerRNGSector() {
    const totalWeight = WHEEL_SECTORS.reduce((sum, s) => sum + s.weight, 0);
    let rand = Math.floor(Math.random() * totalWeight);
    for (const sec of WHEEL_SECTORS) {
        if (rand < sec.weight) {
            return sec;
        }
        rand -= sec.weight;
    }
    return WHEEL_SECTORS[0];
}

class DailyTaskService {
    /**
     * Retrieves or initializes user daily task record with midnight reset logic
     */
    static async getOrCreateUser(uid, numericId = 0) {
        const todayKey = getTodayISTDateKey();
        let user = await DailyTaskUser.findOne({ uid });

        if (!user) {
            user = await DailyTaskUser.create({
                uid,
                numericId: Number(numericId) || 0,
                currentDateKey: todayKey,
                pointsBalance: 0,
                totalPointsEarned: 0,
                freeSpinsAvailable: 0,
                consecutiveDays: 1,
                lastLoginDateKey: ""
            });
            return user;
        }

        // Midnight Day Rollover Check
        if (user.currentDateKey !== todayKey) {
            const yesterdayKey = getPreviousISTDateKey(todayKey);
            const isConsecutive = (user.lastLoginDateKey === yesterdayKey);

            user.consecutiveDays = isConsecutive ? user.consecutiveDays + 1 : 1;
            user.currentDateKey = todayKey;
            user.dailyLoginClaimed = false;
            user.dailyLoginPoints = 0;
            user.micSecondsToday = 0;
            user.micTaskClaimed = false;
            user.micTaskPoints = 0;
            user.updatedAt = new Date();
            await user.save();
        }

        return user;
    }

    /**
     * Returns full status object formatted for H5 / Client UI
     */
    static async getStatus(uid, numericId = 0) {
        const user = await this.getOrCreateUser(uid, numericId);
        const micMinutes = Math.floor(user.micSecondsToday / 60);
        const micPercentage = Math.min(100, Math.round((micMinutes / 60) * 100));

        // Fetch current coin balance from Wallets collection
        const wallet = await Wallet.findOne({ uid });
        const currentCoins = wallet ? wallet.coins : 0;

        return {
            pointsBalance: user.pointsBalance,
            freeSpinsAvailable: user.freeSpinsAvailable,
            consecutiveDays: user.consecutiveDays,
            currentCoins,
            tasks: {
                dailyLogin: {
                    claimed: user.dailyLoginClaimed,
                    canClaim: !user.dailyLoginClaimed,
                    pointsEarned: user.dailyLoginPoints,
                    minReward: 200,
                    maxReward: 500
                },
                mic60Min: {
                    claimed: user.micTaskClaimed,
                    canClaim: !user.micTaskClaimed && micMinutes >= 60,
                    currentMinutes: micMinutes,
                    targetMinutes: 60,
                    percentage: micPercentage,
                    pointsEarned: user.micTaskPoints,
                    minReward: 500,
                    maxReward: 1000
                }
            }
        };
    }

    /**
     * Claims Daily Login reward (200 - 500 points, 24h once / midnight reset)
     */
    static async claimDailyLogin(uid) {
        const todayKey = getTodayISTDateKey();
        const user = await this.getOrCreateUser(uid);

        if (user.currentDateKey === todayKey && user.dailyLoginClaimed) {
            return {
                success: false,
                message: 'Aaj ka daily login task already claim ho chuka hai! Kal raat 12 baje dobara aayega.'
            };
        }

        // Random 200 - 500 Daily Points
        const awardedPoints = Math.floor(Math.random() * (500 - 200 + 1)) + 200;

        user.dailyLoginClaimed = true;
        user.dailyLoginPoints = awardedPoints;
        user.lastLoginDateKey = todayKey;
        user.pointsBalance += awardedPoints;
        user.totalPointsEarned += awardedPoints;
        user.updatedAt = new Date();
        await user.save();

        await DailyTaskLog.create({
            uid,
            actionType: 'CLAIM_LOGIN',
            dateKey: todayKey,
            pointsDelta: awardedPoints,
            details: { points: awardedPoints }
        });

        return {
            success: true,
            awardedPoints,
            newPointsBalance: user.pointsBalance,
            message: `Badhai ho! Aapko ${awardedPoints} Daily Points mile!`
        };
    }

    /**
     * Records elapsed mic seconds for user currently on a seat in a voice room
     */
    static async recordMicTime(uid, seconds) {
        if (!uid || seconds <= 0) return;
        const todayKey = getTodayISTDateKey();
        await this.getOrCreateUser(uid);

        await DailyTaskUser.findOneAndUpdate(
            { uid, currentDateKey: todayKey },
            { 
                $inc: { micSecondsToday: Math.min(seconds, 3600) },
                $set: { updatedAt: new Date() }
            }
        );
    }

    /**
     * Claims 60-Minute on Mic reward (500 - 1000 points once 60m are completed)
     */
    static async claimMicTask(uid) {
        const todayKey = getTodayISTDateKey();
        const user = await this.getOrCreateUser(uid);

        if (user.micTaskClaimed) {
            return {
                success: false,
                message: 'Mic task already claim ho chuka hai!'
            };
        }

        const micMinutes = Math.floor(user.micSecondsToday / 60);
        if (micMinutes < 60) {
            return {
                success: false,
                message: `Abhi sirf ${micMinutes}/60 minute hue hain. 60 minute pure hone ke baad hi claim kar sakte hain.`
            };
        }

        // Random 500 - 1000 Daily Points
        const awardedPoints = Math.floor(Math.random() * (1000 - 500 + 1)) + 500;

        user.micTaskClaimed = true;
        user.micTaskPoints = awardedPoints;
        user.pointsBalance += awardedPoints;
        user.totalPointsEarned += awardedPoints;
        user.updatedAt = new Date();
        await user.save();

        await DailyTaskLog.create({
            uid,
            actionType: 'CLAIM_MIC_60M',
            dateKey: todayKey,
            pointsDelta: awardedPoints,
            details: { points: awardedPoints, micMinutes }
        });

        return {
            success: true,
            awardedPoints,
            newPointsBalance: user.pointsBalance,
            message: `Shandaar! Mic par 60 min complete karne par aapko ${awardedPoints} Daily Points mile!`
        };
    }

    /**
     * Executes atomic wheel spin:
     * - Requires 2000 Points OR 1 Free Spin
     * - Server-Authoritative RNG Sector determination
     * - Atomic Wallet Gold Coins credit
     */
    static async spin(uid) {
        const todayKey = getTodayISTDateKey();
        const user = await this.getOrCreateUser(uid);

        const hasFreeSpin = user.freeSpinsAvailable > 0;
        if (!hasFreeSpin && user.pointsBalance < 2000) {
            return {
                success: false,
                message: 'Spin karne ke liye 2,000 Daily Points ki zaroorat hai!'
            };
        }

        // 1. Deduct cost
        if (hasFreeSpin) {
            user.freeSpinsAvailable -= 1;
        } else {
            user.pointsBalance -= 2000;
        }

        // 2. Server-Authoritative RNG
        const sector = rollServerRNGSector();
        let coinsAwarded = 0;

        if (sector.type === 'free_spin') {
            user.freeSpinsAvailable += 1;
        } else if (sector.points > 0) {
            coinsAwarded = sector.points;
        }

        user.updatedAt = new Date();
        await user.save();

        // 3. Atomic credit to main user wallet
        let updatedCoinBalance = 0;
        if (coinsAwarded > 0) {
            const wallet = await Wallet.findOneAndUpdate(
                { uid },
                { $inc: { coins: coinsAwarded }, $set: { updatedAt: new Date() } },
                { upsert: true, new: true }
            );
            updatedCoinBalance = wallet ? wallet.coins : 0;
        } else {
            const wallet = await Wallet.findOne({ uid });
            updatedCoinBalance = wallet ? wallet.coins : 0;
        }

        // 4. Record audit log
        await DailyTaskLog.create({
            uid,
            actionType: coinsAwarded > 0 ? 'SPIN_COIN_WIN' : 'SPIN_FREE_TICKET',
            dateKey: todayKey,
            pointsDelta: hasFreeSpin ? 0 : -2000,
            coinsDelta: coinsAwarded,
            details: {
                sectorId: sector.id,
                sectorLabel: sector.label,
                sectorSublabel: sector.sublabel,
                hasFreeSpinUsed: hasFreeSpin
            }
        });

        return {
            success: true,
            sector,
            newPointsBalance: user.pointsBalance,
            newCoinBalance: updatedCoinBalance,
            freeSpinsAvailable: user.freeSpinsAvailable
        };
    }
}

module.exports = DailyTaskService;