const express = require('express');
const router = express.Router();
const RoomController = require('../controllers/roomController');
const { upload } = require('../services/cloudinaryService');
const { extractVerifiedUidOptional } = require('../middleware/authMiddleware');

router.get('/live', RoomController.getLiveRooms);
router.get('/search', RoomController.searchRooms);
router.get('/owner/:uid', RoomController.getOwnerRoom);
router.post('/create', RoomController.createOrUpdateRoom);
router.post('/create-or-update', RoomController.createOrUpdateRoom);
router.post('/update', RoomController.updateRoomDetails);
router.post('/close', RoomController.closeRoom);
router.get('/explore', RoomController.getExploreRooms);
router.post('/upload-chat-media', upload.single('mediaFile'), RoomController.uploadChatMedia);
router.post('/upload-cover', upload.single('mediaFile'), RoomController.uploadCover);
router.post('/kick', extractVerifiedUidOptional, RoomController.kickUser);
router.get('/kick-status', RoomController.checkKickStatus);
router.post('/unban', RoomController.unbanUser);
router.post('/role', extractVerifiedUidOptional, RoomController.updateMemberRole);
router.get('/:id', RoomController.getRoomDetails);

module.exports = router;
