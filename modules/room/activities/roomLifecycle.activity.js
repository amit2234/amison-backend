const Room = require('../../../models/Room');
const User = require('../../../models/User');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const { verifyFirebaseIdTokenCryptographically } = require('../../../middleware/authMiddleware');
const { AUTH_PROMISE_WAIT_MS } = require('../room.constants');
const { channelManager, resolveRoomContext, getBroadcastTargets } = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');
const roomPresenceActivity = require('./roomPresence.activity');

function waitBoundedAuth(ws) {
    if (!ws || !ws._authPromise) return Promise.resolve();
    return Promise.race([
        ws._authPromise.catch(() => ''),
        new Promise((resolve) => setTimeout(resolve, AUTH_PROMISE_WAIT_MS))
    ]);
}

/**
 * Room Lifecycle Activity
 * Handles Enter (room:join), Leave (room:leave), Authoritative `room:snapshot` emission,
 * Multi-Socket Reconnect Protection, and Zombie Seat/Presence Cleanup on Disconnect.
 */
const roomLifecycleActivity = {
    async handleJoinRoom(data, ws, triggerPopularBroadcast = null) {
        await waitBoundedAuth(ws);

        const rawRoomId = String(data.roomId || '').trim();
        const userId = String(ws?._verifiedUid || '').trim();
        const displayRoomId = String(data.displayRoomId || '').trim();

        if (!rawRoomId || !userId || userId === 'null' || userId === 'undefined') return;

        // 1. Resolve canonical room context (ownerUid / roomId / displayRoomId)
        const { canonicalRoomId, roomMeta: resolvedMeta, roomDoc: initialDoc } = await resolveRoomContext(
            rawRoomId,
            channelManager.getMetadata(ws),
            displayRoomId
        );

        let roomDoc = initialDoc;
        if (!roomDoc) {
            try {
                const orCond = [{ displayRoomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { roomId: canonicalRoomId }];
                if (rawRoomId && rawRoomId !== canonicalRoomId) orCond.push({ displayRoomId: rawRoomId });
                if (displayRoomId) orCond.push({ displayRoomId });
                roomDoc = await Room.findOne({ $or: orCond }).lean();
            } catch (_) {}
        }

        const effectiveCanonicalId = roomDoc ? String(roomDoc.ownerUid || roomDoc.roomId || canonicalRoomId).trim() : canonicalRoomId;
        if (roomDoc) {
            if (roomDoc.displayRoomId) channelManager.registerAlias(roomDoc.displayRoomId, effectiveCanonicalId);
            if (roomDoc.roomId) channelManager.registerAlias(roomDoc.roomId, effectiveCanonicalId);
            if (roomDoc.ownerUid) channelManager.registerAlias(roomDoc.ownerUid, effectiveCanonicalId);
        }
        if (displayRoomId) channelManager.registerAlias(displayRoomId, effectiveCanonicalId);

        const roomMeta = resolvedMeta || await roomRoleHelper.resolveRoomRolesMeta(effectiveCanonicalId, roomDoc);

        // 2. Hydrate Redis state if worker is freshly started
        await roomStateCache.hydrateFromRedisIfEmpty(effectiveCanonicalId);

        // 3. Register client socket immediately on canonical room channel
        channelManager.joinRoomChannel(effectiveCanonicalId, userId, ws, '', '', ws?._verifiedUid || '');

        // 4. Resolve authoritative user profile from MongoDB (never overwrite valid names with "User")
        const rawName = String(data.userName || data.name || '').trim();
        let userName = (rawName === 'null' || rawName === 'undefined') ? '' : rawName;
        const rawAvatar = String(data.userAvatar || data.avatarUrl || '').trim();
        let userAvatar = (rawAvatar === 'null' || rawAvatar === 'undefined') ? '' : rawAvatar;
        let userNumericId = String(data.numericId || '').trim();
        if (userNumericId === 'null' || userNumericId === 'undefined') userNumericId = '';
        let userLevel = data.level ? Number(data.level) : 1;
        let userGender = data.gender || 'Male';

        let canonicalUserId = userId;
        try {
            const parsedNum = Number(userId);
            const userOr = [{ uid: userId }];
            if (/^\d+$/.test(userId) && !Number.isNaN(parsedNum) && parsedNum > 0) {
                userOr.push({ numericId: parsedNum });
            }
            const userDoc = await User.findOne({ $or: userOr }).select('uid name avatarUrl numericId level gender').lean();
            if (userDoc && userDoc.uid) {
                canonicalUserId = String(userDoc.uid).trim();
                if (!userName || userName === 'User') userName = userDoc.name || 'User';
                if (!userAvatar) userAvatar = userDoc.avatarUrl || '';
                if (!userNumericId && userDoc.numericId) userNumericId = String(userDoc.numericId);
                if (userDoc.level) userLevel = userDoc.level;
                if (userDoc.gender) userGender = userDoc.gender;
            }
        } catch (_) {}

        if (roomDoc && (roomDoc.ownerUid === canonicalUserId || roomDoc.roomId === canonicalUserId || roomDoc.ownerUid === userId) && (!userName || userName === 'User')) {
            userName = roomDoc.ownerName || userName;
            if (!userAvatar) userAvatar = roomDoc.roomCover || roomDoc.roomPhotoUrl || '';
        }
        if (!userName || userName === 'null' || userName === 'undefined') userName = 'User';

        // Update socket metadata with resolved user name & custom ID
        channelManager.joinRoomChannel(effectiveCanonicalId, canonicalUserId, ws, userName, userNumericId, ws?._verifiedUid || '');

        // 5. Hydrate 16-seat stage state & check if user already occupies a seat
        const currentSeats = roomStateCache.hydrateSeats(effectiveCanonicalId, roomDoc?.seats, roomDoc?.lockedSeats, roomDoc?.speakerSlots);
        const existingSeatIndex = currentSeats.findIndex((s) => (
            s && s.userId && s.userId !== 'null' && (
                String(s.userId).trim() === canonicalUserId
                || String(s.userId).trim() === userId
                || (userNumericId && String(s.userCustomId || '').trim() === userNumericId)
            )
        ));
        const isOnSeat = existingSeatIndex >= 0;

        const normalizedUserRole = await roomRoleHelper.resolveUserRoleInRoom(canonicalUserId, roomMeta, userNumericId);
        const authoritativeRole = roomRoleHelper.toDisplayRole(normalizedUserRole, isOnSeat);

        // 6. Upsert participant into single-source-of-truth roomParticipants map
        await roomPresenceActivity.upsertParticipant(effectiveCanonicalId, {
            userId: canonicalUserId,
            name: userName,
            avatar: userAvatar,
            numericId: userNumericId,
            level: userLevel,
            gender: userGender,
            role: authoritativeRole,
            onSeat: isOnSeat,
            seatIndex: isOnSeat ? existingSeatIndex : -1
        }, roomMeta);

        // 7. Build authoritative snapshot and send directly to joining user (backward-compatible seats:batch + new atomic room:snapshot)
        const snapshot = roomStateCache.buildRoomSnapshot(effectiveCanonicalId, roomDoc, roomMeta);

        if (ws && ws.readyState === 1) {
            try {
                ws.send(JSON.stringify({
                    type: 'room:snapshot',
                    ...snapshot
                }));
            } catch (_) {}

            try {
                ws.send(JSON.stringify({
                    type: 'seats:batch',
                    roomId: effectiveCanonicalId,
                    ownerUid: roomMeta?.ownerUid || '',
                    coOwners: roomMeta?.coOwners || [],
                    admins: roomMeta?.admins || [],
                    speakerSlots: snapshot.speakerSlots,
                    lockedSeats: snapshot.lockedSeats,
                    seats: snapshot.seats
                }));
            } catch (_) {}
        }

        // 8. Broadcast updated presence & join notification to everyone inside room
        const { onlineCount, heatScore, targets } = await roomPresenceActivity.emitStateUpdate(
            effectiveCanonicalId,
            rawRoomId,
            channelManager.getMetadata(ws),
            roomMeta,
            roomDoc,
            triggerPopularBroadcast
        );

        const joinPacket = {
            type: 'user:join',
            roomId: effectiveCanonicalId,
            userId: canonicalUserId,
            userName,
            userAvatar,
            numericId: userNumericId,
            role: authoritativeRole,
            isJoining: true,
            onlineCount,
            participantCount: onlineCount,
            heatScore
        };
        channelManager.broadcastToRoomTargets(targets, joinPacket);
    },

    async handleLeaveRoom(data, ws, triggerPopularBroadcast = null) {
        const meta = (ws ? channelManager.getMetadata(ws) : null) || {};
        const targetRoom = String(data.roomId || data.canonicalRoomId || meta?.canonicalRoomId || meta?.roomId || '').trim();
        const userId = String(ws?._verifiedUid || meta?.verifiedUid || meta?.userId || (!ws ? data.userId : '') || '').trim();
        if (!userId) return;
        const userCustomId = String(data.userCustomId || meta?.userCustomId || '').trim();
        const userName = String(data.userName || meta?.userName || '').trim();

        if (!targetRoom && !meta?.roomId) return;

        const canonicalRoomId = await channelManager.getCanonicalIdAsync(targetRoom || meta.roomId) || targetRoom || meta.roomId;
        if (ws) {
            channelManager.leaveRoomChannel(canonicalRoomId, ws);
            if (targetRoom && targetRoom !== canonicalRoomId) {
                channelManager.leaveRoomChannel(targetRoom, ws);
            }
        }

        // Gather all possible IDs for leaving user
        const leavingIdentifiers = new Set();
        [userId, userCustomId, meta?.userId, meta?.verifiedUid, meta?.userCustomId].forEach((val) => {
            const clean = String(val || '').trim();
            if (clean && clean !== 'null' && clean !== 'undefined') leavingIdentifiers.add(clean);
        });

        let resolvedUserDoc = null;
        try {
            const queryConditions = [];
            if (userId && userId !== 'null') {
                queryConditions.push({ uid: userId });
                const parsed = parseInt(userId, 10);
                if (!Number.isNaN(parsed) && parsed > 0) queryConditions.push({ numericId: parsed });
            }
            if (userCustomId && userCustomId !== 'null') {
                const parsedCustom = parseInt(userCustomId, 10);
                if (!Number.isNaN(parsedCustom) && parsedCustom > 0) queryConditions.push({ numericId: parsedCustom });
            }
            if (queryConditions.length > 0) {
                resolvedUserDoc = await User.findOne({ $or: queryConditions }).select('uid numericId name').lean();
                if (resolvedUserDoc) {
                    if (resolvedUserDoc.uid) leavingIdentifiers.add(String(resolvedUserDoc.uid).trim());
                    if (resolvedUserDoc.numericId) leavingIdentifiers.add(String(resolvedUserDoc.numericId).trim());
                }
            }
        } catch (_) {}

        // Multi-socket guard: If user already reconnected on a NEW OPEN socket, do NOT remove them or vacate their seat!
        if (channelManager.hasOtherActiveSocketForUser(canonicalRoomId, leavingIdentifiers, ws)) {
            return;
        }

        const leavingName = (userName || resolvedUserDoc?.name || meta?.userName || '').trim().toLowerCase();
        const seats = roomStateCache.getOrCreateSeats(canonicalRoomId);
        const targets = getBroadcastTargets(canonicalRoomId, targetRoom, meta);

        seats.forEach((seat, idx) => {
            if (!seat) return;
            const seatUid = String(seat.userId || '').trim();
            const seatCustom = String(seat.userCustomId || '').trim();
            const seatName = String(seat.userName || '').trim().toLowerCase();

            const isOccupantLeaving = (seatUid && leavingIdentifiers.has(seatUid))
                || (seatCustom && leavingIdentifiers.has(seatCustom))
                || (leavingName && seatName && leavingName === seatName && leavingName !== 'user');

            if (isOccupantLeaving) {
                if (seat.seatedAt && seat.userId) {
                    const elapsedSec = Math.round((Date.now() - seat.seatedAt) / 1000);
                    if (elapsedSec > 5) {
                        try {
                            const DailyTaskService = require('../../../services/dailyTaskService');
                            DailyTaskService.recordMicTime(seat.userId, elapsedSec);
                        } catch (_) {}
                    }
                }
                seat.userId = null;
                seat.seatedAt = null;
                seat.userName = null;
                seat.userAvatar = null;
                seat.userCustomId = '';
                seat.isSpeaking = false;
                seat.isMuted = Boolean(seat.isMicTurnedOff);

                const updatePacket = roomStateCache.buildSeatUpdatePacket(canonicalRoomId, targetRoom, idx, seat);
                channelManager.broadcastToRoomTargets(targets, updatePacket);

                Room.updateOne(
                    { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }, { displayRoomId: targetRoom }] },
                    {
                        $set: {
                            [`seats.${idx}.userId`]: null,
                            [`seats.${idx}.name`]: null,
                            [`seats.${idx}.userName`]: null,
                            [`seats.${idx}.avatar`]: null,
                            [`seats.${idx}.userAvatar`]: null,
                            [`seats.${idx}.userCustomId`]: '',
                            [`seats.${idx}.isSpeaking`]: false,
                            [`seats.${idx}.isMuted`]: Boolean(seat.isMicTurnedOff),
                            updatedAt: new Date()
                        }
                    }
                ).catch(() => {});
            }
        });

        roomPresenceActivity.removeParticipantByIdentifiers(canonicalRoomId, leavingIdentifiers);

        const roomMeta = await roomRoleHelper.resolveRoomRolesMeta(canonicalRoomId).catch(() => null);
        const { onlineCount, heatScore } = await roomPresenceActivity.emitStateUpdate(
            canonicalRoomId,
            targetRoom,
            meta,
            roomMeta,
            null,
            triggerPopularBroadcast
        );

        const leavePacket = {
            type: 'user:leave',
            roomId: canonicalRoomId,
            userId: resolvedUserDoc?.uid || userId,
            isJoining: false,
            onlineCount,
            participantCount: onlineCount,
            heatScore
        };
        channelManager.broadcastToRoomTargets(targets, leavePacket);
    }
};

module.exports = roomLifecycleActivity;
