const Room = require('../../../models/Room');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const cacheService = require('../../../services/cacheService');
const { SEAT_COUNT, DEFAULT_STAGE_CAPACITY, normalizeStageCapacity, ERROR_CODES } = require('../room.constants');
const { channelManager, resolveRoomContext, getBroadcastTargets } = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');
const roomPresenceActivity = require('./roomPresence.activity');
const roomSeatLockActivity = require('./roomSeatLock.activity');

function sendSeatRejected(ws, roomId, seatIndex, reason, message) {
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

function flushSeatMicTime(seat) {
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

function clearSeatOccupantFields(seat) {
    seat.userId = null;
    seat.seatedAt = null;
    seat.userName = null;
    seat.userAvatar = null;
    seat.userCustomId = '';
    seat.isSpeaking = false;
}

function persistSeatToMongo(roomId, rawRoomId, seatIndex, seat) {
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
                [`seats.${seatIndex}.isMuted`]: Boolean(seat.isMuted),
                [`seats.${seatIndex}.isMicTurnedOff`]: Boolean(seat.isMicTurnedOff),
                [`seats.${seatIndex}.isSpeaking`]: Boolean(seat.isSpeaking),
                updatedAt: new Date()
            }
        }
    ).catch((err) => console.warn('[RoomStageSeats] Mongo seat update notice:', err.message));
}

/**
 * Room Stage Seats Activity
 * Handles Take Seat, Leave Seat, Host Mute Seat, Self Mic Toggle, Mic Wave State, and Seat Emojis.
 * Delegates Lock/Unlock cleanly to roomSeatLockActivity so lock faults stay isolated.
 */
const roomStageSeatsActivity = {
    async handleSeatUpdate(data, ws, triggerPopularBroadcast = null) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const { canonicalRoomId, roomMeta, roomDoc } = await resolveRoomContext(rawRoomId, meta);

        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        if (!canonicalRoomId || Number.isNaN(seatIndex) || seatIndex < 0 || seatIndex >= SEAT_COUNT) return;

        const rawActorId = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || data.actorUserId || data.userId || '').trim();
        const rawTargetUserId = data.userId !== undefined ? String(data.userId || '').trim() : '';
        const targetUserId = (rawTargetUserId === 'null' || rawTargetUserId === 'undefined') ? '' : rawTargetUserId;

        const explicitAction = String(data.action || '').trim().toLowerCase();
        const action = explicitAction || (
            data.isLocked !== undefined ? 'lock_seat'
                : (data.isMicTurnedOff !== undefined || (data.isMuted !== undefined && !targetUserId)) ? 'mute_seat'
                    : (data.onSeat === false || targetUserId === '') ? 'leave_seat'
                        : 'take_seat'
        );

        // Delegate Lock/Unlock cleanly to dedicated isolated Lock Activity
        if (action === 'lock_seat') {
            await roomSeatLockActivity.handleToggleSeatLock(data, ws, triggerPopularBroadcast);
            return;
        }

        const actorIds = await roomRoleHelper.resolveUserIdentifiers(rawActorId, meta?.userCustomId || '');
        const actorRole = roomRoleHelper.resolveUserRoleFromMetaSync(actorIds, roomMeta);

        if (!cacheService.roomHydratedSet.has(canonicalRoomId)) {
            await roomStateCache.hydrateFromRedisIfEmpty(canonicalRoomId);
            let docForHydration = roomDoc;
            if (!docForHydration && !cacheService.roomHydratedSet.has(canonicalRoomId)) {
                docForHydration = await Room.findOne({
                    $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }]
                }).select('seats lockedSeats speakerSlots').lean().catch(() => null);
            }
            if (docForHydration) {
                roomStateCache.hydrateSeats(
                    canonicalRoomId,
                    docForHydration.seats,
                    docForHydration.lockedSeats,
                    normalizeStageCapacity(docForHydration.speakerSlots, DEFAULT_STAGE_CAPACITY)
                );
            }
        }

        const seats = roomStateCache.getOrCreateSeats(canonicalRoomId);
        const seat = seats[seatIndex];
        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta, roomDoc);

        if (action === 'mute_seat') {
            const currentOccupantId = String(seat.userId || '').trim();
            const occIds = (currentOccupantId && currentOccupantId !== 'null')
                ? await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '')
                : new Set();
            const isSelfOccupant = occIds.size > 0 && Array.from(occIds).some((id) => actorIds.has(id));

            if (!['owner', 'co_owner', 'admin'].includes(actorRole) && !isSelfOccupant) {
                sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.UNAUTHORIZED, 'Only Room Owner, Co-Owner & Admin can mute or unmute seats.');
                return;
            }
            if (occIds.size > 0 && !isSelfOccupant) {
                const occupantRole = roomRoleHelper.resolveUserRoleFromMetaSync(occIds, roomMeta);
                if (!roomRoleHelper.canModerate(actorRole, occupantRole)) {
                    const msg = occupantRole === 'owner'
                        ? 'Room Owner cannot be muted!'
                        : 'Admin cannot mute a Co-Owner!';
                    sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.HIERARCHY_PROTECTED, msg);
                    return;
                }
            }

            const nextTurnOff = data.isMicTurnedOff !== undefined
                ? Boolean(data.isMicTurnedOff)
                : (data.isMuted !== undefined ? Boolean(data.isMuted) : !Boolean(seat.isMicTurnedOff));

            if (isSelfOccupant && !nextTurnOff && seat.isMicTurnedOff && seat.mutedByRole) {
                if (roomRoleHelper.roleRank(actorRole) < roomRoleHelper.roleRank(seat.mutedByRole)) {
                    sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.MIC_MUTED_BY_HOST, 'Your mic was muted by host!');
                    return;
                }
            }

            seat.isMicTurnedOff = nextTurnOff;
            seat.isMuted = nextTurnOff;
            seat.mutedByRole = nextTurnOff ? actorRole : '';
            if (nextTurnOff) seat.isSpeaking = false;

            const seatPacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat);
            channelManager.broadcastToRoomTargets(targets, seatPacket);
            channelManager.broadcastToRoomTargets(targets, {
                type: 'mic:state',
                roomId: canonicalRoomId,
                userId: currentOccupantId,
                seatIndex,
                isSpeaking: Boolean(seat.isSpeaking),
                isMuted: Boolean(seat.isMuted)
            });
            persistSeatToMongo(canonicalRoomId, rawRoomId, seatIndex, seat);
            roomStateCache.persistStateToRedisAsync(canonicalRoomId, roomMeta);
            return;
        }

        if (action === 'self_mic') {
            const currentOccupantId = String(seat.userId || '').trim();
            if (!currentOccupantId || currentOccupantId === 'null') return;
            const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
            const isSelfOccupant = Array.from(occIds).some((id) => actorIds.has(id));
            if (!isSelfOccupant) {
                sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.UNAUTHORIZED, 'You can only toggle your own mic.');
                return;
            }
            const nextMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : !Boolean(seat.isMuted);
            if (!nextMuted && seat.isMicTurnedOff) {
                const mutedRank = roomRoleHelper.roleRank(seat.mutedByRole || 'owner');
                if (roomRoleHelper.roleRank(actorRole) < mutedRank) {
                    sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.MIC_MUTED_BY_HOST, 'Mic Muted by Host 🔇');
                    channelManager.broadcastToRoomTargets(targets, {
                        type: 'mic:state',
                        roomId: canonicalRoomId,
                        userId: currentOccupantId,
                        seatIndex,
                        isSpeaking: false,
                        isMuted: true
                    });
                    return;
                }
                seat.isMicTurnedOff = false;
                seat.mutedByRole = '';
            }
            seat.isMuted = nextMuted;
            if (nextMuted) seat.isSpeaking = false;

            const seatPacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat);
            channelManager.broadcastToRoomTargets(targets, seatPacket);
            channelManager.broadcastToRoomTargets(targets, {
                type: 'mic:state',
                roomId: canonicalRoomId,
                userId: currentOccupantId,
                seatIndex,
                isSpeaking: Boolean(seat.isSpeaking),
                isMuted: Boolean(seat.isMuted)
            });
            persistSeatToMongo(canonicalRoomId, rawRoomId, seatIndex, seat);
            roomStateCache.persistStateToRedisAsync(canonicalRoomId, roomMeta);
            return;
        }

        if (action === 'leave_seat') {
            const currentOccupantId = String(seat.userId || '').trim();
            if (!currentOccupantId || currentOccupantId === 'null') {
                const seatPacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat);
                channelManager.broadcastToRoomTargets(targets, seatPacket);
                return;
            }
            const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
            const isSelfOccupant = Array.from(occIds).some((id) => actorIds.has(id));
            if (!isSelfOccupant) {
                const occupantRole = roomRoleHelper.resolveUserRoleFromMetaSync(occIds, roomMeta);
                if (!roomRoleHelper.canModerate(actorRole, occupantRole)) {
                    const msg = occupantRole === 'owner'
                        ? 'Room Owner cannot be removed from seat!'
                        : 'Admin cannot remove Co-Owner from seat!';
                    sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.HIERARCHY_PROTECTED, msg);
                    return;
                }
            }

            flushSeatMicTime(seat);
            clearSeatOccupantFields(seat);
            seat.isMuted = Boolean(seat.isMicTurnedOff);
            roomStateCache.updateParticipantSeatState(canonicalRoomId, occIds, false, -1, roomMeta);

            const seatPacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat, currentOccupantId);
            channelManager.broadcastToRoomTargets(targets, seatPacket);
            persistSeatToMongo(canonicalRoomId, rawRoomId, seatIndex, seat);
            await roomPresenceActivity.emitStateUpdate(canonicalRoomId, rawRoomId, meta, roomMeta, roomDoc, triggerPopularBroadcast);
            return;
        }

        // Default: take_seat
        const activeCapacity = roomStateCache.getSpeakerSlots(
            canonicalRoomId,
            normalizeStageCapacity(roomDoc?.speakerSlots, DEFAULT_STAGE_CAPACITY)
        );
        if (seatIndex >= activeCapacity) {
            sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.SEAT_DISABLED, `Seat ${seatIndex + 1} is currently closed.`);
            return;
        }

        const effectiveTargetId = targetUserId || rawActorId;
        if (!effectiveTargetId) return;

        const targetIds = await roomRoleHelper.resolveUserIdentifiers(effectiveTargetId, data.userCustomId || meta?.userCustomId || '');
        const isActingForSelf = Array.from(targetIds).some((id) => actorIds.has(id));
        if (!isActingForSelf && !['owner', 'co_owner', 'admin'].includes(actorRole)) {
            sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.UNAUTHORIZED, 'Unauthorized seat action.');
            return;
        }

        if (seat.isLocked) {
            const targetRole = roomRoleHelper.resolveUserRoleFromMetaSync(targetIds, roomMeta);
            if (targetRole !== 'owner') {
                sendSeatRejected(ws, canonicalRoomId, seatIndex, ERROR_CODES.SEAT_LOCKED, `Seat ${seatIndex + 1} is locked by host!`);
                return;
            }
        }

        const existingOccId = String(seat.userId || '').trim();
        if (existingOccId && existingOccId !== 'null') {
            const existingOccIds = await roomRoleHelper.resolveUserIdentifiers(existingOccId, seat.userCustomId || '');
            const isSameUser = Array.from(existingOccIds).some((id) => targetIds.has(id));
            if (!isSameUser) {
                sendSeatRejected(
                    ws,
                    canonicalRoomId,
                    seatIndex,
                    ERROR_CODES.SEAT_ALREADY_OCCUPIED,
                    `Seat ${seatIndex + 1} is already occupied by ${seat.userName || 'another user'}!`
                );
                return;
            }
        }

        // Vacate any previous seat held by this user atomically
        for (let otherIdx = 0; otherIdx < seats.length; otherIdx++) {
            const otherSeat = seats[otherIdx];
            if (otherIdx === seatIndex || !otherSeat || !otherSeat.userId || otherSeat.userId === 'null') continue;
            const oId = String(otherSeat.userId).trim();
            const oCustom = String(otherSeat.userCustomId || '').trim();
            if (targetIds.has(oId) || (oCustom && targetIds.has(oCustom))) {
                flushSeatMicTime(otherSeat);
                clearSeatOccupantFields(otherSeat);
                otherSeat.isMuted = Boolean(otherSeat.isMicTurnedOff);
                const vacatePacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, otherIdx, otherSeat);
                channelManager.broadcastToRoomTargets(targets, vacatePacket);
                persistSeatToMongo(canonicalRoomId, rawRoomId, otherIdx, otherSeat);
            }
        }

        seat.userId = effectiveTargetId;
        seat.seatedAt = Date.now();
        seat.userName = (data.userName && data.userName !== 'null' && data.userName !== 'undefined')
            ? String(data.userName).trim()
            : (data.name && data.name !== 'null' ? String(data.name).trim() : (meta?.userName || 'User'));
        seat.userAvatar = (data.userAvatar && data.userAvatar !== 'null' && data.userAvatar !== 'undefined')
            ? String(data.userAvatar).trim()
            : (data.avatar && data.avatar !== 'null' ? String(data.avatar).trim() : '');
        seat.userCustomId = (data.userCustomId && data.userCustomId !== 'null' && data.userCustomId !== 'undefined')
            ? String(data.userCustomId).trim()
            : (meta?.userCustomId || '');
        seat.isMuted = Boolean(seat.isMicTurnedOff);
        seat.isSpeaking = false;

        roomStateCache.updateParticipantSeatState(canonicalRoomId, targetIds, true, seatIndex, roomMeta);

        const seatPacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, rawRoomId, seatIndex, seat);
        channelManager.broadcastToRoomTargets(targets, seatPacket);
        persistSeatToMongo(canonicalRoomId, rawRoomId, seatIndex, seat);
        await roomPresenceActivity.emitStateUpdate(canonicalRoomId, rawRoomId, meta, roomMeta, roomDoc, triggerPopularBroadcast);
    },

    async handleSendSeatEmoji(data, ws) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const canonicalRoomId = meta?.canonicalRoomId || channelManager.getCanonicalId(rawRoomId) || rawRoomId;
        const slotIndex = data.slotIndex !== undefined ? Number(data.slotIndex) : (data.seatIndex !== undefined ? Number(data.seatIndex) : -1);
        const senderId = String(ws?._verifiedUid || meta?.verifiedUid || data.senderId || meta?.userId || '').trim();
        const mediaUrl = String(data.mediaUrl || data.emojiUrl || '').trim();

        if (canonicalRoomId && slotIndex >= 0 && slotIndex < SEAT_COUNT && mediaUrl) {
            const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta);
            channelManager.broadcastToRoomTargets(targets, {
                type: 'seat_emoji_broadcast',
                eventId: `evt_emoji_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                roomId: canonicalRoomId,
                slotIndex,
                seatIndex: slotIndex,
                senderId,
                senderName: data.senderName || meta?.userName || 'User',
                emojiId: data.emojiId || '',
                mediaUrl,
                isSvga: Boolean(data.isSvga),
                timestamp: Date.now()
            });
        }
    },

    async handleMicState(data, ws) {
        const meta = channelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const { canonicalRoomId, roomMeta } = await resolveRoomContext(rawRoomId, meta);
        const actorUid = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || data.userId || '').trim();
        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        let isSpeaking = Boolean(data.isSpeaking);
        let isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : false;

        if (!canonicalRoomId) return;

        if (seatIndex >= 0 && seatIndex < SEAT_COUNT) {
            const seats = roomStateCache.getOrCreateSeats(canonicalRoomId);
            const seat = seats[seatIndex];
            if (seat) {
                const occId = String(seat.userId || '').trim();
                const actorIds = await roomRoleHelper.resolveUserIdentifiers(actorUid, meta?.userCustomId || '');
                const occIds = occId ? await roomRoleHelper.resolveUserIdentifiers(occId, seat.userCustomId || '') : new Set();
                const isSelf = occIds.size > 0 && Array.from(occIds).some((id) => actorIds.has(id));
                if (!isSelf) return;

                if (seat.isMicTurnedOff) {
                    const actorRole = roomRoleHelper.resolveUserRoleFromMetaSync(actorIds, roomMeta);
                    if (roomRoleHelper.roleRank(actorRole) < roomRoleHelper.roleRank(seat.mutedByRole || 'owner')) {
                        isMuted = true;
                        isSpeaking = false;
                    }
                }
                seat.isMuted = isMuted;
                seat.isSpeaking = isMuted ? false : isSpeaking;
            }
        }

        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta);
        channelManager.broadcastToRoomTargets(targets, {
            type: 'mic:state',
            roomId: canonicalRoomId,
            userId: actorUid,
            seatIndex,
            isSpeaking,
            isMuted
        });
    }
};

module.exports = roomStageSeatsActivity;
