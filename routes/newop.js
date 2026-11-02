const express = require('express');
const router = express.Router();
const NewopController = require('../controllers/newopController');

// Dynamic Access & Authentication Endpoints
router.get('/check-access/:uid', NewopController.checkAccess);
router.post('/login', NewopController.login);

// User Management Endpoints
router.get('/users', NewopController.requireNewopAdmin, NewopController.getUsers);
router.post('/user/ban', NewopController.requireNewopAdmin, NewopController.banUser);
router.post('/user/update', NewopController.requireNewopAdmin, NewopController.updateUser);
router.post('/user/reset-photos', NewopController.requireNewopAdmin, NewopController.resetPhotos);

// Room Management Endpoints
router.get('/rooms', NewopController.requireNewopAdmin, NewopController.getRooms);
router.get('/room/:id', NewopController.requireNewopAdmin, NewopController.getRoomInfo);
router.post('/room/update', NewopController.requireNewopAdmin, NewopController.updateRoom);
router.post('/room/block', NewopController.requireNewopAdmin, NewopController.blockRoom);
router.post('/room/reset-photos', NewopController.requireNewopAdmin, NewopController.resetRoomPhotos);

// ZEGO-RTC Configuration Endpoints
router.get('/zego-config', NewopController.getZegoConfig);
router.post('/zego-config', NewopController.requireNewopAdmin, NewopController.updateZegoConfig);

module.exports = router;
