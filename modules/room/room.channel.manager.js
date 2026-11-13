const Room = require('../../models/Room');
const User = require('../../models/User');
const roomRoleHelper = require('../../services/roomRoleHelper');
const cacheService = require('../../services/cacheService');

/**
 * Room Channel Manager
 * High-Performance O(1) Room Subscription Map with Dual Alias Resolution,
 * Multi-Socket User Awareness, and Safe Fault-Isolated Broadcasting.
 */
class RoomChannelManager {
    constructor() {
        // Map<canonicalOrAliasRoomId, Set<wsClient>>
        this.roomChannels = new Map();
        // Map<wsClient, { userId, roomId, canonicalRoomId, verifiedUid, userName, userCustomId, joinedAt }>
        this.clientMetadata = new Map();
        // Map<aliasId, canonicalRoomId>
        this.aliasMap = new Map();
    }

    registerAlias(aliasId, canonicalRoomId) {
        if (!aliasId || !canonicalRoomId) return;
        const cleanAlias = String(aliasId).trim();
        const cleanCanonical = String(canonicalRoomId).trim();
        if (cleanAlias && cleanCanonical && cleanAlias !== 'null' && cleanCanonical !== 'null') {
            this.aliasMap.set(cleanAlias, cleanCanonical);
            this.aliasMap.set(cleanCanonical, cleanCanonical);

            // Persist lightweight alias in Redis if ready so REST snapshots also map displayRoomId -> canonicalRoomId
            const redis = cacheService.redisClient;
            if (redis && redis.status === 'ready' && cleanAlias !== cleanCanonical) {
                redis.set(`room:alias:${cleanAlias}`, cleanCanonical, 'EX', 3600).catch(() => {});
            }
        }
    }

    getCanonicalId(roomId) {
        if (!roomId) return '';
        const clean = String(roomId).trim();
        return this.aliasMap.get(clean) || clean;
    }

    async getCanonicalIdAsync(roomId) {
        const local = this.getCanonicalId(roomId);
        if (local && local !== String(roomId || '').trim()) return local;

        const clean = String(roomId || '').trim();
        if (!clean) return '';
        const redis = cacheService.redisClient;
        if (redis && redis.status === 'ready') {
            try {
                const cachedAlias = await redis.get(`room:alias:${clean}`);
                if (cachedAlias) {
                    this.aliasMap.set(clean, cachedAlias);
                    this.aliasMap.set(cachedAlias, cachedAlias);
                    return cachedAlias;
                }
            } catch (_) {}
        }
        return local || clean;
    }

    joinRoomChannel(roomId, userId, ws, userName = '', userCustomId = '', verifiedUid = '') {
        if (!roomId || !ws) return;
        const cleanRoomId = String(roomId).trim();
        const cleanUserId = String(userId || '').trim();
        const cleanUserName = String(userName || '').trim();
        const cleanUserCustomId = String(userCustomId || '').trim();
        const canonicalId = this.getCanonicalId(cleanRoomId);

        const existingMeta = this.clientMetadata.get(ws);
        if (existingMeta && existingMeta.canonicalRoomId && existingMeta.canonicalRoomId !== canonicalId) {
            this.leaveRoomChannel(existingMeta.canonicalRoomId, ws);
        }
        const effectiveVerifiedUid = String(verifiedUid || existingMeta?.verifiedUid || '').trim();

        if (!this.roomChannels.has(canonicalId)) {
            this.roomChannels.set(canonicalId, new Set());
        }
        this.roomChannels.get(canonicalId).add(ws);

        if (cleanRoomId !== canonicalId) {
            if (!this.roomChannels.has(cleanRoomId)) {
                this.roomChannels.set(cleanRoomId, new Set());
            }
            this.roomChannels.get(cleanRoomId).add(ws);
            this.aliasMap.set(cleanRoomId, canonicalId);
        }

        this.clientMetadata.set(ws, {
            roomId: cleanRoomId,
            canonicalRoomId: canonicalId,
            userId: cleanUserId,
            verifiedUid: effectiveVerifiedUid,
            userName: cleanUserName,
            userCustomId: cleanUserCustomId,
            joinedAt: existingMeta?.joinedAt || Date.now()
        });
    }

    leaveRoomChannel(roomId, ws) {
        if (!roomId || !ws) return;
        const cleanRoomId = String(roomId).trim();
        const canonicalId = this.getCanonicalId(cleanRoomId);

        const targetIds = new Set([cleanRoomId, canonicalId].filter(Boolean));
        targetIds.forEach((id) => {
            const clients = this.roomChannels.get(id);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    this.roomChannels.delete(id);
                }
            }
        });
    }

    handleDisconnect(ws) {
        const meta = this.clientMetadata.get(ws);
        if (meta && meta.canonicalRoomId) {
            this.leaveRoomChannel(meta.canonicalRoomId, ws);
        }
        if (meta && meta.roomId && meta.roomId !== meta.canonicalRoomId) {
            this.leaveRoomChannel(meta.roomId, ws);
        }
        this.clientMetadata.delete(ws);
        return meta;
    }

    getMetadata(ws) {
        return this.clientMetadata.get(ws);
    }

    /**
     * Checks if a user STILL has another OPEN WebSocket in the same room.
     * Prevents race condition when a mobile user reconnects and old socket closes slightly later.
     */
    hasOtherActiveSocketForUser(roomId, identifierSet, excludeWs = null) {
        if (!roomId || !identifierSet || identifierSet.size === 0) return false;
        const sockets = this.getRoomOpenSockets(roomId);
        for (const client of sockets) {
            if (client === excludeWs) continue;
            const cMeta = this.clientMetadata.get(client);
            if (!cMeta) continue;
            const uid = String(cMeta.verifiedUid || cMeta.userId || '').trim();
            const customId = String(cMeta.userCustomId || '').trim();
            if ((uid && identifierSet.has(uid)) || (cMeta.userId && identifierSet.has(cMeta.userId)) || (customId && identifierSet.has(customId))) {
                return true;
            }
        }
        return false;
    }

    getRoomOpenSockets(roomId) {
        if (!roomId) return [];
        const cleanRoomId = String(roomId).trim();
        const canonicalId = this.getCanonicalId(cleanRoomId);
        const targetClients = new Set();
        const channelIds = new Set([cleanRoomId, canonicalId].filter(Boolean));

        channelIds.forEach((id) => {
            const set = this.roomChannels.get(id);
            if (set) {
                for (const client of Array.from(set)) {
                    if (client && client.readyState === 1) {
                        targetClients.add(client);
                    } else {
                        set.delete(client);
                    }
                }
                if (set.size === 0) {
                    this.roomChannels.delete(id);
                }
            }
        });

        return Array.from(targetClients);
    }

    broadcastToRoom(roomId, packet) {
        if (!roomId || !packet) return 0;
        const targetClients = this.getRoomOpenSockets(roomId);
        if (targetClients.length === 0) return 0;

        const payload = typeof packet === 'string' ? packet : JSON.stringify(packet);
        let delivered = 0;

        for (const ws of targetClients) {
            try {
                if (ws.readyState === 1) {
                    ws.send(payload);
                    delivered++;
                }
            } catch (_) {
                // Fault isolation: one dead client socket never stops broadcast to others
            }
        }
        return delivered;
    }

    broadcastToRoomTargets(targets, packet) {
        if (!targets || !packet) return 0;
        const payload = typeof packet === 'string' ? packet : JSON.stringify(packet);
        const uniqueSockets = new Set();

        for (const ch of targets) {
            if (!ch) continue;
            for (const ws of this.getRoomOpenSockets(ch)) {
                uniqueSockets.add(ws);
            }
        }

        let delivered = 0;
        for (const ws of uniqueSockets) {
            try {
                if (ws.readyState === 1) {
                    ws.send(payload);
                    delivered++;
                }
            } catch (_) {}
        }
        return delivered;
    }

    getRoomOnlineCount(roomId) {
        return this.getRoomOpenSockets(roomId).length;
    }
}

const channelManager = new RoomChannelManager();

/**
 * Resolves canonical room identity (ownerUid / roomId / displayRoomId) consistently
 * so every user joining by 6-digit ID or UID shares the exact same channel and state.
 */
async function resolveRoomContext(rawRoomId, meta = null, extraDisplayRoomId = '') {
    const cleanRaw = String(rawRoomId || '').trim();
    const cleanExtraDisplay = String(extraDisplayRoomId || '').trim();

    let canonicalRoomId = meta?.canonicalRoomId
        || await channelManager.getCanonicalIdAsync(cleanRaw)
        || (cleanExtraDisplay ? await channelManager.getCanonicalIdAsync(cleanExtraDisplay) : '')
        || cleanRaw;

    let roomMeta = roomRoleHelper.getCachedRoomRoles(canonicalRoomId)
        || roomRoleHelper.getCachedRoomRoles(cleanRaw)
        || (cleanExtraDisplay ? roomRoleHelper.getCachedRoomRoles(cleanExtraDisplay) : null);

    let roomDoc = null;

    if (!roomMeta && (cleanRaw || cleanExtraDisplay)) {
        try {
            const orConditions = [];
            if (cleanRaw) {
                orConditions.push({ displayRoomId: cleanRaw }, { ownerUid: cleanRaw }, { roomId: cleanRaw });
            }
            if (cleanExtraDisplay && cleanExtraDisplay !== cleanRaw) {
                orConditions.push({ displayRoomId: cleanExtraDisplay });
            }
            if (orConditions.length > 0) {
                roomDoc = await Room.findOne({ $or: orConditions }).lean();
                if (roomDoc) {
                    canonicalRoomId = String(roomDoc.ownerUid || roomDoc.roomId || roomDoc.displayRoomId || cleanRaw).trim();
                    if (roomDoc.displayRoomId) channelManager.registerAlias(roomDoc.displayRoomId, canonicalRoomId);
                    if (roomDoc.roomId) channelManager.registerAlias(roomDoc.roomId, canonicalRoomId);
                    if (roomDoc.ownerUid) channelManager.registerAlias(roomDoc.ownerUid, canonicalRoomId);
                    roomMeta = roomRoleHelper.cacheRoomRoles(roomDoc);
                }
            }
        } catch (_) {}
    } else if (roomMeta?.canonicalRoomId) {
        canonicalRoomId = roomMeta.canonicalRoomId;
        if (roomMeta.displayRoomId) channelManager.registerAlias(roomMeta.displayRoomId, canonicalRoomId);
        if (roomMeta.roomId) channelManager.registerAlias(roomMeta.roomId, canonicalRoomId);
    }

    if (!roomMeta && canonicalRoomId) {
        roomMeta = await roomRoleHelper.resolveRoomRolesMeta(canonicalRoomId, roomDoc);
    }

    if ((!canonicalRoomId || canonicalRoomId === cleanRaw) && meta?.canonicalRoomId) {
        canonicalRoomId = meta.canonicalRoomId;
    }
    if (cleanExtraDisplay && canonicalRoomId) {
        channelManager.registerAlias(cleanExtraDisplay, canonicalRoomId);
    }

    return {
        roomId: canonicalRoomId || cleanRaw,
        canonicalRoomId: canonicalRoomId || cleanRaw,
        rawRoomId: cleanRaw,
        roomMeta,
        roomDoc
    };
}

function getBroadcastTargets(canonicalRoomId, rawRoomId = '', meta = null, roomDoc = null) {
    return Array.from(new Set([
        canonicalRoomId,
        rawRoomId,
        meta?.roomId,
        meta?.canonicalRoomId,
        roomDoc?.roomId,
        roomDoc?.ownerUid,
        roomDoc?.displayRoomId
    ].map(x => String(x || '').trim()).filter(x => x && x !== 'null' && x !== 'undefined')));
}

async function resolveTrueOwnerUid(inputUid) {
    const clean = String(inputUid || '').trim();
    if (!clean) return '';
    if (/^\d+$/.test(clean)) {
        const numericVal = Number(clean);
        const userDoc = await User.findOne({ numericId: numericVal }).select('uid').lean();
        if (userDoc && userDoc.uid) {
            return String(userDoc.uid).trim();
        }
    }
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(clean);
    const userDoc = await User.findOne({
        $or: isObjectId ? [{ uid: clean }, { _id: clean }] : [{ uid: clean }]
    }).select('uid').lean();
    if (userDoc && userDoc.uid) {
        return String(userDoc.uid).trim();
    }
    return clean;
}

async function generateUnique6DigitId() {
    let attempts = 0;
    while (attempts < 30) {
        const id = Math.floor(100000 + Math.random() * 900000).toString();
        const existingRoom = await Room.findOne({ $or: [{ displayRoomId: id }, { roomId: id }] }).select('_id').lean();
        const existingUser = await User.findOne({ $or: [{ roomId: id }, { numericId: Number(id) }] }).select('_id').lean();
        if (!existingRoom && !existingUser) return id;
        attempts++;
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
    channelManager,
    resolveRoomContext,
    getBroadcastTargets,
    resolveTrueOwnerUid,
    generateUnique6DigitId
};
