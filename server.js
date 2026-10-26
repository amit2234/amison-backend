require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB Connection (Supports both MONGODB_URI and MONGO_URI)
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/user_profile_db';
mongoose.connect(MONGO_URI).then(() => {
  console.log('Connected to MongoDB Atlas / Local DB successfully');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});

// User Schema & Model
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, index: true },
  name: { type: String, default: 'User' },
  avatarUrl: { type: String, default: '' },
  backgroundUrl: { type: String, default: '' },
  birthday: { type: String, default: '' },
  country: { type: String, default: '' },
  bio: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ==================== API ROUTES ====================

// 1. Root Test Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'Server is running successfully!', timestamp: new Date() });
});

// 2. Sync / Create User on Login
app.post('/api/users/sync', async (req, res) => {
  try {
    const { userId, email, name, avatarUrl } = req.body;
    if (!userId || !email) {
      return res.status(400).json({ error: 'userId and email are required' });
    }

    let user = await User.findOne({ userId });
    if (!user) {
      // Check by email if userId not found
      user = await User.findOne({ email });
      if (user) {
        user.userId = userId; // update userId if matched by email
      } else {
        user = new User({
          userId,
          email,
          name: name || email.split('@')[0],
          avatarUrl: avatarUrl || ''
        });
      }
    } else {
      if (name) user.name = name;
      if (avatarUrl && !user.avatarUrl) user.avatarUrl = avatarUrl;
    }

    user.updatedAt = Date.now();
    await user.save();
    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Error in /api/users/sync:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Get User Profile by userId
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Get User Profile by Email
app.get('/api/users/by-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user by email:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Update User Profile
app.put('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, avatarUrl, backgroundUrl, birthday, country, bio } = req.body;

    let user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name !== undefined) user.name = name;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    if (backgroundUrl !== undefined) user.backgroundUrl = backgroundUrl;
    if (birthday !== undefined) user.birthday = birthday;
    if (country !== undefined) user.country = country;
    if (bio !== undefined) user.bio = bio;
    user.updatedAt = Date.now();

    await user.save();
    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Upload Avatar / Media to Cloudinary
app.post('/api/upload/avatar', async (req, res) => {
  try {
    const { image } = req.body; // Base64 image string or URL
    if (!image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const uploadResponse = await cloudinary.uploader.upload(image, {
      folder: 'user_avatars',
      resource_type: 'auto'
    });

    res.status(200).json({
      success: true,
      url: uploadResponse.secure_url,
      public_id: uploadResponse.public_id
    });
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('A user connected via WebSocket:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.getPORT = PORT; // reference
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
