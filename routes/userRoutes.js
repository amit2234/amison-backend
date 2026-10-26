const express = require('express');
const router = express.Router();
const User = require('../models/User');

module.exports = function(io, redis) {
  // 1. Create or Sync User in MongoDB & Redis
  router.post('/sync', async (req, res) => {
    try {
      const data = req.body;
      const userId = data.userId || data.uid;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const updateData = {
        userId: userId,
        uid: data.uid || userId,
        name: data.name || data.profileName || 'User',
        profilePhoto: data.profilePhoto || data.photo || '',
        email: data.email || data.googleAccount || '',
        googleAccount: data.googleAccount || data.email || '',
        gender: data.gender || 'Male',
        dob: data.dob || data.birthday || '2000-01-01',
        country: data.country || 'India',
        coins: data.coins !== undefined ? Number(data.coins) : 1000,
        diamonds: data.diamonds !== undefined ? Number(data.diamonds) : 0,
        userLevel: data.userLevel || 1,
        deviceId: data.deviceId || '',
        sessionId: data.sessionId || ''
      };

      const user = await User.findOneAndUpdate(
        { userId: userId },
        { $set: updateData },
        { returnDocument: 'after', upsert: true }
      );

      // Cache in Redis for ultra-fast load
      if (redis) {
        await redis.set(`user:${userId}`, JSON.stringify(user), 'EX', 86400);
      }

      // Realtime emit to Android app
      io.to(`user:${userId}`).emit('user:updated', user);

      return res.json({ success: true, user });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Fetch User Profile for 'Me' Tab
  router.get('/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      if (redis) {
        const cached = await redis.get(`user:${userId}`);
        if (cached) return res.json({ success: true, source: 'redis', user: JSON.parse(cached) });
      }

      const user = await User.findOne({ userId });
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });

      if (redis) await redis.set(`user:${userId}`, JSON.stringify(user), 'EX', 86400);

      return res.json({ success: true, source: 'mongodb', user });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
