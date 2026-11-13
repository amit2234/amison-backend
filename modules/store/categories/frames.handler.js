const { STORE_CATEGORIES } = require('../store.constants');

/**
 * Frames Category Handler
 * Avatar ring bezels (SVGA, SVG, PAG, PNG, GIF) using 1.58x aperture ratio.
 */
module.exports = {
    category: STORE_CATEGORIES.FRAMES,
    defaultEmoji: '👑',
    equipSlotKey: 'frame',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        const apertureRatio = Number(rawBody.apertureRatio || existingMeta.apertureRatio || 1.58);
        return {
            ...existingMeta,
            apertureRatio: Number.isFinite(apertureRatio) && apertureRatio > 1.0 ? apertureRatio : 1.58
        };
    },

    applyEquip(inventory, { itemId, mediaUrl }) {
        inventory.equipped.frame = {
            itemId,
            mediaUrl: mediaUrl || ''
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.frame = { itemId: null, mediaUrl: null };
    }
};
