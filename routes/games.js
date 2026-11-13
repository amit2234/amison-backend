const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');
const galaxyGameEngine = require('../services/galaxyGameEngine');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const cacheService = require('../services/cacheService');

const { requireNewopAdmin, verifyAuthenticatedUser } = require('../middleware/authMiddleware');

router.use(verifyAuthenticatedUser);

// Basic Game CRUD
router.get('/', gameController.getGames);
router.post('/', requireNewopAdmin, gameController.addGame);
router.patch('/:gameId/status', requireNewopAdmin, gameController.toggleGameStatus);

// ============================================================================
// ZERO-TRUST GAME HANDSHAKE (Authenticates User & Warms up Redis Balance)
// ============================================================================
router.post('/auth/handshake', async (req, res) => {
    try {
        const uid = String(req.callerUid || '').trim();
        if (!uid) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        // Fetch User and Wallet from Mongo
        const user = await User.findOne({ uid }).lean();
        let wallet = await Wallet.findOne({ uid });
        if (!wallet) {
            wallet = await Wallet.create({ uid, coins: 0, diamonds: 0 });
        }

        // Warm up in Redis
        const redis = cacheService.redisClient;
        if (redis && redis.status === 'ready') {
            await redis.set(`user:wallet:${uid}`, wallet.coins, 'EX', 3600);
        }

        // Generate Short-lived session token (valid 1 hour)
        const sessionToken = `gtok_${uid}_${Date.now()}`;

        // Get 24/7 Server-Authoritative State
        const gameState = galaxyGameEngine.getSnapshotState(uid);

        res.status(200).json({
            success: true,
            sessionToken,
            user: {
                uid: user?.uid || uid,
                numericId: user?.numericId || wallet.numericId || 100000,
                name: user?.name || 'Player',
                avatar: user?.avatar || '',
                coins: wallet.coins
            },
            gameState
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================================
// ZERO-TRUST ATOMIC BET PLACEMENT (REST Fallback)
// ============================================================================
router.post('/galaxy_star/bet', async (req, res) => {
    try {
        const { numericId, userName, userAvatar, planetId, amount, txId } = req.body || {};
        const uid = String(req.callerUid || '').trim();
        const result = await galaxyGameEngine.placeBet({
            uid,
            numericId,
            userName,
            userAvatar,
            planetId,
            amount,
            txId
        });
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// GET CURRENT ROUND STATE
router.get('/galaxy_star/state', (req, res) => {
    const state = galaxyGameEngine.getSnapshotState();
    res.status(200).json({ success: true, state });
});

module.exports = router;
