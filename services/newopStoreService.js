const mongoose = require('mongoose');
const StoreItem = require('../models/StoreItem');
const UserInventory = require('../models/UserInventory');
const StorePurchase = require('../models/StorePurchase');
const User = require('../models/User');
const NewopAuthService = require('./newopAuthService');
const cacheService = require('./cacheService');

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

const NewopStoreService = {
    /**
     * Fetch all active store items for catalog and admin management
     */
    async getAllStoreItems(callerUid) {
        await verifyZeroTrustAdmin(callerUid);
        // Only return active, non-deleted store items
        const items = await StoreItem.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        return items;
    },

    /**
     * Add a new Store Item to MongoDB catalog
     */
    async addStoreItem(callerUid, data) {
        await verifyZeroTrustAdmin(callerUid);

        const { itemId, category, name, price, iconEmoji, mediaUrl, thumbnailUrl, rarity, validityDays, description, sortOrder, isActive } = data || {};

        if (!name || !category) {
            throw new Error('Item name and category are required');
        }

        const validCategories = [
            "EntranceEffect", "Frames", "TextBubble", "Theme", 
            "ProfileCard", "EntryTag", "VipId", "Rings"
        ];
        if (!validCategories.includes(category)) {
            throw new Error(`Invalid category: ${category}. Allowed: ${validCategories.join(', ')}`);
        }

        // Generate clean itemId if omitted
        let finalItemId = itemId ? String(itemId).trim() : '';
        if (!finalItemId) {
            const prefix = category.substring(0, 3).toLowerCase();
            const randomStr = Math.random().toString(36).substring(2, 8);
            finalItemId = `${prefix}_${randomStr}`;
        }

        const existing = await StoreItem.findOne({ itemId: finalItemId });
        if (existing) {
            throw new Error(`Item ID '${finalItemId}' already exists`);
        }

        const newItem = await StoreItem.create({
            itemId: finalItemId,
            category,
            name: String(name).trim(),
            price: Math.max(0, Number(price) || 0),
            iconEmoji: iconEmoji || "🎁",
            mediaUrl: mediaUrl || "",
            thumbnailUrl: thumbnailUrl || "",
            rarity: rarity || "Epic",
            validityDays: validityDays !== undefined ? Number(validityDays) : 30,
            description: description || "",
            sortOrder: sortOrder !== undefined ? Number(sortOrder) : 10,
            isActive: isActive !== undefined ? !!isActive : true
        });

        // Invalidate catalog cache so clients see instant updates
        const allActive = await StoreItem.find({ isActive: true }).sort({ sortOrder: 1 });
        await cacheService.syncStoreCatalogCache(allActive);

        return newItem;
    },

    /**
     * Update an existing Store Item
     */
    async editStoreItem(callerUid, itemId, data) {
        await verifyZeroTrustAdmin(callerUid);

        const cleanItemId = String(itemId || data?.itemId || '').trim();
        if (!cleanItemId) {
            throw new Error('itemId is required for edit');
        }

        const updateFields = {};
        if (data.name !== undefined) updateFields.name = String(data.name).trim();
        if (data.category !== undefined) updateFields.category = data.category;
        if (data.price !== undefined) updateFields.price = Math.max(0, Number(data.price) || 0);
        if (data.iconEmoji !== undefined) updateFields.iconEmoji = data.iconEmoji;
        if (data.mediaUrl !== undefined) updateFields.mediaUrl = data.mediaUrl;
        if (data.thumbnailUrl !== undefined) updateFields.thumbnailUrl = data.thumbnailUrl;
        if (data.rarity !== undefined) updateFields.rarity = data.rarity;
        if (data.validityDays !== undefined) updateFields.validityDays = Number(data.validityDays);
        if (data.description !== undefined) updateFields.description = data.description;
        if (data.sortOrder !== undefined) updateFields.sortOrder = Number(data.sortOrder);
        if (data.isActive !== undefined) updateFields.isActive = !!data.isActive;

        const updated = await StoreItem.findOneAndUpdate(
            { itemId: cleanItemId },
            { $set: updateFields },
            { new: true }
        ).lean();

        if (!updated) {
            throw new Error(`Store item '${cleanItemId}' not found`);
        }

        // Invalidate catalog cache
        const allActive = await StoreItem.find({ isActive: true }).sort({ sortOrder: 1 });
        await cacheService.syncStoreCatalogCache(allActive);

        return updated;
    },

    /**
     * Delete Store Item permanently (Hard Delete)
     */
    async deleteStoreItem(callerUid, itemId) {
        await verifyZeroTrustAdmin(callerUid);

        const cleanItemId = String(itemId || '').trim();
        if (!cleanItemId) {
            throw new Error('itemId is required for delete');
        }

        // Hard delete permanently from MongoDB Atlas
        const deleted = await StoreItem.findOneAndDelete({ itemId: cleanItemId }).lean();

        if (!deleted) {
            // Also try deleting by MongoDB _id if passed
            try {
                await StoreItem.findByIdAndDelete(cleanItemId);
            } catch (_) {}
        }

        // Invalidate catalog cache so clients see instant removal
        const allActive = await StoreItem.find({ isActive: true }).sort({ sortOrder: 1 });
        await cacheService.syncStoreCatalogCache(allActive);

        return deleted || { itemId: cleanItemId, deleted: true };
    },

    /**
     * Direct Admin Transfer / Gift of Store Item to Target User
     */
    async grantItemToUser(callerUid, data) {
        await verifyZeroTrustAdmin(callerUid);

        const { targetUserId, targetNumericId, itemId, validityDays = 30 } = data || {};
        const cleanTargetId = String(targetUserId || targetNumericId || '').trim();
        const cleanItemId = String(itemId || '').trim();

        if (!cleanTargetId || !cleanItemId) {
            throw new Error('targetUserId/targetNumericId and itemId are required');
        }

        // Resolve Target User Auth UID
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

        const numDays = Number(validityDays);
        const expiresAt = numDays > 0 
            ? new Date(Date.now() + numDays * 24 * 60 * 60 * 1000) 
            : null;

        let inventory = await UserInventory.findOne({ userId: targetUid });
        if (!inventory) {
            inventory = new UserInventory({ userId: targetUid, ownedItems: [] });
        }

        // Remove duplicate if already owned to extend/renew
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

        // Audit log in StorePurchase with pricePaid = 0 (Admin Transfer)
        await StorePurchase.create({
            userId: targetUid,
            itemId: storeItem.itemId,
            category: storeItem.category,
            pricePaid: 0,
            validityDays: numDays,
            balanceBefore: foundUser ? (foundUser.diamonds || 0) : 0,
            balanceAfter: foundUser ? (foundUser.diamonds || 0) : 0
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

module.exports = NewopStoreService;