const { STORE_CATEGORIES } = require('../store.constants');

/**
 * EntranceEffect Category Handler
 * Room entry banners / full-screen animated SVGA/PAG/Lottie overlays.
 */
module.exports = {
    category: STORE_CATEGORIES.ENTRANCE_EFFECT,
    defaultEmoji: '🚀',
    equipSlotKey: 'entrance',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        const durationMs = Number(rawBody.durationMs || existingMeta.durationMs || 3500);
        return {
            ...existingMeta,
            durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 3500
        };
    },

    applyEquip(inventory, { itemId, mediaUrl }) {
        inventory.equipped.entrance = {
            itemId,
            mediaUrl: mediaUrl || ''
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.entrance = { itemId: null, mediaUrl: null };
    }
};
