const UserInventory = require('../../../models/UserInventory');
const cacheService = require('../../../services/cacheService');
const { resolveUser } = require('../../../utils/userResolver');
const storeRealtime = require('../store.realtime');
const { getCategoryHandler } = require('../categories/categoryRegistry');
const { normalizeCategory } = require('../store.constants');

async function resolveCanonicalUid(rawId) {
    const clean = String(rawId || '').trim();
    if (!clean) return '';
    try {
        const userDoc = await resolveUser(clean);
        if (userDoc && userDoc.uid) {
            return String(userDoc.uid).trim();
        }
    } catch (_) {}
    return clean;
}

function pruneAndEnrichInventory(inventory) {
    if (!inventory) {
        return { changed: false, enriched: { userId: '', ownedItems: [], equipped: {} } };
    }
    const nowMs = Date.now();
    const rawOwned = Array.isArray(inventory.ownedItems) ? inventory.ownedItems : [];
    const activeOwned = rawOwned.filter(it => it && it.itemId && (!it.expiresAt || new Date(it.expiresAt).getTime() > nowMs));
    let changed = activeOwned.length !== rawOwned.length;

    const activeIds = new Set(activeOwned.map(i => i.itemId));
    if (changed && inventory.equipped) {
        // Clear equipped slots if the underlying item expired (unless it is a free default or permanent custom)
        const slots = ['frame', 'entrance', 'bubble', 'profileCard', 'ring'];
        for (const slot of slots) {
            const slotObj = inventory.equipped[slot];
            if (slotObj && slotObj.itemId && !activeIds.has(slotObj.itemId)) {
                slotObj.itemId = null;
                if ('mediaUrl' in slotObj) slotObj.mediaUrl = null;
                if ('expiresAt' in slotObj) slotObj.expiresAt = null;
            }
        }
        if (inventory.equipped.theme && inventory.equipped.theme.itemId &&
            inventory.equipped.theme.itemId !== 'theme_amison_light' &&
            !activeIds.has(inventory.equipped.theme.itemId)) {
            inventory.equipped.theme.itemId = 'theme_amison_light';
            inventory.equipped.theme.mediaUrl = null;
        }
    }

    if (changed) {
        inventory.ownedItems = activeOwned;
    }

    const plain = typeof inventory.toObject === 'function' ? inventory.toObject() : { ...inventory };
    const enrichedOwned = (plain.ownedItems || []).map(it => {
        const expMs = it.expiresAt ? new Date(it.expiresAt).getTime() : null;
        const remainingDays = expMs === null
            ? null
            : Math.max(1, Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000)));
        return {
            ...it,
            remainingDays
        };
    });

    return {
        changed,
        enriched: {
            ...plain,
            ownedItems: enrichedOwned
        }
    };
}

/**
 * Public Store Inventory Controller
 * Handles User Inventory retrieval, expiry pruning, category-aware Equip & Unequip, and WS sync.
 */
const storeInventoryController = {
    /**
     * GET /api/store/inventory/:userId
     */
    async getInventory(req, res) {
        try {
            const rawUserId = req.params.userId;
            if (!rawUserId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }

            const canonicalUid = await resolveCanonicalUid(rawUserId);
            const cachedInv = await cacheService.getCachedUserInventory(canonicalUid);
            if (cachedInv) {
                const { changed, enriched } = pruneAndEnrichInventory(cachedInv);
                if (!changed) {
                    return res.json({ success: true, inventory: enriched, source: 'redis' });
                }
            }

            let inventory = await UserInventory.findOne({ userId: canonicalUid });
            if (!inventory) {
                inventory = await UserInventory.create({
                    userId: canonicalUid,
                    ownedItems: [],
                    equipped: {}
                });
            }

            const { changed, enriched } = pruneAndEnrichInventory(inventory);
            if (changed) {
                await inventory.save();
            }

            await cacheService.syncUserInventoryCache(canonicalUid, enriched);
            return res.json({ success: true, inventory: enriched, source: 'mongodb' });
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

            const canonicalUid = await resolveCanonicalUid(userId);
            const normalizedCat = normalizeCategory(category, category);
            const handler = getCategoryHandler(normalizedCat);

            let inventory = await UserInventory.findOne({ userId: canonicalUid });
            if (!inventory) {
                inventory = new UserInventory({ userId: canonicalUid, ownedItems: [] });
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
            const { enriched } = pruneAndEnrichInventory(inventory);
            await cacheService.invalidateUserInventoryCache(canonicalUid);
            await cacheService.syncUserInventoryCache(canonicalUid, enriched);

            storeRealtime.emitInventoryUpdated(canonicalUid, {
                equipped: enriched.equipped,
                ownedItems: enriched.ownedItems
            });

            return res.json({
                success: true,
                message: `Equipped ${itemId}`,
                equipped: enriched.equipped,
                inventory: enriched
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

            const canonicalUid = await resolveCanonicalUid(userId);
            const normalizedCat = normalizeCategory(category, category);
            const handler = getCategoryHandler(normalizedCat);

            const inventory = await UserInventory.findOne({ userId: canonicalUid });
            let enriched = null;
            if (inventory) {
                handler.applyUnequip(inventory);
                await inventory.save();
                enriched = pruneAndEnrichInventory(inventory).enriched;
                await cacheService.invalidateUserInventoryCache(canonicalUid);
                await cacheService.syncUserInventoryCache(canonicalUid, enriched);

                storeRealtime.emitInventoryUpdated(canonicalUid, {
                    equipped: enriched.equipped,
                    ownedItems: enriched.ownedItems
                });
            }

            return res.json({
                success: true,
                message: `Unequipped ${normalizedCat}`,
                equipped: enriched ? enriched.equipped : {}
            });
        } catch (err) {
            console.error('❌ [StoreInventoryController] Unequip Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = storeInventoryController;