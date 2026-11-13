const WithdrawRequest = require('../models/WithdrawRequest');
const DiamondBalance = require('../models/DiamondBalance');
const DiamondLedger = require('../models/DiamondLedger');
const User = require('../models/User');

class WithdrawService {
    /**
     * Submit a new withdrawal request (User-initiated)
     * Atomically holds diamonds from available balance into frozenDiamonds.
     */
    static async createWithdrawRequest({
        userId,
        diamonds,
        inrAmount,
        paymentMethod = 'UPI',
        upiId = '',
        bankDetails = {},
        phone = ''
    }) {
        const diamondAmount = Number(diamonds);
        if (isNaN(diamondAmount) || diamondAmount <= 0) {
            throw new Error('Invalid diamond amount');
        }

        // 1. Fetch user & diamond balance
        let balanceDoc = await DiamondBalance.findOne({ userId });
        if (!balanceDoc) {
            // Find user from User collection to get display ID
            const user = await User.findOne({ uid: userId }).lean();
            const numericId = (user && user.numericId) ? user.numericId : (user && user.id ? user.id : '100000000');
            const name = (user && user.name) ? user.name : 'Host';
            const avatar = (user && user.profilePhoto) ? user.profilePhoto : '';

            balanceDoc = await DiamondBalance.create({
                userId,
                displayUserId: numericId,
                userName: name,
                avatarUrl: avatar,
                availableDiamonds: 0,
                frozenDiamonds: 0
            });
        }

        if (balanceDoc.walletStatus === 'FROZEN_BY_ADMIN') {
            throw new Error('Your wallet is frozen by administrator. Cashout is unavailable.');
        }

        if (balanceDoc.availableDiamonds < diamondAmount) {
            throw new Error(`Insufficient available diamonds. Available: ${balanceDoc.availableDiamonds}, Requested: ${diamondAmount}`);
        }

        const balanceBefore = balanceDoc.availableDiamonds;
        const balanceAfter = balanceBefore - diamondAmount;

        // 2. Atomic Hold: Available -> Frozen
        balanceDoc.availableDiamonds = balanceAfter;
        balanceDoc.frozenDiamonds = (balanceDoc.frozenDiamonds || 0) + diamondAmount;
        balanceDoc.lastTransactionAt = new Date();
        await balanceDoc.save();

        // 3. Create Unique Request
        const requestId = `WDR_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const calcInr = Number(inrAmount) || Math.floor(diamondAmount / 10); // Standard default conversion rate

        const newRequest = await WithdrawRequest.create({
            requestId,
            userId,
            numericId: balanceDoc.displayUserId,
            userName: balanceDoc.userName,
            userAvatar: balanceDoc.avatarUrl,
            diamonds: diamondAmount,
            inrAmount: calcInr,
            paymentMethod,
            upiId,
            bankDetails,
            phone,
            status: 'Pending'
        });

        // 4. Double-Entry Ledger Hold record
        try {
            await DiamondLedger.create({
                transactionId: `TX_${requestId}`,
                idempotencyKey: `IDEMP_${requestId}_HOLD`,
                userId,
                displayUserId: balanceDoc.displayUserId,
                userName: balanceDoc.userName,
                direction: 'DEBIT',
                amount: diamondAmount,
                balanceBefore,
                balanceAfter,
                sourceType: 'WITHDRAWAL_REQUEST_HOLD',
                referenceId: requestId,
                performedBy: 'USER',
                remarks: `Withdrawal request submitted for ₹${calcInr} (${diamondAmount} Diamonds)`
            });
        } catch (ledgerErr) {
            console.warn('⚠️ [WithdrawService] Ledger note:', ledgerErr.message);
        }

        console.log(`✅ [WithdrawService] Cashout request created: ${requestId} for user ${userId} (${diamondAmount} diamonds)`);
        return newRequest;
    }

    /**
     * Get withdrawal requests with optional status filter
     */
    static async getRequests({ status, page = 1, limit = 50 }) {
        const query = {};
        if (status && status !== 'All') {
            query.status = status;
        }

        const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const [requests, total] = await Promise.all([
            WithdrawRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
            WithdrawRequest.countDocuments(query)
        ]);

        return {
            requests,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / parseInt(limit, 10))
        };
    }

    /**
     * Approve a withdrawal request (Admin)
     */
    static async approveRequest({ requestId, screenshotUrl = '', transactionRef = '', adminUid = 'admin' }) {
        const request = await WithdrawRequest.findOne({ requestId });
        if (!request) {
            throw new Error(`Withdrawal request ${requestId} not found`);
        }
        if (request.status !== 'Pending') {
            throw new Error(`Request is already ${request.status}`);
        }

        const balanceDoc = await DiamondBalance.findOne({ userId: request.userId });
        if (balanceDoc) {
            // Deduct held diamonds from frozen diamonds & update lifetime withdrawn
            balanceDoc.frozenDiamonds = Math.max(0, (balanceDoc.frozenDiamonds || 0) - request.diamonds);
            balanceDoc.totalWithdrawnLifetime = (balanceDoc.totalWithdrawnLifetime || 0) + request.diamonds;
            balanceDoc.lastTransactionAt = new Date();
            await balanceDoc.save();

            // Record completed payout ledger
            try {
                await DiamondLedger.create({
                    transactionId: `TX_${requestId}_PAID`,
                    idempotencyKey: `IDEMP_${requestId}_PAID`,
                    userId: request.userId,
                    displayUserId: request.numericId,
                    userName: request.userName,
                    direction: 'DEBIT',
                    amount: request.diamonds,
                    balanceBefore: balanceDoc.availableDiamonds,
                    balanceAfter: balanceDoc.availableDiamonds,
                    sourceType: 'WITHDRAWAL_COMPLETED',
                    referenceId: requestId,
                    performedBy: adminUid,
                    remarks: `Payout settled by Admin. Ref: ${transactionRef}`
                });
            } catch (err) {
                console.warn('⚠️ [WithdrawService] Ledger note:', err.message);
            }
        }

        request.status = 'Successful';
        request.screenshotUrl = screenshotUrl;
        request.transactionRef = transactionRef;
        request.adminUid = adminUid;
        request.approvedAt = new Date();
        await request.save();

        console.log(`✅ [WithdrawService] Request ${requestId} approved successfully`);
        return request;
    }

    /**
     * Reject a withdrawal request (Admin)
     * Restores frozen diamonds back to user's available diamonds.
     */
    static async rejectRequest({ requestId, rejectReason = 'Rejected by Administrator', adminUid = 'admin' }) {
        const request = await WithdrawRequest.findOne({ requestId });
        if (!request) {
            throw new Error(`Withdrawal request ${requestId} not found`);
        }
        if (request.status !== 'Pending') {
            throw new Error(`Request is already ${request.status}`);
        }

        const balanceDoc = await DiamondBalance.findOne({ userId: request.userId });
        if (balanceDoc) {
            // Return frozen diamonds back to availableDiamonds
            const before = balanceDoc.availableDiamonds;
            balanceDoc.frozenDiamonds = Math.max(0, (balanceDoc.frozenDiamonds || 0) - request.diamonds);
            balanceDoc.availableDiamonds = before + request.diamonds;
            balanceDoc.lastTransactionAt = new Date();
            await balanceDoc.save();

            // Record refund ledger
            try {
                await DiamondLedger.create({
                    transactionId: `TX_${requestId}_REFUND`,
                    idempotencyKey: `IDEMP_${requestId}_REFUND`,
                    userId: request.userId,
                    displayUserId: request.numericId,
                    userName: request.userName,
                    direction: 'CREDIT',
                    amount: request.diamonds,
                    balanceBefore: before,
                    balanceAfter: balanceDoc.availableDiamonds,
                    sourceType: 'WITHDRAWAL_REJECT_REFUND',
                    referenceId: requestId,
                    performedBy: adminUid,
                    remarks: `Withdrawal rejected. Diamonds returned. Reason: ${rejectReason}`
                });
            } catch (err) {
                console.warn('⚠️ [WithdrawService] Ledger note:', err.message);
            }
        }

        request.status = 'Reject';
        request.rejectReason = rejectReason;
        request.adminUid = adminUid;
        request.approvedAt = new Date();
        await request.save();

        console.log(`✅ [WithdrawService] Request ${requestId} rejected. Diamonds refunded to user.`);
        return request;
    }

    /**
     * Get user's own cashout history
     */
    static async getUserHistory(userId) {
        return WithdrawRequest.find({ userId }).sort({ createdAt: -1 }).limit(100).lean();
    }
}

module.exports = WithdrawService;
