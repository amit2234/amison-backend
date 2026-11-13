const express = require('express');
const router = express.Router();
const { upload } = require('../../services/cloudinaryService');
const { extractVerifiedUidOptional } = require('../../middleware/authMiddleware');
const roomRestController = require('./controllers/roomRest.controller');
const roomMediaController = require('./controllers/roomMedia.controller');

router.get('/live', roomRestController.getLiveRooms);
router.get('/search', roomRestController.searchRooms);
router.get('/owner/:uid', roomRestController.getOwnerRoom);
router.post('/create', roomRestController.createOrUpdateRoom);
router.post('/create-or-update', roomRestController.createOrUpdateRoom);
router.post('/update', roomRestController.updateRoomDetails);
router.post('/close', roomRestController.closeRoom);
router.get('/explore', roomRestController.getExploreRooms);
router.post('/upload-chat-media', upload.single('mediaFile'), roomMediaController.uploadChatMedia);
router.post('/upload-cover', upload.single('mediaFile'), roomMediaController.uploadCover);
router.post('/kick', extractVerifiedUidOptional, roomRestController.kickUser);
router.get('/kick-status', roomRestController.checkKickStatus);
router.post('/unban', roomRestController.unbanUser);
router.post('/role', extractVerifiedUidOptional, roomRestController.updateMemberRole);

// Must come BEFORE parameterized '/:id'
router.get('/:id/state', roomRestController.getRoomState);
router.get('/:id', roomRestController.getRoomDetails);

module.exports = router;
