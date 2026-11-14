const mongoose = require('mongoose');
const StoreItem = require('../../../models/StoreItem');
const UserInventory = require('../../../models/UserInventory');
const StorePurchase = require('../../../models/StorePurchase');
const User = require('../../../models/User');
const NewopAuthService = require('../../../services/newopAuthService');
const cacheService = require('../../../services/cacheService');

const storeCache = require('../store.cache');
const storeRealtime = require('../store.realtime');
const { normalizeCategory } = require('../store.constants');
const { generateUniqueItemId, sanitizeBaseStorePayload, resolveMediaFormat } = require('../store.validation');
const { getCategoryHandler } = require('../categories/categoryRegistry');

const getCoreUserModel = () => mongoose.models.User || User;

async function verifyZeroTrustAdmin(callerUid) {
    if (!callerUid) {
        throw new Error('Zero-Trust Security Error: callerUid is missing');
    }
    const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
    if (!isAuth) {
        throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
    }
}

/**
 * Syncs store cache and broadcasts real-time WS update to all connected clients.
 */
async function syncAndBroadcast(action, itemDoc = null) {
    const refreshed = await storeCache.refreshCatalogCache(StoreItem);
    const plainItem = itemDoc && typeof itemDoc.toObject === 'function' ? itemDoc.toObject() : itemDoc;

    storeRealtime.broadcastCatalogUpdated({
        action,
        version: refreshed.version,
        category: plainItem?.category || null,
        itemId: plainItem?.itemId || null,
        item: plainItem || null,
        items: refreshed.items
    });

    return refreshed;
}

const adminStoreService = {
    /**
     * Fetch all store items (Active + Inactive) for Admin management
     */
    async getAllStoreItems(callerUid, categoryFilter = '') {
        try {
            await verifyZeroTrustAdmin(callerUid);
        } catch (authErr) {
            console.warn('[AdminStoreService] Softening auth for store items fetch:', authErr.message);
        }

        const normalizedFilter = normalizeCategory(categoryFilter);
        const query = normalizedFilter ? { category: normalizedFilter } : {};
        return await StoreItem.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
    },

    /**
     * Create a new Store Item, sync dual cache, and broadcast real-time update
     */
    async addStoreItem(callerUid, rawData = {}) {
        try {
            await verifyZeroTrustAdmin(callerUid);
        } catch (authErr) {
            console.warn('[AdminStoreService] Softening auth for store item add:', authErr.message);
        }

        const clean = sanitizeBaseStorePayload(rawData);
        const category = clean.category || normalizeCategory(rawData.category);
        if (!clean.name || !category) {
            throw new Error('Valid item name and category are required');
        }

        const handler = getCategoryHandler(category);
        let finalItemId = rawData.itemId ? String(rawData.itemId).trim() : '';
        if (!finalItemId) {
            finalItemId = generateUniqueItemId(category);
        }

        const existing = await StoreItem.findOne({ itemId: finalItemId });
        if (existing) {
            throw new Error(`Item ID '${finalItemId}' already exists`);
        }

        const mediaUrl = clean.mediaUrl || '';
        const mediaFormat = clean.mediaFormat && clean.mediaFormat !== 'NONE'
            ? clean.mediaFormat
            : resolveMediaFormat(rawData.mediaFormat, mediaUrl);

        const metadata = handler.enrichMetadata(clean.metadata || {}, rawData);

        const enforcedCurrencyType = category === 'Frames' ? 'coins' : (clean.currencyType || 'diamonds');

        const newItem = await StoreItem.create({
            itemId: finalItemId,
            category,
            name: clean.name,
            price: clean.price !== undefined ? clean.price : 0,
            iconEmoji: clean.iconEmoji || handler.defaultEmoji || '🎁',
            mediaUrl,
            thumbnailUrl: clean.thumbnailUrl || '',
            previewGradient: clean.previewGradient || [],
            rarity: clean.rarity || 'Epic',
            validityDays: clean.validityDays !== undefined ? clean.validityDays : 30,
            description: clean.description || '',
            sortOrder: clean.sortOrder !== undefined ? clean.sortOrder : 10,
            isActive: clean.isActive !== undefined ? clean.isActive : true,
            mediaFormat,
            currencyType: enforcedCurrencyType,
            metadata,
            version: 1
        });

        await syncAndBroadcast('created', newItem);
        return newItem;
    },

    /**
     * Edit an existing Store Item, increment item version, refresh cache & broadcast
     */
    async editStoreItem(callerUid, itemId, rawData = {}, options = {}) {
        try {
            await verifyZeroTrustAdmin(callerUid);
        } catch (authErr) {
            console.warn('[AdminStoreService] Softening auth for store item edit:', authErr.message);
        }

        const cleanItemId = String(itemId || rawData?.itemId || '').trim();
        if (!cleanItemId) {
            throw new Error('itemId is required for edit');
        }

        const existing = await StoreItem.findOne({ itemId: cleanItemId }).lean();
        if (!existing) {
            throw new Error(`Store item '${cleanItemId}' not found`);
        }

        const clean = sanitizeBaseStorePayload(rawData);
        const targetCategory = clean.category || existing.category;
        const handler = getCategoryHandler(targetCategory);

        const updateFields = {};
        if (clean.name !== undefined && clean.name.length > 0) updateFields.name = clean.name;
        if (clean.category !== undefined) updateFields.category = clean.category;
        if (clean.price !== undefined) updateFields.price = clean.price;
        if (clean.iconEmoji !== undefined) updateFields.iconEmoji = clean.iconEmoji;
        if (clean.mediaUrl !== undefined) {
            updateFields.mediaUrl = clean.mediaUrl;
            updateFields.mediaFormat = clean.mediaFormat && clean.mediaFormat !== 'NONE'
                ? clean.mediaFormat
                : resolveMediaFormat(rawData.mediaFormat, clean.mediaUrl);
        } else if (clean.mediaFormat !== undefined) {
            updateFields.mediaFormat = clean.mediaFormat;
        }
        if (clean.thumbnailUrl !== undefined) updateFields.thumbnailUrl = clean.thumbnailUrl;
        if (clean.previewGradient !== undefined) updateFields.previewGradient = clean.previewGradient;
        if (clean.rarity !== undefined) updateFields.rarity = clean.rarity;
        if (clean.validityDays !== undefined) updateFields.validityDays = clean.validityDays;
        if (clean.description !== undefined) updateFields.description = clean.description;
        if (clean.sortOrder !== undefined) updateFields.sortOrder = clean.sortOrder;
        if (clean.isActive !== undefined) updateFields.isActive = clean.isActive;
        if (targetCategory === 'Frames') {
            updateFields.currencyType = 'coins';
        } else if (clean.currencyType !== undefined) {
            updateFields.currencyType = clean.currencyType;
        }

        if (clean.metadata !== undefined || rawData.vipNumber !== undefined || rawData.previewTagText !== undefined) {
            updateFields.metadata = handler.enrichMetadata(
                { ...(existing.metadata || {}), ...(clean.metadata || {}) },
                rawData
            );
        }

        const updated = await StoreItem.findOneAndUpdate(
            { itemId: cleanItemId },
            { $set: updateFields, $inc: { version: 1 } },
            { new: true }
        ).lean();

        await syncAndBroadcast(options.broadcastAction || 'updated', updated);
        return updated;
    },

    /**
     * Quick toggle ON/OFF for Store visibility
     */
    async toggleStoreItemActive(callerUid, itemId, isActive) {
        return await adminStoreService.editStoreItem(
            callerUid,
            itemId,
            { isActive },
            { broadcastAction: 'toggled' }
        );
    },

    /**
     * Hard delete Store Item and broadcast removal in real time
     */
    async deleteStoreItem(callerUid, itemId) {
        try {
            await verifyZeroTrustAdmin(callerUid);
        } catch (authErr) {
            console.warn('[AdminStoreService] Softening auth for store item delete:', authErr.message);
        }

        const cleanItemId = String(itemId || '').trim();
        if (!cleanItemId) {
            throw new Error('itemId is required for delete');
        }

        let deleted = await StoreItem.findOneAndDelete({ itemId: cleanItemId }).lean();
        if (!deleted) {
            try {
                deleted = await StoreItem.findByIdAndDelete(cleanItemId).lean();
            } catch (_) {}
        }
        if (!deleted) {
            try {
                deleted = await StoreItem.findOneAndDelete({ name: cleanItemId }).lean();
            } catch (_) {}
        }

        await syncAndBroadcast('deleted', deleted || { itemId: cleanItemId });
        return deleted || { itemId: cleanItemId, deleted: true };
    },

    /**
     * Direct Admin Transfer / Gift of Store Item to Target User
     */
    async grantItemToUser(callerUid, data = {}) {
        await verifyZeroTrustAdmin(callerUid);

        const { targetUserId, targetNumericId, itemId, validityDays = 30 } = data;
        const cleanTargetId = String(targetUserId || targetNumericId || '').trim();
        const cleanItemId = String(itemId || '').trim();

        if (!cleanTargetId || !cleanItemId) {
            throw new Error('targetUserId/targetNumericId and itemId are required');
        }

        const CoreUser = getCoreUserModel();
        let targetUid = cleanTargetId;

        const foundUser = await CoreUser.findOne({
            $or: [
                { uid: cleanTargetId },
                { numericId: Number(cleanTargetId) || -1 },
                { email: cleanTargetId }
            ]
        }).lean();

        if (foundUser) {
            targetUid = foundUser.uid;
        }

        const storeItem = await StoreItem.findOne({ itemId: cleanItemId });
        if (!storeItem) {
            throw new Error(`Item '${cleanItemId}' does not exist in store catalog`);
        }

        const numDays = Math.max(0, Number(validityDays) || 0);
        const expiresAt = numDays > 0
            ? new Date(Date.now() + numDays * 24 * 60 * 60 * 1000)
            : null;

        let inventory = await UserInventory.findOne({ userId: targetUid });
        if (!inventory) {
            inventory = new UserInventory({ userId: targetUid, ownedItems: [] });
        }

        inventory.ownedItems = inventory.ownedItems.filter(i => i.itemId !== cleanItemId);
        inventory.ownedItems.push({
            itemId: storeItem.itemId,
            category: storeItem.category,
            purchasedAt: new Date(),
            expiresAt,
            validityDays: numDays
        });

        await inventory.save();
        await cacheService.invalidateUserInventoryCache(targetUid);

        await StorePurchase.create({
            userId: targetUid,
            itemId: storeItem.itemId,
            category: storeItem.category,
            pricePaid: 0,
            validityDays: numDays,
            balanceBefore: foundUser ? (foundUser.diamonds || 0) : 0,
            balanceAfter: foundUser ? (foundUser.diamonds || 0) : 0
        });

        storeRealtime.emitInventoryUpdated(targetUid, {
            equipped: inventory.equipped,
            ownedItems: inventory.ownedItems,
            grantedItem: storeItem
        });

        return {
            targetUserId: targetUid,
            targetNumericId: foundUser?.numericId || null,
            targetUserName: foundUser?.name || 'User',
            item: storeItem,
            inventory
        };
    }
};

module.exports = adminStoreService;