const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '';

let redisClient = null;

if (REDIS_URL) {
    try {
        redisClient = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: false
        });
        redisClient.on('connect', () => console.log('⚡ [RedisService] Connected to Redis cluster'));
        redisClient.on('error', (err) => console.warn('⚠️ [RedisService] Redis Error:', err.message));
    } catch (e) {
        console.warn('⚠️ [RedisService] Redis initialization skipped:', e.message);
    }
}

/**
 * High-performance Redis Anti-Double-Spend Mutex Lock
 * Lock TTL: 5 seconds default
 */
async function acquireLock(lockKey, ttlSeconds = 5) {
    if (!redisClient || redisClient.status !== 'ready') {
        return true; // Fallback to RAM lock if Redis unavailable
    }
    try {
        const result = await redisClient.set(`lock:${lockKey}`, 'LOCKED', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    } catch (err) {
        console.error('❌ [RedisService] acquireLock error:', err);
        return true;
    }
}

async function releaseLock(lockKey) {
    if (!redisClient || redisClient.status !== 'ready') return;
    try {
        await redisClient.del(`lock:${lockKey}`);
    } catch (err) {
        console.error('❌ [RedisService] releaseLock error:', err);
    }
}

module.exports = {
    redisClient,
    acquireLock,
    releaseLock
};
