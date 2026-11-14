const express = require('express');
const router = express.Router();
const messagingController = require('./messaging.controller');
const { verifyAuthenticatedUser } = require('../../middleware/authMiddleware');

router.use(verifyAuthenticatedUser);

router.post('/send', messagingController.sendMessage);

router.get('/conversations/:uid', messagingController.getConversations);
router.get('/history/:conversationId', messagingController.getHistory);

router.post('/read', messagingController.markRead);
router.post('/recall', messagingController.recallMessage);
router.post('/delete', messagingController.deleteMessage);

router.post('/theme', messagingController.setTheme);
router.get('/theme/:conversationId', messagingController.getTheme);

module.exports = router;
