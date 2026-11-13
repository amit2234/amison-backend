const Room = require('../../../models/Room');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const cacheService = require('../../../services/cacheService');
const {
    SEAT_COUNT,
    VALID_STAGE_CAPACITIES,
    DEFAULT_STAGE_CAPACITY,
    normalizeStageCapacity,
    ERROR_CODES
} = require('../room.constants');
const {
    channelManager,
    resolveRoomContext,
    getBroadcastTargets
} = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');
const roomPresenceActivity = require('./roomPresence.activity');
const roomDiscoveryActivity = require('./roomDiscovery.activity');

function sendCapacityRejected(ws, roomId, reason, message) {
    if (!ws || ws.readyState !== 1) return;
    try {
        ws.send(JSON.stringify({
            type: 'seat:rejected',
            roomId,
            seatIndex: -1,
            reason,
            message
        }));
    } catch (_) {}
}

function flushSeatMicTimeSafe(seat) {
    if (seat && seat.seatedAt && seat.userId) {
        const elapsedSec = Math.round((Date.now() - seat.seatedAt) / 1000);
        if (elapsedSec > 5) {
            try {
                const DailyTaskService = require('../../../services/dailyTaskService');
                DailyTaskService.recordMicTime(seat.userId, elapsedSec);
            } catch (_) {}
        }
    }
}

async function ensureRoomDocForCapacity(canonicalRoomId, rawRoomId, existingDoc = null) {
    if (existingDoc) return existingDoc;
    try {
        const orCond = [
            { roomId: canonicalRoomId },
            { ownerUid: canonicalRoomId },
            { displayRoomId: canonicalRoomId }
        ];
        if (rawRoomId && rawRoomId !== canonicalRoomId) {
            orCond.push({ displayRoomId: rawRoomId }, { roomId: rawRoomId }, { ownerUid: rawRoomId });
        }
        return await Room.findOne({ $or: orCond }).lean();
    } catch (_) {
        return null;
    }
}

async function persistStageCapacityToMongo(canonicalRoomId, rawRoomId, newCount, seats) {
    try {
        const query = {
            $or: [
                { roomId: canonicalRoomId },
                { ownerUid: canonicalRoomId },
                { displayRoomId: canonicalRoomId },
                ...(rawRoomId && rawRoomId !== canonicalRoomId ? [{ displayRoomId: rawRoomId }] : [])
            ]
        };

        const existing = await Room.findOne(query).select('seats lockedSeats').lean();
        const setPayload = {
            speakerSlots: newCount,
            updatedAt: new Date()
        };

        if (!existing || !Array.isArray(existing.seats) || existing.seats.length < SEAT_COUNT) {
            // Self-heal sparse or legacy seats array while preserving every lock flag
            const lockedSet = new Set(
                Array.isArray(existing?.lockedSeats) ? existing.lockedSeats.map(Number) : []
            );
            const fullSeats = seats.map((s, idx) => ({
                index: idx,
                seatIndex: idx,
                userId: idx < newCount ? (s.userId || null) : null,
                name: idx < newCount ? (s.userName || null) : null,
                userName: idx < newCount ? (s.userName || null) : null,
                avatar: idx < newCount ? (s.userAvatar || null) : null,
                userAvatar: idx < newCount ? (s.userAvatar || null) : null,
                userCustomId: idx < newCount ? (s.userCustomId || '') : '',
                isLocked: Boolean(s.isLocked || existing?.seats?.[idx]?.isLocked || lockedSet.has(idx)),
                isMuted: Boolean(s.isMicTurnedOff || s.isMuted),
                isMicTurnedOff: Boolean(s.isMicTurnedOff),
                isSpeaking: idx < newCount ? Boolean(s.isSpeaking) : false
            }));
            setPayload.seats = fullSeats;
        } else {
            // Clear ONLY occupant fields on closed seats; NEVER touch isLocked or lockedSeats
            for (let idx = newCount; idx < SEAT_COUNT; idx++) {
                const s = seats[idx];
                setPayload[`seats.${idx}.index`] = idx;
                setPayload[`seats.${idx}.seatIndex`] = idx;
                setPayload[`seats.${idx}.userId`] = null;
                setPayload[`seats.${idx}.name`] = null;
                setPayload[`seats.${idx}.userName`] = null;
                setPayload[`seats.${idx}.avatar`] = null;
                setPayload[`seats.${idx}.userAvatar`] = null;
                setPayload[`seats.${idx}.userCustomId`] = '';
                setPayload[`seats.${idx}.isSpeaking`] = false;
                setPayload[`seats.${idx}.isMuted`] = Boolean(s?.isMicTurnedOff);
            }
        }

        await Room.updateOne(query, { $set: setPayload });
    } catch (err) {
        console.warn('[RoomStageCapacity] Mongo persist notice:', err.message);
    }
}

/**
 * Room Stage Capacity Activity (Isolated Fault Domain)
 * Manages real-time Number of Mics (4 / 8 / 12 / 16) changes:
 * - Strictly allows ONLY Room Owner & Co-Owner
 * - Evicts occupants from closed seats immediately on shrink
 * - Preserves sticky seat locks across shrink & re-expand cycles
 */
const roomStageCapacityActivity = {
    async applyStageCapacityChange({
        rawRoomId,
        displayRoomId = '',
        actorId,
        actorCustomId = '',
        requestedSlots,
        meta = null,
        ws = null,
        triggerPopularBroadcast = null
    }) {
        const cleanRoomId = String(rawRoomId || meta?.roomId || '').trim();
        const newCount = Number(requestedSlots);
        if (!cleanRoomId) {
            const err = new Error('Missing roomId');
            err.statusCode = 400;
            throw err;
        }
        if (!VALID_STAGE_CAPACITIES.includes(newCount)) {
            if (ws) {
                sendCapacityRejected(
                    ws,
                    cleanRoomId,
                    ERROR_CODES.INVALID_STAGE_CAPACITY,
                    'Number of Mics must be 4, 8, 12, or 16.'
                );
            }
            const err = new Error('Number of Mics must be 4, 8, 12, or 16.');
            err.statusCode = 400;
            throw err;
        }

        const { canonicalRoomId, roomMeta: initialMeta, roomDoc: initialDoc } = await resolveRoomContext(
            cleanRoomId,
            meta,
            displayRoomId
        );
        const roomDoc = await ensureRoomDocForCapacity(canonicalRoomId, cleanRoomId, initialDoc);
        const effectiveCanonicalId = roomDoc
            ? String(roomDoc.ownerUid || roomDoc.roomId || canonicalRoomId).trim()
            : canonicalRoomId;
        const roomMeta = initialMeta || await roomRoleHelper.resolveRoomRolesMeta(effectiveCanonicalId, roomDoc);

        const cleanActorId = String(actorId || '').trim();
        const actorIds = await roomRoleHelper.resolveUserIdentifiers(cleanActorId, actorCustomId || '');
        const actorRole = roomRoleHelper.resolveUserRoleFromMetaSync(actorIds, roomMeta);

        if (!['owner', 'co_owner'].includes(actorRole)) {
            const msg = 'Only Room Owner or Co-Owner can change Number of Mics.';
            if (ws) {
                sendCapacityRejected(ws, effectiveCanonicalId, ERROR_CODES.UNAUTHORIZED, msg);
            }
            const err = new Error(msg);
            err.statusCode = 403;
            throw err;
        }

        await roomStateCache.hydrateFromRedisIfEmpty(effectiveCanonicalId);
        const docCapacity = normalizeStageCapacity(roomDoc?.speakerSlots, DEFAULT_STAGE_CAPACITY);
        const seats = roomStateCache.hydrateSeats(effectiveCanonicalId, roomDoc?.seats, roomDoc?.lockedSeats, docCapacity);

        // 1. Update capacity in 0ms RAM
        roomStateCache.setSpeakerSlots(effectiveCanonicalId, newCount);

        // 2. Evict occupants on seats [newCount .. 15] while preserving isLocked 100% intact
        const removedUserIds = [];
        for (let idx = newCount; idx < SEAT_COUNT; idx++) {
            const seat = seats[idx];
            if (!seat) continue;
            const occId = String(seat.userId || '').trim();
            if (occId && occId !== 'null' && occId !== 'undefined') {
                flushSeatMicTimeSafe(seat);
                removedUserIds.push(occId);
                if (seat.userCustomId) {
                    removedUserIds.push(String(seat.userCustomId).trim());
                }
                const occIds = await roomRoleHelper.resolveUserIdentifiers(occId, seat.userCustomId || '');
                roomStateCache.updateParticipantSeatState(effectiveCanonicalId, occIds, false, -1, roomMeta);
            }
            seat.userId = null;
            seat.seatedAt = null;
            seat.userName = null;
            seat.userAvatar = null;
            seat.userCustomId = '';
            seat.isSpeaking = false;
            seat.isMuted = Boolean(seat.isMicTurnedOff);
            // CRITICAL: NEVER touch seat.isLocked here — locked seats stay locked even when hidden!
        }

        const stateVersion = cacheService.nextRoomStateVersion(effectiveCanonicalId);
        const uniqueRemovedIds = Array.from(new Set(removedUserIds.filter(Boolean)));
        const resolvedDisplayRoomId = String(
            roomDoc?.displayRoomId || roomMeta?.displayRoomId || displayRoomId || ''
        ).trim();

        const packet = {
            type: 'room:stage_capacity_updated',
            roomId: effectiveCanonicalId,
            displayRoomId: resolvedDisplayRoomId,
            speakerSlots: newCount,
            seats,
            lockedSeats: seats.filter((s) => Boolean(s?.isLocked)).map((s) => s.seatIndex),
            removedUserIds: uniqueRemovedIds,
            updatedByRole: actorRole,
            stateVersion,
            timestamp: Date.now()
        };

        const targets = getBroadcastTargets(effectiveCanonicalId, cleanRoomId, meta, roomDoc);
        channelManager.broadcastToRoomTargets(targets, packet);

        if (uniqueRemovedIds.length > 0) {
            await roomPresenceActivity.emitStateUpdate(
                effectiveCanonicalId,
                cleanRoomId,
                meta,
                roomMeta,
                roomDoc,
                triggerPopularBroadcast
            );
        } else if (typeof triggerPopularBroadcast === 'function') {
            triggerPopularBroadcast();
        }

        roomStateCache.persistCapacityToRedisAsync(effectiveCanonicalId, newCount);
        roomStateCache.persistStateToRedisAsync(effectiveCanonicalId, roomMeta);
        roomDiscoveryActivity.invalidateCache();

        // Non-blocking MongoDB persistence
        persistStageCapacityToMongo(effectiveCanonicalId, cleanRoomId, newCount, seats);

        return {
            roomId: effectiveCanonicalId,
            displayRoomId: resolvedDisplayRoomId,
            speakerSlots: newCount,
            seats,
            removedUserIds: uniqueRemovedIds,
            updatedByRole: actorRole,
            stateVersion
        };
    },

    async handleSetStageCapacity(data, ws, triggerPopularBroadcast = null) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.canonicalRoomId || meta?.roomId || '').trim();
        const displayRoomId = String(data.displayRoomId || '').trim();
        const actorId = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || data.actorUserId || data.userId || '').trim();
        const requestedSlots = data.speakerSlots !== undefined ? data.speakerSlots : data.slots;

        try {
            await this.applyStageCapacityChange({
                rawRoomId,
                displayRoomId,
                actorId,
                actorCustomId: meta?.userCustomId || '',
                requestedSlots,
                meta,
                ws,
                triggerPopularBroadcast
            });
        } catch (err) {
            if (!err.statusCode) {
                throw err;
            }
            // Auth/validation errors already sent as `seat:rejected` to caller socket
        }
    },

    async updateStageCapacityRest(roomId, speakerSlots, actorUid) {
        return this.applyStageCapacityChange({
            rawRoomId: roomId,
            actorId: actorUid,
            requestedSlots: speakerSlots
        });
    }
};

module.exports = roomStageCapacityActivity;