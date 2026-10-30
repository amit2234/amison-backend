const WebSocket = require('ws');
const mongoose = require('mongoose');

// In-Memory map to track active connections: userId => WebSocket
const onlineUsers = new Map();

// In-Memory map for active rooms: roomId => Map(userId => { userId, name, avatar, onSeat, seatIndex })
const activeRooms = new Map();

// In-Memory map for active 16-seat stages: roomId => Array[16] (Instant 0ms lookup & lock/unlock)
const roomSeatsMap = new Map();

function getOrCreateRoomSeats(roomId) {
    if (!roomSeatsMap.has(roomId)) {
        roomSeatsMap.set(roomId, Array.from({ length: 16 }, (_, i) => ({
            seatIndex: i,
            userId: null,
            userName: null,
            userAvatar: null,
            isLocked: false,
            isMuted: false,
            seatLabel: (i + 1).toString()
        })));
    }
    return roomSeatsMap.get(roomId);
}

/**
 * Recalculate room heat score:
 * - Audience (not on seat) = 10 heat points per user
 * - Seated user (on seat / mic) = 50 heat points per user
 */
function calculateRoomHeat(participantsMap) {
    let heat = 0;
    participantsMap.forEach((participant) => {
        if (participant.onSeat) {
            heat += 50;
        } else {
            heat += 10;
        }
    });
    return heat;
}

/**
 * Broadcast popular rooms update to all connected clients
 */
async function broadcastPopularRooms(wss) {
    try {
        const Room = mongoose.models.Room;
        if (!Room) return;
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
        console.error('[ChatSocket] Broadcast popular rooms error:', e.message);
    }
}

/**
 * Sets up High-Speed Real-Time Chat & Room WebSocket Server on path '/ws/chat'
 */
function setupChatSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/chat' });

    console.log('📡 [ChatSocket] Real-Time WebSocket & Room Heat Server initialized on /ws/chat');

    wss.on('connection', (ws, req) => {
        let currentUserId = null;
        let currentConversationId = null;
        let currentRoomId = null;

        try {
            const urlObj = new URL(req.url, 'http://localhost');
            const queryUserId = urlObj.searchParams.get('userId');
            const headerUserId = req.headers['x-user-id'];
            currentUserId = (queryUserId || headerUserId || '').trim();
            if (currentUserId) {
                onlineUsers.set(currentUserId, ws);
                console.log(`[ChatSocket] User connected & registered instantly: ${currentUserId}`);
            }
        } catch (e) {
            console.error('[ChatSocket] Error parsing connection request:', e.message);
        }

        ws.on('message', async (rawMessage) => {
            try {
                const data = JSON.parse(rawMessage.toString());

                // 0. General user registration / association
                if (data.userId && !currentUserId) {
                    currentUserId = String(data.userId).trim();
                    onlineUsers.set(currentUserId, ws);
                }

                // 1. User joins conversation room or registers
                if (data.type === 'dm:join' || data.type === 'user:register' || data.type === 'auth:register') {
                    currentUserId = data.userId ? String(data.userId).trim() : currentUserId;
                    currentConversationId = data.conversationId || currentConversationId;
                    if (currentUserId) {
                        onlineUsers.set(currentUserId, ws);
                    }
                }

                // 2. Real-Time Typing Animation Event
                else if (data.type === 'dm:typing') {
                    const recipientId = data.recipientId ? String(data.recipientId).trim() : null;
                    const recipientSocket = recipientId ? onlineUsers.get(recipientId) : null;

                    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                        recipientSocket.send(JSON.stringify({
                            type: 'dm:typing_update',
                            conversationId: data.conversationId,
                            userId: data.senderId,
                            isTyping: Boolean(data.isTyping)
                        }));
                    }
                }

                // 3. Fast Real-Time Message Send
                else if (data.type === 'dm:send') {
                    const recipientId = data.recipientId ? String(data.recipientId).trim() : null;
                    const recipientSocket = recipientId ? onlineUsers.get(recipientId) : null;

                    const messagePacket = {
                        type: 'dm:receive',
                        messageId: data.clientMessageId || `${Date.now()}`,
                        conversationId: data.conversationId,
                        senderId: data.senderId,
                        senderName: data.senderName || 'User',
                        senderAvatar: data.senderAvatar || '',
                        text: data.text || '',
                        messageType: data.messageType || 'text',
                        timestamp: data.timestamp || Date.now()
                    };

                    ws.send(JSON.stringify({
                        type: 'dm:ack',
                        clientMessageId: data.clientMessageId,
                        status: 'sent',
                        timestamp: Date.now()
                    }));

                    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                        recipientSocket.send(JSON.stringify(messagePacket));
                    }
                }

                // ============================================================
                // ROOM HEAT POINT & REAL-TIME AUDIO PARTY SOCKET EVENTS
                // ============================================================

                // A. User enters a room (Audience / Owner) -> 10 heat points per user
                else if (data.type === 'room:join') {
                    currentRoomId = String(data.roomId || '').trim();
                    currentUserId = data.userId ? String(data.userId).trim() : null;
                    const userName = data.userName || 'User';
                    const userAvatar = data.userAvatar || '';
                    const isOwner = Boolean(data.isOwner);

                    if (currentRoomId && currentUserId) {
                        if (!activeRooms.has(currentRoomId)) {
                            activeRooms.set(currentRoomId, new Map());
                        }
                        const roomParticipants = activeRooms.get(currentRoomId);
                        
                        roomParticipants.set(currentUserId, {
                            userId: currentUserId,
                            name: userName,
                            avatar: userAvatar,
                            onSeat: isOwner, // Owner defaults to seat 0 or active, normal user defaults to audience (10 pts)
                            seatIndex: isOwner ? 0 : -1
                        });

                        const heatScore = calculateRoomHeat(roomParticipants);
                        const onlineCount = roomParticipants.size;

                        // Update MongoDB Room document
                        const Room = mongoose.models.Room;
                        if (Room) {
                            await Room.updateOne(
                                { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                                { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                            );
                        }

                        // 1. Send full 16-seat stage snapshot to joining user
                        const currentSeats = getOrCreateRoomSeats(currentRoomId);
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

                        // Broadcast popular rooms list update globally
                        await broadcastPopularRooms(wss);
                    }
                }

                // B. User sits on a mic / seat -> Heat point changes from 10 to 50
                else if (data.type === 'room:seat' || data.type === 'seat_update') {
                    currentRoomId = String(data.roomId || '').trim();
                    const targetUserId = String(data.userId || '').trim();
                    const onSeat = data.onSeat !== undefined ? Boolean(data.onSeat) : (targetUserId.length > 0);
                    const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
                    const isLocked = data.isLocked !== undefined ? Boolean(data.isLocked) : null;
                    const isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : null;

                    if (currentRoomId && seatIndex >= 0 && seatIndex < 16) {
                        const seats = getOrCreateRoomSeats(currentRoomId);
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
                        const Room = mongoose.models.Room;
                        if (Room) {
                            Room.updateOne(
                                { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                                { $set: { [`seats.${seatIndex}`]: seat, updatedAt: new Date() } }
                            ).catch(err => console.error('[ChatSocket] Mongo seat update error:', err.message));
                        }
                    }

                    if (currentRoomId && targetUserId && activeRooms.has(currentRoomId)) {
                        const roomParticipants = activeRooms.get(currentRoomId);
                        const user = roomParticipants.get(targetUserId);
                        if (user) {
                            user.onSeat = onSeat;
                            user.seatIndex = seatIndex;
                            roomParticipants.set(targetUserId, user);
                        }

                        const heatScore = calculateRoomHeat(roomParticipants);
                        const onlineCount = roomParticipants.size;

                        const Room = mongoose.models.Room;
                        if (Room) {
                            await Room.updateOne(
                                { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                                { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                            );
                        }

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

                // B.1 Host/Admin Toggles Seat Lock/Unlock (Ultra-Fast 0ms Lock/Unlock)
                else if (data.type === 'room:seat_toggle_lock' || data.type === 'seat:toggle_lock') {
                    currentRoomId = String(data.roomId || '').trim();
                    const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;
                    const isLocked = Boolean(data.isLocked);

                    if (currentRoomId && seatIndex >= 0 && seatIndex < 16) {
                        const seats = getOrCreateRoomSeats(currentRoomId);
                        const seat = seats[seatIndex];
                        seat.isLocked = isLocked;

                        let kickedUserId = null;
                        if (isLocked && seat.userId) {
                            // If user is currently occupying a seat that got locked, kick them to audience
                            kickedUserId = seat.userId;
                            seat.userId = null;
                            seat.userName = null;
                            seat.userAvatar = null;
                        }

                        // Broadcast to all users in 0ms
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

                        // Background async MongoDB persistence in rooms collection
                        const Room = mongoose.models.Room;
                        if (Room) {
                            Room.updateOne(
                                { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                                { $set: { [`seats.${seatIndex}`]: seat, updatedAt: new Date() } }
                            ).catch(err => console.error('[ChatSocket] Mongo seat lock update error:', err.message));
                        }
                    }
                }

                // C. User leaves room -> Heat recalculates
                else if (data.type === 'room:leave') {
                    currentRoomId = String(data.roomId || '').trim();
                    const targetUserId = String(data.userId || currentUserId || '').trim();

                    if (currentRoomId && targetUserId && activeRooms.has(currentRoomId)) {
                        const roomParticipants = activeRooms.get(currentRoomId);
                        roomParticipants.delete(targetUserId);

                        const heatScore = calculateRoomHeat(roomParticipants);
                        const onlineCount = roomParticipants.size;

                        const Room = mongoose.models.Room;
                        if (Room) {
                            await Room.updateOne(
                                { $or: [{ roomId: currentRoomId }, { ownerUid: currentRoomId }, { displayRoomId: currentRoomId }] },
                                { $set: { heatScore, onlineCount, updatedAt: new Date() } }
                            );
                        }

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

                // D. Room Live Chat Message
                else if (data.type === 'room:chat') {
                    currentRoomId = String(data.roomId || '').trim();
                    const chatPacket = JSON.stringify({
                        type: 'room:chat_receive',
                        roomId: currentRoomId,
                        senderId: data.senderId,
                        senderName: data.senderName || 'User',
                        senderAvatar: data.senderAvatar || '',
                        text: data.text || '',
                        timestamp: Date.now()
                    });

                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(chatPacket);
                        }
                    });
                }

                // 4. Render Keep-Alive Heartbeat Ping/Pong
                else if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                }

            } catch (err) {
                console.error('[ChatSocket] Error parsing message:', err.message);
            }
            
