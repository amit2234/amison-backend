const mongoose = require('mongoose');
const Gift = require('../models/Gift');
const NewopAuthService = require('./newopAuthService');
const cacheService = require('./cacheService');
const {
    resolveAnimationType,
    processGiftMediaUploads,
    broadcastGiftCatalogUpdate
} = require('../utils/giftHelper');

async function verifyZeroTrustAdmin(callerUid) {
    if (!callerUid) throw new Error('Zero-Trust Security Error: callerUid is missing');
    const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
    if (!isAuth) throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
}

async function refreshAndBroadcast(action, gift) {
    await cacheService.invalidateGiftsCatalogCache();
    const updatedCatalog = await Gift.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    await cacheService.syncGiftsCatalogCache(updatedCatalog);
    broadcastGiftCatalogUpdate({
        action,
        gift: gift && gift.toObject ? gift.toObject() : gift,
        gifts: updatedCatalog
    });
    return updatedCatalog;
}

const NewopGiftService = {
    /**
     * Fetch all gifts for admin panel management (both active and inactive)
     */
    async getAllGifts(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        return await Gift.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();
    },

    /**
     * Fetch active gifts catalog (Fast <2ms via Redis/RAM cache with MongoDB fallback)
     * 100% Dynamic from MongoDB - Zero hardcoded gifts
     */
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

    /**
     * Add a new dynamic Gift to MongoDB & Cloudinary
     */
    async addGift(callerUid, data, files = {}) {
        await verifyZeroTrustAdmin(callerUid);

        const { name, coinPrice, category, iconUrl, animationUrl, animationType, sortOrder, isLucky, luckyMultiplierMax, description } = data || {};
        if (!name) throw new Error('Gift name is required');

        const { finalIconUrl, finalAnimUrl } = await processGiftMediaUploads(files, iconUrl, animationUrl);
        const resolvedType = animationType || resolveAnimationType(finalAnimUrl, finalIconUrl);

        const finalGiftId = data.giftId ? String(data.giftId).trim() : `gf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        const newGift = await Gift.create({
            giftId: finalGiftId,
            name: String(name).trim(),
            coinPrice: Math.max(1, parseInt(coinPrice, 10) || 100),
            category: category ? String(category).trim() : 'Popular',
            iconUrl: finalIconUrl,
            animationUrl: finalAnimUrl,
            animationType: resolvedType,
            isActive: true,
            sortOrder: parseInt(sortOrder, 10) || 0,
            isLucky: isLucky === true || isLucky === 'true',
            luckyMultiplierMax: parseInt(luckyMultiplierMax, 10) || 1,
            description: description ? String(description).trim() : '',
            createdBy: callerUid
        });

        await refreshAndBroadcast('create', newGift);
        return newGift;
    },

    /**
     * Edit existing Gift
     */
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

    /**
     * Delete or Deactivate Gift
     */
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

    /**
     * Clear / Delete ALL gifts catalog from MongoDB
     */
    async clearAllGifts(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        await Gift.deleteMany({});
        await refreshAndBroadcast('clear', { gifts: [] });
        return { success: true, message: 'All gifts deleted permanently' };
    }
};


module.exports = NewopGiftService;