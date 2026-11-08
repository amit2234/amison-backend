const express = require('express');
const router = express.Router();
const RoomController = require('../controllers/roomController');

router.get('/live', RoomController.getLiveRooms);
router.get('/owner/:uid', RoomController.getOwnerRoom);
router.post('/create', RoomController.createOrUpdateRoom);
router.post('/create-or-update', RoomController.createOrUpdateRoom);
router.post('/update', RoomController.updateRoomDetails);
router.post('/close', RoomController.closeRoom);
router.get('/explore', RoomController.getExploreRooms);
router.post('/kick', RoomController.kickUser);
router.get('/kick-status', RoomController.checkKickStatus);
router.post('/unban', RoomController.unbanUser);
router.post('/role', RoomController.updateMemberRole);
router.get('/:id', RoomController.getRoomDetails);

module.exports = router;