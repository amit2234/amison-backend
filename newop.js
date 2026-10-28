const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ============================================================================
// MONGOOSE SCHEMA: NEWOP USER MANAGEMENT COLLECTION (newop_users)
// Separate collection in MongoDB Atlas specifically for Newop -> Slide Menu -> User option
// Stores Ban status, Reset photo flag, Gold coin, Diamond, Room ID, Agency, Family, etc.
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

// Helper to get the main User model (from server.js)
const getCoreUserModel = () => mongoose.models.User;

// ============================================================================
// NEWOP -> SLIDE MENU -> USER OPTION ENDPOINTS
// ============================================================================

// 1. GET /api/newop/users
// Used for: All tab, New tab (Daily/Weekly/Monthly), Banned tab, and Search User UID
router.get('/users', async (req, res) => {
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
router.post('/user/ban', async (req, res) => {
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
router.post('/user/update', async (req, res) => {
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
router.post('/user/reset-photos', async (req, res) => {
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
        console.error('[Newop MongoDB] Reset photos error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
