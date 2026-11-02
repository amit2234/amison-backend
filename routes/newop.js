const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ============================================================================
// MONGOOSE SCHEMA: NEWOP ADMIN PERMISSIONS (newop_admins)
// Dedicated collection to lock Newop master access strictly to authorized UIDs
// ============================================================================
const newopAdminSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    adminName: { type: String, default: 'Super Master' },
    role: { type: String, enum: ['super_admin', 'super_master', 'admin'], default: 'super_admin' },
    passwordHash: { type: String, default: '123456' },
    isActive: { type: Boolean, default: true, index: true },
    grantedBy: { type: String, default: 'owner' },
    grantedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'newop_admins' });

const NewopAdmin = mongoose.models.NewopAdmin || mongoose.model('NewopAdmin', newopAdminSchema);

// Helper to get the main User model
const getCoreUserModel = () => mongoose.models.User || require('../models/User');

/**
 * Checks if a user's permanent Auth UID has active Newop permissions
 */
async function isAuthorizedNewopAdmin(uid) {
    if (!uid || typeof uid !== 'string') return false;
    const cleanUid = uid.trim();
    if (!cleanUid) return false;

    // 1. Check newop_admins collection in MongoDB Atlas
    const admin = await NewopAdmin.findOne({ uid: cleanUid, isActive: true }).lean();
    if (admin) return true;

    // 2. Check Core User role for super_admin / super_master
    const User = getCoreUserModel();
    if (User) {
        const coreUser = await User.findOne({ uid: cleanUid }).lean();
        if (coreUser && (coreUser.role === 'super_admin' || coreUser.role === 'super_master')) {
            return true;
        }
    }

    return false;
}

/**
 * Zero-Trust Backend Middleware: Rejects any unauthorized request with HTTP 403 Forbidden.
 */
async function requireNewopAdmin(req, res, next) {
    try {
        const callerUid = req.headers['x-user-uid'] ||
            (req.headers['authorization'] && req.headers['authorization'].replace(/^Bearer\s+/i, '').trim()) ||
            req.body?.callerUid ||
            req.query?.callerUid;

        if (!callerUid) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: UID header missing. Newop is strictly locked from backend.'
            });
        }

        const isAuth = await isAuthorizedNewopAdmin(callerUid);
        if (!isAuth) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: This user UID does not have backend permissions for Newop.'
            });
        }

        req.callerUid = String(callerUid).trim();
        next();
    } catch (e) {
        console.error('[Newop Auth] requireNewopAdmin error:', e);
        res.status(500).json({ success: false, error: 'Internal server authorization error' });
    }
}

// ============================================================================
// DYNAMIC ACCESS & AUTHENTICATION ENDPOINTS
// ============================================================================

// A. GET /api/newop/check-access/:uid
router.get('/check-access/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.json({ success: true, hasAccess: false, title: '' });

        const cleanUid = String(uid).trim();
        const hasAccess = await isAuthorizedNewopAdmin(cleanUid);

        return res.json({
            success: true,
            hasAccess,
            title: hasAccess ? 'Newop - Super master' : ''
        });
    } catch (e) {
        console.error('[Newop Auth] check-access error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// B. POST /api/newop/login
router.post('/login', async (req, res) => {
    try {
        const { uid, password } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: 'UID is required' });

        const cleanUid = String(uid).trim();
        const isAuth = await isAuthorizedNewopAdmin(cleanUid);

        if (!isAuth) {
            return res.status(403).json({ success: false, error: 'Unauthorized Newop Admin UID' });
        }

        return res.json({
            success: true,
            message: 'Newop Admin authenticated successfully',
            role: 'super_master'
        });
    } catch (e) {
        console.error('[Newop Auth] login error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// MASTER USER & ADMIN MANAGEMENT ENDPOINTS (Strictly requiring Newop Admin)
// ============================================================================

// 1. GET /api/newop/users - Fetch registered users
router.get('/users', requireNewopAdmin, async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) return res.json({ success: true, users: [] });

        const users = await User.find({}).sort({ createdAt: -1 }).limit(100).lean();
        const formatted = users.map(u => ({
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

        res.json({ success: true, count: formatted.length, users: formatted });
    } catch (e) {
        console.error('[Newop] Fetch users error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. POST /api/newop/user/ban - Ban or unban user
router.post('/user/ban', requireNewopAdmin, async (req, res) => {
    try {
        const { userId, uid, isBanned } = req.body;
        const targetId = (userId || uid || '').trim();
        if (!targetId) return res.status(400).json({ success: false, error: 'userId / uid is required' });

        const User = getCoreUserModel();
        if (!User) return res.status(404).json({ success: false, error: 'User model not found' });

        const updated = await User.findOneAndUpdate(
            { $or: [{ uid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }, { numericId: Number(targetId) || null }] },
            { $set: { isBanned: !!isBanned, updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: `User ${isBanned ? 'banned' : 'unbanned'} successfully`, user: updated });
    } catch (e) {
        console.error('[Newop] Ban user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. POST /api/newop/user/update - Update numericId, coins, diamonds, email, gender, country, role
router.post('/user/update', requireNewopAdmin, async (req, res) => {
    try {
        const { userId, uid, numericId, id, coins, goldCoin, diamonds, diamond, role, gender, country, roomId, email, googleEmail } = req.body;
        const targetId = (userId || uid || '').trim();
        if (!targetId) return res.status(400).json({ success: false, error: 'userId / uid is required' });

        const User = getCoreUserModel();
        if (!User) return res.status(404).json({ success: false, error: 'User model not found' });

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

        const updated = await User.findOneAndUpdate(
            { $or: [{ uid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }, { numericId: Number(targetId) || null }] },
            { $set: updateFields },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'User updated successfully', user: updated });
    } catch (e) {
        console.error('[Newop] Update user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. POST /api/newop/user/reset-photos - Reset photos
router.post('/user/reset-photos', requireNewopAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

        const User = getCoreUserModel();
        if (!User) return res.status(404).json({ success: false, error: 'User model not found' });

        const updated = await User.findOneAndUpdate(
            { $or: [{ uid: userId }, { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null }] },
            { $set: { avatarUri: '', backgroundUri: '', photoUrl: '', updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'User photos reset successfully', user: updated });
    } catch (e) {
        console.error('[Newop] Reset photos error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. GET /api/newop/rooms - Fetch all rooms for Newop Room management
router.get('/rooms', requireNewopAdmin, async (req, res) => {
    try {
        const Room = mongoose.models.Room || require('../models/Room');
        const rooms = await Room.find({}).sort({ updatedAt: -1 }).limit(200).lean();
        const formatted = rooms.map(r => ({
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
        res.json({ success: true, count: formatted.length, rooms: formatted });
    } catch (e) {
        console.error('[Newop] Fetch rooms error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 6. GET /api/newop/room/:id - Fetch single room info for Newop Room View Info
router.get('/room/:id', requireNewopAdmin, async (req, res) => {
    try {
        const Room = mongoose.models.Room || require('../models/Room');
        const User = mongoose.models.User || require('../models/User');
        const targetId = String(req.params.id || '').trim();

        const room = await Room.findOne({
            $or: [
                { displayRoomId: targetId },
                { roomId: targetId },
                { ownerUid: targetId },
                { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }
            ]
        }).lean();

        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Resolve owner numericId and name
        let ownerNumericId = room.ownerUid;
        let ownerName = 'Room Owner';
        if (room.ownerUid) {
            const ownerUser = await User.findOne({ $or: [{ uid: room.ownerUid }, { _id: room.ownerUid.match(/^[0-9a-fA-F]{24}$/) ? room.ownerUid : null }] }).lean();
            if (ownerUser) {
                ownerNumericId = ownerUser.numericId ? String(ownerUser.numericId) : room.ownerUid;
                ownerName = ownerUser.name || ownerUser.displayName || 'Room Owner';
            }
        }

        // Room members
        const roomMembers = (room.seats || []).filter(s => s.userId).map(s => ({
            userId: s.userId,
            name: s.name || 'Member',
            avatar: s.avatar || ''
        }));

        res.json({
            success: true,
            room: {
                docId: room._id.toString(),
                roomId: room.displayRoomId || room.roomId,
                numericRoomId: room.displayRoomId || room.roomId,
                roomName: room.roomName || 'Voice Room',
                photoUrl: room.roomPhotoUrl || '',
                ownerUid: room.ownerUid || '',
                ownerNumericId: ownerNumericId,
                ownerName: ownerName,
                coOwners: room.coOwners || [],
                admins: room.admins || [],
                level: room.level || 1,
                roomMembers: roomMembers,
                isBlocked: room.isBlocked === true,
                isLive: room.isLive === true,
                category: room.category || 'Voice Party',
                announcement: room.announcement || ''
            }
        });
    } catch (e) {
        console.error('[Newop] Get room info error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. POST /api/newop/room/update - Update room name, displayId, level, coOwners, admins
router.post('/room/update', requireNewopAdmin, async (req, res) => {
    try {
        const Room = mongoose.models.Room || require('../models/Room');
        const { roomId, roomName, displayRoomId, level, coOwners, admins } = req.body;
        const targetId = String(roomId || displayRoomId || '').trim();
        if (!targetId) return res.status(400).json({ success: false, error: 'roomId is required' });

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

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        res.json({ success: true, message: 'Room updated successfully', room: updated });
    } catch (e) {
        console.error('[Newop] Update room error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 8. POST /api/newop/room/block - Block or unblock room
router.post('/room/block', requireNewopAdmin, async (req, res) => {
    try {
        const Room = mongoose.models.Room || require('../models/Room');
        const { roomId, isBlocked } = req.body;
        const targetId = String(roomId || '').trim();
        if (!targetId) return res.status(400).json({ success: false, error: 'roomId is required' });

        const updated = await Room.findOneAndUpdate(
            { $or: [{ displayRoomId: targetId }, { roomId: targetId }, { ownerUid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }] },
            { $set: { isBlocked: !!isBlocked, isLive: isBlocked ? false : true, updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        res.json({ success: true, message: `Room ${isBlocked ? 'blocked' : 'unblocked'} successfully`, room: updated });
    } catch (e) {
        console.error('[Newop] Block room error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 9. POST /api/newop/room/reset-photos - Reset room photo
router.post('/room/reset-photos', requireNewopAdmin, async (req, res) => {
    try {
        const Room = mongoose.models.Room || require('../models/Room');
        const { roomId } = req.body;
        const targetId = String(roomId || '').trim();
        if (!targetId) return res.status(400).json({ success: false, error: 'roomId is required' });

        const updated = await Room.findOneAndUpdate(
            { $or: [{ displayRoomId: targetId }, { roomId: targetId }, { ownerUid: targetId }, { _id: targetId.match(/^[0-9a-fA-F]{24}$/) ? targetId : null }] },
            { $set: { roomPhotoUrl: '', backgroundUrl: '', updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        res.json({ success: true, message: 'Room photos reset successfully', room: updated });
    } catch (e) {
        console.error('[Newop] Reset room photos error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
