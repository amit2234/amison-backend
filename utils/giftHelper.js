const { uploadBufferToCloudinary } = require('../services/cloudinaryService');

/**
 * Resolves animation type based on URL extension
 */
function resolveAnimationType(animUrl, iconUrl) {
    const combined = `${animUrl || ''} ${iconUrl || ''}`.toLowerCase();
    if (combined.includes('.svga')) return 'SVGA_ANIMATION';
    if (combined.includes('.gif')) return 'GIF_ANIMATION';
    if (combined.includes('.svg')) return 'SVG_ANIMATION';
    return 'CUSTOM_MEDIA';
}

/**
 * Handles multipart file uploads (thumbnail icon & SVGA animation) to Cloudinary
 */
async function processGiftMediaUploads(files = {}, existingIcon = '', existingAnim = '') {
    let finalIconUrl = existingIcon;
    let finalAnimUrl = existingAnim;

    if (files && files.iconFile && files.iconFile[0]) {
        const iconUpload = await uploadBufferToCloudinary(
            files.iconFile[0].buffer,
            'amison/gifts/thumbnails',
            'image'
        );
        if (iconUpload && iconUpload.secure_url) {
            finalIconUrl = iconUpload.secure_url;
        }
    }

    if (files && files.animFile && files.animFile[0]) {
        const isSvga = files.animFile[0].originalname && files.animFile[0].originalname.toLowerCase().endsWith('.svga');
        const animUpload = await uploadBufferToCloudinary(
            files.animFile[0].buffer,
            'amison/gifts/animations',
            isSvga ? 'raw' : 'auto'
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