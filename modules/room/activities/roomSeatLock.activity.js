const Room = require('../../../models/Room');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const cacheService = require('../../../services/cacheService');
const { SEAT_COUNT, DEFAULT_STAGE_CAPACITY, normalizeStageCapacity, ERROR_CODES } = require('../room.constants');
const { channelManager, resolveRoomContext, getBroadcastTargets } = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');
const roomPresenceActivity = require('./roomPresence.activity');

function sendLockRejected(ws, roomId, seatIndex, reason, message) {
    if (!ws || ws.readyState !== 1) return;
    try {
        ws.send(JSON.stringify({
            type: 'seat:rejected',
            roomId,
            seatIndex,
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

async function persistSeatLockToMongo(roomId, rawRoomId, seatIndex, seat, seatsSnapshot) {
    try {
        const query = {
            $or: [
                { roomId },
                { ownerUid: roomId },
                { displayRoomId: roomId },
                ...(rawRoomId && rawRoomId !== roomId ? [{ displayRoomId: rawRoomId }] : [])
            ]
        };
        const nextLocked = Boolean(seat.isLocked);
        const existing = await Room.findOne(query).select('seats lockedSeats').lean();

        const setPayload = {
            updatedAt: new Date()
        };

        if (!existing || !Array.isArray(existing.seats) || existing.seats.length < SEAT_COUNT) {
            const lockedSet = new Set(Array.isArray(existing?.lockedSeats) ? existing.lockedSeats.map(Number) : []);
            if (nextLocked) lockedSet.add(seatIndex);
            else lockedSet.delete(seatIndex);

            setPayload.seats = seatsSnapshot.map((s, idx) => ({
                index: idx,
                seatIndex: idx,
                userId: s.userId || null,
                name: s.userName || null,
                userName: s.userName || null,
                avatar: s.userAvatar || null,
                userAvatar: s.userAvatar || null,
                userCustomId: s.userCustomId || '',
                isLocked: idx === seatIndex ? nextLocked : Boolean(s.isLocked || existing?.seats?.[idx]?.isLocked || lockedSet.has(idx)),
                isMuted: Boolean(s.isMicTurnedOff || s.isMuted),
                isMicTurnedOff: Boolean(s.isMicTurnedOff),
                isSpeaking: Boolean(s.isSpeaking)
            }));
        } else {
            setPayload[`seats.${seatIndex}.index`] = seatIndex;
            setPayload[`seats.${seatIndex}.seatIndex`] = seatIndex;
            setPayload[`seats.${seatIndex}.userId`] = seat.userId || null;
            setPayload[`seats.${seatIndex}.name`] = seat.userName || null;
            setPayload[`seats.${seatIndex}.userName`] = seat.userName || null;
            setPayload[`seats.${seatIndex}.avatar`] = seat.userAvatar || null;
            setPayload[`seats.${seatIndex}.userAvatar`] = seat.userAvatar || null;
            setPayload[`seats.${seatIndex}.userCustomId`] = seat.userCustomId || '';
            setPayload[`seats.${seatIndex}.isLocked`] = nextLocked;
            setPayload[`seats.${seatIndex}.isMuted`] = Boolean(seat.isMuted);
            setPayload[`seats.${seatIndex}.isMicTurnedOff`] = Boolean(seat.isMicTurnedOff);
            setPayload[`seats.${seatIndex}.isSpeaking`] = Boolean(seat.isSpeaking);
        }

        const updateOp = nextLocked
            ? { $set: setPayload, $addToSet: { lockedSeats: seatIndex } }
            : { $set: setPayload, $pull: { lockedSeats: seatIndex } };

        await Room.updateOne(query, updateOp);
    } catch (err) {
        console.warn('[RoomSeatLock] Mongo lock persist notice:', err.message);
    }
}

/**
 * Room Seat Lock Activity (Completely Isolated Error Domain)
 * Handles Single-Seat Lock/Unlock and Bulk Lock/Unlock with Strict Hierarchy Guard.
 * Failures or rejections here NEVER propagate to Chat, Presence, Gifts, or Other Stage Seats.
 */
const roomSeatLockActivity = {
    async handleToggleSeatLock(data, ws, triggerPopularBroadcast = null) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const { canonicalRoomId, roomMeta, roomDoc } = await resolveRoomContext(rawRoomId, meta);

        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        if (!canonicalRoomId || Number.isNaN(seatIndex) || seatIndex < 0 || seatIndex >= SEAT_COUNT) {
            return;
        }

        const rawActorId = String(ws?._verifiedUid || meta?.verifiedUid || '').trim();
        if (!rawActorId) {
            sendLockRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.UNAUTHORIZED, 'Authentication required.');
            return;
        }
        const actorIds = await roomRoleHelper.resolveUserIdentifiers(rawActorId, meta?.userCustomId || '');
        const actorRole = roomRoleHelper.resolveUserRoleFromMetaSync(actorIds, roomMeta);

        if (!['owner', 'co_owner', 'admin'].includes(actorRole)) {
            sendLockRejected(
                ws,
                canonicalRoomId,
                seatIndex,
                ERROR_CODES.UNAUTHORIZED,
                'Only Room Owner, Co-Owner & Admin can lock or unlock seats.'
            );
            return;
        }

        if (!cacheService.roomHydratedSet.has(canonicalRoomId)) {
            await roomStateCache.hydrateFromRedisIfEmpty(canonicalRoomId);
            let docToHydrate = roomDoc;
            if (!docToHydrate && !cacheService.roomHydratedSet.has(canonicalRoomId)) {
                docToHydrate = await Room.findOne({
                    $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }]
                }).select('seats lockedSeats speakerSlots').lean().catch(() => null);
            }
            if (docToHydrate) {
                roomStateCache.hydrateSeats(
                    canonicalRoomId,
                    docToHydrate.seats,
                    docToHydrate.lockedSeats,
                    normalizeStageCapacity(docToHydrate.speakerSlots, DEFAULT_STAGE_CAPACITY)
                );
            }
        }

        const seats = roomStateCache.getOrCreateSeats(canonicalRoomId);
        const seat = seats[seatIndex];
        if (!seat) return;

        const nextLocked = data.isLocked !== undefined ? Boolean(data.isLocked) : !Boolean(seat.isLocked);
        const currentOccupantId = String(seat.userId || '').trim();

        if (currentOccupantId && currentOccupantId !== 'null') {
            const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
            const occupantRole = roomRoleHelper.resolveUserRoleFromMetaSync(occIds, roomMeta);
            const isSelfOccupant = Array.from(occIds).some((id) => actorIds.has(id));

            if (!isSelfOccupant && !roomRoleHelper.canModerate(actorRole, occupantRole)) {
                const msg = occupantRole === 'owner'
                    ? 'Room Owner seat cannot be locked!'
                    : 'Admin cannot lock a Co-Owner seat!';
                sendLockRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.HIERARCHY_PROTECTED, msg);
                return;
            }
        }

        seat.isLocked = nextLocked;
        let kickedUserId = null;
        let vacatedOccupant = false;

        if (nextLocked && currentOccupantId && currentOccupantId !== 'null') {
            const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
            flushSeatMicTimeSafe(seat);
            kickedUserId = currentOccupantId;
            seat.userId = null;
            seat.seatedAt = null;
            seat.userName = null;
            seat.userAvatar = null;
            seat.userCustomId = '';
            seat.isSpeaking = false;
            seat.isMuted = Boolean(seat.isMicTurnedOff);
            roomStateCache.updateParticipantSeatState(canonicalRoomId, occIds, false, -1, roomMeta);
            vacatedOccupant = true;
        }

        const seatPacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat, kickedUserId);
        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta, roomDoc);
        channelManager.broadcastToRoomTargets(targets, seatPacket);

        roomStateCache.persistSeatLockToRedisAsync(canonicalRoomId, seatIndex, nextLocked);
        roomStateCache.persistStateToRedisAsync(canonicalRoomId, roomMeta);
        persistSeatLockToMongo(canonicalRoomId, rawRoomId, seatIndex, seat, seats);

        if (vacatedOccupant) {
            await roomPresenceActivity.emitStateUpdate(canonicalRoomId, rawRoomId, meta, roomMeta, roomDoc, triggerPopularBroadcast);
        }
    }
};

module.exports = roomSeatLockActivity;
