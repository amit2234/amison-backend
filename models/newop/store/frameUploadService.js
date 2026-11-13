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
        const detected = detectMediaMagicBytes(buffer, originalname);

        // Determine extension and resource type
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
            .replace(/\.[^/.]+$/, "")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
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

        // Strict Raw Extension Invariant:
        // Android HybridMediaView/SvgaPlayerView/PagAnimationView work fastest when URL carries .ext
        if (isRawAnim && finalUrl && !finalUrl.toLowerCase().includes(`.${ext}`)) {
            if (finalUrl.includes('?')) {
                finalUrl = finalUrl.replace('?', `.${ext}?`);
            } else {
                finalUrl = `${finalUrl}.${ext}`;
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
