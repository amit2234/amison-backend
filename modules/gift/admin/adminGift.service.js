const mongoose = require('mongoose');
const Gift = require('../../../models/Gift');
const GiftCategory = require('../../../models/GiftCategory');
const NewopAuthService = require('../../../services/newopAuthService');
const giftCache = require('../gift.cache');
const giftRealtime = require('../gift.realtime');
const giftMediaService = require('../gift.media.service');
const {
    generateUniqueGiftId,
    resolveMediaFormat,
    resolveAnimationType,
    sanitizeGiftPayload
} = require('../gift.validation');

async function verifyZeroTrustAdmin(callerUid) {
    if (!callerUid) {
        throw new Error('Zero-Trust Security Error: callerUid is missing');
    }
    const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
    if (!isAuth) {
        throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
    }
}

async function ensureCategoryExists(categoryName, callerUid = 'admin') {
    const cleanName = String(categoryName || '').trim();
    if (!cleanName) return;
    const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await GiftCategory.findOne({ name: new RegExp(`^${escaped}$`, 'i') });
    if (!existing) {
        const count = await GiftCategory.countDocuments({ isDeleted: { $ne: true } });
        await GiftCategory.create({
            categoryId: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: cleanName,
            sortOrder: count,
            isActive: true,
            isDeleted: false,
            createdBy: callerUid || 'admin'
        }).catch(() => {});
    }
}

async function refreshAndBroadcast(action, giftDoc = null) {
    const { gifts, categories, version } = await giftCache.refreshGiftAndCategoryCache(Gift, GiftCategory);
    const plainGift = giftDoc && typeof giftDoc.toObject === 'function' ? giftDoc.toObject() : giftDoc;

    giftRealtime.broadcastGiftCatalogUpdate({
        action,
        version,
        gift: plainGift,
        gifts,
        categories
    });

    return { gifts, categories, version };
}

const adminGiftService = {
    /**
     * Fetch ALL gifts (both Active and Inactive) for Newop Gift Admin.
     */
    async getAllGifts(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        const [gifts, categories] = await Promise.all([
            Gift.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
            giftCache.getActiveCategoriesCached(GiftCategory)
        ]);
        return { gifts, categories };
    },

    async getActiveGifts() {
        return await giftCache.getActiveGiftsCached(Gift);
    },

    async getActiveCategories() {
        return await giftCache.getActiveCategoriesCached(GiftCategory);
    },

    async upsertCategory(callerUid, data = {}) {
        await verifyZeroTrustAdmin(callerUid);
        const cleanName = String(data.name || '').trim();
        if (!cleanName) {
            throw new Error('Category name is required');
        }

        await giftCache.ensureBootstrapCategoriesIfEmpty(GiftCategory);

        const targetId = data.categoryId ? String(data.categoryId).trim() : '';
        const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let existing = targetId
            ? await GiftCategory.findOne({ categoryId: targetId })
            : await GiftCategory.findOne({ name: new RegExp(`^${escaped}$`, 'i') });

        if (existing) {
            const oldName = existing.name;
            existing.name = cleanName;
            existing.isActive = true;
            existing.isDeleted = false;
            if (data.sortOrder !== undefined) {
                existing.sortOrder = parseInt(data.sortOrder, 10) || 0;
            }
            await existing.save();

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
        if (!cleanId) {
            throw new Error('Target category ID is required');
        }

        await giftCache.ensureBootstrapCategoriesIfEmpty(GiftCategory);
        await GiftCategory.updateOne(
            { $or: [{ categoryId: cleanId }, { name: cleanId }] },
            { $set: { isActive: false, isDeleted: true } }
        );

        const { categories } = await refreshAndBroadcast('categories_sync', null);
        return { deletedCategoryId: cleanId, categories };
    },

    /**
     * Create or update a Gift with optional single-file multipart upload (SVGA, SVG, GIF).
     * Uses the exact uploaded file as both iconUrl and animationUrl (no separate thumbnail).
     */
    async addGift(callerUid, rawData = {}, uploadedFiles = null) {
        await verifyZeroTrustAdmin(callerUid);

        const clean = sanitizeGiftPayload(rawData);
        if (!clean.name) {
            throw new Error('Gift name is required');
        }

        const finalGiftId = clean.giftId || generateUniqueGiftId();
        const existingGift = await Gift.findOne({ giftId: finalGiftId });
        const resolvedCategory = clean.category || existingGift?.category || 'Popular';

        await ensureCategoryExists(resolvedCategory, callerUid);

        let finalMediaUrl = clean.animationUrl || clean.iconUrl || existingGift?.animationUrl || existingGift?.iconUrl || '';
        let finalMediaFormat = clean.mediaFormat && clean.mediaFormat !== 'NONE'
            ? clean.mediaFormat
            : resolveMediaFormat(rawData.mediaFormat, finalMediaUrl);
        let finalAnimType = clean.animationType || resolveAnimationType(finalMediaUrl, finalMediaUrl, finalMediaFormat);

        const uploadedFile = giftMediaService.pickUploadedGiftFile(uploadedFiles);
        if (uploadedFile) {
            const uploadRes = await giftMediaService.uploadGiftMediaBuffer(uploadedFile.buffer, {
                originalname: uploadedFile.originalname,
                category: resolvedCategory,
                customName: clean.name
            });
            finalMediaUrl = uploadRes.mediaUrl;
            finalMediaFormat = uploadRes.mediaFormat;
            finalAnimType = uploadRes.animationType;
        }

        if (!finalMediaUrl) {
            throw new Error('Gift media file (SVGA, SVG, or GIF) is required');
        }

        let savedGift;
        if (existingGift) {
            existingGift.name = clean.name;
            existingGift.coinPrice = clean.coinPrice !== undefined ? clean.coinPrice : (existingGift.coinPrice || 100);
            existingGift.category = resolvedCategory;
            existingGift.iconUrl = finalMediaUrl;
            existingGift.animationUrl = finalMediaUrl;
            existingGift.mediaFormat = finalMediaFormat;
            existingGift.animationType = finalAnimType;
            existingGift.isBroadcast = false; // Broadcast feature is locked for future release
            if (clean.isActive !== undefined) existingGift.isActive = clean.isActive;
            if (clean.sortOrder !== undefined) existingGift.sortOrder = clean.sortOrder;
            if (clean.isLucky !== undefined) existingGift.isLucky = clean.isLucky;
            if (clean.luckyMultiplierMax !== undefined) existingGift.luckyMultiplierMax = clean.luckyMultiplierMax;
            if (clean.description !== undefined) existingGift.description = clean.description;
            savedGift = await existingGift.save();
            await refreshAndBroadcast('update', savedGift);
        } else {
            savedGift = await Gift.create({
                giftId: finalGiftId,
                name: clean.name,
                coinPrice: clean.coinPrice !== undefined ? clean.coinPrice : 100,
                category: resolvedCategory,
                iconEmoji: clean.iconEmoji || '🎁',
                iconUrl: finalMediaUrl,
                animationUrl: finalMediaUrl,
                mediaFormat: finalMediaFormat,
                animationType: finalAnimType,
                isBroadcast: false, // Locked future option
                isActive: clean.isActive !== undefined ? clean.isActive : true,
                sortOrder: clean.sortOrder !== undefined ? clean.sortOrder : 0,
                isLucky: clean.isLucky !== undefined ? clean.isLucky : resolvedCategory.toLowerCase().includes('lucky'),
                luckyMultiplierMax: clean.luckyMultiplierMax !== undefined ? clean.luckyMultiplierMax : 1,
                description: clean.description || '',
                createdBy: callerUid
            });
            await refreshAndBroadcast('create', savedGift);
        }

        return savedGift;
    },

    async editGift(callerUid, targetGiftId, rawData = {}, uploadedFiles = null, options = {}) {
        await verifyZeroTrustAdmin(callerUid);

        const id = String(targetGiftId || rawData.giftId || '').trim();
        if (!id) {
            throw new Error('Target gift ID is required');
        }

        const gift = await Gift.findOne({
            $or: [{ giftId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }]
        });
        if (!gift) {
            throw new Error(`Gift not found with id: ${id}`);
        }

        const clean = sanitizeGiftPayload(rawData);
        if (clean.name !== undefined && clean.name.length > 0) gift.name = clean.name;
        if (clean.coinPrice !== undefined) gift.coinPrice = clean.coinPrice;
        if (clean.category !== undefined && clean.category.length > 0) {
            gift.category = clean.category;
            await ensureCategoryExists(clean.category, callerUid);
        }
        if (clean.isActive !== undefined) gift.isActive = clean.isActive;
        if (clean.sortOrder !== undefined) gift.sortOrder = clean.sortOrder;
        if (clean.isLucky !== undefined) gift.isLucky = clean.isLucky;
        if (clean.luckyMultiplierMax !== undefined) gift.luckyMultiplierMax = clean.luckyMultiplierMax;
        if (clean.description !== undefined) gift.description = clean.description;
        gift.isBroadcast = false;

        const uploadedFile = giftMediaService.pickUploadedGiftFile(uploadedFiles);
        if (uploadedFile) {
            const uploadRes = await giftMediaService.uploadGiftMediaBuffer(uploadedFile.buffer, {
                originalname: uploadedFile.originalname,
                category: gift.category || 'Popular',
                customName: gift.name || id
            });
            gift.iconUrl = uploadRes.mediaUrl;
            gift.animationUrl = uploadRes.mediaUrl;
            gift.mediaFormat = uploadRes.mediaFormat;
            gift.animationType = uploadRes.animationType;
        } else if (clean.animationUrl || clean.iconUrl) {
            const nextUrl = clean.animationUrl || clean.iconUrl;
            gift.iconUrl = nextUrl;
            gift.animationUrl = nextUrl;
            gift.mediaFormat = clean.mediaFormat && clean.mediaFormat !== 'NONE'
                ? clean.mediaFormat
                : resolveMediaFormat(rawData.mediaFormat, nextUrl);
            gift.animationType = clean.animationType || resolveAnimationType(nextUrl, nextUrl, gift.mediaFormat);
        }

        await gift.save();
        await refreshAndBroadcast(options.broadcastAction || 'update', gift);
        return gift;
    },

    async toggleGiftActive(callerUid, targetGiftId, isActive) {
        return await adminGiftService.editGift(
            callerUid,
            targetGiftId,
            { isActive },
            null,
            { broadcastAction: 'toggle' }
        );
    },

    async deleteGift(callerUid, targetGiftId) {
        await verifyZeroTrustAdmin(callerUid);

        const cleanId = String(targetGiftId || '').trim();
        if (!cleanId) {
            throw new Error('Target gift ID is required');
        }

        const gift = await Gift.findOne({
            $or: [{ giftId: cleanId }, { _id: mongoose.isValidObjectId(cleanId) ? cleanId : null }]
        });
        if (gift) {
            await Gift.deleteOne({ _id: gift._id });
        }

        await refreshAndBroadcast('delete', { giftId: cleanId });
        return gift || { giftId: cleanId, deleted: true };
    },

    async clearAllGifts(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        await Gift.deleteMany({});
        await refreshAndBroadcast('clear', { gifts: [] });
        return { success: true, message: 'All gifts deleted permanently' };
    }
};

module.exports = adminGiftService;
