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

// ============================================================================
// MONGOOSE SCHEMAS (PERMANENT FINANCIAL & USER LEDGER)
// ============================================================================

const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true },
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
    transactionId: { type: String, required: true, unique: true, index: true },
    senderId: { type: String, required: true, index: true },
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
    timestamp: { type: Date, default: Date.now, index: true }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

const rechargeSchema = new mongoose.Schema({
    rechargeId: { type: String, required: true, unique: true, index: true },
    uid: { type: String, required: true, index: true },
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
    withdrawId: { type: String, required: true, unique: true, index: true },
    uid: { type: String, required: true, index: true },
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
// ATOMIC REDIS LUA SCRIPTS
// ============================================================================

// 1. Single-User Atomic Gifting Script
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

// 2. Super Safe Multi-User (ALL SELECT) Atomic Gifting Script
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
        return { success: false, message: "Insufficient coins! (-326772 preventer: balance strictly protected)" };
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

        io.to(roomId).emit("gift_sent", {
            fromUid: senderId,
            toUid: receiverId,
            giftId,
            giftName,
            costCoins: giftCost,
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
    const keyCount = allKeys.length;

    const result = await redis.eval(
        LUA_MULTI_GIFT_SCRIPT,
        keyCount,
        ...allKeys,
        finalTotalCost,
        finalDiamonds,
        count
    );

    if (result === 0) {
        return { success: false, message: "Insufficient coins! (-326772 preventer: multi-gift aborted)" };
    }

    const remainingCoins = await redis.get(senderKey);

    const today = new Date().toISOString().slice(0, 10);
    redis.zincrby(`leaderboard:daily:rich:${today}`, finalTotalCost, senderId).catch(() => {});
    cleanRecipients.forEach(id => {
        redis.zincrby(`leaderboard:daily:charm:${today}`, finalDiamonds, id).catch(() => {});
    });

    if (roomId) {
        io.to(roomId).emit("GIFT_RECEIVED", {
            senderId,
            recipientIds: cleanRecipients,
            giftId,
            giftName,
            totalCost: finalTotalCost,
            costPerRecipient,
            diamondsPerRecipient: finalDiamonds,
            isMulti: true,
            timestamp: Date.now()
        });

        io.to(roomId).emit("multi_gift_sent", {
            fromUid: senderId,
            toUids: cleanRecipients,
            giftId,
            giftName,
            costCoins: finalTotalCost,
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
        costPerRecipient,
        diamondsPerRecipient: finalDiamonds,
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
        techStack: 'Node.js + Multi-User Redis Lua + MongoDB + Socket.IO',
        features: ['single_gifting', 'multi_user_all_select_gifting', 'recharge_ledger', 'realtime_leaderboard'],
        timestamp: new Date()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', redis: redis.status, mongo: mongoose.connection.readyState });
});

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

        await Promise.all([
            redis.set(`user:${uid}:coins`, user.coins),
            redis.set(`user:${uid}:diamonds`, user.diamonds)
        ]);

        res.json({ success: true, user: { uid: user.uid, coins: user.coins, diamonds: user.diamonds } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/wallet/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const wallet = await ensureUserWalletInRedis(uid);
        res.json({ success: true, uid, coins: wallet.coins, diamonds: wallet.diamonds });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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

app.post('/api/gift/send-multi', async (req, res) => {
    try {
        const { senderId, recipientIds, giftId, totalCost, costPerRecipient, diamondsPerRecipient, roomId, giftName } = req.body;
        if (!senderId || !recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid multi-recipient parameters" });
        }

        const result = await sendMultiGiftCore(
            senderId,
            recipientIds,
            giftId,
            totalCost,
            costPerRecipient,
            diamondsPerRecipient,
            roomId,
            giftName
        );

        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: "Multi-Gift Error", error: e.message });
    }
});

app.get('/api/leaderboard/daily/rich', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const top = await redis.zrevrange(`leaderboard:daily:rich:${today}`, 0, 49, 'WITHSCORES');
        const results = [];
        for (let i = 0; i < top.length; i += 2) {
            results.push({ uid: top[i], score: Number(top[i + 1]), rank: (i / 2) + 1 });
        }
        res.json({ success: true, date: today, leaderboard: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/leaderboard/daily/charm', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const top = await redis.zrevrange(`leaderboard:daily:charm:${today}`, 0, 49, 'WITHSCORES');
        const results = [];
        for (let i = 0; i < top.length; i += 2) {
            results.push({ uid: top[i], score: Number(top[i + 1]), rank: (i / 2) + 1 });
        }
        res.json({ success: true, date: today, leaderboard: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/recharge/create', async (req, res) => {
    try {
        const { uid, numericId, coinsAdded, amountInr, paymentMethod, paymentRef } = req.body;
        if (!uid || !coinsAdded || coinsAdded <= 0) {
            return res.status(400).json({ success: false, message: "Invalid recharge parameters" });
        }
        await ensureUserWalletInRedis(uid);
        const newCoins = await redis.incrby(`user:${uid}:coins`, coinsAdded);
        const rchId = `RCH_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const recharge = await Recharge.create({
            rechargeId: rchId,
            uid,
            numericId: numericId || 0,
            coinsAdded,
            amountInr: amountInr || 0,
            paymentMethod: paymentMethod || "UPI",
            paymentRef: paymentRef || "",
            status: "SUCCESS"
        });
        await User.updateOne({ uid }, { $inc: { coins: coinsAdded, rechargeTotalInr: amountInr || 0 } }, { upsert: true });
        res.json({ success: true, rechargeId: rchId, remainingCoins: Number(newCoins), recharge });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/withdraw/create', async (req, res) => {
    try {
        const { uid, numericId, diamondsDeducted, amountInr, upiId, screenshotProofUrl } = req.body;
        if (!uid || !diamondsDeducted || diamondsDeducted <= 0) {
            return res.status(400).json({ success: false, message: "Invalid withdraw parameters" });
        }
        await ensureUserWalletInRedis(uid);
        const currentDiamonds = Number(await redis.get(`user:${uid}:diamonds`) || 0);
        if (currentDiamonds < diamondsDeducted) {
            return res.status(400).json({ success: false, message: "Insufficient diamonds balance" });
        }
        const newDiamonds = await redis.decrby(`user:${uid}:diamonds`, diamondsDeducted);
        const wdrId = `WDR_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const withdraw = await WithdrawRecord.create({
            withdrawId: wdrId,
            uid,
            numericId: numericId || 0,
            diamondsDeducted,
            amountInr: amountInr || 0,
            upiId: upiId || "",
            status: "PENDING",
            screenshotProofUrl: screenshotProofUrl || ""
        });
        res.json({ success: true, withdrawId: wdrId, remainingDiamonds: Number(newDiamonds), withdraw });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// SOCKET.IO REAL-TIME EVENTS
// ============================================================================

io.on('connection', (socket) => {
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

    socket.on('claim_seat', async ({ roomId, seatIndex, uid }, callback) => {
        const lockKey = `room:${roomId}:seat:${seatIndex}`;
        try {
            const acquired = await redis.set(lockKey, uid, 'NX', 'EX', 7200);
            if (acquired === 'OK') {
                if (callback) callback({ success: true, message: 'Seat locked succes