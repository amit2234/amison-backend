const express = require('express');
const router = express.Router();
const MerchantController = require('../controllers/merchantController');

const { idempotencyLockMiddleware } = require('../middleware/idempotency');

// In-App Merchant / Seller Endpoints (100% Zero-Trust Backend)
router.get('/my-status/:userId', MerchantController.getMyStatus);
router.get('/status/:userId', MerchantController.getMyStatus);
router.get('/my-stock/:userId', MerchantController.getMyStock);
router.get('/history/:userId', MerchantController.getMyHistory);
router.post('/transfer', idempotencyLockMiddleware, MerchantController.rechargeUser);
router.post('/recharge-user', idempotencyLockMiddleware, MerchantController.rechargeUser);

module.exports = router;