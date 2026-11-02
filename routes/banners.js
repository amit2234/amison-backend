const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');

// Public route to fetch active banners (Home carousel or Login screen)
// Fast cached via Redis & MongoDB Atlas
router.get('/active', bannerController.getActiveBanners);
router.get('/', bannerController.getActiveBanners);

module.exports = router;