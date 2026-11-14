const Room = require('../../../models/Room');
const User = require('../../../models/User');
const { POPULAR_ROOMS_THROTTLE_MS, normalizeStageCapacity } = require('../room.constants');
const { resolveTrueOwnerUid } = require('../room.channel.manager');

let localMemoryRoomsCache = null;
let lastCacheTimestamp = 0;
const LOCAL_CACHE_TTL_MS = 3000;

let popularBroadcastTimer = null;
let lastPopularBroadcastAt = 0;

/**
 * Room Discovery Activity
 * Handles Live Rooms Feed, Search Rooms, Duplicate Cleanup, and Throttled Popular Room Broadcasts.
 * Keeps heavy feed queries isolated so they never delay in-room chat or seat updates.
 */
const roomDiscoveryActivity = {
    invalidateCache() {
        localMemoryRoomsCache = null;
        lastCacheTimestamp = 0;
    },

    async cleanupDuplicateRooms() {
        try {
            const rooms = await Room.find({}).sort({ updatedAt: -1 }).lean();
            const seenOwners = new Set();
            for (const r of rooms) {
                const owner = r.ownerUid || r.roomId;
                if (!owner) continue;
                const resolved = await resolveTrueOwnerUid(owner);
                if (seenOwners.has(resolved) || seenOwners.has(owner)) {
                    await Room.deleteOne({ _id: r._id });
                } else {
                    seenOwners.add(resolved);
                    seenOwners.add(owner);
                }
            }

            await Room.updateMany(
                { $or: [{ onlineCount: { $lte: 0 } }, { onlineCount: null }] },
                { $set: { isLive: false, onlineCount: 0, heatScore: 0 } }
            );
        } catch (e) {
            console.error('[RoomDiscovery] Cleanup duplicate rooms error:', e.message);
        }
    },

    async getLiveRooms() {
        await this.cleanupDuplicateRooms();
        const now = Date.now();
        if (localMemoryRoomsCache && (now - lastCacheTimestamp) < LOCAL_CACHE_TTL_MS) {
            return { source: 'memory_cache', rooms: localMemoryRoomsCache };
        }

        const activeRooms = await Room.find({
            isLive: true,
            onlineCount: { $gte: 1 },
            heatScore: { $gte: 10 },
            isBlocked: { $ne: true }
        })
            .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
            .limit(50)
            .lean();

        const formattedRooms = [];
        for (const r of activeRooms) {
            let ownerNumericId = '';
            let ownerLevel = 1;
            const ownerUid = r.ownerUid || r.roomId;
            if (ownerUid) {
                const ownerUser = await User.findOne({ $or: [{ uid: ownerUid }, { roomId: ownerUid }] })
                    .select('numericId level')
                    .lean();
                if (ownerUser) {
                    if (ownerUser.numericId) ownerNumericId = String(ownerUser.numericId);
                    if (ownerUser.level) ownerLevel = ownerUser.level;
                }
            }

            const liveCount = Number(r.onlineCount || 0);
            const heat = Number(r.heatScore || 0);
            const cleanDisplayId = String(r.displayRoomId || '').trim();
            formattedRooms.push({
                id: cleanDisplayId || r._id,
                publicRoomId: cleanDisplayId,
                displayRoomId: cleanDisplayId,
                roomId: r.roomId || r.ownerUid,
                title: r.roomName || 'Voice Room',
                roomName: r.roomName || 'Voice Room',
                category: r.category || 'Voice Party',
                announcement: r.announcement || 'Welcome!',
                ownerId: r.ownerUid || '',
                ownerUid: r.ownerUid || '',
                coOwners: Array.isArray(r.coOwners) ? r.coOwners : [],
                admins: Array.isArray(r.admins) ? r.admins : [],
                ownerNumericId: ownerNumericId,
                roomLevel: ownerLevel,
                photoUri: r.roomPhotoUrl || '',
                roomPhotoUrl: r.roomPhotoUrl || '',
                backgroundUrl: r.backgroundUrl || '',
                participantCount: liveCount,
                onlineCount: liveCount,
                speakerSlots: normalizeStageCapacity(r.speakerSlots),
                tags: r.category || '#Chill,#Talk,#Hindi',
                roomHeat: heat,
                isLive: (liveCount > 0 && heat >= 10 && !r.isBlocked)
            });
        }

        localMemoryRoomsCache = formattedRooms;
        lastCacheTimestamp = now;
        return { source: 'mongodb', rooms: formattedRooms };
    },

    async searchRooms(query) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) return [];
        const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const isDigitsOnly = /^\d+$/.test(cleanQuery);

        // Zero-Trust Backend Search:
        // Numeric queries search strictly by displayRoomId (exact/prefix first) + roomName;
        // Text queries search roomName / category (never expose or match internal ownerUid/roomId).
        const filter = isDigitsOnly
            ? {
                isBlocked: { $ne: true },
                $or: [
                    { displayRoomId: cleanQuery },
                    { displayRoomId: new RegExp(`^${escaped}`) },
                    { displayRoomId: new RegExp(escaped, 'i') },
                    { roomName: new RegExp(escaped, 'i') }
                ]
            }
            : {
                isBlocked: { $ne: true },
                $or: [
                    { roomName: new RegExp(escaped, 'i') },
                    { category: new RegExp(escaped, 'i') }
                ]
            };

        const matched = await Room.find(filter)
            .sort({ isLive: -1, onlineCount: -1, updatedAt: -1 })
            .limit(40)
            .lean();

        // Rank exact displayRoomId match > prefix displayRoomId > live > title match
        matched.sort((a, b) => {
            const aDisp = String(a.displayRoomId || '').trim();
            const bDisp = String(b.displayRoomId || '').trim();
            const score = (disp, r) => {
                if (disp === cleanQuery) return 1000;
                if (disp.startsWith(cleanQuery)) return 500;
                if (disp.includes(cleanQuery)) return 200;
                if (String(r.roomName || '').toLowerCase().startsWith(cleanQuery.toLowerCase())) return 100;
                return 0;
            };
            const diff = score(bDisp, b) - score(aDisp, a);
            if (diff !== 0) return diff;
            return (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0);
        });

        const results = [];
        for (const r of matched.slice(0, 30)) {
            let ownerNumericId = '';
            let ownerLevel = 1;
            const ownerUid = r.ownerUid || r.roomId;
            if (ownerUid) {
                const ownerUser = await User.findOne({ $or: [{ uid: ownerUid }, { roomId: ownerUid }] })
                    .select('numericId level')
                    .lean();
                if (ownerUser) {
                    if (ownerUser.numericId) ownerNumericId = String(ownerUser.numericId);
                    if (ownerUser.level) ownerLevel = ownerUser.level;
                }
            }
            const cleanDisplayId = String(r.displayRoomId || '').trim();
            results.push({
                id: cleanDisplayId || r._id,
                publicRoomId: cleanDisplayId,
                displayRoomId: cleanDisplayId,
                roomId: r.roomId || r.ownerUid,
                title: r.roomName || 'Voice Room',
                roomName: r.roomName || 'Voice Room',
                category: r.category || 'Voice Party',
                announcement: r.announcement || 'Welcome!',
                ownerId: r.ownerUid || '',
                ownerUid: r.ownerUid || '',
                coOwners: Array.isArray(r.coOwners) ? r.coOwners : [],
                admins: Array.isArray(r.admins) ? r.admins : [],
                ownerNumericId: ownerNumericId,
                roomLevel: ownerLevel,
                photoUri: r.roomPhotoUrl || '',
                roomPhotoUrl: r.roomPhotoUrl || '',
                backgroundUrl: r.backgroundUrl || '',
                participantCount: Number(r.onlineCount || 0),
                onlineCount: Number(r.onlineCount || 0),
                speakerSlots: normalizeStageCapacity(r.speakerSlots),
                tags: r.category || '#Chill,#Talk,#Hindi',
                roomHeat: Number(r.heatScore || 0),
                isLive: Boolean(r.isLive)
            });
        }
        return results;
    },

    async resolveRoomUid(displayId) {
        const clean = String(displayId || '').trim();
        if (!clean) return null;
        const room = await Room.findOne({
            $or: [{ displayRoomId: clean }, { roomId: clean }, { ownerUid: clean }]
        }).select('ownerUid roomId').lean();
        if (room && (room.ownerUid || room.roomId)) {
            return room.ownerUid || room.roomId;
        }
        if (/^\d+$/.test(clean)) {
            const userDoc = await User.findOne({ numericId: Number(clean) }).select('uid').lean();
            if (userDoc && userDoc.uid) return String(userDoc.uid).trim();
        }
        return null;
    },

    async broadcastPopularRooms(wss) {
        try {
            if (!wss || !wss.clients || wss.clients.size === 0) return;
            const rooms = await Room.find({
                isLive: true,
                onlineCount: { $gte: 1 },
                heatScore: { $gte: 10 },
                isBlocked: { $ne: true }
            })
                .sort({ heatScore: -1, onlineCount: -1, updatedAt: -1 })
                .limit(50)
                .lean();

            const packet = JSON.stringify({
                type: 'popular_rooms_update',
                rooms: rooms || []
            });

            wss.clients.forEach((client) => {
                if (client.readyState === 1) {
                    try {
                        client.send(packet);
                    } catch (_) {}
                }
            });
        } catch (e) {
            console.warn('[RoomDiscovery] Broadcast popular rooms notice:', e.message);
        }
    },

    schedulePopularRoomsBroadcast(wss) {
        const now = Date.now();
        const elapsed = now - lastPopularBroadcastAt;
        if (elapsed >= POPULAR_ROOMS_THROTTLE_MS) {
            lastPopularBroadcastAt = now;
            this.broadcastPopularRooms(wss);
            return;
        }
        if (popularBroadcastTimer) return;
        popularBroadcastTimer = setTimeout(() => {
            popularBroadcastTimer = null;
            lastPopularBroadcastAt = Date.now();
            this.broadcastPopularRooms(wss);
        }, POPULAR_ROOMS_THROTTLE_MS - elapsed);
    }
};

module.exports = roomDiscoveryActivity;