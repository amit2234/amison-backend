const {
    MEDIA_TYPES,
    FEED_FILTERS,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    MAX_VIDEO_DURATION_SEC
} = require('./reels.constants');

function isValidHttpUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    return /^https?:\/\/.+/i.test(trimmed);
}

function normalizeMediaType(rawType, fallback = MEDIA_TYPES.VIDEO) {
    const clean = String(rawType || '').trim().toUpperCase();
    if (clean === MEDIA_TYPES.PHOTO || clean === 'IMAGE') return MEDIA_TYPES.PHOTO;
    if (clean === MEDIA_TYPES.VIDEO || clean === 'REEL') return MEDIA_TYPES.VIDEO;
    return fallback;
}

function normalizeFeedFilter(rawFilter) {
    const clean = String(rawFilter || '').trim().toUpperCase();
    if (clean === FEED_FILTERS.VIDEO || clean === 'REELS') return FEED_FILTERS.VIDEO;
    if (clean === FEED_FILTERS.PHOTO || clean === 'PHOTOS') return FEED_FILTERS.PHOTO;
    return FEED_FILTERS.ALL;
}

function normalizeAspectRatio(rawRatio) {
    const num = Number(rawRatio);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(3.5, Math.max(0.3, Math.round(num * 1000) / 1000));
}

function normalizeDuration(rawDuration) {
    const num = Number(rawDuration);
    if (!Number.isFinite(num) || num <= 0) return MAX_VIDEO_DURATION_SEC;
    return Math.min(MAX_VIDEO_DURATION_SEC, Math.max(1, Math.round(num)));
}

function sanitizeText(rawText, maxLen = 500) {
    if (rawText === undefined || rawText === null) return '';
    return String(rawText).trim().slice(0, maxLen);
}

function normalizePageAndLimit(rawPage, rawLimit) {
    const pageNum = Number.parseInt(String(rawPage ?? '0'), 10);
    const limitNum = Number.parseInt(String(rawLimit ?? DEFAULT_PAGE_LIMIT), 10);
    const page = Number.isFinite(pageNum) && pageNum >= 0 ? pageNum : 0;
    const limit = Number.isFinite(limitNum) && limitNum > 0
        ? Math.min(limitNum, MAX_PAGE_LIMIT)
        : DEFAULT_PAGE_LIMIT;
    return { page, limit, skip: page * limit };
}

module.exports = {
    isValidHttpUrl,
    normalizeMediaType,
    normalizeFeedFilter,
    normalizeAspectRatio,
    normalizeDuration,
    sanitizeText,
    normalizePageAndLimit
};
