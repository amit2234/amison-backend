const cacheService = require('../../services/cacheService');

/**
 * Messaging Cache & Presence Adapter
 * Delegates to central cacheService so /ws/chat presence and unread counters
 * remain shared across all modules (coupleService, merchantAuthService, etc.).
 */
const messagingCache = {
    setUserOnline(userId, ws) {
        return cacheService.setUserOnline(userId, ws);
    },

    removeUserOnline(userId) {
        return cacheService.removeUserOnline(userId);
    },

    getOnlineUserSocket(userId) {
        return cacheService.getOnlineUserSocket(userId);
    },

    isUserOnline(userId) {
        return cacheService.isUserOnline(userId);
    },

    emitToUser(userId, packet) {
        return cacheService.emitToUser(userId, packet);
    },

    incrementUnread(receiverId, conversationId) {
        return cacheService.incrementUnread(receiverId, conversationId);
    },

    clearUnread(uid, conversationId) {
        return cacheService.clearUnread(uid, conversationId);
    }
};

module.exports = messagingCache;
