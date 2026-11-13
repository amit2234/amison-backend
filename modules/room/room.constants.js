/**
 * Room Module Constants & Event Contracts
 * Centralized definitions for 16-seat stage, keep-alive, error codes, and event names.
 */

const SEAT_COUNT = 16;

const WS_HEARTBEAT_INTERVAL_MS = 25000;
const POPULAR_ROOMS_THROTTLE_MS = 1200;
const ROOM_REDIS_STATE_TTL_SEC = 600;
const AUTH_PROMISE_WAIT_MS = 1500;

const ERROR_CODES = {
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    HIERARCHY_PROTECTED: 'HIERARCHY_PROTECTED',
    SEAT_LOCKED: 'SEAT_LOCKED',
    SEAT_ALREADY_OCCUPIED: 'SEAT_ALREADY_OCCUPIED',
    MIC_MUTED_BY_HOST: 'MIC_MUTED_BY_HOST',
    ACTIVITY_ERROR: 'ACTIVITY_ERROR'
};

const ACTIVITY_NAMES = {
    LIFECYCLE: 'roomLifecycle',
    PRESENCE: 'roomPresence',
    STAGE_SEATS: 'roomStageSeats',
    SEAT_LOCK: 'roomSeatLock',
    CHAT: 'roomChat',
    GIFT: 'roomGift',
    MODERATION: 'roomModeration',
    SETTINGS: 'roomSettings',
    DISCOVERY: 'roomDiscovery'
};

module.exports = {
    SEAT_COUNT,
    WS_HEARTBEAT_INTERVAL_MS,
    POPULAR_ROOMS_THROTTLE_MS,
    ROOM_REDIS_STATE_TTL_SEC,
    AUTH_PROMISE_WAIT_MS,
    ERROR_CODES,
    ACTIVITY_NAMES
};
