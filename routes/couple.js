const express = require('express');
const router = express.Router();
const coupleController = require('../controllers/coupleController');
const { verifyAuthToken } = require('../middleware/authMiddleware');

// Route: Get active CP bond
router.get('/my-bond', verifyAuthToken, coupleController.getMyBond);
router.get('/bond', verifyAuthToken, coupleController.getMyBond);

// Route: Send CP invitation
router.post('/invite', verifyAuthToken, coupleController.sendInvite);

// Route: Respond to CP invitation (Accept / Reject)
router.post('/respond', verifyAuthToken, coupleController.respondInvite);

// Route: Get pending invitations received
router.get('/invitations/pending', verifyAuthToken, coupleController.getPendingInvitations);

module.exports = router;