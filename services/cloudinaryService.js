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
 * Uploads a file buffer directly to Cloudinary
 * @param {Buffer} buffer 
 * @param {String} folder 
 * @param {String} resourceType ('image', 'raw', 'video')
 * @returns {Promise<Object>}
 */
const uploadBufferToCloudinary = (buffer, folder = 'amison/store', resourceType = 'auto') => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: folder,
                resource_type: resourceType,
                transformation: [
                    { quality: 'auto', fetch_format: 'auto' }
                ]
            },
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
    uploadBufferToCloudinary
};