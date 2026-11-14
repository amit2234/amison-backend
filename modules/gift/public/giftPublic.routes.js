const express = require('express');
const router = express.Router();
const giftCatalogController = require('./giftCatalog.controller');
const { verifyAuthenticatedUser } = require('../../../middleware/authMiddleware');

router.get('/active', verifyAuthenticatedUser, giftCatalogController.getActiveGifts);
router.get('/categories', verifyAuthenticatedUser, giftCatalogController.getActiveCategories);

module.exports = router;
