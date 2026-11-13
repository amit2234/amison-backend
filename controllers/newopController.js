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
            const { uid, password } = req.body || {};
            if (!uid) return res.status(400).json({ success: false, error: 'UID is required' });

            const cleanUid = String(uid).trim();
            const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(cleanUid);

            if (!isAuth) {
                return res.status(403).json({ success: false, error: 'Access denied: Unauthorized Newop Admin UID' });
            }

            if (password !== undefined && password !== null) {
                const isPassValid = await NewopAuthService.verifyAdminPassword(cleanUid, password);
                if (!isPassValid) {
                    return res.status(401).json({ success: false, error: 'Incorrect Master PIN.' });
                }
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
    },

    // Store Management Endpoints (100% Backend-Driven)
    async getStoreItems(req, res) {
        try {
            const NewopStoreService = require('../services/newopStoreService');
            const items = await NewopStoreService.getAllStoreItems(req.callerUid);
            res.json({ success: true, count: items.length, items });
        } catch (e) {
            console.error('[NewopController] getStoreItems error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async addStoreItem(req, res) {
        try {
            const NewopStoreService = require('../services/newopStoreService');
            const item = await NewopStoreService.addStoreItem(req.callerUid, req.body);
            res.json({ success: true, message: 'Store item added successfully', item });
        } catch (e) {
            console.error('[NewopController] addStoreItem error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async editStoreItem(req, res) {
        try {
            const NewopStoreService = require('../services/newopStoreService');
            const { itemId } = req.params;
            const item = await NewopStoreService.editStoreItem(req.callerUid, itemId || req.body.itemId, req.body);
            res.json({ success: true, message: 'Store item updated successfully', item });
        } catch (e) {
            console.error('[NewopController] editStoreItem error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async deleteStoreItem(req, res) {
        try {
            const NewopStoreService = require('../services/newopStoreService');
            const { itemId } = req.params;
            const item = await NewopStoreService.deleteStoreItem(req.callerUid, itemId || req.body.itemId);
            res.json({ success: true, message: 'Store item deleted/deactivated successfully', item });
        } catch (e) {
            console.error('[NewopController] deleteStoreItem error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async grantStoreItem(req, res) {
        try {
            const NewopStoreService = require('../services/newopStoreService');
            const result = await NewopStoreService.grantItemToUser(req.callerUid, req.body);
            res.json({ success: true, message: 'Item granted to user successfully', result });
        } catch (e) {
            console.error('[NewopController] grantStoreItem error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    // =========================================================================
    // DYNAMIC GIFT CONTROLLERS (100% PURE MONGODB + CLOUDINARY + REDIS + WS)
    // =========================================================================

    async getGifts(req, res) {
        try {
            const NewopGiftService = require('../services/newopGiftService');
            const gifts = await NewopGiftService.getAllGifts(req.callerUid);
            res.json({ success: true, count: gifts.length, gifts });
        } catch (e) {
            console.error('[NewopController] getGifts error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async getActiveGifts(req, res) {
        try {
            const NewopGiftService = require('../services/newopGiftService');
            const gifts = await NewopGiftService.getActiveGifts();
            res.json({ success: true, count: gifts.length, gifts });
        } catch (e) {
            console.error('[NewopController] getActiveGifts error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async addGift(req, res) {
        try {
            const NewopGiftService = require('../services/newopGiftService');
            const gift = await NewopGiftService.addGift(req.callerUid, req.body, req.files);
            res.json({ success: true, message: 'Gift published successfully', gift });
        } catch (e) {
            console.error('[NewopController] addGift error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async editGift(req, res) {
        try {
            const NewopGiftService = require('../services/newopGiftService');
            const { giftId } = req.params;
            const gift = await NewopGiftService.editGift(req.callerUid, giftId || req.body.giftId, req.body, req.files);
            res.json({ success: true, message: 'Gift updated successfully', gift });
        } catch (e) {
            console.error('[NewopController] editGift error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async deleteGift(req, res) {
        try {
            const NewopGiftService = require('../services/newopGiftService');
            const { giftId } = req.params;
            const gift = await NewopGiftService.deleteGift(req.callerUid, giftId || req.body.giftId);
            res.json({ success: true, message: 'Gift deleted successfully', gift });
        } catch (e) {
            console.error('[NewopController] deleteGift error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async clearAllGifts(req, res) {
        try {
            const NewopGiftService = require('../services/newopGiftService');
            const result = await NewopGiftService.clearAllGifts(req.callerUid);
            res.json({ success: true, message: 'All gifts deleted successfully', result });
        } catch (e) {
            console.error('[NewopController] clearAllGifts error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },


    // =========================================================================
    // EMOJI MANAGEMENT CONTROLLERS (100% PURE MONGODB + CLOUDINARY + REDIS + WS)
    // =========================================================================

    async getEmojis(req, res) {
        try {
            const NewopEmojiService = require('../services/newopEmojiService');
            const emojis = await NewopEmojiService.getAllEmojis(req.callerUid);
            res.json({ success: true, count: emojis.length, emojis });
        } catch (e) {
            console.error('[NewopController] getEmojis error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async addEmoji(req, res) {
        try {
            const NewopEmojiService = require('../services/newopEmojiService');
            const emoji = await NewopEmojiService.addEmoji(req.callerUid, req.body, req.files);
            res.json({ success: true, message: 'Emoji published successfully', emoji });
        } catch (e) {
            console.error('[NewopController] addEmoji error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async editEmoji(req, res) {
        try {
            const NewopEmojiService = require('../services/newopEmojiService');
            const { emojiId } = req.params;
            const emoji = await NewopEmojiService.editEmoji(req.callerUid, emojiId || req.body.emojiId, req.body, req.files);
            res.json({ success: true, message: 'Emoji updated successfully', emoji });
        } catch (e) {
            console.error('[NewopController] editEmoji error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    },

    async deleteEmoji(req, res) {
        try {
            const NewopEmojiService = require('../services/newopEmojiService');
            const { emojiId } = req.params;
            const emoji = await NewopEmojiService.deleteEmoji(req.callerUid, emojiId || req.body.emojiId);
            res.json({ success: true, message: 'Emoji deleted successfully', emoji });
        } catch (e) {
            console.error('[NewopController] deleteEmoji error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }
};

module.exports = NewopController;

