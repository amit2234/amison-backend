const { STORE_CATEGORIES } = require('../store.constants');

/**
 * Rings Category Handler
 * Couple / CP Rings & intimate bond effects.
 */
module.exports = {
    category: STORE_CATEGORIES.RINGS,
    defaultEmoji: '💍',
    equipSlotKey: 'ring',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        return {
            ...existingMeta,
            coupleOnly: rawBody.coupleOnly !== undefined ? Boolean(rawBody.coupleOnly) : Boolean(existingMeta.coupleOnly)
        };
    },

    applyEquip(inventory, { itemId, expiresAt = null }) {
        inventory.equipped.ring = {
            itemId,
            expiresAt: expiresAt || null
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.ring = { itemId: null, expiresAt: null };
    }
};
