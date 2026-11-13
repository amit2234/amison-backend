/**
 * Modular Store Domain Entry Point
 * Exports public routes, admin routes, WebSocket setup, cache, media service, and constants.
 */
module.exports = {
    constants: require('./store.constants'),
    validation: require('./store.validation'),
    cache: require('./store.cache'),
    realtime: require('./store.realtime'),
    mediaService: require('./store.media.service'),
    categoryRegistry: require('./categories/categoryRegistry'),
    publicRoutes: require('./public/storePublic.routes'),
    adminRoutes: require('./admin/adminStore.routes'),
    adminService: require('./admin/adminStore.service'),
    publicControllers: {
        catalog: require('./public/storeCatalog.controller'),
        inventory: require('./public/storeInventory.controller'),
        purchase: require('./public/storePurchase.controller')
    },
    adminController: require('./admin/adminStore.controller')
};
