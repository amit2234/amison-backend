const express = require('express');
const router = express.Router();
const StoreItem = require('../models/StoreItem');
const UserInventory = require('../models/UserInventory');
const StorePurchase = require('../models/StorePurchase');
const Wallet = require('../models/Wallet');
const { upload, uploadBufferToCloudinary } = require('../services/cloudinaryService');
const { requireNewopAdmin } = require('../middleware/authMiddleware');
const NewopStoreService = require('../services/newopStoreService');

// Default starter catalog for instant availability
const DEFAULT_SEED_ITEMS = [
    // 1. Avatar Frames
    {
        itemId: "frame_gold_crown",
        category: "Frames",
        name: "Gold Crown Luxury",
        price: 500,
        iconEmoji: "👑",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/frames/rank_avatar_frame_1.png",
        rarity: "Epic",
        validityDays: 30,
        description: "Shining 24K Royal Gold Crown Frame"
    },
    {
        itemId: "frame_neon_cyber",
        category: "Frames",
        name: "Neon Cyber Pulse",
        price: 800,
        iconEmoji: "⚡",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/frames/rank_avatar_frame_2.png",
        rarity: "Legendary",
        validityDays: 30,
        description: "Cyberpunk Cyan Neon Glowing Frame"
    },
    {
        itemId: "frame_phoenix_fire",
        category: "Frames",
        name: "Phoenix Fire Wings",
        price: 1200,
        iconEmoji: "🔥",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/frames/rank_avatar_frame_3.png",
        rarity: "Mythic",
        validityDays: 30,
        description: "Blazing Phoenix Wings Avatar Frame"
    },
    // 2. Entrance Effects (Cars & Jets)
    {
        itemId: "entrance_supercar_ferrari",
        category: "EntranceEffect",
        name: "Ferrari F8 Tributo",
        price: 2500,
        iconEmoji: "🏎️",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/entrances/ferrari_f8.png",
        rarity: "Mythic",
        validityDays: 30,
        description: "Supercar Luxury Entrance Sound & Animation"
    },
    {
        itemId: "entrance_private_jet",
        category: "EntranceEffect",
        name: "Gulfstream VIP Jet",
        price: 3500,
        iconEmoji: "✈️",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/entrances/vip_jet.png",
        rarity: "Supreme",
        validityDays: 30,
        description: "Private Jet Runway Touchdown in Voice Room"
    },
    // 3. Text Chat Bubbles
    {
        itemId: "bubble_crystal_sky",
        category: "TextBubble",
        name: "Crystal Sky Glass",
        price: 300,
        iconEmoji: "💬",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/bubbles/bubble_crystal.png",
        rarity: "Epic",
        validityDays: 30,
        description: "Frosted Glass Floating Text Bubble"
    },
    // 4. Voice Room Themes
    {
        itemId: "theme_amison_light",
        category: "Theme",
        name: "Amison Aurora Theme",
        price: 1000,
        iconEmoji: "🌌",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/themes/amison_theme.jpg",
        rarity: "Legendary",
        validityDays: 30,
        description: "Premium Aurora Stage Room Wallpaper"
    },
    // 5. Entry Tags
    {
        itemId: "tag_royal_vip",
        category: "EntryTag",
        name: "Royal Supreme",
        price: 600,
        iconEmoji: "✨",
        mediaUrl: "",
        rarity: "Epic",
        validityDays: 30,
        description: "Exclusive Royal Entry Banner"
    },
    // 6. CP Dating Rings
    {
        itemId: "ring_cp_hooner",
        category: "Rings",
        name: "Hooner Diamond Love Ring",
        price: 1500,
        iconEmoji: "💍",
        mediaUrl: "https://res.cloudinary.com/drd9q73p7/image/upload/v1/amison/store/rings/cp_hooner.png",
        rarity: "Legendary",
        validityDays: 30,
        description: "Required for Proposing & Establishing CP Relation"
    }
];

// Auto-seed if database is empty
async function ensureSeedCatalog() {
    try {
        const count = await StoreItem.countDocuments();
        if (count === 0) {
            console.log("🌱 [Store] Seeding initial Store catalog to MongoDB Atlas...");
            await StoreItem.insertMany(DEFAULT_SEED_ITEMS);
            console.log("✅ [Store] Initial Catalog seeded successfully!");
        }
    } catch (e) {
        console.error("⚠️ [Store] Seeding note:", e.message);
    }
}
ensureSeedCatalog();

const cacheService = require('../services/cacheService');

// ============================================================================
// 1. GET /api/store/catalog (or /api/store/items)
// ============================================================================
router.get(['/catalog', '/items'], async (req, res) => {
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
        console.error("❌ [Store] Fetch Catalog Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// 2. GET /api/store/inventory/:userId
// ============================================================================
router.get('/inventory/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const cachedInv = await cacheService.getCachedUserInventory(userId);
        if (cachedInv) {
            return res.json({ success: true, inventory: cachedInv, source: 'redis' });
        }

        let inventory = await UserInventory.findOne({ userId });
        
        if (!inventory) {
            // Auto create starter inventory
            inventory = await UserInventory.create({
                userId,
                ownedItems: [
                    { itemId: "frame_gold_crown", category: "Frames", validityDays: 30 },
                    { itemId: "bubble_crystal_sky", category: "TextBubble", validityDays: 30 },
                    { itemId: "theme_amison_light", category: "Theme", validityDays: 30 }
                ],
                equipped: {
                    frame: { itemId: "frame_gold_crown", mediaUrl: "" },
                    theme: { itemId: "theme_amison_light", mediaUrl: "" }
                }
            });
        }

        cacheService.syncUserInventoryCache(userId, inventory);
        res.json({ success: true, inventory, source: 'mongodb' });
    } catch (err) {
        console.error("❌ [Store] Fetch Inventory Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// 3. POST /api/store/buy (Atomic Purchase with Diamonds)
// ============================================================================
router.post('/buy', async (req, res) => {
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

        // Remove existing instance of item if already owned to renew expiration
        inventory.ownedItems = inventory.ownedItems.filter(i => i.itemId !== itemId);
        inventory.ownedItems.push({
            itemId: item.itemId,
            category: item.category,
            purchasedAt: new Date(),
            expiresAt,
            validityDays
        });

        // Auto-equip the newly purchased item
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
            item: item,
            inventory: inventory
        });
    } catch (err) {
        console.error("❌ [Store] Buy Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// 4. POST /api/store/equip (Equip Cosmetic)
// ============================================================================
router.post('/equip', async (req, res) => {
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
        console.error("❌ [Store] Equip Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// 5. POST /api/store/unequip
// ============================================================================
router.post('/unequip', async (req, res) => {
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
            if (catLower.includes('theme')) inventory.equipped.theme = { itemId: "theme_amison_light", mediaUrl: null };
            if (catLower.includes('ring')) inventory.equipped.ring = { itemId: null, expiresAt: null };
            await inventory.save();
            cacheService.invalidateUserInventoryCache(userId);
        }

        res.json({ success: true, message: `Unequipped ${category}` });
    } catch (err) {
        console.error("❌ [Store] Unequip Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// 6. ZERO-TRUST STORE ADMIN ENDPOINTS (/api/store/admin/*)
// ============================================================================

// GET /api/store/admin/items - Fetch all store catalog items for admin management
router.get('/admin/items', requireNewopAdmin, async (req, res) => {
    try {
        const items = await NewopStoreService.getAllStoreItems(req.callerUid);
        res.json({ success: true, count: items.length, items });
    } catch (err) {
        console.error("❌ [Store Admin] Fetch Items Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/store/admin/add - Add a new Store Item
router.post('/admin/add', requireNewopAdmin, async (req, res) => {
    try {
        const item = await NewopStoreService.addStoreItem(req.callerUid, req.body);
        res.json({ success: true, message: 'Store item added successfully', item });
    } catch (err) {
        console.error("❌ [Store Admin] Add Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT & POST /api/store/admin/edit - Edit Store Item
router.put('/admin/edit/:itemId', requireNewopAdmin, async (req, res) => {
    try {
        const item = await NewopStoreService.editStoreItem(req.callerUid, req.params.itemId, req.body);
        res.json({ success: true, message: 'Store item updated successfully', item });
    } catch (err) {
        console.error("❌ [Store Admin] Edit Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
router.post('/admin/edit', requireNewopAdmin, async (req, res) => {
    try {
        const item = await NewopStoreService.editStoreItem(req.callerUid, req.body.itemId, req.body);
        res.json({ success: true, message: 'Store item updated successfully', item });
    } catch (err) {
        console.error("❌ [Store Admin] Edit Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE & POST /api/store/admin/delete - Delete/Deactivate Store Item
router.delete('/admin/delete/:itemId', requireNewopAdmin, async (req, res) => {
    try {
        const item = await NewopStoreService.deleteStoreItem(req.callerUid, req.params.itemId);
        res.json({ success: true, message: 'Store item deactivated successfully', item });
    } catch (err) {
        console.error("❌ [Store Admin] Delete Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
router.post('/admin/delete', requireNewopAdmin, async (req, res) => {
    try {
        const item = await NewopStoreService.deleteStoreItem(req.callerUid, req.body.itemId);
        res.json({ success: true, message: 'Store item deactivated successfully', item });
    } catch (err) {
        console.error("❌ [Store Admin] Delete Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/store/admin/grant - Direct Admin Transfer/Gift of Store Item to Target User
router.post('/admin/grant', requireNewopAdmin, async (req, res) => {
    try {
        const result = await NewopStoreService.grantItemToUser(req.callerUid, req.body);
        res.json({ success: true, message: 'Item granted to target user successfully', result });
    } catch (err) {
        console.error("❌ [Store Admin] Grant Item Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/store/admin/upload - Cloudinary Media Upload & Item Creation
router.post('/admin/upload', requireNewopAdmin, upload.single('media'), async (req, res) => {
    try {
        const { name, category, price, rarity, validityDays, description, iconEmoji } = req.body;
        
        let mediaUrl = "";
        if (req.file) {
            const uploadResult = await uploadBufferToCloudinary(
                req.file.buffer, 
                `amison/store/${category ? category.toLowerCase() : 'items'}`
            );
            mediaUrl = uploadResult.secure_url;
        } else if (req.body.mediaUrl) {
            mediaUrl = req.body.mediaUrl;
        }

        const item = await NewopStoreService.addStoreItem(req.callerUid, {
            name: name || "Custom Luxury Item",
            category: category || "Frames",
            price: Number(price) || 500,
            iconEmoji: iconEmoji || "✨",
            mediaUrl,
            rarity: rarity || "Epic",
            validityDays: Number(validityDays) || 30,
            description: description || ""
        });

        res.json({ success: true, item });
    } catch (err) {
        console.error("❌ [Store Admin Upload Error]:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;