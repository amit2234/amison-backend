const mongoose = require('mongoose');
const Room = require('../models/Room');
const User = require('../models/User');

const getCoreUserModel = () => mongoose.models.User || User;

const NewopRoomService = {
    /**
     * Fetch all rooms for Newop Room management
     */
    async getAllRooms() {
        const rooms = await Room.find({}).sort({ updatedAt: -1 }).limit(200).lean();
        return rooms.map(r => ({
            docId: r._id.toString(),
            roomId: r.displayRoomId || r.roomId,
            publicRoomId: r.displayRoomId || r.roomId,
            ownerUid: r.ownerUid || '',
            name: r.roomName || 'Voice Room',
            category: r.category || 'Voice Party',
            announcement: r.announcement || '',
            photoUrl: r.roomPhotoUrl || '',
            isLive: r.isLive === true,
            isBlocked: r.isBlocked === true,
            isPinned: r.isPinned === true,
            onlineCount: r.onlineCount || 0,
            heatScore: r.heatScore || 0,
            updatedAt: r.updatedAt
        }));
    },

    /**
     * Fetch single room info for Newop Room View Info
     */
    async getRoomInfo(id) {
        const targetId = String(id || '').trim();
        if (!targetId) throw new Error('Room ID is required');

        const room = await Room.findOne({
            $or: [
                { displayRoomId: targetId },
                { roomId: targetId },
                { ownerUid: targetId },
                { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }
            ]
        }).lean();

        if (!room) throw new Error('Room not found');

        const CoreUser = getCoreUserModel();
        let ownerNumericId = room.ownerUid;
        let ownerName = 'Room Owner';
        let ownerAvatar = '';

        if (room.ownerUid) {
            const ownerUser = await CoreUser.findOne({ $or: [{ uid: room.ownerUid }, { _id: room.ownerUid.match(/^[0-9a-fA-F]{24}$/) ? room.ownerUid : null }] }).lean();
            if (ownerUser) {
                ownerNumericId = ownerUser.numericId ? String(ownerUser.numericId) : room.ownerUid;
                ownerName = ownerUser.name || ownerUser.displayName || 'Room Owner';
                ownerAvatar = ownerUser.avatarUrl || ownerUser.avatarUri || ownerUser.photoUrl || '';
            }
        }

        // Fetch Co-Owner User Profiles
        const coOwnerProfiles = [];
        if (Array.isArray(room.coOwners) && room.coOwners.length > 0) {
            for (const coUid of room.coOwners) {
                if (!coUid) continue;
                const coUser = await CoreUser.findOne({ $or: [{ uid: coUid }, { numericId: Number(coUid) || null }] }).lean();
                coOwnerProfiles.push({
                    uid: coUid,
                    numericId: coUser?.numericId ? String(coUser.numericId) : coUid,
                    name: coUser?.name || 'Co-Owner',
                    avatar: coUser?.avatarUrl || coUser?.avatarUri || coUser?.photoUrl || ''
                });
            }
        }

        // Fetch Admin User Profiles
        const adminProfiles = [];
        if (Array.isArray(room.admins) && room.admins.length > 0) {
            for (const admUid of room.admins) {
                if (!admUid) continue;
                const admUser = await CoreUser.findOne({ $or: [{ uid: admUid }, { numericId: Number(admUid) || null }] }).lean();
                adminProfiles.push({
                    uid: admUid,
                    numericId: admUser?.numericId ? String(admUser.numericId) : admUid,
                    name: admUser?.name || 'Admin',
                    avatar: admUser?.avatarUrl || admUser?.avatarUri || admUser?.photoUrl || ''
                });
            }
        }

        // Fetch Seat Members Profiles
        const roomMembers = (room.seats || []).filter(s => s.userId).map(s => ({
            userId: s.userId,
            name: s.name || 'Member',
            avatar: s.avatar || ''
        }));

        return {
            docId: room._id.toString(),
            roomId: room.displayRoomId || room.roomId,
            numericRoomId: room.displayRoomId || room.roomId,
            roomName: room.roomName || 'Voice Room',
            photoUrl: room.roomPhotoUrl || '',
            ownerUid: room.ownerUid || '',
            ownerNumericId: ownerNumericId,
            ownerName: ownerName,
            ownerAvatar: ownerAvatar,
            coOwners: coOwnerProfiles,
            admins: adminProfiles,
            level: room.level || 1,
            roomMembers: roomMembers,
            isBlocked: room.isBlocked === true,
            isLive: room.isLive === true,
            category: room.category || 'Voice Party',
            announcement: room.announcement || ''
        };
    },

    /**
     * Update room details
     */
    async updateRoomDetails(data) {
        const { roomId, roomName, displayRoomId, level, coOwners, admins } = data;
        const targetId = String(roomId || displayRoomId || '').trim();
        if (!targetId) throw new Error('roomId is required');

        const updateFields = { updatedAt: new Date() };
        if (roomName !== undefined && typeof roomName === 'string') updateFields.roomName = roomName.trim();
        if (displayRoomId !== undefined) {
            updateFields.displayRoomId = String(displayRoomId).trim();
            updateFields.roomId = String(displayRoomId).trim();
        }
        if (level !== undefined && !isNaN(Number(level))) updateFields.level = Number(level);
        if (coOwners !== undefined && Array.isArray(coOwners)) updateFields.coOwners = coOwners;
        if (admins !== undefined && Array.isArray(admins)) updateFields.admins = admins;

        const updated = await Room.findOneAndUpdate(
            { $or: [{ displayRoomId: targetId }, { roomId: targetId }, { ownerUid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }] },
            { $set: updateFields },
            { new: true }
        ).lean();

        if (!updated) throw new Error('Room not found');
        return updated;
    },

    /**
     * Block or unblock room
     */
    async blockOrUnblockRoom(roomId, isBlocked) {
        const targetId = String(roomId || '').trim();
        if (!targetId) throw new Error('roomId is required');

        const updated = await Room.findOneAndUpdate(
            { $or: [{ displayRoomId: targetId }, { roomId: targetId }, { ownerUid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }] },
            { $set: { isBlocked: !!isBlocked, isLive: isBlocked ? false : true, updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) throw new Error('Room not found');
        return updated;
    },

    /**
     * Reset room photo & reset room name to default format: room-{displayRoomId}
     */
    async resetRoomPhotos(roomId) {
        const targetId = String(roomId || '').trim();
        if (!targetId) throw new Error('roomId is required');

        const room = await Room.findOne({
            $or: [{ displayRoomId: targetId }, { roomId: targetId }, { ownerUid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }]
        });

        if (!room) throw new Error('Room not found');

        const displayId = room.displayRoomId || room.roomId || '123456';
        const defaultRoomName = `room-${displayId}`;

        room.roomPhotoUrl = '';
        room.backgroundUrl = '';
        room.roomName = defaultRoomName;
        room.updatedAt = new Date();
        await room.save();

        return room.toObject();
    }
};

module.exports = NewopRoomService;