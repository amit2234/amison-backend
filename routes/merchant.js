const express = require('express');
const router = express.Router();
const MerchantController = require('../controllers/merchantController');

// In-App Merchant / Seller Endpoints (100% Zero-Trust Backend)
router.get('/my-stock/:userId', MerchantController.getMyStock);
router.get('/history/:userId', MerchantController.getMyHistory);
router.post('/transfer', MerchantController.rechargeUser);
router.post('/recharge-user', MerchantController.rechargeUser);

module.exports = router;