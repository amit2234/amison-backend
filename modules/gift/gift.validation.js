const crypto = require('crypto');
const {
    VALID_MEDIA_FORMATS,
    VALID_ANIMATION_TYPES,
    formatToAnimationType
} = require('./gift.constants');

/**
 * Generates a compact unique gift ID (e.g. gf_a1b2c3d4).
 */
function generateUniqueGiftId() {
    return `gf_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Safely parses boolean values coming from JSON or multipart form fields.
 */
function parseBooleanFlag(value, defaultValue = true) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const str = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'active'].includes(str)) return true;
    if (['false', '0', 'no', 'off', 'inactive'].includes(str)) return false;
    return defaultValue;
}

/**
 * Infers standardized mediaFormat from explicit input or media URL extension.
 */
function resolveMediaFormat(explicitFormat, mediaUrl = '') {
    if (explicitFormat) {
        const upper = String(explicitFormat).trim().toUpperCase();
        if (upper === 'JPEG') return 'JPG';
        if (upper === 'JSON') return 'LOTTIE';
        if (VALID_MEDIA_FORMATS.includes(upper) && upper !== 'NONE') return upper;
    }
    const cleanUrl = String(mediaUrl || '').split('?')[0].trim().toLowerCase();
    if (cleanUrl.endsWith('.svga')) return 'SVGA';
    if (cleanUrl.endsWith('.svg')) return 'SVG';
    if (cleanUrl.endsWith('.gif')) return 'GIF';
    if (cleanUrl.endsWith('.pag')) return 'PAG';
    if (cleanUrl.endsWith('.lottie') || cleanUrl.endsWith('.json')) return 'LOTTIE';
    if (cleanUrl.endsWith('.webp')) return 'WEBP';
    if (cleanUrl.endsWith('.png')) return 'PNG';
    if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return 'JPG';
    return 'NONE';
}

/**
 * Resolves animationType from explicit value, mediaFormat, or URLs.
 */
function resolveAnimationType(animUrl = '', iconUrl = '', explicitFormat = '', explicitAnimType = '') {
    if (explicitAnimType) {
        const upperType = String(explicitAnimType).trim().toUpperCase();
        if (VALID_ANIMATION_TYPES.includes(upperType)) {
            return upperType;
        }
    }
    const fmt = resolveMediaFormat(explicitFormat, animUrl || iconUrl);
    if (fmt !== 'NONE') {
        return formatToAnimationType(fmt);
    }
    const combined = `${animUrl || ''} ${iconUrl || ''}`.toLowerCase();
    if (combined.includes('.svga')) return 'SVGA_ANIMATION';
    if (combined.includes('.pag')) return 'PAG_ANIMATION';
    if (combined.includes('.lottie') || combined.includes('.json')) return 'LOTTIE_ANIMATION';
    if (combined.includes('.gif')) return 'GIF_ANIMATION';
    if (combined.includes('.svg')) return 'SVG_ANIMATION';
    return 'CUSTOM_MEDIA';
}

function sanitizeGiftPayload(raw = {}) {
    const giftId = raw.giftId !== undefined ? String(raw.giftId).trim() : undefined;
    const name = raw.name !== undefined ? String(raw.name).trim() : undefined;
    const coinPrice = raw.coinPrice !== undefined
        ? Math.max(1, Math.floor(Number(raw.coinPrice) || 100))
        : undefined;
    const category = raw.category !== undefined ? String(raw.category).trim() : undefined;
    const iconUrl = raw.iconUrl !== undefined ? String(raw.iconUrl).trim() : undefined;
    const animationUrl = raw.animationUrl !== undefined ? String(raw.animationUrl).trim() : undefined;
    const iconEmoji = raw.iconEmoji !== undefined ? String(raw.iconEmoji).trim() : undefined;
    const sortOrder = raw.sortOrder !== undefined ? (Math.floor(Number(raw.sortOrder)) || 0) : undefined;
    const isActive = raw.isActive !== undefined ? parseBooleanFlag(raw.isActive, true) : undefined;
    const isBroadcast = raw.isBroadcast !== undefined ? parseBooleanFlag(raw.isBroadcast, false) : undefined;
    const isLucky = raw.isLucky !== undefined ? parseBooleanFlag(raw.isLucky, false) : undefined;
    const luckyMultiplierMax = raw.luckyMultiplierMax !== undefined
        ? Math.max(1, Math.floor(Number(raw.luckyMultiplierMax) || 1))
        : undefined;
    const description = raw.description !== undefined ? String(raw.description).trim() : undefined;
    const mediaFormat = raw.mediaFormat !== undefined || animationUrl !== undefined || iconUrl !== undefined
        ? resolveMediaFormat(raw.mediaFormat, animationUrl || iconUrl || '')
        : undefined;
    const animationType = raw.animationType !== undefined
        ? resolveAnimationType(animationUrl, iconUrl, mediaFormat, raw.animationType)
        : undefined;

    return {
        giftId,
        name,
        coinPrice,
        category,
        iconUrl,
        animationUrl,
        iconEmoji,
        sortOrder,
        isActive,
        isBroadcast,
        isLucky,
        luckyMultiplierMax,
        description,
        mediaFormat,
        animationType
    };
}

module.exports = {
    generateUniqueGiftId,
    parseBooleanFlag,
    resolveMediaFormat,
    resolveAnimationType,
    sanitizeGiftPayload
};
