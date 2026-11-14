const { uploadBufferToCloudinary, detectMediaMagicBytes } = require('../../services/cloudinaryService');
const { formatToAnimationType } = require('./gift.constants');
const { resolveMediaFormat } = require('./gift.validation');

/**
 * Single-File Gift Media Upload & Format Detection Service
 * Zero-transcode delivery for SVGA, SVG, GIF (plus PAG/Lottie/PNG/WebP).
 * Uses the exact uploaded file as both iconUrl and animationUrl (no separate thumbnail).
 */
function buildCleanFilename(customName, originalname, ext) {
    const base = String(customName || originalname || 'gift_asset')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase() || 'gift_asset';
    return `${base}_${Date.now()}.${ext}`;
}

function resolveFileExtFromBufferOrName(buffer, originalname = '') {
    const detected = detectMediaMagicBytes(buffer, originalname);
    if (detected && detected.ext) {
        return { ext: detected.ext, detected };
    }
    const lowerName = String(originalname || '').toLowerCase();
    if (lowerName.endsWith('.svga')) return { ext: 'svga', detected: null };
    if (lowerName.endsWith('.svg')) return { ext: 'svg', detected: null };
    if (lowerName.endsWith('.gif')) return { ext: 'gif', detected: null };
    if (lowerName.endsWith('.pag')) return { ext: 'pag', detected: null };
    if (lowerName.endsWith('.lottie')) return { ext: 'lottie', detected: null };
    if (lowerName.endsWith('.json')) return { ext: 'json', detected: null };
    if (lowerName.endsWith('.webp')) return { ext: 'webp', detected: null };
    if (lowerName.endsWith('.png')) return { ext: 'png', detected: null };
    if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return { ext: 'jpg', detected: null };
    return { ext: 'svga', detected: null };
}

async function uploadGiftMediaBuffer(buffer, options = {}) {
    if (!buffer || buffer.length === 0) {
        throw new Error('Upload error: Gift media file buffer is empty or missing.');
    }

    const originalname = options.originalname || 'gift_media';
    const { ext, detected } = resolveFileExtFromBufferOrName(buffer, originalname);
    const isRawAnim = ['svga', 'pag', 'json', 'lottie'].includes(ext);
    const resourceType = isRawAnim ? 'raw' : (detected ? detected.resourceType : 'image');

    const safeCategory = String(options.category || 'popular')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase() || 'popular';
    const folder = `amison/gifts/${safeCategory}`;
    const filenameWithExt = buildCleanFilename(options.customName, originalname, ext);

    const uploadResult = await uploadBufferToCloudinary(
        buffer,
        folder,
        resourceType,
        {
            filename: filenameWithExt,
            originalname
        }
    );

    let finalUrl = uploadResult?.secure_url || uploadResult?.url || '';
    if (!finalUrl) {
        throw new Error('Cloudinary upload succeeded without a valid media URL.');
    }

    if (isRawAnim && !finalUrl.toLowerCase().includes(`.${ext}`)) {
        finalUrl = finalUrl.includes('?')
            ? finalUrl.replace('?', `.${ext}?`)
            : `${finalUrl}.${ext}`;
    }

    const mediaFormat = resolveMediaFormat(ext, finalUrl);
    const animationType = formatToAnimationType(mediaFormat);

    return {
        mediaUrl: finalUrl,
        iconUrl: finalUrl,
        animationUrl: finalUrl,
        mediaFormat,
        animationType,
        detectedExt: ext,
        resourceType,
        bytes: buffer.length,
        publicId: uploadResult.public_id
    };
}

function pickUploadedGiftFile(reqOrFiles) {
    if (!reqOrFiles) return null;
    if (reqOrFiles.file && reqOrFiles.file.buffer) {
        return reqOrFiles.file;
    }
    if (Array.isArray(reqOrFiles) && reqOrFiles.length > 0 && reqOrFiles[0].buffer) {
        return reqOrFiles[0];
    }
    if (typeof reqOrFiles === 'object') {
        const prioritizedFields = ['mediaFile', 'file', 'animFile', 'iconFile'];
        for (const field of prioritizedFields) {
            const entry = reqOrFiles[field];
            if (Array.isArray(entry) && entry[0] && entry[0].buffer) {
                return entry[0];
            }
        }
        for (const value of Object.values(reqOrFiles)) {
            if (Array.isArray(value) && value[0] && value[0].buffer) {
                return value[0];
            }
        }
    }
    return null;
}

module.exports = {
    uploadGiftMediaBuffer,
    pickUploadedGiftFile
};
