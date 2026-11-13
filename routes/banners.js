const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const { verifyAuthenticatedUser } = require('../middleware/authMiddleware');

router.use(verifyAuthenticatedUser);

// Active banners (Home carousel / Login screen)
router.get('/active', bannerController.getActiveBanners);
router.get('/', bannerController.getActiveBanners);

module.exports = router;
