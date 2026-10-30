require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');

// Initialize Express App & HTTP Server
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Configuration & MongoDB Atlas Connection
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || "mongodb+srv://diablo:Diablo2234@amison.bgzqeqm.mongodb.net/amison_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 [MongoDB Atlas] Connected successfully'))
    .catch(err => console.error('❌ [MongoDB Atlas] Connection Error:', err));

// ============================================================================
// MOUNT REST API ROUTERS
// ============================================================================

// 1. Users REST API (/api/users, /api/user)
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);
app.use('/api', usersRoutes); // Backwards compatibility for /api/user/*

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

// 6. Admin Panel Router (/api/newop)
try {
    const newopRoutes = require('./routes/newop');
    app.use('/api/newop', newopRoutes.router || newopRoutes);
    console.log('🛡️ [Server] Loaded Newop Admin Router');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
        console.error('⚠️ [Server] Error loading newop:', e.message);
    }
}

// Health Check Endpoints
app.get('/', (req, res) => {
    res.send('Amison Gateway Server is running!');
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Amison Modular Backend Gateway',
        mongoReady: mongoose.connection.readyState === 1,
        routes: {
            users: true,
            rooms: true,
            messages: true,
            wallet: true,
            friends: true
        },
        sockets: {
            roomSocket: '/ws/rooms',
            chatSocket: '/ws/chat'
        }
    });
});

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
server.listen(PORT, () => {
    console.log(`🚀 [Gateway] Amison Server running on port ${PORT}`);
});