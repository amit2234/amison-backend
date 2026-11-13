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

// Store Management Endpoints (100% Backend-Driven Modular Architecture)
const newopStoreRoutes = require('../modules/store/admin/adminStore.routes');
router.use('/store', newopStoreRoutes);

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
router.delete('/gifts/clear', NewopController.requireNewopAdmin, NewopController.clearAllGifts);
router.post('/gifts/clear', NewopController.requireNewopAdmin, NewopController.clearAllGifts);


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
router.post('/merchants/assign-role', NewopController.requireNewopAdmin, MerchantController.addMerchant);
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

// Level Management Endpoints (100% Dynamic MongoDB Atlas + Cloudinary + Redis, Zero Firestore)
const LevelController = require('../controllers/levelController');
const levelUploadMiddleware = upload.fields([
    { name: 'iconFile', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]);

router.get('/levels', NewopController.requireNewopAdmin, LevelController.getAllLevels);
router.get('/levels/all', NewopController.requireNewopAdmin, LevelController.getAllLevels);
router.get('/levels/rules', NewopController.requireNewopAdmin, LevelController.getLevelRules);
router.post('/levels/upsert', NewopController.requireNewopAdmin, levelUploadMiddleware, LevelController.upsertLevel);
router.post('/levels/add', NewopController.requireNewopAdmin, levelUploadMiddleware, LevelController.upsertLevel);
router.put('/levels/edit/:id', NewopController.requireNewopAdmin, levelUploadMiddleware, LevelController.upsertLevel);
router.delete('/levels/delete/:id', NewopController.requireNewopAdmin, LevelController.deleteLevel);
router.post('/levels/delete', NewopController.requireNewopAdmin, LevelController.deleteLevel);
router.post('/levels/rules', NewopController.requireNewopAdmin, LevelController.updateRules);
router.post('/levels/seed-defaults', NewopController.requireNewopAdmin, LevelController.seedDefaults);

// Withdrawal Management Endpoints (100% Zero-Trust MongoDB + Cloudinary, Zero Firestore)
const WithdrawController = require('../controllers/withdrawController');
const withdrawUploadMiddleware = upload.fields([
    { name: 'screenshotFile', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]);

router.get('/withdraw/requests', NewopController.requireNewopAdmin, WithdrawController.getRequests);
router.post('/withdraw/approve', NewopController.requireNewopAdmin, withdrawUploadMiddleware, WithdrawController.approveRequest);
router.post('/withdraw/reject', NewopController.requireNewopAdmin, WithdrawController.rejectRequest);

// BD Agent Management Endpoints (100% Zero-Trust MongoDB Atlas, Zero Firestore)
const BdAgentController = require('../controllers/bdAgentController');
router.get('/bd-agents', NewopController.requireNewopAdmin, BdAgentController.getAllAgents);
router.post('/bd-agents/add', NewopController.requireNewopAdmin, BdAgentController.addAgent);
router.post('/bd-agents/update', NewopController.requireNewopAdmin, BdAgentController.updateAgent);
router.post('/bd-agents/remove', NewopController.requireNewopAdmin, BdAgentController.removeAgent);

// Agency Management Endpoints (100% Zero-Trust MongoDB Atlas, Zero Firestore)
const AgencyController = require('../controllers/agencyController');
router.get('/agencies', NewopController.requireNewopAdmin, AgencyController.getAllAgencies);
router.post('/agencies/create', NewopController.requireNewopAdmin, AgencyController.createAgency);
router.post('/agencies/update', NewopController.requireNewopAdmin, AgencyController.updateAgency);
router.post('/agencies/block', NewopController.requireNewopAdmin, AgencyController.blockAgency);
router.get('/agencies/:id/hosts', NewopController.requireNewopAdmin, AgencyController.getAgencyHosts);
router.post('/agencies/hosts/add', NewopController.requireNewopAdmin, AgencyController.addHost);
router.post('/agencies/hosts/remove', NewopController.requireNewopAdmin, AgencyController.removeHost);

module.exports = router;


