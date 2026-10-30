const express = require('express');
const router = express.Router();
const User = require('../models/User');
const giftService = require('../services/giftService');
const cacheService = require('../services/cacheService');

// ============================================================================
// 1. GET /api/wallet/:uid (or /api/wallet/balance/:uid)
// ============================================================================
async function handleGetWallet(req, res) {
    try {
        const rawId = req.params.uid;
        if (!rawId) return res.status(400).json({ success: false, error: 'Missing UID' });

        const user = await giftService.resolveUser(rawId);
        if (!user) {
            return res.status(404).json({ success: false, coins: 0, diamonds: 0, error: 'User not found' });
        }

        const coins = Math.max(0, Number(user.coins) || 0);
        const diamonds = Math.max(0, Number(user.diamonds) || 0);

        // Warm cache
        cacheService.syncWalletCache(user.uid, coins, diamonds);

        return res.json({
            success: true,
            uid: user.uid,
            numericId: user.numericId,
            coins,
            diamonds
        });
    } catch (e) {
        console.error('[Wallet Route] GET wallet balance error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

router.get('/:uid', handleGetWallet);
router.get('/wallet/:uid', handleGetWallet);
router.get('/balance/:uid', handleGetWallet);

// ============================================================================
// 2. POST /api/wallet/send-gift & POST /api/gift/send
// ============================================================================
async function handleSendGift(req, res) {
    try {
        const result = await giftService.sendGift(req.body);
        return res.json(result);
    } catch (e) {
        console.error('[Wallet Route] Send gift error:', e.message);
        const status = e.status || 500;
        return res.status(status).json({
            success: false,
            message: e.message,
            remainingCoins: e.remainingCoins
        });
    }
}

router.post('/send-gift', handleSendGift);
router.post('/gift/send', handleSendGift);

// ============================================================================
// 3. POST /api/wallet/send-multi & POST /api/gift/send-multi
// ============================================================================
async function handleSendMultiGift(req, res) {
    try {
        const result = await giftService.sendMultiGift(req.body);
        return res.json(result);
    } catch (e) {
        console.error('[Wallet Route] Send multi gift error:', e.message);
        const status = e.status || 500;
        return res.status(status).json({
            success: false,
            message: e.message,
            remainingCoins: e.remainingCoins
        });
    }
}

router.post('/send-multi', handleSendMultiGift);
router.post('/gift/send-multi', handleSendMultiGift);

// ============================================================================
// 4. POST /api/wallet/convert
// ============================================================================
router.post('/convert', async (req, res) => {
    try {
        const result = await giftService.convertDiamondsToCoins(req.body);
        return res.json(result);
    } catch (e) {
        console.error('[Wallet Route] Convert diamonds error:', e.message);
        const status = e.status || 500;
        return res.status(status).json({ success: false, message: e.message });
    }
});

// ============================================================================
// 5. POST /api/wallet/withdraw
// ============================================================================
router.post('/withdraw', async (req, res) => {
    try {
        const result = await giftService.withdrawDiamonds(req.body);
        return res.json(result);
    } catch (e) {
        console.error('[Wallet Route] Withdraw diamonds error:', e.message);
        const status = e.status || 500;
        return res.status(status).json({ success: false, message: e.message });
    }
});

router.syncRedisWallet = cacheService.syncWalletCache;

module.exports = router;
module.exports.syncRedisWallet = cacheService.syncWalletCache;