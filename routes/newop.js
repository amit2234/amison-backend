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

// Store Management Endpoints (100% Backend-Driven)
router.get('/store/items', NewopController.requireNewopAdmin, NewopController.getStoreItems);
router.post('/store/add', NewopController.requireNewopAdmin, NewopController.addStoreItem);
router.put('/store/edit/:itemId', NewopController.requireNewopAdmin, NewopController.editStoreItem);
router.post('/store/edit', NewopController.requireNewopAdmin, NewopController.editStoreItem);
router.delete('/store/delete/:itemId', NewopController.requireNewopAdmin, NewopController.deleteStoreItem);
router.post('/store/delete', NewopController.requireNewopAdmin, NewopController.deleteStoreItem);
router.post('/store/grant', NewopController.requireNewopAdmin, NewopController.grantStoreItem);

// Dynamic Voice Room Gifts Endpoints (100% Pure MongoDB + Cloudinary + Redis + WS)
const { upload } = require('../services/cloudinaryService');
const giftUploadMiddleware = upload.fields([
    { name: 'iconFile', maxCount: 1 },
    { name: 'animFile', maxCount: 1 }
]);

router.get('/gifts', NewopController.requireNewopAdmin, NewopController.getGifts);
router.get('/gifts/active', NewopController.getActiveGifts);
router.post('/gifts/create', NewopController.requireNewopAdmin, giftUploadMiddleware, NewopController.addGift);
router.post('/gifts/add', NewopController.requireNewopAdmin, giftUploadMiddleware, NewopController.addGift);
router.put('/gifts/edit/:giftId', NewopController.requireNewopAdmin, giftUploadMiddleware, NewopController.editGift);
router.post('/gifts/edit', NewopController.requireNewopAdmin, giftUploadMiddleware, NewopController.editGift);
router.delete('/gifts/delete/:giftId', NewopController.requireNewopAdmin, NewopController.deleteGift);
router.post('/gifts/delete', NewopController.requireNewopAdmin, NewopController.deleteGift);

module.exports = router;
