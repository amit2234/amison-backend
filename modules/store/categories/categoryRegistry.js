const { normalizeCategory } = require('../store.constants');

const framesHandler = require('./frames.handler');
const entranceEffectsHandler = require('./entranceEffects.handler');
const textBubblesHandler = require('./textBubbles.handler');
const themesHandler = require('./themes.handler');
const profileCardsHandler = require('./profileCards.handler');
const entryTagsHandler = require('./entryTags.handler');
const vipIdsHandler = require('./vipIds.handler');
const cpRingsHandler = require('./cpRings.handler');

const HANDLER_MAP = new Map([
    [framesHandler.category, framesHandler],
    [entranceEffectsHandler.category, entranceEffectsHandler],
    [textBubblesHandler.category, textBubblesHandler],
    [themesHandler.category, themesHandler],
    [profileCardsHandler.category, profileCardsHandler],
    [entryTagsHandler.category, entryTagsHandler],
    [vipIdsHandler.category, vipIdsHandler],
    [cpRingsHandler.category, cpRingsHandler]
]);

function getCategoryHandler(rawCategory) {
    const normalized = normalizeCategory(rawCategory, 'Frames');
    return HANDLER_MAP.get(normalized) || framesHandler;
}

module.exports = {
    getCategoryHandler,
    HANDLER_MAP
};
