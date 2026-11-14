const cloudinary = require('cloudinary').v2;

function getCloudName() {
    return (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || '').trim();
}

function ensureCloudinaryConfigured() {
    cloudinary.config({
        cloud_name: getCloudName(),
        api_key: (process.env.CLOUDINARY_API_KEY || '').trim(),
        api_secret: (process.env.CLOUDINARY_API_SECRET || '').trim()
    });
}

function generateUploadSignature(rawResourceType = 'video') {
    ensureCloudinaryConfigured();
    const isPhoto = String(rawResourceType || '').trim().toLowerCase() === 'image' ||
        String(rawResourceType || '').trim().toLowerCase() === 'photo';

    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = isPhoto
        ? {
            timestamp,
            folder: 'amison_reels/photos'
        }
        : {
            timestamp,
            folder: 'amison_reels/videos',
            eager: 'sp_auto/m3u8'
        };

    const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return {
        signature,
        timestamp,
        apiKey: (process.env.CLOUDINARY_API_KEY || '').trim(),
        cloudName: getCloudName(),
        folder: paramsToSign.folder,
        resourceType: isPhoto ? 'image' : 'video'
    };
}

module.exports = {
    ensureCloudinaryConfigured,
    generateUploadSignature,
    getCloudName
};
