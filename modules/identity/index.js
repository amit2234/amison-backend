const constants = require('./identity.constants');
const SequenceCounter = require('./SequenceCounter.model');
const service = require('./identity.service');

module.exports = {
    constants,
    SequenceCounter,
    service,
    getNextRoomDisplayId: () => service.getNextRoomDisplayId(),
    getNextUserNumericId: () => service.getNextUserNumericId(),
    createUserWithUniqueId: (fn) => service.createUserWithUniqueId(fn),
    createRoomWithUniqueDisplayId: (fn) => service.createRoomWithUniqueDisplayId(fn),
    validateAdminRoomDisplayId: (id, ownerUid) => service.validateAdminRoomDisplayId(id, ownerUid),
    validateAdminUserNumericId: (id, uid) => service.validateAdminUserNumericId(id, uid)
};