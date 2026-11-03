const { acquireLock, releaseLock } = require('../services/redis.js');
const cacheService = require('../services/cacheService');

/**
 * Anti-Double-Spend & Idempotency Express Middleware
 * Protects Merchant recharge and transfer operations
 */
async function idempotencyLockMiddleware(req, res, next) {
    const { merchantUid, targetUserId, idempotencyKey } = req.body;
    const key = idempotencyKey || `${merchantUid || 'anon'}_${targetUserId || 'anon'}_${req.body.coins || 0}`;

    // 1. Check RAM Idempotency
    if (!cacheService.checkAndMarkIdempotency(key)) {
        return res.status(409).json({
            success: false,
            message: 'Duplicate recharge request blocked by Idempotency Lock'
        });
    }

    // 2. Check Redis Lock
    const lockKey = `recharge:${merchantUid || 'global'}`;
    const acquired = await acquireLock(lockKey, 5);

    if (!acquired) {
        return res.status(429).json({
            success: false,
            message: 'Concurrent recharge request in progress. Please wait 3 seconds.'
        });
    }

    // Release lock after response finishes
    res.on('finish', () => {
        releaseLock(lockKey).catch(() => {});
    });

    next();
}

module.exports = {
    idempotencyLockMiddleware
};