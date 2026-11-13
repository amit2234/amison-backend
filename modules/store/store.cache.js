const cacheService = require('../../services/cacheService');
const { normalizeCategory } = require('./store.constants');

const REDIS_KEY_CATALOG = 'store:catalog:all';
const REDIS_KEY_VERSION = 'store:catalog:version';
const REDIS_TTL_SECONDS = 3600;

/**
 * Dual-Layer Store Catalog Cache (0ms In-Memory RAM + Redis Cluster).
 * Eliminates cold/disconnected Redis blind spots and tracks a monotonic catalogVersion
 * for delta/version checks across all clients.
 */
let memoryCatalog = null;
let memoryCatalogVersion = Date.now();

function getCatalogVersion() {
    return memoryCatalogVersion;
}

function getRedisClient() {
    const client = cacheService.redisClient;
    return client && client.status === 'ready' ? client : null;
}

/**
 * Stores active catalog in RAM immediately and syncs to Redis asynchronously.
 */
async function setCatalogCache(items, nextVersion = null) {
    const list = Array.isArray(items) ? items : [];
    const version = Number(nextVersion) || Math.max(Date.now(), memoryCatalogVersion + 1);

    memoryCatalog = list;
    memoryCatalogVersion = version;

    const redis = getRedisClient();
    if (redis) {
        try {
            const pipeline = redis.pipeline();
            pipeline.set(REDIS_KEY_CATALOG, JSON.stringify(list), 'EX', REDIS_TTL_SECONDS);
            pipeline.set(REDIS_KEY_VERSION, String(version), 'EX', REDIS_TTL_SECONDS);
            await pipeline.exec();
        } catch (err) {
            console.warn('⚠️ [StoreCache] Redis set failed (using RAM cache):', err.message);
        }
    }

    return { version, items: list };
}

/**
 * Returns cached active catalog from RAM first (0ms), then Redis.
 * Optionally filters by normalized category in memory.
 */
async function getCatalogCache(categoryFilter = null) {
    const targetCategory = normalizeCategory(categoryFilter);

    if (Array.isArray(memoryCatalog)) {
        const items = targetCategory
            ? memoryCatalog.filter(item => normalizeCategory(item.category) === targetCategory)
            : memoryCatalog;
        return {
            items,
            version: memoryCatalogVersion,
            source: 'memory'
        };
    }

    const redis = getRedisClient();
    if (redis) {
        try {
            const [rawItems, rawVersion] = await Promise.all([
                redis.get(REDIS_KEY_CATALOG),
                redis.get(REDIS_KEY_VERSION)
            ]);
            if (rawItems) {
                const parsed = JSON.parse(rawItems);
                if (Array.isArray(parsed)) {
                    memoryCatalog = parsed;
                    if (rawVersion && Number(rawVersion) > 0) {
                        memoryCatalogVersion = Number(rawVersion);
                    }
                    const items = targetCategory
                        ? parsed.filter(item => normalizeCategory(item.category) === targetCategory)
                        : parsed;
                    return {
                        items,
                        version: memoryCatalogVersion,
                        source: 'redis'
                    };
                }
            }
        } catch (err) {
            console.warn('⚠️ [StoreCache] Redis get failed:', err.message);
        }
    }

    return null;
}

/**
 * Queries MongoDB for all active items, refreshes both RAM & Redis caches,
 * and increments catalogVersion so connected clients immediately detect updates.
 */
async function refreshCatalogCache(StoreItemModel) {
    const activeItems = await StoreItemModel.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    const nextVersion = Math.max(Date.now(), memoryCatalogVersion + 1);
    return await setCatalogCache(activeItems, nextVersion);
}

async function invalidateCatalogCache() {
    memoryCatalog = null;
    memoryCatalogVersion = Math.max(Date.now(), memoryCatalogVersion + 1);
    const redis = getRedisClient();
    if (redis) {
        try {
            await redis.del(REDIS_KEY_CATALOG);
            await redis.set(REDIS_KEY_VERSION, String(memoryCatalogVersion), 'EX', REDIS_TTL_SECONDS);
        } catch (_) {}
    }
}

module.exports = {
    getCatalogVersion,
    setCatalogCache,
    getCatalogCache,
    refreshCatalogCache,
    invalidateCatalogCache
};
