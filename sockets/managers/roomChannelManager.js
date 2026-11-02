const WebSocket = require('ws');

/**
 * Room Channel Manager
 * High-Performance O(1) Room Subscription Map
 * Ensures broadcasts only target clients connected to a specific room channel.
 */
class RoomChannelManager {
    constructor() {
        // Map<roomId, Set<wsClient>>
        this.roomChannels = new Map();
        // Map<wsClient, { userId, roomId }>
        this.clientMetadata = new Map();
    }

    /**
     * Subscribe a client socket to a room channel
     */
    joinRoomChannel(roomId, userId, ws) {
        if (!roomId || !ws) return;
        const cleanRoomId = String(roomId).trim();
        const cleanUserId = String(userId || '').trim();

        // 1. Remove from previous channel if room changed
        const existingMeta = this.clientMetadata.get(ws);
        if (existingMeta && existingMeta.roomId && existingMeta.roomId !== cleanRoomId) {
            this.leaveRoomChannel(existingMeta.roomId, ws);
        }

        // 2. Add to target room channel
        if (!this.roomChannels.has(cleanRoomId)) {
            this.roomChannels.set(cleanRoomId, new Set());
        }
        this.roomChannels.get(cleanRoomId).add(ws);

        // 3. Store client metadata
        this.clientMetadata.set(ws, {
            roomId: cleanRoomId,
            userId: cleanUserId,
            joinedAt: Date.now()
        });
    }

    /**
     * Unsubscribe a client socket from a room channel
     */
    leaveRoomChannel(roomId, ws) {
        if (!roomId || !ws) return;
        const cleanRoomId = String(roomId).trim();
        const clients = this.roomChannels.get(cleanRoomId);

        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                this.roomChannels.delete(cleanRoomId);
            }
        }
    }

    /**
     * Handle socket disconnect cleanup
     */
    handleDisconnect(ws) {
        const meta = this.clientMetadata.get(ws);
        if (meta && meta.roomId) {
            this.leaveRoomChannel(meta.roomId, ws);
        }
        this.clientMetadata.delete(ws);
        return meta;
    }

    /**
     * Get client metadata
     */
    getMetadata(ws) {
        return this.clientMetadata.get(ws);
    }

    /**
     * O(1) Broadcast packet to all clients inside a specific room
     */
    broadcastToRoom(roomId, packet) {
        if (!roomId || !packet) return;
        const cleanRoomId = String(roomId).trim();
        const clients = this.roomChannels.get(cleanRoomId);

        if (!clients || clients.size === 0) return;

        const payload = typeof packet === 'string' ? packet : JSON.stringify(packet);

        clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        });
    }

    /**
     * Get count of active clients in a room channel
     */
    getRoomOnlineCount(roomId) {
        const cleanRoomId = String(roomId).trim();
        const clients = this.roomChannels.get(cleanRoomId);
        return clients ? clients.size : 0;
    }
}

module.exports = new RoomChannelManager();