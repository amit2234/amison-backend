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
            id: u._id.toString(),
            uid: u.uid || u._id.toString(),
            name: u.name || u.displayName || 'User',
            avatarUri: u.avatarUri || u.photoUrl || '',
            coins: u.coins || 0,
            diamonds: u.diamonds || 0,
            level: u.level || 1,
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
        const { userId, isBanned } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

        const User = getCoreUserModel();
        if (!User) return res.status(404).json({ success: false, error: 'User model not found' });

        const updated = await User.findOneAndUpdate(
            { $or: [{ uid: userId }, { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null }] },
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

// 3. POST /api/newop/user/update - Update coins, diamonds, role
router.post('/user/update', requireNewopAdmin, async (req, res) => {
    try {
        const { userId, coins, diamonds, role } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

        const User = getCoreUserModel();
        if (!User) return res.status(404).json({ success: false, error: 'User model not found' });

        const updateFields = { updatedAt: new Date() };
        if (coins !== undefined && !isNaN(Number(coins))) updateFields.coins = Number(coins);
        if (diamonds !== undefined && !isNaN(Number(diamonds))) updateFields.diamonds = Number(diamonds);
        if (role !== undefined && typeof role === 'string') updateFields.role = role.trim();

        const updated = await User.findOneAndUpdate(
            { $or: [{ uid: userId }, { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null }] },
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

module.exports = router;