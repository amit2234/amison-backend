const DEFAULT_BOOTSTRAP_CATEGORIES = [
    { categoryId: 'cat_popular', name: 'Popular', sortOrder: 0 },
    { categoryId: 'cat_luxury', name: 'Luxury', sortOrder: 1 },
    { categoryId: 'cat_lucky', name: 'Lucky', sortOrder: 2 }
];

const VALID_MEDIA_FORMATS = ['SVGA', 'SVG', 'GIF', 'PAG', 'LOTTIE', 'PNG', 'WEBP', 'JPG', 'NONE'];

const VALID_ANIMATION_TYPES = [
    'SVGA_ANIMATION',
    'GIF_ANIMATION',
    'SVG_ANIMATION',
    'PAG_ANIMATION',
    'LOTTIE_ANIMATION',
    'CUSTOM_MEDIA'
];

function formatToAnimationType(mediaFormat) {
    switch (String(mediaFormat || '').trim().toUpperCase()) {
        case 'SVGA':
            return 'SVGA_ANIMATION';
        case 'SVG':
            return 'SVG_ANIMATION';
        case 'GIF':
            return 'GIF_ANIMATION';
        case 'PAG':
            return 'PAG_ANIMATION';
        case 'LOTTIE':
        case 'JSON':
            return 'LOTTIE_ANIMATION';
        default:
            return 'CUSTOM_MEDIA';
    }
}

module.exports = {
    DEFAULT_BOOTSTRAP_CATEGORIES,
    VALID_MEDIA_FORMATS,
    VALID_ANIMATION_TYPES,
    formatToAnimationType
};
