const { uploadBufferToCloudinary, detectMediaMagicBytes } = require('../services/cloudinaryService');

/**
 * Resolves animation type based on URL extension or magic bytes
 */
function resolveAnimationType(animUrl, iconUrl) {
    const combined = `${animUrl || ''} ${iconUrl || ''}`.toLowerCase();
    if (combined.includes('.svga')) return 'SVGA_ANIMATION';
    if (combined.includes('.pag')) return 'PAG_ANIMATION';
    if (combined.includes('.lottie') || combined.includes('.json')) return 'LOTTIE_ANIMATION';
    if (combined.includes('.gif')) return 'GIF_ANIMATION';
    if (combined.includes('.svg')) return 'SVG_ANIMATION';
    if (combined.includes('.webp')) return 'CUSTOM_MEDIA';
    return 'CUSTOM_MEDIA';
}

function buildCleanAssetFilename(prefix, originalname, ext) {
    const base = String(originalname || prefix)
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase() || prefix;
    return `${base}_${Date.now()}.${ext}`;
}

/**
 * Handles multipart file uploads (thumbnail icon & animation) to Cloudinary
 */
async function processGiftMediaUploads(files = {}, existingIcon = '', existingAnim = '') {
    let finalIconUrl = existingIcon;
    let finalAnimUrl = existingAnim;

    if (files && files.iconFile && files.iconFile[0]) {
        const iconFile = files.iconFile[0];
        const iconBuf = iconFile.buffer;
        const iconOrigName = iconFile.originalname || `icon_${Date.now()}`;
        const detectedIcon = detectMediaMagicBytes(iconBuf, iconOrigName);
        const iconExt = detectedIcon?.ext || (iconOrigName.includes('.') ? iconOrigName.split('.').pop().toLowerCase() : 'png');
        const iconResType = detectedIcon ? detectedIcon.resourceType : (['svga', 'pag', 'json', 'lottie'].includes(iconExt) ? 'raw' : 'image');

        const iconUpload = await uploadBufferToCloudinary(
            iconBuf,
            'amison/gifts/thumbnails',
            iconResType,
            {
                filename: buildCleanAssetFilename('icon', iconOrigName, iconExt),
                originalname: iconOrigName
            }
        );
        if (iconUpload && iconUpload.secure_url) {
            finalIconUrl = iconUpload.secure_url;
        }
    }

    if (files && files.animFile && files.animFile[0]) {
        const animFile = files.animFile[0];
        const animBuf = animFile.buffer;
        const animOrigName = animFile.originalname || `anim_${Date.now()}`;
        const detectedAnim = detectMediaMagicBytes(animBuf, animOrigName);
        const animExt = detectedAnim?.ext || (animOrigName.includes('.') ? animOrigName.split('.').pop().toLowerCase() : 'svga');
        const isRawAnim = ['svga', 'pag', 'json', 'lottie'].includes(animExt);
        const animResType = isRawAnim ? 'raw' : (detectedAnim ? detectedAnim.resourceType : 'auto');

        const animUpload = await uploadBufferToCloudinary(
            animBuf,
            'amison/gifts/animations',
            animResType,
            {
                filename: buildCleanAssetFilename('anim', animOrigName, animExt),
                originalname: animOrigName
            }
        );
        if (animUpload && animUpload.secure_url) {
            finalAnimUrl = animUpload.secure_url;
            if (isRawAnim && !finalAnimUrl.toLowerCase().includes(`.${animExt}`)) {
                finalAnimUrl = finalAnimUrl.includes('?')
                    ? finalAnimUrl.replace('?', `.${animExt}?`)
                    : `${finalAnimUrl}.${animExt}`;
            }
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
