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
    .then(() => console.log('MongoDB Atlas Connected successfully'))
    .catch(err => console.error('MongoDB Atlas Connection Error:', err));

// Tracking loaded modules
let usersLoaded = false;
let walletLoaded = false;
let newopLoaded = false;
let messageLoaded = false;
let roomLoaded = false;

// Root Health Check endpoint
app.get('/', (req, res) => {
    res.send('Amison Backend is running!');
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Amison Backend Gateway',
        mongoReady: mongoose.connection.readyState === 1,
        usersLoaded,
        walletLoaded,
        newopLoaded,
        messageLoaded,
        roomLoaded
    });
});

// ============================================================================
// MOUNT DEDICATED ROUTERS (Pure REST APIs)
// ============================================================================

// 1. User Profile Router (/api/user/:uid, /api/users/search, /api/user/create, /api/user/update-profile)
try {
    const usersRoutes = require('./users');
    app.use('/api', usersRoutes.router || usersRoutes);
    usersLoaded = true;
    console.log('[Server] Loaded Users Profile Router from ./users');
} catch (e) {
    console.error('[Server] Error loading Users Router:', e.message);
}

// 2. Friends / Social Router (/api/follow, /api/unfollow, /api/followers, /api/following)
try {
    const friendRoutes = require('./friends');
    app.use('/api', friendRoutes.router || friendRoutes);
    console.log('[Server] Loaded Friends Router from ./friends');
} catch (e) {
    console.error('[Server] Error loading Friends Router:', e.message);
}

// 3. Wallet & Gifting Engine Router (/api/wallet/balance, /api/wallet/send-gift, etc.)
for (const candidate of ['./wallet', './wallets']) {
    try {
        const mod = require(candidate);
        const walletRoutes = mod.router || mod;
        app.use('/api', walletRoutes);
        walletLoaded = true;
        console.log(`[Server] Loaded Wallet Engine from ${candidate}`);
        break;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.error(`[Server] Error loading ${candidate}:`, e.message);
        }
    }
}

// 4. Newop Master Admin Router (/api/newop/...)
for (const candidate of ['./newop', './Newop']) {
    try {
        const newopRoutes = require(candidate);
        app.use('/api/newop', newopRoutes.router || newopRoutes);
        newopLoaded = true;
        console.log(`[Server] Loaded Newop Admin Router from ${candidate}`);
        break;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.error(`[Server] Error loading ${candidate}:`, e.message);
        }
    }
}

// 5. Direct Message Router (/api/messages/...)
for (const candidate of ['./message', './messages']) {
    try {
        const messageRoutes = require(candidate);
        app.use('/api/messages', messageRoutes.router || messageRoutes);
        messageLoaded = true;
        console.log(`[Server] Loaded Message Router from ${candidate}`);
        break;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.error(`[Server] Error loading ${candidate}:`, e.message);
        }
    }
}

// 6. Voice / Party Room Router (/api/rooms/...)
for (const candidate of ['./room', './rooms']) {
    try {
        const roomRoutes = require(candidate);
        app.use('/api/rooms', roomRoutes.router || roomRoutes);
        roomLoaded = true;
        console.log(`[Server] Loaded Room Router from ${candidate}`);
        break;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.error(`[Server] Error loading ${candidate}:`, e.message);
        }
    }
}

// ============================================================================
// MOUNT DEDICATED WEBSOCKETS (Pure Real-Time Servers)
// ============================================================================

// 1. Personal 1-to-1 Direct Message WebSocket (/ws/chat)
for (const candidate of ['./chatSocket', './chatsocket']) {
    try {
        const setupChatSocket = require(candidate);
        setupChatSocket(server);
        console.log(`[Server] Loaded Chat WebSocket from ${candidate}`);
        break;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.error(`[Server] Error loading ${candidate}:`, e.message);
        }
    }
}

// 2. Voice Party / Room Stage WebSocket (/ws/rooms)
for (const candidate of ['./textroom', './TextRoom']) {
    try {
        const setupTextRoom = require(candidate);
        setupTextRoom(server);
        console.log(`[Server] Loaded TextRoom Engine from ${candidate}`);
        break;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.error(`[Server] Error loading ${candidate}:`, e.message);
        }
    }
}

// Start Server
server.listen(PORT, () => {
    console.log(`Amison Gateway Server running on port ${PORT}`);
});
