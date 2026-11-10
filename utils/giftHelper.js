const { uploadBufferToCloudinary, detectMediaMagicBytes } = require('../services/cloudinaryService');

/**
 * Resolves animation type based on URL extension or magic bytes
 */
function resolveAnimationType(animUrl, iconUrl) {
    const combined = `${animUrl || ''} ${iconUrl || ''}`.toLowerCase();
    if (combined.includes('.svga')) return 'SVGA_ANIMATION';
    if (combined.includes('.gif')) return 'GIF_ANIMATION';
    if (combined.includes('.svg')) return 'SVG_ANIMATION';
    if (combined.includes('.webp')) return 'CUSTOM_MEDIA';
    return 'CUSTOM_MEDIA';
}

/**
 * Handles multipart file uploads (thumbnail icon & SVGA animation) to Cloudinary
 */
async function processGiftMediaUploads(files = {}, existingIcon = '', existingAnim = '') {
    let finalIconUrl = existingIcon;
    let finalAnimUrl = existingAnim;

    if (files && files.iconFile && files.iconFile[0]) {
        const iconBuf = files.iconFile[0].buffer;
        const iconUpload = await uploadBufferToCloudinary(
            iconBuf,
            'amison/gifts/thumbnails',
            'image',
            { filename: files.iconFile[0].originalname || `icon_${Date.now()}` }
        );
        if (iconUpload && iconUpload.secure_url) {
            finalIconUrl = iconUpload.secure_url;
        }
    }

    if (files && files.animFile && files.animFile[0]) {
        const animBuf = files.animFile[0].buffer;
        const detected = detectMediaMagicBytes(animBuf);
        const isSvga = (detected && detected.ext === 'svga') ||
            (files.animFile[0].originalname && files.animFile[0].originalname.toLowerCase().endsWith('.svga'));

        const animUpload = await uploadBufferToCloudinary(
            animBuf,
            'amison/gifts/animations',
            isSvga ? 'raw' : (detected ? detected.resourceType : 'auto'),
            { filename: files.animFile[0].originalname || `anim_${Date.now()}.${isSvga ? 'svga' : (detected ? detected.ext : 'dat')}` }
        );
        if (animUpload && animUpload.secure_url) {
            finalAnimUrl = animUpload.secure_url;
        }
    }

    if (!finalIconUrl && finalAnimUrl) {
        finalIconUrl = finalAnimUrl;
    }

    return { finalIconUrl, finalAnimUrl };
}

/**
 * Real-time WebSocket broadcast to all active voice rooms
 */
function broadcastGiftCatalogUpdate(payload) {
    try {
        const setupRoomSocket = require('../sockets/roomSocket');
        if (typeof setupRoomSocket.broadcastGiftCatalogSync === 'function') {
            setupRoomSocket.broadcastGiftCatalogSync(payload);
        }
    } catch (e) {
        console.warn('[GiftHelper] WebSocket broadcast skipped:', e.message);
    }
}

module.exports = {
    resolveAnimationType,
    processGiftMediaUploads,
    broadcastGiftCatalogUpdate
};