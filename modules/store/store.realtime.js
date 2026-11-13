const WebSocket = require('ws');
const cacheService = require('../../services/cacheService');
const storeCache = require('./store.cache');
const StoreItem = require('../../models/StoreItem');

/**
 * Store Real-Time WebSocket Engine (/ws/store) + Multi-Channel Broadcaster
 * Broadcasts catalog mutations (create, edit, toggle-active, delete) and inventory updates
 * in real time to all connected Android users so Store never requires an app restart.
 */
let storeWss = null;
const storeUserSockets = new Map(); // userId -> Set<WebSocket>

function addStoreClient(userId, ws) {
    if (!userId) return;
    const cleanUid = String(userId).trim();
    if (!storeUserSockets.has(cleanUid)) {
        storeUserSockets.set(cleanUid, new Set());
    }
    storeUserSockets.get(cleanUid).add(ws);
}

function removeStoreClient(userId, ws) {
    if (!userId) return;
    const cleanUid = String(userId).trim();
    const set = storeUserSockets.get(cleanUid);
    if (set) {
        set.delete(ws);
        if (set.size === 0) {
            storeUserSockets.delete(cleanUid);
        }
    }
}

function setupStoreSocket() {
    const wss = new WebSocket.Server({ noServer: true });
    storeWss = wss;
    console.log('🛍️ [StoreSocket] Real-Time Store Catalog Server running on /ws/store');

    wss.on('connection', async (ws, req) => {
        let userId = null;
        let lastKnownVersion = 0;

        try {
            const urlObj = new URL(req.url, 'http://localhost');
            userId = (urlObj.searchParams.get('userId') || req.headers['x-user-id'] || '').trim() || null;
            lastKnownVersion = Number(urlObj.searchParams.get('version') || 0) || 0;
            if (userId) {
                addStoreClient(userId, ws);
            }

            // Immediately send current catalog version / snapshot if client is stale
            let cached = await storeCache.getCatalogCache();
            if (!cached) {
                cached = await storeCache.refreshCatalogCache(StoreItem);
            }

            if (ws.readyState === WebSocket.OPEN) {
                const isStale = lastKnownVersion === 0 || lastKnownVersion < cached.version;
                ws.send(JSON.stringify({
                    type: isStale ? 'store:catalog_snapshot' : 'store:hello',
                    version: cached.version,
                    count: cached.items.length,
                    items: isStale ? cached.items : undefined,
                    timestamp: Date.now()
                }));
            }
        } catch (err) {
            console.warn('⚠️ [StoreSocket] Connection init notice:', err.message);
        }

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'ping') {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'pong',
                            version: storeCache.getCatalogVersion(),
                            timestamp: Date.now()
                        }));
                    }
                    return;
                }

                if (msg.type === 'store:register' && msg.userId) {
                    userId = String(msg.userId).trim();
                    addStoreClient(userId, ws);
                    return;
                }

                if (msg.type === 'store:sync') {
                    const clientVersion = Number(msg.version || 0) || 0;
                    let cached = await storeCache.getCatalogCache();
                    if (!cached) {
                        cached = await storeCache.refreshCatalogCache(StoreItem);
                    }
                    if (ws.readyState === WebSocket.OPEN) {
                        const changed = clientVersion === 0 || clientVersion < cached.version;
                        ws.send(JSON.stringify({
                            type: 'store:catalog_snapshot',
                            notModified: !changed,
                            version: cached.version,
                            count: cached.items.length,
                            items: changed ? cached.items : undefined,
                            timestamp: Date.now()
                        }));
                    }
                }
            } catch (_) {}
        });

        ws.on('close', () => {
            removeStoreClient(userId, ws);
        });

        ws.on('error', () => {
            removeStoreClient(userId, ws);
        });
    });

    return wss;
}

/**
 * Broadcasts catalog update to all connected /ws/store clients AND /ws/chat online users.
 */
function broadcastCatalogUpdated(payload = {}) {
    const packetObj = {
        type: 'store:catalog_updated',
        version: payload.version || storeCache.getCatalogVersion(),
        action: payload.action || 'updated',
        category: payload.category || null,
        itemId: payload.itemId || null,
        item: payload.item || null,
        items: Array.isArray(payload.items) ? payload.items : undefined,
        timestamp: Date.now()
    };

    const serialized = JSON.stringify(packetObj);
    const sentSockets = new Set();

    // 1. Dedicated /ws/store clients
    if (storeWss && storeWss.clients) {
        storeWss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && !sentSockets.has(client)) {
                sentSockets.add(client);
                try {
                    client.send(serialized);
                } catch (_) {}
            }
        });
    }

    // 2. Also notify connected /ws/chat clients so users with active chat socket get instant signal
    if (cacheService.onlineUsers && cacheService.onlineUsers.size > 0) {
        cacheService.onlineUsers.forEach((client) => {
            if (client && client.readyState === WebSocket.OPEN && !sentSockets.has(client)) {
                sentSockets.add(client);
                try {
                    client.send(serialized);
                } catch (_) {}
            }
        });
    }

    return sentSockets.size;
}

/**
 * Sends real-time inventory/equipped change notification to a specific user UID.
 */
function emitInventoryUpdated(userId, inventoryPayload = {}) {
    if (!userId) return false;
    const cleanUid = String(userId).trim();
    const packet = JSON.stringify({
        type: 'store:inventory_updated',
        userId: cleanUid,
        equipped: inventoryPayload.equipped || null,
        ownedItems: inventoryPayload.ownedItems || null,
        grantedItem: inventoryPayload.grantedItem || null,
        timestamp: Date.now()
    });

    let delivered = false;
    const userSet = storeUserSockets.get(cleanUid);
    if (userSet) {
        userSet.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(packet);
                    delivered = true;
                } catch (_) {}
            }
        });
    }

    if (cacheService.emitToUser(cleanUid, packet)) {
        delivered = true;
    }

    return delivered;
}

module.exports = {
    setupStoreSocket,
    broadcastCatalogUpdated,
    emitInventoryUpdated
};
