require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');

// Initialize Express App & HTTP Server
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK for Google Auth Verification
require('./firebase');

const server = http.createServer(app);

// Configuration & MongoDB Atlas Connection
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || "mongodb+srv://diablo:Diablo2234@amison.bgzqeqm.mongodb.net/amison_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 [MongoDB Atlas] Connected successfully'))
    .catch(err => console.error('❌ [MongoDB Atlas] Connection Error:', err));

// Health Check Endpoints (High Priority 0ms Response)
app.get('/', (req, res) => {
    res.send('Amison Gateway Server is running!');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'amison-backend', time: new Date().toISOString() });
});

// ============================================================================
// MOUNT REST API ROUTERS
// ============================================================================

// 1. Users REST API (/api/users, /api/user)
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);
app.use('/api/user', usersRoutes);

// 2. Rooms REST API (/api/rooms)
const roomsRoutes = require('./routes/rooms');
app.use('/api/rooms', roomsRoutes);

// 3. Messages REST API (/api/messages)
const messagesRoutes = require('./routes/messages');
app.use('/api/messages', messagesRoutes);

// 4. Wallet REST API (/api/wallet, /api/gift)
const walletRoutes = require('./routes/wallet');
app.use('/api/wallet', walletRoutes);
app.use('/api', walletRoutes); // Backwards compatibility for /api/gift/*

// 5. Friends REST API (/api/friends, /api/user)
const friendsRoutes = require('./routes/friends');
app.use('/api/friends', friendsRoutes);
app.use('/api', friendsRoutes); // Backwards compatibility for /api/user/follow etc.

// 6. Store REST API (/api/store)
const storeRoutes = require('./routes/store');
app.use('/api/store', storeRoutes);

// 7. Admin Panel Router (/api/newop)
try {
    const newopRoutes = require('./routes/newop');
    app.use('/api/newop', newopRoutes.router || newopRoutes);
    console.log('🛡️ [Server] Loaded Newop Admin Router');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
        console.error('⚠️ [Server] Error loading newop:', e.message);
    }
}

// 8. Dynamic Gifts Public API for Voice Rooms (/api/gifts/active)
app.get('/api/gifts/active', (req, res) => {
    const NewopController = require('./controllers/newopController');
    NewopController.getActiveGifts(req, res);
});

// 9. Emojis REST API (/api/emojis)
const emojisRoutes = require('./routes/emojis');
app.use('/api/emojis', emojisRoutes);

// 10. Merchant & Coin Seller REST API (/api/merchant)
const merchantRoutes = require('./routes/merchant');
app.use('/api/merchant', merchantRoutes);

// ============================================================================
// MOUNT WEBSOCKET SERVERS
// ============================================================================

// 1. Room Stage WebSocket (/ws/rooms) - 16 seats, stage lock/unlock, room live chat
const setupRoomSocket = require('./sockets/roomSocket');
setupRoomSocket(server);

// 2. Personal Chat WebSocket (/ws/chat) - 1-to-1 DM, online presence
const setupChatSocket = require('./sockets/chatSocket');
setupChatSocket(server);

// Start Gateway Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [Gateway] Amison Server running on port ${PORT}:${PORT}`);
});