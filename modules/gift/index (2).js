/**
 * Modular Gift Domain Entry Point
 * Mirrors backend/modules/store and backend/modules/room for fault-isolated gift catalog management.
 */
module.exports = {
    constants: require('./gift.constants'),
    validation: require('./gift.validation'),
    cache: require('./gift.cache'),
    mediaService: require('./gift.media.service'),
    realtime: require('./gift.realtime'),
    publicRoutes: require('./public/giftPublic.routes'),
    adminRoutes: require('./admin/adminGift.routes'),
    publicController: require('./public/giftCatalog.controller'),
    adminController: require('./admin/adminGift.controller'),
    adminService: require('./admin/adminGift.service')
};
