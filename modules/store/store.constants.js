/**
 * Store Domain Constants & Category Normalization
 * Single source of truth for Store categories, formats, rarities, and ID prefixes.
 */

const STORE_CATEGORIES = Object.freeze({
    ENTRANCE_EFFECT: 'EntranceEffect',
    FRAMES: 'Frames',
    TEXT_BUBBLE: 'TextBubble',
    THEME: 'Theme',
    PROFILE_CARD: 'ProfileCard',
    ENTRY_TAG: 'EntryTag',
    VIP_ID: 'VipId',
    RINGS: 'Rings'
});

const VALID_CATEGORIES = Object.freeze(Object.values(STORE_CATEGORIES));

const VALID_RARITIES = Object.freeze([
    'Common',
    'Rare',
    'Epic',
    'Legendary',
    'Mythic',
    'Supreme'
]);

const VALID_MEDIA_FORMATS = Object.freeze([
    'SVGA',
    'SVG',
    'PAG',
    'LOTTIE',
    'GIF',
    'PNG',
    'WEBP',
    'JPG',
    'NONE'
]);

const VALID_CURRENCIES = Object.freeze(['diamonds', 'coins']);

const CATEGORY_ID_PREFIXES = Object.freeze({
    [STORE_CATEGORIES.ENTRANCE_EFFECT]: 'en',
    [STORE_CATEGORIES.FRAMES]: 'fr',
    [STORE_CATEGORIES.TEXT_BUBBLE]: 'tb',
    [STORE_CATEGORIES.THEME]: 'th',
    [STORE_CATEGORIES.PROFILE_CARD]: 'pc',
    [STORE_CATEGORIES.ENTRY_TAG]: 'et',
    [STORE_CATEGORIES.VIP_ID]: 'vp',
    [STORE_CATEGORIES.RINGS]: 'rg'
});

const CATEGORY_ALIAS_MAP = new Map([
    ['entranceeffect', STORE_CATEGORIES.ENTRANCE_EFFECT],
    ['entrance effect', STORE_CATEGORIES.ENTRANCE_EFFECT],
    ['entrance', STORE_CATEGORIES.ENTRANCE_EFFECT],
    ['entrances', STORE_CATEGORIES.ENTRANCE_EFFECT],
    ['frames', STORE_CATEGORIES.FRAMES],
    ['frame', STORE_CATEGORIES.FRAMES],
    ['avatarframe', STORE_CATEGORIES.FRAMES],
    ['textbubble', STORE_CATEGORIES.TEXT_BUBBLE],
    ['text bubble', STORE_CATEGORIES.TEXT_BUBBLE],
    ['bubble', STORE_CATEGORIES.TEXT_BUBBLE],
    ['bubbles', STORE_CATEGORIES.TEXT_BUBBLE],
    ['theme', STORE_CATEGORIES.THEME],
    ['themes', STORE_CATEGORIES.THEME],
    ['roomtheme', STORE_CATEGORIES.THEME],
    ['profilecard', STORE_CATEGORIES.PROFILE_CARD],
    ['profile card', STORE_CATEGORIES.PROFILE_CARD],
    ['entrytag', STORE_CATEGORIES.ENTRY_TAG],
    ['entry tag', STORE_CATEGORIES.ENTRY_TAG],
    ['vipid', STORE_CATEGORIES.VIP_ID],
    ['vip id', STORE_CATEGORIES.VIP_ID],
    ['vip', STORE_CATEGORIES.VIP_ID],
    ['rings', STORE_CATEGORIES.RINGS],
    ['ring', STORE_CATEGORIES.RINGS],
    ['cpcard', STORE_CATEGORIES.RINGS],
    ['cp card', STORE_CATEGORIES.RINGS],
    ['cpeffect', STORE_CATEGORIES.RINGS],
    ['cp effect', STORE_CATEGORIES.RINGS]
]);

function normalizeCategory(rawCategory, fallback = null) {
    if (!rawCategory) return fallback;
    const raw = String(rawCategory).trim();
    if (!raw || raw.toLowerCase() === 'all') return fallback;
    if (VALID_CATEGORIES.includes(raw)) return raw;

    const compact = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (CATEGORY_ALIAS_MAP.has(compact)) {
        return CATEGORY_ALIAS_MAP.get(compact);
    }
    const noSpace = compact.replace(/\s+/g, '');
    if (CATEGORY_ALIAS_MAP.has(noSpace)) {
        return CATEGORY_ALIAS_MAP.get(noSpace);
    }
    return fallback;
}

function normalizeRarity(rawRarity) {
    if (!rawRarity) return 'Epic';
    const clean = String(rawRarity).trim().toLowerCase();
    const match = VALID_RARITIES.find(r => r.toLowerCase() === clean);
    return match || 'Epic';
}

function normalizeCurrencyType(rawCurrency) {
    if (!rawCurrency) return 'diamonds';
    const clean = String(rawCurrency).trim().toLowerCase();
    if (clean === 'coin' || clean === 'coins') return 'coins';
    return 'diamonds';
}

module.exports = {
    STORE_CATEGORIES,
    VALID_CATEGORIES,
    VALID_RARITIES,
    VALID_MEDIA_FORMATS,
    VALID_CURRENCIES,
    CATEGORY_ID_PREFIXES,
    normalizeCategory,
    normalizeRarity,
    normalizeCurrencyType
};
