const express = require('express');
const router = express.Router();
const WithdrawController = require('../controllers/withdrawController');

// User Wallet cashout routes
router.post('/', WithdrawController.submitRequest);
router.post('/submit', WithdrawController.submitRequest);
router.get('/my-history', WithdrawController.getUserHistory);

module.exports = router;
