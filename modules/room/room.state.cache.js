const cacheService = require('../../services/cacheService');
const roomRoleHelper = require('../../services/roomRoleHelper');
const {
    SEAT_COUNT,
    DEFAULT_STAGE_CAPACITY,
    normalizeStageCapacity,
    ROOM_REDIS_STATE_TTL_SEC,
    ROOM_DURABLE_KEY_TTL_SEC
} = require('./room.constants');

/**
 * Dual-Layer Room State Cache (0ms RAM + Non-Blocking Redis Sync)
 * Keeps 16-seat grid, lock flags, stage capacity (4/8/12/16), active participants,
 * and heat scores synchronized without blocking WebSocket threads on MongoDB or Redis I/O.
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

function hydrateSeats(canonicalRoomId, dbSeats, dbLockedSeats = null, dbSpeakerSlots = null) {
    const seats = cacheService.hydrateRoomSeatsFromDoc(canonicalRoomId, dbSeats, dbLockedSeats, dbSpeakerSlots);
    return sanitizeSeats(seats);
}

function getSpeakerSlots(canonicalRoomId, fallback = DEFAULT_STAGE_CAPACITY) {
    return cacheService.getRoomSpeakerSlots(canonicalRoomId, normalizeStageCapacity(fallback));
}

function setSpeakerSlots(canonicalRoomId, slots) {
    const normalized = normalizeStageCapacity(slots);
    cacheService.setRoomSpeakerSlots(canonicalRoomId, normalized);
    return normalized;
}

function getParticipantsMap(canonicalRoomId) {
    return cacheService.getRoomParticipants(canonicalRoomId);
}

function persistSeatLockToRedisAsync(canonicalRoomId, seatIndex, isLocked) {
    if (!canonicalRoomId || seatIndex < 0 || seatIndex >= SEAT_COUNT) return;
    const redis = cacheService.redisClient;
    if (!redis || redis.status !== 'ready') return;
    try {
        const key = `room:locks:${canonicalRoomId}`;
        redis.pipeline()
            .hset(key, String(seatIndex), isLocked ? '1' : '0')
            .expire(key, ROOM_DURABLE_KEY_TTL_SEC)
            .exec()
            .catch(() => {});
    } catch (_) {}
}

function persistCapacityToRedisAsync(canonicalRoomId, speakerSlots) {
    if (!canonicalRoomId) return;
    const redis = cacheService.redisClient;
    if (!redis || redis.status !== 'ready') return;
    try {
        redis.set(
            `room:capacity:${canonicalRoomId}`,
            String(normalizeStageCapacity(speakerSlots)),
            'EX',
            ROOM_DURABLE_KEY_TTL_SEC
        ).catch(() => {});
    } catch (_) {}
}

/**
 * Hydrates RAM from Redis if this worker just started/woke up from cold start
 * and a recent snapshot or durable lock/capacity exists in Redis.
 */
async function hydrateFromRedisIfEmpty(canonicalRoomId) {
    if (!canonicalRoomId) return null;
    const redis = cacheService.redisClient;
    if (!redis || redis.status !== 'ready') return null;

    const existingParticipants = getParticipantsMap(canonicalRoomId);
    const alreadyHydrated = cacheService.roomHydratedSet.has(canonicalRoomId);
    if (alreadyHydrated && existingParticipants.size > 0 && cacheService.roomSeatsMap.has(canonicalRoomId)) {
        return null;
    }

    try {
        const results = await redis.pipeline()
            .get(`room:state:${canonicalRoomId}`)
            .hgetall(`room:locks:${canonicalRoomId}`)
            .get(`room:capacity:${canonicalRoomId}`)
            .exec();

        const rawState = results?.[0]?.[1] || null;
        const locksHash = results?.[1]?.[1] || null;
        const capRaw = results?.[2]?.[1] || null;
        const parsed = rawState ? JSON.parse(rawState) : null;

        if (!alreadyHydrated) {
            const seats = getOrCreateSeats(canonicalRoomId);
            if (parsed && Array.isArray(parsed.seats)) {
                for (let i = 0; i < Math.min(SEAT_COUNT, parsed.seats.length); i++) {
                    const src = parsed.seats[i];
                    if (!src) continue;
                    seats[i] = {
                        ...createEmptySeat(i),
                        ...src,
                        seatIndex: i
                    };
                }
            }
            if (locksHash && typeof locksHash === 'object') {
                for (const [idxStr, val] of Object.entries(locksHash)) {
                    const idx = Number(idxStr);
                    if (!Number.isNaN(idx) && idx >= 0 && idx < SEAT_COUNT && seats[idx]) {
                        if (val === '1' || val === 'true') seats[idx].isLocked = true;
                        else if (val === '0' || val === 'false') seats[idx].isLocked = false;
                    }
                }
            }
            sanitizeSeats(seats);
            if (parsed || (locksHash && Object.keys(locksHash).length > 0)) {
                cacheService.roomHydratedSet.add(canonicalRoomId);
            }
        }

        const resolvedCap = capRaw !== null
            ? normalizeStageCapacity(capRaw, 0)
            : (parsed?.speakerSlots ? normalizeStageCapacity(parsed.speakerSlots, 0) : 0);
        if (resolvedCap > 0 && !cacheService.roomSpeakerSlotsMap.has(canonicalRoomId)) {
            cacheService.setRoomSpeakerSlots(canonicalRoomId, resolvedCap);
        }

        if (parsed && Array.isArray(parsed.participants) && existingParticipants.size === 0) {
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
        const speakerSlots = getSpeakerSlots(canonicalRoomId);
        const participantsMap = getParticipantsMap(canonicalRoomId);
        const participants = Array.from(participantsMap.values());
        const onlineCount = participants.length;
        const heatScore = computeRoomHeat(participantsMap, seats);

        const payload = JSON.stringify({
            roomId: canonicalRoomId,
            ownerUid: roomMeta?.ownerUid || '',
            coOwners: roomMeta?.coOwners || [],
            admins: roomMeta?.admins || [],
            speakerSlots,
            stateVersion: cacheService.getRoomStateVersion(canonicalRoomId),
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
    const docCapacity = normalizeStageCapacity(roomDoc?.speakerSlots, DEFAULT_STAGE_CAPACITY);
    const seats = hydrateSeats(canonicalRoomId, roomDoc?.seats, roomDoc?.lockedSeats, docCapacity);
    const speakerSlots = getSpeakerSlots(canonicalRoomId, docCapacity);
    const lockedSeats = seats.filter((s) => Boolean(s?.isLocked)).map((s) => s.seatIndex);
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
        speakerSlots,
        lockedSeats,
        stateVersion: cacheService.getRoomStateVersion(canonicalRoomId),
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
    getSpeakerSlots,
    setSpeakerSlots,
    getParticipantsMap,
    persistSeatLockToRedisAsync,
    persistCapacityToRedisAsync,
    hydrateFromRedisIfEmpty,
    persistStateToRedisAsync,
    computeRoomHeat,
    buildSeatUpdatePacket,
    updateParticipantSeatState,
    buildRoomSnapshot
};