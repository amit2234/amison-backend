const Banner = require('../models/Banner');
const cacheService = require('../services/cacheService');
const { cloudinary, uploadBufferToCloudinary } = require('../services/cloudinaryService');

/**
 * Public Endpoint: Get Active Banners for Home or Login Screen
 * Ultra-fast with Redis Cache (< 15ms)
 * GET /api/banners/active?placement=HOME|LOGIN
 */
exports.getActiveBanners = async (req, res) => {
    try {
        const rawPlacement = (req.query.placement || 'HOME').toUpperCase();
        const placement = ['HOME', 'LOGIN'].includes(rawPlacement) ? rawPlacement : 'HOME';

        // 1. Check Redis Cache
        const cached = await cacheService.getCachedBanners(placement);
        if (cached && Array.isArray(cached) && cached.length > 0) {
            return res.json({
                success: true,
                placement,
                count: cached.length,
                source: 'cache',
                data: cached
            });
        }

        // 2. Query MongoDB Atlas
        const banners = await Banner.find({
            placement,
            isActive: true
        })
        .sort({ priority: 1, createdAt: -1 })
        .lean();

        const formatted = banners.map(b => ({
            id: b._id.toString(),
            title: b.title,
            subtitle: b.subtitle || '',
            imageUrl: b.imageUrl,
            cloudinaryPublicId: b.cloudinaryPublicId || '',
            placement: b.placement,
            actionUrl: b.actionUrl || '',
            priority: b.priority || 1,
            isActive: b.isActive !== false,
            createdAt: b.createdAt
        }));

        // 3. Sync into Redis Cache
        await cacheService.syncBannersCache(placement, formatted);

        return res.json({
            success: true,
            placement,
            count: formatted.length,
            source: 'db',
            data: formatted
        });
    } catch (err) {
        console.error('❌ [BannerController] Error getting active banners:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch active banners',
            error: err.message
        });
    }
};

/**
 * Admin Endpoint: Get All Banners (Active & Inactive)
 * GET /api/newop/banners?placement=HOME|LOGIN|ALL
 */
exports.getAllBanners = async (req, res) => {
    try {
        const filter = {};
        if (req.query.placement && ['HOME', 'LOGIN'].includes(req.query.placement.toUpperCase())) {
            filter.placement = req.query.placement.toUpperCase();
        }

        const banners = await Banner.find(filter)
            .sort({ placement: 1, priority: 1, createdAt: -1 })
            .lean();

        const formatted = banners.map(b => ({
            id: b._id.toString(),
            title: b.title,
            subtitle: b.subtitle || '',
            imageUrl: b.imageUrl,
            cloudinaryPublicId: b.cloudinaryPublicId || '',
            placement: b.placement,
            actionUrl: b.actionUrl || '',
            priority: b.priority || 1,
            isActive: b.isActive !== false,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt
        }));

        return res.json({
            success: true,
            count: formatted.length,
            data: formatted
        });
    } catch (err) {
        console.error('❌ [BannerController] Error getting all banners:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch banners list',
            error: err.message
        });
    }
};

/**
 * Admin Endpoint: Create Banner
 * POST /api/newop/banners
 * Accepts JSON payload or multipart form data (with bannerFile / image)
 */
exports.createBanner = async (req, res) => {
    try {
        let {
            title,
            subtitle,
            imageUrl,
            cloudinaryPublicId,
            placement,
            actionUrl,
            priority,
            isActive
        } = req.body;

        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ success: false, message: 'Banner title is required' });
        }

        // Check if file was uploaded via multipart/form-data
        const file = req.file || (req.files && (req.files.bannerFile?.[0] || req.files.image?.[0]));
        if (file) {
            const uploadResult = await uploadBufferToCloudinary(file.buffer, 'amison/banners', 'image');
            imageUrl = uploadResult.secure_url;
            cloudinaryPublicId = uploadResult.public_id;
        }

        if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
            return res.status(400).json({ success: false, message: 'Valid imageUrl or image upload is required' });
        }

        const validPlacement = placement && placement.toUpperCase() === 'LOGIN' ? 'LOGIN' : 'HOME';

        const newBanner = new Banner({
            title: title.trim(),
            subtitle: (subtitle || '').trim(),
            imageUrl: imageUrl.trim(),
            cloudinaryPublicId: (cloudinaryPublicId || '').trim(),
            placement: validPlacement,
            actionUrl: (actionUrl || '').trim(),
            priority: priority ? parseInt(priority, 10) : 1,
            isActive: isActive === undefined ? true : (isActive === true || isActive === 'true'),
            createdAdminId: req.adminUid || req.body.adminId || 'ADMIN'
        });

        const savedBanner = await newBanner.save();

        // Invalidate Redis cache immediately
        await cacheService.invalidateBannersCache(validPlacement);

        return res.status(201).json({
            success: true,
            message: 'Banner created successfully',
            banner: {
                id: savedBanner._id.toString(),
                title: savedBanner.title,
                subtitle: savedBanner.subtitle,
                imageUrl: savedBanner.imageUrl,
                cloudinaryPublicId: savedBanner.cloudinaryPublicId,
                placement: savedBanner.placement,
                actionUrl: savedBanner.actionUrl,
                priority: savedBanner.priority,
                isActive: savedBanner.isActive,
                createdAt: savedBanner.createdAt
            }
        });
    } catch (err) {
        console.error('❌ [BannerController] Error creating banner:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to create banner',
            error: err.message
        });
    }
};

/**
 * Admin Endpoint: Update Banner
 * PUT /api/newop/banners/:id or POST /api/newop/banners/edit
 */
exports.updateBanner = async (req, res) => {
    try {
        const bannerId = req.params.id || req.body.id || req.body.bannerId;
        if (!bannerId) {
            return res.status(400).json({ success: false, message: 'Banner ID is required' });
        }

        const banner = await Banner.findById(bannerId);
        if (!banner) {
            return res.status(404).json({ success: false, message: 'Banner not found' });
        }

        const oldPlacement = banner.placement;

        // Check if file was uploaded
        const file = req.file || (req.files && (req.files.bannerFile?.[0] || req.files.image?.[0]));
        if (file) {
            const uploadResult = await uploadBufferToCloudinary(file.buffer, 'amison/banners', 'image');
            banner.imageUrl = uploadResult.secure_url;
            banner.cloudinaryPublicId = uploadResult.public_id;
        } else if (req.body.imageUrl) {
            banner.imageUrl = req.body.imageUrl.trim();
        }

        if (req.body.title !== undefined) banner.title = req.body.title.trim();
        if (req.body.subtitle !== undefined) banner.subtitle = req.body.subtitle.trim();
        if (req.body.actionUrl !== undefined) banner.actionUrl = req.body.actionUrl.trim();
        if (req.body.priority !== undefined) banner.priority = parseInt(req.body.priority, 10);
        if (req.body.isActive !== undefined) banner.isActive = (req.body.isActive === true || req.body.isActive === 'true');
        if (req.body.placement) {
            const p = req.body.placement.toUpperCase();
            if (['HOME', 'LOGIN'].includes(p)) banner.placement = p;
        }

        const updatedBanner = await banner.save();

        // Invalidate Redis cache for both old and new placement
        await cacheService.invalidateBannersCache(oldPlacement);
        if (banner.placement !== oldPlacement) {
            await cacheService.invalidateBannersCache(banner.placement);
        }

        return res.json({
            success: true,
            message: 'Banner updated successfully',
            banner: {
                id: updatedBanner._id.toString(),
                title: updatedBanner.title,
                subtitle: updatedBanner.subtitle,
                imageUrl: updatedBanner.imageUrl,
                cloudinaryPublicId: updatedBanner.cloudinaryPublicId,
                placement: updatedBanner.placement,
                actionUrl: updatedBanner.actionUrl,
                priority: updatedBanner.priority,
                isActive: updatedBanner.isActive,
                updatedAt: updatedBanner.updatedAt
            }
        });
    } catch (err) {
        console.error('❌ [BannerController] Error updating banner:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to update banner',
            error: err.message
        });
    }
};

/**
 * Admin Endpoint: Delete Banner
 * DELETE /api/newop/banners/:id or POST /api/newop/banners/delete
 */
exports.deleteBanner = async (req, res) => {
    try {
        const bannerId = req.params.id || req.body.id || req.body.bannerId;
        if (!bannerId) {
            return res.status(400).json({ success: false, message: 'Banner ID is required' });
        }

        const banner = await Banner.findById(bannerId);
        if (!banner) {
            return res.status(404).json({ success: false, message: 'Banner not found' });
        }

        const placement = banner.placement;
        const publicId = banner.cloudinaryPublicId;

        await Banner.findByIdAndDelete(bannerId);

        // Optional Cloudinary cleanup asynchronously (non-blocking)
        if (publicId) {
            cloudinary.uploader.destroy(publicId).catch(err => {
                console.warn('⚠️ [BannerController] Cloudinary asset cleanup warning:', err.message);
            });
        }

        // Invalidate Redis cache
        await cacheService.invalidateBannersCache(placement);

        return res.json({
            success: true,
            message: 'Banner deleted permanently'
        });
    } catch (err) {
        console.error('❌ [BannerController] Error deleting banner:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to delete banner',
            error: err.message
        });
    }
};
