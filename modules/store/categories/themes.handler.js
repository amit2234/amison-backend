const { STORE_CATEGORIES } = require('../store.constants');

/**
 * Theme Category Handler
 * Voice room background themes (gradients, animated SVGA/GIF/SVG wallpapers).
 */
module.exports = {
    category: STORE_CATEGORIES.THEME,
    defaultEmoji: '🎨',
    equipSlotKey: 'theme',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        return {
            ...existingMeta,
            isRoomBackground: true,
            accentColor: String(rawBody.accentColor || existingMeta.accentColor || '#00ACC1').trim()
        };
    },

    applyEquip(inventory, { itemId, mediaUrl }) {
        inventory.equipped.theme = {
            itemId,
            mediaUrl: mediaUrl || ''
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.theme = { itemId: 'theme_amison_light', mediaUrl: null };
    }
};
