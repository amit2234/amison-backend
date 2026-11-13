const UserInventory = require('../../../models/UserInventory');
const cacheService = require('../../../services/cacheService');
const storeRealtime = require('../store.realtime');
const { getCategoryHandler } = require('../categories/categoryRegistry');
const { normalizeCategory } = require('../store.constants');

/**
 * Public Store Inventory Controller
 * Handles User Inventory retrieval, category-aware Equip & Unequip, and WS sync.
 */
const storeInventoryController = {
    /**
     * GET /api/store/inventory/:userId
     */
    async getInventory(req, res) {
        try {
            const { userId } = req.params;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }

            const cachedInv = await cacheService.getCachedUserInventory(userId);
            if (cachedInv) {
                return res.json({ success: true, inventory: cachedInv, source: 'redis' });
            }

            let inventory = await UserInventory.findOne({ userId });
            if (!inventory) {
                inventory = await UserInventory.create({
                    userId,
                    ownedItems: [],
                    equipped: {}
                });
            }

            await cacheService.syncUserInventoryCache(userId, inventory);
            return res.json({ success: true, inventory, source: 'mongodb' });
        } catch (err) {
            console.error('❌ [StoreInventoryController] Fetch Inventory Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/equip
     */
    async equipItem(req, res) {
        try {
            const { userId, category, itemId, mediaUrl, tagText, vipNumber, itemName, expiresAt } = req.body;
            if (!userId || !category || !itemId) {
                return res.status(400).json({
                    success: false,
                    message: 'userId, category and itemId are required'
                });
            }

            const normalizedCat = normalizeCategory(category, category);
            const handler = getCategoryHandler(normalizedCat);

            let inventory = await UserInventory.findOne({ userId });
            if (!inventory) {
                inventory = new UserInventory({ userId, ownedItems: [] });
            }

            handler.applyEquip(inventory, {
                itemId,
                mediaUrl: mediaUrl || '',
                tagText,
                vipNumber,
                itemName,
                expiresAt
            });

            await inventory.save();
            await cacheService.invalidateUserInventoryCache(userId);

            storeRealtime.emitInventoryUpdated(userId, {
                equipped: inventory.equipped
            });

            return res.json({
                success: true,
                message: `Equipped ${itemId}`,
                equipped: inventory.equipped
            });
        } catch (err) {
            console.error('❌ [StoreInventoryController] Equip Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/unequip
     */
    async unequipItem(req, res) {
        try {
            const { userId, category } = req.body;
            if (!userId || !category) {
                return res.status(400).json({
                    success: false,
                    message: 'userId and category required'
                });
            }

            const normalizedCat = normalizeCategory(category, category);
            const handler = getCategoryHandler(normalizedCat);

            const inventory = await UserInventory.findOne({ userId });
            if (inventory) {
                handler.applyUnequip(inventory);
                await inventory.save();
                await cacheService.invalidateUserInventoryCache(userId);

                storeRealtime.emitInventoryUpdated(userId, {
                    equipped: inventory.equipped
                });
            }

            return res.json({
                success: true,
                message: `Unequipped ${normalizedCat}`,
                equipped: inventory ? inventory.equipped : {}
            });
        } catch (err) {
            console.error('❌ [StoreInventoryController] Unequip Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = storeInventoryController;
