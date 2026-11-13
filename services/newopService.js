const NewopAuthService = require('./newopAuthService');
const NewopUserService = require('./newopUserService');
const NewopRoomService = require('./newopRoomService');
const NewopZegoService = require('./newopZegoService');

/**
 * Modular Newop Service Facade combining Auth, User, Room, and Zego RTC Services.
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
    resetRoomPhotos: NewopRoomService.resetRoomPhotos.bind(NewopRoomService),

    // ZEGO-RTC Configuration Methods
    getZegoConfig: NewopZegoService.getZegoConfig.bind(NewopZegoService),
    updateZegoConfig: NewopZegoService.updateZegoConfig.bind(NewopZegoService)
};

module.exports = NewopService;

