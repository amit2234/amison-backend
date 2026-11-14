const cacheService = require('../../services/cacheService');
const { DEFAULT_BOOTSTRAP_CATEGORIES } = require('./gift.constants');

let catalogVersion = Date.now();

function getCatalogVersion() {
    return catalogVersion;
}

async function ensureBootstrapCategoriesIfEmpty(GiftCategoryModel) {
    const totalCount = await GiftCategoryModel.countDocuments({});
    if (totalCount === 0) {
        try {
            await GiftCategoryModel.insertMany(
                DEFAULT_BOOTSTRAP_CATEGORIES.map((c) => ({
                    ...c,
                    isActive: true,
                    isDeleted: false,
                    createdBy: 'system'
                })),
                { ordered: false }
            );
        } catch (_) {}
    }
}

async function fetchActiveCategoriesFromDb(GiftCategoryModel) {
    await ensureBootstrapCategoriesIfEmpty(GiftCategoryModel);
    const docs = await GiftCategoryModel.find({ isActive: true, isDeleted: { $ne: true } })
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean();
    return (docs || []).map((doc, idx) => ({
        categoryId: doc.categoryId,
        id: doc.categoryId,
        name: doc.name,
        sortOrder: Number.isFinite(doc.sortOrder) ? doc.sortOrder : idx
    }));
}

async function getActiveGiftsCached(GiftModel) {
    const cached = await cacheService.getCachedGiftsCatalog();
    if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached.filter((g) => g && g.isActive !== false);
    }

    const activeGifts = await GiftModel.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

    if (activeGifts && activeGifts.length > 0) {
        await cacheService.syncGiftsCatalogCache(activeGifts);
    }
    return activeGifts || [];
}

async function getActiveCategoriesCached(GiftCategoryModel) {
    const cached = await cacheService.getCachedGiftCategories();
    if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
    }
    const categories = await fetchActiveCategoriesFromDb(GiftCategoryModel);
    await cacheService.syncGiftCategoriesCache(categories);
    return categories;
}

async function refreshGiftAndCategoryCache(GiftModel, GiftCategoryModel) {
    await Promise.all([
        cacheService.invalidateGiftsCatalogCache(),
        cacheService.invalidateGiftCategoriesCache()
    ]);

    const [updatedCatalog, updatedCategories] = await Promise.all([
        GiftModel.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
        fetchActiveCategoriesFromDb(GiftCategoryModel)
    ]);

    catalogVersion = Math.max(Date.now(), catalogVersion + 1);

    await Promise.all([
        cacheService.syncGiftsCatalogCache(updatedCatalog),
        cacheService.syncGiftCategoriesCache(updatedCategories)
    ]);

    return {
        version: catalogVersion,
        gifts: updatedCatalog,
        categories: updatedCategories
    };
}

module.exports = {
    getCatalogVersion,
    ensureBootstrapCategoriesIfEmpty,
    fetchActiveCategoriesFromDb,
    getActiveGiftsCached,
    getActiveCategoriesCached,
    refreshGiftAndCategoryCache
};
