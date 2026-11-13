/**
 * High-Speed Cache & In-Memory State Service (0ms Latency Engine)
 * Manages RAM Maps and optional Redis cluster for instant room seating, heat scoring,
 * user presence, unread counters, and transaction locks.
 */

let redisClient = null;
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '';

if (REDIS_URL) {
    try {
        const Redis = require('ioredis');
        redisClient = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 2,
            enableReadyCheck: true,
            lazyConnect: false
        });
        redisClient.on('connect', () => console.log('⚡ [CacheService] Connected to high-speed Redis cluster'));
        redisClient.on('error', (err) => console.warn('⚠️ [CacheService] Redis Notice:', err.message));
    } catch (e) {
        console.warn('⚠️ [CacheService] ioredis initialization skipped, using RAM Cache Engine:', e.message);
    }
}

// 1. In-Memory Online Users: userId => WebSocket
const onlineUsers = new Map();

// 2. In-Memory Active Room Participants: roomId => Map(userId => { userId, name, avatar, onSeat, seatIndex })
const activeRooms = new Map();

// 3. In-Memory 16-Seat Grid Stages: roomId => Array[16] (Instant 0ms lookup & lock/unlock)
const roomSeatsMap = new Map();

// 4. In-Memory Unread Count Fallback: uid => Map(conversationId => count)
const memoryUnreadMap = new Map();

// 5. In-Memory Idempotency & Per-User Lock Queue (0ms Replay & Race Guard)
const processedTxIds = new Map(); // txId -> timestamp
const userLocks = new Map();      // uid -> Promise chain

// Cleanup expired idempotency keys every 1 minute
setInterval(() => {
    const cutoff = Date.now() - 60 * 1000;
    for (const [key, ts] of processedTxIds.entries()) {
        if (ts < cutoff) processedTxIds.delete(key);
    }
}, 60 * 1000);

/**
 * Serializes concurrent operations for the same user on a single Node instance
 */
function withUserLock(uid, fn) {
    const prev = userLocks.get(uid) || Promise.resolve();
    const next = prev.then(() => fn()).catch((err) => {
        throw err;
    }).finally(() => {
        if (userLocks.get(uid) === next) {
            userLocks.delete(uid);
        }
    });
    userLocks.set(uid, next);
    return next;
}

/**
 * Checks 0-Trust Idempotency to block Replay Attacks / duplicate rapid clicks within ttlMs (default 60000ms)
 */
function checkAndMarkIdempotency(txId, ttlMs = 60000) {
    if (!txId) return true;
    const now = Date.now();
    const existing = processedTxIds.get(txId);
    if (existing && (now - existing < ttlMs)) {
        return false;
    }
    processedTxIds.set(txId, now);
    return true;
}

/**
 * Get or initialize 16-seat stage array for a room in 0ms
 */
function getOrCreateRoomSeats(roomId) {
    if (!roomId) return [];
    if (!roomSeatsMap.has(roomId)) {
        roomSeatsMap.set(roomId, Array.from({ length: 16 }, (_, i) => ({
            seatIndex: i,
            userId: null,
            userName: null,
            userAvatar: null,
            userCustomId: '',
            isLocked: false,
            isMuted: false,
            isMicTurnedOff: false,
            isSpeaking: false,
            seatLabel: (i + 1).toString()
        })));
    }
    const seats = roomSeatsMap.get(roomId);
    if (Array.isArray(seats)) {
        for (const s of seats) {
            if (s.userId === 'null' || s.userId === 'undefined') s.userId = null;
            if (s.userName === 'null' || s.userName === 'undefined') s.userName = null;
            if (s.userAvatar === 'null' || s.userAvatar === 'undefined') s.userAvatar = null;
            if (s.isMicTurnedOff === undefined) s.isMicTurnedOff = false;
            if (s.isSpeaking === undefined) s.isSpeaking = false;
        }
    }
    return seats;
}

/**
 * Hydrates initial lock/mute seat state from MongoDB Room.seats if RAM cache does not exist yet.
 * Does not restore stale ghost occupants if nobody is actively connected.
 */
function hydrateRoomSeatsFromDoc(roomId, dbSeats) {
    if (!roomId) return [];
    if (roomSeatsMap.has(roomId)) {
        return getOrCreateRoomSeats(roomId);
    }
    const initialized = getOrCreateRoomSeats(roomId);
    if (Array.isArray(dbSeats)) {
        for (let i = 0; i < Math.min(16, dbSeats.length); i++) {
            const dbSeat = dbSeats[i];
            if (!dbSeat || !initialized[i]) continue;
            initialized[i].isLocked = Boolean(dbSeat.isLocked);
            const mutedByHost = Boolean(dbSeat.isMicTurnedOff);
            initialized[i].isMicTurnedOff = mutedByHost;
            initialized[i].isMuted = mutedByHost || Boolean(dbSeat.isMuted);
        }
    }
    return initialized;
}

/**
 * Recalculate room heat score:
 * - Audience (not on seat) = 10 heat points per user
 * - Seated user (on seat / mic) = 50 heat points per user
 */
function calculateRoomHeat(participantsMap) {
    if (!participantsMap) return 0;
    let heat = 0;
    participantsMap.forEach((participant) => {
        if (participant.onSeat) {
            heat += 50;
        } else {
            heat += 10;
        }
    });
    return heat;
}

/**
 * User Presence Tracking (0ms RAM)
 */
function setUserOnline(userId, ws) {
    if (!userId) return;
    onlineUsers.set(String(userId).trim(), ws);
}

function removeUserOnline(userId) {
    if (!userId) return;
    onlineUsers.delete(String(userId).trim());
}

function getOnlineUserSocket(userId) {
    if (!userId) return null;
    return onlineUsers.get(String(userId).trim()) || null;
}

function isUserOnline(userId) {
    if (!userId) return false;
    const ws = onlineUsers.get(String(userId).trim());
    return !!ws && ws.readyState === 1; // 1 = OPEN
}

/**
 * Direct real-time packet emission to a user's WebSocket
 */
function emitToUser(userId, packet) {
    if (!userId) return false;
    const ws = getOnlineUserSocket(userId);
    if (ws && ws.readyState === 1) {
        ws.send(typeof packet === 'string' ? packet : JSON.stringify(packet));
        return true;
    }
    return false;
}

/**
 * Active Room Participants (0ms RAM)
 */
function getRoomParticipants(roomId) {
    if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, new Map());
    }
    const map = activeRooms.get(roomId);
    if (map.has('null')) map.delete('null');
    if (map.has('undefined')) map.delete('undefined');
    if (map.has('')) map.delete('');
    return map;
}

function removeRoom(roomId) {
    activeRooms.delete(roomId);
    roomSeatsMap.delete(roomId);
}

/**
 * Increment Unread Count in RAM & Redis
 */
async function incrementUnread(receiverId, conversationId) {
    if (!receiverId || !conversationId) return 1;
    let userMap = memoryUnreadMap.get(receiverId);
    if (!userMap) {
        userMap = new Map();
        memoryUnreadMap.set(receiverId, userMap);
    }
    const nextCount = (userMap.get(conversationId) || 0) + 1;
    userMap.set(conversationId, nextCount);

    if (redisClient && redisClient.status === 'ready') {
        try {
            const val = await redisClient.hincrby(`chat:unread:${receiverId}`, conversationId, 1);
            await redisClient.del(`chat:inbox:${receiverId}`);
            return Number(val) || nextCount;
        } catch (e) {
            // fallback
        }
    }
    return nextCount;
}

/**
 * Clear Unread Count in RAM & Redis
 */
async function clearUnread(uid, conversationId) {
    if (!uid || !conversationId) return;
    const userMap = memoryUnreadMap.get(uid);
    if (userMap) {
        userMap.set(conversationId, 0);
    }
    if (redisClient && redisClient.status === 'ready') {
        try {
            await redisClient.hset(`chat:unread:${uid}`, conversationId, 0);
            await redisClient.del(`chat:inbox:${uid}`);
        } catch (e) {
            // fallback
        }
    }
}

async function syncWalletCache(uid, coins, diamonds) {
    if (!redisClient || redisClient.status !== 'ready' || !uid) return;
    try {
        const pipeline = redisClient.pipeline();
        if (coins !== undefined && coins !== null) {
            pipeline.set(`wallet:coins:${uid}`, Math.max(0, Math.floor(Number(coins) || 0)));
        }
        if (diamonds !== undefined && diamonds !== null) {
            pipeline.set(`wallet:diamonds:${uid}`, Math.max(0, Math.floor(Number(diamonds) || 0)));
        }
        await pipeline.exec();
    } catch (e) {
        // non-fatal
    }
}

// In-Memory RAM Cache fallback for Store Catalog
let memoryStoreCatalog = null;

/**
 * Sync Store Catalog and User Inventory to high-speed RAM + Redis Cache (0ms Latency)
 */
async function syncStoreCatalogCache(catalogItems) {
    if (!catalogItems) return;
    memoryStoreCatalog = catalogItems;
    if (!redisClient || redisClient.status !== 'ready') return;
    try {
        await redisClient.set('store:catalog:all', JSON.stringify(catalogItems), 'EX', 3600);
    } catch (e) {}
}

async function getCachedStoreCatalog() {
    if (redisClient && redisClient.status === 'ready') {
        try {
            const cached = await redisClient.get('store:catalog:all');
            if (cached) {
                const parsed = JSON.parse(cached);
                memoryStoreCatalog = parsed;
                return parsed;
            }
        } catch (e) {}
    }
    return memoryStoreCatalog;
}

async function syncUserInventoryCache(uid, inventoryObj) {
    if (!redisClient || redisClient.status !== 'ready' || !uid) return;
    try {
        await redisClient.set(`store:inventory:${uid}`, JSON.stringify(inventoryObj), 'EX', 300);
    } catch (e) {}
}

async function getCachedUserInventory(uid) {
    if (!redisClient || redisClient.status !== 'ready' || !uid) return null;
    try {
        const cached = await redisClient.get(`store:inventory:${uid}`);
        if (cached) return JSON.parse(cached);
    } catch (e) {}
    return null;
}

async function invalidateUserInventoryCache(uid) {
    if (!redisClient || redisClient.status !== 'ready' || !uid) return;
    try {
        await redisClient.del(`store:inventory:${uid}`);
    } catch (e) {}
}

// 6. In-Memory Gift Catalog RAM Fallback (0ms instant response)
let memoryGiftsCatalog = null;

async function syncGiftsCatalogCache(giftsList) {
    memoryGiftsCatalog = giftsList;
    if (!redisClient || redisClient.status !== 'ready' || !giftsList) return;
    try {
        await redisClient.set('gifts:catalog:active', JSON.stringify(giftsList), 'EX', 86400); // 24hr TTL
    } catch (e) {}
}

async function getCachedGiftsCatalog() {
    if (redisClient && redisClient.status === 'ready') {
        try {
            const cached = await redisClient.get('gifts:catalog:active');
            if (cached) return JSON.parse(cached);
        } catch (e) {}
    }
    return memoryGiftsCatalog;
}

async function invalidateGiftsCatalogCache() {
    memoryGiftsCatalog = null;
    if (!redisClient || redisClient.status !== 'ready') return;
    try {
        await redisClient.del('gifts:catalog:active');
    } catch (e) {}
}

// In-Memory RAM Cache for Banners
const memoryBannersCache = {
    HOME: null,
    LOGIN: null
};

async function syncBannersCache(placement, bannersList) {
    const key = (placement || 'HOME').toUpperCase();
    memoryBannersCache[key] = bannersList;
    if (!redisClient || redisClient.status !== 'ready' || !bannersList) return;
    try {
        await redisClient.set(`banners:active:${key}`, JSON.stringify(bannersList), 'EX', 3600); // 1hr TTL
    } catch (e) {}
}

async function getCachedBanners(placement) {
    const key = (placement || 'HOME').toUpperCase();
    if (redisClient && redisClient.status === 'ready') {
        try {
            const cached = await redisClient.get(`banners:active:${key}`);
            if (cached) return JSON.parse(cached);
        } catch (e) {}
    }
    return memoryBannersCache[key];
}

async function invalidateBannersCache(placement) {
    if (placement) {
        const key = placement.toUpperCase();
        memoryBannersCache[key] = null;
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del(`banners:active:${key}`);
            } catch (e) {}
        }
    } else {
        memoryBannersCache.HOME = null;
        memoryBannersCache.LOGIN = null;
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del('banners:active:HOME');
                await redisClient.del('banners:active:LOGIN');
            } catch (e) {}
        }
    }
}

// In-Memory RAM Cache for Couple Partner Bonds: uid => Bond Object
const memoryCoupleBonds = new Map();

async function syncCoupleBondCache(uid, bondData) {
    if (!uid) return;
    const cleanUid = String(uid).trim();
    memoryCoupleBonds.set(cleanUid, bondData);
    if (redisClient && redisClient.status === 'ready' && bondData) {
        try {
            await redisClient.set(`cp:bond:${cleanUid}`, JSON.stringify(bondData), 'EX', 3600); // 1hr TTL
        } catch (e) {}
    }
}

async function getCachedCoupleBond(uid) {
    if (!uid) return null;
    const cleanUid = String(uid).trim();
    if (redisClient && redisClient.status === 'ready') {
        try {
            const cached = await redisClient.get(`cp:bond:${cleanUid}`);
            if (cached) return JSON.parse(cached);
        } catch (e) {}
    }
    return memoryCoupleBonds.get(cleanUid) || null;
}

async function invalidateCoupleBondCache(uid1, uid2) {
    const uids = [uid1, uid2].filter(Boolean).map(u => String(u).trim());
    for (const uid of uids) {
        memoryCoupleBonds.delete(uid);
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.del(`cp:bond:${uid}`);
            } catch (e) {}
        }
    }
}

module.exports = {
    redisClient,
    onlineUsers,
    activeRooms,
    roomSeatsMap,
    withUserLock,
    checkAndMarkIdempotency,
    getOrCreateRoomSeats,
    hydrateRoomSeatsFromDoc,
    calculateRoomHeat,
    setUserOnline,
    removeUserOnline,
    getOnlineUserSocket,
    isUserOnline,
    emitToUser,
    getRoomParticipants,
    removeRoom,
    incrementUnread,
    clearUnread,
    syncWalletCache,
    syncStoreCatalogCache,
    getCachedStoreCatalog,
    syncUserInventoryCache,
    getCachedUserInventory,
    invalidateUserInventoryCache,
    syncGiftsCatalogCache,
    getCachedGiftsCatalog,
    invalidateGiftsCatalogCache,
    syncBannersCache,
    getCachedBanners,
    invalidateBannersCache,
    syncCoupleBondCache,
    getCachedCoupleBond,
    invalidateCoupleBondCache
};
