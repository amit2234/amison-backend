/**
 * Modular Reels / Amison Play Domain Entry Point
 */
module.exports = {
    constants: require('./reels.constants'),
    validation: require('./reels.validation'),
    mediaService: require('./services/reelsMedia.service'),
    routes: require('./reels.routes'),
    controllers: {
        feed: require('./controllers/reelsFeed.controller'),
        action: require('./controllers/reelsAction.controller')
    }
};
