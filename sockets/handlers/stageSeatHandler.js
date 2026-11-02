const Room = require('../../models/Room');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles 16-Mic Stage Seating, Mute/Unmute, and Lock/Unlock Events
 */
const stageSeatHandler = {
    async handleSeatUpdate(data, ws, wss, broadcastPopularRooms) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.roomId || '').trim();
        const targetUserId = String(data.userId || meta?.userId || '').trim();
        const onSeat = data.onSeat !== undefined ? Boolean(data.onSeat) : (targetUserId.length > 0);
        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        const isLocked = data.isLocked !== undefined ? Boolean(data.isLocked) : null;
        const isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : null;

        if (roomId && seatIndex >= 0 && seatIndex < 16) {
            const seats = cacheService.getOrCreateRoomSeats(roomId);
            const seat = seats[seatIndex];
            if (isLocked !== null) seat.isLocked = isLocked;
            if (isMuted !== null) seat.isMuted = isMuted;

            if (onSeat && targetUserId) {
                seat.userId = targetUserId;
                seat.userName = data.userName || seat.userName || 'User';
                seat.userAvatar = data.userAvatar || seat.userAvatar || '';
            } else if (!onSeat && targetUserId) {
                if (seat.userId === targetUserId) {
                    seat.userId = null;
                    seat.userName = null;
                    seat.userAvatar = null;
                }
            }

            // O(1) Targeted Seat update broadcast to room viewers
            roomChannelManager.broadcastToRoom(roomId, {
                type: 'seat:update',
                roomId,
                seatIndex,
                userId: seat.userId || '',
                userName: seat.userName || '',
                userAvatar: seat.userAvatar || '',
                isLocked: seat.isLocked,
                isMuted: seat.isMuted
            });

            // Async MongoDB persistence
            Room.updateOne(
                { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }] },
                { $set: { [`seats.${seatIndex}`]: seat, updatedAt: new Date() } }
            ).catch(err => console.error('[StageSeatHandler] Mongo seat update error:', err.message));
        }

        if (roomId && targetUserId) {
            const roomParticipants = cacheService.getRoomParticipants(roomId);
            const user = roomParticipants.get(targetUserId);
            if (user) {
                user.onSeat = onSeat;
                user.seatIndex = seatIndex;
                roomParticipants.set(targetUserId, user);
            }
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
    },

    async handleSeatToggleLock(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.roomId || '').trim();
        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        const isLocked = Boolean(data.isLocked);

        if (roomId && seatIndex >= 0 && seatIndex < 16) {
            const seats = cacheService.getOrCreateRoomSeats(roomId);
            const seat = seats[seatIndex];
            seat.isLocked = isLocked;
            let kickedUserId = null;

            if (isLocked && seat.userId) {
                kickedUserId = seat.userId;
                seat.userId = null;
                seat.userName = null;
                seat.userAvatar = null;
            }

            roomChannelManager.broadcastToRoom(roomId, {
                type: 'seat:update',
                roomId,
                seatIndex,
                userId: seat.userId || '',
                userName: seat.userName || '',
                userAvatar: seat.userAvatar || '',
                isLocked: seat.isLocked,
                isMuted: seat.isMuted,
                kickedUserId
            });

            Room.updateOne(
                { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }] },
                { $set: { [`seats.${seatIndex}`]: seat, updatedAt: new Date() } }
            ).catch(err => console.error('[StageSeatHandler] Mongo seat lock update error:', err.message));
        }
    }
};

module.exports = stageSeatHandler;