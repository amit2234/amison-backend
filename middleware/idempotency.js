const { acquireLock, releaseLock } = require('../services/redis.js');
const cacheService = require('../services/cacheService');

/**
 * Anti-Double-Spend & Idempotency Express Middleware
 * Protects Merchant recharge and transfer operations
 */
async function idempotencyLockMiddleware(req, res, next) {
    const { merchantUid, targetUserId, coins, transferType } = req.body;
    
    // Construct rate-limit key for identical recharge: same merchant + target user + coin amount + transfer type
    const rateLimitKey = `recharge_rate_${merchantUid || 'anon'}_${targetUserId || 'anon'}_${coins || 0}_${transferType || 'COINS'}`;

    // 1. Check RAM Idempotency with 1 minute (60,000 ms) cool-down window
    if (!cacheService.checkAndMarkIdempotency(rateLimitKey, 60000)) {
        return res.status(429).json({
            success: false,
            message: 'Please wait 1 minute before repeating the same recharge amount to this user'
        });
    }

    // 2. Check Redis Lock for brief concurrency (3 sec)
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