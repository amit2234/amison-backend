const RoomService = require('../services/roomService');

const RoomController = {
    async getLiveRooms(req, res) {
        try {
            const result = await RoomService.getLiveRooms();
            return res.json({ success: true, source: result.source, rooms: result.rooms });
        } catch (e) {
            console.error('[RoomController] Get live rooms error:', e);
            return res.status(500).json({ success: false, error: e.message, rooms: [] });
        }
    },

    async getOwnerRoom(req, res) {
        try {
            const uid = req.params.uid;
            if (!uid) {
                return res.status(400).json({ success: false, error: 'Missing owner UID' });
            }
            const room = await RoomService.getOwnerRoom(uid);
            if (!room) {
                return res.json({ success: true, exists: false, room: null });
            }
            return res.json({ success: true, exists: true, room });
        } catch (e) {
            console.error('[RoomController] Get owner room error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async createOrUpdateRoom(req, res) {
        try {
            const roomObj = await RoomService.createOrUpdateRoom(req.body);
            return res.json({ success: true, room: roomObj });
        } catch (e) {
            console.error('[RoomController] Create/Update room error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateRoomDetails(req, res) {
        try {
            const roomObj = await RoomService.createOrUpdateRoom(req.body);
            return res.json({ success: true, room: roomObj });
        } catch (e) {
            console.error('[RoomController] Update room details error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async closeRoom(req, res) {
        try {
            const { ownerUid, roomId } = req.body || {};
            await RoomService.closeRoom(ownerUid, roomId);
            return res.json({ success: true, message: 'Room closed successfully' });
        } catch (e) {
            console.error('[RoomController] Close room error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async getExploreRooms(req, res) {
        try {
            const result = await RoomService.getLiveRooms();
            return res.json({ success: true, rooms: result.rooms || [] });
        } catch (e) {
            return res.status(500).json({ rooms: [], success: false, error: e.message });
        }
    },

    async getRoomDetails(req, res) {
        try {
            const id = req.params.id;
            const room = await RoomService.getRoomById(id);
            if (!room) {
                return res.status(404).json({ success: false, error: 'Room not found' });
            }
            return res.json({ success: true, room });
        } catch (e) {
            console.error('[RoomController] Get room details error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async kickUser(req, res) {
        try {
            const { roomId, targetUserId, durationHours, hostName } = req.body || {};
            const result = await RoomService.kickUser(roomId, targetUserId, durationHours, hostName);
            return res.json({ success: true, ...result });
        } catch (e) {
            console.error('[RoomController] Kick user error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async checkKickStatus(req, res) {
        try {
            const { roomId, userId } = req.query || {};
            const kickInfo = await RoomService.isUserKicked(roomId, userId);
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
            const result = await RoomService.unbanUser(roomId, userId);
            return res.json({ success: true, ...result });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateMemberRole(req, res) {
        try {
            const { roomId, targetUserId, newRole, requesterUid } = req.body || {};
            const result = await RoomService.updateMemberRole(roomId, targetUserId, newRole, requesterUid);
            return res.json({ success: true, ...result });
        } catch (e) {
            console.error('[RoomController] Update member role error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }
};

module.exports = RoomController;