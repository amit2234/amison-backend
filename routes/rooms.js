const express = require('express');
const router = express.Router();
const RoomController = require('../controllers/roomController');

router.get('/live', RoomController.getLiveRooms);
router.get('/owner/:uid', RoomController.getOwnerRoom);
router.post('/create', RoomController.createOrUpdateRoom);
router.post('/create-or-update', RoomController.createOrUpdateRoom);
router.post('/close', RoomController.closeRoom);
router.get('/explore', RoomController.getExploreRooms);
router.get('/:id', RoomController.getRoomDetails);

module.exports = router;