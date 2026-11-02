const Room = require('../../models/Room');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles Room State Events (Join Room, Leave Room, Heat Score Calculations)
 */
const roomStateHandler = {
    async handleJoinRoom(data, ws, wss, broadcastPopularRooms) {
        const roomId = String(data.roomId || '').trim();
        const userId = String(data.userId || '').trim();
        const userName = data.userName || 'User';
        const userAvatar = data.userAvatar || data.avatarUrl || '';
        const isOwner = Boolean(data.isOwner || data.role === 'Owner');

        if (!roomId || !userId) return;

        // Register client to room channel for O(1) targeted broadcasts
        roomChannelManager.joinRoomChannel(roomId, userId, ws);

        const roomParticipants = cacheService.getRoomParticipants(roomId);
        roomParticipants.set(userId, {
            userId,
            name: userName,
            avatar: userAvatar,
            onSeat: isOwner,
            seatIndex: isOwner ? 0 : -1
        });

        const heatScore = cacheService.calculateRoomHeat(roomParticipants);
        const onlineCount = roomParticipants.size;

        // Background async MongoDB update
        Room.updateOne(
            { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }] },
            { $set: { heatScore, onlineCount, updatedAt: new Date() } }
        ).catch(err => console.error('[RoomStateHandler] Mongo join update error:', err.message));

        // 1. Send full 16-seat stage snapshot to joining user
        const currentSeats = cacheService.getOrCreateRoomSeats(roomId);
        ws.send(JSON.stringify({
            type: 'seats:batch',
            roomId,
            seats: currentSeats
        }));

        // 2. Broadcast updated room state ONLY to users in this room (O(1) Speed)
        roomChannelManager.broadcastToRoom(roomId, {
            type: 'room:state_update',
            roomId,
            heatScore,
            onlineCount,
            participants: Array.from(roomParticipants.values())
        });

        if (typeof broadcastPopularRooms === 'function') {
            await broadcastPopularRooms(wss);
        }
    },

    async handleLeaveRoom(data, ws, wss, broadcastPopularRooms) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.roomId || '').trim();
        const userId = String(data.userId || meta?.userId || '').trim();

        if (!roomId || !userId) return;

        roomChannelManager.leaveRoomChannel(roomId, ws);

        const roomParticipants = cacheService.getRoomParticipants(roomId);
        roomParticipants.delete(userId);

        const heatScore = cacheService.calculateRoomHeat(roomParticipants);
        const onlineCount = roomParticipants.size;

        Room.updateOne(
            { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }] },
            { $set: { heatScore, onlineCount, updatedAt: new Date() } }
        ).catch(() => {});

        roomChannelManager.broadcastToRoom(roomId, {
            type: 'room:state_update',
            roomId,
            heatScore,
            onlineCount,
            participants: Array.from(roomParticipants.values())
        });

        if (typeof broadcastPopularRooms === 'function') {
            await broadcastPopularRooms(wss);
        }
    }
};

module.exports = roomStateHandler;