const WebSocket = require('ws');
const Room = require('../models/Room');
const cacheService = require('../services/cacheService');

/**
 * Broadcast popular rooms update to all connected clients
 */
async function broadcastPopularRooms(wss) {
    try {
        const rooms = await Room.find({ isLive: true, heatScore: { $gte: 10 } })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();

        const packet = JSON.stringify({
            type: 'popular_rooms_update',
            rooms: rooms || []
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(packet);
            }
        });
    } catch (e) {
        console.error('[RoomSocket] Broadcast popular rooms error:', e.message);
    }
}

/**
 * Dedicated Room & 16-Seat Stage Real-Time WebSocket Server
 * Path: '/ws/rooms'
 */
function setupRoomSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/rooms' });
    console.log('🎙️ [RoomSocket] Dedicated 16-Seat Stage & Room WebSocket Server running on /ws/rooms');

    wss.on('connection', (ws, req) => {
        let currentUserId = null;
        let currentRoomId = null;

        try {
            const urlObj = new URL(req.url, 'http://localhost');
            currentUserId = (urlObj.searchParams.get('userId') || req.headers['x-user-id'] || '').trim();
            currentRoomId = (urlObj.searchParams.get('roomId') || req.headers['x-room-id'] || '').trim();
            if (currentUserId) {
                console.log(`[RoomSocket] User connected to room socket: ${currentUserId} (Room: ${currentRoomId})`);
            }
        } catch (e) {
            console.error('[RoomSocket] Error parsing connection request:', e.message);
        }

        ws.on('message', async (rawMessage) => {
            try {
                const data = JSON.parse(rawMessage.toString());

                // ============================================================
                // A. User enters a room (Audience / Host) -> 10 heat points per user
                // ============================================================
                if (data.type === 'room:join' || data.type === 'join_room') {
                    currentRoomId = String(data.roomId || currentRoomId || '').trim();
                    currentUserId = String(data.userId || currentUserId || '').trim();
                    const userName = data.userName || 'User';
                    const userAvatar = data.userAvatar || data.avatarUrl || '';
                    const isOwner = Boolean(data.isOwner || data.role === 'Owner');

                    if (currentRoomId && currentUserId) {
                        const roomParticipants = cacheService.getRoomParticipants(currentRoomId);
                        
                        roomParticipants.set(currentUserId, {
                            userId: currentUserId,
                            name: userName,
                            avatar: userAvatar,
                            onSeat: isOwner,
                            seatIndex: isOwner ? 0 : -1
                        });

                        const heatScore = cacheService.calculateRoomHeat(roomParticipants);
                        const onlineCount = roomParticipants.size;

                        // Background async MongoDB persistence
                        Room.updateOne(
                            { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                            { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                        ).catch(err => console.error('[RoomSocket] Mongo room join update error:', err.message));

                        // 1. Send full 16-seat stage snapshot to joining user
                        const currentSeats = cacheService.getOrCreateRoomSeats(currentRoomId);
                        ws.send(JSON.stringify({
                            type: 'seats:batch',
                            roomId: currentRoomId,
                            seats: currentSeats
                        }));

                        // 2. Broadcast updated room state to all in room
                        const roomStatePacket = JSON.stringify({
                            type: 'room:state_update',
                            roomId: currentRoomId,
                            heatScore,
                            onlineCount,
                            participants: Array.from(roomParticipants.values())
                        });

                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(roomStatePacket);
                            }
                        });

                        await broadcastPopularRooms(wss);
                    }
                }

                // ============================================================
                // B. User sits on a mic / seat -> Heat changes from 10 to 50
                // ============================================================
                else if (data.type === 'room:seat' || data.type === 'seat_update') {
                    currentRoomId = String(data.roomId || currentRoomId || '').trim();
                    const targetUserId = String(data.userId || '').trim();
                    const onSeat = data.onSeat !== undefined ? Boolean(data.onSeat) : (targetUserId.length > 0);
                    const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
                    const isLocked = data.isLocked !== undefined ? Boolean(data.isLocked) : null;
                    const isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : null;

                    if (currentRoomId && seatIndex >= 0 && seatIndex < 16) {
                        const seats = cacheService.getOrCreateRoomSeats(currentRoomId);
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

                        // Broadcast single seat update to all connected viewers in 0ms
                        const seatPacket = JSON.stringify({
                            type: 'seat:update',
                            roomId: currentRoomId,
                            seatIndex: seatIndex,
                            userId: seat.userId || '',
                            userName: seat.userName || '',
                            userAvatar: seat.userAvatar || '',
                            isLocked: seat.isLocked,
                            isMuted: seat.isMuted
                        });

                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(seatPacket);
                            }
                        });

                        // Background async MongoDB persistence in rooms collection
                        Room.updateOne(
                            { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                            { $set: { [`seats.${seatIndex}`]: seat, updatedAt: new Date() } }
                        ).catch(err => console.error('[RoomSocket] Mongo seat update error:', err.message));
                    }

                    if (currentRoomId && targetUserId) {
                        const roomParticipants = cacheService.getRoomParticipants(currentRoomId);
                        const user = roomParticipants.get(targetUserId);
                        if (user) {
                            user.onSeat = onSeat;
                            user.seatIndex = seatIndex;
                            roomParticipants.set(targetUserId, user);
                        }
                        const heatScore = cacheService.calculateRoomHeat(roomParticipants);
                        const onlineCount = roomParticipants.size;

                        Room.updateOne(
                            { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                            { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                        ).catch(() => {});

                        const roomStatePacket = JSON.stringify({
                            type: 'room:state_update',
                            roomId: currentRoomId,
                            heatScore,
                            onlineCount,
                            participants: Array.from(roomParticipants.values())
                        });

                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(roomStatePacket);
                            }
                        });

                        await broadcastPopularRooms(wss);
                    }
                }

                // ============================================================
                // B.1 Host/Admin Toggles Seat Lock/Unlock (Ultra-Fast 0ms Lock/Unlock)
                // ============================================================
                else if (data.type === 'room:seat_toggle_lock' || data.type === 'seat:toggle_lock') {
                    currentRoomId = String(data.roomId || currentRoomId || '').trim();
                    const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
                    const isLocked = Boolean(data.isLocked);

                    if (currentRoomId && seatIndex >= 0 && seatIndex < 16) {
                        const seats = cacheService.getOrCreateRoomSeats(currentRoomId);
                        const seat = seats[seatIndex];
                        seat.isLocked = isLocked;
                        let kickedUserId = null;

                        if (isLocked && seat.userId) {
                            kickedUserId = seat.userId;
                            seat.userId = null;
                            seat.userName = null;
                            seat.userAvatar = null;
                        }

                        const lockPacket = JSON.stringify({
                            type: 'seat:update',
                            roomId: currentRoomId,
                            seatIndex: seatIndex,
                            userId: seat.userId || '',
                            userName: seat.userName || '',
                            userAvatar: seat.userAvatar || '',
                            isLocked: seat.isLocked,
                            isMuted: seat.isMuted,
                            kickedUserId: kickedUserId
                        });

                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(lockPacket);
                            }
                        });

                        Room.updateOne(
                            { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                            { $set: { [`seats.${seatIndex}`]: seat, updatedAt: new Date() } }
                        ).catch(err => console.error('[RoomSocket] Mongo seat lock update error:', err.message));
                    }
                }

                // ============================================================
                // C. User leaves room -> Heat recalculates
                // ============================================================
                else if (data.type === 'room:leave' || data.type === 'leave_room') {
                    currentRoomId = String(data.roomId || currentRoomId || '').trim();
                    const targetUserId = String(data.userId || currentUserId || '').trim();

                    if (currentRoomId && targetUserId) {
                        const roomParticipants = cacheService.getRoomParticipants(currentRoomId);
                        roomParticipants.delete(targetUserId);

                        const heatScore = cacheService.calculateRoomHeat(roomParticipants);
                        const onlineCount = roomParticipants.size;

                        Room.updateOne(
                            { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                            { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                        ).catch(() => {});

                        const roomStatePacket = JSON.stringify({
                            type: 'room:state_update',
                            roomId: currentRoomId,
                            heatScore,
                            onlineCount,
                            participants: Array.from(roomParticipants.values())
                        });

                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(roomStatePacket);
                            }
                        });

                        await broadcastPopularRooms(wss);
                    }
                }

                // ============================================================
                // D. Room Live Chat Message
                // ============================================================
                else if (data.type === 'room:chat' || data.type === 'chat_message') {
                    currentRoomId = String(data.roomId || currentRoomId || '').trim();
                    const chatPacket = JSON.stringify({
                        type: 'room:chat_receive',
                        roomId: currentRoomId,
                        senderId: data.senderId,
                        senderName: data.senderName || 'User',
                        senderAvatar: data.senderAvatar || '',
                        text: data.text || data.message || '',
                        timestamp: Date.now()
                    });

                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(chatPacket);
                        }
                    });
                }

                // ============================================================
                // E. Keep-Alive Ping/Pong
                // ============================================================
                else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                }

                // ============================================================
                // F. Explore Rooms Poll Request
                // ============================================================
                else if (data.type === 'rooms:poll' || data.type === 'popular_rooms:get') {
                    await broadcastPopularRooms(wss);
                }
            } catch (err) {
                console.error('[RoomSocket] Error parsing message:', err.message);
            }
        });

        ws.on('close', async () => {
            if (currentRoomId && currentUserId) {
                const roomParticipants = cacheService.getRoomParticipants(currentRoomId);
                roomParticipants.delete(currentUserId);

                const heatScore = cacheService.calculateRoomHeat(roomParticipants);
                const onlineCount = roomParticipants.size;

                Room.updateOne(
                    { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                    { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                ).catch(() => {});

                const roomStatePacket = JSON.stringify({
                    type: 'room:state_update',
                    roomId: currentRoomId,
                    heatScore,
                    onlineCount,
                    participants: Array.from(roomParticipants.values())
                });

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(roomStatePacket);
                    }
                });

                await broadcastPopularRooms(wss);
            }
        });

        ws.on('error', (err) => {
            console.warn('[RoomSocket] Socket warning:', err.message);
        });
    });
}

setupRoomSocket.broadcastPopularRooms = broadcastPopularRooms;

module.exports = setupRoomSocket;
