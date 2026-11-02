const express = require('express');
const router = express.Router();
const emojiController = require('../controllers/emojiController');

// Public active emoji catalog endpoint for in-room bottom sheet
router.get('/active', emojiController.getActiveEmojis);

module.exports = router;