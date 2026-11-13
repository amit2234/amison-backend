const MerchantTransaction = require('../../models/MerchantTransaction');
const { resolveUser } = require('../../utils/userResolver');

const merchantHistoryService = {
    /**
     * Get transaction history for a specific Merchant
     */
    async getMerchantHistory({ userId, limit = 50 }) {
        const userDoc = await resolveUser(userId);
        const uid = userDoc ? userDoc.uid : String(userId).trim();

        return await MerchantTransaction.find({
            $or: [{ merchantId: uid }, { targetUserId: uid }]
        })
            .sort({ createdAt: -1 })
            .limit(Number(limit) || 50)
            .lean();
    },

    /**
     * Get all merchant transactions for Newop History Tab
     */
    async getAllTransactions({ limit = 100, page = 1 } = {}) {
        const lim = Math.min(Number(limit) || 100, 200);
        const skip = (Math.max(Number(page) || 1, 1) - 1) * lim;

        const [items, total] = await Promise.all([
            MerchantTransaction.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(lim)
                .lean(),
            MerchantTransaction.countDocuments({})
        ]);

        return { items, total, page: Number(page) || 1, limit: lim };
    }
};

module.exports = merchantHistoryService;
