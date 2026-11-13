const { STORE_CATEGORIES } = require('../store.constants');

/**
 * VipId Category Handler
 * Special vanity/numeric VIP IDs.
 */
module.exports = {
    category: STORE_CATEGORIES.VIP_ID,
    defaultEmoji: '💎',
    equipSlotKey: 'vipId',

    enrichMetadata(existingMeta = {}, rawBody = {}) {
        const vipNumber = String(
            rawBody.vipNumber || existingMeta.vipNumber || rawBody.name || ''
        ).replace(/\s+/g, '').trim();
        return {
            ...existingMeta,
            vipNumber
        };
    },

    applyEquip(inventory, { itemId, vipNumber, itemName, expiresAt = null }) {
        const resolvedNumber = String(vipNumber || itemName || itemId || '').trim();
        inventory.equipped.vipId = {
            vipNumber: resolvedNumber || null,
            expiresAt: expiresAt || null
        };
    },

    applyUnequip(inventory) {
        inventory.equipped.vipId = { vipNumber: null, expiresAt: null };
    }
};
