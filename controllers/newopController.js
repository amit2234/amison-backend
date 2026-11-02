const NewopAuthService = require('../services/newopAuthService');
const NewopUserService = require('../services/newopUserService');
const NewopRoomService = require('../services/newopRoomService');

/**
 * Zero-Trust Backend Middleware: Rejects any unauthorized request with HTTP 403 Forbidden.
 */
async function requireNewopAdmin(req, res, next) {
    try {
        const callerUid = req.headers['x-user-uid'] ||
            (req.headers['authorization'] && req.headers['authorization'].replace(/^Bearer\s+/i, '').trim()) ||
            req.body?.callerUid ||
            req.query?.callerUid;

        if (!callerUid) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: UID header missing. Newop is strictly locked from backend.'
            });
        }

        const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
        if (!isAuth) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: This user UID does not have backend permissions for Newop.'
            });
        }

        req.callerUid = String(callerUid).trim();
        next();
    } catch (e) {
        console.error('[Newop Auth] requireNewopAdmin error:', e);
        res.status(500).json({ success: false, error: 'Internal server authorization error' });
    }
}

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
            const formatted = await NewopUserService.getAllUsers();
            res.json({ success: true, count: formatted.length, users: formatted });
        } catch (e) {
            console.error('[NewopController] getUsers error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async banUser(req, res) {
        try {
            const { userId, uid, isBanned } = req.body;
            const updated = await NewopUserService.banOrUnbanUser(userId || uid, isBanned);
            res.json({ success: true, message: `User ${isBanned ? 'banned' : 'unbanned'} successfully`, user: updated });
        } catch (e) {
            console.error('[NewopController] banUser error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateUser(req, res) {
        try {
            const updated = await NewopUserService.updateUserDetails(req.body);
            res.json({ success: true, message: 'User updated successfully', user: updated });
        } catch (e) {
            console.error('[NewopController] updateUser error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async resetPhotos(req, res) {
        try {
            const { userId } = req.body;
            const updated = await NewopUserService.resetUserPhotos(userId);
            res.json({ success: true, message: 'User photos reset successfully', user: updated });
        } catch (e) {
            console.error('[NewopController] resetPhotos error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getRooms(req, res) {
        try {
            const formatted = await NewopRoomService.getAllRooms();
            res.json({ success: true, count: formatted.length, rooms: formatted });
        } catch (e) {
            console.error('[NewopController] getRooms error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getRoomInfo(req, res) {
        try {
            const roomObj = await NewopRoomService.getRoomInfo(req.params.id);
            res.json({ success: true, room: roomObj });
        } catch (e) {
            console.error('[NewopController] getRoomInfo error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async updateRoom(req, res) {
        try {
            const updated = await NewopRoomService.updateRoomDetails(req.body);
            res.json({ success: true, message: 'Room updated successfully', room: updated });
        } catch (e) {
            console.error('[NewopController] updateRoom error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async blockRoom(req, res) {
        try {
            const { roomId, isBlocked } = req.body;
            const updated = await NewopRoomService.blockOrUnblockRoom(roomId, isBlocked);
            res.json({ success: true, message: `Room ${isBlocked ? 'blocked' : 'unblocked'} successfully`, room: updated });
        } catch (e) {
            console.error('[NewopController] blockRoom error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async resetRoomPhotos(req, res) {
        try {
            const { roomId } = req.body;
            const updated = await NewopRoomService.resetRoomPhotos(roomId);
            res.json({ success: true, message: 'Room photos reset successfully', room: updated });
        } catch (e) {
            console.error('[NewopController] resetRoomPhotos error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }
};

module.exports = NewopController;