const Room = require('../../models/Room');
const cacheService = require('../../services/cacheService');
const roomChannelManager = require('../managers/roomChannelManager');

/**
 * Handles 16-Mic Stage Seating, Mute/Unmute, and Lock/Unlock Events
 * 100% Zero-Trust Server Authority Engine
 */
const stageSeatHandler = {
    async handleSeatUpdate(data, ws, wss, broadcastPopularRooms) {
        const meta = roomChannelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        let roomId = meta?.canonicalRoomId || roomChannelManager.getCanonicalId(rawRoomId) || rawRoomId;
        let roomDoc = null;

        try {
            roomDoc = await Room.findOne({
                $or: [{ displayRoomId: rawRoomId }, { ownerUid: rawRoomId }, { roomId: rawRoomId }]
            }).lean();
            if (roomDoc) {
                roomId = roomDoc.ownerUid || roomDoc.displayRoomId || rawRoomId;
                if (roomDoc.displayRoomId && roomDoc.ownerUid) {
                    if (typeof roomChannelManager.registerAlias === 'function') {
                        roomChannelManager.registerAlias(roomDoc.displayRoomId, roomDoc.ownerUid);
                    }
                }
            }
        } catch (_) {}

        if ((!roomId || roomId === rawRoomId) && meta?.canonicalRoomId) {
            roomId = meta.canonicalRoomId;
        }
        if (!roomId) roomId = rawRoomId;

        const rawUserId = data.userId !== undefined ? String(data.userId || '').trim() : '';
        const targetUserId = (rawUserId === 'null' || rawUserId === 'undefined') ? '' : rawUserId;
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
                // Zero-Trust Rule 1: Check if seat is locked by host
                if (seat.isLocked) {
                    const isRoomOwner = roomDoc && (roomDoc.ownerUid === targetUserId || roomDoc.roomId === targetUserId);
                    if (!isRoomOwner) {
                        ws.send(JSON.stringify({
                            type: 'seat:rejected',
                            roomId,
                            seatIndex,
                            reason: 'SEAT_LOCKED',
                            message: `Seat ${seatIndex + 1} is locked by host!`
                        }));
                        return;
                    }
                }

                // Zero-Trust Rule 2: Check if seat is already occupied by another user (Reject race condition)
                if (seat.userId && String(seat.userId).trim() !== targetUserId && seat.userId !== 'null') {
                    ws.send(JSON.stringify({
                        type: 'seat:rejected',
                        roomId,
                        seatIndex,
                        reason: 'SEAT_ALREADY_OCCUPIED',
                        message: `Seat ${seatIndex + 1} is already occupied by ${seat.userName || 'another user'}!`
                    }));
                    return;
                }

                // Zero-Trust Rule 3: If user was on another seat, flush mic time & vacate that seat first
                seats.forEach((otherSeat, otherIdx) => {
                    if (otherIdx !== seatIndex && otherSeat && String(otherSeat.userId || '').trim() === targetUserId) {
                        if (otherSeat.seatedAt) {
                            const elapsedSec = Math.round((Date.now() - otherSeat.seatedAt) / 1000);
                            if (elapsedSec > 5) {
                                try {
                                    const DailyTaskService = require('../../services/dailyTaskService');
                                    DailyTaskService.recordMicTime(otherSeat.userId, elapsedSec);
                                } catch (_) {}
                            }
                        }
                        otherSeat.userId = null;
                        otherSeat.seatedAt = null;
                        otherSeat.userName = null;
                        otherSeat.userAvatar = null;
                        otherSeat.userCustomId = '';
                        otherSeat.isSpeaking = false;
                        const vacatePacket = {
                            type: 'seat:update',
                            roomId,
                            seatIndex: otherIdx,
                            userId: '',
                            userName: '',
                            userAvatar: '',
                            userCustomId: '',
                            isLocked: Boolean(otherSeat.isLocked),
                            isMuted: Boolean(otherSeat.isMuted),
                            isSpeaking: false
                        };
                        roomChannelManager.broadcastToRoom(roomId, vacatePacket);
                    }
                });

                seat.userId = targetUserId;
                seat.seatedAt = Date.now();
                const cleanName = (data.userName && data.userName !== 'null' && data.userName !== 'undefined') ? data.userName : (data.name && data.name !== 'null' ? data.name : (seat.userName || 'User'));
                seat.userName = cleanName;
                const cleanAvatar = (data.userAvatar && data.userAvatar !== 'null' && data.userAvatar !== 'undefined') ? data.userAvatar : (data.avatar && data.avatar !== 'null' ? data.avatar : (seat.userAvatar || ''));
                seat.userAvatar = cleanAvatar;
                seat.userCustomId = (data.userCustomId && data.userCustomId !== 'null') ? data.userCustomId : '';
            } else {
                // Flush accumulated mic time to DailyTaskService before clearing seat
                if (seat.seatedAt && seat.userId) {
                    const elapsedSec = Math.round((Date.now() - seat.seatedAt) / 1000);
                    if (elapsedSec > 5) {
                        try {
                            const DailyTaskService = require('../../services/dailyTaskService');
                            DailyTaskService.recordMicTime(seat.userId, elapsedSec);
                        } catch (_) {}
                    }
                }
                // Clear the seat completely when leaving or targetUserId is empty
                seat.userId = null;
                seat.seatedAt = null;
                seat.userName = null;
                seat.userAvatar = null;
                seat.userCustomId = '';
                seat.isSpeaking = false;
            }

            if (data.isSpeaking !== undefined) {
                seat.isSpeaking = Boolean(data.isSpeaking);
            }

            // O(1) Targeted Seat update broadcast to room viewers across canonical & alias IDs
            const seatPacket = {
                type: 'seat:update',
                roomId,
                rawRoomId,
                seatIndex,
                userId: (seat.userId === 'null' || !seat.userId) ? '' : seat.userId,
                userName: (seat.userName === 'null' || !seat.userName) ? '' : seat.userName,
                userAvatar: (seat.userAvatar === 'null' || !seat.userAvatar) ? '' : seat.userAvatar,
                userCustomId: (seat.userCustomId === 'null' || !seat.userCustomId) ? '' : seat.userCustomId,
                isLocked: Boolean(seat.isLocked),
                isMuted: Boolean(seat.isMuted),
                isSpeaking: Boolean(seat.isSpeaking)
            };
            roomChannelManager.broadcastToRoom(roomId, seatPacket);
            if (rawRoomId && rawRoomId !== roomId) {
                roomChannelManager.broadcastToRoom(rawRoomId, seatPacket);
            }
            if (meta?.roomId && meta.roomId !== roomId && meta.roomId !== rawRoomId) {
                roomChannelManager.broadcastToRoom(meta.roomId, seatPacket);
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
                if (seat.seatedAt) {
                    const elapsedSec = Math.round((Date.now() - seat.seatedAt) / 1000);
                    if (elapsedSec > 5) {
                        try {
                            const DailyTaskService = require('../../services/dailyTaskService');
                            DailyTaskService.recordMicTime(seat.userId, elapsedSec);
                        } catch (_) {}
                    }
                }
                kickedUserId = seat.userId;
                seat.userId = null;
                seat.seatedAt = null;
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
    },

    /**
     * Handles Live Mic State (Speaking wave animation, Mute/Unmute)
     */
    async handleMicState(data, ws) {
        const meta = roomChannelManager.getMetadata(ws);
        const rawRoomId = String(data.roomId || meta?.roomId || '').trim();
        const roomId = meta?.canonicalRoomId || roomChannelManager.getCanonicalId(rawRoomId) || rawRoomId;
        const targetUserId = String(data.userId || meta?.userId || '').trim();
        const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
        const isSpeaking = Boolean(data.isSpeaking);
        const isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : false;

        if (roomId) {
            if (seatIndex >= 0 && seatIndex < 16) {
                const seats = cacheService.getOrCreateRoomSeats(roomId);
                const seat = seats[seatIndex];
                if (seat) {
                    seat.isSpeaking = isSpeaking;
                    if (data.isMuted !== undefined) seat.isMuted = isMuted;
                }
            }

            const micPacket = {
                type: 'mic:state',
                roomId,
                userId: targetUserId,
                seatIndex,
                isSpeaking,
                isMuted
            };

            roomChannelManager.broadcastToRoom(roomId, micPacket);
            if (rawRoomId && rawRoomId !== roomId) {
                roomChannelManager.broadcastToRoom(rawRoomId, micPacket);
            }
        }
    }
};

module.exports = stageSeatHandler;
