const NewopAuthService = require('../services/newopAuthService');
const NewopUserService = require('../services/newopUserService');
const NewopRoomService = require('../services/newopRoomService');
const { requireNewopAdmin } = require('../middleware/authMiddleware');

const NewopController = {
    requireNewopAdmin,

    async checkAccess(req, res) {
        try {
            const { uid } = req.params;
            if (!uid) return res.json({ success: true, hasAccess: false, title: '' });

            const cleanUid = String(uid).trim();
            const hasAccess = await NewopAuthService.isAuthorizedNewopAdmin(cleanUid);

            return res.json({
                success: true,
                hasAccess,
                title: hasAccess ? 'Newop - Super master' : ''
            });
        } catch (e) {
            console.error('[NewopController] checkAccess error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async login(req, res) {
        try {
            const { uid } = req.body;
            if (!uid) return res.status(400).json({ success: false, error: 'UID is required' });

            const cleanUid = String(uid).trim();
            const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(cleanUid);

            if (!isAuth) {
                return res.status(403).json({ success: false, error: 'Unauthorized Newop Admin UID' });
            }

            return res.json({
                success: true,
                message: 'Newop Admin authenticated successfully',
                role: 'super_master'
            });
        } catch (e) {
            console.error('[NewopController] login error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getUsers(req, res) {
        try {
            const formatted = await NewopUserService.getAllUsers(req.callerUid);
            res.json({ success: true, count: formatted.length, users: formatted });
        } catch (e) {
            console.error('[NewopController] getUsers error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async banUser(req, res) {
        try {
            const { userId, uid, isBanned } = req.body || {};
            const updated = await NewopUserService.banOrUnbanUser(req.callerUid, userId || uid, isBanned);
            res.json({ success: true, message: `User ${isBanned ? 'banned' : 'unbanned'} successfully`, user: updated });
        } catch (e) {
            console.error('[NewopController] banUser error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateUser(req, res) {
        try {
            const updated = await NewopUserService.updateUserDetails(req.callerUid, req.body);
            res.json({ success: true, message: 'User updated successfully', user: updated });
        } catch (e) {
            console.error('[NewopController] updateUser error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async resetPhotos(req, res) {
        try {
            const { userId } = req.body || {};
            const updated = await NewopUserService.resetUserPhotos(req.callerUid, userId);
            res.json({ success: true, message: 'User photos reset successfully', user: updated });
        } catch (e) {
            console.error('[NewopController] resetPhotos error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getRooms(req, res) {
        try {
            const formatted = await NewopRoomService.getAllRooms(req.callerUid);
            res.json({ success: true, count: formatted.length, rooms: formatted });
        } catch (e) {
            console.error('[NewopController] getRooms error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getRoomInfo(req, res) {
        try {
            const roomObj = await NewopRoomService.getRoomInfo(req.callerUid, req.params.id);
            res.json({ success: true, room: roomObj });
        } catch (e) {
            console.error('[NewopController] getRoomInfo error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateRoom(req, res) {
        try {
            const updated = await NewopRoomService.updateRoomDetails(req.callerUid, req.body);
            res.json({ success: true, message: 'Room updated successfully', room: updated });
        } catch (e) {
            console.error('[NewopController] updateRoom error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async blockRoom(req, res) {
        try {
            const { roomId, isBlocked } = req.body || {};
            const updated = await NewopRoomService.blockOrUnblockRoom(req.callerUid, roomId, isBlocked);
            res.json({ success: true, message: `Room ${isBlocked ? 'blocked' : 'unblocked'} successfully`, room: updated });
        } catch (e) {
            console.error('[NewopController] blockRoom error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async resetRoomPhotos(req, res) {
        try {
            const { roomId } = req.body || {};
            const updated = await NewopRoomService.resetRoomPhotos(req.callerUid, roomId);
            res.json({ success: true, message: 'Room photos reset successfully', room: updated });
        } catch (e) {
            console.error('[NewopController] resetRoomPhotos error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getZegoConfig(req, res) {
        try {
            const NewopZegoService = require('../services/newopZegoService');
            const config = await NewopZegoService.getZegoConfig(req.callerUid);
            res.json({ success: true, config });
        } catch (e) {
            console.error('[NewopController] getZegoConfig error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateZegoConfig(req, res) {
        try {
            const NewopZegoService = require('../services/newopZegoService');
            const updatedConfig = await NewopZegoService.updateZegoConfig(req.callerUid, req.body);
            res.json({ success: true, message: 'ZEGO RTC config updated successfully', config: updatedConfig });
        } catch (e) {
            console.error('[NewopController] updateZegoConfig error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }
};

module.exports = NewopController;
