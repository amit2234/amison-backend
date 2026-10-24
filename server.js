const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// ============================================================================
// DATABASE CONNECTIONS
// ============================================================================
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/amison_voice";
mongoose.connect(MONGO_URI)
    .then(() => console.log('[MongoDB] Connected successfully'))
    .catch(err => console.error('[MongoDB] Connection error:', err));

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true
});
redis.on('connect', () => console.log('[Redis] Connected for atomic transactions'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

// ============================================================================
// MONGODB SCHEMAS & MODELS
// ============================================================================
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true },
    numericId: { type: Number, unique: true, index: true },
    nickname: { type: String, default: "User" },
    avatarUrl: { type: String, default: "" },
    coins: { type: Number, default: 0 },
    diamonds: { type: Number, default: 0 },
    rechargeTotalInr: { type: Number, default: 0 },
    svipLevel: { type: Number, default: 0 },
    activeFrameUrl: { type: String, default: "" },
    activeEntryEffectUrl: { type: String, default: "" },
    badges: [{ type: String }],
    isBanned: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true, index: true },
    senderUid: { type: String, required: true, index: true },
    receiverUid: { type: String, required: true, index: true },
    roomId: { type: String, index: true },
    giftId: String,
    giftName: String,
    coinAmount: { type: Number, required: true },
    diamondAmount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

const rechargeSchema = new mongoose.Schema({
    rechargeId: { type: String, required: true, unique: true },
    uid: { type: String, required: true, index: true },
    amountInr: Number,
    coinsAdded: Number,
    paymentGateway: String,
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
// ATOMIC REDIS LUA SCRIPTS
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

// Helper: Ensure user wallet is in Redis cache
async function ensureUserWalletInRedis(uid) {
    const coinKey = `user:${uid}:coins`;
    const diamondKey = `user:${uid}:diamonds`;
    const exists = await redis.exists(coinKey);
    if (!exists) {
        let user = await User.findOne({ uid });
        if (!user) {
            user = await User.create({ uid, coins: 0, diamonds: 0 });
        }
        await redis.set(coinKey, user.coins || 0);
        await redis.set(diamondKey, user.diamonds || 0);
    }
}

// ============================================================================
// ZEGO CLOUD DYNAMIC CREDENTIALS (LOADED DIRECTLY FROM FIRESTORE)
// Reads from Firestore collection 'system_zego', document 'zego_credentials'
// ============================================================================
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "ammu-689be";

let activeZegoConfig = {
    appId: 390326397,
    appSign: "30c6d4adf34feef17b1c34882f89398da8851cb3c3ce01cd3abe69d431ebebea",
    serverSecret: "30c6d4adf34feef17b1c34882f89398da8851cb3c3ce01cd3abe69d431ebebea",
    chatAppId: 1905410410,
    chatAppSign: "7446873045e4e6f318a609e1c50a64e1ca4d746600f71dc8eb3401528723d6b6",
    isVoiceEnabled: true,
    lastFetchedAt: null,
    source: "default"
};

async function fetchZegoCredentialsFromFirestore() {
    try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/system_zego/zego_credentials`;
        const res = await fetch(firestoreUrl);
        if (!res.ok) {
            console.warn(`[ZegoFirestore] Firestore response ${res.status}: ${res.statusText}`);
            return activeZegoConfig;
        }
        const data = await res.json();
        if (data && data.fields) {
            const f = data.fields;
            const parseVal = (field) => {
                if (!field) return null;
                if (field.integerValue !== undefined) return Number(field.integerValue);
                if (field.stringValue !== undefined) return field.stringValue;
                if (field.booleanValue !== undefined) return field.booleanValue;
                return null;
            };

            const appId = parseVal(f.AppId) || parseVal(f.appId) || parseVal(f.zegoVoiceAppId);
            const appSign = parseVal(f.AppSign) || parseVal(f.appSign) || parseVal(f.zegoVoiceAppSign);
            const serverSecret = parseVal(f.serverSecret) || parseVal(f.zegoServerSecret) || appSign;
            const chatAppId = parseVal(f.chatAppId) || parseVal(f.zegoChatAppId);
            const chatAppSign = parseVal(f.chatAppSign) || parseVal(f.zegoChatAppSign);
            const isVoiceEnabled = parseVal(f.isVoiceEnabled);

            if (appId) activeZegoConfig.appId = Number(appId);
            if (appSign) activeZegoConfig.appSign = String(appSign);
            if (serverSecret) activeZegoConfig.serverSecret = String(serverSecret);
            if (chatAppId) activeZegoConfig.chatAppId = Number(chatAppId);
            if (chatAppSign) activeZegoConfig.chatAppSign = String(chatAppSign);
            if (isVoiceEnabled !== null && isVoiceEnabled !== undefined) {
                activeZegoConfig.isVoiceEnabled = Boolean(isVoiceEnabled);
            }

            activeZegoConfig.lastFetchedAt = new Date().toISOString();
            activeZegoConfig.source = "firestore:system_zego/zego_credentials";
            console.log(`[ZegoFirestore] Synced with Firestore! Active AppId: ${activeZegoConfig.appId}`);
        }
    } catch (err) {
        console.warn(`[ZegoFirestore] Warning fetching from Firestore: ${err.message}`);
    }
    return activeZegoConfig;
}

// Fetch on startup and every 5 minutes
fetchZegoCredentialsFromFirestore();
setInterval(fetchZegoCredentialsFromFirestore, 5 * 60 * 1000);

// Endpoint to view current Zego config loaded from Firestore
app.get('/api/zego/config', async (req, res) => {
    if (req.query.refresh === 'true') {
        await fetchZegoCredentialsFromFirestore();
    }
    res.json({
        success: true,
        firebaseProjectId: FIREBASE_PROJECT_ID,
        firestorePath: "system_zego/zego_credentials",
        config: {
            appId: activeZegoConfig.appId,
            appSign: activeZegoConfig.appSign ? (activeZegoConfig.appSign.substring(0, 6) + "..." + activeZegoConfig.appSign.substring(activeZegoConfig.appSign.length - 4)) : null,
            chatAppId: activeZegoConfig.chatAppId,
            isVoiceEnabled: activeZegoConfig.isVoiceEnabled,
            source: activeZegoConfig.source,
            lastFetchedAt: activeZegoConfig.lastFetchedAt
        }
    });
});

// Dynamic RTC Token generation using Firestore credentials
app.post('/api/zego/token', async (req, res) => {
    try {
        const { roomId, userId } = req.body;
        if (!roomId || !userId) {
            return res.status(400).json({ success: false, message: "Missing roomId or userId" });
        }

        if (!activeZegoConfig.lastFetchedAt) {
            await fetchZegoCredentialsFromFirestore();
        }

        const effectiveTimeInSeconds = 7200; // 2 hours
        const createTime = Math.floor(Date.now() / 1000);
        const expireTime = createTime + effectiveTimeInSeconds;
        const nonce = crypto.randomInt(100000, 999999);

        const currentAppId = activeZegoConfig.appId;
        const currentSecret = activeZegoConfig.serverSecret || activeZegoConfig.appSign;

        const payloadObj = {
            app_id: currentAppId,
            user_id: String(userId),
            room_id: String(roomId),
            privilege: { 1: 1, 2: 1 },
            create_time: createTime,
            expire_time: expireTime,
            nonce: nonce
        };

        const payloadStr = JSON.stringify(payloadObj);
        const iv = crypto.randomBytes(16);
        const secretKey = Buffer.from(currentSecret.padEnd(32, '0').substring(0, 32), 'utf8');
        const cipher = crypto.createCipheriv('aes-256-cbc', secretKey, iv);
        let encrypted = cipher.update(payloadStr, 'utf8', 'binary');
        encrypted += cipher.final('binary');

        const tokenPayload = {
            ver: 1,
            hash: crypto.createHmac('sha256', currentSecret).update(payloadStr).digest('hex'),
            data: Buffer.concat([iv, Buffer.from(encrypted, 'binary')]).toString('base64')
        };
        const token = "04" + Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

        res.json({
            success: true,
            appId: currentAppId,
            roomId,
            userId,
            token,
            expireTime,
            source: activeZegoConfig.source
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// API ROUTES: WALLET & GIFTING
// ============================================================================
app.get('/api/wallet/balance/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        await ensureUserWalletInRedis(uid);
        const coins = await redis.get(`user:${uid}:coins`);
        const diamonds = await redis.get(`user:${uid}:diamonds`);
        res.json({ success: true, uid, coins: Number(coins || 0), diamonds: Number(diamonds || 0) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/gift/send', async (req, res) => {
    try {
        const { senderUid, receiverUid, roomId, giftId, giftName, cost } = req.body;
        if (!senderUid || !receiverUid || !cost || cost <= 0) {
            return res.status(400).json({ success: false, message: "Invalid parameters" });
        }
        await ensureUserWalletInRedis(senderUid);
        await ensureUserWalletInRedis(receiverUid);

        const keys = [
            `user:${senderUid}:coins`,
            `user:${receiverUid}:diamonds`,
            `room:${roomId || 'global'}:exp`
        ];

        const result = await redis.eval(LUA_SINGLE_GIFT_SCRIPT, 3, keys[0], keys[1], keys[2], cost);
        if (result === 0) {
            return res.status(400).json({ success: false, message: "INSUFFICIENT_COINS" });
        }

        const remainingCoins = await redis.get(`user:${senderUid}:coins`);
        const receiverDiamonds = await redis.get(`user:${receiverUid}:diamonds`);

        const txId = `TX_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        Transaction.create({
            txId, senderUid, receiverUid, roomId, giftId, giftName,
            coinAmount: cost, diamondAmount: cost
        }).catch(err => console.error('[TxLog] Error:', err));

        if (roomId) {
            io.to(`room_${roomId}`).emit('gift_broadcast', {
                txId, senderUid, receiverUid, giftId, giftName, cost, timestamp: Date.now()
            });
        }

        res.json({
            success: true,
            txId,
            remainingCoins: Number(remainingCoins),
            receiverDiamonds: Number(receiverDiamonds)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/recharge/success', async (req, res) => {
    try {
        const { uid, amountInr, coinsAdded, paymentGateway, paymentRef } = req.body;
        if (!uid || !coinsAdded || coinsAdded <= 0) {
            return res.status(400).json({ success: false, message: "Invalid recharge parameters" });
        }
        await ensureUserWalletInRedis(uid);
        const newCoins = await redis.incrby(`user:${uid}:coins`, coinsAdded);
        const rchId = `RCH_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await Recharge.create({
            rechargeId: rchId, uid, amountInr: amountInr || 0,
            coinsAdded, paymentGateway: paymentGateway || "MANUAL",
            paymentRef: paymentRef || "", status: "SUCCESS"
        });
        await User.updateOne({ uid }, { $inc: { coins: coinsAdded, rechargeTotalInr: amountInr || 0 } }, { upsert: true });
        res.json({ success: true, rechargeId: rchId, remainingCoins: Number(newCoins) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Periodic Redis to MongoDB sync every 30 seconds
setInterval(async () => {
    try {
        const userCoinKeys = await redis.keys('user:*:coins');
        for (const key of userCoinKeys) {
            const uid = key.split(':')[1];
            if (uid) {
                const coins = Number(await redis.get(`user:${uid}:coins`) || 0);
                const diamonds = Number(await redis.get(`user:${uid}:diamonds`) || 0);
                await User.updateOne({ uid }, { $set: { coins, diamonds, updatedAt: new Date() } }, { upsert: true });
            }
        }
    } catch (err) {
        console.error('[Sync] Error:', err.message);
    }
}, 30000);

app.get('/health', (req, res) => {
    res.json({
        status: "OK",
        zegoSource: activeZegoConfig.source,
        zegoAppId: activeZegoConfig.appId,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});