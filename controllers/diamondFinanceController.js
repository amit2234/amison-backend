const diamondFinanceService = require('../services/diamondFinanceService');

const diamondFinanceController = {
    /**
     * GET /api/newop/diamond/overview
     */
    async getOverview(req, res) {
        try {
            const data = await diamondFinanceService.getOverview();
            res.json({ success: true, data });
        } catch (error) {
            console.error('❌ [DiamondFinanceController] getOverview error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * GET /api/newop/diamond/top-holders
     */
    async getTopHolders(req, res) {
        try {
            const { page = 1, limit = 50, search = '', role = 'ALL' } = req.query;
            const data = await diamondFinanceService.getTopHolders({ page, limit, search, role });
            res.json({ success: true, ...data });
        } catch (error) {
            console.error('❌ [DiamondFinanceController] getTopHolders error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * GET /api/newop/diamond/ledger
     */
    async getLedger(req, res) {
        try {
            const { page = 1, limit = 50, userId = '', displayUserId = '', sourceType = '' } = req.query;
            const data = await diamondFinanceService.getLedger({ page, limit, userId, displayUserId, sourceType });
            res.json({ success: true, ...data });
        } catch (error) {
            console.error('❌ [DiamondFinanceController] getLedger error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * POST /api/newop/diamond/adjust
     */
    async adjustDiamonds(req, res) {
        try {
            const { targetDisplayUserId, actionType, amount, reason } = req.body;
            const adminEmail = req.user?.email || req.callerUid || 'Super Master';
            const adminUid = req.callerUid || req.user?.uid || '';
            const ipAddress = req.ip || req.connection?.remoteAddress || '';

            const result = await diamondFinanceService.adjustDiamonds({
                targetDisplayUserId,
                actionType,
                amount,
                reason,
                adminEmail,
                adminUid,
                ipAddress
            });

            res.json({
                success: true,
                message: `Successfully ${result.actionType.toLowerCase()}ed ${result.amount} diamonds for ${result.displayUserId}`,
                data: result
            });
        } catch (error) {
            console.error('❌ [DiamondFinanceController] adjustDiamonds error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    },

    /**
     * POST /api/newop/diamond/freeze-wallet
     */
    async setWalletStatus(req, res) {
        try {
            const { targetDisplayUserId, status, reason } = req.body;
            const adminEmail = req.user?.email || req.callerUid || 'Super Master';
            const adminUid = req.callerUid || req.user?.uid || '';
            const ipAddress = req.ip || req.connection?.remoteAddress || '';

            const result = await diamondFinanceService.setWalletStatus({
                targetDisplayUserId,
                status,
                reason,
                adminEmail,
                adminUid,
                ipAddress
            });

            res.json({
                success: true,
                message: `Wallet status updated to ${result.walletStatus}`,
                data: result
            });
        } catch (error) {
            console.error('❌ [DiamondFinanceController] setWalletStatus error:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }
};

module.exports = diamondFinanceController;
