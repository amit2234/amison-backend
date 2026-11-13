const roomDiscoveryActivity = require('../activities/roomDiscovery.activity');
const roomSettingsActivity = require('../activities/roomSettings.activity');
const roomModerationActivity = require('../activities/roomModeration.activity');

/**
 * Room REST Controller
 * Clean HTTP interface delegating to isolated Room Activity modules.
 */
const roomRestController = {
    async getLiveRooms(req, res) {
        try {
            const result = await roomDiscoveryActivity.getLiveRooms();
            return res.json({ success: true, source: result.source, rooms: result.rooms });
        } catch (e) {
            console.error('[RoomRest] Get live rooms error:', e);
            return res.status(500).json({ success: false, error: e.message, rooms: [] });
        }
    },

    async getExploreRooms(req, res) {
        try {
            const result = await roomDiscoveryActivity.getLiveRooms();
            return res.json({ success: true, rooms: result.rooms || [] });
        } catch (e) {
            return res.status(500).json({ rooms: [], success: false, error: e.message });
        }
    },

    async searchRooms(req, res) {
        try {
            const q = String(req.query.query || req.query.q || '').trim();
            const rooms = await roomDiscoveryActivity.searchRooms(q);
            return res.json({ success: true, rooms });
        } catch (e) {
            console.error('[RoomRest] Search rooms error:', e);
            return res.status(500).json({ success: false, rooms: [], error: e.message });
        }
    },

    async getOwnerRoom(req, res) {
        try {
            const uid = req.params.uid;
            if (!uid) {
                return res.status(400).json({ success: false, error: 'Missing owner UID' });
            }
            const room = await roomSettingsActivity.getOwnerRoom(uid);
            if (!room) {
                return res.json({ success: true, exists: false, room: null });
            }
            return res.json({ success: true, exists: true, room });
        } catch (e) {
            console.error('[RoomRest] Get owner room error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async createOrUpdateRoom(req, res) {
        try {
            const roomObj = await roomSettingsActivity.createOrUpdateRoom(req.body);
            return res.json({ success: true, room: roomObj });
        } catch (e) {
            console.error('[RoomRest] Create/Update room error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateRoomDetails(req, res) {
        try {
            const roomObj = await roomSettingsActivity.createOrUpdateRoom(req.body);
            return res.json({ success: true, room: roomObj });
        } catch (e) {
            console.error('[RoomRest] Update room details error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async closeRoom(req, res) {
        try {
            const { ownerUid, roomId } = req.body || {};
            await roomSettingsActivity.closeRoom(ownerUid, roomId);
            return res.json({ success: true, message: 'Room closed successfully' });
        } catch (e) {
            console.error('[RoomRest] Close room error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async getRoomDetails(req, res) {
        try {
            const id = req.params.id;
            const room = await roomSettingsActivity.getRoomById(id);
            if (!room) {
                return res.status(404).json({ success: false, error: 'Room not found' });
            }
            return res.json({ success: true, room });
        } catch (e) {
            console.error('[RoomRest] Get room details error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    /**
     * Instant Authoritative State Snapshot Endpoint: GET /api/rooms/:id/state
     * Returns live RAM/Redis seats[16], participants[], onlineCount, heatScore, and roles
     * so clients entering a room never wait empty-handed during WebSocket handshake.
     */
    async getRoomState(req, res) {
        try {
            const id = req.params.id;
            if (!id) {
                return res.status(400).json({ success: false, error: 'Missing room ID' });
            }
            const state = await roomSettingsActivity.getRoomStateSnapshot(id);
            if (!state) {
                return res.status(404).json({ success: false, error: 'Room not found' });
            }
            return res.json({
                success: true,
                ...state
            });
        } catch (e) {
            console.error('[RoomRest] Get room state error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async kickUser(req, res) {
        try {
            const { roomId, targetUserId, durationHours, hostName, requesterUid } = req.body || {};
            const actorUid = req.verifiedUid || requesterUid || '';
            const result = await roomModerationActivity.kickUser(roomId, targetUserId, durationHours, hostName, actorUid);
            return res.json({ success: true, ...result });
        } catch (e) {
            console.error('[RoomRest] Kick user error:', e);
            const code = e.statusCode || 500;
            return res.status(code).json({ success: false, error: e.message });
        }
    },

    async checkKickStatus(req, res) {
        try {
            const { roomId, userId } = req.query || {};
            const kickInfo = await roomModerationActivity.isUserKicked(roomId, userId);
            if (typeof kickInfo === 'boolean') {
                return res.json({ success: true, isKicked: kickInfo, remainingSeconds: 0, hostName: '' });
            }
            return res.json({ success: true, ...kickInfo });
        } catch (e) {
            return res.status(500).json({ success: false, isKicked: false, error: e.message });
        }
    },

    async unbanUser(req, res) {
        try {
            const { roomId, userId } = req.body || {};
            const result = await roomModerationActivity.unbanUser(roomId, userId);
            return res.json({ success: true, ...result });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateMemberRole(req, res) {
        try {
            const { roomId, targetUserId, userId, newRole, role, requesterUid } = req.body || {};
            const resolvedTarget = targetUserId || userId;
            const resolvedRole = newRole || role;
            const actorUid = req.verifiedUid || requesterUid || '';
            const result = await roomModerationActivity.updateMemberRole(roomId, resolvedTarget, resolvedRole, actorUid);
            return res.json({ success: true, ...result });
        } catch (e) {
            console.error('[RoomRest] Update member role error:', e);
            const code = e.statusCode || 500;
            return res.status(code).json({ success: false, error: e.message });
        }
    }
};

module.exports = roomRestController;
