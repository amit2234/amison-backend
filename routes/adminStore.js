const express = require('express');
const router = express.Router();
const adminStoreController = require('../controllers/adminStoreController');
const { requireNewopAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinaryService');

// All routes require Newop Admin Authorization
router.use(requireNewopAdmin);

// Store Item Management
router.get('/items', adminStoreController.getAdminItems);
router.post('/add', adminStoreController.addStoreItem);
router.put('/edit/:itemId', adminStoreController.editStoreItem);
router.post('/edit', adminStoreController.editStoreItem);
router.delete('/delete/:itemId', adminStoreController.deleteStoreItem);
router.post('/delete', adminStoreController.deleteStoreItem);

// Direct Admin Gift / Transfer
router.post('/grant', adminStoreController.grantItemToUser);

// Cloudinary Upload & Create
router.post('/upload', upload.single('media'), adminStoreController.uploadStoreMedia);

module.exports = router;