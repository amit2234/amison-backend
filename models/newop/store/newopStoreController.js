const FrameUploadService = require('./frameUploadService');
const NewopStoreService = require('../../../services/newopStoreService');
const StoreItem = require('../../../models/StoreItem');
const cacheService = require('../../../services/cacheService');

/**
 * Enterprise Modular Newop Store Controller
 * Handles administrative catalog management, frame multipart uploads, toggles, and user item grants.
 */
const newopStoreController = {
    /**
     * POST /api/newop/store/upload
     * Multipart endpoint: receives mediaFile from Android/Admin, uploads via FrameUploadService,
     * and saves directly to MongoDB Atlas store_items collection.
     */
    async uploadAndCreateItem(req, res) {
        try {
            const { name, category, price, iconEmoji, rarity, validityDays, description, sortOrder, isActive } = req.body;

            if (!name || String(name).trim().length === 0) {
                return res.status(400).json({ success: false, error: 'Item name is required.' });
            }

            const cleanCategory = category ? String(category).trim() : 'Frames';
            let mediaUrl = req.body.mediaUrl ? String(req.body.mediaUrl).trim() : '';

            // If a file was uploaded via Multer (SVGA, SVG, GIF, PNG)
            if (req.file && req.file.buffer) {
                const uploadRes = await FrameUploadService.uploadFrameMedia(req.file.buffer, {
                    originalname: req.file.originalname,
                    category: cleanCategory,
                    customName: name
                });
                mediaUrl = uploadRes.mediaUrl;
            }

            if (!mediaUrl) {
                return res.status(400).json({ success: false, error: 'Media file (SVGA/SVG/GIF/PNG) or mediaUrl is required.' });
            }

            // Generate clean unique ID if not passed
            const prefix = cleanCategory.substring(0, 2).toLowerCase();
            const randomSuffix = Math.random().toString(36).substring(2, 8);
            const itemId = req.body.itemId || `${prefix}_${randomSuffix}`;

            // Save to MongoDB Atlas via NewopStoreService
            const createdItem = await NewopStoreService.addStoreItem(req.callerUid, {
                itemId,
                category: cleanCategory,
                name: String(name).trim(),
                price: Math.max(0, Number(price) || 0),
                iconEmoji: iconEmoji || (cleanCategory === 'Frames' ? '👑' : '✨'),
                mediaUrl,
                rarity: rarity || 'Epic',
                validityDays: validityDays !== undefined ? Number(validityDays) : 30,
                description: description || '',
                sortOrder: sortOrder !== undefined ? Number(sortOrder) : 10,
                isActive: isActive !== undefined ? (String(isActive) === 'true' || isActive === true) : true
            });

            console.log(`✅ [NewopStoreController] Created new store item: ${createdItem.name} (${createdItem.itemId})`);
            return res.json({
                success: true,
                message: `Store item '${createdItem.name}' successfully uploaded and saved!`,
                item: createdItem
            });
        } catch (err) {
            console.error('❌ [NewopStoreController] uploadAndCreateItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * GET /api/newop/store/items
     */
    async getStoreItems(req, res) {
        try {
            const items = await NewopStoreService.getAllStoreItems(req.callerUid);
            return res.json({ success: true, count: items.length, items });
        } catch (err) {
            console.error('❌ [NewopStoreController] getStoreItems Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST or PUT /api/newop/store/edit
     */
    async editStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId;
            const updated = await NewopStoreService.editStoreItem(req.callerUid, itemId, req.body);
            return res.json({ success: true, message: 'Store item updated successfully', item: updated });
        } catch (err) {
            console.error('❌ [NewopStoreController] editStoreItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/newop/store/toggle-active
     * Quick toggle for enabling/disabling item visibility in Me Store
     */
    async toggleActive(req, res) {
        try {
            const { itemId, isActive } = req.body;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required' });
            }
            const updated = await NewopStoreService.editStoreItem(req.callerUid, itemId, {
                isActive: !!isActive
            });
            return res.json({
                success: true,
                message: `Item status updated to ${updated.isActive ? 'Active' : 'Inactive'}`,
                item: updated
            });
        } catch (err) {
            console.error('❌ [NewopStoreController] toggleActive Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST or DELETE /api/newop/store/delete
     */
    async deleteStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId;
            const deleted = await NewopStoreService.deleteStoreItem(req.callerUid, itemId);
            return res.json({ success: true, message: 'Store item deleted successfully', item: deleted });
        } catch (err) {
            console.error('❌ [NewopStoreController] deleteStoreItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/newop/store/grant
     */
    async grantStoreItem(req, res) {
        try {
            const result = await NewopStoreService.grantItemToUser(req.callerUid, req.body);
            return res.json({ success: true, message: 'Item granted to target user successfully', result });
        } catch (err) {
            console.error('❌ [NewopStoreController] grantStoreItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = newopStoreController;