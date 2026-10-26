const express = require('express');
const router = express.Router();
const User = require('../models/User');

module.exports = function(io, redis) {
  // Helper to sync to Redis
  async function cacheUser(user) {
    if (!redis || !user || !user.userId) return;
    try {
      const key = `user:${user.userId}`;
      await redis.set(key, JSON.stringify(user), 'EX', 86400); // 24 hr cache
      if (user.email) {
        await redis.set(`email:${user.email.toLowerCase()}`, user.userId, 'EX', 86400);
      }
      if (user.googleAccount) {
        await redis.set(`google:${user.googleAccount.toLowerCase()}`, user.userId, 'EX', 86400);
      }
    } catch (e) {
      console.error('Redis cache error:', e.message);
    }
  }

  // 1. Sync / Create or Update User Profile
  router.post('/sync', async (req, res) => {
    try {
      const data = req.body;
      const userId = data.userId || data.uid;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const updateData = {
        userId: userId,
        firebaseUid: data.firebaseUid || userId,
        numericId: data.numericId || data.uid || '',
        uid: data.uid || data.numericId || '',
        name: data.name || data.profileName || 'User',
        profilePhoto: data.profilePhoto || data.photo || '',
        email: (data.email || data.googleAccount || '').toLowerCase(),
        googleAccount: (data.googleAccount || data.email || '').toLowerCase(),
        gender: data.gender || 'Male',
        dob: data.dob || data.birthday || '2000-01-01',
        country: data.country || 'India',
        coins: data.coins !== undefined ? Number(data.coins) : 1000,
        diamonds: data.diamonds !== undefined ? Number(data.diamonds) : 0,
        userLevel: data.userLevel || data.level || 1,
        userXp: data.userXp || data.xp || 0,
        followersCount: data.followersCount || 0,
        followingCount: data.followingCount || 1,
        friendsCount: data.friendsCount || 0,
        visitorsCount: data.visitorsCount || 0,
        isBanned: data.isBanned || false,
        banReason: data.banReason || '',
        deviceId: data.deviceId || '',
        sessionId: data.sessionId || ''
      };

      const orConditions = [{ userId: userId }, { firebaseUid: userId }];
      if (updateData.email) {
        orConditions.push({ email: updateData.email });
      }

      const user = await User.findOneAndUpdate(
        { $or: orConditions },
        { $set: updateData },
        { returnDocument: 'after', upsert: true }
      );

      // Cache in Redis
      await cacheUser(user);

      // Realtime Broadcast via Socket.io
      io.to(`user:${userId}`).emit('user:updated', user);
      io.emit('user:public_sync', {
        userId: user.userId,
        numericId: user.numericId,
        name: user.name,
        profilePhoto: user.profilePhoto,
        userLevel: user.userLevel
      });

      return res.json({ success: true, user });
    } catch (err) {
      console.error('Error in /api/users/sync:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Fetch User Profile by userId, firebaseUid, or numericId (Used by Me Tab and Login)
  router.get('/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      // Check Redis first for fast response
      if (redis) {
        try {
          const cached = await redis.get(`user:${userId}`);
          if (cached) {
            return res.json({ success: true, source: 'redis', user: JSON.parse(cached) });
          }
        } catch (_) {}
      }

      // Fallback to MongoDB: search by userId, firebaseUid, numericId, or uid
      const user = await User.findOne({
        $or: [
          { userId: userId },
          { firebaseUid: userId },
          { numericId: userId },
          { uid: userId }
        ]
      });
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found in MongoDB' });
      }

      // Warm Redis cache
      await cacheUser(user);

      return res.json({ success: true, source: 'mongodb', user });
    } catch (err) {
      console.error('Error in GET /api/users/:userId:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Find User by Google Email (For returning users login)
  router.get('/by-email/:email', async (req, res) => {
    try {
      const email = req.params.email.toLowerCase();

      // Check Redis mapping
      if (redis) {
        try {
          const mappedUserId = await redis.get(`email:${email}`) || await redis.get(`google:${email}`);
          if (mappedUserId) {
            const cachedUser = await redis.get(`user:${mappedUserId}`);
            if (cachedUser) {
              return res.json({ success: true, source: 'redis', user: JSON.parse(cachedUser) });
            }
          }
        } catch (_) {}
      }

      const user = await User.findOne({
        $or: [
          { email: new RegExp('^' + email + '$', 'i') },
          { googleAccount: new RegExp('^' + email + '$', 'i') }
        ]
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found for this email' });
      }

      await cacheUser(user);
      return res.json({ success: true, source: 'mongodb', user });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Update Profile (Name, Photo, Bio, etc.)
  router.put('/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const allowedFields = ['name', 'profilePhoto', 'gender', 'dob', 'country', 'bio'];
      const update = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          update[field] = req.body[field];
        }
      }

      const updatedUser = await User.findOneAndUpdate(
        { userId: userId },
        { $set: update },
        { returnDocument: 'after' }
      );

      if (!updatedUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      await cacheUser(updatedUser);

      // Realtime emit
      io.to(`user:${userId}`).emit('user:updated', updatedUser);

      return res.json({ success: true, user: updatedUser });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
