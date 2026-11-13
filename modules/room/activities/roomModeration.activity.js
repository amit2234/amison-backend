const Room = require('../../../models/Room');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const { AUTH_PROMISE_WAIT_MS, ERROR_CODES } = require('../room.constants');
const { channelManager, resolveTrueOwnerUid, getBroadcastTargets } = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');
const roomDiscoveryActivity = require('./roomDiscovery.activity');

/**
 * Room Moderation Activity
 * Isolated handlers for Kick, Ban Check, Unban, and Co-Owner/Admin Role Assignment.
 */
const roomModerationActivity = {
    async kickUser(roomId, targetUserId, durationHours = 3, hostName = 'Host', requesterUid = '') {
        const cleanRoomId = String(roomId || '').trim();
        const cleanTargetId = String(targetUserId || '').trim();
        if (!cleanRoomId || !cleanTargetId) throw new Error('Missing roomId or targetUserId');

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        });
        if (!room) throw new Error('Room not found');

        const roomMeta = roomRoleHelper.cacheRoomRoles(room);
        const targetIds = await roomRoleHelper.resolveUserIdentifiers(cleanTargetId);
        const targetRole = roomRoleHelper.resolveUserRoleFromMetaSync(targetIds, roomMeta);

        if (targetRole === 'owner') {
            const err = new Error('Room Owner cannot be kicked out!');
            err.statusCode = 403;
            throw err;
        }
        if (requesterUid && String(requesterUid).trim()) {
            const actorRole = await roomRoleHelper.resolveUserRoleInRoom(requesterUid, roomMeta);
            if (!roomRoleHelper.canModerate(actorRole, targetRole)) {
                const err = new Error('Insufficient permissions to kick this user.');
                err.statusCode = 403;
                throw err;
            }
        }

        const expiry = Date.now() + (Number(durationHours) || 3) * 3600 * 1000;
        room.kickouts = (room.kickouts || []).filter((k) => !targetIds.has(String(k.userId || '').trim()) && k.expiryTimestamp > Date.now());
        targetIds.forEach((tid) => {
            room.kickouts.push({
                userId: tid,
                kickedBy: hostName,
                expiryTimestamp: expiry
            });
        });

        if (room.seats && Array.isArray(room.seats)) {
            for (const s of room.seats) {
                if (s && s.userId && (targetIds.has(String(s.userId).trim()) || (s.userCustomId && targetIds.has(String(s.userCustomId).trim())))) {
                    s.userId = null;
                    s.name = null;
                    s.userName = null;
                    s.avatar = null;
                    s.userAvatar = null;
                    s.userCustomId = '';
                    s.isSpeaking = false;
                }
            }
        }
        await room.save();

        const canonicalId = room.ownerUid || room.roomId || room.displayRoomId || cleanRoomId;
        const seats = roomStateCache.getOrCreateSeats(canonicalId);
        const targets = getBroadcastTargets(canonicalId, cleanRoomId, null, room);

        seats.forEach((seat, idx) => {
            if (!seat || !seat.userId) return;
            const sUid = String(seat.userId || '').trim();
            const sCustom = String(seat.userCustomId || '').trim();
            if (targetIds.has(sUid) || (sCustom && targetIds.has(sCustom))) {
                seat.userId = null;
                seat.seatedAt = null;
                seat.userName = null;
                seat.userAvatar = null;
                seat.userCustomId = '';
                seat.isSpeaking = false;
                seat.isMuted = Boolean(seat.isMicTurnedOff);
                const packet = roomStateCache.buildSeatUpdatePacket(canonicalId, cleanRoomId, idx, seat, cleanTargetId);
                channelManager.broadcastToRoomTargets(targets, packet);
            }
        });

        const roomParticipants = roomStateCache.getParticipantsMap(canonicalId);
        targetIds.forEach((tid) => roomParticipants.delete(tid));
        for (const [pKey, pVal] of roomParticipants.entries()) {
            if (targetIds.has(String(pVal.userId || '').trim()) || (pVal.numericId && targetIds.has(String(pVal.numericId).trim()))) {
                roomParticipants.delete(pKey);
            }
        }

        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalId,
            ownerUid: roomMeta?.ownerUid || '',
            coOwners: roomMeta?.coOwners || [],
            admins: roomMeta?.admins || [],
            heatScore: roomStateCache.computeRoomHeat(roomParticipants, seats),
            onlineCount: roomParticipants.size,
            participants: Array.from(roomParticipants.values())
        };
        const kickedPacket = {
            type: 'room:kicked',
            roomId: canonicalId,
            targetUserId: cleanTargetId,
            kickedBy: hostName,
            expiryTimestamp: expiry
        };
        channelManager.broadcastToRoomTargets(targets, statePacket);
        channelManager.broadcastToRoomTargets(targets, kickedPacket);
        roomStateCache.persistStateToRedisAsync(canonicalId, roomMeta);

        return { success: true, expiryTimestamp: expiry };
    },

    async handleKickSocket(data, ws) {
        if (ws && ws._authPromise) {
            try {
                await Promise.race([
                    ws._authPromise.catch(() => ''),
                    new Promise((r) => setTimeout(r, AUTH_PROMISE_WAIT_MS))
                ]);
            } catch (_) {}
        }
        try {
            const kickPayload = (data && data.data && typeof data.data === 'object')
                ? { ...data, ...data.data }
                : data;
            const meta = channelManager.getMetadata(ws);
            const actorUid = ws?._verifiedUid || meta?.verifiedUid || meta?.userId || kickPayload.requesterUid || '';
            await this.kickUser(
                kickPayload.roomId,
                kickPayload.targetUserId || kickPayload.userId,
                kickPayload.durationHours || 3,
                kickPayload.hostName || 'Host',
                actorUid
            );
        } catch (kErr) {
            console.warn('[RoomModeration] Socket kick notice:', kErr.message);
            if (ws && ws.readyState === 1) {
                try {
                    ws.send(JSON.stringify({
                        type: 'seat:rejected',
                        seatIndex: -1,
                        reason: ERROR_CODES.FORBIDDEN,
                        message: kErr.message
                    }));
                } catch (_) {}
            }
        }
    },

    async isUserKicked(roomId, userId) {
        const cleanRoomId = String(roomId || '').trim();
        const cleanUserId = String(userId || '').trim();
        if (!cleanRoomId || !cleanUserId) return false;

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        }).lean();
        if (!room) {
            return { isKicked: false, expiryTimestamp: 0, remainingSeconds: 0, hostName: '' };
        }
        const now = Date.now();
        const activeKick = (room.kickouts || []).find((k) => k.userId === cleanUserId && k.expiryTimestamp > now);
        if (!activeKick) {
            return { isKicked: false, expiryTimestamp: 0, remainingSeconds: 0, hostName: '' };
        }
        const remainingSeconds = Math.max(0, Math.round((activeKick.expiryTimestamp - now) / 1000));
        return {
            isKicked: true,
            expiryTimestamp: activeKick.expiryTimestamp,
            remainingSeconds,
            hostName: activeKick.kickedBy || 'Host'
        };
    },

    async unbanUser(roomId, userId) {
        const cleanRoomId = String(roomId || '').trim();
        const cleanUserId = String(userId || '').trim();
        if (!cleanRoomId || !cleanUserId) return { success: false };

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        });
        if (!room) return { success: false };
        room.kickouts = (room.kickouts || []).filter((k) => k.userId !== cleanUserId);
        await room.save();
        return { success: true };
    },

    async updateMemberRole(roomId, targetUserId, newRole, requesterUid = '') {
        const cleanRoomId = String(roomId || '').trim();
        const cleanTargetId = String(targetUserId || '').trim();
        const roleRaw = String(newRole || '').trim().toLowerCase();
        if (!cleanRoomId || !cleanTargetId) throw new Error('Missing parameters');

        const resolvedUid = await resolveTrueOwnerUid(cleanRoomId);
        const room = await Room.findOne({
            $or: [
                { displayRoomId: cleanRoomId },
                { ownerUid: resolvedUid },
                { roomId: resolvedUid },
                { roomId: cleanRoomId }
            ]
        });
        if (!room) throw new Error('Room not found');

        const roomMeta = roomRoleHelper.cacheRoomRoles(room);
        const targetIds = await roomRoleHelper.resolveUserIdentifiers(cleanTargetId);
        const targetCurrentRole = roomRoleHelper.resolveUserRoleFromMetaSync(targetIds, roomMeta);
        const desiredNormalized = roomRoleHelper.normalizeRoleName(roleRaw);

        if (requesterUid && String(requesterUid).trim()) {
            const actorRole = await roomRoleHelper.resolveUserRoleInRoom(requesterUid, roomMeta);
            if (!roomRoleHelper.canAssignRole(actorRole, desiredNormalized, targetCurrentRole)) {
                const err = new Error('Forbidden: You do not have authority to assign this role.');
                err.statusCode = 403;
                throw err;
            }
        } else if (targetCurrentRole === 'owner' || desiredNormalized === 'owner') {
            const err = new Error('Forbidden: Room Owner role cannot be reassigned.');
            err.statusCode = 403;
            throw err;
        }

        const canonicalTargetUid = await resolveTrueOwnerUid(cleanTargetId);
        room.coOwners = (room.coOwners || []).filter((u) => !targetIds.has(String(u || '').trim()));
        room.admins = (room.admins || []).filter((u) => !targetIds.has(String(u || '').trim()));

        if (desiredNormalized === 'co_owner') {
            room.coOwners.push(canonicalTargetUid || cleanTargetId);
        } else if (desiredNormalized === 'admin') {
            room.admins.push(canonicalTargetUid || cleanTargetId);
        }

        await room.save();
        const updatedMeta = roomRoleHelper.cacheRoomRoles(room);
        const canonicalId = room.ownerUid || room.roomId || room.displayRoomId || cleanRoomId;
        const displayRole = roomRoleHelper.toDisplayRole(desiredNormalized, false);

        const roomParticipants = roomStateCache.getParticipantsMap(canonicalId);
        for (const [pKey, pVal] of roomParticipants.entries()) {
            const pMatch = targetIds.has(String(pVal.userId || '').trim())
                || (pVal.numericId && targetIds.has(String(pVal.numericId).trim()));
            if (pMatch) {
                pVal.role = roomRoleHelper.toDisplayRole(desiredNormalized, Boolean(pVal.onSeat));
                roomParticipants.set(pKey, pVal);
            }
        }

        const seats = roomStateCache.getOrCreateSeats(canonicalId);
        const targets = getBroadcastTargets(canonicalId, cleanRoomId, null, room);
        const rolePacket = {
            type: 'room:role_update',
            roomId: canonicalId,
            targetUserId: canonicalTargetUid || cleanTargetId,
            newRole: displayRole,
            ownerUid: updatedMeta?.ownerUid || '',
            coOwners: updatedMeta?.coOwners || [],
            admins: updatedMeta?.admins || []
        };
        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalId,
            ownerUid: updatedMeta?.ownerUid || '',
            coOwners: updatedMeta?.coOwners || [],
            admins: updatedMeta?.admins || [],
            heatScore: roomStateCache.computeRoomHeat(roomParticipants, seats),
            onlineCount: roomParticipants.size,
            participants: Array.from(roomParticipants.values())
        };
        channelManager.broadcastToRoomTargets(targets, rolePacket);
        channelManager.broadcastToRoomTargets(targets, statePacket);
        roomStateCache.persistStateToRedisAsync(canonicalId, updatedMeta);
        roomDiscoveryActivity.invalidateCache();

        return { success: true, role: displayRole, coOwners: room.coOwners, admins: room.admins };
    }
};

module.exports = roomModerationActivity;
