const express = require('express');
const router = express.Router();
const DailyTaskService = require('../services/dailyTaskService');
const { verifyStrictFirebaseToken } = require('../middleware/authMiddleware');

/**
 * GET /api/daily-task/status
 * Fetches authoritative Daily Task Points, 60m mic progress percentage, free spins, and real Wallet Gold Coins
 */
router.get('/status', verifyStrictFirebaseToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const status = await DailyTaskService.getStatus(uid);
        return res.json({ success: true, data: status });
    } catch (e) {
        const statusCode = e.status || 500;
        if (statusCode >= 500) console.error('❌ [DailyTask] Error getting status:', e);
        return res.status(statusCode).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/claim-login
 * Claims 200 - 500 Daily Points (once per IST day, 100% atomic)
 */
router.post('/claim-login', verifyStrictFirebaseToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const result = await DailyTaskService.claimDailyLogin(uid);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (e) {
        const statusCode = e.status || 500;
        if (statusCode >= 500) console.error('❌ [DailyTask] Error claiming daily login:', e);
        return res.status(statusCode).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/claim-mic
 * Claims 500 - 1000 Daily Points once server-verified 60 minutes on mic are completed
 */
router.post('/claim-mic', verifyStrictFirebaseToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const result = await DailyTaskService.claimMicTask(uid);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (e) {
        const statusCode = e.status || 500;
        if (statusCode >= 500) console.error('❌ [DailyTask] Error claiming mic task:', e);
        return res.status(statusCode).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/spin
 * 100% Zero-Trust Atomic Wheel Spin:
 * Deducts 2000 Daily Points (or 1 Free Spin), rolls crypto RNG, and credits Gold Coins directly into User.coins
 */
router.post('/spin', verifyStrictFirebaseToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const clientTxId = req.body?.txId || req.headers['x-idempotency-key'] || '';
        const result = await DailyTaskService.spin(uid, clientTxId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (e) {
        const statusCode = e.status || 500;
        if (statusCode >= 500) console.error('❌ [DailyTask] Error spinning wheel:', e);
        return res.status(statusCode).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/heartbeat-mic
 * Zero-Trust mic heartbeat: Ignores client-sent seconds and flushes only genuine server-verified room seat time
 */
router.post('/heartbeat-mic', verifyStrictFirebaseToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const result = await DailyTaskService.heartbeatMicFromRoomSeat(uid);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (e) {
        const statusCode = e.status || 500;
        return res.status(statusCode).json({ success: false, error: e.message });
    }
});

module.exports = router;
