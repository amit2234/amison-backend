const adminStoreService = require('./adminStore.service');
const storeMediaService = require('../store.media.service');
const { normalizeCategory } = require('../store.constants');
const { parseBooleanFlag } = require('../store.validation');
const { getCategoryHandler } = require('../categories/categoryRegistry');

function extractUploadedFile(req) {
    if (req.file && req.file.buffer) return req.file;
    if (Array.isArray(req.files) && req.files.length > 0 && req.files[0].buffer) {
        return req.files[0];
    }
    return null;
}

/**
 * Unified Enterprise Admin Store Controller
 * Handles administrative catalog management, multipart SVGA/SVG/PAG/PNG uploads,
 * quick ON/OFF toggles, edits, deletions, and user item grants.
 */
const adminStoreController = {
    /**
     * POST /api/newop/store/upload-media
     */
    async uploadMediaOnly(req, res) {
        try {
            const uploadedFile = extractUploadedFile(req);
            if (!uploadedFile) {
                return res.status(400).json({ success: false, error: 'mediaFile upload is required.' });
            }
            const cleanCategory = normalizeCategory(req.body.category, 'Frames');
            const customName = req.body.name ? String(req.body.name).trim() : undefined;
            const uploadRes = await storeMediaService.uploadStoreMediaBuffer(uploadedFile.buffer, {
                originalname: uploadedFile.originalname,
                category: cleanCategory,
                customName
            });

            return res.json({
                success: true,
                mediaUrl: uploadRes.mediaUrl,
                thumbnailUrl: uploadRes.thumbnailUrl,
                mediaFormat: uploadRes.mediaFormat,
                detectedExt: uploadRes.detectedExt,
                resourceType: uploadRes.resourceType
            });
        } catch (err) {
            console.error('❌ [AdminStoreController] uploadMediaOnly Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/newop/store/upload or /api/newop/store/add
     */
    async uploadAndCreateItem(req, res) {
        try {
            const { name, category, price, iconEmoji, rarity, validityDays, description, sortOrder, isActive, currencyType } = req.body;

            if (!name || String(name).trim().length === 0) {
                return res.status(400).json({ success: false, error: 'Item name is required.' });
            }

            const cleanCategory = normalizeCategory(category, 'Frames');
            const handler = getCategoryHandler(cleanCategory);

            let mediaUrl = req.body.mediaUrl ? String(req.body.mediaUrl).trim() : '';
            let thumbnailUrl = req.body.thumbnailUrl ? String(req.body.thumbnailUrl).trim() : '';
            let mediaFormat = req.body.mediaFormat ? String(req.body.mediaFormat).trim() : undefined;

            const uploadedFile = extractUploadedFile(req);
            if (uploadedFile) {
                const uploadRes = await storeMediaService.uploadStoreMediaBuffer(uploadedFile.buffer, {
                    originalname: uploadedFile.originalname,
                    category: cleanCategory,
                    customName: name
                });
                mediaUrl = uploadRes.mediaUrl;
                thumbnailUrl = thumbnailUrl || uploadRes.thumbnailUrl;
                mediaFormat = uploadRes.mediaFormat;
            }

            if (!mediaUrl && !iconEmoji) {
                return res.status(400).json({
                    success: false,
                    error: 'Media file (SVGA/SVG/GIF/PNG) or mediaUrl is required.'
                });
            }

            const createdItem = await adminStoreService.addStoreItem(req.callerUid, {
                ...req.body,
                category: cleanCategory,
                name: String(name).trim(),
                price: price !== undefined ? Math.max(0, Number(price) || 0) : 0,
                iconEmoji: iconEmoji || handler.defaultEmoji,
                mediaUrl,
                thumbnailUrl,
                mediaFormat,
                currencyType,
                rarity: rarity || 'Epic',
                validityDays: validityDays !== undefined ? Number(validityDays) : 30,
                description: description || '',
                sortOrder: sortOrder !== undefined ? Number(sortOrder) : 10,
                isActive: parseBooleanFlag(isActive, true)
            });

            console.log(`✅ [AdminStoreController] Created item: ${createdItem.name} (${createdItem.itemId}, format=${createdItem.mediaFormat})`);
            return res.status(201).json({
                success: true,
                message: `Store item '${createdItem.name}' successfully uploaded and published!`,
                item: createdItem
            });
        } catch (err) {
            console.error('❌ [AdminStoreController] uploadAndCreateItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * GET /api/newop/store/items
     */
    async getStoreItems(req, res) {
        try {
            const categoryFilter = req.query.category ? String(req.query.category).trim() : '';
            const items = await adminStoreService.getAllStoreItems(req.callerUid, categoryFilter);
            return res.json({ success: true, count: items.length, items });
        } catch (err) {
            console.error('❌ [AdminStoreController] getStoreItems Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST or PUT /api/newop/store/edit
     */
    async editStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId || req.body.id;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required for editing.' });
            }

            const updatePayload = { ...req.body };
            if (updatePayload.isActive !== undefined) {
                updatePayload.isActive = parseBooleanFlag(updatePayload.isActive, true);
            }

            const uploadedFile = extractUploadedFile(req);
            if (uploadedFile) {
                const cleanCategory = normalizeCategory(updatePayload.category, 'Frames');
                const uploadRes = await storeMediaService.uploadStoreMediaBuffer(uploadedFile.buffer, {
                    originalname: uploadedFile.originalname,
                    category: cleanCategory,
                    customName: updatePayload.name || itemId
                });
                updatePayload.mediaUrl = uploadRes.mediaUrl;
                updatePayload.thumbnailUrl = uploadRes.thumbnailUrl;
                updatePayload.mediaFormat = uploadRes.mediaFormat;
            }

            const updated = await adminStoreService.editStoreItem(req.callerUid, itemId, updatePayload);
            return res.json({ success: true, message: 'Store item updated successfully', item: updated });
        } catch (err) {
            console.error('❌ [AdminStoreController] editStoreItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/newop/store/toggle-active
     */
    async toggleActive(req, res) {
        try {
            const { itemId, isActive } = req.body;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required' });
            }
            const parsedActive = parseBooleanFlag(isActive, true);
            const updated = await adminStoreService.toggleStoreItemActive(req.callerUid, itemId, parsedActive);
            return res.json({
                success: true,
                message: `Item status updated to ${updated.isActive ? 'Active' : 'Inactive'}`,
                item: updated
            });
        } catch (err) {
            console.error('❌ [AdminStoreController] toggleActive Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST or DELETE /api/newop/store/delete
     */
    async deleteStoreItem(req, res) {
        try {
            const itemId = req.params.itemId || req.body.itemId || req.body.id;
            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required for deletion.' });
            }
            const deleted = await adminStoreService.deleteStoreItem(req.callerUid, itemId);
            return res.json({ success: true, message: 'Store item deleted successfully', item: deleted });
        } catch (err) {
            console.error('❌ [AdminStoreController] deleteStoreItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/newop/store/grant
     */
    async grantStoreItem(req, res) {
        try {
            const result = await adminStoreService.grantItemToUser(req.callerUid, req.body);
            return res.json({ success: true, message: 'Item granted to target user successfully', result });
        } catch (err) {
            console.error('❌ [AdminStoreController] grantStoreItem Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = adminStoreController;
