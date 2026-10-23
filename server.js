const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Environment variables or defaults
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://diablo:Diablo2234@amison.bgzqeqm.mongodb.net/amison_db?retryWrites=true&w=majority";
const REDIS_URL = process.env.REDIS_URL || "redis://default:gQAAAAAAA56XAAIgcDI0MWNhYzRkZTc4NDU0Yjg5OWFjMDhiNGMyMGZhNzMyNA@vital-rooster-237207.upstash.io:6379";

// Connect MongoDB Atlas
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected successfully to Amison DB'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Connect Redis (Upstash / Local)
const redis = new Redis(REDIS_URL, {
    tls: { rejectUnauthorized: false },
    maxRetriesPerRequest: 3
});

redis.on('connect', () => console.log('Redis connected successfully to In-Memory Engine'));
redis.on('error', (err) => console.error('Redis Connection Error:', err));

// Mongoose Schemas for Users & Wallets & Transactions
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    displayName: String,
    numericId: Number,
    coins: { type: Number, default: 1000 },
    diamonds: { type: Number, default: 0 },
    avatarUrl: String,
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    roomId: String,
    giftId: String,
    giftName: String,
    giftCost: { type: Number, required: true },
    receiverDiamonds: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// ============================================================================
// ATOMIC REDIS LUA SCRIPT (FROM ARCHITECTURE GUIDE PAGE 2)
// Prevents Double-Spend, Race Conditions, and Negative Balances (0ms Latency)
// ============================================================================
const LUA_GIFT_SCRIPT = `
  local current_coins = tonumber(redis.call('get', KEYS[1]) or "0")
  local cost = tonumber(ARGV[1])
  if current_coins >= cost then
    redis.call('decrby', KEYS[1], cost)
    redis.call('incrby', KEYS[2], cost)
    return 1
  else
    return 0
  end
`;

/**
 * Helper to ensure user keys are initialized in Redis from MongoDB if not cached
 */
async function ensureUserWalletInRedis(uid, initialCoins = 0, initialDiamonds = 0) {
    const senderKey = `user:${uid}:coins`;
    const receiverKey = `user:${uid}:diamonds`;
    
    const [cachedCoins, cachedDiamonds] = await Promise.all([
        redis.get(senderKey),
        redis.get(receiverKey)
    ]);

    if (cachedCoins === null || cachedDiamonds === null) {
        let user = await User.findOne({ uid });
        if (!user) {
            user = new User({
                uid,
                coins: initialCoins || 1000,
                diamonds: initialDiamonds || 0
            });
            await user.save();
        }
        const coins = cachedCoins !== null ? Number(cachedCoins) : user.coins;
        const diamonds = cachedDiamonds !== null ? Number(cachedDiamonds) : user.diamonds;
        await Promise.all([
            redis.set(senderKey, coins),
            redis.set(receiverKey, diamonds)
        ]);
        return { coins, diamonds };
    }

    return { coins: Number(cachedCoins), diamonds: Number(cachedDiamonds) };
}

/**
 * Core Atomic Gifting Function as Specified in PDF Architecture Guide
 */
async function sendGiftCore(senderId, receiverId, giftId, giftCost, roomId, giftName = "") {
    const senderKey = `user:${senderId}:coins`;
    const receiverKey = `user:${receiverId}:diamonds`;

    // Ensure both sender and receiver exist in Redis
    await Promise.all([
        ensureUserWalletInRedis(senderId),
        ensureUserWalletInRedis(receiverId)
    ]);

    // Execute Atomic Redis Transaction via Lua script
    const result = await redis.eval(LUA_GIFT_SCRIPT, 2, senderKey, receiverKey, giftCost);

    if (result === 0) {
        return { success: false, message: "Insufficient coins! (-326772 preventer: balance strictly protected)" };
    }

    const [remainingCoins, newDiamonds] = await Promise.all([
        redis.get(senderKey),
        redis.get(receiverKey)
    ]);

    // Instant Broadcast via Socket.IO for Room Animations across all listeners
    if (roomId) {
        io.to(roomId).emit("GIFT_RECEIVED", {
            senderId,
            receiverId,
            giftId,
            giftName,
            cost: giftCost,
            timestamp: Date.now()
        });

        io.to(roomId).emit("gift_sent", {
            fromUid: senderId,
            toUid: receiverId,
            giftId,
            giftName,
            costCoins: giftCost,
            timestamp: Date.now()
        });
    }

    // Async MongoDB Logging in Background (Non-blocking)
    const txId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    Transaction.create({
        transactionId: txId,
        senderId,
        receiverId,
        roomId: roomId || "",
        giftId: giftId || "gift_custom",
        giftName: giftName || giftId,
        giftCost,
        receiverDiamonds: giftCost,
        timestamp: new Date()
    }).catch(err => console.error("Async MongoDB Log Error:", err));

    return {
        success: true,
        message: "Gift sent successfully!",
        remainingCoins: Number(remainingCoins),
        receiverDiamonds: Number(newDiamonds),
        transactionId: txId
    };
}

// ============================================================================
// REST API ENDPOINTS
// ============================================================================

app.get('/', (req, res) => {
    res.json({
        status: 'Amison High-Speed Transaction Engine is Running',
        version: '2.0.0',
        techStack: 'Node.js + Redis Lua + MongoDB + Socket.IO',
        timestamp: new Date()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', redis: redis.status, mongo: mongoose.connection.readyState });
});

// Sync User Profile and Wallet between Firebase/Android & Redis/Mongo
app.post('/api/user/sync', async (req, res) => {
    try {
        const { uid, displayName, numericId, avatarUrl, coins, diamonds } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing UID' });

        let user = await User.findOne({ uid });
        if (!user) {
            user = new User({
                uid,
                displayName: displayName || "Amison User",
                numericId: numericId || Math.floor(100000000 + Math.random() * 900000000),
                avatarUrl: avatarUrl || "",
                coins: coins !== undefined ? coins : 1000,
                diamonds: diamonds !== undefined ? diamonds : 0
            });
            await user.save();
        } else if (coins !== undefined || diamonds !== undefined) {
            if (coins !== undefined && coins > user.coins) user.coins = coins;
            if (diamonds !== undefined && diamonds > user.diamonds) user.diamonds = diamonds;
            user.updatedAt = new Date();
            await user.save();
        }

        // Cache in Redis for instant 0ms access
        await Promise.all([
            redis.set(`user:${uid}:coins`, user.coins),
            redis.set(`user:${uid}:diamonds`, user.diamonds)
        ]);

        res.json({ success: true, user: { uid: user.uid, coins: user.coins, diamonds: user.diamonds } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fetch Live Wallet Balance directly from Redis (0ms Latency)
app.get('/api/wallet/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const wallet = await ensureUserWalletInRedis(uid);
        res.json({ success: true, uid, coins: wallet.coins, diamonds: wallet.diamonds });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// High-Speed REST API for Gifting (Http Option for Android Client)
app.post('/api/gift/send', async (req, res) => {
    try {
        const { senderId, receiverId, giftId, giftCost, roomId, giftName } = req.body;
        if (!senderId || !receiverId || !giftCost || giftCost <= 0) {
            return res.status(400).json({ success: false, message: "Invalid parameters" });
        }

        const result = await sendGiftCore(senderId, receiverId, giftId, giftCost, roomId, giftName);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: "Server Transaction Error", error: e.message });
    }
});

// ============================================================================
// SOCKET.IO REAL-TIME EVENTS
// ============================================================================

io.on('connection', (socket) => {
    // Room Join & Leave
    socket.on('join_room', ({ roomId, uid }) => {
        if (!roomId) return;
        socket.join(roomId);
        io.to(roomId).emit('user_joined', { uid, socketId: socket.id, timestamp: Date.now() });
    });

    socket.on('leave_room', ({ roomId, uid }) => {
        if (!roomId) return;
        socket.leave(roomId);
        io.to(roomId).emit('user_left', { uid, timestamp: Date.now() });
    });

    // Mic Seat Lock / Claim (Atomic Redis Lock)
    socket.on('claim_seat', async ({ roomId, seatIndex, uid }, callback) => {
        const lockKey = `room:${roomId}:seat:${seatIndex}`;
        try {
            const acquired = await redis.set(lockKey, uid, 'NX', 'EX', 7200);
            if (acquired === 'OK') {
                if (callback) callback({ success: true, message: 'Seat locked successfully' });
                io.to(roomId).emit('seat_updated', { seatIndex, uid, status: 'locked' });
            } else {
                const currentHolder = await redis.get(lockKey);
                if (callback) callback({ success: false, message: 'Seat already occupied', holder: currentHolder });
            }
        } catch (e) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    // Mic Seat Release
    socket.on('release_seat', async ({ roomId, seatIndex, uid }) => {
        const lockKey = `room:${roomId}:seat:${seatIndex}`;
        const holder = await redis.get(lockKey);
        if (holder === uid) {
            await redis.del(lockKey);
            io.to(roomId).emit('seat_updated', { seatIndex, uid: null, status: 'empty' });
        }
    });

    // Real-time Gifting through Socket.IO (Direct from PDF)
    socket.on('send_gift', async ({ senderId, receiverId, giftId, giftCost, roomId, giftName }, callback) => {
        try {
            const result = await sendGiftCore(senderId, receiverId, giftId, giftCost, roomId, giftName);
            if (callback) callback(result);
        } catch (e) {
            if (callback) callback({ success: false, message: "Server Transaction Error", error: e.message });
        }
    });

    socket.on('disconnect', () => {
        // Handled cleanly
    });
});

// ============================================================================
// PERIODIC QUEUE BACKUP (Redis In-Memory -> MongoDB Persistent Storage)
// Runs every 60 seconds to sync cached balances safely into MongoDB
// ============================================================================
setInterval(async () => {
    try {
        const keys = await redis.keys('user:*:coins');
        if (!keys || keys.length === 0) return;

        for (const key of keys) {
            const match = key.match(/^user:(.+):coins$/);
            if (match && match[1]) {
                const uid = match[1];
                const coinsStr = await redis.get(key);
                const diamondsStr = await redis.get(`user:${uid}:diamonds`);
                const coins = Number(coinsStr || 0);
                const diamonds = Number(diamondsStr || 0);

                await User.updateOne(
                    { uid },
                    { $set: { coins, diamonds, updatedAt: new Date() } },
                    { upsert: true }
                );
            }
        }
    } catch (err) {
        console.error("Periodic Redis to MongoDB sync error:", err.message);
    }
}, 60000);

server.listen(PORT, () => {
    console.log(`Amison Production Backend Engine running on port ${PORT}`);
});
