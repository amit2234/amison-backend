const mongoose = require('mongoose');
const Gift = require('../models/Gift');
const GiftCategory = require('../models/GiftCategory');
const NewopAuthService = require('./newopAuthService');
const cacheService = require('./cacheService');
const {
    resolveAnimationType,
    processGiftMediaUploads,
    broadcastGiftCatalogUpdate
} = require('../utils/giftHelper');

const DEFAULT_BOOTSTRAP_CATEGORIES = [
    { categoryId: 'cat_popular', name: 'Popular', sortOrder: 0 },
    { categoryId: 'cat_luxury', name: 'Luxury', sortOrder: 1 },
    { categoryId: 'cat_lucky', name: 'Lucky', sortOrder: 2 }
];

async function verifyZeroTrustAdmin(callerUid) {
    if (!callerUid) throw new Error('Zero-Trust Security Error: callerUid is missing');
    const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
    if (!isAuth) throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
}

async function ensureBootstrapCategoriesIfEmpty() {
    const totalCount = await GiftCategory.countDocuments({});
    if (totalCount === 0) {
        try {
            await GiftCategory.insertMany(
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

async function fetchActiveCategoriesInternal() {
    await ensureBootstrapCategoriesIfEmpty();
    const docs = await GiftCategory.find({ isActive: true, isDeleted: { $ne: true } })
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean();
    return (docs || []).map((doc, idx) => ({
        categoryId: doc.categoryId,
        id: doc.categoryId,
        name: doc.name,
        sortOrder: Number.isFinite(doc.sortOrder) ? doc.sortOrder : idx
    }));
}

async function refreshAndBroadcast(action, gift) {
    await Promise.all([
        cacheService.invalidateGiftsCatalogCache(),
        cacheService.invalidateGiftCategoriesCache()
    ]);

    const [updatedCatalog, updatedCategories] = await Promise.all([
        Gift.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
        fetchActiveCategoriesInternal()
    ]);

    await Promise.all([
        cacheService.syncGiftsCatalogCache(updatedCatalog),
        cacheService.syncGiftCategoriesCache(updatedCategories)
    ]);

    broadcastGiftCatalogUpdate({
        action,
        gift: gift && gift.toObject ? gift.toObject() : gift,
        gifts: updatedCatalog,
        categories: updatedCategories
    });

    return { gifts: updatedCatalog, categories: updatedCategories };
}

const NewopGiftService = {
    async getAllGifts(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        return await Gift.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();
    },

    async getActiveGifts() {
        const cached = await cacheService.getCachedGiftsCatalog();
        if (cached && Array.isArray(cached) && cached.length > 0) {
            return cached;
        }

        const activeGifts = await Gift.find({ isActive: true })
            .sort({ sortOrder: 1, createdAt: -1 })
            .lean();

        if (activeGifts && activeGifts.length > 0) {
            await cacheService.syncGiftsCatalogCache(activeGifts);
        }
        return activeGifts || [];
    },

    async getActiveCategories() {
        const cached = await cacheService.getCachedGiftCategories();
        if (cached && Array.isArray(cached) && cached.length > 0) {
            return cached;
        }
        const categories = await fetchActiveCategoriesInternal();
        await cacheService.syncGiftCategoriesCache(categories);
        return categories;
    },

    async upsertCategory(callerUid, data = {}) {
        await verifyZeroTrustAdmin(callerUid);

        const cleanName = String(data.name || '').trim();
        if (!cleanName) throw new Error('Category name is required');

        await ensureBootstrapCategoriesIfEmpty();

        const targetId = data.categoryId ? String(data.categoryId).trim() : '';
        let existing = targetId
            ? await GiftCategory.findOne({ categoryId: targetId })
            : await GiftCategory.findOne({ name: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });

        if (existing) {
            const oldName = existing.name;
            existing.name = cleanName;
            existing.isActive = true;
            existing.isDeleted = false;
            if (data.sortOrder !== undefined) {
                existing.sortOrder = parseInt(data.sortOrder, 10) || 0;
            }
            await existing.save();

            // Keep existing gifts under renamed category linked seamlessly
            if (oldName && oldName !== cleanName) {
                await Gift.updateMany({ category: oldName }, { $set: { category: cleanName } }).catch(() => {});
            }
        } else {
            const count = await GiftCategory.countDocuments({ isDeleted: { $ne: true } });
            const newId = targetId || `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            existing = await GiftCategory.create({
                categoryId: newId,
                name: cleanName,
                sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : count,
                isActive: true,
                isDeleted: false,
                createdBy: callerUid
            });
        }

        const { categories } = await refreshAndBroadcast('categories_sync', null);
        return {
            category: {
                categoryId: existing.categoryId,
                id: existing.categoryId,
                name: existing.name,
                sortOrder: existing.sortOrder
            },
            categories
        };
    },

    async deleteCategory(callerUid, categoryId) {
        await verifyZeroTrustAdmin(callerUid);
        const cleanId = String(categoryId || '').trim();
        if (!cleanId) throw new Error('Target category ID is required');

        await ensureBootstrapCategoriesIfEmpty();
        await GiftCategory.updateOne(
            { $or: [{ categoryId: cleanId }, { name: cleanId }] },
            { $set: { isActive: false, isDeleted: true } }
        );

        const { categories } = await refreshAndBroadcast('categories_sync', null);
        return { deletedCategoryId: cleanId, categories };
    },

    async addGift(callerUid, data, files = {}) {
        await verifyZeroTrustAdmin(callerUid);

        const { name, coinPrice, category, iconUrl, animationUrl, animationType, sortOrder, isLucky, luckyMultiplierMax, description, isActive } = data || {};
        if (!name) throw new Error('Gift name is required');

        const finalGiftId = data.giftId ? String(data.giftId).trim() : `gf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const existingGift = await Gift.findOne({ giftId: finalGiftId });

        const { finalIconUrl, finalAnimUrl } = await processGiftMediaUploads(
            files,
            iconUrl || existingGift?.iconUrl || '',
            animationUrl || existingGift?.animationUrl || ''
        );
        const resolvedType = animationType || resolveAnimationType(finalAnimUrl, finalIconUrl);
        const resolvedCategory = category ? String(category).trim() : (existingGift?.category || 'Popular');

        // Auto-register category in GiftCategory if not marked deleted
        if (resolvedCategory) {
            const catExists = await GiftCategory.findOne({
                name: new RegExp(`^${resolvedCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
            });
            if (!catExists) {
                const count = await GiftCategory.countDocuments({ isDeleted: { $ne: true } });
                await GiftCategory.create({
                    categoryId: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    name: resolvedCategory,
                    sortOrder: count,
                    isActive: true,
                    isDeleted: false,
                    createdBy: callerUid
                }).catch(() => {});
            }
        }

        let savedGift;
        if (existingGift) {
            existingGift.name = String(name).trim();
            existingGift.coinPrice = Math.max(1, parseInt(coinPrice, 10) || existingGift.coinPrice || 100);
            existingGift.category = resolvedCategory;
            existingGift.iconUrl = finalIconUrl;
            existingGift.animationUrl = finalAnimUrl;
            existingGift.animationType = resolvedType;
            if (isActive !== undefined) existingGift.isActive = isActive === true || isActive === 'true';
            if (sortOrder !== undefined) existingGift.sortOrder = parseInt(sortOrder, 10) || 0;
            if (isLucky !== undefined) existingGift.isLucky = isLucky === true || isLucky === 'true';
            if (luckyMultiplierMax !== undefined) existingGift.luckyMultiplierMax = parseInt(luckyMultiplierMax, 10) || 1;
            if (description !== undefined) existingGift.description = String(description).trim();
            savedGift = await existingGift.save();
            await refreshAndBroadcast('update', savedGift);
        } else {
            savedGift = await Gift.create({
                giftId: finalGiftId,
                name: String(name).trim(),
                coinPrice: Math.max(1, parseInt(coinPrice, 10) || 100),
                category: resolvedCategory,
                iconUrl: finalIconUrl,
                animationUrl: finalAnimUrl,
                animationType: resolvedType,
                isActive: isActive === undefined ? true : (isActive === true || isActive === 'true'),
                sortOrder: parseInt(sortOrder, 10) || 0,
                isLucky: isLucky === true || isLucky === 'true',
                luckyMultiplierMax: parseInt(luckyMultiplierMax, 10) || 1,
                description: description ? String(description).trim() : '',
                createdBy: callerUid
            });
            await refreshAndBroadcast('create', savedGift);
        }

        return savedGift;
    },

    async editGift(callerUid, targetGiftId, data, files = {}) {
        await verifyZeroTrustAdmin(callerUid);

        const id = targetGiftId || data.giftId;
        if (!id) throw new Error('Target gift ID is required');

        const gift = await Gift.findOne({ $or: [{ giftId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }] });
        if (!gift) throw new Error(`Gift not found with id: ${id}`);

        if (data.name !== undefined) gift.name = String(data.name).trim();
        if (data.coinPrice !== undefined) gift.coinPrice = Math.max(1, parseInt(data.coinPrice, 10) || 100);
        if (data.category !== undefined) gift.category = String(data.category).trim();
        if (data.isActive !== undefined) gift.isActive = data.isActive === true || data.isActive === 'true';
        if (data.sortOrder !== undefined) gift.sortOrder = parseInt(data.sortOrder, 10) || 0;
        if (data.isLucky !== undefined) gift.isLucky = data.isLucky === true || data.isLucky === 'true';
        if (data.luckyMultiplierMax !== undefined) gift.luckyMultiplierMax = parseInt(data.luckyMultiplierMax, 10) || 1;
        if (data.description !== undefined) gift.description = String(data.description).trim();

        const { finalIconUrl, finalAnimUrl } = await processGiftMediaUploads(files, data.iconUrl || gift.iconUrl, data.animationUrl || gift.animationUrl);
        gift.iconUrl = finalIconUrl;
        gift.animationUrl = finalAnimUrl;
        gift.animationType = data.animationType || resolveAnimationType(gift.animationUrl, gift.iconUrl);

        await gift.save();
        await refreshAndBroadcast('update', gift);
        return gift;
    },

    async deleteGift(callerUid, targetGiftId) {
        await verifyZeroTrustAdmin(callerUid);

        if (!targetGiftId) throw new Error('Target gift ID is required');
        const gift = await Gift.findOne({ $or: [{ giftId: targetGiftId }, { _id: mongoose.isValidObjectId(targetGiftId) ? targetGiftId : null }] });
        if (gift) {
            await Gift.deleteOne({ _id: gift._id });
        }

        await refreshAndBroadcast('delete', { giftId: targetGiftId });
        return gift || { giftId: targetGiftId };
    },

    async clearAllGifts(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        await Gift.deleteMany({});
        await refreshAndBroadcast('clear', { gifts: [] });
        return { success: true, message: 'All gifts deleted permanently' };
    }
};

module.exports = NewopGiftService;