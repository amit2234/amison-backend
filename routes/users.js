const express = require('express');
const router = express.Router();
const User = require('../models/User');

// ============================================================================
// USER REST API ENDPOINTS (/api/users/* and /api/user/*)
// ============================================================================

// 1. GET /user/:uid or GET /:uid - Fetch user profile by Auth UID, 9-digit numericId, or Email (2ms lean speed)
async function handleGetUser(req, res) {
    try {
        const uid = req.params.uid;
        if (!uid) return res.status(400).json({ exists: false, error: 'Missing UID or Email' });

        const clean = String(uid).trim();
        const cleanLower = clean.toLowerCase();
        const numId = Number(clean) || 0;

        // Lean query searching by permanent UID, numericId, or Email
        const user = await User.findOne({
            $or: [
                { uid: clean },
                ...(numId > 0 ? [{ numericId: numId }] : []),
                { email: cleanLower }
            ]
        }).lean();

        if (!user) {
            return res.json({ exists: false });
        }
        user.coins = Math.max(0, Number(user.coins) || 0);
        user.diamonds = Math.max(0, Number(user.diamonds) || 0);
        return res.json({ exists: true, user });
    } catch (e) {
        console.error('[Users Route] Fetch user error:', e);
        res.status(500).json({ exists: false, error: e.message });
    }
}

router.get('/user/:uid', handleGetUser);
router.get('/:uid', handleGetUser);

// 2. GET /search or GET /users/search - Search users by numericId, uid, or name
async function handleSearchUsers(req, res) {
    try {
        const query = (req.query.query || '').trim();
        if (!query) return res.json({ users: [] });

        const numId = Number(query);
        const orConditions = [
            { uid: query }
        ];

        if (!isNaN(numId) && numId > 0) {
            orConditions.push({ numericId: numId });
        }

        if (/^\d+$/.test(query)) {
            orConditions.push({
                $expr: {
                    $regexMatch: {
                        input: { $toString: "$numericId" },
                        regex: query
                    }
                }
            });
        }

        const users = await User.find({ $or: orConditions }).limit(20).lean();
        return res.json({ users: users || [] });
    } catch (e) {
        console.error('[Users Route] Search users error:', e);
        res.status(500).json({ users: [], error: e.message });
    }
}

router.get('/search', handleSearchUsers);
router.get('/users/search', handleSearchUsers);

// 3. POST /create or POST /user/create - Generates 9-digit unique numeric ID only for genuine new users
async function handleCreateUser(req, res) {
    try {
        const { uid, name, avatarUrl, dob, gender, country, email } = req.body;
        if (!uid || !name) {
            return res.status(400).json({ success: false, error: 'UID and Name are required' });
        }

        const cleanUid = String(uid).trim();
        const cleanEmail = (email || '').trim().toLowerCase();

        // 0-Duplicate guarantee: if user already exists by UID or Email, return existing
        let existing = await User.findOne({
            $or: [
                { uid: cleanUid },
                ...(cleanEmail ? [{ email: cleanEmail }] : [])
            ]
        });
        if (existing) {
            return res.json({ success: true, user: existing, message: 'User already exists' });
        }

        // Generate guaranteed unique 9-digit numericId
        let numericId;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            numericId = Math.floor(100000000 + Math.random() * 900000000);
            const conflict = await User.findOne({ numericId });
            if (!conflict) isUnique = true;
            attempts++;
        }

        const newUser = new User({
            uid: cleanUid,
            numericId: numericId || Math.floor(100000000 + Math.random() * 900000000),
            name: String(name).trim(),
            avatarUrl: avatarUrl || "",
            dob: dob || "",
            gender: gender || "",
            country: country || "India",
            email: cleanEmail,
            coins: 0,
            diamonds: 0,
            level: 1
        });

        await newUser.save();
        console.log(`[Users Route] Created user: ${newUser.name} (UID: ${newUser.uid}, NumericId: ${newUser.numericId})`);
        return res.json({ success: true, user: newUser });
    } catch (e) {
        console.error('[Users Route] Create user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/create', handleCreateUser);
router.post('/user/create', handleCreateUser);

// 4. POST /update-profile or POST /user/update-profile - Updates user profile
async function handleUpdateProfile(req, res) {
    try {
        const { uid, name, avatarUrl, dob, gender, country } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = String(uid).trim();
        const numId = Number(cleanUid) || 0;
        const user = await User.findOne({
            $or: [
                { uid: cleanUid },
                ...(numId > 0 ? [{ numericId: numId }] : []),
                { email: cleanUid.toLowerCase() }
            ]
        });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        if (name && typeof name === 'string') {
            const trimmed = name.trim();
            const isPlaceholder = /^(user|arcanjo|guest user|amison user)$/i.test(trimmed);
            if (trimmed.length > 0 && (!isPlaceholder || !user.name || /^(user|arcanjo|guest user|amison user)$/i.test(user.name))) {
                user.name = trimmed;
            }
        }
        if (avatarUrl !== undefined && avatarUrl !== "") user.avatarUrl = avatarUrl;
        if (dob !== undefined && dob !== "") user.dob = dob;
        if (gender !== undefined && gender !== "") user.gender = gender;
        if (country !== undefined && country !== "") user.country = country;
        user.updatedAt = new Date();

        await user.save();
        return res.json({ success: true, user });
    } catch (e) {
        console.error('[Users Route] Update profile error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/update-profile', handleUpdateProfile);
router.post('/user/update-profile', handleUpdateProfile);

module.exports = router;
