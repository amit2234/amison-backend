const StoreItem = require('../../../models/StoreItem');
const UserInventory = require('../../../models/UserInventory');
const StorePurchase = require('../../../models/StorePurchase');
const Wallet = require('../../../models/Wallet');
const cacheService = require('../../../services/cacheService');
const storeRealtime = require('../store.realtime');
const { getCategoryHandler } = require('../categories/categoryRegistry');

/**
 * Public Store Purchase Controller
 * Atomic currency deduction (Diamonds or Coins per item.currencyType) + auto-equip + audit ledger.
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

            const item = await StoreItem.findOne({ itemId, isActive: true });
            if (!item) {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found in active catalog'
                });
            }

            const cost = Math.max(0, Number(item.price) || 0);
            const useCoins = item.currencyType === 'coins';
            const balanceField = useCoins ? 'coins' : 'diamonds';
            const currencyLabel = useCoins ? 'coins' : 'diamonds';

            const wallet = await Wallet.findOne({ uid: userId });
            const currentBalance = wallet ? (Number(wallet[balanceField]) || 0) : 0;

            if (currentBalance < cost) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient ${currencyLabel}. Required: ${cost}, Available: ${currentBalance}`
                });
            }

            const updatedWallet = await Wallet.findOneAndUpdate(
                { uid: userId, [balanceField]: { $gte: cost } },
                { $inc: { [balanceField]: -cost }, $set: { updatedAt: new Date() } },
                { new: true }
            );

            if (!updatedWallet) {
                return res.status(400).json({
                    success: false,
                    message: `Transaction failed: Insufficient ${currencyLabel}`
                });
            }

            await cacheService.syncWalletCache(userId, updatedWallet.coins, updatedWallet.diamonds);

            const effectiveDays = validityDays !== undefined
                ? Math.max(0, Number(validityDays) || 0)
                : Math.max(0, Number(item.validityDays) || 30);

            const expiresAt = effectiveDays > 0
                ? new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000)
                : null;

            let inventory = await UserInventory.findOne({ userId });
            if (!inventory) {
                inventory = new UserInventory({ userId, ownedItems: [] });
            }

            inventory.ownedItems = inventory.ownedItems.filter(i => i.itemId !== itemId);
            inventory.ownedItems.push({
                itemId: item.itemId,
                category: item.category,
                purchasedAt: new Date(),
                expiresAt,
                validityDays: effectiveDays
            });

            // Auto-equip via category handler
            const handler = getCategoryHandler(item.category);
            handler.applyEquip(inventory, {
                itemId: item.itemId,
                mediaUrl: item.mediaUrl,
                itemName: item.name,
                tagText: item.metadata?.previewTagText || item.name,
                vipNumber: item.metadata?.vipNumber || item.name,
                expiresAt
            });

            await inventory.save();
            await cacheService.invalidateUserInventoryCache(userId);

            await StorePurchase.create({
                userId,
                itemId: item.itemId,
                category: item.category,
                pricePaid: cost,
                validityDays: effectiveDays,
                balanceBefore: currentBalance,
                balanceAfter: Number(updatedWallet[balanceField]) || 0
            });

            storeRealtime.emitInventoryUpdated(userId, {
                equipped: inventory.equipped,
                ownedItems: inventory.ownedItems
            });

            return res.json({
                success: true,
                message: `${item.name} purchased and equipped successfully!`,
                currencyType: item.currencyType || 'diamonds',
                newDiamonds: updatedWallet.diamonds,
                newCoins: updatedWallet.coins,
                item,
                inventory
            });
        } catch (err) {
            console.error('❌ [StorePurchaseController] Buy Item Error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = storePurchaseController;
