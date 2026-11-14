const constants = require('./messaging.constants');
const models = require('./Message.model');
const cache = require('./messaging.cache');
const service = require('./messaging.service');
const controller = require('./messaging.controller');
const gateway = require('./messaging.socket');
const routes = require('./messaging.routes');

module.exports = {
    constants,
    models,
    cache,
    service,
    controller,
    gateway,
    routes
};