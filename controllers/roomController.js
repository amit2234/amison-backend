
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
    }
};

module.exports = RoomController;