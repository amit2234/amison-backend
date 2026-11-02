const NewopAuthService = require('./newopAuthService');
const NewopUserService = require('./newopUserService');
const NewopRoomService = require('./newopRoomService');

/**
 * Modular Newop Service Facade combining Auth, User, and Room Services.
 */
const NewopService = {
    // Auth & Permission Methods
    isAuthorizedNewopAdmin: NewopAuthService.isAuthorizedNewopAdmin.bind(NewopAuthService),

    // User Management Methods
    getAllUsers: NewopUserService.getAllUsers.bind(NewopUserService),
    banOrUnbanUser: NewopUserService.banOrUnbanUser.bind(NewopUserService),
    updateUserDetails: NewopUserService.updateUserDetails.bind(NewopUserService),
    resetUserPhotos: NewopUserService.resetUserPhotos.bind(NewopUserService),

    // Room Management Methods
    getAllRooms: NewopRoomService.getAllRooms.bind(NewopRoomService),
    getRoomInfo: NewopRoomService.getRoomInfo.bind(NewopRoomService),
    updateRoomDetails: NewopRoomService.updateRoomDetails.bind(NewopRoomService),
    blockOrUnblockRoom: NewopRoomService.blockOrUnblockRoom.bind(NewopRoomService),
    resetRoomPhotos: NewopRoomService.resetRoomPhotos.bind(NewopRoomService)
};

module.exports = NewopService;