const NewopStoreService = require('../services/newopStoreService');
const { uploadBufferToCloudinary } = require('../services/cloudinaryService');

/**
 * Admin Store Controller (Newop Zero-Trust)
 * Handles administrative catalog management, media uploads, and item gifting
 */
const adminStoreController = {
    /**
     * GET /api/store/admin/items
     */
    async getAdminItems(req, res) {
        try {
            const items = await NewopStoreService.getAllStoreItems(req.callerUid);
            res.json({ success: true, count: items.length, items });
        } catch (err) {
            console.error("❌ [AdminStoreController] Fetch Items Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/admin/add
     */
    async addStoreItem(req, res) {
        try {
            const item = await NewopStoreService.addStoreItem(req.callerUid, req.body);
            res.json({ success: true, message: 'Store item added successfully', item });
        } catch (err) {
            console.error("❌ [AdminStoreController] Add Item Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * PUT or POST /api/store/admin/edit
     */
    async editStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId;
            const item = await NewopStoreService.editStoreItem(req.callerUid, itemId, req.body);
            res.json({ success: true, message: 'Store item updated successfully', item });
        } catch (err) {
            console.error("❌ [AdminStoreController] Edit Item Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * DELETE or POST /api/store/admin/delete
     */
    async deleteStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId;
            const item = await NewopStoreService.deleteStoreItem(req.callerUid, itemId);
            res.json({ success: true, message: 'Store item deactivated successfully', item });
        } catch (err) {
            console.error("❌ [AdminStoreController] Delete Item Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/admin/grant
     */
    async grantItemToUser(req, res) {
        try {
            const result = await NewopStoreService.grantItemToUser(req.callerUid, req.body);
            res.json({ success: true, message: 'Item granted to target user successfully', result });
        } catch (err) {
            console.error("❌ [AdminStoreController] Grant Item Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/admin/upload
     */
    async uploadStoreMedia(req, res) {
        try {
            const { name, category, price, rarity, validityDays, description, iconEmoji } = req.body;

            let mediaUrl = "";
            if (req.file) {
                const uploadResult = await uploadBufferToCloudinary(
                    req.file.buffer,
                    `amison/store/${category ? category.toLowerCase() : 'items'}`
                );
                mediaUrl = uploadResult.secure_url;
            } else if (req.body.mediaUrl) {
                mediaUrl = req.body.mediaUrl;
            }

            const item = await NewopStoreService.addStoreItem(req.callerUid, {
                name: name || "Custom Luxury Item",
                category: category || "Frames",
                price: Number(price) || 500,
                iconEmoji: iconEmoji || "✨",
                mediaUrl,
                rarity: rarity || "Epic",
                validityDays: Number(validityDays) || 30,
                description: description || ""
            });

            res.json({ success: true, item });
        } catch (err) {
            console.error("❌ [AdminStoreController Upload Error]:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = adminStoreController;