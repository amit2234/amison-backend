const { uploadBufferToCloudinary, detectMediaMagicBytes } = require('../../../services/cloudinaryService');

/**
 * Enterprise Modular Frame & Store Media Upload Service
 * Specializes in Zero-Transcode handling for SVGA (raw protobuf), SVG (vector XML), GIF (animated), and PNG.
 */
class FrameUploadService {
    /**
     * Inspects buffer and uploads to Cloudinary with strict format preservation
     * @param {Buffer} buffer - File buffer from Multer
     * @param {Object} options - { originalname, category, customName }
     * @returns {Promise<Object>} - { secureUrl, mediaUrl, detectedExt, resourceType }
     */
    static async uploadFrameMedia(buffer, options = {}) {
        if (!buffer || buffer.length === 0) {
            throw new Error('Upload error: File buffer is empty or missing.');
        }

        const category = options.category ? String(options.category).trim() : 'Frames';
        const originalname = options.originalname || 'media_asset';
        const detected = detectMediaMagicBytes(buffer);

        // Determine extension and resource type
        let ext = detected?.ext;
        if (!ext) {
            const lowerName = originalname.toLowerCase();
            if (lowerName.endsWith('.svga')) ext = 'svga';
            else if (lowerName.endsWith('.svg')) ext = 'svg';
            else if (lowerName.endsWith('.gif')) ext = 'gif';
            else if (lowerName.endsWith('.png')) ext = 'png';
            else if (lowerName.endsWith('.webp')) ext = 'webp';
            else ext = 'dat';
        }

        const isSvga = ext === 'svga';
        const isSvg = ext === 'svg';
        const isGif = ext === 'gif';

        const resourceType = isSvga ? 'raw' : 'image';
        const folder = `amison/store/${category.toLowerCase()}`;
        const timestamp = Date.now();
        const cleanName = (options.customName || originalname)
            .replace(/\.[^/.]+$/, "")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .toLowerCase();

        const filenameWithExt = isSvga ? `${cleanName}_${timestamp}.svga` : `${cleanName}_${timestamp}.${ext}`;

        const uploadResult = await uploadBufferToCloudinary(
            buffer,
            folder,
            resourceType,
            {
                filename: filenameWithExt
            }
        );

        let finalUrl = uploadResult.secure_url || uploadResult.url;

        // Strict SVGA Extension Invariant:
        // Android SvgaPlayerView requires the URL to end with or contain .svga
        if (isSvga && !finalUrl.toLowerCase().endsWith('.svga')) {
            if (finalUrl.includes('?')) {
                finalUrl = finalUrl.replace('?', '.svga?');
            } else {
                finalUrl = `${finalUrl}.svga`;
            }
        }

        return {
            secureUrl: finalUrl,
            mediaUrl: finalUrl,
            detectedExt: ext,
            resourceType,
            bytes: buffer.length,
            publicId: uploadResult.public_id
        };
    }
}

module.exports = FrameUploadService;
