const express = require('express');
const router = express.Router();
const adminStoreController = require('./adminStore.controller');
const { requireNewopAdmin } = require('../../../middleware/authMiddleware');
const { upload } = require('../../../services/cloudinaryService');

// Enforce Zero-Trust Admin Authorization
router.use(requireNewopAdmin);

// Accept any single uploaded media field ('mediaFile' or legacy 'media') cleanly
const flexibleStoreUpload = upload.any();

router.post('/upload-media', flexibleStoreUpload, adminStoreController.uploadMediaOnly);
router.post('/upload', flexibleStoreUpload, adminStoreController.uploadAndCreateItem);
router.post('/add', flexibleStoreUpload, adminStoreController.uploadAndCreateItem);
router.get('/items', adminStoreController.getStoreItems);
router.post('/edit', flexibleStoreUpload, adminStoreController.editStoreItem);
router.put('/edit/:itemId', flexibleStoreUpload, adminStoreController.editStoreItem);
router.post('/toggle-active', adminStoreController.toggleActive);
router.post('/delete', adminStoreController.deleteStoreItem);
router.delete('/delete/:itemId', adminStoreController.deleteStoreItem);
router.post('/grant', adminStoreController.grantStoreItem);

module.exports = router;
