const constants = require('./room.constants');
const {
    channelManager,
    resolveRoomContext,
    getBroadcastTargets,
    resolveTrueOwnerUid,
    generateUnique6DigitId
} = require('./room.channel.manager');
const stateCache = require('./room.state.cache');
const gateway = require('./room.gateway');
const routes = require('./room.routes');

const activities = {
    lifecycle: require('./activities/roomLifecycle.activity'),
    presence: require('./activities/roomPresence.activity'),
    stageSeats: require('./activities/roomStageSeats.activity'),
    seatLock: require('./activities/roomSeatLock.activity'),
    chat: require('./activities/roomChat.activity'),
    gift: require('./activities/roomGift.activity'),
    moderation: require('./activities/roomModeration.activity'),
    settings: require('./activities/roomSettings.activity'),
    discovery: require('./activities/roomDiscovery.activity')
};

const controllers = {
    rest: require('./controllers/roomRest.controller'),
    media: require('./controllers/roomMedia.controller')
};

/**
 * Unified RoomService Facade (100% Backward Compatible for legacy routes/services)
 */
const service = {
    getLiveRooms: () => activities.discovery.getLiveRooms(),
    getOwnerRoom: (uid) => activities.settings.getOwnerRoom(uid),
    createOrUpdateRoom: (data) => activities.settings.createOrUpdateRoom(data),
    closeRoom: (ownerUid, roomId) => activities.settings.closeRoom(ownerUid, roomId),
    getRoomById: (id) => activities.settings.getRoomById(id),
    getRoomStateSnapshot: (id) => activities.settings.getRoomStateSnapshot(id),
    searchRooms: (q) => activities.discovery.searchRooms(q),
    resolveRoomUid: (displayId) => activities.discovery.resolveRoomUid(displayId),
    kickUser: (roomId, targetUserId, durationHours, hostName, requesterUid) => (
        activities.moderation.kickUser(roomId, targetUserId, durationHours, hostName, requesterUid)
    ),
    isUserKicked: (roomId, userId) => activities.moderation.isUserKicked(roomId, userId),
    unbanUser: (roomId, userId) => activities.moderation.unbanUser(roomId, userId),
    updateMemberRole: (roomId, targetUserId, newRole, requesterUid) => (
        activities.moderation.updateMemberRole(roomId, targetUserId, newRole, requesterUid)
    )
};

module.exports = {
    constants,
    channelManager,
    resolveRoomContext,
    getBroadcastTargets,
    resolveTrueOwnerUid,
    generateUnique6DigitId,
    stateCache,
    gateway,
    routes,
    activities,
    controllers,
    service
};
