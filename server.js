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

// 1.25. Modular User Profile REST API (/api/profile)
const profileModule = require('./modules/profile');
app.use('/api/profile', profileModule.routes);

// 1.5. Reels & Moments REST API (/api/reels) - Modular Amison Play Engine
const reelsModule = require('./modules/reels');
app.use('/api/reels', reelsModule.routes);

// 2. Rooms REST API (/api/rooms) - Fault-Isolated Modular Real-Time Room Engine
const roomModule = require('./modules/room');
app.use('/api/rooms', roomModule.routes);

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

// 6. Store REST API (/api/store & /api/store/admin) - Modular Real-Time Store Engine
const storeModule = require('./modules/store');
app.use('/api/store', storeModule.publicRoutes);
app.use('/api/store/admin', storeModule.adminRoutes);

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

// 8. Dynamic Gifts API for Voice Rooms (/api/gifts/active, /api/gifts/categories, /api/gifts/admin)
const giftModule = require('./modules/gift');
app.use('/api/gifts', giftModule.publicRoutes);
app.use('/api/gifts/admin', giftModule.adminRoutes);

// 9. Emojis REST API (/api/emojis)
const emojisRoutes = require('./routes/emojis');
app.use('/api/emojis', emojisRoutes);

// 10. Merchant & Coin Seller REST API (/api/merchant)
const merchantRoutes = require('./routes/merchant');
app.use('/api/merchant', merchantRoutes);

// 11. Dynamic Banners REST API (/api/banners)
const bannersRoutes = require('./routes/banners');
app.use('/api/banners', bannersRoutes);

// 12. Dynamic Levels REST API (/api/levels)
const levelsRoutes = require('./routes/levels');
app.use('/api/levels', levelsRoutes);

// 13. Withdraw REST API (/api/wallet/withdraw, /api/withdraw)
const withdrawRoutes = require('./routes/withdraw');
app.use('/api/wallet/withdraw', withdrawRoutes);
app.use('/api/withdraw', withdrawRoutes);

// 14. Agency REST API (/api/agencies)
const agencyRoutes = require('./routes/agency');
app.use('/api/agencies', agencyRoutes);

// 15. Games REST API (/api/newop/games & /api/games)
const gamesRoutes = require('./routes/games');
app.use('/api/newop/games', gamesRoutes);
app.use('/api/games', gamesRoutes);
const path = require('path');
app.use('/games', express.static(path.join(__dirname, 'games')));
app.use('/games', express.static(path.join(__dirname, 'public/games')));

// 16. Couple Partner REST API (/api/couple)
const coupleRoutes = require('./routes/couple');
app.use('/api/couple', coupleRoutes);

// 17. Daily Task & Spin Wheel REST API (/api/daily-task)
const dailyTaskRoutes = require('./routes/dailyTask');
app.use('/api/daily-task', dailyTaskRoutes);

// ============================================================================
// MOUNT WEBSOCKET SERVERS WITH DEDICATED UPGRADE ROUTER
// ============================================================================

// 1. Room Stage WebSocket (/ws/rooms) - Fault-Isolated 16-Seat Stage, Lock, Chat & Presence Gateway
const roomWss = roomModule.gateway.setupRoomSocket(server);

// 2. Personal Chat WebSocket (/ws/chat) - 1-to-1 DM, online presence
const setupChatSocket = require('./sockets/chatSocket');
const chatWss = setupChatSocket(server);

// 3. 24/7 Authoritative Game Engine WebSocket (/ws/games, /ws/games/galaxy_star)
const setupGameSocket = require('./sockets/gameSocket');
const gameWss = setupGameSocket(server);

// 4. Dedicated Real-Time Store Catalog & Inventory WebSocket (/ws/store)
const storeWss = storeModule.realtime.setupStoreSocket();

// Dedicated HTTP Upgrade Router (Zero 400 Bad Request collisions, Cloudflare & Render compliant)
server.on('upgrade', (request, socket, head) => {
    try {
        const { pathname } = new URL(request.url, 'http://localhost');
        if (pathname === '/ws/rooms' || pathname.startsWith('/ws/rooms/')) {
            roomWss.handleUpgrade(request, socket, head, (ws) => {
                roomWss.emit('connection', ws, request);
            });
        } else if (pathname === '/ws/chat' || pathname.startsWith('/ws/chat/')) {
            chatWss.handleUpgrade(request, socket, head, (ws) => {
                chatWss.emit('connection', ws, request);
            });
        } else if (pathname === '/ws/games' || pathname.startsWith('/ws/games/')) {
            gameWss.handleUpgrade(request, socket, head, (ws) => {
                gameWss.emit('connection', ws, request);
            });
        } else if (pathname === '/ws/store' || pathname.startsWith('/ws/store/')) {
            storeWss.handleUpgrade(request, socket, head, (ws) => {
                storeWss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    } catch (_) {
        try { socket.destroy(); } catch (e) {}
    }
});

// Start Gateway Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [Gateway] Amison Server running on port ${PORT}:${PORT}`);
});