const { STORE_CATEGORIES } = require('../store.constants');

/**
 * TextBubble Category Handler
 * Custom chat message bubble skins and tint metadata.
 */
module.exports = {
    category: STORE_CATEGORIES.TEXT_BUBBLE,
    defaultEmoji: '💬',
    equipSlotKey: 'bubble',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        return {
            ...existingMeta,
            bubbleColor: String(rawBody.bubbleColor || existingMeta.bubbleColor || '#6366F1').trim(),
            textColor: String(rawBody.textColor || existingMeta.textColor || '#FFFFFF').trim()
        };
    },

    applyEquip(inventory, { itemId, mediaUrl }) {
        inventory.equipped.bubble = {
            itemId,
            mediaUrl: mediaUrl || ''
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.bubble = { itemId: null, mediaUrl: null };
    }
};
