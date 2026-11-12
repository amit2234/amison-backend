const FrameUploadService = require('./frameUploadService');
const NewopStoreService = require('../../../services/newopStoreService');
const StoreItem = require('../../StoreItem');
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

            if (!mediaUrl && !iconEmoji) {
                return res.status(400).json({ success: false, error: 'Either mediaFile upload or mediaUrl/iconEmoji is required.' });
            }

            const createdItem = await NewopStoreService.createStoreItem({
                name: String(name).trim(),
                category: cleanCategory,
                price: price ? parseInt(price, 10) : 1000,
                iconEmoji: iconEmoji || '🎁',
                mediaUrl: mediaUrl,
                description: description || `${cleanCategory} item`,
                rarity: rarity || 'Epic',
                validityDays: validityDays ? parseInt(validityDays, 10) : 30,
                sortOrder: sortOrder ? parseInt(sortOrder, 10) : 0,
                isActive: isActive === undefined ? true : (isActive === 'true' || isActive === true)
            });

            return res.status(201).json({
                success: true,
                message: 'Store item created successfully in MongoDB Atlas.',
                item: createdItem
            });
        } catch (error) {
            console.error('❌ [newopStoreController] uploadAndCreateItem Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    /**
     * GET /api/newop/store/items
     * Returns full admin list of store items
     */
    async getStoreItems(req, res) {
        try {
            const category = req.query.category;
            const items = await NewopStoreService.getAllAdminItems(category);
            return res.json({ success: true, count: items.length, items });
        } catch (error) {
            console.error('❌ [newopStoreController] getStoreItems Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    /**
     * POST /api/newop/store/edit
     * Edits an existing store item
     */
    async editStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId || req.body.id;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required for editing.' });
            }

            const updatedItem = await NewopStoreService.updateStoreItem(itemId, req.body);
            if (!updatedItem) {
                return res.status(404).json({ success: false, error: 'Store item not found.' });
            }

            return res.json({
                success: true,
                message: 'Store item updated successfully.',
                item: updatedItem
            });
        } catch (error) {
            console.error('❌ [newopStoreController] editStoreItem Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    /**
     * POST /api/newop/store/toggle-active
     * Quick toggle for active/inactive state
     */
    async toggleActive(req, res) {
        try {
            const { itemId, isActive } = req.body;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required.' });
            }

            const updated = await NewopStoreService.toggleItemActive(itemId, isActive);
            if (!updated) {
                return res.status(404).json({ success: false, error: 'Store item not found.' });
            }

            return res.json({
                success: true,
                message: `Item status updated to ${updated.isActive ? 'ACTIVE' : 'INACTIVE'}.`,
                item: updated
            });
        } catch (error) {
            console.error('❌ [newopStoreController] toggleActive Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    /**
     * POST /api/newop/store/delete
     * Hard deletes store item
     */
    async deleteStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId || req.body.id;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required for deletion.' });
            }

            const deleted = await NewopStoreService.deleteStoreItem(itemId);
            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Store item not found or already deleted.' });
            }

            return res.json({
                success: true,
                message: `Store item ${itemId} deleted successfully.`
            });
        } catch (error) {
            console.error('❌ [newopStoreController] deleteStoreItem Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    /**
     * POST /api/newop/store/grant
     * Directly grants store item to a user
     */
    async grantStoreItem(req, res) {
        try {
            const { targetUserId, itemId, validityDays } = req.body;
            if (!targetUserId || !itemId) {
                return res.status(400).json({ success: false, error: 'targetUserId and itemId are required.' });
            }

            const days = validityDays ? parseInt(validityDays, 10) : 30;
            const granted = await NewopStoreService.grantItemToUser(targetUserId, itemId, days);

            return res.json({
                success: true,
                message: `Item ${itemId} granted to user ${targetUserId} for ${days} days.`,
                inventory: granted
            });
        } catch (error) {
            console.error('❌ [newopStoreController] grantStoreItem Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }
};

module.exports = newopStoreController;