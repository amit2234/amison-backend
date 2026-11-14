/**
 * Modular Profile Domain Entry Point
 */
module.exports = {
    constants: require('./profile.constants'),
    routes: require('./profile.routes'),
    services: {
        aggregate: require('./services/profileAggregate.service')
    },
    controllers: {
        read: require('./controllers/profileRead.controller'),
        social: require('./controllers/profileSocial.controller')
    }
};
