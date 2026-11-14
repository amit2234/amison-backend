/**
 * Backward-Compatible Facade for Modular Conversation Controller (/backend/modules/messaging/messaging.controller.js)
 */
const messagingController = require('../modules/messaging/messaging.controller');
module.exports = {
    getConversations: messagingController.getConversations
};