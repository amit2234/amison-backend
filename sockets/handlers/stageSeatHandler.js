const Room = require('../../models/Room');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');
const roomRoleHelper = require('../../services/roomRoleHelper');

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
                const DailyTaskService = require('../../services/dailyTaskService');
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

function buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat, kickedUserId = null) {
    return {
        type: 'seat:update',
        roomId,
        rawRoomId,
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

function broadcastPacketToRoomChannels(roomId, rawRoomId, meta, packet) {
    const targets = new Set([roomId, rawRoomId, meta?.roomId, meta?.canonicalRoomId].filter(Boolean));
    // Note: roomChannelManager already fans out to canonical + alias channels; call once per unique non-canonical alias just in case
    const sentChannels = new Set();
    targets.forEach((ch) => {
        const canonical = roomChannelManager.getCanonicalId(ch) || ch;
        if (!sentChannels.has(canonical)) {
            sentChannels.add(canonical);
            roomChannelManager.broadcastToRoom(ch, packet);
        }
    });
}

function persistSeatToMongo(roomId, rawRoomId, seatIndex, seat) {
    Room.updateOne(
        { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }, { displayRoomId: rawRoomId }] },
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
    ).catch(err => console.error('[StageSeatHandler] Mongo seat update error:', err.message));
}

async function resolveTargetRoomContext(rawRoomId, meta) {
    let roomId = meta?.canonicalRoomId || roomChannelManager.getCanonicalId(rawRoomId) || rawRoomId;
    let roomMeta = roomRoleHelper.getCachedRoomRoles(roomId) || roomRoleHelper.getCachedRoomRoles(rawRoomId);
    let roomDoc = null;

    if (!roomMeta && rawRoomId) {
        try {
            roomDoc = await Room.findOne({
                $or: [{ displayRoomId: rawRoomId }, { ownerUid: rawRoomId }, { roomId: rawRoomId }]
            }).lean();
            if (roomDoc) {
                roomId = roomDoc.ownerUid || roomDoc.displayRoomId || rawRoomId;
                if (roomDoc.displayRoomId && roomDoc.ownerUid && typeof roomChannelManager.registerAlias === 'function') {
                    roomChannelManager.registerAlias(roomDoc.displayRoomId, roomDoc.ownerUid);
                    roomChannelManager.registerAlias(roomDoc.roomId, roomDoc.ownerUid);
                }
                roomMeta = roomRoleHelper.cacheRoomRoles(roomDoc);
            }
        } catch (_) {}
    } else if (roomMeta?.canonicalRoomId) {
        roomId = roomMeta.canonicalRoomId;
    }

    if (!roomMeta && roomId) {
        roomMeta = await roomRoleHelper.resolveRoomRolesMeta(roomId, roomDoc);
    }

    if ((!roomId || roomId === rawRoomId) && meta?.canonicalRoomId) {
        roomId = meta.canonicalRoomId;
    }
    if (!roomId) roomId = rawRoomId;

    return { roomId, roomMeta, roomDoc };
}

function updateParticipantSeatState(roomParticipants, identifiers, onSeat, seatIndex, roomMeta) {
    if (!roomParticipants) return;
    roomParticipants.forEach((p, key) => {
        const match = identifiers.has(String(key).trim()) ||
            identifiers.has(String(p.userId || '').trim()) ||
            (p.numericId && identifiers.has(String(p.numericId).trim()));
        if (match) {
            p.onSeat = onSeat;
            p.seatIndex = onSeat ? seatIndex : -1;
            const normRole = roomRoleHelper.resolveUserRoleFromMetaSync(identifiers, roomMeta);
            p.role = roomRoleHelper.toDisplayRole(normRole, onSeat);
            roomParticipants.set(key, p);
        }
    });
}

async function emitRoomHeatAndState(roomId, rawRoomId, meta, roomMeta, wss, broadcastPopularRooms) {
    const roomParticipants = cacheService.getRoomParticipants(roomId);
    const seats = cacheService.getOrCreateRoomSeats(roomId);
    const onlineCount = roomParticipants.size;
    const stageMics = seats.filter(s => s && s.userId && s.userId !== 'null').length;
    const heatScore = cacheService.calculateRoomHeat(roomParticipants) || ((onlineCount * 10) + (stageMics * 25));

    Room.updateOne(
        { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }, { displayRoomId: rawRoomId }] },
        { $set: { heatScore, onlineCount, updatedAt: new Date() } }
    ).catch(() => {});

    broadcastPacketToRoomChannels(roomId, rawRoomId, meta, {
        type: 'room:state_update',
        roomId,
        ownerUid: roomMeta?.ownerUid || '',
        coOwners: roomMeta?.coOwners || [],
        admins: roomMeta?.admins || [],
        heatScore,
        onlineCount,
        participants: Array.from(roomParticipants.values())
    });

    if (typeof broadcastPopularRooms === 'function') {
        await broadcastPopularRooms(wss);
    }
}

/**
 * Handles 16-Mic Stage Seating, Mute/Unmute, and Lock/Unlock Events
 * 100% Zero-Trust Server Authority Engine (0ms RAM path + Cryptographic UID Authority)
 */
const stageSeatHandler = {
    async handleSeatUpdate(data, ws, wss, broadcastPopularRooms) {
        if (ws && ws._authPromise) {
            try { await ws._authPromise; } catch (_) {}
        }
        const meta = (ws && typeof roomChannelManager.getMetadata === 'function')
            ? roomChannelManager.getMetadata(ws)
            : null;
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const { roomId, roomMeta } = await resolveTargetRoomContext(rawRoomId, meta);

        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        if (!roomId || Number.isNaN(seatIndex) || seatIndex < 0 || seatIndex >= 16) return;

        // Actor Identity: ALWAYS prefer verified Firebase Auth UID from WebSocket session
        const rawActorId = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || data.actorUserId || data.userId || '').trim();
        const actorIds = await roomRoleHelper.resolveUserIdentifiers(rawActorId, meta?.userCustomId || '');
        const actorRole = roomRoleHelper.resolveUserRoleFromMetaSync(actorIds, roomMeta);

        const rawTargetUserId = data.userId !== undefined ? String(data.userId || '').trim() : '';
        const targetUserId = (rawTargetUserId === 'null' || rawTargetUserId === 'undefined') ? '' : rawTargetUserId;

        // Infer unambiguous action
        const explicitAction = String(data.action || '').trim().toLowerCase();
        const action = explicitAction || (
            data.isLocked !== undefined ? 'lock_seat'
                : (data.isMicTurnedOff !== undefined || (data.isMuted !== undefined && !targetUserId)) ? 'mute_seat'
                    : (data.onSeat === false || targetUserId === '') ? 'leave_seat'
                        : 'take_seat'
        );

        const seats = cacheService.getOrCreateRoomSeats(roomId);
        const seat = seats[seatIndex];
        const roomParticipants = cacheService.getRoomParticipants(roomId);
        let stateNeedsBroadcast = false;

        if (action === 'lock_seat') {
            if (!['owner', 'co_owner', 'admin'].includes(actorRole)) {
                sendSeatRejected(ws, roomId, seatIndex, 'UNAUTHORIZED', 'Only Room Owner, Co-Owner & Admin can lock or unlock seats.');
                return;
            }
            const nextLocked = data.isLocked !== undefined ? Boolean(data.isLocked) : !Boolean(seat.isLocked);
            const currentOccupantId = String(seat.userId || '').trim();
            if (currentOccupantId && currentOccupantId !== 'null') {
                const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
                const occupantRole = roomRoleHelper.resolveUserRoleFromMetaSync(occIds, roomMeta);
                const isSelfOccupant = Array.from(occIds).some(id => actorIds.has(id));
                if (!isSelfOccupant && !roomRoleHelper.canModerate(actorRole, occupantRole)) {
                    const msg = occupantRole === 'owner'
                        ? 'Room Owner seat cannot be locked!'
                        : 'Admin cannot lock a Co-Owner seat!';
                    sendSeatRejected(ws, roomId, seatIndex, 'HIERARCHY_PROTECTED', msg);
                    return;
                }
            }

            seat.isLocked = nextLocked;
            let kickedUserId = null;
            if (nextLocked && currentOccupantId && currentOccupantId !== 'null') {
                const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
                flushSeatMicTime(seat);
                kickedUserId = currentOccupantId;
                clearSeatOccupantFields(seat);
                seat.isMuted = Boolean(seat.isMicTurnedOff);
                updateParticipantSeatState(roomParticipants, occIds, false, -1, roomMeta);
                stateNeedsBroadcast = true;
            }

            const seatPacket = buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat, kickedUserId);
            broadcastPacketToRoomChannels(roomId, rawRoomId, meta, seatPacket);
            persistSeatToMongo(roomId, rawRoomId, seatIndex, seat);
            if (stateNeedsBroadcast) {
                await emitRoomHeatAndState(roomId, rawRoomId, meta, roomMeta, wss, broadcastPopularRooms);
            }
            return;
        }

        if (action === 'mute_seat') {
            const currentOccupantId = String(seat.userId || '').trim();
            const occIds = (currentOccupantId && currentOccupantId !== 'null')
                ? await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '')
                : new Set();
            const isSelfOccupant = occIds.size > 0 && Array.from(occIds).some(id => actorIds.has(id));

            if (!['owner', 'co_owner', 'admin'].includes(actorRole) && !isSelfOccupant) {
                sendSeatRejected(ws, roomId, seatIndex, 'UNAUTHORIZED', 'Only Room Owner, Co-Owner & Admin can mute or unmute seats.');
                return;
            }
            if (occIds.size > 0 && !isSelfOccupant) {
                const occupantRole = roomRoleHelper.resolveUserRoleFromMetaSync(occIds, roomMeta);
                if (!roomRoleHelper.canModerate(actorRole, occupantRole)) {
                    const msg = occupantRole === 'owner'
                        ? 'Room Owner cannot be muted!'
                        : 'Admin cannot mute a Co-Owner!';
                    sendSeatRejected(ws, roomId, seatIndex, 'HIERARCHY_PROTECTED', msg);
                    return;
                }
            }

            const nextTurnOff = data.isMicTurnedOff !== undefined
                ? Boolean(data.isMicTurnedOff)
                : (data.isMuted !== undefined ? Boolean(data.isMuted) : !Boolean(seat.isMicTurnedOff));

            // If a lower-ranked user was host-muted by a higher rank and tries to toggle mute_seat on themselves, guard it
            if (isSelfOccupant && !nextTurnOff && seat.isMicTurnedOff && seat.mutedByRole) {
                if (roomRoleHelper.roleRank(actorRole) < roomRoleHelper.roleRank(seat.mutedByRole)) {
                    sendSeatRejected(ws, roomId, seatIndex, 'MIC_MUTED_BY_HOST', 'Your mic was muted by host!');
                    return;
                }
            }

            seat.isMicTurnedOff = nextTurnOff;
            seat.isMuted = nextTurnOff;
            seat.mutedByRole = nextTurnOff ? actorRole : '';
            if (nextTurnOff) {
                seat.isSpeaking = false;
            }

            const seatPacket = buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat);
            broadcastPacketToRoomChannels(roomId, rawRoomId, meta, seatPacket);
            broadcastPacketToRoomChannels(roomId, rawRoomId, meta, {
                type: 'mic:state',
                roomId,
                userId: currentOccupantId,
                seatIndex,
                isSpeaking: Boolean(seat.isSpeaking),
                isMuted: Boolean(seat.isMuted)
            });
            persistSeatToMongo(roomId, rawRoomId, seatIndex, seat);
            return;
        }

        if (action === 'self_mic') {
            const currentOccupantId = String(seat.userId || '').trim();
            if (!currentOccupantId || currentOccupantId === 'null') return;
            const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
            const isSelfOccupant = Array.from(occIds).some(id => actorIds.has(id));
            if (!isSelfOccupant) {
                sendSeatRejected(ws, roomId, seatIndex, 'UNAUTHORIZED', 'You can only toggle your own mic.');
                return;
            }
            const nextMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : !Boolean(seat.isMuted);
            if (!nextMuted && seat.isMicTurnedOff) {
                const mutedRank = roomRoleHelper.roleRank(seat.mutedByRole || 'owner');
                if (roomRoleHelper.roleRank(actorRole) < mutedRank) {
                    sendSeatRejected(ws, roomId, seatIndex, 'MIC_MUTED_BY_HOST', 'Mic Muted by Host 🔇');
                    broadcastPacketToRoomChannels(roomId, rawRoomId, meta, {
                        type: 'mic:state',
                        roomId,
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

            const seatPacket = buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat);
            broadcastPacketToRoomChannels(roomId, rawRoomId, meta, seatPacket);
            broadcastPacketToRoomChannels(roomId, rawRoomId, meta, {
                type: 'mic:state',
                roomId,
                userId: currentOccupantId,
                seatIndex,
                isSpeaking: Boolean(seat.isSpeaking),
                isMuted: Boolean(seat.isMuted)
            });
            persistSeatToMongo(roomId, rawRoomId, seatIndex, seat);
            return;
        }

        if (action === 'leave_seat') {
            const currentOccupantId = String(seat.userId || '').trim();
            if (!currentOccupantId || currentOccupantId === 'null') {
                // Seat already empty; ensure clean state broadcast if requested
                const seatPacket = buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat);
                broadcastPacketToRoomChannels(roomId, rawRoomId, meta, seatPacket);
                return;
            }
            const occIds = await roomRoleHelper.resolveUserIdentifiers(currentOccupantId, seat.userCustomId || '');
            const isSelfOccupant = Array.from(occIds).some(id => actorIds.has(id));
            if (!isSelfOccupant) {
                const occupantRole = roomRoleHelper.resolveUserRoleFromMetaSync(occIds, roomMeta);
                if (!roomRoleHelper.canModerate(actorRole, occupantRole)) {
                    const msg = occupantRole === 'owner'
                        ? 'Room Owner cannot be removed from seat!'
                        : 'Admin cannot remove Co-Owner from seat!';
                    sendSeatRejected(ws, roomId, seatIndex, 'HIERARCHY_PROTECTED', msg);
                    return;
                }
            }

            flushSeatMicTime(seat);
            clearSeatOccupantFields(seat);
            seat.isMuted = Boolean(seat.isMicTurnedOff);
            updateParticipantSeatState(roomParticipants, occIds, false, -1, roomMeta);

            const seatPacket = buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat, currentOccupantId);
            broadcastPacketToRoomChannels(roomId, rawRoomId, meta, seatPacket);
            persistSeatToMongo(roomId, rawRoomId, seatIndex, seat);
            await emitRoomHeatAndState(roomId, rawRoomId, meta, roomMeta, wss, broadcastPopularRooms);
            return;
        }

        // Default action === 'take_seat'
        const effectiveTargetId = targetUserId || rawActorId;
        if (!effectiveTargetId) return;

        const targetIds = await roomRoleHelper.resolveUserIdentifiers(effectiveTargetId, data.userCustomId || meta?.userCustomId || '');
        const isActingForSelf = Array.from(targetIds).some(id => actorIds.has(id));
        if (!isActingForSelf && !['owner', 'co_owner', 'admin'].includes(actorRole)) {
            sendSeatRejected(ws, roomId, seatIndex, 'UNAUTHORIZED', 'Unauthorized seat action.');
            return;
        }

        // Rule 1: Locked seat check (only Room Owner may sit on locked seat directly)
        if (seat.isLocked) {
            const targetRole = roomRoleHelper.resolveUserRoleFromMetaSync(targetIds, roomMeta);
            if (targetRole !== 'owner') {
                sendSeatRejected(ws, roomId, seatIndex, 'SEAT_LOCKED', `Seat ${seatIndex + 1} is locked by host!`);
                return;
            }
        }

        // Rule 2: Already occupied by another user
        const existingOccId = String(seat.userId || '').trim();
        if (existingOccId && existingOccId !== 'null') {
            const existingOccIds = await roomRoleHelper.resolveUserIdentifiers(existingOccId, seat.userCustomId || '');
            const isSameUser = Array.from(existingOccIds).some(id => targetIds.has(id));
            if (!isSameUser) {
                sendSeatRejected(
                    ws,
                    roomId,
                    seatIndex,
                    'SEAT_ALREADY_OCCUPIED',
                    `Seat ${seatIndex + 1} is already occupied by ${seat.userName || 'another user'}!`
                );
                return;
            }
        }

        // Rule 3: Vacate any other seat held by this user
        for (let otherIdx = 0; otherIdx < seats.length; otherIdx++) {
            const otherSeat = seats[otherIdx];
            if (otherIdx === seatIndex || !otherSeat || !otherSeat.userId || otherSeat.userId === 'null') continue;
            const oId = String(otherSeat.userId).trim();
            const oCustom = String(otherSeat.userCustomId || '').trim();
            if (targetIds.has(oId) || (oCustom && targetIds.has(oCustom))) {
                flushSeatMicTime(otherSeat);
                clearSeatOccupantFields(otherSeat);
                otherSeat.isMuted = Boolean(otherSeat.isMicTurnedOff);
                const vacatePacket = buildSeatUpdatePacket(roomId, rawRoomId, otherIdx, otherSeat);
                broadcastPacketToRoomChannels(roomId, rawRoomId, meta, vacatePacket);
                persistSeatToMongo(roomId, rawRoomId, otherIdx, otherSeat);
            }
        }

        seat.userId = effectiveTargetId;
        seat.seatedAt = Date.now();
        const cleanName = (data.userName && data.userName !== 'null' && data.userName !== 'undefined')
            ? String(data.userName).trim()
            : (data.name && data.name !== 'null' ? String(data.name).trim() : (meta?.userName || 'User'));
        seat.userName = cleanName;
        const cleanAvatar = (data.userAvatar && data.userAvatar !== 'null' && data.userAvatar !== 'undefined')
            ? String(data.userAvatar).trim()
            : (data.avatar && data.avatar !== 'null' ? String(data.avatar).trim() : '');
        seat.userAvatar = cleanAvatar;
        seat.userCustomId = (data.userCustomId && data.userCustomId !== 'null' && data.userCustomId !== 'undefined')
            ? String(data.userCustomId).trim()
            : (meta?.userCustomId || '');
        // Inherit seat mute state if host pre-muted this seat while empty
        seat.isMuted = Boolean(seat.isMicTurnedOff);
        seat.isSpeaking = false;

        updateParticipantSeatState(roomParticipants, targetIds, true, seatIndex, roomMeta);

        const seatPacket = buildSeatUpdatePacket(roomId, rawRoomId, seatIndex, seat);
        broadcastPacketToRoomChannels(roomId, rawRoomId, meta, seatPacket);
        persistSeatToMongo(roomId, rawRoomId, seatIndex, seat);
        await emitRoomHeatAndState(roomId, rawRoomId, meta, roomMeta, wss, broadcastPopularRooms);
    },

    async handleSeatToggleLock(data, ws) {
        await stageSeatHandler.handleSeatUpdate(
            {
                ...data,
                action: 'lock_seat',
                isLocked: data.isLocked !== undefined ? Boolean(data.isLocked) : undefined
            },
            ws,
            null,
            null
        );
    },

    /**
     * Handles Live Mic Stage Seat Animated Emoji Broadcast
     */
    async handleSendSeatEmoji(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.canonicalRoomId || meta?.roomId || '').trim();
        const slotIndex = data.slotIndex !== undefined ? Number(data.slotIndex) : (data.seatIndex !== undefined ? Number(data.seatIndex) : -1);
        const senderId = String(ws?._verifiedUid || meta?.verifiedUid || data.senderId || meta?.userId || '').trim();
        const mediaUrl = String(data.mediaUrl || data.emojiUrl || '').trim();

        if (roomId && slotIndex >= 0 && slotIndex < 16 && mediaUrl) {
            roomChannelManager.broadcastToRoom(roomId, {
                type: 'seat_emoji_broadcast',
                eventId: `evt_emoji_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                roomId,
                slotIndex,
                seatIndex: slotIndex,
                senderId,
                senderName: data.senderName || 'User',
                emojiId: data.emojiId || '',
                mediaUrl,
                isSvga: Boolean(data.isSvga),
                timestamp: Date.now()
            });
        }
    },

    /**
     * Handles Live Mic State (Speaking wave animation, Mute/Unmute)
     */
    async handleMicState(data, ws) {
        if (ws && ws._authPromise) {
            try { await ws._authPromise; } catch (_) {}
        }
        const meta = roomChannelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const { roomId, roomMeta } = await resolveTargetRoomContext(rawRoomId, meta);
        const actorUid = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || data.userId || '').trim();
        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        let isSpeaking = Boolean(data.isSpeaking);
        let isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : false;

        if (!roomId) return;

        if (seatIndex >= 0 && seatIndex < 16) {
            const seats = cacheService.getOrCreateRoomSeats(roomId);
            const seat = seats[seatIndex];
            if (seat) {
                const occId = String(seat.userId || '').trim();
                const actorIds = await roomRoleHelper.resolveUserIdentifiers(actorUid, meta?.userCustomId || '');
                const occIds = occId ? await roomRoleHelper.resolveUserIdentifiers(occId, seat.userCustomId || '') : new Set();
                const isSelf = occIds.size > 0 && Array.from(occIds).some(id => actorIds.has(id));
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

        const micPacket = {
            type: 'mic:state',
            roomId,
            userId: actorUid,
            seatIndex,
            isSpeaking,
            isMuted
        };

        broadcastPacketToRoomChannels(roomId, rawRoomId, meta, micPacket);
    }
};

module.exports = stageSeatHandler;
