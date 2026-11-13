const { STORE_CATEGORIES } = require('../store.constants');

/**
 * EntryTag Category Handler
 * Custom room entry badges & tag pills.
 */
module.exports = {
    category: STORE_CATEGORIES.ENTRY_TAG,
    defaultEmoji: '🏷️',
    equipSlotKey: 'entryTag',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        const previewTagText = String(
            rawBody.previewTagText || rawBody.tagText || existingMeta.previewTagText || rawBody.name || ''
        ).trim();
        return {
            ...existingMeta,
            previewTagText
        };
    },

    applyEquip(inventory, { itemId, tagText, itemName }) {
        const resolvedTag = String(tagText || itemName || itemId || '').trim();
        inventory.equipped.entryTag = {
            tagText: resolvedTag || null
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.entryTag = { tagText: null };
    }
};
