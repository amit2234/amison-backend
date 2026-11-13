const Room = require('../models/Room');
const User = require('../models/User');

const ROLE_RANK = {
    owner: 4,
    co_owner: 3,
    admin: 2,
    member: 1
};

// RAM caches for 0ms room-role and UID<->numericId resolution
const roomRolesCache = new Map(); // canonicalRoomId -> { ownerUid, roomId, displayRoomId, coOwners: [], admins: [], updatedAt }
const userIdSetCache = new Map(); // rawId -> { ids: string[], uid, numericId, updatedAt }
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeRoleName(role) {
    const clean = String(role || '').trim().toLowerCase();
    if (clean === 'owner' || clean === 'host' || clean === 'room owner') return 'owner';
    if (clean === 'co-owner' || clean === 'co_owner' || clean === 'coowner' || clean === 'co owner' || clean === 'deputy') return 'co_owner';
    if (clean === 'admin' || clean === 'moderator' || clean === 'room admin') return 'admin';
    return 'member';
}

function toDisplayRole(normalizedRole, isOnSeat = false) {
    switch (normalizeRoleName(normalizedRole)) {
        case 'owner': return 'Owner';
        case 'co_owner': return 'Co-Owner';
        case 'admin': return 'Admin';
        default: return isOnSeat ? 'Speaker' : 'Audience';
    }
}

function roleRank(role) {
    return ROLE_RANK[normalizeRoleName(role)] || 1;
}

/**
 * Strict Zero-Trust Hierarchy Matrix:
 * - Owner can moderate anyone (Co-Owner, Admin, Member)
 * - Co-Owner can moderate Co-Owner, Admin, Member (NOT Owner)
 * - Admin can moderate Admin, Member (NOT Owner, NOT Co-Owner)
 * - Member cannot moderate others
 */
function canModerate(actorRole, targetRole) {
    const actor = normalizeRoleName(actorRole);
    const target = normalizeRoleName(targetRole);
    if (actor === 'owner') return true;
    if (actor === 'co_owner') return target !== 'owner';
    if (actor === 'admin') return target !== 'owner' && target !== 'co_owner';
    return false;
}

function canAssignRole(actorRole, desiredRole, targetCurrentRole) {
    const actor = normalizeRoleName(actorRole);
    const desired = normalizeRoleName(desiredRole);
    const target = normalizeRoleName(targetCurrentRole);
    if (target === 'owner' || desired === 'owner') return false;
    if (actor === 'owner') return true;
    if (actor === 'co_owner') {
        if (target === 'co_owner' || desired === 'co_owner') return false;
        return desired === 'admin' || desired === 'member';
    }
    return false;
}

function cacheRoomRoles(roomDoc) {
    if (!roomDoc) return null;
    const ownerUid = String(roomDoc.ownerUid || roomDoc.roomId || '').trim();
    const roomId = String(roomDoc.roomId || ownerUid).trim();
    const displayRoomId = String(roomDoc.displayRoomId || '').trim();
    const canonical = ownerUid || roomId || displayRoomId;
    if (!canonical) return null;

    const meta = {
        canonicalRoomId: canonical,
        ownerUid,
        roomId,
        displayRoomId,
        coOwners: Array.isArray(roomDoc.coOwners) ? roomDoc.coOwners.map(x => String(x || '').trim()).filter(Boolean) : [],
        admins: Array.isArray(roomDoc.admins) ? roomDoc.admins.map(x => String(x || '').trim()).filter(Boolean) : [],
        updatedAt: Date.now()
    };
    roomRolesCache.set(canonical, meta);
    if (roomId && roomId !== canonical) roomRolesCache.set(roomId, meta);
    if (displayRoomId && displayRoomId !== canonical) roomRolesCache.set(displayRoomId, meta);
    return meta;
}

function getCachedRoomRoles(rawRoomId) {
    const clean = String(rawRoomId || '').trim();
    if (!clean) return null;
    return roomRolesCache.get(clean) || null;
}

async function resolveRoomRolesMeta(rawRoomId, existingRoomDoc = null) {
    if (existingRoomDoc) {
        return cacheRoomRoles(existingRoomDoc);
    }
    const clean = String(rawRoomId || '').trim();
    if (!clean) return null;
    const cached = roomRolesCache.get(clean);
    if (cached && (Date.now() - cached.updatedAt) < 10000) {
        return cached;
    }
    try {
        const roomDoc = await Room.findOne({
            $or: [{ displayRoomId: clean }, { ownerUid: clean }, { roomId: clean }]
        }).select('roomId ownerUid displayRoomId coOwners admins').lean();
        if (roomDoc) {
            return cacheRoomRoles(roomDoc);
        }
    } catch (_) {}
    return cached || null;
}

function invalidateRoomRolesCache(roomDoc) {
    if (!roomDoc) return;
    cacheRoomRoles(roomDoc);
}

async function resolveUserIdentifiers(rawId, extraCustomId = '') {
    const ids = new Set();
    const clean = String(rawId || '').trim();
    const cleanExtra = String(extraCustomId || '').trim();
    if (clean && clean !== 'null' && clean !== 'undefined') ids.add(clean);
    if (cleanExtra && cleanExtra !== 'null' && cleanExtra !== 'undefined') ids.add(cleanExtra);

    if (clean) {
        const cached = userIdSetCache.get(clean);
        if (cached && (Date.now() - cached.updatedAt) < USER_CACHE_TTL_MS) {
            cached.ids.forEach(i => ids.add(i));
            return ids;
        }
        try {
            const orClause = [{ uid: clean }];
            const numericVal = Number(clean);
            if (/^\d+$/.test(clean) && !Number.isNaN(numericVal) && numericVal > 0) {
                orClause.push({ numericId: numericVal });
            }
            const userDoc = await User.findOne({ $or: orClause }).select('uid numericId').lean();
            if (userDoc) {
                const collected = [];
                if (userDoc.uid) {
                    const u = String(userDoc.uid).trim();
                    ids.add(u);
                    collected.push(u);
                }
                if (userDoc.numericId) {
                    const n = String(userDoc.numericId).trim();
                    ids.add(n);
                    collected.push(n);
                }
                const entry = { ids: collected, updatedAt: Date.now() };
                collected.forEach(k => userIdSetCache.set(k, entry));
            }
        } catch (_) {}
    }
    return ids;
}

function resolveUserRoleFromMetaSync(identifiers, roomMeta) {
    if (!roomMeta || !identifiers) return 'member';
    const idSet = identifiers instanceof Set
        ? identifiers
        : new Set([String(identifiers || '').trim()].filter(Boolean));
    if (idSet.size === 0) return 'member';

    const ownerUid = String(roomMeta.ownerUid || '').trim();
    const roomId = String(roomMeta.roomId || '').trim();
    if ((ownerUid && idSet.has(ownerUid)) || (roomId && idSet.has(roomId))) {
        return 'owner';
    }
    if (Array.isArray(roomMeta.coOwners) && roomMeta.coOwners.some(id => idSet.has(String(id || '').trim()))) {
        return 'co_owner';
    }
    if (Array.isArray(roomMeta.admins) && roomMeta.admins.some(id => idSet.has(String(id || '').trim()))) {
        return 'admin';
    }
    return 'member';
}

async function resolveUserRoleInRoom(rawUserId, roomMeta, extraCustomId = '') {
    if (!rawUserId || !roomMeta) return 'member';
    const ids = await resolveUserIdentifiers(rawUserId, extraCustomId);
    return resolveUserRoleFromMetaSync(ids, roomMeta);
}

module.exports = {
    ROLE_RANK,
    normalizeRoleName,
    toDisplayRole,
    roleRank,
    canModerate,
    canAssignRole,
    cacheRoomRoles,
    getCachedRoomRoles,
    resolveRoomRolesMeta,
    invalidateRoomRolesCache,
    resolveUserIdentifiers,
    resolveUserRoleFromMetaSync,
    resolveUserRoleInRoom
};
