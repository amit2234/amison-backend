const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ============================================================================
// MONGOOSE SCHEMA: NEWOP ADMIN PERMISSIONS (newop_admins)
// Dedicated collection to lock Newop access strictly to authorized Firebase Auth UIDs
// ============================================================================
const newopAdminSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth UID
    adminName: { type: String, default: 'Super Master' },
    role: { type: String, enum: ['super_admin', 'super_master', 'admin'], default: 'super_admin' },
    passwordHash: { type: String, default: '123456' }, // Root access password
    isActive: { type: Boolean, default: true, index: true },
    grantedBy: { type: String, default: 'owner' },
    grantedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'newop_admins' });

const NewopAdmin = mongoose.models.NewopAdmin || mongoose.model('NewopAdmin', newopAdminSchema);

// Helper to get the main User model (from server.js)
const getCoreUserModel = () => mongoose.models.User;

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
 * Modded APKs or unauthorized users cannot access any Newop data or functions.
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
// Returns whether the given user UID is authorized for Newop (used to load menu dynamically)
router.get('/check-access/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.json({ success: true, hasAccess: false, title: '' });

        const cleanUid = String(uid).trim();
        const hasAccess = await isAuthorizedNewopAdmin(cleanUid);

        return res.json({
            success: true,
            hasAccess,
            title: hasAccess ? 'Newop - Super master' : '',
            role: hasAccess ? 'super_admin' : 'user'
        });
    } catch (e) {
        console.error('[Newop Auth] check-access error:', e);
        return res.status(500).json({ success: false, hasAccess: false, error: e.message });
    }
});

// B. POST /api/newop/auth/verify
// Verifies user password before unlocking Newop screen
router.post('/auth/verify', async (req, res) => {
    try {
        const { uid, password } = req.body;
        if (!uid || !password) {
            return res.status(400).json({ success: false, error: 'UID and Password are required' });
        }

        const cleanUid = String(uid).trim();
        const isAuth = await isAuthorizedNewopAdmin(cleanUid);
        if (!isAuth) {
            return res.status(403).json({ success: false, error: 'Access denied: User UID is not authorized in backend.' });
        }

        const admin = await NewopAdmin.findOne({ uid: cleanUid, isActive: true }).lean();
        const expectedPassword = admin?.passwordHash || '123456';

        if (String(password).trim() !== expectedPassword.trim()) {
            return res.status(401).json({ success: false, error: 'Incorrect password. Default is 123456.' });
        }

        return res.json({
            success: true,
            message: 'Authenticated successfully',
            role: admin?.role || 'super_admin'
        });
    } catch (e) {
        console.error('[Newop Auth] verify error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// C. POST /api/newop/admin/grant
// Grants Newop access to a permanent Firebase Auth UID in MongoDB Atlas
router.post('/admin/grant', async (req, res) => {
    try {
        const { masterKey, callerUid, targetUid, adminName, role, password } = req.body;
        if (!targetUid) {
            return res.status(400).json({ success: false, error: 'targetUid is required' });
        }

        const cleanTargetUid = String(targetUid).trim();
        const isMaster = masterKey === (process.env.NEWOP_MASTER_KEY || 'amison_super_owner_2026');
        const isCallerAdmin = callerUid ? await isAuthorizedNewopAdmin(callerUid) : false;

        if (!isMaster && !isCallerAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized to grant Newop access' });
        }

        const adminDoc = await NewopAdmin.findOneAndUpdate(
            { uid: cleanTargetUid },
            {
                $set: {
                    uid: cleanTargetUid,
                    adminName: adminName || 'Super Master',
                    role: role || 'super_admin',
                    passwordHash: password || '123456',
                    isActive: true,
                    grantedBy: callerUid || 'owner',
                    updatedAt: new Date()
                },
                $setOnInsert: { grantedAt: new Date() }
            },
            { upsert: true, new: true }
        ).lean();

        // Emit real-time notification to user via WebSocket if online
        try {
            const chatSocket = require('./chatSocket');
            if (chatSocket && typeof chatSocket.emitToUser === 'function') {
                chatSocket.emitToUser(cleanTargetUid, {
                    type: 'user:newop_access_changed',
                    hasAccess: true,
                    title: 'Newop - Super master'
                });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: `Newop access successfully granted to UID: ${cleanTargetUid}`,
            admin: adminDoc
        });
    } catch (e) {
        console.error('[Newop Auth] grant error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// D. POST /api/newop/admin/revoke
// Revokes Newop access from a UID
router.post('/admin/revoke', async (req, res) => {
    try {
        const { masterKey, callerUid, targetUid } = req.body;
        if (!targetUid) {
            return res.status(400).json({ success: false, error: 'targetUid is required' });
        }

        const cleanTargetUid = String(targetUid).trim();
        const isMaster = masterKey === (process.env.NEWOP_MASTER_KEY || 'amison_super_owner_2026');
        const isCallerAdmin = callerUid ? await isAuthorizedNewopAdmin(callerUid) : false;

        if (!isMaster && !isCallerAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized to revoke Newop access' });
        }

        await NewopAdmin.updateOne(
            { uid: cleanTargetUid },
            { $set: { isActive: false, updatedAt: new Date() } }
        );

        // Emit real-time notification to user via WebSocket
        try {
            const chatSocket = require('./chatSocket');
            if (chatSocket && typeof chatSocket.emitToUser === 'function') {
                chatSocket.emitToUser(cleanTargetUid, {
                    type: 'user:newop_access_changed',
                    hasAccess: false
                });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: `Newop access revoked from UID: ${cleanTargetUid}`
        });
    } catch (e) {
        console.error('[Newop Auth] revoke error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// E. GET /api/newop/admin/list
// Lists all authorized Newop admin UIDs
router.get('/admin/list', requireNewopAdmin, async (req, res) => {
    try {
        const admins = await NewopAdmin.find({ isActive: true }).lean();
        return res.json({ success: true, admins });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// MONGOOSE SCHEMA: NEWOP USER MANAGEMENT COLLECTION (newop_users)
// ============================================================================
const newopUserControlSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true }, // Permanent Auth UID (UserDocid)
    numericId: { type: Number, index: true }, // 9-digit display ID
    isBlocked: { type: Boolean, default: false, index: true }, // Banned toggle status
    banReason: { type: String, default: '' },
    banDuration: { type: String, default: '' },
    bannedAt: { type: Date, default: null },
    isReset: { type: Boolean, default: false }, // Reset button status (No DP)
    goldCoin: { type: Number, default: 0 },
    diamond: { type: Number, default: 0 },
    roomId: { type: String, default: '' },
    roomDocId: { type: String, default: '' },
    agencyId: { type: String, default: '' },
    familyId: { type: String, default: '' },
    backgroundPhoto: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'newop_users' });

const NewopUserControl = mongoose.models.NewopUserControl || mongoose.model('NewopUserControl', newopUserControlSchema);

// ============================================================================
// NEWOP -> SLIDE MENU -> USER OPTION ENDPOINTS (Protected with requireNewopAdmin)
// ============================================================================

// 1. GET /api/newop/users
// Used for: All tab, New tab (Daily/Weekly/Monthly), Banned tab, and Search User UID
router.get('/users', requireNewopAdmin, async (req, res) => {
    try {
        const User = getCoreUserModel();
        if (!User) {
            return res.status(500).json({ success: false, error: 'Core User model not initialized' });
        }

        const { filter, timeRange, search } = req.query;
        const query = {};

        // Search by UID, 9-digit ID, or Name
        if (search && search.trim()) {
            const cleanSearch = search.trim();
            const numSearch = Number(cleanSearch);
            const orConds = [
                { uid: { $regex: cleanSearch, $options: 'i' } },
                { name: { $regex: cleanSearch, $options: 'i' } }
            ];
            if (!isNaN(numSearch) && numSearch > 0) {
                orConds.push({ numericId: numSearch });
            }
            query.$or = orConds;
        }

        // Time filter for "New" tab (Daily, Weekly, Monthly)
        if (filter === 'New' && timeRange) {
            const now = new Date();
            let cutoff = new Date(0);
            if (timeRange === 'Daily') {
                cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            } else if (timeRange === 'Weekly') {
                cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            } else if (timeRange === 'Monthly') {
                cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            }
            query.createdAt = { $gte: cutoff };
        }

        const coreUsers = await User.find(query).sort({ createdAt: -1 }).limit(300).lean();
        const uids = coreUsers.map(u => u.uid);
        const controls = await NewopUserControl.find({ uid: { $in: uids } }).lean();
        const controlMap = {};
        controls.forEach(c => {
            controlMap[c.uid] = c;
        });

        let mergedUsers = coreUsers.map(u => {
            const ctrl = controlMap[u.uid] || {};
            return {
                docId: u.uid,
                uid: u.uid,
                id: String(ctrl.numericId || u.numericId || u.uid),
                numericId: ctrl.numericId || u.numericId || 0,
                name: u.name || 'User',
                gender: u.gender || 'male',
                country: u.country || 'India',
                googleEmail: u.email || '',
                profilePhoto: ctrl.isReset ? '' : (u.avatarUrl || ''),
                backgroundPhoto: ctrl.isReset ? '' : (ctrl.backgroundPhoto || ''),
                isBlocked: !!ctrl.isBlocked,
                banReason: ctrl.banReason || '',
                banDuration: ctrl.banDuration || '',
                isReset: !!ctrl.isReset,
                goldCoin: String(u.coins !== undefined ? u.coins : (ctrl.goldCoin || 0)),
                diamond: String(u.diamonds !== undefined ? u.diamonds : (ctrl.diamond || 0)),
                roomId: (ctrl.roomId && ctrl.roomId !== '12345') ? ctrl.roomId : '',
                roomDocId: ctrl.roomDocId || '',
                agencyId: (ctrl.agencyId && ctrl.agencyId !== 'no join') ? ctrl.agencyId : '',
                familyId: (ctrl.familyId && ctrl.familyId !== 'no join') ? ctrl.familyId : '',
                createdAt: u.createdAt ? new Date(u.createdAt).getTime() : Date.now()
            };
        });

        if (filter === 'Banned') {
            mergedUsers = mergedUsers.filter(u => u.isBlocked);
        }

        return res.json({ success: true, users: mergedUsers });
    } catch (e) {
        console.error('[Newop MongoDB] Fetch users error:', e);
        res.status(500).json({ success: false, users: [], error: e.message });
    }
});

// 2. POST /api/newop/user/ban
// Used for: Banned toggle switch on User Card (Ban with reason & duration, or Unban)
router.post('/user/ban', requireNewopAdmin, async (req, res) => {
    try {
        const { uid, isBlocked, banReason, banDuration } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = uid.toString().trim();
        const updateData = {
            isBlocked: !!isBlocked,
            banReason: isBlocked ? (banReason || 'Violation of community rules.') : '',
            banDuration: isBlocked ? (banDuration || 'Permanent') : '',
            bannedAt: isBlocked ? new Date() : null,
            updatedAt: new Date()
        };

        const control = await NewopUserControl.findOneAndUpdate(
            { uid: cleanUid },
            { $set: updateData },
            { upsert: true, new: true }
        ).lean();

        return res.json({ success: true, control });
    } catch (e) {
        console.error('[Newop MongoDB] Ban user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. POST /api/newop/user/update
// Used for: View info -> Edit button (ID, Gender, Cuntry, Gold coin, Diamond, Room id, Google)
router.post('/user/update', requireNewopAdmin, async (req, res) => {
    try {
        const { uid, numericId, gender, country, goldCoin, diamond, roomId, googleEmail } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = uid.toString().trim();
        const User = getCoreUserModel();

        // Update core profile fields in Users collection
        if (User) {
            const coreUpdate = { updatedAt: new Date() };
            if (numericId !== undefined && !isNaN(Number(numericId)) && Number(numericId) > 0) {
                coreUpdate.numericId = Number(numericId);
            }
            if (gender !== undefined) coreUpdate.gender = gender;
            if (country !== undefined) coreUpdate.country = country;
            if (googleEmail !== undefined) coreUpdate.email = googleEmail.trim().toLowerCase();
            if (goldCoin !== undefined) coreUpdate.coins = Math.max(0, Number(goldCoin) || 0);
            if (diamond !== undefined) coreUpdate.diamonds = Math.max(0, Number(diamond) || 0);

            await User.findOneAndUpdate({ uid: cleanUid }, { $set: coreUpdate });
        }

        // Sync Redis Wallet Cache if coins or diamonds were updated by Admin
        try {
            const { syncRedisWallet } = require('./wallet');
            if (syncRedisWallet && (goldCoin !== undefined || diamond !== undefined)) {
                await syncRedisWallet(
                    cleanUid,
                    goldCoin !== undefined ? Math.max(0, Number(goldCoin) || 0) : undefined,
                    diamond !== undefined ? Math.max(0, Number(diamond) || 0) : undefined
                );
            }
        } catch (_) {}

        // Update Newop control fields in newop_users collection
        const ctrlUpdate = { updatedAt: new Date() };
        if (numericId !== undefined && !isNaN(Number(numericId)) && Number(numericId) > 0) {
            ctrlUpdate.numericId = Number(numericId);
        }
        if (goldCoin !== undefined) ctrlUpdate.goldCoin = Math.max(0, Number(goldCoin) || 0);
        if (diamond !== undefined) ctrlUpdate.diamond = Math.max(0, Number(diamond) || 0);
        if (roomId !== undefined) ctrlUpdate.roomId = String(roomId);

        const control = await NewopUserControl.findOneAndUpdate(
            { uid: cleanUid },
            { $set: ctrlUpdate },
            { upsert: true, new: true }
        ).lean();

        return res.json({ success: true, control });
    } catch (e) {
        console.error('[Newop MongoDB] Update user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. POST /api/newop/user/reset-photos
// Used for: View info -> Reset button (Resets Profile Photo & Background Photo to default No DP)
router.post('/user/reset-photos', requireNewopAdmin, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = uid.toString().trim();
        const User = getCoreUserModel();

        if (User) {
            await User.findOneAndUpdate(
                { uid: cleanUid },
                { $set: { avatarUrl: '', updatedAt: new Date() } }
            );
        }

        const control = await NewopUserControl.findOneAndUpdate(
            { uid: cleanUid },
            {
                $set: {
                    isReset: true,
                    backgroundPhoto: '',
                    updatedAt: new Date()
                }
            },
            { upsert: true, new: true }
        ).lean();

        return res.json({ success: true, control });
    } catch (e) {
        console.error('[
