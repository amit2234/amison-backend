const express = require('express');
const router = express.Router();
const DailyTaskService = require('../services/dailyTaskService');
const { verifyAuthToken } = require('../middleware/authMiddleware');

/**
 * GET /api/daily-task/status
 * Fetches user task progress, 60m mic progress percentage, points balance, and free spins
 */
router.get('/status', verifyAuthToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const numericId = req.query.numericId || req.user?.numericId || 0;
        const status = await DailyTaskService.getStatus(uid, numericId);
        return res.json({ success: true, data: status });
    } catch (e) {
        console.error('❌ [DailyTask] Error getting status:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/claim-login
 * Claims 200 - 500 Daily Points (24h once / midnight 00:00:00 rollover)
 */
router.post('/claim-login', verifyAuthToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const result = await DailyTaskService.claimDailyLogin(uid);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (e) {
        console.error('❌ [DailyTask] Error claiming daily login:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/claim-mic
 * Claims 500 - 1000 Daily Points once 60 minutes on mic are completed
 */
router.post('/claim-mic', verifyAuthToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const result = await DailyTaskService.claimMicTask(uid);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (e) {
        console.error('❌ [DailyTask] Error claiming mic task:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/spin
 * Atomic Wheel Spin: Deducts 2000 Daily Points (or 1 Free Spin) & rolls server RNG to award real Gold Coins
 */
router.post('/spin', verifyAuthToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const result = await DailyTaskService.spin(uid);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (e) {
        console.error('❌ [DailyTask] Error spinning wheel:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/daily-task/heartbeat-mic
 * Server/Room heartbeat recording elapsed mic seat seconds
 */
router.post('/heartbeat-mic', verifyAuthToken, async (req, res) => {
    try {
        const uid = req.callerUid;
        const seconds = Number(req.body.seconds) || 60;
        await DailyTaskService.recordMicTime(uid, seconds);
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;