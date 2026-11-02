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
const emojiUploadMiddleware = upload.fields([
    { name: 'mediaFile', maxCount: 1 },
    { name: 'media', maxCount: 1 }
]);

router.get('/emojis', NewopController.requireNewopAdmin, NewopController.getEmojis);
router.post('/emojis/create', NewopController.requireNewopAdmin, emojiUploadMiddleware, NewopController.addEmoji);
router.post('/emojis/add', NewopController.requireNewopAdmin, emojiUploadMiddleware, NewopController.addEmoji);
router.put('/emojis/edit/:emojiId', NewopController.requireNewopAdmin, emojiUploadMiddleware, NewopController.editEmoji);
router.post('/emojis/edit', NewopController.requireNewopAdmin, emojiUploadMiddleware, NewopController.editEmoji);
router.delete('/emojis/delete/:emojiId', NewopController.requireNewopAdmin, NewopController.deleteEmoji);
router.post('/emojis/delete', NewopController.requireNewopAdmin, NewopController.deleteEmoji);

// Merchant & Coin Seller Management Endpoints (100% Zero-Trust Backend)
const MerchantController = require('../controllers/merchantController');
router.get('/merchants', NewopController.requireNewopAdmin, MerchantController.getAllMerchants);
router.post('/merchants/add', NewopController.requireNewopAdmin, MerchantController.addMerchant);
router.post('/merchants/remove', NewopController.requireNewopAdmin, MerchantController.removeMerchant);
router.post('/merchants/allocate-stock', NewopController.requireNewopAdmin, MerchantController.allocateStock);
router.get('/merchants/transactions', NewopController.requireNewopAdmin, MerchantController.getAllTransactions);

// Diamond (Finance) Management Endpoints (100% Pure MongoDB Atlas + Redis, Zero Firestore)
const DiamondFinanceController = require('../controllers/diamondFinanceController');
router.get('/diamond/overview', NewopController.requireNewopAdmin, DiamondFinanceController.getOverview);
router.get('/diamond/top-holders', NewopController.requireNewopAdmin, DiamondFinanceController.getTopHolders);
router.get('/diamond/ledger', NewopController.requireNewopAdmin, DiamondFinanceController.getLedger);
router.post('/diamond/adjust', NewopController.requireNewopAdmin, DiamondFinanceController.adjustDiamonds);
router.post('/diamond/freeze-wallet', NewopController.requireNewopAdmin, DiamondFinanceController.setWalletStatus);

// Banner & Login Page Management Endpoints (100% Dynamic MongoDB Atlas + Cloudinary + Redis, Zero Firestore)
const bannerController = require('../controllers/bannerController');
const bannerUploadMiddleware = upload.fields([
    { name: 'bannerFile', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]);

router.get('/banners', NewopController.requireNewopAdmin, bannerController.getAllBanners);
router.post('/banners/create', NewopController.requireNewopAdmin, bannerUploadMiddleware, bannerController.createBanner);
router.post('/banners/add', NewopController.requireNewopAdmin, bannerUploadMiddleware, bannerController.createBanner);
router.put('/banners/edit/:id', NewopController.requireNewopAdmin, bannerUploadMiddleware, bannerController.updateBanner);
router.post('/banners/edit', NewopController.requireNewopAdmin, bannerUploadMiddleware, bannerController.updateBanner);
router.delete('/banners/delete/:id', NewopController.requireNewopAdmin, bannerController.deleteBanner);
router.post('/banners/delete', NewopController.requireNewopAdmin, bannerController.deleteBanner);

module.exports = router;

