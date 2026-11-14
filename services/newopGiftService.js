/**
 * Backward-Compatible Facade for Modular Admin Gift Service (/backend/modules/gift/admin/adminGift.service.js)
 */
const adminGiftService = require('../modules/gift/admin/adminGift.service');

module.exports = {
    async getAllGifts(callerUid) {
        const res = await adminGiftService.getAllGifts(callerUid);
        return res.gifts;
    },
    getActiveGifts: adminGiftService.getActiveGifts,
    getActiveCategories: adminGiftService.getActiveCategories,
    upsertCategory: adminGiftService.upsertCategory,
    deleteCategory: adminGiftService.deleteCategory,
    addGift: adminGiftService.addGift,
    editGift: adminGiftService.editGift,
    toggleGiftActive: adminGiftService.toggleGiftActive,
    deleteGift: adminGiftService.deleteGift,
    clearAllGifts: adminGiftService.clearAllGifts
};