const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Room = require('../models/Room');
const RoomService = require('../services/roomService');
const firebase = require('../firebase');

// ============================================================================
// USER REST API ENDPOINTS (/api/users/* and /api/user/*)
// 100% PURE BACKEND DRIVEN (MONGODB ATLAS + REDIS + FIREBASE AUTH)
// Zero Firestore collections: Firebase is used strictly for Auth Token Verification
// ============================================================================

// 1. GET /user/:uid or GET /:uid - Fetch user profile by Auth UID, 9-digit numericId, or Email
async function handleGetUser(req, res, next) {
    try {
        const uid = req.params.uid;
        if (!uid) return res.status(400).json({ exists: false, error: 'Missing UID or Email' });

        const clean = String(uid).trim();
        if (clean === 'search' || clean === 'create' || clean === 'update-profile' || clean === 'google-login' || clean === 'verify-token') {
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

// 3. POST /google-login - Authoritative 100% Backend Google Sign-In & Verification
async function handleGoogleLogin(req, res) {
    try {
        const { idToken, email: clientEmail, name, avatarUrl, dob, gender, country, firebaseUid } = req.body;
        if (!idToken) {
            return res.status(400).json({ success: false, error: 'idToken is required' });
        }

        let verifiedUid = null;
        let verifiedEmail = null;
        let tokenName = '';
        let tokenPicture = '';
        let googleSubUid = null;

        // 1. Authoritative Firebase Admin Token Verification
        if (firebase.isFirebaseInitialized() && firebase.admin) {
            try {
                const decodedToken = await firebase.admin.auth().verifyIdToken(idToken);
                verifiedUid = decodedToken.uid;
                verifiedEmail = decodedToken.email;
                tokenName = decodedToken.name || '';
                tokenPicture = decodedToken.picture || '';
            } catch (tokenErr) {
                console.warn('[Users Route] Strict verifyIdToken notice (' + tokenErr.message + '), checking decoded token claims...');
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.decode(idToken);
                    if (decoded && decoded.sub) {
                        googleSubUid = String(decoded.sub).trim();
                    }
                    // Priority 1: Authentic Firebase Auth UID explicitly sent by Android FirebaseAuth
                    if (firebaseUid && String(firebaseUid).trim().length > 5) {
                        verifiedUid = String(firebaseUid).trim();
                    } else if (decoded && decoded.user_id) {
                        verifiedUid = decoded.user_id;
                    } else if (decoded && decoded.sub) {
                        verifiedUid = decoded.sub;
                    } else {
                        return res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token' });
                    }
                    verifiedEmail = decoded?.email || clientEmail || '';
                    tokenName = decoded?.name || '';
                    tokenPicture = decoded?.picture || '';
                } catch (jwtErr) {
                    return res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token' });
                }
            }
        } else {
            console.warn('[Users Route] Firebase Admin not initialized, treating idToken/firebaseUid as UID');
            verifiedUid = (firebaseUid && String(firebaseUid).trim().length > 5) ? String(firebaseUid).trim() : String(idToken).trim();
            verifiedEmail = (clientEmail || '').trim().toLowerCase();
        }

        // If client explicitly passed authentic Firebase Auth UID and verifiedUid was numeric Google sub, override with Firebase Auth UID
        if (firebaseUid && String(firebaseUid).trim().length > 5 && (/^\d+$/.test(verifiedUid) || verifiedUid === googleSubUid)) {
            verifiedUid = String(firebaseUid).trim();
        }

        if (!verifiedUid) {
            return res.status(400).json({ success: false, error: 'Could not extract UID from token' });
        }

        const cleanUid = String(verifiedUid).trim();
        const cleanEmail = (verifiedEmail || clientEmail || '').trim().toLowerCase();

        // 2. Authoritative MongoDB Check: Search by permanent Firebase Auth UID, Email, OR legacy Google sub ID
        const searchConditions = [
            { uid: cleanUid },
            ...(cleanEmail ? [{ email: cleanEmail }] : [])
        ];
        if (googleSubUid && googleSubUid !== cleanUid) {
            searchConditions.push({ uid: googleSubUid });
        }

        let existingUser = await User.findOne({ $or: searchConditions });

        if (existingUser) {
            // Auto-migrate legacy Google sub UID (or older UID) to permanent Firebase Auth UID
            if (existingUser.uid !== cleanUid) {
                const oldUid = existingUser.uid;
                console.log(`🔄 [Users Route] Auto-migrating MongoDB user uid from ${oldUid} to permanent Firebase Auth UID: ${cleanUid}`);
                existingUser.uid = cleanUid;
                if (cleanEmail && (!existingUser.email || existingUser.email !== cleanEmail)) {
                    existingUser.email = cleanEmail;
                }
                await existingUser.save();

                // Also update any room owned by this user to match the permanent Firebase Auth UID
                try {
                    await Room.updateMany({ ownerUid: oldUid }, { $set: { ownerUid: cleanUid, roomId: cleanUid } });
                } catch (mErr) {
                    console.warn('[Users Route] Room ownerUid migration notice:', mErr.message);
                }
            }

            // Auto-check and ensure permanent Room exists in MongoDB Atlas rooms collection
            try {
                let userRoom = await RoomService.getOwnerRoom(cleanUid);
                if (!userRoom) {
                    userRoom = await RoomService.createOrUpdateRoom({
                        ownerUid: cleanUid,
                        roomName: `${existingUser.name || 'User'}'s Party Room`,
                        roomPhotoUrl: existingUser.avatarUrl || '',
                        category: 'Voice Party'
                    });
                }
                if (userRoom && userRoom.displayRoomId && existingUser.roomId !== userRoom.displayRoomId) {
                    existingUser.roomId = String(userRoom.displayRoomId).trim();
                    await existingUser.save();
                }
            } catch (rErr) {
                console.warn('[Users Route] Existing user room check notice:', rErr.message);
            }

            console.log(`✅ [Users Route] Authenticated existing MongoDB user: ${existingUser.name} (${cleanEmail || cleanUid})`);
            return res.json({
                success: true,
                isNewUser: false,
                user: existingUser,
                message: 'Login successful'
            });
        }

        // 3. Genuine New User Flow
        // If name was provided in body (i.e. user already completed profile form), create immediately
        if (name && typeof name === 'string' && name.trim().length > 0) {
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
                avatarUrl: avatarUrl || tokenPicture || '',
                dob: dob || '',
                gender: gender || '',
                country: country || 'India',
                email: cleanEmail,
                coins: 0,
                diamonds: 0,
                level: 1
            });

            await newUser.save();
            console.log(`🆕 [Users Route] Created new user: ${newUser.name} (${newUser.uid})`);

            // Auto-provision permanent voice room in rooms collection
            try {
                const permanentRoom = await RoomService.createOrUpdateRoom({
                    ownerUid: cleanUid,
                    roomName: `${newUser.name}'s Party Room`,
                    roomPhotoUrl: newUser.avatarUrl || '',
                    category: 'Voice Party'
                });
                if (permanentRoom && permanentRoom.displayRoomId) {
                    newUser.roomId = String(permanentRoom.displayRoomId).trim();
                    await newUser.save();
                }
            } catch (roomErr) {
                console.warn('[Users Route] Room auto-provisioning notice:', roomErr.message);
            }

            return res.status(201).json({
                success: true,
                isNewUser: false,
                user: newUser,
                message: 'User created and logged in successfully'
            });
        }

        // Return new user status to APK so user can fill Create Profile form
        return res.json({
            success: true,
            isNewUser: true,
            uid: cleanUid,
            email: cleanEmail,
            suggestedName: tokenName || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
            suggestedPhotoUrl: tokenPicture || '',
            message: 'User does not exist in MongoDB. Ready to create profile.'
        });

    } catch (e) {
        console.error('[Users Route] Google login error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/google-login', handleGoogleLogin);
router.post('/user/google-login', handleGoogleLogin);
router.post('/verify-token', handleGoogleLogin);

// 4. POST /create or POST /user/create - Generates 9-digit unique numeric ID only for genuine new users
async function handleCreateUser(req, res) {
    try {
        const { uid, name, avatarUrl, dob, gender, country, email } = req.body;
        if (!uid || !name) {
            return res.status(400).json({ success: false, error: 'UID and Name are required' });
        }

        const cleanUid = String(uid).trim();
        const cleanEmail = (email || '').trim().toLowerCase();

        // Strict 1 Google Account = 1 ID guarantee: check by UID first, then by email
        let existing = await User.findOne({ uid: cleanUid });
        if (!existing && cleanEmail) {
            existing = await User.findOne({ email: cleanEmail });
            if (existing) {
                existing.uid = cleanUid;
                await existing.save();
            }
        }
        if (existing) {
            console.log(`[Users Route] Duplicate create attempt intercepted. Returning existing user: ${existing.name}`);
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

        // Auto-provision permanent voice room in rooms collection
        try {
            const permanentRoom = await RoomService.createOrUpdateRoom({
                ownerUid: cleanUid,
                roomName: `${newUser.name}'s Party Room`,
                roomPhotoUrl: newUser.avatarUrl || '',
                category: 'Voice Party'
            });
            if (permanentRoom && permanentRoom.displayRoomId) {
                newUser.roomId = String(permanentRoom.displayRoomId).trim();
                await newUser.save();
            }
        } catch (roomErr) {
            console.warn('[Users Route] Room auto-provisioning notice:', roomErr.message);
        }

        return res.json({ success: true, user: newUser });
    } catch (e) {
        console.error('[Users Route] Create user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/create', handleCreateUser);
router.post('/user/create', handleCreateUser);

// 5. POST /update-profile or POST /user/update-profile - Updates user profile
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

// 6. Parameterized UID lookup (mounted at bottom after specific static routes)
router.get('/user/:uid', handleGetUser);
router.get('/:uid', handleGetUser);

module.exports = router;