/**
 * Backward-Compatible Facade for Modular Room Controller (/backend/modules/room/controllers/roomRest.controller.js)
 */
const restController = require('../modules/room/controllers/roomRest.controller');
const mediaController = require('../modules/room/controllers/roomMedia.controller');

module.exports = {
    ...restController,
    uploadChatMedia: mediaController.uploadChatMedia,
    uploadCover: mediaController.uploadCover
};
