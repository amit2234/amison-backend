const { STORE_CATEGORIES } = require('../store.constants');

/**
 * ProfileCard Category Handler
 * Custom user profile header banners & background cards.
 */
module.exports = {
    category: STORE_CATEGORIES.PROFILE_CARD,
    defaultEmoji: '🪪',
    equipSlotKey: 'profileCard',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        return {
            ...existingMeta,
            accentColor: String(rawBody.accentColor || existingMeta.accentColor || '#8B5CF6').trim()
        };
    },

    applyEquip(inventory, { itemId, mediaUrl }) {
        inventory.equipped.profileCard = {
            itemId,
            mediaUrl: mediaUrl || ''
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.profileCard = { itemId: null, mediaUrl: null };
    }
};
