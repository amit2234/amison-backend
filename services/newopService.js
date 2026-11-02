const mongoose = require('mongoose');
const NewopAdmin = require('../models/NewopAdmin');
const Room = require('../models/Room');
const User = require('../models/User');

const getCoreUserModel = () => mongoose.models.User || User;

const NewopService = {
    /**
     * Checks if a user's permanent Auth UID has active Newop permissions
     */
    async isAuthorizedNewopAdmin(uid) {
        if (!uid || typeof uid !== 'string') return false;
        const cleanUid = uid.trim();
        if (!cleanUid) return false;

        // 1. Check newop_admins collection in MongoDB Atlas
        const admin = await NewopAdmin.findOne({ uid: cleanUid, isActive: true }).lean();
        if (admin) return true;

        // 2. Check Core User role for super_admin / super_master
        const CoreUser = getCoreUserModel();
        if (CoreUser) {
            const coreUser = await CoreUser.findOne({ uid: cleanUid }).lean();
            if (coreUser && (coreUser.role === 'super_admin' || coreUser.role === 'super_master')) {
                return true;
            }
        }

        return false;
    },

    /**
     * Fetch registered users with formatted fields for Newop Management
     */
    async getAllUsers() {
        const CoreUser = getCoreUserModel();
        if (!CoreUser) return [];

        const users = await CoreUser.find({}).sort({ createdAt: -1 }).limit(100).lean();
        return users.map(u => ({
            id: u.numericId ? String(u.numericId) : (u.uid || u._id.toString()),
            numericId: u.numericId ? String(u.numericId) : '',
            uid: u.uid || u._id.toString(),
            name: u.name || u.displayName || 'User',
            avatarUri: u.avatarUrl || u.avatarUri || u.photoUrl || '',
            email: u.email || '',
            googleEmail: u.email || '',
            gender: u.gender || 'male',
            country: u.country || 'India',
            coins: u.coins || 0,
            diamonds: u.diamonds || 0,
            goldCoin: String(u.coins || 0),
            diamond: String(u.diamonds || 0),
            level: u.level || 1,
            roomId: u.roomId || '',
            agencyId: u.agencyId || '',
            familyId: u.familyId || '',
            isBanned: u.isBanned === true,
            role: u.role || 'user'
        }));
    },

    /**
     * Ban or unban user by userId/uid/numericId
     */
    async banOrUnbanUser(targetId, isBanned) {
        const cleanId = String(targetId || '').trim();
        if (!cleanId) throw new Error('userId / uid is required');

        const CoreUser = getCoreUserModel();
        const updated = await CoreUser.findOneAndUpdate(
            { $or: [{ uid: cleanId }, { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null }, { numericId: Number(cleanId) || null }] },
            { $set: { isBanned: !!isBanned, updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) throw new Error('User not found');
        return updated;
    },

    /**
     * Update user details
     */
    async updateUserDetails(data) {
        const { userId, uid, numericId, id, coins, goldCoin, diamonds, diamond, role, gender, country, roomId, email, googleEmail } = data;
        const targetId = String(userId || uid || '').trim();
        if (!targetId) throw new Error('userId / uid is required');

        const CoreUser = getCoreUserModel();
        const updateFields = { updatedAt: new Date() };

        const rawNumId = numericId !== undefined ? numericId : id;
        if (rawNumId !== undefined && !isNaN(Number(rawNumId)) && Number(rawNumId) > 0) {
            updateFields.numericId = Number(rawNumId);
        }
        if (coins !== undefined && !isNaN(Number(coins))) updateFields.coins = Number(coins);
        if (goldCoin !== undefined && !isNaN(Number(goldCoin))) updateFields.coins = Number(goldCoin);
        if (diamonds !== undefined && !isNaN(Number(diamonds))) updateFields.diamonds = Number(diamonds);
        if (diamond !== undefined && !isNaN(Number(diamond))) updateFields.diamonds = Number(diamond);
        if (gender !== undefined && typeof gender === 'string') updateFields.gender = gender.trim();
        if (country !== undefined && typeof country === 'string') updateFields.country = country.trim();
        if (roomId !== undefined && typeof roomId === 'string') updateFields.roomId = roomId.trim();
        if (email !== undefined && typeof email === 'string') updateFields.email = email.trim();
        if (googleEmail !== undefined && typeof googleEmail === 'string') updateFields.email = googleEmail.trim();
        if (role !== undefined && typeof role === 'string') updateFields.role = role.trim();

        const updated = await CoreUser.findOneAndUpdate(
            { $or: [{ uid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }, { numericId: Number(targetId) || null }] },
            { $set: updateFields },
            { new: true }
        ).lean();

        if (!updated) throw new Error('User not found');
        return updated;
    },

    /**
     * Reset user photos
     */
    async resetUserPhotos(userId) {
        const cleanId = String(userId || '').trim();
        if (!cleanId) throw new Error('userId is required');

        const CoreUser = getCoreUserModel();
        const updated = await CoreUser.findOneAndUpdate(
            { $or: [{ uid: cleanId }, { _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : null }] },
            { $set: { avatarUri: '', backgroundUri: '', photoUrl: '', updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) throw new Error('User not found');
        return updated;
    },

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

module.exports = NewopService;