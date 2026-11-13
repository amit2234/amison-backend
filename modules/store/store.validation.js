const crypto = require('crypto');
const {
    CATEGORY_ID_PREFIXES,
    VALID_MEDIA_FORMATS,
    normalizeCategory,
    normalizeRarity,
    normalizeCurrencyType
} = require('./store.constants');

/**
 * Generates a unique, category-prefixed Store Item ID (e.g. fr_a9x2k1).
 */
function generateUniqueItemId(category) {
    const normalized = normalizeCategory(category, 'Frames');
    const prefix = CATEGORY_ID_PREFIXES[normalized] || 'st';
    const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6);
    return `${prefix}_${suffix}`;
}

/**
 * Safely parses booleans coming from JSON or multipart form strings.
 * Prevents JS truthy string bugs like Boolean("false") === true.
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
 * Infers standardized mediaFormat from explicit input, extension, or URL.
 */
function resolveMediaFormat(explicitFormat, mediaUrl = '') {
    if (explicitFormat) {
        const upper = String(explicitFormat).trim().toUpperCase();
        if (upper === 'JPEG') return 'JPG';
        if (VALID_MEDIA_FORMATS.includes(upper)) return upper;
    }
    const cleanUrl = String(mediaUrl || '').split('?')[0].trim().toLowerCase();
    if (cleanUrl.endsWith('.svga')) return 'SVGA';
    if (cleanUrl.endsWith('.pag')) return 'PAG';
    if (cleanUrl.endsWith('.lottie') || cleanUrl.endsWith('.json')) return 'LOTTIE';
    if (cleanUrl.endsWith('.svg')) return 'SVG';
    if (cleanUrl.endsWith('.gif')) return 'GIF';
    if (cleanUrl.endsWith('.webp')) return 'WEBP';
    if (cleanUrl.endsWith('.png')) return 'PNG';
    if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return 'JPG';
    return 'NONE';
}

function parseMetadata(rawMetadata) {
    if (!rawMetadata) return {};
    if (typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)) {
        return { ...rawMetadata };
    }
    if (typeof rawMetadata === 'string') {
        try {
            const parsed = JSON.parse(rawMetadata);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_) {}
    }
    return {};
}

function parsePreviewGradient(rawGradient) {
    if (Array.isArray(rawGradient)) {
        return rawGradient.map(c => String(c).trim()).filter(Boolean);
    }
    if (typeof rawGradient === 'string' && rawGradient.trim()) {
        try {
            const parsed = JSON.parse(rawGradient);
            if (Array.isArray(parsed)) {
                return parsed.map(c => String(c).trim()).filter(Boolean);
            }
        } catch (_) {
            return rawGradient.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    return [];
}

function sanitizeBaseStorePayload(raw = {}) {
    const category = normalizeCategory(raw.category);
    const name = raw.name !== undefined ? String(raw.name).trim() : undefined;
    const price = raw.price !== undefined ? Math.max(0, Math.floor(Number(raw.price) || 0)) : undefined;
    const validityDays = raw.validityDays !== undefined ? Math.max(0, Math.floor(Number(raw.validityDays) || 0)) : undefined;
    const sortOrder = raw.sortOrder !== undefined ? Math.floor(Number(raw.sortOrder) || 10) : undefined;
    const mediaUrl = raw.mediaUrl !== undefined ? String(raw.mediaUrl).trim() : undefined;
    const thumbnailUrl = raw.thumbnailUrl !== undefined ? String(raw.thumbnailUrl).trim() : undefined;
    const iconEmoji = raw.iconEmoji !== undefined ? String(raw.iconEmoji).trim() : undefined;
    const description = raw.description !== undefined ? String(raw.description).trim() : undefined;
    const rarity = raw.rarity !== undefined ? normalizeRarity(raw.rarity) : undefined;
    const currencyType = raw.currencyType !== undefined ? normalizeCurrencyType(raw.currencyType) : undefined;
    const isActive = raw.isActive !== undefined ? parseBooleanFlag(raw.isActive, true) : undefined;
    const mediaFormat = raw.mediaFormat !== undefined || mediaUrl !== undefined
        ? resolveMediaFormat(raw.mediaFormat, mediaUrl)
        : undefined;
    const previewGradient = raw.previewGradient !== undefined
        ? parsePreviewGradient(raw.previewGradient)
        : undefined;
    const metadata = raw.metadata !== undefined ? parseMetadata(raw.metadata) : undefined;

    return {
        category,
        name,
        price,
        validityDays,
        sortOrder,
        mediaUrl,
        thumbnailUrl,
        iconEmoji,
        description,
        rarity,
        currencyType,
        isActive,
        mediaFormat,
        previewGradient,
        metadata
    };
}

module.exports = {
    generateUniqueItemId,
    parseBooleanFlag,
    resolveMediaFormat,
    parseMetadata,
    parsePreviewGradient,
    sanitizeBaseStorePayload
};
