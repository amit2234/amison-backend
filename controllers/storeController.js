const StoreItem = require('../models/StoreItem');
const UserInventory = require('../models/UserInventory');
const StorePurchase = require('../models/StorePurchase');
const Wallet = require('../models/Wallet');
const cacheService = require('../services/cacheService');

/**
 * User Store Controller
 * Handles Store Catalog, User Inventories, Purchases, Equip & Unequip
 */
const storeController = {
    /**
     * GET /api/store/catalog or /api/store/items
     */
    async getCatalog(req, res) {
        try {
            const { category } = req.query;
            if (!category || category === 'All') {
                const cachedCatalog = await cacheService.getCachedStoreCatalog();
                if (cachedCatalog) {
                    return res.json({ success: true, count: cachedCatalog.length, items: cachedCatalog, source: 'redis' });
                }
            }

            const filter = { isActive: true };
            if (category && category !== 'All') {
                filter.category = category;
            }
            const items = await StoreItem.find(filter).sort({ sortOrder: 1, createdAt: -1 });

            if (!category || category === 'All') {
                cacheService.syncStoreCatalogCache(items);
            }

            res.json({ success: true, count: items.length, items, source: 'mongodb' });
        } catch (err) {
            console.error("❌ [StoreController] Fetch Catalog Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * GET /api/store/inventory/:userId
     */
    async getInventory(req, res) {
        try {
            const { userId } = req.params;
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

            cacheService.syncUserInventoryCache(userId, inventory);
            res.json({ success: true, inventory, source: 'mongodb' });
        } catch (err) {
            console.error("❌ [StoreController] Fetch Inventory Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/buy (Atomic Purchase with Diamonds)
     */
    async buyItem(req, res) {
        try {
            const { userId, itemId, validityDays = 30 } = req.body;
            if (!userId || !itemId) {
                return res.status(400).json({ success: false, message: "userId and itemId are required" });
            }

            const item = await StoreItem.findOne({ itemId, isActive: true });
            if (!item) {
                return res.status(404).json({ success: false, message: "Item not found in catalog" });
            }

            const cost = item.price;

            // Atomic deduction from Wallet
            const wallet = await Wallet.findOne({ uid: userId });
            const currentDiamonds = wallet ? wallet.diamonds : 0;

            if (currentDiamonds < cost) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient diamonds. Required: ${cost}, Available: ${currentDiamonds}`
                });
            }

            // Deduct diamonds atomically
            const updatedWallet = await Wallet.findOneAndUpdate(
                { uid: userId, diamonds: { $gte: cost } },
                { $inc: { diamonds: -cost }, $set: { updatedAt: new Date() } },
                { new: true }
            );

            if (!updatedWallet) {
                return res.status(400).json({ success: false, message: "Transaction failed: Insufficient diamonds" });
            }

            // Calculate expiration date
            const expiresAt = validityDays > 0
                ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000)
                : null;

            // Upsert inventory
            let inventory = await UserInventory.findOne({ userId });
            if (!inventory) {
                inventory = new UserInventory({ userId, ownedItems: [] });
            }

            // Remove existing instance if owned
            inventory.ownedItems = inventory.ownedItems.filter(i => i.itemId !== itemId);
            inventory.ownedItems.push({
                itemId: item.itemId,
                category: item.category,
                purchasedAt: new Date(),
                expiresAt,
                validityDays
            });

            // Auto-equip item
            const catKey = item.category.toLowerCase();
            if (catKey.includes('frame')) {
                inventory.equipped.frame = { itemId: item.itemId, mediaUrl: item.mediaUrl };
            } else if (catKey.includes('entrance')) {
                inventory.equipped.entrance = { itemId: item.itemId, mediaUrl: item.mediaUrl };
            } else if (catKey.includes('bubble')) {
                inventory.equipped.bubble = { itemId: item.itemId, mediaUrl: item.mediaUrl };
            } else if (catKey.includes('theme')) {
                inventory.equipped.theme = { itemId: item.itemId, mediaUrl: item.mediaUrl };
            } else if (catKey.includes('ring')) {
                inventory.equipped.ring = { itemId: item.itemId, expiresAt };
            }

            await inventory.save();
            cacheService.invalidateUserInventoryCache(userId);

            // Save purchase audit record
            await StorePurchase.create({
                userId,
                itemId: item.itemId,
                category: item.category,
                pricePaid: cost,
                validityDays,
                balanceBefore: currentDiamonds,
                balanceAfter: updatedWallet.diamonds
            });

            res.json({
                success: true,
                message: `${item.name} purchased and equipped successfully!`,
                newDiamonds: updatedWallet.diamonds,
                item,
                inventory
            });
        } catch (err) {
            console.error("❌ [StoreController] Buy Item Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/equip
     */
    async equipItem(req, res) {
        try {
            const { userId, category, itemId, mediaUrl } = req.body;
            if (!userId || !category || !itemId) {
                return res.status(400).json({ success: false, message: "userId, category and itemId are required" });
            }

            let inventory = await UserInventory.findOne({ userId });
            if (!inventory) {
                inventory = new UserInventory({ userId, ownedItems: [] });
            }

            const catLower = category.toLowerCase();
            if (catLower.includes('frame')) {
                inventory.equipped.frame = { itemId, mediaUrl: mediaUrl || "" };
            } else if (catLower.includes('entrance')) {
                inventory.equipped.entrance = { itemId, mediaUrl: mediaUrl || "" };
            } else if (catLower.includes('bubble')) {
                inventory.equipped.bubble = { itemId, mediaUrl: mediaUrl || "" };
            } else if (catLower.includes('theme')) {
                inventory.equipped.theme = { itemId, mediaUrl: mediaUrl || "" };
            } else if (catLower.includes('ring')) {
                inventory.equipped.ring = { itemId, expiresAt: null };
            }

            await inventory.save();
            cacheService.invalidateUserInventoryCache(userId);
            res.json({ success: true, message: `Equipped ${itemId}`, equipped: inventory.equipped });
        } catch (err) {
            console.error("❌ [StoreController] Equip Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * POST /api/store/unequip
     */
    async unequipItem(req, res) {
        try {
            const { userId, category } = req.body;
            if (!userId || !category) {
                return res.status(400).json({ success: false, message: "userId and category required" });
            }

            let inventory = await UserInventory.findOne({ userId });
            if (inventory) {
                const catLower = category.toLowerCase();
                if (catLower.includes('frame')) inventory.equipped.frame = { itemId: null, mediaUrl: null };
                if (catLower.includes('entrance')) inventory.equipped.entrance = { itemId: null, mediaUrl: null };
                if (catLower.includes('bubble')) inventory.equipped.bubble = { itemId: null, mediaUrl: null };
                if (catLower.includes('theme')) inventory.equipped.theme = { itemId: null, mediaUrl: null };
                if (catLower.includes('ring')) inventory.equipped.ring = { itemId: null, expiresAt: null };
                await inventory.save();
                cacheService.invalidateUserInventoryCache(userId);
            }

            res.json({ success: true, message: `Unequipped ${category}` });
        } catch (err) {
            console.error("❌ [StoreController] Unequip Error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = storeController;