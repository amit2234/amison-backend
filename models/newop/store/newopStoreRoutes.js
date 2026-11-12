const express = require('express');
const router = express.Router();
const newopStoreController = require('./newopStoreController');
const { requireNewopAdmin } = require('../../../middleware/authMiddleware');
const { upload } = require('../../../services/cloudinaryService');

// All Newop Store actions require Admin Zero-Trust check
router.use(requireNewopAdmin);

// Multer upload middleware for 'mediaFile'
const storeMediaUpload = upload.single('mediaFile');

// 0. Upload single media file (returns Cloudinary URL)
router.post('/upload-media', storeMediaUpload, newopStoreController.uploadMediaOnly);

// 1. Multipart Frame / Media Upload & Direct Catalog Insertion
router.post('/upload', storeMediaUpload, newopStoreController.uploadAndCreateItem);

// 2. Add Item (Supports both multipart upload or pre-uploaded JSON)
router.post('/add', storeMediaUpload, newopStoreController.uploadAndCreateItem);

// 3. Fetch all Store Items (Active + Inactive)
router.get('/items', newopStoreController.getStoreItems);

// 4. Edit Store Item (Supports both JSON & multipart file replacement)
router.post('/edit', storeMediaUpload, newopStoreController.editStoreItem);
router.put('/edit/:itemId', storeMediaUpload, newopStoreController.editStoreItem);

// 5. Quick Toggle Active/Inactive
router.post('/toggle-active', newopStoreController.toggleActive);

// 6. Delete Store Item (Hard Delete)
router.post('/delete', newopStoreController.deleteStoreItem);
router.delete('/delete/:itemId', newopStoreController.deleteStoreItem);

// 7. Direct Admin Grant / Transfer to user
router.post('/grant', newopStoreController.grantStoreItem);

module.exports = router;