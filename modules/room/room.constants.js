/**
 * Room Module Constants & Event Contracts
 * Centralized definitions for 16-seat stage, keep-alive, error codes, and event names.
 */

const SEAT_COUNT = 16;
const VALID_STAGE_CAPACITIES = [4, 8, 12, 16];
const DEFAULT_STAGE_CAPACITY = 8;

function normalizeStageCapacity(value, fallback = DEFAULT_STAGE_CAPACITY) {
    const num = Number(value);
    return VALID_STAGE_CAPACITIES.includes(num) ? num : fallback;
}

const WS_HEARTBEAT_INTERVAL_MS = 25000;
const POPULAR_ROOMS_THROTTLE_MS = 1200;
const ROOM_REDIS_STATE_TTL_SEC = 600;
const ROOM_DURABLE_KEY_TTL_SEC = 30 * 24 * 3600;
const AUTH_PROMISE_WAIT_MS = 1500;

const ERROR_CODES = {
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    HIERARCHY_PROTECTED: 'HIERARCHY_PROTECTED',
    SEAT_LOCKED: 'SEAT_LOCKED',
    SEAT_DISABLED: 'SEAT_DISABLED',
    SEAT_ALREADY_OCCUPIED: 'SEAT_ALREADY_OCCUPIED',
    MIC_MUTED_BY_HOST: 'MIC_MUTED_BY_HOST',
    INVALID_STAGE_CAPACITY: 'INVALID_STAGE_CAPACITY',
    ACTIVITY_ERROR: 'ACTIVITY_ERROR'
};

const ACTIVITY_NAMES = {
    LIFECYCLE: 'roomLifecycle',
    PRESENCE: 'roomPresence',
    STAGE_SEATS: 'roomStageSeats',
    SEAT_LOCK: 'roomSeatLock',
    STAGE_CAPACITY: 'roomStageCapacity',
    CHAT: 'roomChat',
    GIFT: 'roomGift',
    MODERATION: 'roomModeration',
    SETTINGS: 'roomSettings',
    DISCOVERY: 'roomDiscovery'
};

module.exports = {
    SEAT_COUNT,
    VALID_STAGE_CAPACITIES,
    DEFAULT_STAGE_CAPACITY,
    normalizeStageCapacity,
    WS_HEARTBEAT_INTERVAL_MS,
    POPULAR_ROOMS_THROTTLE_MS,
    ROOM_REDIS_STATE_TTL_SEC,
    ROOM_DURABLE_KEY_TTL_SEC,
    AUTH_PROMISE_WAIT_MS,
    ERROR_CODES,
    ACTIVITY_NAMES
};