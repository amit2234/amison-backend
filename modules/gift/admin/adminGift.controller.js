const adminGiftService = require('./adminGift.service');
const giftMediaService = require('../gift.media.service');
const { parseBooleanFlag } = require('../gift.validation');

function resolveUploadedInput(req) {
    if (req.file && req.file.buffer) return req.file;
    if (Array.isArray(req.files) && req.files.length > 0) return req.files;
    if (req.files && typeof req.files === 'object') return req.files;
    return null;
}

const adminGiftController = {
    async getGifts(req, res) {
        try {
            const { gifts, categories } = await adminGiftService.getAllGifts(req.callerUid);
            return res.json({
                success: true,
                count: gifts.length,
                gifts,
                categories
            });
        } catch (err) {
            console.error('[AdminGiftController] getGifts error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async getActiveGifts(req, res) {
        try {
            const [gifts, categories] = await Promise.all([
                adminGiftService.getActiveGifts(),
                adminGiftService.getActiveCategories()
            ]);
            return res.json({
                success: true,
                count: gifts.length,
                gifts,
                categories
            });
        } catch (err) {
            console.error('[AdminGiftController] getActiveGifts error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async getActiveGiftCategories(req, res) {
        try {
            const categories = await adminGiftService.getActiveCategories();
            return res.json({ success: true, count: categories.length, categories });
        } catch (err) {
            console.error('[AdminGiftController] getActiveGiftCategories error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async upsertGiftCategory(req, res) {
        try {
            const result = await adminGiftService.upsertCategory(req.callerUid, req.body);
            return res.json({ success: true, ...result });
        } catch (err) {
            console.error('[AdminGiftController] upsertGiftCategory error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async deleteGiftCategory(req, res) {
        try {
            const categoryId = req.params.categoryId || req.body?.categoryId;
            const result = await adminGiftService.deleteCategory(req.callerUid, categoryId);
            return res.json({ success: true, ...result });
        } catch (err) {
            console.error('[AdminGiftController] deleteGiftCategory error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async uploadMediaOnly(req, res) {
        try {
            const file = giftMediaService.pickUploadedGiftFile(resolveUploadedInput(req));
            if (!file) {
                return res.status(400).json({ success: false, error: 'mediaFile upload is required.' });
            }
            const uploadRes = await giftMediaService.uploadGiftMediaBuffer(file.buffer, {
                originalname: file.originalname,
                category: req.body?.category || 'Popular',
                customName: req.body?.name
            });
            return res.json({ success: true, ...uploadRes });
        } catch (err) {
            console.error('[AdminGiftController] uploadMediaOnly error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async addGift(req, res) {
        try {
            const gift = await adminGiftService.addGift(req.callerUid, req.body, resolveUploadedInput(req));
            return res.status(201).json({
                success: true,
                message: 'Gift published successfully',
                gift
            });
        } catch (err) {
            console.error('[AdminGiftController] addGift error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async editGift(req, res) {
        try {
            const targetId = req.params.giftId || req.body.giftId || req.body.id;
            const gift = await adminGiftService.editGift(
                req.callerUid,
                targetId,
                req.body,
                resolveUploadedInput(req)
            );
            return res.json({
                success: true,
                message: 'Gift updated successfully',
                gift
            });
        } catch (err) {
            console.error('[AdminGiftController] editGift error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async toggleActive(req, res) {
        try {
            const targetId = req.params.giftId || req.body.giftId || req.body.id;
            const isActive = parseBooleanFlag(req.body.isActive, true);
            const gift = await adminGiftService.toggleGiftActive(req.callerUid, targetId, isActive);
            return res.json({
                success: true,
                message: `Gift status updated to ${gift.isActive ? 'Active' : 'Inactive'}`,
                gift
            });
        } catch (err) {
            console.error('[AdminGiftController] toggleActive error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async deleteGift(req, res) {
        try {
            const targetId = req.params.giftId || req.body.giftId || req.body.id;
            const gift = await adminGiftService.deleteGift(req.callerUid, targetId);
            return res.json({
                success: true,
                message: 'Gift deleted successfully',
                gift
            });
        } catch (err) {
            console.error('[AdminGiftController] deleteGift error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    async clearAllGifts(req, res) {
        try {
            const result = await adminGiftService.clearAllGifts(req.callerUid);
            return res.json({
                success: true,
                message: 'All gifts deleted successfully',
                result
            });
        } catch (err) {
            console.error('[AdminGiftController] clearAllGifts error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = adminGiftController;
