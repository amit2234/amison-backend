const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cors = require('cors');
const crypto = require('crypto');

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
const ZEGO_APP_ID = process.env.ZEGO_APP_ID ? Number(process.env.ZEGO_APP_ID) : 123456789;
const ZEGO_SERVER_SECRET = process.env.ZEGO_SERVER_SECRET || "0123456789abcdef0123456789abcdef";

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

// ============================================================================
// MONGOOSE SCHEMAS (PERMANENT FINANCIAL & USER LEDGER)
// ============================================================================

const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    displayName: String,
    numericId: Number,
    coins: { type: Number, default: 1000 },
    diamonds: { type: Number, default: 0 },
    totalCoinsSent: { type: Number, default: 0 },
    totalDiamondsEarned: { type: Number, default: 0 },
    avatarUrl: String,
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    senderId: { type: String, required: true },
    senderName: String,
    senderNumericId: Number,
    receiverId: String,
    recipientIds: [String],
    recipientCount: { type: Number, default: 1 },
    roomId: String,
    giftId: String,
    giftName: String,
    giftCost: { type: Number, required: true },
    costPerRecipient: { type: Number, default: 0 },
    diamondsPerRecipient: { type: Number, default: 0 },
    receiverDiamonds: { type: Number, default: 0 },
    isMulti: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

const rechargeSchema = new mongoose.Schema({
    rechargeId: { type: String, required: true, unique: true },
    uid: { type: String, required: true },
    numericId: Number,
    coinsAdded: { type: Number, required: true },
    amountInr: { type: Number, required: true },
    paymentMethod: { type: String, default: "UPI" },
    paymentRef: String,
    status: { type: String, default: "SUCCESS" },
    createdAt: { type: Date, default: Date.now }
});
const Recharge = mongoose.model('Recharge', rechargeSchema);

const withdrawSchema = new mongoose.Schema({
    withdrawId: { type: String, required: true, unique: true },
    uid: { type: String, required: true },
    numericId: Number,
    diamondsDeducted: { type: Number, required: true },
    amountInr: { type: Number, required: true },
    upiId: String,
    status: { type: String, default: "PENDING" },
    screenshotProofUrl: String,
    createdAt: { type: Date, default: Date.now }
});
const WithdrawRecord = mongoose.model('WithdrawRecord', withdrawSchema);

// ============================================================================
// ATOMIC REDIS LUA SCRIPTS (0ms CONCURRENCY)
// ============================================================================

const LUA_SINGLE_GIFT_SCRIPT = `
  local current_coins = tonumber(redis.call('get', KEYS[1]) or "0")
  local cost = tonumber(ARGV[1])
  if current_coins >= cost then
    redis.call('decrby', KEYS[1], cost)
    redis.call('incrby', KEYS[2], cost)
    redis.call('incrby', KEYS[3], cost)
    return 1
  else
    return 0
  end
`;

const LUA_MULTI_GIFT_SCRIPT = `
  local current_coins = tonumber(redis.call('get', KEYS[1]) or "0")
  local total_cost = tonumber(ARGV[1])
  local reward = tonumber(ARGV[2])
  local count = tonumber(ARGV[3])

  if current_coins < total_cost then
    return 0
  end

  redis.call('decrby', KEYS[1], total_cost)
  redis.call('incrby', KEYS[2], total_cost)

  for i = 1, count do
    local recipient_key = KEYS[i + 2]
    redis.call('incrby', recipient_key, reward)
  end

  return 1
`;

async function ensureUserWalletInRedis(uid, initialCoins = 0, initialDiamonds = 0) {
    const senderKey = `user:${uid}:coins`;
    const receiverKey = `user:${uid}:diamonds`;
    const sentKey = `user:${uid}:total_sent`;
    
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
            redis.set(receiverKey, diamonds),
            redis.setnx(sentKey, user.totalCoinsSent || 0)
        ]);
        return { coins, diamonds };
    }

    return { coins: Number(cachedCoins), diamonds: Number(cachedDiamonds) };
}

async function sendGiftCore(senderId, receiverId, giftId, giftCost, roomId, giftName = "") {
    const senderKey = `user:${senderId}:coins`;
    const sentKey = `user:${senderId}:total_sent`;
    const receiverKey = `user:${receiverId}:diamonds`;

    await Promise.all([
        ensureUserWalletInRedis(senderId),
        ensureUserWalletInRedis(receiverId)
    ]);

    const result = await redis.eval(LUA_SINGLE_GIFT_SCRIPT, 3, senderKey, sentKey, receiverKey, giftCost);

    if (result === 0) {
        return { success: false, message: "Insufficient coins! Balance strictly protected." };
    }

    const [remainingCoins, newDiamonds] = await Promise.all([
        redis.get(senderKey),
        redis.get(receiverKey)
    ]);

    const today = new Date().toISOString().slice(0, 10);
    redis.zincrby(`leaderboard:daily:rich:${today}`, giftCost, senderId).catch(() => {});
    redis.zincrby(`leaderboard:daily:charm:${today}`, giftCost, receiverId).catch(() => {});

    if (roomId) {
        io.to(roomId).emit("GIFT_RECEIVED", {
            senderId,
            receiverId,
            giftId,
            giftName,
            cost: giftCost,
            timestamp: Date.now()
        });
    }

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

async function sendMultiGiftCore(senderId, recipientIds, giftId, totalCost, costPerRecipient, diamondsPerRecipient, roomId, giftName = "") {
    if (!recipientIds || recipientIds.length === 0) {
        return { success: false, message: "No recipients selected" };
    }

    const cleanRecipients = recipientIds.filter(id => id && id.trim().length > 0);
    const count = cleanRecipients.length;
    const finalTotalCost = totalCost || (costPerRecipient * count);
    const finalDiamonds = diamondsPerRecipient || costPerRecipient;

    await Promise.all([
        ensureUserWalletInRedis(senderId),
        ...cleanRecipients.map(id => ensureUserWalletInRedis(id))
    ]);

    const senderKey = `user:${senderId}:coins`;
    const sentKey = `user:${senderId}:total_sent`;
    const recipientKeys = cleanRecipients.map(id => `user:${id}:diamonds`);
    const allKeys = [senderKey, sentKey, ...recipientKeys];

    const result = await redis.eval(
        LUA_MULTI_GIFT_SCRIPT,
        allKeys.length,
        ...allKeys,
        finalTotalCost,
        finalDiamonds,
        count
    );

    if (result === 0) {
        return { success: false, message: "Insufficient coins for multi-gift!" };
    }

    const remainingCoins = await redis.get(senderKey);

    if (roomId) {
        io.to(roomId).emit("GIFT_RECEIVED", {
            senderId,
            recipientIds: cleanRecipients,
            giftId,
            giftName,
            totalCost: finalTotalCost,
            isMulti: true,
            timestamp: Date.now()
        });
    }

    const txId = `TXN_MULTI_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    Transaction.create({
        transactionId: txId,
        senderId,
        recipientIds: cleanRecipients,
        recipientCount: count,
        roomId: roomId || "",
        giftId: giftId || "gift_multi",
        giftName: giftName || giftId,
        giftCost: finalTotalCost,
        isMulti: true,
        timestamp: new Date()
    }).catch(err => console.error("Async MongoDB Multi Log Error:", err));

    return {
        success: true,
        message: "Multi-gift sent successfully!",
        remainingCoins: Number(remainingCoins),
        recipientCount: count,
        transactionId: txId
    };
}

// ============================================================================
// REST API ENDPOINTS
// ============================================================================

app.get('/', (req, res) => {
    res.json({
        status: 'Amison High-Speed Transaction Engine is Running',
        version: '2.1.0',
        timestamp: new Date()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', redis: redis.status, mongo: mongoose.connection.readyState });
});

// Sync User Profile
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
        }

        await Promise.all([
            redis.set(`user:${uid}:coins`, user.coins),
            redis.set(`user:${uid}:diamonds`, user.diamonds)
        ]);

        res.json({ success: true, user: { uid: user.uid, coins: user.coins, diamonds: user.diamonds } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Live Balance
app.get('/api/wallet/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const wallet = await ensureUserWalletInRedis(uid);
        res.json({ success: true, uid, coins: wallet.coins, diamonds: wallet.diamonds });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Send Gift
app.post('/api/gift/send', async (req, res) => {
    try {
        const { senderId, receiverId, giftId, giftCost, roomId, giftName } = req.body;
        const result = await sendGiftCore(senderId, receiverId, giftId, giftCost, roomId, giftName);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Multi Gift
app.post('/api/gift/send-multi', async (req, res) => {
    try {
        const { senderId, recipientIds, giftId, totalCost, costPerRecipient, diamondsPerRecipient, roomId, giftName } = req.body;
        const result = await sendMultiGiftCore(senderId, recipientIds, giftId, totalCost, costPerRecipient, diamondsPerRecipient, roomId, giftName);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Zego Token Generator
app.post('/api/zego/token', (req, res) => {
    try {
        const { roomId, userId } = req.body;
        if (!roomId || !userId) {
            return res.status(400).json({ success: false, message: "Missing roomId or userId" });
        }
        const effectiveTimeInSeconds = 7200;
        const createTime = Math.floor(Date.now() / 1000);
        const expireTime = createTime + effectiveTimeInSeconds;
        const nonce = crypto.randomInt(100000, 999999);

        const payloadObj = {
            app_id: ZEGO_APP_ID,
            user_id: String(userId),
            room_id: String(roomId),
            privilege: { 1: 1, 2: 1 },
            create_time: createTime,
            expire_time: expireTime,
            nonce: nonce
        };

        const payloadStr = JSON.stringify(payloadObj);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(ZEGO_SERVER_SECRET.substring(0, 16), 'utf8'), iv);
        let encrypted = cipher.update(payloadStr, 'utf8', 'binary');
        encrypted += cipher.final('binary');

        const tokenPayload = {
            ver: 1,
            hash: crypto.createHmac('sha256', ZEGO_SERVER_SECRET).update(payloadStr).digest('hex'),
            data: Buffer.concat([iv, Buffer.from(encrypted, 'binary')]).toString('base64')
        };
        const token = "04" + Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

        res.json({ success: true, appId: ZEGO_APP_ID, roomId, userId, token, expireTime });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Socket.io Real-Time Room Events
io.on('connection', (socket) => {
    socket.on('join_room', ({ roomId, uid }) => {
        if (!roomId) return;
        socket.join(roomId);
    });

    socket.on('leave_room', ({ roomId, uid }) => {
        if (!roomId) return;
        socket.leave(roomId);
    });

    socket.on('send_gift', async (data, callback) => {
        try {
            const res = await sendGiftCore(data.senderId, data.receiverId, data.giftId, data.giftCost, data.roomId, data.giftName);
            if (callback) callback(res);
        } catch (e) {
            if (callback) callback({ success: false, error: e.message });
        }
    });
});

// Periodic Redis -> MongoDB backup
setInterval(async () => {
    try {
        const keys = await redis.keys('user:*:coins');
        if (!keys || keys.length === 0) return;
        for (const key of keys) {
            const match = key.match(/^user:(.+):coins$/);
            if (match && match[1]) {
                const uid = match[1];
                const coins = Number(await redis.get(key) || 0);
                const diamonds = Number(await redis.get(`user:${uid}:diamonds`) || 0);
                await User.updateOne({ uid }, { $set: { coins, diamonds, updatedAt: new Date() } }, { upsert: true });
            }
        }
    } catch (e) {}
}, 60000);

server.listen(PORT, () => {
    console.log(`Backend Server running on port ${PORT}`);
});