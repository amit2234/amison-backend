const Room = require('../../../models/Room');
const roomRoleHelper = require('../../../services/roomRoleHelper');
const { channelManager, getBroadcastTargets } = require('../room.channel.manager');
const roomStateCache = require('../room.state.cache');

/**
 * Room Presence Activity
 * Single Source of Truth for Active Member List, User IDs, Online Count, and Room Heat.
 */
const roomPresenceActivity = {
    async upsertParticipant(canonicalRoomId, userData, roomMeta = null) {
        const roomParticipants = roomStateCache.getParticipantsMap(canonicalRoomId);
        const uid = String(userData.userId || '').trim();
        if (!uid || uid === 'null' || uid === 'undefined') return null;

        // Deduplicate: remove any stale entry holding the same numericId under a different raw key
        if (userData.numericId) {
            const cleanNum = String(userData.numericId).trim();
            for (const [existingKey, existingVal] of roomParticipants.entries()) {
                if (existingKey !== uid && existingVal && String(existingVal.numericId || '').trim() === cleanNum) {
                    roomParticipants.delete(existingKey);
                }
            }
        }

        const entry = {
            userId: uid,
            name: userData.name || 'User',
            avatar: userData.avatar || '',
            numericId: userData.numericId || '',
            level: Number(userData.level) || 1,
            gender: userData.gender || 'Male',
            role: userData.role || 'Audience',
            onSeat: Boolean(userData.onSeat),
            seatIndex: userData.onSeat ? Number(userData.seatIndex) : -1
        };

        roomParticipants.set(uid, entry);

        // Refresh role labels for all participants consistently against latest roomMeta
        if (roomMeta) {
            for (const [pKey, pVal] of roomParticipants.entries()) {
                const pIds = await roomRoleHelper.resolveUserIdentifiers(pVal.userId || pKey, pVal.numericId || '');
                const pNorm = roomRoleHelper.resolveUserRoleFromMetaSync(pIds, roomMeta);
                pVal.role = roomRoleHelper.toDisplayRole(pNorm, Boolean(pVal.onSeat));
            }
        }

        return entry;
    },

    removeParticipantByIdentifiers(canonicalRoomId, identifierSet) {
        const roomParticipants = roomStateCache.getParticipantsMap(canonicalRoomId);
        if (!identifierSet || identifierSet.size === 0) return;

        identifierSet.forEach((id) => roomParticipants.delete(id));
        for (const [pKey, pVal] of roomParticipants.entries()) {
            const pUid = String(pVal?.userId || '').trim();
            const pNum = String(pVal?.numericId || '').trim();
            if (identifierSet.has(pKey) || (pUid && identifierSet.has(pUid)) || (pNum && identifierSet.has(pNum))) {
                roomParticipants.delete(pKey);
            }
        }
    },

    getPresenceMetrics(canonicalRoomId) {
        const roomParticipants = roomStateCache.getParticipantsMap(canonicalRoomId);
        const seats = roomStateCache.getOrCreateSeats(canonicalRoomId);
        const onlineCount = roomParticipants.size;
        const heatScore = roomStateCache.computeRoomHeat(roomParticipants, seats);
        const isLive = onlineCount > 0 && heatScore >= 10;
        const participants = Array.from(roomParticipants.values());
        return { onlineCount, heatScore, isLive, participants, seats };
    },

    async emitStateUpdate(canonicalRoomId, rawRoomId, meta, roomMeta, roomDoc = null, triggerPopularBroadcast = null) {
        const { onlineCount, heatScore, isLive, participants } = this.getPresenceMetrics(canonicalRoomId);

        Room.updateOne(
            {
                $or: [
                    { roomId: canonicalRoomId },
                    { ownerUid: canonicalRoomId },
                    { displayRoomId: canonicalRoomId },
                    ...(rawRoomId ? [{ displayRoomId: rawRoomId }, { ownerUid: rawRoomId }] : [])
                ]
            },
            { $set: { isLive, heatScore, onlineCount, updatedAt: new Date() } }
        ).catch((err) => console.warn('[RoomPresence] Mongo state sync notice:', err.message));

        roomStateCache.persistStateToRedisAsync(canonicalRoomId, roomMeta);

        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalRoomId,
            displayRoomId: roomDoc?.displayRoomId || roomMeta?.displayRoomId || rawRoomId || canonicalRoomId,
            ownerUid: roomMeta?.ownerUid || roomDoc?.ownerUid || '',
            coOwners: roomMeta?.coOwners || roomDoc?.coOwners || [],
            admins: roomMeta?.admins || roomDoc?.admins || [],
            heatScore,
            onlineCount,
            participants
        };

        const targets = getBroadcastTargets(canonicalRoomId, rawRoomId, meta, roomDoc);
        channelManager.broadcastToRoomTargets(targets, statePacket);

        if (typeof triggerPopularBroadcast === 'function') {
            triggerPopularBroadcast();
        }

        return { onlineCount, heatScore, isLive, participants, targets };
    }
};

module.exports = roomPresenceActivity;
