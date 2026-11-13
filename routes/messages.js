const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const conversationController = require('../controllers/conversationController');

// Send Message
router.post('/send', messageController.sendMessage);

// Fetch Conversations List & History
router.get('/conversations/:uid', conversationController.getConversations);
router.get('/history/:conversationId', messageController.getHistory);

// Message Actions (Read, Recall, Delete)
router.post('/read', messageController.markRead);
router.post('/recall', messageController.recallMessage);
router.post('/delete', messageController.deleteMessage);

// Chat Wallpapers & Custom Theme
router.post('/theme', messageController.setTheme);
router.get('/theme/:conversationId', messageController.getTheme);

module.exports = router;
