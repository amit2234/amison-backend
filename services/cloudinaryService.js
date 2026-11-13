const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// Configure Cloudinary from environment variables or standard defaults
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'drd9q73p7',
    api_key: process.env.CLOUDINARY_API_KEY || '513813959897184',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'aP8q8B-M21a-J5B6w-M9w72-xyz'
});

// Multer memory storage for direct buffer upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB max for SVGA, GIF, WebP
});

/**
 * Detects media format based on magic bytes signature (header check)
 */
function detectMediaMagicBytes(buffer, originalname = '') {
    if (!buffer || buffer.length < 4) return null;
    const lowerName = String(originalname || '').toLowerCase();

    // GIF: GIF87a / GIF89a
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return { ext: 'gif', mime: 'image/gif', resourceType: 'image', isAnimated: true };
    }
    // PNG: \x89PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return { ext: 'png', mime: 'image/png', resourceType: 'image', isAnimated: false };
    }
    // Tencent PAG: 'P','A','G'
    if (buffer[0] === 0x50 && buffer[1] === 0x41 && buffer[2] === 0x47) {
        return { ext: 'pag', mime: 'application/octet-stream', resourceType: 'raw', isAnimated: true };
    }
    // ZIP container: SVGA 1.x or dotLottie (.lottie)
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
    if (isZip) {
        const zipHeadStr = buffer.slice(0, 1024).toString('utf8').toLowerCase();
        if (lowerName.endsWith('.lottie') || zipHeadStr.includes('manifest.json') || zipHeadStr.includes('.lottie')) {
            return { ext: 'lottie', mime: 'application/zip', resourceType: 'raw', isAnimated: true };
        }
        return { ext: 'svga', mime: 'application/octet-stream', resourceType: 'raw', isAnimated: true };
    }
    // SVGA 2.x: zlib deflate
    const isZlibSvga = buffer[0] === 0x78 && (buffer[1] === 0x9C || buffer[1] === 0x01 || buffer[1] === 0xDA || buffer[1] === 0x5E);
    if (isZlibSvga) {
        return { ext: 'svga', mime: 'application/octet-stream', resourceType: 'raw', isAnimated: true };
    }
    // SVG / Lottie JSON text inspection
    const headStr = buffer.slice(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trim().toLowerCase();
    if (headStr.startsWith('<?xml') || headStr.startsWith('<svg') || headStr.includes('<svg')) {
        return { ext: 'svg', mime: 'image/svg+xml', resourceType: 'image', isAnimated: false };
    }
    if (headStr.startsWith('{') && (
        lowerName.endsWith('.json') ||
        (headStr.includes('"layers"') && (headStr.includes('"fr"') || headStr.includes('"op"') || headStr.includes('"v"')))
    )) {
        return { ext: 'json', mime: 'application/json', resourceType: 'raw', isAnimated: true };
    }
    // WEBP: RIFF....WEBP
    if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        const webpStr = buffer.slice(8, 12).toString('ascii');
        if (webpStr === 'WEBP') {
            return { ext: 'webp', mime: 'image/webp', resourceType: 'image', isAnimated: true };
        }
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { ext: 'jpg', mime: 'image/jpeg', resourceType: 'image', isAnimated: false };
    }
    return null;
}

/**
 * Uploads a file buffer directly to Cloudinary with Zero-Transcode Guarantee for SVGA, PAG, Lottie, SVG & GIF
 * @param {Buffer} buffer 
 * @param {String} folder 
 * @param {String} resourceType ('image', 'raw', 'video', 'auto')
 * @param {Object} options (filename, originalname, etc.)
 * @returns {Promise<Object>}
 */
const uploadBufferToCloudinary = (buffer, folder = 'amison/store', resourceType = 'auto', options = {}) => {
    return new Promise((resolve, reject) => {
        const hintName = options.filename || options.originalname || '';
        const detected = detectMediaMagicBytes(buffer, hintName);
        let finalResourceType = resourceType;

        if (detected && detected.resourceType === 'raw') {
            finalResourceType = 'raw';
        } else if (resourceType === 'auto' && detected) {
            finalResourceType = detected.resourceType;
        }

        const uploadOptions = {
            folder: folder,
            resource_type: finalResourceType
        };

        if (options.filename) {
            if (finalResourceType === 'raw') {
                const rawExtMatch = options.filename.toLowerCase().match(/\.(svga|pag|json|lottie)$/);
                const targetExt = rawExtMatch ? rawExtMatch[1] : (detected?.ext || 'svga');
                const baseRawName = options.filename.replace(/\.(svga|pag|json|lottie)$/i, '');
                uploadOptions.public_id = `${baseRawName}.${targetExt}`;
                uploadOptions.use_filename = true;
                uploadOptions.unique_filename = false;
            } else {
                uploadOptions.public_id = options.filename.replace(/\.[^/.]+$/, "");
                uploadOptions.use_filename = true;
                uploadOptions.unique_filename = true;
            }
        }

        // ZERO-CORRUPTION RULE:
        // Raw files (SVGA, PAG, Lottie), GIF/WebP animations, and SVG vectors must NEVER undergo lossy transcoding!
        if (finalResourceType === 'raw' || (detected && ['svga', 'pag', 'json', 'lottie', 'gif', 'svg', 'webp'].includes(detected.ext))) {
            if (detected && detected.ext === 'gif') {
                uploadOptions.flags = 'animated';
            }
            // Strict NO transformation array
        } else {
            uploadOptions.transformation = [
                { quality: 'auto', fetch_format: 'auto' }
            ];
        }

        const stream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(buffer);
    });
};

module.exports = {
    cloudinary,
    upload,
    uploadBufferToCloudinary,
    detectMediaMagicBytes
};
