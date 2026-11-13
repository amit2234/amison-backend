const WebSocket = require('ws');
const { verifyFirebaseIdTokenCryptographically } = require('../../middleware/authMiddleware');
const { WS_HEARTBEAT_INTERVAL_MS, ERROR_CODES, ACTIVITY_NAMES } = require('./room.constants');
const { channelManager } = require('./room.channel.manager');
const roomLifecycleActivity = require('./activities/roomLifecycle.activity');
const roomStageSeatsActivity = require('./activities/roomStageSeats.activity');
const roomSeatLockActivity = require('./activities/roomSeatLock.activity');
const roomChatActivity = require('./activities/roomChat.activity');
const roomGiftActivity = require('./activities/roomGift.activity');
const roomModerationActivity = require('./activities/roomModeration.activity');
const roomDiscoveryActivity = require('./activities/roomDiscovery.activity');

let globalRoomWss = null;
let heartbeatTimer = null;

/**
 * Fault-Isolation Sandbox Wrapper:
 * Runs any room activity inside an isolated error boundary so an exception in
 * Lock/Unlock, Gifts, Kick, or Discovery can NEVER crash the WebSocket or disrupt Chat/Presence.
 */
async function runIsolatedActivity(activityName, ws, fn, fallbackRoomId = '', seatIndex = -1) {
    try {
        await fn();
    } catch (err) {
        console.error(`[RoomGateway][${activityName}] Isolated activity error:`, err?.message || err);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'activity:error',
                    activity: activityName,
                    roomId: fallbackRoomId,
                    seatIndex,
                    code: ERROR_CODES.ACTIVITY_ERROR,
                    message: err?.message || 'Action could not be completed'
                }));
            } catch (_) {}
        }
    }
}

async function broadcastPopularRooms(wss) {
    return roomDiscoveryActivity.broadcastPopularRooms(wss || globalRoomWss);
}

function broadcastGiftCatalogSync(payload = {}) {
    if (!globalRoomWss || !globalRoomWss.clients) return;
    const packet = JSON.stringify({
        type: 'gift_catalog_sync',
        action: payload.action || 'sync',
        gift: payload.gift,
        gifts: payload.gifts
    });
    globalRoomWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(packet);
            } catch (_) {}
        }
    });
}

function broadcastRoomGift(payload = {}) {
    roomGiftActivity.broadcastRoomGift(payload);
}

/**
 * Cleans up socket presence and occupied stage seats upon close or dead-ping timeout.
 */
async function cleanupClosedSocket(ws, wss) {
    if (!ws || ws._roomCleanedUp) return;
    ws._roomCleanedUp = true;

    const meta = channelManager.getMetadata(ws);
    if (meta && (meta.roomId || meta.canonicalRoomId)) {
        try {
            await roomLifecycleActivity.handleLeaveRoom(
                {
                    roomId: meta.roomId,
                    canonicalRoomId: meta.canonicalRoomId,
                    userId: meta.userId,
                    userName: meta.userName,
                    userCustomId: meta.userCustomId
                },
                ws,
                () => roomDiscoveryActivity.schedulePopularRoomsBroadcast(wss)
            );
        } catch (err) {
            console.warn('[RoomGateway] Leave cleanup notice:', err?.message || err);
        }
    }
    channelManager.handleDisconnect(ws);
}

/**
 * Dedicated Room & 16-Seat Stage Real-Time WebSocket Gateway
 * Path: '/ws/rooms' (Multiplexed via server.on('upgrade') with noServer: true)
 */
function setupRoomSocket(server) {
    const wss = new WebSocket.Server({ noServer: true });
    globalRoomWss = wss;
    console.log('🎙️ [RoomGateway] Fault-Isolated Modular WebSocket Server running on /ws/rooms');

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }

    // Protocol-level ws.ping() Keep-Alive Sweep (prevents Render/Cloudflare proxy drops & cleans zombie seats)
    heartbeatTimer = setInterval(() => {
        if (!wss || !wss.clients) return;
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                cleanupClosedSocket(ws, wss).catch(() => {});
                try {
                    ws.terminate();
                } catch (_) {}
                return;
            }
            ws.isAlive = false;
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
            } catch (_) {}
        });
    }, WS_HEARTBEAT_INTERVAL_MS);

    wss.on('close', () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    });

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws._roomCleanedUp = false;

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        try {
            const urlObj = new URL(req.url, 'http://localhost');
            const userId = (urlObj.searchParams.get('userId') || req.headers['x-user-id'] || '').trim();
            const roomId = (urlObj.searchParams.get('roomId') || req.headers['x-room-id'] || '').trim();
            const displayRoomId = (urlObj.searchParams.get('displayRoomId') || req.headers['x-display-room-id'] || '').trim();
            const authHeader = String(req.headers['authorization'] || '').trim();
            const rawToken = (urlObj.searchParams.get('token') || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '')).trim();

            if (rawToken) {
                ws._authPromise = verifyFirebaseIdTokenCryptographically(rawToken)
                    .then((decoded) => {
                        const verifiedUid = String(decoded?.uid || decoded?.sub || '').trim();
                        if (verifiedUid) {
                            ws._verifiedUid = verifiedUid;
                            const currentMeta = channelManager.getMetadata(ws);
                            if (currentMeta) {
                                currentMeta.verifiedUid = verifiedUid;
                            }
                        }
                        return verifiedUid;
                    })
                    .catch(() => '');
            }

            if (displayRoomId && roomId) {
                channelManager.registerAlias(displayRoomId, roomId);
            }
            if (roomId && userId) {
                channelManager.joinRoomChannel(roomId, userId, ws, '', '', ws._verifiedUid || '');
            }
        } catch (_) {}

        const triggerPopularBroadcast = () => roomDiscoveryActivity.schedulePopularRoomsBroadcast(wss);

        ws.on('message', async (rawMessage) => {
            ws.isAlive = true;
            let data;
            try {
                data = JSON.parse(rawMessage.toString());
            } catch (_) {
                return;
            }
            if (!data || typeof data !== 'object') return;

            const eventType = data.type;
            const roomIdHint = String(data.roomId || '').trim();
            const seatIdxHint = data.seatIndex !== undefined ? Number(data.seatIndex) : -1;

            switch (eventType) {
                // Fast-lane Chat & Typing (Never queued behind DB/Locks)
                case 'room:chat':
                case 'chat_message':
                    await runIsolatedActivity(ACTIVITY_NAMES.CHAT, ws, () => {
                        roomChatActivity.handleRoomChat(data, ws);
                    }, roomIdHint);
                    break;

                case 'room:typing':
                case 'typing':
                    await runIsolatedActivity(ACTIVITY_NAMES.CHAT, ws, () => {
                        roomChatActivity.handleRoomTyping(data, ws);
                    }, roomIdHint);
                    break;

                // Lifecycle (Enter / Leave / Snapshot)
                case 'room:join':
                case 'join_room':
                    await runIsolatedActivity(ACTIVITY_NAMES.LIFECYCLE, ws, () => (
                        roomLifecycleActivity.handleJoinRoom(data, ws, triggerPopularBroadcast)
                    ), roomIdHint);
                    break;

                case 'room:leave':
                case 'leave_room':
                    await runIsolatedActivity(ACTIVITY_NAMES.LIFECYCLE, ws, () => (
                        roomLifecycleActivity.handleLeaveRoom(data, ws, triggerPopularBroadcast)
                    ), roomIdHint);
                    break;

                // Stage Seat Operations (Take / Leave / Mute / Self Mic)
                case 'room:seat':
                case 'seat_update':
                    await runIsolatedActivity(ACTIVITY_NAMES.STAGE_SEATS, ws, () => (
                        roomStageSeatsActivity.handleSeatUpdate(data, ws, triggerPopularBroadcast)
                    ), roomIdHint, seatIdxHint);
                    break;

                // Dedicated Seat Lock / Unlock Activity (Isolated from Stage/Chat)
                case 'room:seat_toggle_lock':
                case 'seat:toggle_lock':
                    await runIsolatedActivity(ACTIVITY_NAMES.SEAT_LOCK, ws, () => (
                        roomSeatLockActivity.handleToggleSeatLock(data, ws, triggerPopularBroadcast)
                    ), roomIdHint, seatIdxHint);
                    break;

                // Live Mic State & Seat Emoji Reactions
                case 'mic_state':
                case 'mic:state':
                case 'room:mic_state':
                    await runIsolatedActivity(ACTIVITY_NAMES.STAGE_SEATS, ws, () => (
                        roomStageSeatsActivity.handleMicState(data, ws)
                    ), roomIdHint, seatIdxHint);
                    break;

                case 'send_seat_emoji':
                case 'room:send_emoji':
                case 'seat_emoji':
                    await runIsolatedActivity(ACTIVITY_NAMES.STAGE_SEATS, ws, () => (
                        roomStageSeatsActivity.handleSendSeatEmoji(data, ws)
                    ), roomIdHint, seatIdxHint);
                    break;

                // In-Room Gifting
                case 'gift:send':
                case 'room:gift_send':
                case 'send_gift':
                    await runIsolatedActivity(ACTIVITY_NAMES.GIFT, ws, () => (
                        roomGiftActivity.handleSendGift(data, ws)
                    ), roomIdHint);
                    break;

                // Kick / Moderation
                case 'room:kick':
                case 'kick_user':
                    await runIsolatedActivity(ACTIVITY_NAMES.MODERATION, ws, () => (
                        roomModerationActivity.handleKickSocket(data, ws)
                    ), roomIdHint);
                    break;

                // Application Heartbeat
                case 'ping':
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                        } catch (_) {}
                    }
                    break;

                // Popular Rooms Feed Poll
                case 'rooms:poll':
                case 'popular_rooms:get':
                    await runIsolatedActivity(ACTIVITY_NAMES.DISCOVERY, ws, () => (
                        broadcastPopularRooms(wss)
                    ));
                    break;

                default:
                    break;
            }
        });

        ws.on('close', () => {
            cleanupClosedSocket(ws, wss).catch(() => {});
        });

        ws.on('error', (err) => {
            console.warn('[RoomGateway] Socket error:', err?.message || err);
        });
    });

    return wss;
}

setupRoomSocket.broadcastPopularRooms = broadcastPopularRooms;
setupRoomSocket.broadcastGiftCatalogSync = broadcastGiftCatalogSync;
setupRoomSocket.broadcastRoomGift = broadcastRoomGift;

module.exports = {
    setupRoomSocket,
    broadcastPopularRooms,
    broadcastGiftCatalogSync,
    broadcastRoomGift
};
