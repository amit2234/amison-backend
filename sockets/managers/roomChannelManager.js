const WebSocket = require('ws');

/**
 * Room Channel Manager
 * High-Performance O(1) Room Subscription Map with Dual Alias Resolution
 * Ensures both ownerUid and displayRoomId join the EXACT SAME WebSocket channel.
 */
class RoomChannelManager {
    constructor() {
        // Map<canonicalRoomId, Set<wsClient>>
        this.roomChannels = new Map();
        // Map<wsClient, { userId, roomId, canonicalRoomId }>
        this.clientMetadata = new Map();
        // Map<aliasId, canonicalRoomId>
        this.aliasMap = new Map();
    }

    /**
     * Registers an alias (e.g. displayRoomId "767180" -> ownerUid "0CGOW3uw...")
     */
    registerAlias(aliasId, canonicalRoomId) {
        if (!aliasId || !canonicalRoomId) return;
        const cleanAlias = String(aliasId).trim();
        const cleanCanonical = String(canonicalRoomId).trim();
        if (cleanAlias && cleanCanonical) {
            this.aliasMap.set(cleanAlias, cleanCanonical);
            this.aliasMap.set(cleanCanonical, cleanCanonical);
        }
    }

    /**
     * Resolves canonical room ID for any given alias or ID
     */
    getCanonicalId(roomId) {
        if (!roomId) return '';
        const clean = String(roomId).trim();
        return this.aliasMap.get(clean) || clean;
    }

    /**
     * Subscribe a client socket to a room channel
     */
    joinRoomChannel(roomId, userId, ws) {
        if (!roomId || !ws) return;
        const cleanRoomId = String(roomId).trim();
        const cleanUserId = String(userId || '').trim();
        const canonicalId = this.getCanonicalId(cleanRoomId);

        // 1. Remove from previous channel if room changed
        const existingMeta = this.clientMetadata.get(ws);
        if (existingMeta && existingMeta.canonicalRoomId && existingMeta.canonicalRoomId !== canonicalId) {
            this.leaveRoomChannel(existingMeta.canonicalRoomId, ws);
        }

        // 2. Add to canonical room channel
        if (!this.roomChannels.has(canonicalId)) {
            this.roomChannels.set(canonicalId, new Set());
        }
        this.roomChannels.get(canonicalId).add(ws);

        // 3. Add to alias room channel if different
        if (cleanRoomId !== canonicalId) {
            if (!this.roomChannels.has(cleanRoomId)) {
                this.roomChannels.set(cleanRoomId, new Set());
            }
            this.roomChannels.get(cleanRoomId).add(ws);
            this.aliasMap.set(cleanRoomId, canonicalId);
        }

        // 4. Store client metadata
        this.clientMetadata.set(ws, {
            roomId: cleanRoomId,
            canonicalRoomId: canonicalId,
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
        const canonicalId = this.getCanonicalId(cleanRoomId);

        const targetIds = new Set([cleanRoomId, canonicalId].filter(Boolean));
        targetIds.forEach(id => {
            const clients = this.roomChannels.get(id);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    this.roomChannels.delete(id);
                }
            }
        });
    }

    /**
     * Handle socket disconnect cleanup
     */
    handleDisconnect(ws) {
        const meta = this.clientMetadata.get(ws);
        if (meta && meta.canonicalRoomId) {
            this.leaveRoomChannel(meta.canonicalRoomId, ws);
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
     * Targets both canonicalRoomId and all mapped aliases!
     */
    broadcastToRoom(roomId, packet) {
        if (!roomId || !packet) return;
        const cleanRoomId = String(roomId).trim();
        const canonicalId = this.getCanonicalId(cleanRoomId);

        const targetClients = new Set();
        const channelIds = new Set([cleanRoomId, canonicalId].filter(Boolean));

        channelIds.forEach(id => {
            const set = this.roomChannels.get(id);
            if (set) {
                set.forEach(client => targetClients.add(client));
            }
        });

        if (targetClients.size === 0) return;

        const payload = typeof packet === 'string' ? packet : JSON.stringify(packet);

        targetClients.forEach((ws) => {
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
        const canonicalId = this.getCanonicalId(cleanRoomId);
        const set1 = this.roomChannels.get(cleanRoomId);
        const set2 = this.roomChannels.get(canonicalId);
        const combined = new Set();
        if (set1) set1.forEach(c => combined.add(c));
        if (set2) set2.forEach(c => combined.add(c));
        return combined.size;
    }
}

module.exports = new RoomChannelManager();
