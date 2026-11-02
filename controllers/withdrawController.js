const WithdrawService = require('../services/withdrawService');
const { uploadMediaStream } = require('../services/cloudinaryService');

class WithdrawController {
    /**
     * User submits a withdrawal request
     * POST /api/wallet/withdraw
     */
    static async submitRequest(req, res) {
        try {
            const userId = req.user ? (req.user.uid || req.user.id) : req.body.userId;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }

            const { diamonds, inrAmount, paymentMethod, upiId, bankDetails, phone } = req.body;
            const newRequest = await WithdrawService.createWithdrawRequest({
                userId,
                diamonds,
                inrAmount,
                paymentMethod,
                upiId,
                bankDetails,
                phone
            });

            return res.json({
                success: true,
                message: 'Withdrawal request submitted successfully. Diamonds are on hold.',
                data: newRequest
            });
        } catch (err) {
            console.error('❌ [WithdrawController] submitRequest error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * User views their own withdrawal history
     * GET /api/wallet/withdraw/my-history
     */
    static async getUserHistory(req, res) {
        try {
            const userId = req.user ? (req.user.uid || req.user.id) : req.query.userId;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }

            const list = await WithdrawService.getUserHistory(userId);
            return res.json({
                success: true,
                count: list.length,
                data: list
            });
        } catch (err) {
            console.error('❌ [WithdrawController] getUserHistory error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Admin fetches withdrawal requests
     * GET /api/newop/withdraw/requests?status=Pending|Successful|Reject
     */
    static async getRequests(req, res) {
        try {
            const status = req.query.status || 'Pending';
            const page = req.query.page || 1;
            const limit = req.query.limit || 50;

            const result = await WithdrawService.getRequests({ status, page, limit });
            return res.json({
                success: true,
                status,
                ...result
            });
        } catch (err) {
            console.error('❌ [WithdrawController] getRequests error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Admin approves a withdrawal request and uploads payment screenshot
     * POST /api/newop/withdraw/approve
     */
    static async approveRequest(req, res) {
        try {
            const body = req.body || {};
            const requestId = body.requestId;
            if (!requestId) {
                return res.status(400).json({ success: false, error: 'requestId is required' });
            }

            let screenshotUrl = body.screenshotUrl || '';

            // Handle optional screenshot image file upload
            if (req.files && (req.files.screenshotFile || req.files.image)) {
                const file = (req.files.screenshotFile && req.files.screenshotFile[0]) || (req.files.image && req.files.image[0]);
                if (file) {
                    const uploadRes = await uploadMediaStream(file.buffer, {
                        folder: 'amison/withdraw_receipts',
                        public_id: `receipt_${requestId}_${Date.now()}`
                    });
                    screenshotUrl = uploadRes.secure_url;
                }
            }

            const approved = await WithdrawService.approveRequest({
                requestId,
                screenshotUrl,
                transactionRef: body.transactionRef || '',
                adminUid: req.adminUser ? req.adminUser.uid : 'admin'
            });

            return res.json({
                success: true,
                message: `Withdrawal request ${requestId} approved successfully`,
                data: approved
            });
        } catch (err) {
            console.error('❌ [WithdrawController] approveRequest error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Admin rejects a withdrawal request with reason and refunds diamonds
     * POST /api/newop/withdraw/reject
     */
    static async rejectRequest(req, res) {
        try {
            const { requestId, rejectReason } = req.body;
            if (!requestId) {
                return res.status(400).json({ success: false, error: 'requestId is required' });
            }

            const rejected = await WithdrawService.rejectRequest({
                requestId,
                rejectReason: rejectReason || 'Rejected by Administrator',
                adminUid: req.adminUser ? req.adminUser.uid : 'admin'
            });

            return res.json({
                success: true,
                message: `Withdrawal request ${requestId} rejected. Diamonds refunded to user.`,
                data: rejected
            });
        } catch (err) {
            console.error('❌ [WithdrawController] rejectRequest error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }
}

module.exports = WithdrawController;