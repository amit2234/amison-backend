const Room = require('../../../models/Room');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const { SEAT_COUNT, ERROR_CODES } = require('../room.constants');
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

function persistSeatLockToMongo(roomId, rawRoomId, seatIndex, seat) {
    Room.updateOne(
        {
            $or: [
                { roomId },
                { ownerUid: roomId },
                { displayRoomId: roomId },
                ...(rawRoomId ? [{ displayRoomId: rawRoomId }] : [])
            ]
        },
        {
            $set: {
                [`seats.${seatIndex}.index`]: seatIndex,
                [`seats.${seatIndex}.seatIndex`]: seatIndex,
                [`seats.${seatIndex}.userId`]: seat.userId || null,
                [`seats.${seatIndex}.name`]: seat.userName || null,
                [`seats.${seatIndex}.userName`]: seat.userName || null,
                [`seats.${seatIndex}.avatar`]: seat.userAvatar || null,
                [`seats.${seatIndex}.userAvatar`]: seat.userAvatar || null,
                [`seats.${seatIndex}.userCustomId`]: seat.userCustomId || '',
                [`seats.${seatIndex}.isLocked`]: Boolean(seat.isLocked),
                [`seats.${seatIndex}.isMuted`]: Boolean(seat.isMuted),
                [`seats.${seatIndex}.isMicTurnedOff`]: Boolean(seat.isMicTurnedOff),
                [`seats.${seatIndex}.isSpeaking`]: Boolean(seat.isSpeaking),
                updatedAt: new Date()
            }
        }
    ).catch((err) => console.warn('[RoomSeatLock] Mongo lock persist notice:', err.message));
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

        const rawActorId = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || data.actorUserId || data.userId || '').trim();
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

        persistSeatLockToMongo(canonicalRoomId, rawRoomId, seatIndex, seat);
        roomStateCache.persistStateToRedisAsync(canonicalRoomId, roomMeta);

        if (vacatedOccupant) {
            await roomPresenceActivity.emitStateUpdate(canonicalRoomId, rawRoomId, meta, roomMeta, roomDoc, triggerPopularBroadcast);
        }
    }
};

module.exports = roomSeatLockActivity;
