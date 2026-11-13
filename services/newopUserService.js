const mongoose = require('mongoose');
const User = require('../models/User');
const Room = require('../models/Room');
const NewopAuthService = require('./newopAuthService');

const getCoreUserModel = () => mongoose.models.User || User;

async function verifyZeroTrustAdmin(callerUid) {
    if (!callerUid) {
        throw new Error('Zero-Trust Security Error: callerUid is missing');
    }
    const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
    if (!isAuth) {
        throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
    }
}

const NewopUserService = {
    /**
     * Fetch registered users with formatted fields for Newop Management
     * Links rooms collection directly via internal UID (ownerUid === u.uid) to populate displayRoomId (e.g. 611949).
     */
    async getAllUsers(callerUid) {
        await verifyZeroTrustAdmin(callerUid);

        const CoreUser = getCoreUserModel();
        if (!CoreUser) return [];

        const [users, rooms] = await Promise.all([
            CoreUser.find({}).sort({ createdAt: -1 }).limit(200).lean(),
            Room.find({}).lean().catch(() => [])
        ]);

        const roomDisplayIdByOwner = {};
        for (const r of (rooms || [])) {
            const ownerKey = String(r.ownerUid || r.roomId || '').trim();
            const dispId = String(r.displayRoomId || '').trim();
            if (ownerKey && dispId) {
                roomDisplayIdByOwner[ownerKey] = dispId;
            }
        }

        return users.map(u => {
            const cleanUid = String(u.uid || u._id.toString()).trim();
            const resolvedRoomId = roomDisplayIdByOwner[cleanUid] || u.roomId || '';
            return {
                id: u.numericId ? String(u.numericId) : cleanUid,
                numericId: u.numericId ? String(u.numericId) : '',
                uid: cleanUid,
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
                roomId: resolvedRoomId,
                agencyId: u.agencyId || '',
                familyId: u.familyId || '',
                isBanned: u.isBanned === true,
                role: u.role || 'user'
            };
        });
    },

    /**
     * Ban or unban user by userId/uid/numericId
     */
    async banOrUnbanUser(callerUid, targetId, isBanned) {
        await verifyZeroTrustAdmin(callerUid);

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
    async updateUserDetails(callerUid, data) {
        await verifyZeroTrustAdmin(callerUid);

        const { userId, uid, numericId, id, coins, goldCoin, diamonds, diamond, role, gender, country, roomId, email, googleEmail } = data || {};
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
        if (roomId !== undefined && typeof roomId === 'string' && roomId.trim().length > 0) {
            updateFields.roomId = roomId.trim();
        }
        if (email !== undefined && typeof email === 'string') updateFields.email = email.trim();
        if (googleEmail !== undefined && typeof googleEmail === 'string') updateFields.email = googleEmail.trim();
        if (role !== undefined && typeof role === 'string') updateFields.role = role.trim();

        const updated = await CoreUser.findOneAndUpdate(
            { $or: [{ uid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }, { numericId: Number(targetId) || null }] },
            { $set: updateFields },
            { new: true }
        ).lean();

        if (!updated) throw new Error('User not found');

        if (roomId !== undefined && typeof roomId === 'string' && roomId.trim().length > 0) {
            const cleanDispId = roomId.trim();
            const ownerKey = updated.uid || targetId;
            await Room.updateOne(
                { $or: [{ ownerUid: ownerKey }, { roomId: ownerKey }] },
                { $set: { displayRoomId: cleanDispId, updatedAt: new Date() } }
            ).catch(() => {});
        }

        return updated;
    },

    /**
     * Reset user photos
     */
    async resetUserPhotos(callerUid, userId) {
        await verifyZeroTrustAdmin(callerUid);

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
    }
};

module.exports = NewopUserService;
