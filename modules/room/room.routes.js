const express = require('express');
const router = express.Router();
const { upload } = require('../../services/cloudinaryService');
const { verifyAuthenticatedUser } = require('../../middleware/authMiddleware');
const roomRestController = require('./controllers/roomRest.controller');
const roomMediaController = require('./controllers/roomMedia.controller');

router.use(verifyAuthenticatedUser);

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
router.post('/kick', roomRestController.kickUser);
router.get('/kick-status', roomRestController.checkKickStatus);
router.post('/unban', roomRestController.unbanUser);
router.post('/role', roomRestController.updateMemberRole);

// Must come BEFORE parameterized '/:id'
router.post('/:id/stage-capacity', roomRestController.setStageCapacity);
router.get('/:id/state', roomRestController.getRoomState);
router.get('/:id', roomRestController.getRoomDetails);

module.exports = router;
