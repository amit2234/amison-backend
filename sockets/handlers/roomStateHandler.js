const Room = require('../../models/Room');
const User = require('../../models/User');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles Room State Events (Join Room, Leave Room, Heat Score Calculations)
 */
const roomStateHandler = {
    async handleJoinRoom(data, ws, wss, broadcastPopularRooms) {
        const roomId = String(data.roomId || '').trim();
        const userId = String(data.userId || '').trim();

        if (!roomId || !userId) return;

        // 1. Resolve room document to link displayRoomId and ownerUid to the SAME WebSocket channel
        let roomDoc = null;
        try {
            roomDoc = await Room.findOne({ $or: [{ displayRoomId: roomId }, { ownerUid: roomId }, { roomId }] }).lean();
            if (roomDoc) {
                if (roomDoc.displayRoomId && roomDoc.ownerUid) {
                    roomChannelManager.registerAlias(roomDoc.displayRoomId, roomDoc.ownerUid);
                }
            }
        } catch (_) {}

        const canonicalRoomId = roomDoc ? (roomDoc.ownerUid || roomDoc.displayRoomId || roomId) : roomId;

        // Register client socket to canonical channel
        roomChannelManager.joinRoomChannel(canonicalRoomId, userId, ws);

        // 2. Resolve real User Profile from MongoDB to prevent "User" fake placeholders
        let userName = data.userName || data.name || '';
        let userAvatar = data.userAvatar || data.avatarUrl || '';
        let userNumericId = data.numericId || '';
        let userLevel = data.level ? Number(data.level) : 1;
        let userGender = data.gender || 'Male';

        try {
            const userDoc = await User.findOne({ $or: [{ uid: userId }, { numericId: parseInt(userId) || 0 }] }).lean();
            if (userDoc) {
                if (!userName || userName === 'User') userName = userDoc.name || 'User';
                if (!userAvatar) userAvatar = userDoc.avatarUrl || '';
                if (!userNumericId) userNumericId = String(userDoc.numericId || '');
                if (userDoc.level) userLevel = userDoc.level;
                if (userDoc.gender) userGender = userDoc.gender;
            }
        } catch (_) {}

        if (roomDoc && (roomDoc.ownerUid === userId || roomDoc.roomId === userId) && (!userName || userName === 'User')) {
            userName = roomDoc.ownerName || userName;
            if (!userAvatar) userAvatar = roomDoc.roomCover || '';
        }

        if (!userName) userName = 'User';

        const currentSeats = cacheService.getOrCreateRoomSeats(canonicalRoomId);
        const existingSeatIndex = currentSeats.findIndex(s => s && String(s.userId || '').trim() === userId);
        const isOnSeat = existingSeatIndex >= 0;

        const roomParticipants = cacheService.getRoomParticipants(canonicalRoomId);
        roomParticipants.set(userId, {
            userId,
            name: userName,
            avatar: userAvatar,
            numericId: userNumericId,
            level: userLevel,
            gender: userGender,
            onSeat: isOnSeat,
            seatIndex: isOnSeat ? existingSeatIndex : -1
        });

        const onlineCount = roomParticipants.size;
        const heatScore = Math.max(10, onlineCount * 10);

        // 3. Update MongoDB: Set isLive: true, heatScore, and onlineCount
        Room.updateOne(
            { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }, { displayRoomId: roomId }, { ownerUid: roomId }] },
            { $set: { isLive: true, heatScore, onlineCount, updatedAt: new Date() } }
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
        roomChannelManager.broadcastToRoom(canonicalRoomId, statePacket);
        if (canonicalRoomId !== roomId) {
            roomChannelManager.broadcastToRoom(roomId, statePacket);
        }

        // 6. Broadcast updated popular rooms list to all clients on Chatroom tab
        if (typeof broadcastPopularRooms === 'function') {
            await broadcastPopularRooms(wss);
        }
    },

    async handleLeaveRoom(data, ws, wss, broadcastPopularRooms) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.canonicalRoomId || meta?.roomId || '').trim();
        const userId = String(data.userId || meta?.userId || '').trim();

        if (!roomId || !userId) return;

        const canonicalRoomId = roomChannelManager.getCanonicalId(roomId) || roomId;
        roomChannelManager.leaveRoomChannel(canonicalRoomId, ws);

        // Automatically clear any seat occupied by the leaving/disconnecting user
        const seats = cacheService.getOrCreateRoomSeats(canonicalRoomId);
        seats.forEach((seat, idx) => {
            if (seat.userId === userId) {
                seat.userId = null;
                seat.userName = null;
                seat.userAvatar = null;
                const updatePacket = {
                    type: 'seat:update',
                    roomId: canonicalRoomId,
                    seatIndex: idx,
                    userId: '',
                    userName: '',
                    userAvatar: '',
                    isLocked: seat.isLocked,
                    isMuted: seat.isMuted
                };
                roomChannelManager.broadcastToRoom(canonicalRoomId, updatePacket);
                if (canonicalRoomId !== roomId) {
                    roomChannelManager.broadcastToRoom(roomId, updatePacket);
                }
                Room.updateOne(
                    { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }] },
                    { $set: { [`seats.${idx}`]: seat, updatedAt: new Date() } }
                ).catch(() => {});
            }
        });

        const roomParticipants = cacheService.getRoomParticipants(canonicalRoomId);
        roomParticipants.delete(userId);

        const onlineCount = roomParticipants.size;
        const heatScore = onlineCount > 0 ? Math.max(10, onlineCount * 10) : 0;
        const isLive = onlineCount > 0;

        Room.updateOne(
            { $or: [{ roomId: canonicalRoomId }, { ownerUid: canonicalRoomId }, { displayRoomId: canonicalRoomId }] },
            { $set: { isLive, heatScore, onlineCount, updatedAt: new Date() } }
        ).catch(() => {});

        const statePacket = {
            type: 'room:state_update',
            roomId: canonicalRoomId,
            heatScore,
            onlineCount,
            participants: Array.from(roomParticipants.values())
        };
        roomChannelManager.broadcastToRoom(canonicalRoomId, statePacket);
        if (canonicalRoomId !== roomId) {
            roomChannelManager.broadcastToRoom(roomId, statePacket);
        }

        if (typeof broadcastPopularRooms === 'function') {
            await broadcastPopularRooms(wss);
        }
    }
};

module.exports = roomStateHandler;
