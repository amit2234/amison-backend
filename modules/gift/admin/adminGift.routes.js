const express = require('express');
const router = express.Router();
const adminGiftController = require('./adminGift.controller');
const { verifyAuthenticatedUser, requireNewopAdmin } = require('../../../middleware/authMiddleware');
const { upload } = require('../../../services/cloudinaryService');

// Accept single uploaded file under any standard field name ('mediaFile', 'file', 'animFile', 'iconFile')
const flexibleGiftUpload = upload.any();

// Admin Gift Catalog Read & Management
router.get('/', requireNewopAdmin, adminGiftController.getGifts);
router.get('/active', verifyAuthenticatedUser, adminGiftController.getActiveGifts);
router.get('/categories', verifyAuthenticatedUser, adminGiftController.getActiveGiftCategories);

// Admin Category CRUD
router.post('/categories', requireNewopAdmin, adminGiftController.upsertGiftCategory);
router.delete('/categories/:categoryId', requireNewopAdmin, adminGiftController.deleteGiftCategory);
router.post('/categories/delete', requireNewopAdmin, adminGiftController.deleteGiftCategory);

// Admin Gift Upload / Create / Edit / Toggle / Delete
router.post('/upload-media', requireNewopAdmin, flexibleGiftUpload, adminGiftController.uploadMediaOnly);
router.post('/create', requireNewopAdmin, flexibleGiftUpload, adminGiftController.addGift);
router.post('/add', requireNewopAdmin, flexibleGiftUpload, adminGiftController.addGift);
router.post('/upload', requireNewopAdmin, flexibleGiftUpload, adminGiftController.addGift);
router.put('/edit/:giftId', requireNewopAdmin, flexibleGiftUpload, adminGiftController.editGift);
router.post('/edit', requireNewopAdmin, flexibleGiftUpload, adminGiftController.editGift);
router.post('/toggle-active', requireNewopAdmin, adminGiftController.toggleActive);
router.delete('/delete/:giftId', requireNewopAdmin, adminGiftController.deleteGift);
router.post('/delete', requireNewopAdmin, adminGiftController.deleteGift);
router.delete('/clear', requireNewopAdmin, adminGiftController.clearAllGifts);
router.post('/clear', requireNewopAdmin, adminGiftController.clearAllGifts);

module.exports = router;
