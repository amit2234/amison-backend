/**
 * Backward-Compatible Facade for Modular Messaging WebSocket (/backend/modules/messaging/messaging.socket.js)
 */
const { setupChatSocket } = require('../modules/messaging/messaging.socket');
module.exports = setupChatSocket;