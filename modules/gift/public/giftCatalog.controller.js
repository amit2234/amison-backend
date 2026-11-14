const Gift = require('../../../models/Gift');
const GiftCategory = require('../../../models/GiftCategory');
const giftCache = require('../gift.cache');

const giftCatalogController = {
    /**
     * GET /api/gifts/active
     * Returns only active gifts (`isActive: true`) and active non-deleted categories for the Room Gift Popup.
     */
    async getActiveGifts(req, res) {
        try {
            const [gifts, categories] = await Promise.all([
                giftCache.getActiveGiftsCached(Gift),
                giftCache.getActiveCategoriesCached(GiftCategory)
            ]);
            return res.json({
                success: true,
                version: giftCache.getCatalogVersion(),
                count: gifts.length,
                gifts,
                categories
            });
        } catch (err) {
            console.error('[GiftCatalogController] getActiveGifts error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * GET /api/gifts/categories
     */
    async getActiveCategories(req, res) {
        try {
            const categories = await giftCache.getActiveCategoriesCached(GiftCategory);
            return res.json({
                success: true,
                version: giftCache.getCatalogVersion(),
                count: categories.length,
                categories
            });
        } catch (err) {
            console.error('[GiftCatalogController] getActiveCategories error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = giftCatalogController;
