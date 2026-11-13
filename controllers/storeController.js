const storeCatalogController = require('../modules/store/public/storeCatalog.controller');
const storeInventoryController = require('../modules/store/public/storeInventory.controller');
const storePurchaseController = require('../modules/store/public/storePurchase.controller');

module.exports = {
    getVersion: storeCatalogController.getVersion,
    getCatalog: storeCatalogController.getCatalog,
    getInventory: storeInventoryController.getInventory,
    buyItem: storePurchaseController.buyItem,
    equipItem: storeInventoryController.equipItem,
    unequipItem: storeInventoryController.unequipItem
};
