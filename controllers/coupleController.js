const coupleService = require('../services/coupleService');
const CoupleInvitation = require('../models/CoupleInvitation');

const coupleController = {
    /**
     * GET /api/couple/my-bond
     * Returns the active couple bond for the caller
     */
    async getMyBond(req, res) {
        try {
            const uid = req.callerUid || req.query.userId || req.user?.uid;
            if (!uid) {
                return res.status(400).json({ success: false, error: 'User ID is required' });
            }

            const bond = await coupleService.getActiveBond(uid);
            return res.json({
                success: true,
                hasPartner: !!bond,
                bond: bond || null
            });
        } catch (error) {
            console.error('❌ [CoupleController.getMyBond] Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    /**
     * POST /api/couple/invite
     * Send CP invitation to another user
     */
    async sendInvite(req, res) {
        try {
            const senderId = req.callerUid || req.body.senderId || req.user?.uid;
            const { receiverId, proposalText } = req.body;

            if (!senderId || !receiverId) {
                return res.status(400).json({ success: false, error: 'senderId and receiverId are required' });
            }

            const result = await coupleService.sendInvitation({
                senderId,
                receiverId,
                proposalText
            });

            return res.status(201).json(result);
        } catch (error) {
            console.error('❌ [CoupleController.sendInvite] Error:', error);
            return res.status(400).json({ success: false, error: error.message });
        }
    },

    /**
     * POST /api/couple/respond
     * Accept or Reject an invitation
     */
    async respondInvite(req, res) {
        try {
            const userId = req.callerUid || req.body.userId || req.user?.uid;
            const { invitationId, accept } = req.body;

            if (!invitationId) {
                return res.status(400).json({ success: false, error: 'invitationId is required' });
            }

            const result = await coupleService.respondToInvitation({
                invitationId,
                userId,
                accept: Boolean(accept)
            });

            return res.json(result);
        } catch (error) {
            console.error('❌ [CoupleController.respondInvite] Error:', error);
            return res.status(400).json({ success: false, error: error.message });
        }
    },

    /**
     * GET /api/couple/invitations/pending
     * Retrieve received pending invitations
     */
    async getPendingInvitations(req, res) {
        try {
            const uid = req.callerUid || req.query.userId || req.user?.uid;
            if (!uid) {
                return res.status(400).json({ success: false, error: 'User ID is required' });
            }

            const invites = await CoupleInvitation.find({
                receiverId: uid,
                status: 'PENDING',
                expiresAt: { $gt: new Date() }
            }).sort({ createdAt: -1 }).lean();

            return res.json({
                success: true,
                invitations: invites
            });
        } catch (error) {
            console.error('❌ [CoupleController.getPendingInvitations] Error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }
};

module.exports = coupleController;