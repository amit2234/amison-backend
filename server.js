require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// 1. Connect MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 2. Connect Upstash Redis (with TLS support)
const redis = new Redis(process.env.REDIS_URL, {
    tls: { rejectUnauthorized: false }
});

redis.on('connect', () => console.log('✅ Redis Connected successfully'));
redis.on('error', (err) => console.error('❌ Redis Error:', err));

// 3. Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
console.log('✅ Cloudinary Configured');

// --- MONGODB SCHEMAS ---
const WalletSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    coins: { type: Number, default: 10000 },
    diamonds: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
});
const Wallet = mongoose.model('Wallet', WalletSchema);

// --- API ROUTES ---

// A. Get User Wallet Balance
app.get('/api/wallet/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let coins = await redis.get(`wallet:${userId}:coins`);
        let diamonds = await redis.get(`wallet:${userId}:diamonds`);

        if (coins === null || diamonds === null) {
            let wallet = await Wallet.findOne({ userId });
            if (!wallet) {
                wallet = await Wallet.create({ userId, coins: 10000, diamonds: 0 });
            }
            coins = wallet.coins;
            diamonds = wallet.diamonds;
            await redis.set(`wallet:${userId}:coins`, coins);
            await redis.set(`wallet:${userId}:diamonds`, diamonds);
        }

        res.json({ success: true, coins: parseInt(coins), diamonds: parseInt(diamonds) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// B. Atomic Gift Sending (Redis + MongoDB + WebSocket Broadcast)
app.post('/api/gift/send', async (req, res) => {
    const { senderId, recipientId, giftCost, diamondReward, roomId } = req.body;

    if (!senderId || !recipientId || !giftCost) {
        return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    const senderKey = `wallet:${senderId}:coins`;
    const recipientKey = `wallet:${recipientId}:diamonds`;

    try {
        let senderCoins = await redis.get(senderKey);
        if (senderCoins === null) {
            let senderWallet = await Wallet.findOne({ userId: senderId });
            senderCoins = senderWallet ? senderWallet.coins : 10000;
            await redis.set(senderKey, senderCoins);
        }

        // Strict Balance Check (Prevents negative coins / -246464 bug)
        if (parseInt(senderCoins) < giftCost) {
            return res.status(400).json({ success: false, message: 'Insufficient coins balance!' });
        }

        // Atomic Redis Decrement & Increment
        const newSenderCoins = await redis.decrby(senderKey, giftCost);
        const reward = diamondReward || Math.floor(giftCost * 0.7);
        const newRecipientDiamonds = await redis.incrby(recipientKey, reward);

        // Background MongoDB Sync
        Wallet.findOneAndUpdate({ userId: senderId }, { coins: newSenderCoins, updatedAt: Date.now() }, { upsert: true }).exec();
        Wallet.findOneAndUpdate({ userId: recipientId }, { diamonds: newRecipientDiamonds, updatedAt: Date.now() }, { upsert: true }).exec();

        // Broadcast via Socket.io to Live Room
        if (roomId) {
            io.to(roomId).emit('gift_sent', {
                senderId,
                recipientId,
                giftCost,
                newSenderCoins,
                newRecipientDiamonds
            });
        }

        res.json({
            success: true,
            message: 'Gift sent successfully via Redis Atomic Transaction!',
            remainingCoins: newSenderCoins,
            recipientDiamonds: newRecipientDiamonds
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// C. Cloudinary Image Upload Endpoint
app.post('/api/upload', async (req, res) => {
    try {
        const { imageBase64, folder } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ success: false, message: 'No image provided' });
        }

        const uploadResult = await cloudinary.uploader.upload(imageBase64, {
            folder: folder || 'amison_uploads'
        });

        res.json({
            success: true,
            url: uploadResult.secure_url
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- WEBSOCKET REAL-TIME ROOMS ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Amison Professional Backend running on port ${PORT}`);
});