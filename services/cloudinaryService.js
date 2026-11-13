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
function detectMediaMagicBytes(buffer) {
    if (!buffer || buffer.length < 4) return null;
    // GIF: GIF87a / GIF89a
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return { ext: 'gif', mime: 'image/gif', resourceType: 'image', isAnimated: true };
    }
    // PNG: \x89PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return { ext: 'png', mime: 'image/png', resourceType: 'image', isAnimated: false };
    }
    // SVGA: PK.. (ZIP archive) OR 0x78 (zlib deflate)
    const isZipSvga = buffer[0] === 0x50 && buffer[1] === 0x4B;
    const isZlibSvga = buffer[0] === 0x78 && (buffer[1] === 0x9C || buffer[1] === 0x01 || buffer[1] === 0xDA || buffer[1] === 0x5E);
    if (isZipSvga || isZlibSvga) {
        return { ext: 'svga', mime: 'application/octet-stream', resourceType: 'raw', isAnimated: true };
    }
    // SVG text (handle UTF-8 BOM, comments, XML header)
    const headStr = buffer.slice(0, 512).toString('utf8').replace(/^\uFEFF/, '').trim().toLowerCase();
    if (headStr.startsWith('<?xml') || headStr.startsWith('<svg') || headStr.includes('<svg')) {
        return { ext: 'svg', mime: 'image/svg+xml', resourceType: 'image', isAnimated: false };
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
 * Uploads a file buffer directly to Cloudinary with Zero-Transcode Guarantee for SVGA & GIF
 * @param {Buffer} buffer 
 * @param {String} folder 
 * @param {String} resourceType ('image', 'raw', 'video', 'auto')
 * @param {Object} options (filename, etc.)
 * @returns {Promise<Object>}
 */
const uploadBufferToCloudinary = (buffer, folder = 'amison/store', resourceType = 'auto', options = {}) => {
    return new Promise((resolve, reject) => {
        const detected = detectMediaMagicBytes(buffer);
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
                uploadOptions.public_id = options.filename.toLowerCase().endsWith('.svga') 
                    ? options.filename 
                    : `${options.filename}.svga`;
                uploadOptions.use_filename = true;
                uploadOptions.unique_filename = false;
            } else {
                uploadOptions.public_id = options.filename.replace(/\.[^/.]+$/, "");
                uploadOptions.use_filename = true;
                uploadOptions.unique_filename = true;
            }
        }

        // ZERO-CORRUPTION RULE:
        // Raw files (SVGA), GIF animations, and SVG must NEVER undergo format/lossy transcoding!
        if (finalResourceType === 'raw' || (detected && (detected.ext === 'svga' || detected.ext === 'gif' || detected.ext === 'svg'))) {
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