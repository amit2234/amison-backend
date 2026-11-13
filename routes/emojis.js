const express = require('express');
const router = express.Router();
const emojiController = require('../controllers/emojiController');
const { verifyAuthenticatedUser } = require('../middleware/authMiddleware');

router.use(verifyAuthenticatedUser);

// Active emoji catalog endpoint for in-room bottom sheet
router.get('/active', emojiController.getActiveEmojis);

module.exports = router;
