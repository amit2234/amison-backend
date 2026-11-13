const cacheService = require('../../services/cacheService');
const roomRoleHelper = require('../../services/roomRoleHelper');
const { SEAT_COUNT, ROOM_REDIS_STATE_TTL_SEC } = require('./room.constants');

/**
 * Dual-Layer Room State Cache (0ms RAM + Non-Blocking Redis Sync)
 * Keeps 16-seat grid, lock flags, active participants, and heat scores synchronized
 * without blocking WebSocket threads on MongoDB or Redis I/O.
 */
function createEmptySeat(index) {
    return {
        seatIndex: index,
        userId: null,
        userName: null,
        userAvatar: null,
        userCustomId: '',
        isLocked: false,
        isMuted: false,
        isMicTurnedOff: false,
        mutedByRole: '',
        isSpeaking: false,
        seatedAt: null,
        seatLabel: (index + 1).toString()
    };
}

function sanitizeSeats(seats) {
    if (!Array.isArray(seats)) return Array.from({ length: SEAT_COUNT }, (_, i) => createEmptySeat(i));
    while (seats.length < SEAT_COUNT) {
        seats.push(createEmptySeat(seats.length));
    }
    for (let i = 0; i < SEAT_COUNT; i++) {
        const s = seats[i];
        if (!s) {
            seats[i] = createEmptySeat(i);
            continue;
        }
        s.seatIndex = i;
        if (s.userId === 'null' || s.userId === 'undefined' || s.userId === '') s.userId = null;
        if (s.userName === 'null' || s.userName === 'undefined') s.userName = null;
        if (s.userAvatar === 'null' || s.userAvatar === 'undefined') s.userAvatar = null;
        if (s.userCustomId === 'null' || s.userCustomId === 'undefined') s.userCustomId = '';
        s.isLocked = Boolean(s.isLocked);
        s.isMicTurnedOff = Boolean(s.isMicTurnedOff);
        s.isMuted = Boolean(s.isMicTurnedOff || s.isMuted);
        s.isSpeaking = s.isMuted ? false : Boolean(s.isSpeaking);
    }
    return seats;
}

function getOrCreateSeats(canonicalRoomId) {
    const seats = cacheService.getOrCreateRoomSeats(canonicalRoomId);
    return sanitizeSeats(seats);
}

function hydrateSeats(canonicalRoomId, dbSeats) {
    const seats = cacheService.hydrateRoomSeatsFromDoc(canonicalRoomId, dbSeats);
    return sanitizeSeats(seats);
}

function getParticipantsMap(canonicalRoomId) {
    return cacheService.getRoomParticipants(canonicalRoomId);
}

/**
 * Hydrates RAM from Redis if this worker just started/woke up from cold start
 * and a recent snapshot exists in Redis.
 */
async function hydrateFromRedisIfEmpty(canonicalRoomId) {
    if (!canonicalRoomId) return null;
    const redis = cacheService.redisClient;
    if (!redis || redis.status !== 'ready') return null;

    const existingParticipants = getParticipantsMap(canonicalRoomId);
    if (existingParticipants.size > 0 && cacheService.roomSeatsMap.has(canonicalRoomId)) {
        return null;
    }

    try {
        const raw = await redis.get(`room:state:${canonicalRoomId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed.seats) && !cacheService.roomSeatsMap.has(canonicalRoomId)) {
            const seats = getOrCreateSeats(canonicalRoomId);
            for (let i = 0; i < Math.min(SEAT_COUNT, parsed.seats.length); i++) {
                const src = parsed.seats[i];
                if (!src) continue;
                seats[i] = {
                    ...createEmptySeat(i),
                    ...src,
                    seatIndex: i
                };
            }
            sanitizeSeats(seats);
        }

        if (Array.isArray(parsed.participants) && existingParticipants.size === 0) {
            for (const p of parsed.participants) {
                if (p && p.userId && p.userId !== 'null' && p.userId !== 'undefined') {
                    existingParticipants.set(String(p.userId).trim(), p);
                }
            }
        }
        return parsed;
    } catch (_) {
        return null;
    }
}

/**
 * Fire-and-forget Redis snapshot sync so REST GET /api/rooms/:id/state and cold wakes stay accurate.
 */
function persistStateToRedisAsync(canonicalRoomId, roomMeta = null) {
    if (!canonicalRoomId) return;
    const redis = cacheService.redisClient;
    if (!redis || redis.status !== 'ready') return;

    try {
        const seats = getOrCreateSeats(canonicalRoomId);
        const participantsMap = getParticipantsMap(canonicalRoomId);
        const participants = Array.from(participantsMap.values());
        const onlineCount = participants.length;
        const heatScore = computeRoomHeat(participantsMap, seats);

        const payload = JSON.stringify({
            roomId: canonicalRoomId,
            ownerUid: roomMeta?.ownerUid || '',
            coOwners: roomMeta?.coOwners || [],
            admins: roomMeta?.admins || [],
            seats,
            participants,
            onlineCount,
            heatScore,
            updatedAt: Date.now()
        });

        redis.set(`room:state:${canonicalRoomId}`, payload, 'EX', ROOM_REDIS_STATE_TTL_SEC).catch(() => {});
    } catch (_) {}
}

function computeRoomHeat(participantsMap, seats = []) {
    const pCount = participantsMap ? participantsMap.size : 0;
    const participantHeat = cacheService.calculateRoomHeat(participantsMap) || 0;
    const stageMics = Array.isArray(seats)
        ? seats.filter(s => s && s.userId && s.userId !== 'null').length
        : 0;
    return Math.max(participantHeat, (pCount * 10) + (stageMics * 25));
}

function buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat, kickedUserId = null) {
    return {
        type: 'seat:update',
        roomId: canonicalRoomId,
        rawRoomId: rawRoomId || canonicalRoomId,
        seatIndex,
        userId: (seat.userId === 'null' || !seat.userId) ? '' : String(seat.userId),
        userName: (seat.userName === 'null' || !seat.userName) ? '' : String(seat.userName),
        userAvatar: (seat.userAvatar === 'null' || !seat.userAvatar) ? '' : String(seat.userAvatar),
        userCustomId: (seat.userCustomId === 'null' || !seat.userCustomId) ? '' : String(seat.userCustomId),
        isLocked: Boolean(seat.isLocked),
        isMuted: Boolean(seat.isMuted),
        isMicTurnedOff: Boolean(seat.isMicTurnedOff),
        isSpeaking: Boolean(seat.isSpeaking),
        ...(kickedUserId ? { kickedUserId: String(kickedUserId) } : {})
    };
}

function updateParticipantSeatState(canonicalRoomId, identifiers, onSeat, seatIndex, roomMeta) {
    const roomParticipants = getParticipantsMap(canonicalRoomId);
    roomParticipants.forEach((p, key) => {
        const match = identifiers.has(String(key).trim())
            || identifiers.has(String(p.userId || '').trim())
            || (p.numericId && identifiers.has(String(p.numericId).trim()));
        if (match) {
            p.onSeat = Boolean(onSeat);
            p.seatIndex = onSeat ? seatIndex : -1;
            const normRole = roomRoleHelper.resolveUserRoleFromMetaSync(identifiers, roomMeta);
            p.role = roomRoleHelper.toDisplayRole(normRole, Boolean(onSeat));
            roomParticipants.set(key, p);
        }
    });
}

function buildRoomSnapshot(canonicalRoomId, roomDoc = null, roomMeta = null) {
    const seats = hydrateSeats(canonicalRoomId, roomDoc?.seats);
    const participantsMap = getParticipantsMap(canonicalRoomId);
    const participants = Array.from(participantsMap.values());
    const onlineCount = participants.length;
    const heatScore = computeRoomHeat(participantsMap, seats);
    const isLive = onlineCount > 0 && heatScore >= 10;

    return {
        roomId: canonicalRoomId,
        displayRoomId: roomDoc?.displayRoomId || roomMeta?.displayRoomId || '',
        ownerUid: roomMeta?.ownerUid || roomDoc?.ownerUid || '',
        coOwners: roomMeta?.coOwners || roomDoc?.coOwners || [],
        admins: roomMeta?.admins || roomDoc?.admins || [],
        roomName: roomDoc?.roomName || 'Voice Room',
        announcement: roomDoc?.announcement || 'Welcome!',
        roomPhotoUrl: roomDoc?.roomPhotoUrl || roomDoc?.roomCover || '',
        backgroundUrl: roomDoc?.backgroundUrl || '',
        seats,
        participants,
        onlineCount,
        heatScore,
        isLive,
        timestamp: Date.now()
    };
}

module.exports = {
    createEmptySeat,
    sanitizeSeats,
    getOrCreateSeats,
    hydrateSeats,
    getParticipantsMap,
    hydrateFromRedisIfEmpty,
    persistStateToRedisAsync,
    computeRoomHeat,
    buildSeatUpdatePacket,
    updateParticipantSeatState,
    buildRoomSnapshot
};
