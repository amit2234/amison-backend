const mongoose = require('mongoose');
const Gift = require('../models/Gift');
const NewopAuthService = require('./newopAuthService');
const cacheService = require('./cacheService');
const { uploadBufferToCloudinary } = require('./cloudinaryService');

async function verifyZeroTrustAdmin(callerUid) {
    if (!callerUid) {
        throw new Error('Zero-Trust Security Error: callerUid is missing');
    }
    const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
    if (!isAuth) {
        throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
    }
}

function resolveAnimationType(animUrl, iconUrl) {
    const combined = `${animUrl || ''} ${iconUrl || ''}`.toLowerCase();
    if (combined.includes('.svga')) return 'SVGA_ANIMATION';
    if (combined.includes('.gif')) return 'GIF_ANIMATION';
    if (combined.includes('.svg')) return 'SVG_ANIMATION';
    return 'CUSTOM_MEDIA';
}

function notifyWebSocketClients(payload) {
    try {
        const setupRoomSocket = require('../sockets/roomSocket');
        if (typeof setupRoomSocket.broadcastGiftCatalogSync === 'function') {
            setupRoomSocket.broadcastGiftCatalogSync(payload);
        }
    } catch (e) {
        console.warn('[NewopGiftService] WebSocket broadcast skipped:', e.message);
    }
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
     */
    async getActiveGifts() {
        const cached = await cacheService.getCachedGiftsCatalog();
        if (cached && Array.isArray(cached) && cached.length > 0) {
            return cached;
        }

        let activeGifts = await Gift.find({ isActive: true })
            .sort({ sortOrder: 1, createdAt: -1 })
            .lean();

        if (!activeGifts || activeGifts.length === 0) {
            const defaultGifts = [
                { giftId: 'golden_rose', name: 'Golden Rose', coinPrice: 1000, category: 'Popular', iconEmoji: '🌹', animationType: 'SVGA_ANIMATION', sortOrder: 1, isActive: true },
                { giftId: 'love_fireworks', name: 'Galaxy Fireworks', coinPrice: 5000, category: 'Popular', iconEmoji: '🎆', animationType: 'SVGA_ANIMATION', sortOrder: 2, isActive: true },
                { giftId: 'monsoon', name: 'Monsoon Love', coinPrice: 50000, category: 'Popular', iconEmoji: '🌧️', animationType: 'SVGA_ANIMATION', sortOrder: 3, isActive: true },
                { giftId: 'sports_car', name: 'Supercar Ferrari', coinPrice: 80000, category: 'Luxury', iconEmoji: '🏎️', animationType: 'SVGA_ANIMATION', sortOrder: 4, isActive: true },
                { giftId: 'cruise_ship_in', name: 'Luxury Ocean Yacht', coinPrice: 100000, category: 'Luxury', iconEmoji: '🚢', animationType: 'SVGA_ANIMATION', sortOrder: 5, isActive: true },
                { giftId: 'magic_castle', name: 'Royal Magic Castle', coinPrice: 120000, category: 'Luxury', iconEmoji: '🏰', animationType: 'SVGA_ANIMATION', sortOrder: 6, isActive: true },
                { giftId: 'galaxy_dragon', name: 'Mythic Fire Dragon', coinPrice: 200000, category: 'Exclusive', iconEmoji: '🐉', animationType: 'SVGA_ANIMATION', sortOrder: 7, isActive: true },
                { giftId: 'diamond_crown', name: 'Crown Royale', coinPrice: 10000, category: 'Exclusive', iconEmoji: '👑', animationType: 'SVGA_ANIMATION', sortOrder: 8, isActive: true },
                { giftId: 'lucky_star', name: 'Lucky Star', coinPrice: 200, category: 'Lucky', iconEmoji: '⭐', animationType: 'SVGA_ANIMATION', sortOrder: 9, isActive: true, isLucky: true, luckyMultiplierMax: 500 }
            ];
            try {
                await Gift.insertMany(defaultGifts, { ordered: false });
                activeGifts = await Gift.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
            } catch (seedErr) {
                console.warn('[NewopGiftService] Starter gifts seed skipped:', seedErr.message);
                activeGifts = defaultGifts;
            }
        }

        await cacheService.syncGiftsCatalogCache(activeGifts);
        return activeGifts;
    },

    /**
     * Add a new dynamic Gift to MongoDB & Cloudinary
     */
    async addGift(callerUid, data, files = {}) {
        await verifyZeroTrustAdmin(callerUid);

        let {
            giftId,
            name,
            coinPrice,
            category,
            iconUrl,
            animationUrl,
            animationType,
            sortOrder,
            isLucky,
            luckyMultiplierMax,
            description
        } = data || {};

        if (!name) {
            throw new Error('Gift name is required');
        }

        const price = Math.max(1, parseInt(coinPrice, 10) || 100);
        let finalGiftId = giftId ? String(giftId).trim() : '';
        if (!finalGiftId) {
            const randomPart = Math.random().toString(36).substring(2, 8);
            finalGiftId = `gf_${Date.now()}_${randomPart}`;
        }

        let finalIconUrl = iconUrl ? String(iconUrl).trim() : '';
        let finalAnimUrl = animationUrl ? String(animationUrl).trim() : '';

        // 1. Upload Display/Thumbnail Icon to Cloudinary if file provided
        if (files && files.iconFile && files.iconFile[0]) {
            const iconUpload = await uploadBufferToCloudinary(
                files.iconFile[0].buffer,
                'amison/gifts/thumbnails',
                'image'
            );
            if (iconUpload && iconUpload.secure_url) {
                finalIconUrl = iconUpload.secure_url;
            }
        }

        // 2. Upload Animation Asset (SVGA, GIF) to Cloudinary if file provided
        if (files && files.animFile && files.animFile[0]) {
            const isSvga = files.animFile[0].originalname && files.animFile[0].originalname.toLowerCase().endsWith('.svga');
            const animUpload = await uploadBufferToCloudinary(
                files.animFile[0].buffer,
                'amison/gifts/animations',
                isSvga ? 'raw' : 'auto'
            );
            if (animUpload && animUpload.secure_url) {
                finalAnimUrl = animUpload.secure_url;
            }
        }

        if (!finalIconUrl && finalAnimUrl) {
            finalIconUrl = finalAnimUrl;
        }

        const resolvedType = animationType || resolveAnimationType(finalAnimUrl, finalIconUrl);

        const newGift = await Gift.create({
            giftId: finalGiftId,
            name: String(name).trim(),
            coinPrice: price,
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

        // Invalidate and refresh cache
        await cacheService.invalidateGiftsCatalogCache();
        const updatedCatalog = await Gift.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        await cacheService.syncGiftsCatalogCache(updatedCatalog);

        // Real-Time WebSocket broadcast to all voice rooms
        notifyWebSocketClients({
            action: 'create',
            gift: newGift.toObject ? newGift.toObject() : newGift,
            gifts: updatedCatalog
        });

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
        if (data.iconUrl) gift.iconUrl = String(data.iconUrl).trim();
        if (data.animationUrl) gift.animationUrl = String(data.animationUrl).trim();

        // Check new file uploads
        if (files && files.iconFile && files.iconFile[0]) {
            const iconUpload = await uploadBufferToCloudinary(
                files.iconFile[0].buffer,
                'amison/gifts/thumbnails',
                'image'
            );
            if (iconUpload && iconUpload.secure_url) gift.iconUrl = iconUpload.secure_url;
        }

        if (files && files.animFile && files.animFile[0]) {
            const isSvga = files.animFile[0].originalname && files.animFile[0].originalname.toLowerCase().endsWith('.svga');
            const animUpload = await uploadBufferToCloudinary(
                files.animFile[0].buffer,
                'amison/gifts/animations',
                isSvga ? 'raw' : 'auto'
            );
            if (animUpload && animUpload.secure_url) gift.animationUrl = animUpload.secure_url;
        }

        gift.animationType = data.animationType || resolveAnimationType(gift.animationUrl, gift.iconUrl);
        await gift.save();

        await cacheService.invalidateGiftsCatalogCache();
        const updatedCatalog = await Gift.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        await cacheService.syncGiftsCatalogCache(updatedCatalog);

        notifyWebSocketClients({
            action: 'update',
            gift: gift.toObject ? gift.toObject() : gift,
            gifts: updatedCatalog
        });

        return gift;
    },

    /**
     * Delete or Deactivate Gift
     */
    async deleteGift(callerUid, targetGiftId) {
        await verifyZeroTrustAdmin(callerUid);

        if (!targetGiftId) throw new Error('Target gift ID is required');

        const gift = await Gift.findOne({ $or: [{ giftId: targetGiftId }, { _id: mongoose.isValidObjectId(targetGiftId) ? targetGiftId : null }] });
        if (!gift) throw new Error(`Gift not found with id: ${targetGiftId}`);

        // Soft delete / deactivate
        gift.isActive = false;
        await gift.save();

        await cacheService.invalidateGiftsCatalogCache();
        const updatedCatalog = await Gift.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        await cacheService.syncGiftsCatalogCache(updatedCatalog);

        notifyWebSocketClients({
            action: 'delete',
            giftId: gift.giftId,
            gifts: updatedCatalog
        });

        return gift;
    }
};

module.exports = NewopGiftService;