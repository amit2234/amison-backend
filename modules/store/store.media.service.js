const { uploadBufferToCloudinary, detectMediaMagicBytes } = require('../../services/cloudinaryService');
const { normalizeCategory } = require('./store.constants');

/**
 * Store Media Upload & Format Detection Service
 * Guarantees zero-transcode delivery for SVGA, PAG, Lottie JSON, SVG vectors, and animated GIFs,
 * and produces a lightweight thumbnailUrl when appropriate for instant list rendering.
 */
function buildFastThumbnailUrl(secureUrl, ext, resourceType) {
    if (!secureUrl) return '';
    // Vector SVGs and small PNGs/GIFs render crisply directly without forced rasterization
    if (ext === 'svg' || resourceType === 'raw') {
        return '';
    }
    if (secureUrl.includes('/image/upload/') && !secureUrl.includes('/w_')) {
        return secureUrl.replace('/image/upload/', '/image/upload/w_240,h_240,c_limit,q_auto,f_auto/');
    }
    return secureUrl;
}

function mapExtToMediaFormat(ext) {
    const clean = String(ext || '').trim().toLowerCase();
    switch (clean) {
        case 'svga': return 'SVGA';
        case 'svg': return 'SVG';
        case 'pag': return 'PAG';
        case 'lottie':
        case 'json': return 'LOTTIE';
        case 'gif': return 'GIF';
        case 'png': return 'PNG';
        case 'webp': return 'WEBP';
        case 'jpg':
        case 'jpeg': return 'JPG';
        default: return 'NONE';
    }
}

async function uploadStoreMediaBuffer(buffer, options = {}) {
    if (!buffer || buffer.length === 0) {
        throw new Error('Upload error: File buffer is empty or missing.');
    }

    const category = normalizeCategory(options.category, 'Frames');
    const originalname = options.originalname || 'media_asset';
    const detected = detectMediaMagicBytes(buffer, originalname);

    let ext = detected?.ext;
    if (!ext) {
        const lowerName = originalname.toLowerCase();
        if (lowerName.endsWith('.svga')) ext = 'svga';
        else if (lowerName.endsWith('.pag')) ext = 'pag';
        else if (lowerName.endsWith('.lottie')) ext = 'lottie';
        else if (lowerName.endsWith('.json')) ext = 'json';
        else if (lowerName.endsWith('.svg')) ext = 'svg';
        else if (lowerName.endsWith('.gif')) ext = 'gif';
        else if (lowerName.endsWith('.png')) ext = 'png';
        else if (lowerName.endsWith('.webp')) ext = 'webp';
        else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) ext = 'jpg';
        else ext = 'dat';
    }

    const isRawAnim = ['svga', 'pag', 'json', 'lottie'].includes(ext);
    const resourceType = isRawAnim ? 'raw' : 'image';
    const folder = `amison/store/${category.toLowerCase()}`;
    const timestamp = Date.now();
    const cleanName = (options.customName || originalname)
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase() || 'asset';

    const filenameWithExt = `${cleanName}_${timestamp}.${ext}`;

    const uploadResult = await uploadBufferToCloudinary(
        buffer,
        folder,
        resourceType,
        {
            filename: filenameWithExt,
            originalname
        }
    );

    let finalUrl = uploadResult.secure_url || uploadResult.url;

    // Ensure raw animated URLs always carry their explicit extension for instant Android decoder routing
    if (isRawAnim && finalUrl && !finalUrl.toLowerCase().includes(`.${ext}`)) {
        if (finalUrl.includes('?')) {
            finalUrl = finalUrl.replace('?', `.${ext}?`);
        } else {
            finalUrl = `${finalUrl}.${ext}`;
        }
    }

    const mediaFormat = mapExtToMediaFormat(ext);
    const thumbnailUrl = buildFastThumbnailUrl(finalUrl, ext, resourceType);

    return {
        secureUrl: finalUrl,
        mediaUrl: finalUrl,
        thumbnailUrl,
        mediaFormat,
        detectedExt: ext,
        resourceType,
        bytes: buffer.length,
        publicId: uploadResult.public_id
    };
}

module.exports = {
    uploadStoreMediaBuffer,
    mapExtToMediaFormat,
    buildFastThumbnailUrl
};
