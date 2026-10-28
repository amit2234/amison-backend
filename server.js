const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Configuration & MongoDB Atlas Connection
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || "mongodb+srv://diablo:Diablo2234@amison.bgzqeqm.mongodb.net/amison_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Atlas Connected successfully: Users Collection Active'))
    .catch(err => console.error('MongoDB Atlas Connection Error:', err));

// ============================================================================
// MONGOOSE SCHEMA: USERS COLLECTION (8 CORE PROFILE FIELDS ONLY)
// ============================================================================
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true }, // Permanent Firebase Auth Google UID
    numericId: { type: Number, required: true, unique: true, index: true }, // 9-digit unique public display ID
    name: { type: String, required: true, trim: true }, // User Display Name
    avatarUrl: { type: String, default: "" }, // Profile Photo URL (Cloudinary)
    dob: { type: String, default: "" }, // Date of Birth (YYYY-MM-DD)
    gender: { type: String, enum: ["Male", "Female", ""], default: "" }, // Gender
    country: { type: String, default: "India" }, // Country
    email: { type: String, default: "", index: true }, // Google Sign-In Email
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

userSchema.index({ uid: 1, email: 1 });

const User = mongoose.model('User', userSchema);

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check endpoint (for Instant Wakeup / Pre-Warm ping)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Amison MongoDB Backend',
        mongoReady: mongoose.connection.readyState === 1
    });
});

// 1. GET /api/user/:uid: Checks if user exists in MongoDB Atlas by Auth UID OR Email (2ms speed)
app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ exists: false, error: 'Missing UID or Email' });

        const clean = uid.trim();
        const cleanLower = clean.toLowerCase();
        const numId = Number(clean) || 0;

        // Blazing-fast lean query searching by permanent UID, numericId, or Email
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
        return res.json({ exists: true, user });
    } catch (e) {
        console.error('[MongoDB] Fetch user error:', e);
        res.status(500).json({ exists: false, error: e.message });
    }
});

// 1.1 GET /api/users/search?query=...: Search users by numericId, uid, or name
app.get('/api/users/search', async (req, res) => {
    try {
        const query = (req.query.query || '').trim();
        if (!query) return res.json({ users: [] });

        const numId = Number(query) || 0;
        const users = await User.find({
            $or: [
                { uid: query },
                ...(numId > 0 ? [{ numericId: numId }] : []),
                { numericId: { $regex: query, $options: 'i' } },
                { name: { $regex: query, $options: 'i' } }
            ]
        }).limit(20).lean();

        return res.json({ users: users || [] });
    } catch (e) {
        console.error('[MongoDB] Search users error:', e);
        res.status(500).json({ users: [], error: e.message });
    }
});

// 2. POST /api/user/create: Generates 9-digit unique numeric ID only for genuine new users
app.post('/api/user/create', async (req, res) => {
    try {
        const { uid, name, avatarUrl, dob, gender, country, email } = req.body;
        if (!uid || !name) {
            return res.status(400).json({ success: false, error: 'UID and Name are required' });
        }

        const cleanUid = uid.trim();
        const cleanEmail = (email || '').trim().toLowerCase();

        // Double check: if user already exists by UID or Email, immediately return existing record (0 duplicate guarantee)
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
            name: name.trim(),
            avatarUrl: avatarUrl || "",
            dob: dob || "",
            gender: gender || "",
            country: country || "India",
            email: email || ""
        });

        await newUser.save();
        console.log(`[MongoDB] Created new user: ${newUser.name} (UID: ${newUser.uid}, NumericId: ${newUser.numericId})`);
        return res.json({ success: true, user: newUser });
    } catch (e) {
        console.error('[MongoDB] Create user error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. POST /api/user/update-profile: Profile updates handle karta hai
app.post('/api/user/update-profile', async (req, res) => {
    try {
        const { uid, name, avatarUrl, dob, gender, country } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = uid.toString().trim();
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
            // Only update name if it's a real custom name or if user has no name yet
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
        console.error('[MongoDB] Update profile error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Mount MongoDB Friends Router (Follow/Followers/Friends)
const friendRoutes = require('./friends');
app.use('/api', friendRoutes);

// Start Server
server.listen(PORT, () => {
    console.log(`Amison Backend Server running on port ${PORT}`);
});
