const express = require('express');
const router = express.Router();
const { verifyAuthenticatedUser } = require('../../../middleware/authMiddleware');

const storeCatalogController = require('./storeCatalog.controller');
const storeInventoryController = require('./storeInventory.controller');
const storePurchaseController = require('./storePurchase.controller');

router.use(verifyAuthenticatedUser);

// Authenticated User Store Endpoints
router.get('/version', storeCatalogController.getVersion);
router.get(['/catalog', '/items'], storeCatalogController.getCatalog);
router.get('/inventory/:userId', storeInventoryController.getInventory);
router.post('/buy', storePurchaseController.buyItem);
router.post('/equip', storeInventoryController.equipItem);
router.post('/unequip', storeInventoryController.unequipItem);

module.exports = router;
