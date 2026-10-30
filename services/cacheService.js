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

// Cleanup expired idempotency keys every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of processedTxIds.entries()) {
        if (ts < cutoff) processedTxIds.delete(key);
    }
}, 5 * 60 * 1000);

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
 * Checks 0-Trust Idempotency to block Replay Attacks / duplicate rapid clicks
 */
function checkAndMarkIdempotency(txId) {
    if (!txId) return true;
    if (processedTxIds.has(txId)) {
        return false;
    }
    processedTxIds.set(txId, Date.now());
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
            isLocked: false,
            isMuted: false,
            seatLabel: (i + 1).toString()
        })));
    }
    return roomSeatsMap.get(roomId);
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
    return activeRooms.get(roomId);
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

/**
 * Sync Wallet Cache in Redis
 */
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

module.exports = {
    redisClient,
    onlineUsers,
    activeRooms,
    roomSeatsMap,
    withUserLock,
    checkAndMarkIdempotency,
    getOrCreateRoomSeats,
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
    syncWalletCache
};
