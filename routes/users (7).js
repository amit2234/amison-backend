const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Room = require('../models/Room');
const RoomService = require('../services/roomService');
const identityModule = require('../modules/identity');
const firebase = require('../firebase');
const {
    verifyFirebaseIdTokenCryptographically,
    extractBearerToken,
    verifyStrictFirebaseToken,
    verifyAuthenticatedUser
} = require('../middleware/authMiddleware');
const { upload, uploadBufferToCloudinary } = require('../services/cloudinaryService');

const avatarUploadMiddleware = upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]);

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

// 2. GET /search or GET /users/search - Zero-Trust Backend Search strictly by numericId (digits) or name
async function handleSearchUsers(req, res) {
    try {
        const query = String(req.query.query || '').trim();
        if (!query) return res.json({ users: [] });

        const isDigitsOnly = /^\d+$/.test(query);
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let filter;

        if (isDigitsOnly) {
            const numId = Number(query);
            filter = {
                $or: [
                    ...(Number.isSafeInteger(numId) && numId > 0 ? [{ numericId: numId }] : []),
                    {
                        $expr: {
                            $regexMatch: {
                                input: { $toString: '$numericId' },
                                regex: `^${escaped}`
                            }
                        }
                    }
                ]
            };
        } else {
            filter = {
                name: new RegExp(escaped, 'i')
            };
        }

        const users = await User.find(filter)
            .select('uid numericId name avatarUrl level gender country isBanned roomId')
            .limit(30)
            .lean();

        if (isDigitsOnly) {
            const exactNum = Number(query);
            users.sort((a, b) => {
                const aExact = a.numericId === exactNum ? 1 : 0;
                const bExact = b.numericId === exactNum ? 1 : 0;
                return bExact - aExact;
            });
        }

        return res.json({ users: users || [] });
    } catch (e) {
        console.error('[Users Route] Search users error:', e);
        res.status(500).json({ users: [], error: e.message });
    }
}

router.get('/search', verifyAuthenticatedUser, handleSearchUsers);
router.get('/users/search', verifyAuthenticatedUser, handleSearchUsers);

// 3. POST /google-login - Authoritative 100% Backend Google Sign-In & Verification
async function handleGoogleLogin(req, res) {
    try {
        const { idToken, email: clientEmail, name, avatarUrl, dob, gender, country } = req.body || {};
        const rawToken = extractBearerToken(req) || String(idToken || '').trim();
        if (!rawToken) {
            return res.status(401).json({ success: false, error: 'Valid Firebase ID token is required' });
        }

        let decodedToken;
        try {
            decodedToken = await verifyFirebaseIdTokenCryptographically(rawToken);
        } catch (tokenErr) {
            console.warn('⚠️ [Users Route] Rejected invalid/expired Firebase ID token on google-login:', tokenErr.message);
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired Firebase ID token' });
        }

        const cleanUid = String(decodedToken.uid || decodedToken.sub || '').trim();
        const verifiedEmail = decodedToken.email || '';
        const tokenName = decodedToken.name || '';
        const tokenPicture = decodedToken.picture || '';
        const googleSubUid = decodedToken.firebase?.identities?.['google.com']?.[0]
            ? String(decodedToken.firebase.identities['google.com'][0]).trim()
            : null;

        if (!cleanUid) {
            return res.status(401).json({ success: false, error: 'Could not extract verified UID from token' });
        }

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
            if (existingUser.isBanned) {
                return res.status(403).json({
                    success: false,
                    error: 'Your account has been suspended or banned.'
                });
            }
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

            // Sync displayRoomId ONLY if user has already created a room (never auto-provision room before user creates one)
            try {
                const userRoom = await RoomService.getOwnerRoom(cleanUid);
                if (userRoom && userRoom.displayRoomId && existingUser.roomId !== String(userRoom.displayRoomId).trim()) {
                    existingUser.roomId = String(userRoom.displayRoomId).trim();
                    await existingUser.save();
                }
            } catch (rErr) {
                console.warn('[Users Route] Existing user room sync notice:', rErr.message);
            }

            if (!existingUser.numericId || Number(existingUser.numericId) < 100000000) {
                existingUser.numericId = await identityModule.getNextUserNumericId();
                await existingUser.save();
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
            const newUser = await identityModule.createUserWithUniqueId(async (allocatedNumericId) => {
                const doc = new User({
                    uid: cleanUid,
                    numericId: allocatedNumericId,
                    name: String(name).trim(),
                    avatarUrl: avatarUrl || tokenPicture || '',
                    dob: dob || '',
                    gender: gender || '',
                    country: country || 'India',
                    email: cleanEmail,
                    coins: 0,
                    diamonds: 0,
                    level: 1,
                    roomId: ''
                });
                await doc.save();
                return doc;
            });
            console.log(`🆕 [Users Route] Created new user: ${newUser.name} (${newUser.uid}, NumericId: ${newUser.numericId})`);

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
        const { name, avatarUrl, dob, gender, country, email } = req.body || {};
        const cleanUid = String(req.callerUid || '').trim();
        if (!cleanUid || !name) {
            return res.status(400).json({ success: false, error: 'Verified UID and Name are required' });
        }

        const cleanEmail = (req.user?.email || email || '').trim().toLowerCase();

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

        // Generate guaranteed unique sequential 9-digit numericId (120110109+, +25..45)
        const newUser = await identityModule.createUserWithUniqueId(async (allocatedNumericId) => {
            const doc = new User({
                uid: cleanUid,
                numericId: allocatedNumericId,
                name: String(name).trim(),
                avatarUrl: avatarUrl || "",
                dob: dob || "",
                gender: gender || "",
                country: country || "India",
                email: cleanEmail,
                coins: 0,
                diamonds: 0,
                level: 1,
                roomId: ""
            });
            await doc.save();
            return doc;
        });
        console.log(`[Users Route] Created user: ${newUser.name} (UID: ${newUser.uid}, NumericId: ${newUser.numericId})`);

        return res.json({ success: true, user: newUser });
    } catch (e) {
        console.error('[Users Route] Create user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/create', verifyStrictFirebaseToken, handleCreateUser);
router.post('/user/create', verifyStrictFirebaseToken, handleCreateUser);

// 5. POST /update-profile or POST /user/update-profile - Updates authenticated caller's profile
async function handleUpdateProfile(req, res) {
    try {
        const { name, avatarUrl, backgroundUrl, backgroundUrls, equippedBadges, dob, gender, country } = req.body || {};
        const cleanUid = String(req.callerUid || '').trim();
        if (!cleanUid) return res.status(401).json({ success: false, error: 'Missing verified UID' });

        const user = await User.findOne({ uid: cleanUid });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        if (name && typeof name === 'string') {
            const trimmed = name.trim();
            const isPlaceholder = /^(user|arcanjo|guest user|amison user)$/i.test(trimmed);
            if (trimmed.length > 0 && (!isPlaceholder || !user.name || /^(user|arcanjo|guest user|amison user)$/i.test(user.name))) {
                user.name = trimmed;
            }
        }
        if (typeof avatarUrl === 'string' && avatarUrl.trim().length > 0) {
            const cleanAvatar = avatarUrl.trim();
            const isValidRemoteUrl = /^https?:\/\//i.test(cleanAvatar) || cleanAvatar === 'default_avatar';
            if (isValidRemoteUrl) {
                user.avatarUrl = cleanAvatar;
            } else {
                console.warn(`⚠️ [Users Route] Ignored non-HTTP avatarUrl for ${cleanUid}: ${cleanAvatar.slice(0, 60)}`);
            }
        }
        if (Array.isArray(backgroundUrls)) {
            user.backgroundUrls = backgroundUrls
                .map(u => String(u || '').trim())
                .filter(Boolean)
                .slice(0, 8);
        } else if (typeof backgroundUrl === 'string') {
            user.backgroundUrls = backgroundUrl
                .split(',')
                .map(u => u.trim())
                .filter(Boolean)
                .slice(0, 8);
        }
        if (Array.isArray(equippedBadges)) {
            user.equippedBadges = equippedBadges
                .map(b => String(b || '').trim())
                .filter(Boolean)
                .slice(0, 10);
        }
        if (typeof dob === 'string' && dob.trim().length > 0) user.dob = dob.trim();
        if (typeof gender === 'string' && (gender.trim() === 'Male' || gender.trim() === 'Female')) {
            user.gender = gender.trim();
        }
        if (typeof country === 'string' && country.trim().length > 0) user.country = country.trim();
        user.updatedAt = new Date();

        await user.save();
        return res.json({ success: true, user });
    } catch (e) {
        console.error('[Users Route] Update profile error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

// 5b. POST /upload-avatar or POST /user/upload-avatar - Server-side single-hop Cloudinary avatar upload
async function handleUploadAvatar(req, res) {
    try {
        const cleanUid = String(req.callerUid || '').trim();
        if (!cleanUid) return res.status(401).json({ success: false, error: 'Missing verified UID' });

        const uploadedFile = req.file
            || req.files?.avatar?.[0]
            || req.files?.file?.[0]
            || req.files?.image?.[0];

        if (!uploadedFile || !uploadedFile.buffer || uploadedFile.buffer.length === 0) {
            return res.status(400).json({ success: false, error: 'Avatar image file is required' });
        }

        const result = await uploadBufferToCloudinary(
            uploadedFile.buffer,
            'amison/avatars',
            'image',
            {
                filename: `avatar_${cleanUid}_${Date.now()}`,
                originalname: uploadedFile.originalname || 'avatar.jpg'
            }
        );

        const secureUrl = String(result?.secure_url || result?.url || '').trim();
        if (!secureUrl) {
            return res.status(502).json({ success: false, error: 'Cloudinary did not return a valid URL' });
        }

        console.log(`✅ [Users Route] Uploaded avatar for ${cleanUid} (${uploadedFile.buffer.length} bytes) -> ${secureUrl}`);
        return res.json({
            success: true,
            avatarUrl: secureUrl,
            secureUrl
        });
    } catch (e) {
        console.error('❌ [Users Route] Upload avatar error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Avatar upload failed' });
    }
}

router.post('/upload-avatar', verifyAuthenticatedUser, avatarUploadMiddleware, handleUploadAvatar);
router.post('/user/upload-avatar', verifyAuthenticatedUser, avatarUploadMiddleware, handleUploadAvatar);

router.post('/update-profile', verifyAuthenticatedUser, handleUpdateProfile);
router.post('/user/update-profile', verifyAuthenticatedUser, handleUpdateProfile);

// 6. Parameterized UID lookup (mounted at bottom after specific static routes)
router.get('/user/:uid', verifyStrictFirebaseToken, handleGetUser);
router.get('/:uid', verifyStrictFirebaseToken, handleGetUser);

module.exports = router;
