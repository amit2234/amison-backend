const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');
const adminStoreRouter = require('./adminStore');

// Mount Admin Store Routes under /api/store/admin
router.use('/admin', adminStoreRouter);

// Public & User Store Endpoints
router.get(['/catalog', '/items'], storeController.getCatalog);
router.get('/inventory/:userId', storeController.getInventory);
router.post('/buy', storeController.buyItem);
router.post('/equip', storeController.equipItem);
router.post('/unequip', storeController.unequipItem);

module.exports = router;