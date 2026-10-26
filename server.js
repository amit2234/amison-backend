const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

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

// Environment Credentials supporting both MONGODB_URI and MONGO_URL
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || "mongodb+srv://diablo:Diablo2234@amison.bgzqeqm.mongodb.net/amison_db?retryWrites=true&w=majority";
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || MONGODB_URI;

const REDIS_URL = process.env.REDIS_URL || "redis://default:gQAAAAAAA56XAAIgcDI0MWNhYzRkZTc4NDU0Yjg5OWFjMDhiNGMyMGZhNzMyNA@vital-rooster-237207.upstash.io:6379";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'amison',
  api_key: process.env.CLOUDINARY_API_KEY || '1234567890',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'abcdefghijklmnopqrstuvwxyz'
});

// Connect to MongoDB Atlas using MONGODB_URI / MONGO_URL
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB Atlas Connected Successfully (Supporting MONGODB_URI & MONGO_URL)!'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Connect to Upstash Redis
const redis = new Redis(REDIS_URL, {
  tls: { rejectUnauthorized: false }
});

redis.on('connect', () => console.log('Upstash Redis Connected Successfully!'));
redis.on('error', (err) => console.error('Redis Connection Error:', err));

// --- Mongoose Schemas (Storing user database in MongoDB instead of Firestore) ---
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true }, // Firebase Auth UID
  name: { type: String, default: 'Amison User' },
  email: { type: String, default: '' },
  gender: { type: String, default: 'unspecified' },
  dob: { type: String, default: '' },
  coins: { type: Number, default: 10000 },
  diamonds: { type: Number, default: 5000 },
  numericId: { type: String, unique: true, default: () => Math.floor(100000000 + Math.random() * 900000000).toString() },
  avatarUrl: { type: String, default: '' },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Follow Schema for Social Graph in MongoDB
const followSchema = new mongoose.Schema({
  followerUid: { type: String, required: true, index: true },
  followingUid: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});
followSchema.index({ followerUid: 1, followingUid: 1 }, { unique: true });
const Follow = mongoose.model('Follow', followSchema);

// REST API Endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'Amison Node.js Backend Active (MongoDB + Cloudinary + Redis)', 
    storage: 'MongoDB (Supporting MONGODB_URI & MONGO_URL)',
    timestamp: new Date() 
  });
});

// 1. Sync / Create User on Google Login (Stores user in MongoDB, NOT Firestore)
app.post('/api/user/sync', async (req, res) => {
  try {
    const { uid, name, email, avatarUrl, gender, dob } = req.body;
    if (!uid) return res.status(400).json({ error: 'Firebase Auth UID is required' });

    let user = await User.findOne({ uid });
    if (!user) {
      user = new User({
        uid,
        name: name || 'Amison User',
        email: email || '',
        avatarUrl: avatarUrl || '',
        gender: gender || 'unspecified',
        dob: dob || ''
      });
      await user.save();
    } else {
      if (name) user.name = name;
      if (avatarUrl) user.avatarUrl = avatarUrl;
      if (gender) user.gender = gender;
      if (dob) user.dob = dob;
      if (email) user.email = email;
      await user.save();
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error('Error syncing user:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Get User Profile & Wallet from MongoDB
app.get('/api/user/:uid', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.params.uid });
    if (!user) return res.status(404).json({ error: 'User not found in MongoDB' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update User Profile & Avatar (Cloudinary backed)
app.post('/api/user/update-profile', async (req, res) => {
  try {
    const { uid, name, avatarUrl, gender, dob } = req.body;
    if (!uid) return res.status(400).json({ error: 'UID is required' });

    let user = await User.findOne({ uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (name) user.name = name;
    if (avatarUrl) user.avatarUrl = avatarUrl;
    if (gender) user.gender = gender;
    if (dob) user.dob = dob;

    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Toggle Follow / Unfollow (MongoDB atomic graph update)
app.post('/api/follow/toggle', async (req, res) => {
  try {
    const { followerUid, targetUid } = req.body;
    if (!followerUid || !targetUid || followerUid === targetUid) {
      return res.status(400).json({ error: 'Invalid follower or target UID' });
    }

    const existing = await Follow.findOne({ followerUid, followingUid: targetUid });
    let isFollowing = false;

    if (existing) {
      await Follow.deleteOne({ _id: existing._id });
      await User.updateOne({ uid: followerUid }, { $inc: { followingCount: -1 } });
      await User.updateOne({ uid: targetUid }, { $inc: { followersCount: -1 } });
      isFollowing = false;
    } else {
      await Follow.create({ followerUid, followingUid: targetUid });
      await User.updateOne({ uid: followerUid }, { $inc: { followingCount: 1 } });
      await User.updateOne({ uid: targetUid }, { $inc: { followersCount: 1 } });
      isFollowing = true;
    }

    res.json({ success: true, isFollowing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Gifting Transaction Endpoint (MongoDB + Redis)
app.post('/api/gift/send', async (req, res) => {
  try {
    const { senderId, receiverId, giftId, giftCost, roomId } = req.body;
    const sender = await User.findOne({ uid: senderId });
    const receiver = await User.findOne({ uid: receiverId });

    if (!sender || sender.coins < giftCost) {
      return res.status(400).json({ success: false, message: 'Insufficient coins in MongoDB wallet' });
    }

    sender.coins -= giftCost;
    receiver.diamonds += Math.floor(giftCost * 0.5);

    await sender.save();
    await receiver.save();

    io.to(roomId).emit('gift_sent', {
      senderId,
      receiverId,
      giftId,
      giftCost,
      remainingCoins: sender.coins,
      receiverDiamonds: receiver.diamonds,
      timestamp: Date.now()
    });

    res.json({ success: true, remainingCoins: sender.coins, receiverDiamonds: receiver.diamonds });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Socket.IO Real-Time Voice Rooms (12 Seats: 4 + 4 + 4 layout)
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join_room', async ({ roomId, userId, userName }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId;

    const seatsKey = `room:${roomId}:seats`;
    const seats = await redis.hgetall(seatsKey);
    
    socket.emit('room_state', { 
      roomId, 
      totalSeats: 12,
      layout: '4+4+4',
      seats 
    });
  });

  socket.on('lock_seat', async ({ roomId, seatIndex, userId, userName }) => {
    if (seatIndex < 0 || seatIndex >= 12) return;
    const seatLockKey = `room:${roomId}:seat:${seatIndex}:lock`;
    const seatsKey = `room:${roomId}:seats`;

    const acquired = await redis.set(seatLockKey, userId, 'NX', 'EX', 60);
    if (acquired) {
      await redis.hset(seatsKey, seatIndex, JSON.stringify({ userId, userName, status: 'locked', timestamp: Date.now() }));
      const seats = await redis.hgetall(seatsKey);
      io.to(roomId).emit('seat_updated', { totalSeats: 12, layout: '4+4+4', seats });
      socket.emit('seat_lock_result', { success: true, seatIndex });
    } else {
      socket.emit('seat_lock_result', { success: false, message: 'Seat already occupied' });
    }
  });

  socket.on('release_seat', async ({ roomId, seatIndex, userId }) => {
    if (seatIndex < 0 || seatIndex >= 12) return;
    const seatLockKey = `room:${roomId}:seat:${seatIndex}:lock`;
    const seatsKey = `room:${roomId}:seats`;

    const currentLockUser = await redis.get(seatLockKey);
    if (currentLockUser === userId || !currentLockUser) {
      await redis.del(seatLockKey);
      await redis.hdel(seatsKey, seatIndex);
      const seats = await redis.hgetall(seatsKey);
      io.to(roomId).emit('seat_updated', { totalSeats: 12, layout: '4+4+4', seats });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Amison Backend Server running on port ${PORT}`);
});
