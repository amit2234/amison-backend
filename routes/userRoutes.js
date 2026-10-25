const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');

const REDIS_PROFILE_PREFIX = 'user:profile:';
const CACHE_TTL_SECONDS = 3600; // 1 hour cache TTL

/**
 * GET /api/users/profile/:userId
 * Reads from Redis cache first; on cache miss, reads from MongoDB and populates Redis.
 */
router.get('/profile/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }

  const redis = getRedisClient();
  const cacheKey = `${REDIS_PROFILE_PREFIX}${userId}`;

  // 1. Try fetching from Redis cache
  if (redis && redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return res.json({
          success: true,
          source: 'redis_cache',
          data: parsed,
        });
      }
    } catch (err) {
      console.warn(`[Redis] Cache read error for ${cacheKey}:`, err.message);
    }
  }

  // 2. Fetch from MongoDB on cache miss
  try {
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User profile not found in MongoDB' });
    }

    const profileData = {
      userId: user.userId,
      userCode: user.userCode,
      name: user.name,
      dob: user.dob,
      gender: user.gender,
      country: user.country,
      email: user.email,
      photoUrl: user.photoUrl,
      level: user.level,
      updatedAt: user.updatedAtTimestamp || Date.now(),
    };

    // 3. Cache into Redis
    if (redis && redis.status === 'ready') {
      try {
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(profileData));
      } catch (err) {
        console.warn(`[Redis] Cache write error for ${cacheKey}:`, err.message);
      }
    }

    return res.json({
      success: true,
      source: 'mongodb',
      data: profileData,
    });
  } catch (err) {
    console.error('[MongoDB] Error finding user:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message });
  }
});

/**
 * POST /api/users/profile
 * Upserts profile into MongoDB, and immediately updates Redis cache.
 */
router.post('/profile', async (req, res) => {
  const {
    userId,
    userCode,
    name,
    dob,
    gender,
    country,
    email,
    photoUrl,
    level,
  } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }

  try {
    const updateData = {
      userId,
      name: name || 'Sona',
      dob: dob || '2000-01-01',
      gender: gender || 'Male',
      country: country || 'India',
      email: email || 'Sona@gmail.com',
      photoUrl: photoUrl || '',
      level: typeof level === 'number' ? level : 0,
      updatedAtTimestamp: Date.now(),
    };

    if (userCode) {
      updateData.userCode = userCode;
    }

    // Save/Update in MongoDB
    const updatedUser = await User.findOneAndUpdate(
      { userId },
      { $set: updateData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const savedProfile = {
      userId: updatedUser.userId,
      userCode: updatedUser.userCode,
      name: updatedUser.name,
      dob: updatedUser.dob,
      gender: updatedUser.gender,
      country: updatedUser.country,
      email: updatedUser.email,
      photoUrl: updatedUser.photoUrl,
      level: updatedUser.level,
      updatedAt: updatedUser.updatedAtTimestamp,
    };

    // Update Redis cache immediately
    const redis = getRedisClient();
    const cacheKey = `${REDIS_PROFILE_PREFIX}${userId}`;
    if (redis && redis.status === 'ready') {
      try {
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(savedProfile));
      } catch (err) {
        console.warn(`[Redis] Cache write error for ${cacheKey}:`, err.message);
      }
    }

    return res.json({
      success: true,
      message: 'Profile saved to MongoDB and cached in Redis',
      data: savedProfile,
    });
  } catch (err) {
    console.error('[MongoDB] Error saving user profile:', err);
    return res.status(500).json({ success: false, message: 'Failed to save profile in MongoDB', error: err.message });
  }
});

/**
 * GET /api/users/check/:userCode
 */
router.get('/check/:userCode', async (req, res) => {
  try {
    const exists = await User.exists({ userCode: req.params.userCode });
    return res.json({ success: true, exists: Boolean(exists) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
