const adminStoreController = require('../modules/store/admin/adminStore.controller');

module.exports = {
    getAdminItems: adminStoreController.getStoreItems,
    addStoreItem: adminStoreController.uploadAndCreateItem,
    editStoreItem: adminStoreController.editStoreItem,
    deleteStoreItem: adminStoreController.deleteStoreItem,
    grantItemToUser: adminStoreController.grantStoreItem,
    uploadStoreMedia: adminStoreController.uploadAndCreateItem
};
