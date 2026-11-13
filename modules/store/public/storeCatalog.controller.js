const StoreItem = require('../../../models/StoreItem');
const storeCache = require('../store.cache');
const { normalizeCategory } = require('../store.constants');

/**
 * Public Store Catalog Controller
 * High-speed cached catalog delivery with version/delta support.
 */
const storeCatalogController = {
    /**
     * GET /api/store/version
     */
    async getVersion(req, res) {
        try {
            let cached = await storeCache.getCatalogCache();
            if (!cached) {
                cached = await storeCache.refreshCatalogCache(StoreItem);
            }
            return res.json({
                success: true,
                version: cached.version,
                count: cached.items.length
            });
        } catch (err) {
            console.error('❌ [StoreCatalogController] getVersion Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * GET /api/store/catalog or /api/store/items
     * Supports optional ?category=... and ?sinceVersion=...
     */
    async getCatalog(req, res) {
        try {
            const rawCategory = req.query.category;
            const normalizedCategory = normalizeCategory(rawCategory);
            const sinceVersion = Number(req.query.sinceVersion || 0) || 0;

            let cached = await storeCache.getCatalogCache(normalizedCategory);
            if (!cached) {
                const refreshed = await storeCache.refreshCatalogCache(StoreItem);
                const filteredItems = normalizedCategory
                    ? refreshed.items.filter(i => normalizeCategory(i.category) === normalizedCategory)
                    : refreshed.items;
                cached = {
                    items: filteredItems,
                    version: refreshed.version,
                    source: 'mongodb'
                };
            }

            if (sinceVersion > 0 && sinceVersion >= cached.version) {
                return res.json({
                    success: true,
                    notModified: true,
                    version: cached.version,
                    count: cached.items.length,
                    source: cached.source
                });
            }

            return res.json({
                success: true,
                version: cached.version,
                count: cached.items.length,
                items: cached.items,
                source: cached.source
            });
        } catch (err) {
            console.error('❌ [StoreCatalogController] Fetch Catalog Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = storeCatalogController;
