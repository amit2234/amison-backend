const WebSocket = require('ws');
const Room = require('../models/Room');
const roomChannelManager = require('./managers/roomChannelManager');
const roomStateHandler = require('./handlers/roomStateHandler');
const stageSeatHandler = require('./handlers/stageSeatHandler');
const roomChatHandler = require('./handlers/roomChatHandler');
const roomGiftHandler = require('./handlers/roomGiftHandler');

let globalRoomWss = null;

/**
 * Broadcast popular live rooms update
 */
async function broadcastPopularRooms(wss) {
    try {
        const rooms = await Room.find({ isLive: true, onlineCount: { $gte: 1 }, heatScore: { $gte: 10 }, isBlocked: { $ne: true } })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();

        const packet = JSON.stringify({
            type: 'popular_rooms_update',
            rooms: rooms || []
        });

        const targetWss = wss || globalRoomWss;
        if (targetWss && targetWss.clients) {
            targetWss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(packet);
                }
            });
        }
    } catch (e) {
        console.error('[RoomSocket] Broadcast popular rooms error:', e.message);
    }
}

/**
 * Dedicated Room & 16-Seat Stage Real-Time WebSocket Server
 * Path: '/ws/rooms'
 */
function setupRoomSocket(server) {
    const wss = new WebSocket.Server({ noServer: true });
    globalRoomWss = wss;
    console.log('🎙️ [RoomSocket] High-Performance Channel-Based WebSocket Server running on /ws/rooms');

    wss.on('connection', (ws, req) => {
        try {
            const urlObj = new URL(req.url, 'http://localhost');
            const userId = (urlObj.searchParams.get('userId') || req.headers['x-user-id'] || '').trim();
            const roomId = (urlObj.searchParams.get('roomId') || req.headers['x-room-id'] || '').trim();
            const displayRoomId = (urlObj.searchParams.get('displayRoomId') || req.headers['x-display-room-id'] || '').trim();
            if (displayRoomId && roomId) {
                roomChannelManager.registerAlias(displayRoomId, roomId);
            }
            if (roomId && userId) {
                roomChannelManager.joinRoomChannel(roomId, userId, ws);
            }
        } catch (_) {}

        ws.on('message', async (rawMessage) => {
            try {
                const data = JSON.parse(rawMessage.toString());
                const eventType = data.type;

                switch (eventType) {
                    case 'room:join':
                    case 'join_room':
                        await roomStateHandler.handleJoinRoom(data, ws, wss, broadcastPopularRooms);
                        break;

                    case 'room:seat':
                    case 'seat_update':
                        await stageSeatHandler.handleSeatUpdate(data, ws, wss, broadcastPopularRooms);
                        break;

                    case 'room:seat_toggle_lock':
                    case 'seat:toggle_lock':
                        await stageSeatHandler.handleSeatToggleLock(data, ws);
                        break;

                    case 'room:leave':
                    case 'leave_room':
                        await roomStateHandler.handleLeaveRoom(data, ws, wss, broadcastPopularRooms);
                        break;

                    case 'room:chat':
                    case 'chat_message':
                        roomChatHandler.handleRoomChat(data, ws);
                        break;

                    case 'room:typing':
                    case 'typing':
                        roomChatHandler.handleRoomTyping(data, ws);
                        break;

                    case 'gift:send':
                    case 'room:gift_send':
                    case 'send_gift':
                        await roomGiftHandler.handleSendGift(data, ws);
                        break;

                    case 'send_seat_emoji':
                    case 'room:send_emoji':
                    case 'seat_emoji':
                        await stageSeatHandler.handleSendSeatEmoji(data, ws);
                        break;

                    case 'mic_state':
                    case 'mic:state':
                    case 'room:mic_state':
                        await stageSeatHandler.handleMicState(data, ws);
                        break;

                    case 'room:kick':
                    case 'kick_user':
                        try {
                            const RoomService = require('../services/roomService');
                            await RoomService.kickUser(data.roomId, data.targetUserId, data.durationHours || 3, data.hostName || 'Host');
                        } catch (kErr) {
                            console.error('[RoomSocket] Kick error:', kErr.message);
                        }
                        break;

                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                        break;

                    case 'rooms:poll':
                    case 'popular_rooms:get':
                        await broadcastPopularRooms(wss);
                        break;

                    default:
                        break;
                }
            } catch (err) {
                console.error('[RoomSocket] Message handling error:', err.message);
            }
        });

        ws.on('close', async () => {
            const meta = roomChannelManager.handleDisconnect(ws);
            if (meta && meta.roomId) {
                await roomStateHandler.handleLeaveRoom({ roomId: meta.roomId, userId: meta.userId }, ws, wss, broadcastPopularRooms);
            }
        });

        ws.on('error', (err) => {
            console.warn('[RoomSocket] Socket error:', err.message);
        });
    });
    return wss;
}

/**
 * Helper Broadcast Functions (Targeted O(1) Room Channels)
 */
function broadcastGiftCatalogSync(payload) {
    if (!globalRoomWss || !globalRoomWss.clients) return;
    const packet = JSON.stringify({
        type: 'gift_catalog_sync',
        action: payload.action || 'sync',
        gift: payload.gift,
        gifts: payload.gifts
    });
    globalRoomWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(packet);
        }
    });
}

function broadcastRoomGift(payload) {
    const roomId = String(payload.roomId || '').trim();
    if (!roomId) return;

    const giftPacket = {
        type: 'room:gift_broadcast',
        roomId,
        senderId: payload.senderId,
        senderName: payload.senderName,
        senderAvatar: payload.senderAvatar,
        receiverId: payload.receiverId,
        receiverName: payload.receiverName,
        receiverAvatar: payload.receiverAvatar,
        targetMicIndex: payload.targetMicIndex !== undefined ? payload.targetMicIndex : -1,
        giftId: payload.giftId,
        giftName: payload.giftName,
        iconUrl: payload.iconUrl,
        animationUrl: payload.animationUrl,
        animationType: payload.animationType,
        multiplier: payload.multiplier || 1,
        timestamp: payload.timestamp || Date.now()
    };

    const chatPacket = {
        type: 'room:chat_receive',
        roomId,
        senderId: payload.senderId,
        senderName: payload.senderName,
        senderAvatar: payload.senderAvatar,
        text: `sent ${payload.giftName || 'Gift'} x${payload.multiplier || 1} to ${payload.receiverName || 'Host'}`,
        isGiftNotice: true,
        giftIcon: payload.iconUrl,
        timestamp: Date.now()
    };

    // O(1) Targeted Room Broadcast ONLY to clients in this voice room
    roomChannelManager.broadcastToRoom(roomId, giftPacket);
    roomChannelManager.broadcastToRoom(roomId, chatPacket);
}

setupRoomSocket.broadcastPopularRooms = broadcastPopularRooms;
setupRoomSocket.broadcastGiftCatalogSync = broadcastGiftCatalogSync;
setupRoomSocket.broadcastRoomGift = broadcastRoomGift;

module.exports = setupRoomSocket;