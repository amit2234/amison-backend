const crypto = require('crypto');
const mongoose = require('mongoose');
const StoreItem = require('../../../models/StoreItem');
const UserInventory = require('../../../models/UserInventory');
const StorePurchase = require('../../../models/StorePurchase');
const User = require('../../../models/User');
const WalletTransaction = require('../../../models/Transaction');
const cacheService = require('../../../services/cacheService');
const { resolveUser } = require('../../../utils/userResolver');
const storeRealtime = require('../store.realtime');
const { getCategoryHandler } = require('../categories/categoryRegistry');

function computeAuthoritativePrice(basePrice, defaultValidityDays, requestedDays) {
    const safeBase = Math.max(0, Math.floor(Number(basePrice) || 0));
    if (safeBase === 0) return 0;
    if (requestedDays === 7) {
        return Math.max(1, Math.floor(safeBase * 0.35));
    }
    if (requestedDays === 0) {
        return defaultValidityDays === 0 ? safeBase : Math.floor(safeBase * 2.8);
    }
    if (requestedDays === 30) {
        return safeBase;
    }
    if (defaultValidityDays > 0 && requestedDays !== defaultValidityDays) {
        return Math.max(1, Math.round((safeBase * requestedDays) / defaultValidityDays));
    }
    return safeBase;
}

function enrichInventoryForClient(invDoc) {
    if (!invDoc) return { userId: '', ownedItems: [], equipped: {} };
    const plain = typeof invDoc.toObject === 'function' ? invDoc.toObject() : { ...invDoc };
    const nowMs = Date.now();
    const activeOwned = (Array.isArray(plain.ownedItems) ? plain.ownedItems : [])
        .filter(it => it && it.itemId && (!it.expiresAt || new Date(it.expiresAt).getTime() > nowMs))
        .map(it => {
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
        ...plain,
        ownedItems: activeOwned
    };
}

/**
 * Public Store Purchase Controller
 * Zero-Trust Atomic User Coin/Diamond Deduction + Duration Pricing + Auto-Equip + Cloud Inventory Sync
 */
const storePurchaseController = {
    /**
     * POST /api/store/buy
     */
    async buyItem(req, res) {
        try {
            const { userId, itemId, validityDays } = req.body;
            if (!userId || !itemId) {
                return res.status(400).json({
                    success: false,
                    message: 'userId and itemId are required'
                });
            }

            const item = await StoreItem.findOne({ itemId: String(itemId).trim(), isActive: true }).lean();
            if (!item) {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found in active catalog'
                });
            }

            const userDoc = await resolveUser(userId);
            if (!userDoc) {
                return res.status(404).json({
                    success: false,
                    message: 'User account not found'
                });
            }

            const canonicalUid = userDoc.uid;
            const defaultDays = Math.max(0, Number(item.validityDays) || 30);
            const effectiveDays = validityDays !== undefined && validityDays !== null
                ? Math.max(0, Math.floor(Number(validityDays) || 0))
                : defaultDays;

            const cost = computeAuthoritativePrice(item.price, defaultDays, effectiveDays);
            const useCoins = item.currencyType !== 'diamonds';
            const balanceField = useCoins ? 'coins' : 'diamonds';
            const currencyLabel = useCoins ? 'coins' : 'diamonds';

            return await cacheService.withUserLock(canonicalUid, async () => {
                // Atomic document-level check + deduction on authoritative `users` collection
                const updatedUser = await User.findOneAndUpdate(
                    { uid: canonicalUid, [balanceField]: { $gte: cost } },
                    {
                        $inc: { [balanceField]: -cost },
                        $set: { updatedAt: new Date() }
                    },
                    { new: true }
                ).lean();

                if (!updatedUser) {
                    const latestUser = await User.findOne({ uid: canonicalUid }).lean();
                    const currentBalance = latestUser ? Math.max(0, Number(latestUser[balanceField]) || 0) : 0;
                    await cacheService.syncWalletCache(
                        canonicalUid,
                        latestUser ? latestUser.coins : 0,
                        latestUser ? latestUser.diamonds : 0
                    );
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient ${currencyLabel}. Required: ${cost}, Available: ${currentBalance}`,
                        requiredCost: cost,
                        availableBalance: currentBalance,
                        newCoins: latestUser ? Math.max(0, Number(latestUser.coins) || 0) : 0,
                        newDiamonds: latestUser ? Math.max(0, Number(latestUser.diamonds) || 0) : 0
                    });
                }

                const newCoins = Math.max(0, Number(updatedUser.coins) || 0);
                const newDiamonds = Math.max(0, Number(updatedUser.diamonds) || 0);
                const balanceAfter = useCoins ? newCoins : newDiamonds;
                const balanceBefore = balanceAfter + cost;

                await cacheService.syncWalletCache(canonicalUid, newCoins, newDiamonds);

                const NewopUserControl = mongoose.models.NewopUserControl;
                if (NewopUserControl) {
                    await NewopUserControl.findOneAndUpdate(
                        { uid: canonicalUid },
                        { $set: { goldCoin: newCoins, diamond: newDiamonds, updatedAt: new Date() } },
                        { upsert: true }
                    ).catch(() => {});
                }

                const nowMs = Date.now();
                let inventory = await UserInventory.findOne({ userId: canonicalUid });
                if (!inventory) {
                    inventory = new UserInventory({ userId: canonicalUid, ownedItems: [] });
                }

                // Prune any already-expired items while keeping valid ones
                const activeItems = (inventory.ownedItems || []).filter(i => {
                    if (!i || !i.itemId) return false;
                    if (i.expiresAt && new Date(i.expiresAt).getTime() <= nowMs) return false;
                    return true;
                });

                const existingOwned = activeItems.find(i => i.itemId === item.itemId);
                let finalExpiresAt = null;
                let finalValidityDays = effectiveDays;

                if (existingOwned && existingOwned.expiresAt === null) {
                    // Already permanent — preserve permanent status
                    finalExpiresAt = null;
                    finalValidityDays = 0;
                } else if (effectiveDays === 0) {
                    // Permanent unlock
                    finalExpiresAt = null;
                    finalValidityDays = 0;
                } else {
                    const baseStartMs = existingOwned && existingOwned.expiresAt
                        ? Math.max(nowMs, new Date(existingOwned.expiresAt).getTime())
                        : nowMs;
                    finalExpiresAt = new Date(baseStartMs + effectiveDays * 24 * 60 * 60 * 1000);
                    finalValidityDays = effectiveDays;
                }

                inventory.ownedItems = activeItems.filter(i => i.itemId !== item.itemId);
                inventory.ownedItems.push({
                    itemId: item.itemId,
                    category: item.category,
                    purchasedAt: new Date(nowMs),
                    expiresAt: finalExpiresAt,
                    validityDays: finalValidityDays
                });

                // Auto-equip via category handler
                const handler = getCategoryHandler(item.category);
                handler.applyEquip(inventory, {
                    itemId: item.itemId,
                    mediaUrl: item.mediaUrl,
                    itemName: item.name,
                    tagText: item.metadata?.previewTagText || item.name,
                    vipNumber: item.metadata?.vipNumber || item.name,
                    expiresAt: finalExpiresAt
                });

                await inventory.save();
                const enrichedInventory = enrichInventoryForClient(inventory);
                await cacheService.invalidateUserInventoryCache(canonicalUid);
                await cacheService.syncUserInventoryCache(canonicalUid, enrichedInventory);

                const txId = `store_${crypto.randomUUID()}`;
                await StorePurchase.create({
                    userId: canonicalUid,
                    itemId: item.itemId,
                    category: item.category,
                    pricePaid: cost,
                    validityDays: finalValidityDays,
                    balanceBefore,
                    balanceAfter
                }).catch(() => {});

                WalletTransaction.create({
                    txId,
                    type: 'STORE_PURCHASE',
                    senderUid: canonicalUid,
                    receiverUid: canonicalUid,
                    giftId: item.itemId,
                    giftName: `${item.name} (${finalValidityDays === 0 ? 'Permanent' : `${finalValidityDays}d`})`,
                    coinsDelta: useCoins ? -cost : 0,
                    diamondsDelta: useCoins ? 0 : -cost,
                    senderCoinsAfter: newCoins,
                    senderDiamondsAfter: newDiamonds
                }).catch(() => {});

                storeRealtime.emitInventoryUpdated(canonicalUid, {
                    equipped: enrichedInventory.equipped,
                    ownedItems: enrichedInventory.ownedItems
                });

                return res.json({
                    success: true,
                    message: `${item.name} unlocked and equipped!`,
                    transactionId: txId,
                    pricePaid: cost,
                    validityDays: finalValidityDays,
                    currencyType: useCoins ? 'coins' : 'diamonds',
                    newDiamonds,
                    newCoins,
                    item,
                    inventory: enrichedInventory
                });
            });
        } catch (err) {
            console.error('❌ [StorePurchaseController] Buy Item Error:', err);
            return res.status(500).json({ success: false, message: err.message || 'Purchase failed' });
        }
    }
};

module.exports = storePurchaseController;