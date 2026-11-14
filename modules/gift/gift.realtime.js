/**
 * Real-time WebSocket broadcaster for Gift Catalog & Category synchronization.
 */
function broadcastGiftCatalogUpdate(payload) {
    try {
        const setupRoomSocket = require('../../sockets/roomSocket');
        if (typeof setupRoomSocket.broadcastGiftCatalogSync === 'function') {
            setupRoomSocket.broadcastGiftCatalogSync(payload);
        }
    } catch (e) {
        console.warn('[GiftRealtime] WebSocket broadcast skipped:', e.message);
    }
}

module.exports = {
    broadcastGiftCatalogUpdate
};
