const Room = require('../../models/Room');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles 16-Mic Stage Seating, Mute/Unmute, and Lock/Unlock Events
 */
const stageSeatHandler = {
    async handleSeatUpdate(data, ws, wss, broadcastPopularRooms) {
        const meta = roomChannelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        let roomId = meta?.canonicalRoomId || roomChannelManager.getCanonicalId(rawRoomId) || rawRoomId;

        if (!roomId || roomId === rawRoomId) {
            try {
                const roomDoc = await Room.findOne({
                    $or: [{ displayRoomId: rawRoomId }, { ownerUid: rawRoomId }, { roomId: rawRoomId }]
                }).lean();
                if (roomDoc) {
                    roomId = roomDoc.ownerUid || roomDoc.displayRoomId || rawRoomId;
                    if (roomDoc.displayRoomId && roomDoc.ownerUid) {
                        roomChannelManager.registerAlias(roomDoc.displayRoomId, roomDoc.ownerUid);
                    }
                }
            } catch (_) {}
        }
        if (!roomId) roomId = rawRoomId;

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

            // O(1) Targeted Seat update broadcast to room viewers across canonical & alias IDs
            const seatPacket = {
                type: 'seat:update',
                roomId,
                rawRoomId,
                seatIndex,
                userId: seat.userId || '',
                userName: seat.userName || '',
                userAvatar: seat.userAvatar || '',
                isLocked: seat.isLocked,
                isMuted: seat.isMuted
            };
            roomChannelManager.broadcastToRoom(roomId, seatPacket);
            if (rawRoomId && rawRoomId !== roomId) {
                roomChannelManager.broadcastToRoom(rawRoomId, seatPacket);
            }

            // Async MongoDB persistence
            Room.updateOne(
                { $or: [{ roomId }, { ownerUid: roomId }, { displayRoomId: roomId }, { displayRoomId: rawRoomId }] },
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
    },

    /**
     * Handles Live Mic Stage Seat Animated Emoji Broadcast
     */
    async handleSendSeatEmoji(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const roomId = String(data.roomId || meta?.roomId || '').trim();
        const slotIndex = data.slotIndex !== undefined ? Number(data.slotIndex) : (data.seatIndex !== undefined ? Number(data.seatIndex) : -1);
        const senderId = String(data.senderId || meta?.userId || '').trim();
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
    }
};

module.exports = stageSeatHandler;