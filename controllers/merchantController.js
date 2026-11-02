const merchantService = require('../services/merchantService');

const merchantController = {
    /**
     * Admin: Get all merchants & sellers
     */
    async getAllMerchants(req, res) {
        try {
            const { role, status } = req.query;
            const merchants = await merchantService.getAllMerchants({ role, status });
            res.json({ success: true, count: merchants.length, data: merchants });
        } catch (error) {
            console.error('❌ [MerchantController] getAllMerchants error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * Admin: Promote a user to Seller or Marchent
     */
    async addMerchant(req, res) {
        try {
            const { userId, role, assignedBy } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }
            const merchant = await merchantService.addOrUpdateMerchant({
                userId,
                role: role || 'seller',
                assignedBy: assignedBy || 'Super Master'
            });
            res.json({ success: true, message: `User promoted to ${merchant.role}`, data: merchant });
        } catch (error) {
            console.error('❌ [MerchantController] addMerchant error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    },

    /**
     * Admin: Remove or Revoke Seller / Marchent
     */
    async removeMerchant(req, res) {
        try {
            const { userId, role } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }
            const result = await merchantService.removeMerchant({ userId, role });
            res.json({ success: true, message: 'Merchant role revoked', data: result });
        } catch (error) {
            console.error('❌ [MerchantController] removeMerchant error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    },

    /**
     * Admin: Allocate Selling Stock to a Merchant
     */
    async allocateStock(req, res) {
        try {
            const { targetUserId, amount, note, adminUid } = req.body;
            if (!targetUserId || !amount) {
                return res.status(400).json({ success: false, message: 'targetUserId and amount are required' });
            }
            const result = await merchantService.allocateStock({
                adminUid: adminUid || 'Super Master',
                targetUserId,
                amount,
                note
            });
            res.json({ success: true, message: `Successfully allocated ${amount} stock coins`, ...result });
        } catch (error) {
            console.error('❌ [MerchantController] allocateStock error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    },

    /**
     * Admin: Get all merchant transactions for Newop history tab
     */
    async getAllTransactions(req, res) {
        try {
            const { limit, page } = req.query;
            const result = await merchantService.getAllTransactions({ limit, page });
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('❌ [MerchantController] getAllTransactions error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * Merchant Action: Recharge user with Coins from Selling Stock
     */
    async rechargeUser(req, res) {
        try {
            const { merchantUid, targetUserId, coins, idempotencyKey, note } = req.body;
            if (!merchantUid || !targetUserId || !coins) {
                return res.status(400).json({
                    success: false,
                    message: 'merchantUid, targetUserId, and coins are required'
                });
            }

            const result = await merchantService.rechargeUser({
                merchantUid,
                targetUserId,
                coins,
                idempotencyKey,
                note
            });

            res.json({ success: true, message: 'Recharge completed successfully', ...result });
        } catch (error) {
            console.error('❌ [MerchantController] rechargeUser error:', error);
            const status = error.status || 400;
            res.status(status).json({ success: false, message: error.message });
        }
    },

    /**
     * Merchant: Get my current live selling stock
     */
    async getMyStock(req, res) {
        try {
            const { userId } = req.params;
            const merchant = await merchantService.getMerchantDetails(userId);
            if (!merchant) {
                return res.json({ success: true, isMerchant: false, sellingStock: 0 });
            }
            res.json({
                success: true,
                isMerchant: true,
                role: merchant.role,
                status: merchant.status,
                sellingStock: merchant.sellingStock,
                totalSold: merchant.totalSold
            });
        } catch (error) {
            console.error('❌ [MerchantController] getMyStock error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * Merchant: Get my personal recharge history
     */
    async getMyHistory(req, res) {
        try {
            const { userId } = req.params;
            const { limit } = req.query;
            const history = await merchantService.getMerchantHistory({ userId, limit });
            res.json({ success: true, count: history.length, data: history });
        } catch (error) {
            console.error('❌ [MerchantController] getMyHistory error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = merchantController;