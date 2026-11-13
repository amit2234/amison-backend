const express = require('express');
const router = express.Router();
const storePublicRoutes = require('../modules/store/public/storePublic.routes');
const adminStoreRouter = require('../modules/store/admin/adminStore.routes');

// Mount Modular Admin Store Routes under /api/store/admin
router.use('/admin', adminStoreRouter);

// Public & User Store Endpoints
router.use('/', storePublicRoutes);

module.exports = router;
