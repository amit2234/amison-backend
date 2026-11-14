/**
 * Reels / Amison Play Domain Constants & Formatting Helpers
 */

const MEDIA_TYPES = Object.freeze({
    VIDEO: 'VIDEO',
    PHOTO: 'PHOTO'
});

const FEED_FILTERS = Object.freeze({
    ALL: 'ALL',
    VIDEO: 'VIDEO',
    PHOTO: 'PHOTO'
});

const DEFAULT_PAGE_LIMIT = 15;
const MAX_PAGE_LIMIT = 40;
const MAX_CAPTION_LENGTH = 500;
const MAX_COMMENT_LENGTH = 500;
const MAX_HASHTAGS_LENGTH = 200;
const MAX_VIDEO_DURATION_SEC = 30;

function formatRelativeTime(dateInput) {
    if (!dateInput) return 'Just now';
    const ts = new Date(dateInput).getTime();
    if (!Number.isFinite(ts)) return 'Just now';

    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${Math.floor(diffMonths / 12)}y ago`;
}

module.exports = {
    MEDIA_TYPES,
    FEED_FILTERS,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    MAX_CAPTION_LENGTH,
    MAX_COMMENT_LENGTH,
    MAX_HASHTAGS_LENGTH,
    MAX_VIDEO_DURATION_SEC,
    formatRelativeTime
};
