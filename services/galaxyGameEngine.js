const crypto = require('crypto');
const Wallet = require('../models/Wallet');
const GameRound = require('../models/GameRound');
const GameBet = require('../models/GameBet');
const cacheService = require('./cacheService');

// ============================================================================
// 8 PLANETS CONFIGURATION (Identical to Client Engine)
// ============================================================================
const PLANETS = [
    { id: 0, name: 'Mercury', multiplier: 5, weight: 15 },
    { id: 1, name: 'Venus', multiplier: 5, weight: 15 },
    { id: 2, name: 'Earth', multiplier: 3, weight: 35 },
    { id: 3, name: 'Mars', multiplier: 5, weight: 20 },
    { id: 4, name: 'Jupiter', multiplier: 10, weight: 8 },
    { id: 5, name: 'Neptune', multiplier: 15, weight: 4 },
    { id: 6, name: 'Uranus', multiplier: 25, weight: 2 },
    { id: 7, name: 'Saturn', multiplier: 50, weight: 1 }
];

// Phase Durations in Seconds
const DURATION_BETTING = 15;
const DURATION_LOCKED = 10;
const DURATION_RESULT = 5;
const TOTAL_CYCLE_SECONDS = DURATION_BETTING + DURATION_LOCKED + DURATION_RESULT; // 30s

// Redis Atomic Lua Script for Sub-Millisecond Zero-Trust Bet Placement
const LUA_ATOMIC_BET = `
local idempotencyKey = KEYS[1]
local walletKey = KEYS[2]
local stateKey = KEYS[3]
local poolKey = KEYS[4]
local planetTotalKey = KEYS[5]

local cost = tonumber(ARGV[1])
local uid = ARGV[2]

if redis.call("EXISTS", idempotencyKey) == 1 then
    return {-1, 0} -- DUPLICATE_TX
end

local state = redis.call("GET", stateKey)
if state ~= "BETTING" then
    return {-2, 0} -- ROUND_LOCKED_OR_ENDED
end

local bal = tonumber(redis.call("GET", walletKey) or "-1")
if bal < cost then
    return {-3, bal} -- INSUFFICIENT_BALANCE
end

redis.call("SETEX", idempotencyKey, 300, "1")
local newBal = redis.call("DECRBY", walletKey, cost)
redis.call("HINCRBY", poolKey, uid, cost)
redis.call("INCRBY", planetTotalKey, cost)

return {1, newBal}
`;

class GalaxyGameEngine {
    constructor() {
        this.roundId = Math.floor(Date.now() / 30000); // 30s epoch counter
        this.phase = 'BETTING'; // 'BETTING', 'LOCKED', 'RESULT'
        this.timeLeft = DURATION_BETTING;
        this.winningPlanet = null;
        this.planetPools = {}; // planetId -> totalCoins
        this.currentRoundBets = []; // in-memory current bets
        this.connectedClients = new Set();
        this.history = [2, 3, 2, 0, 1, 2, 4, 2]; // Default recent winners

        this.resetPlanetPools();
        this.startServerTicker();
    }

    resetPlanetPools() {
        this.planetPools = {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0
        };
        this.currentRoundBets = [];
    }

    // ========================================================================
    // 24/7 SERVER-AUTHORITATIVE TICKER (30 Seconds Continuous Loop)
    // ========================================================================
    startServerTicker() {
        console.log(`🌌 [GalaxyEngine] 24/7 Authoritative Game Engine initialized on Round #${this.roundId}`);
        this.syncStateToRedis();

        setInterval(() => {
            this.timeLeft--;

            if (this.phase === 'BETTING') {
                if (this.timeLeft <= 0) {
                    this.transitionToLocked();
                }
            } else if (this.phase === 'LOCKED') {
                if (this.timeLeft <= 0) {
                    this.transitionToResult();
                }
            } else if (this.phase === 'RESULT') {
                if (this.timeLeft <= 0) {
                    this.startNewRound();
                }
            }

            this.broadcastTick();
        }, 1000);
    }

    transitionToLocked() {
        this.phase = 'LOCKED';
        this.timeLeft = DURATION_LOCKED;

        // Select Authoritative Winning Planet via PRNG
        this.winningPlanet = this.determineWinningPlanet();
        console.log(`🎯 [GalaxyEngine] Round #${this.roundId} LOCKED. Winner selected: ${this.winningPlanet.name} (${this.winningPlanet.multiplier}X)`);

        this.syncStateToRedis();
        this.broadcast({
            event: 'ROUND_LOCKED',
            roundId: this.roundId,
            timeLeft: this.timeLeft,
            winnerPlanet: this.winningPlanet,
            planetPools: this.planetPools
        });
    }

    async transitionToResult() {
        this.phase = 'RESULT';
        this.timeLeft = DURATION_RESULT;

        // Update History
        this.history.unshift(this.winningPlanet.id);
        if (this.history.length > 20) this.history.pop();

        // Atomic Multi-Winner Settlement
        const settlement = await this.settleRoundPayouts();

        this.syncStateToRedis();
        this.broadcast({
            event: 'ROUND_RESULT',
            roundId: this.roundId,
            winningPlanet: this.winningPlanet,
            totalPayout: settlement.totalPayout,
            topWinners: settlement.topWinners,
            history: this.history.slice(0, 10)
        });
    }

    startNewRound() {
        this.roundId++;
        this.phase = 'BETTING';
        this.timeLeft = DURATION_BETTING;
        this.winningPlanet = null;
        this.resetPlanetPools();

        this.syncStateToRedis();
        console.log(`🚀 [GalaxyEngine] Started new live Round #${this.roundId}`);
        this.broadcast({
            event: 'ROUND_START',
            roundId: this.roundId,
            phase: this.phase,
            timeLeft: this.timeLeft,
            history: this.history.slice(0, 10),
            planetPools: this.planetPools
        });
    }

    determineWinningPlanet() {
        const totalWeight = PLANETS.reduce((acc, p) => acc + p.weight, 0);
        let randomRoll = Math.floor(Math.random() * totalWeight);

        for (const planet of PLANETS) {
            if (randomRoll < planet.weight) {
                return planet;
            }
            randomRoll -= planet.weight;
        }
        return PLANETS[2]; // Default to Earth (3X)
    }

    // ========================================================================
    // ATOMIC ZERO-TRUST BET PLACEMENT (Redis + Mongo Fallback)
    // ========================================================================
    async placeBet({ uid, numericId, userName, userAvatar, planetId, amount, txId }) {
        if (!uid || planetId === undefined || !amount || amount <= 0) {
            throw new Error('Invalid bet parameters');
        }

        const pId = parseInt(planetId);
        if (pId < 0 || pId > 7) {
            throw new Error('Invalid planet index (0-7)');
        }

        if (this.phase !== 'BETTING') {
            throw new Error('Round is currently locked or settling');
        }

        const cleanTxId = txId || `tx_${uid}_${this.roundId}_${pId}_${Date.now()}`;
        const betAmount = parseInt(amount);

        const redis = cacheService.redisClient;

        // PATH A: High-Speed Redis Lua Execution
        if (redis && redis.status === 'ready') {
            const idempotencyKey = `game:idempotency:${cleanTxId}`;
            const walletKey = `user:wallet:${uid}`;
            const stateKey = `game:galaxy:round:${this.roundId}:state`;
            const poolKey = `game:galaxy:round:${this.roundId}:planet:${pId}:bets`;
            const planetTotalKey = `game:galaxy:round:${this.roundId}:planet:${pId}:total`;

            // Warm up wallet in Redis if not cached
            const cachedBal = await redis.get(walletKey);
            if (cachedBal === null) {
                const w = await Wallet.findOne({ uid });
                const coins = w ? w.coins : 0;
                await redis.set(walletKey, coins, 'EX', 3600);
            }

            const luaRes = await redis.eval(
                LUA_ATOMIC_BET,
                5,
                idempotencyKey,
                walletKey,
                stateKey,
                poolKey,
                planetTotalKey,
                betAmount,
                uid
            );

            const [status, newBal] = luaRes;
            if (status === -1) throw new Error('Duplicate transaction ID');
            if (status === -2) throw new Error('Round is no longer accepting bets');
            if (status === -3) throw new Error('Insufficient wallet coins');

            // Record locally for live broadcast
            this.planetPools[pId] = (this.planetPools[pId] || 0) + betAmount;
            this.currentRoundBets.push({
                roundId: this.roundId,
                uid,
                numericId,
                userName: userName || 'Player',
                userAvatar: userAvatar || '',
                planetId: pId,
                amount: betAmount,
                txId: cleanTxId,
                timestamp: new Date()
            });

            // Async background deduction in MongoDB
            Wallet.updateOne({ uid }, { $inc: { coins: -betAmount } }).catch(err => {
                console.error(`⚠️ [GalaxyEngine] Mongo Wallet Sync Error:`, err.message);
            });

            this.broadcastBetPlaced(pId, betAmount, uid, userName);

            return {
                success: true,
                roundId: this.roundId,
                planetId: pId,
                betAmount,
                remainingCoins: newBal,
                txId: cleanTxId
            };
        }

        // PATH B: Zero-Trust Mongo Atomic Fallback ($inc with $gte filter)
        const updatedWallet = await Wallet.findOneAndUpdate(
            { uid, coins: { $gte: betAmount } },
            { $inc: { coins: -betAmount }, $set: { updatedAt: new Date() } },
            { new: true }
        );

        if (!updatedWallet) {
            throw new Error('Insufficient wallet coins');
        }

        this.planetPools[pId] = (this.planetPools[pId] || 0) + betAmount;
        this.currentRoundBets.push({
            roundId: this.roundId,
            uid,
            numericId,
            userName: userName || 'Player',
            userAvatar: userAvatar || '',
            planetId: pId,
            amount: betAmount,
            txId: cleanTxId,
            timestamp: new Date()
        });

        this.broadcastBetPlaced(pId, betAmount, uid, userName);

        return {
            success: true,
            roundId: this.roundId,
            planetId: pId,
            betAmount,
            remainingCoins: updatedWallet.coins,
            txId: cleanTxId
        };
    }

    // ========================================================================
    // ATOMIC MULTI-WINNER PAYOUT SETTLEMENT
    // ========================================================================
    async settleRoundPayouts() {
        const winningId = this.winningPlanet.id;
        const multiplier = this.winningPlanet.multiplier;
        let totalPayout = 0;
        let topWinners = [];

        const winningBets = this.currentRoundBets.filter(b => b.planetId === winningId);
        const redis = cacheService.redisClient;

        for (const bet of winningBets) {
            const payout = bet.amount * multiplier;
            totalPayout += payout;

            // Credit in Redis
            if (redis && redis.status === 'ready') {
                redis.incrby(`user:wallet:${bet.uid}`, payout);
            }

            // Credit in MongoDB
            Wallet.updateOne(
                { uid: bet.uid },
                { $inc: { coins: payout }, $set: { updatedAt: new Date() } }
            ).catch(e => console.error('Payout Mongo Sync Error:', e.message));

            topWinners.push({
                uid: bet.uid,
                name: bet.userName,
                avatar: bet.userAvatar,
                payout
            });
        }

        topWinners.sort((a, b) => b.payout - a.payout);

        // Save round history asynchronously
        try {
            const totalBetPool = Object.values(this.planetPools).reduce((a, b) => a + b, 0);
            await GameRound.create({
                gameId: 'galaxy_star',
                roundId: this.roundId,
                winningPlanet: this.winningPlanet.name,
                multiplier: this.winningPlanet.multiplier,
                totalBetPool,
                totalPayout,
                planetPools: this.planetPools,
                status: 'COMPLETED'
            });

            if (this.currentRoundBets.length > 0) {
                const betsToSave = this.currentRoundBets.map(b => ({
                    roundId: b.roundId,
                    gameId: 'galaxy_star',
                    uid: b.uid,
                    numericId: b.numericId,
                    userName: b.userName,
                    userAvatar: b.userAvatar,
                    planet: PLANETS[b.planetId].name,
                    betAmount: b.amount,
                    txId: b.txId,
                    isWinner: b.planetId === winningId,
                    payoutAmount: b.planetId === winningId ? (b.amount * multiplier) : 0,
                    status: 'SETTLED'
                }));
                await GameBet.insertMany(betsToSave);
            }
        } catch (dbErr) {
            console.error('⚠️ [GalaxyEngine] Error persisting round history:', dbErr.message);
        }

        return { totalPayout, topWinners: topWinners.slice(0, 3) };
    }

    // ========================================================================
    // WEBSOCKET BROADCASTING & REALTIME SYNC
    // ========================================================================
    syncStateToRedis() {
        const redis = cacheService.redisClient;
        if (redis && redis.status === 'ready') {
            redis.set(`game:galaxy:round:${this.roundId}:state`, this.phase, 'EX', 60);
            redis.set('game:galaxy:active:roundId', this.roundId, 'EX', 86400);
        }
    }

    broadcast(data) {
        const payload = JSON.stringify(data);
        for (const ws of this.connectedClients) {
            if (ws.readyState === 1 /* OPEN */) {
                try { ws.send(payload); } catch (_) {}
            }
        }
    }

    broadcastTick() {
        this.broadcast({
            event: 'TICK',
            roundId: this.roundId,
            phase: this.phase,
            timeLeft: this.timeLeft,
            planetPools: this.planetPools
        });
    }

    broadcastBetPlaced(planetId, amount, uid, userName) {
        this.broadcast({
            event: 'BET_UPDATE',
            planetId,
            amount,
            totalPlanetPool: this.planetPools[planetId],
            uid,
            userName
        });
    }

    getSnapshotState(uid) {
        return {
            roundId: this.roundId,
            phase: this.phase,
            timeLeft: this.timeLeft,
            winningPlanet: this.winningPlanet,
            planetPools: this.planetPools,
            history: this.history.slice(0, 10),
            totalCycleSeconds: TOTAL_CYCLE_SECONDS
        };
    }
}

// Singleton export
module.exports = new GalaxyGameEngine();
