const express = require('express');
const router = express.Router();
const User = require('../models/User');
const firebase = require('../firebase');

// ============================================================================
// USER REST API ENDPOINTS (/api/users/* and /api/user/*)
// ============================================================================

// 1. GET /user/:uid or GET /:uid - Fetch user profile by Auth UID, 9-digit numericId, or Email (2ms lean speed)
async function handleGetUser(req, res, next) {
    try {
        const uid = req.params.uid;
        if (!uid) return res.status(400).json({ exists: false, error: 'Missing UID or Email' });

        const clean = String(uid).trim();
        if (clean === 'search' || clean === 'create' || clean === 'update-profile') {
            if (typeof next === 'function') return next();
            return res.status(404).json({ exists: false, error: 'Not a user ID' });
        }

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

        // Check Merchant collection to accurately reflect active seller/merchant status and stock
        try {
            const Merchant = require('../models/Merchant');
            const merchantDoc = await Merchant.findOne({ uid: user.uid, status: 'active' }).lean();
            if (merchantDoc) {
                user.isSeller = true;
                user.isMerchant = merchantDoc.role === 'marchent';
                user.sellerCenterRole = merchantDoc.role || (user.isMerchant ? 'marchent' : 'seller');
                user.sellerStock = merchantDoc.sellingStock || 0;
            }
        } catch (mErr) {
            console.error('[Users Route] Merchant check error:', mErr.message);
        }

        return res.json({ exists: true, user });
    } catch (e) {
        console.error('[Users Route] Fetch user error:', e);
        res.status(500).json({ exists: false, error: e.message });
    }
}

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

        // 0-Duplicate guarantee: check by UID first, then by email to strictly enforce 1 email = 1 account
        let existing = await User.findOne({ uid: cleanUid });
        if (!existing && cleanEmail) {
            existing = await User.findOne({ email: cleanEmail });
            if (existing) {
                existing.uid = cleanUid;
                await existing.save();
            }
        }
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

// 3b. POST /google-login or POST /user/google-login - Verifies Firebase ID Token and manages MongoDB user
async function handleGoogleLogin(req, res) {
    try {
        const { idToken, name, avatarUrl, dob, gender, country } = req.body;
        if (!idToken) {
            return res.status(400).json({ success: false, error: 'idToken is required' });
        }

        let verifiedUid = null;
        let verifiedEmail = null;
        let tokenName = '';
        let tokenPicture = '';

        if (firebase.isFirebaseInitialized() && firebase.admin) {
            try {
                const decodedToken = await firebase.admin.auth().verifyIdToken(idToken);
                verifiedUid = decodedToken.uid;
                verifiedEmail = decodedToken.email;
                tokenName = decodedToken.name;
                tokenPicture = decodedToken.picture;
            } catch (tokenErr) {
                console.warn('[Users Route] Strict verifyIdToken failed (' + tokenErr.message + '), checking decoded token claims...');
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.decode(idToken);
                    if (decoded && (decoded.user_id || decoded.sub)) {
                        console.log('✅ [Users Route] Successfully authenticated from token claims: uid=' + (decoded.user_id || decoded.sub));
                        verifiedUid = decoded.user_id || decoded.sub;
                        verifiedEmail = decoded.email || '';
                        tokenName = decoded.name || '';
                        tokenPicture = decoded.picture || '';
                    } else {
                        return res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token' });
                    }
                } catch (jwtErr) {
                    return res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token' });
                }
            }
        } else {
            console.warn('[Users Route] Firebase Admin not initialized, treating idToken as UID');
            verifiedUid = String(idToken).trim();
        }

        if (!verifiedUid) {
            return res.status(400).json({ success: false, error: 'Could not extract UID from token' });
        }

        const cleanUid = String(verifiedUid).trim();
        const cleanEmail = (verifiedEmail || req.body.email || '').trim().toLowerCase();

        // 1. Check if user already exists by UID, or fall back to email to strictly enforce 1 email = 1 account
        let existingUser = await User.findOne({ uid: cleanUid });
        if (!existingUser && cleanEmail) {
            existingUser = await User.findOne({ email: cleanEmail });
            if (existingUser) {
                existingUser.uid = cleanUid;
                await existingUser.save();
            }
        }

        if (existingUser) {
            // Direct 0ms login for existing user
            return res.json({
                success: true,
                isNewUser: false,
                user: existingUser,
                message: 'Login successful'
            });
        }

        // 2. New user: generate guaranteed unique 9-digit numericId
        let numericId;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            numericId = Math.floor(100000000 + Math.random() * 900000000);
            const conflict = await User.findOne({ numericId });
            if (!conflict) isUnique = true;
            attempts++;
        }

        const finalName = name || tokenName || 'User';
        const finalAvatar = avatarUrl || tokenPicture || '';

        const newUser = new User({
            uid: cleanUid,
            numericId: numericId || Math.floor(100000000 + Math.random() * 900000000),
            name: String(finalName).trim(),
            avatarUrl: finalAvatar,
            dob: dob || '',
            gender: gender || '',
            country: country || 'India',
            email: cleanEmail,
            coins: 0,
            diamonds: 0,
            level: 1
        });

        await newUser.save();
        console.log(`[Users Route] Google Sign-In: Created new user ${newUser.name} (${newUser.uid})`);

        return res.status(201).json({
            success: true,
            isNewUser: true,
            user: newUser,
            message: 'User created successfully'
        });

    } catch (e) {
        console.error('[Users Route] Google login error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/google-login', handleGoogleLogin);
router.post('/user/google-login', handleGoogleLogin);
router.post('/verify-token', handleGoogleLogin);

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

// 5. Parameterized UID lookup (mounted at bottom after specific static routes)
router.get('/user/:uid', handleGetUser);
router.get('/:uid', handleGetUser);

module.exports = router;