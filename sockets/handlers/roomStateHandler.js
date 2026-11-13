const Room = require('../../models/Room');
const User = require('../../models/User');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles Room State Events (Join Room, Leave Room, Heat Score Calculations)
 * Zero-Delay Real-time Sync Engine
 */
const roomStateHandler = {
    async handleJoinRoom(data, ws, wss, broadcastPopularRooms) {
        const roomId = String(data.roomId || '').trim();
        const userId = String(data.userId || '').trim();
        const displayRoomId = String(data.displayRoomId || '').trim();

        if (!roomId || !userId || userId === 'null' || userId === 'undefined') return;

        // 1. Resolve room document to link displayRoomId and ownerUid to the SAME WebSocket channel
        let roomDoc = null;
        try {
            const queryConditions = [{ displayRoomId: roomId }, { ownerUid: roomId }, { roomId }];
            if (displayRoomId) queryConditions.push({ displayRoomId });
            roomDoc = await Room.findOne({ $or: queryConditions }).lean();
            if (roomDoc) {
                if (roomDoc.displayRoomId && roomDoc.ownerUid) {
                    if (typeof roomChannelManager.registerAlias === 'function') {
                        roomChannelManager.registerAlias(roomDoc.displayRoomId, roomDoc.ownerUid);
                        roomChannelManager.registerAlias(roomDoc.roomId, roomDoc.ownerUid);
                    }
                }
            }
        } catch (_) {}

        const canonicalRoomId = roomDoc ? (roomDoc.ownerUid || roomDoc.displayRoomId || roomId) : roomId;
        if (displayRoomId && canonicalRoomId && typeof roomChannelManager.registerAlias === 'function') {
            roomChannelManager.registerAlias(displayRoomId, canonicalRoomId);
        }

        // Register client socket to canonical channel
        roomChannelManager.joinRoomChannel(canonicalRoomId, userId, ws);

        // 2. Resolve real User Profile from MongoDB to prevent "User" or "null" fake placeholders
        let rawName = String(data.userName || data.name || '').trim();
        let userName = (rawName === 'null' || rawName === 'undefined') ? '' : rawName;
        let rawAvatar = String(data.userAvatar || data.avatarUrl || '').trim();
        let userAvatar = (rawAvatar === 'null' || rawAvatar === 'undefined') ? '' : rawAvatar;
        let userNumericId = String(data.numericId || '').trim();
        if (userNumericId === 'null' || userNumericId === 'undefined') userNumericId = '';
        let userLevel = data.level ? Number(data.level) : 1;
        let userGender = data.gender || 'Male';

        let canonicalUserId = userId;
        try {
            const userDoc = await User.findOne({ $or: [{ uid: userId }, { numericId: parseInt(userId) || 0 }] }).lean();
            if (userDoc && userDoc.uid) {
                canonicalUserId = userDoc.uid;
                if (!userName || userName === 'User') userName = userDoc.name || 'User';
                if (!userAvatar) userAvatar = userDoc.avatarUrl || '';
                if (!userNumericId) userNumericId = String(userDoc.numericId || '');
                if (userDoc.level) userLevel = userDoc.level;
                if (userDoc.gender) userGender = userDoc.gender;
            }
        } catch (_) {}

        if (roomDoc && (roomDoc.ownerUid === canonicalUserId || roomDoc.roomId === canonicalUserId || roomDoc.ownerUid === userId) && (!userName || userName === 'User')) {
            userName = roomDoc.ownerName || userName;
            if (!userAvatar) userAvatar = roomDoc.roomCover || '';
        }

        if (!userName || userName === 'null' || userName === 'undefined') userName = 'User';

        // Register client socket to canonical channel with full user metadata
        roomChannelManager.joinRoomChannel(canonicalRoomId, canonicalUserId, ws, userName, userNumericId);

        const currentSeats = cacheService.getOrCreateRoomSeats(canonicalRoomId);
        const existingSeatIndex = currentSeats.findIndex(s => s && s.userId && s.userId !== 'null' && (String(s.userId).trim() === canonicalUserId || String(s.userId).trim() === userId));
        const isOnSeat = existingSeatIndex >= 0;

        const roomParticipants = cacheService.getRoomParticipants(canonicalRoomId);
        if (canonicalUserId && canonicalUserId !== 'null' && canonicalUserId !== 'undefined') {
            roomParticipants.set(canonicalUserId, {
                userId: canonicalUserId,
                name: userName,
                avatar: userAvatar,
                numericId: userNumericId,
                level: userLevel,
                gender: userGender,
                onSeat: isOnSeat,
                seatIndex: isOnSeat ? existingSeatIndex : -1
            });
        }

        const onlineCount = roomParticipants.size;
        const stageMics = currentSeats.filter(s => s && s.userId).length;
        const heatScore = (onlineCount * 10) + (stageMics * 25);
        const isLive = onlineCount > 0 && heatScore >= 10;

        // 3. Update MongoDB: Set isLive, heatScore, and onlineCount
        Room.updateOne(
            { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }, { displayRoomId: roomId }, { ownerUid: roomId }] },
            { $set: { isLive, heatScore, onlineCount, updatedAt: new Date() } }
        ).catch(err => console.error('[RoomStateHandler] Mongo join update error:', err.message));

        // 4. Send full 16-seat stage snapshot to joining user
        ws.send(JSON.stringify({
            type: 'seats:batch',
            roomId: canonicalRoomId,
            seats: currentSeats
        }));

        // 5. Broadcast updated room state ONLY to users in this room (O(1) Speed)
        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalRoomId,
            displayRoomId: roomDoc ? roomDoc.displayRoomId : roomId,
            heatScore,
            onlineCount,
            participants: Array.from(roomParticipants.values())
        };
        const joinPacket = {
            type: 'user:join',
            roomId: canonicalRoomId,
            userId: canonicalUserId,
            userName,
            userAvatar,
            role: isOnSeat ? 'Speaker' : 'Audience',
            isJoining: true,
            onlineCount,
            participantCount: onlineCount,
            heatScore
        };
        roomChannelManager.broadcastToRoom(canonicalRoomId, statePacket);
        roomChannelManager.broadcastToRoom(canonicalRoomId, joinPacket);
        if (canonicalRoomId !== roomId) {
            roomChannelManager.broadcastToRoom(roomId, statePacket);
            roomChannelManager.broadcastToRoom(roomId, joinPacket);
        }

        // 6. Broadcast updated popular rooms list to all clients on Chatroom tab
        if (typeof broadcastPopularRooms === 'function') {
            await broadcastPopularRooms(wss);
        }
    },

    async handleLeaveRoom(data, ws, wss, broadcastPopularRooms) {
        const meta = (ws && typeof roomChannelManager.getMetadata === 'function' ? roomChannelManager.getMetadata(ws) : null) || {};
        const roomId = String(data.roomId || data.canonicalRoomId || meta?.canonicalRoomId || meta?.roomId || '').trim();
        const userId = String(data.userId || meta?.userId || '').trim();
        const userCustomId = String(data.userCustomId || meta?.userCustomId || '').trim();
        const userName = String(data.userName || meta?.userName || '').trim();

        if (!roomId && !meta?.roomId) return;
        const targetRoom = roomId || meta?.roomId;

        const canonicalRoomId = roomChannelManager.getCanonicalId(targetRoom) || targetRoom;
        if (ws) {
            roomChannelManager.leaveRoomChannel(canonicalRoomId, ws);
            if (targetRoom !== canonicalRoomId) {
                roomChannelManager.leaveRoomChannel(targetRoom, ws);
            }
        }

        // Collect all possible identifiers for this leaving user (Auth UID, numericId, display ID, etc.)
        const leavingIdentifiers = new Set();
        if (userId && userId !== 'null' && userId !== 'undefined') {
            leavingIdentifiers.add(userId);
        }
        if (userCustomId && userCustomId !== 'null' && userCustomId !== 'undefined') {
            leavingIdentifiers.add(userCustomId);
        }
        if (meta?.userId && meta.userId !== 'null') {
            leavingIdentifiers.add(meta.userId);
        }
        if (meta?.userCustomId && meta.userCustomId !== 'null') {
            leavingIdentifiers.add(meta.userCustomId);
        }

        let resolvedUserDoc = null;
        try {
            const queryConditions = [];
            if (userId && userId !== 'null') {
                queryConditions.push({ uid: userId });
                const parsed = parseInt(userId);
                if (!isNaN(parsed) && parsed > 0) queryConditions.push({ numericId: parsed });
            }
            if (userCustomId && userCustomId !== 'null') {
                const parsedCustom = parseInt(userCustomId);
                if (!isNaN(parsedCustom) && parsedCustom > 0) queryConditions.push({ numericId: parsedCustom });
            }
            if (queryConditions.length > 0) {
                resolvedUserDoc = await User.findOne({ $or: queryConditions }).lean();
                if (resolvedUserDoc) {
                    if (resolvedUserDoc.uid) leavingIdentifiers.add(String(resolvedUserDoc.uid).trim());
                    if (resolvedUserDoc.numericId) leavingIdentifiers.add(String(resolvedUserDoc.numericId).trim());
                }
            }
        } catch (_) {}

        const leavingName = (userName || resolvedUserDoc?.name || meta?.userName || '').trim().toLowerCase();

        // Automatically clear any seat occupied by the leaving/disconnecting user across ALL alias IDs
        const seats = cacheService.getOrCreateRoomSeats(canonicalRoomId);
        seats.forEach((seat, idx) => {
            if (!seat) return;
            const seatUid = String(seat.userId || '').trim();
            const seatCustom = String(seat.userCustomId || '').trim();
            const seatName = String(seat.userName || '').trim().toLowerCase();

            const isOccupantLeaving = (seatUid && leavingIdentifiers.has(seatUid)) ||
                                      (seatCustom && leavingIdentifiers.has(seatCustom)) ||
                                      (leavingName && seatName && leavingName === seatName && leavingName !== 'user');

            if (isOccupantLeaving) {
                if (seat.seatedAt && seat.userId) {
                    const elapsedSec = Math.round((Date.now() - seat.seatedAt) / 1000);
                    if (elapsedSec > 5) {
                        try {
                            const DailyTaskService = require('../../services/dailyTaskService');
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
                const updatePacket = {
                    type: 'seat:update',
                    roomId: canonicalRoomId,
                    seatIndex: idx,
                    userId: '',
                    userName: '',
                    userAvatar: '',
                    userCustomId: '',
                    isSpeaking: false,
                    isLocked: Boolean(seat.isLocked),
                    isMuted: Boolean(seat.isMuted)
                };
                roomChannelManager.broadcastToRoom(canonicalRoomId, updatePacket);
                if (canonicalRoomId !== targetRoom) {
                    roomChannelManager.broadcastToRoom(targetRoom, updatePacket);
                }
                Room.updateOne(
                    { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }, { displayRoomId: targetRoom }] },
                    { $set: { [`seats.${idx}`]: seat, updatedAt: new Date() } }
                ).catch(() => {});
            }
        });

        const roomParticipants = cacheService.getRoomParticipants(canonicalRoomId);
        leavingIdentifiers.forEach(id => roomParticipants.delete(id));
        if (userId) roomParticipants.delete(userId);
        if (resolvedUserDoc && resolvedUserDoc.uid) roomParticipants.delete(resolvedUserDoc.uid);

        const onlineCount = roomParticipants.size;
        const remainingSeats = cacheService.getOrCreateRoomSeats(canonicalRoomId);
        const stageMics = remainingSeats.filter(s => s && s.userId).length;
        const heatScore = onlineCount > 0 ? ((onlineCount * 10) + (stageMics * 25)) : 0;
        const isLive = onlineCount > 0 && heatScore >= 10;

        Room.updateOne(
            { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }, { displayRoomId: targetRoom }] },
            { $set: { isLive, heatScore, onlineCount, updatedAt: new Date() } }
        ).catch(() => {});

        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalRoomId,
            heatScore,
            onlineCount,
            participants: Array.from(roomParticipants.values())
        };
        const leavePacket = {
            type: 'user:leave',
            roomId: canonicalRoomId,
            userId,
            isJoining: false,
            onlineCount,
            participantCount: onlineCount,
            heatScore
        };
        roomChannelManager.broadcastToRoom(canonicalRoomId, statePacket);
        roomChannelManager.broadcastToRoom(canonicalRoomId, leavePacket);
        if (canonicalRoomId !== targetRoom) {
            roomChannelManager.broadcastToRoom(targetRoom, statePacket);
            roomChannelManager.broadcastToRoom(targetRoom, leavePacket);
        }

        if (typeof broadcastPopularRooms === 'function') {
            await broadcastPopularRooms(wss);
        }
    }
};

module.exports = roomStateHandler;
