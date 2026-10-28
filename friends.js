const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ============================================================================
// MONGOOSE SCHEMA: FOLLOW / FOLLOWERS COLLECTION (Permanent Auth UID Based)
// ============================================================================
const followSchema = new mongoose.Schema({
    followerUid: { type: String, required: true, index: true }, // User who follows
    followingUid: { type: String, required: true, index: true }, // User being followed
    createdAt: { type: Date, default: Date.now }
});

// Composite unique index to prevent duplicate follows and ensure lightning-fast lookups
followSchema.index({ followerUid: 1, followingUid: 1 }, { unique: true });

const Follow = mongoose.model('Follow', followSchema);

// ============================================================================
// SOCIAL API ENDPOINTS (MongoDB Atlas Real-Time)
// ============================================================================

// 1. POST /api/user/follow: Follow a user
router.post('/user/follow', async (req, res) => {
    try {
        const { followerUid, followingUid } = req.body;
        if (!followerUid || !followingUid) {
            return res.status(400).json({ success: false, error: 'followerUid and followingUid are required' });
        }

        const cleanFollower = followerUid.trim();
        const cleanFollowing = followingUid.trim();

        if (cleanFollower === cleanFollowing) {
            return res.status(400).json({ success: false, error: 'Users cannot follow themselves' });
        }

        // Check if follow relation already exists
        const existing = await Follow.findOne({ followerUid: cleanFollower, followingUid: cleanFollowing });
        if (existing) {
            return res.json({ success: true, message: 'Already following' });
        }

        const newFollow = new Follow({
            followerUid: cleanFollower,
            followingUid: cleanFollowing
        });

        await newFollow.save();
        console.log(`[MongoDB Social] User ${cleanFollower} followed ${cleanFollowing}`);
        return res.json({ success: true, message: 'Successfully followed' });
    } catch (e) {
        console.error('[MongoDB Social] Follow error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. POST /api/user/unfollow: Unfollow a user
router.post('/user/unfollow', async (req, res) => {
    try {
        const { followerUid, followingUid } = req.body;
        if (!followerUid || !followingUid) {
            return res.status(400).json({ success: false, error: 'followerUid and followingUid are required' });
        }

        const cleanFollower = followerUid.trim();
        const cleanFollowing = followingUid.trim();

        await Follow.deleteOne({ followerUid: cleanFollower, followingUid: cleanFollowing });
        console.log(`[MongoDB Social] User ${cleanFollower} unfollowed ${cleanFollowing}`);
        return res.json({ success: true, message: 'Successfully unfollowed' });
    } catch (e) {
        console.error('[MongoDB Social] Unfollow error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. GET /api/user/:uid/stats?viewerUid=...: Get followingCount, followersCount, friendsCount, and isFollowing status
router.get('/user/:uid/stats', async (req, res) => {
    try {
        const { uid } = req.params;
        const viewerUid = (req.query.viewerUid || '').trim();
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = uid.trim();

        // Count how many users this user is following
        const followingCount = await Follow.countDocuments({ followerUid: cleanUid });

        // Count how many followers this user has
        const followersCount = await Follow.countDocuments({ followingUid: cleanUid });

        // Calculate Friends (Mutuals): Users who both follow cleanUid and are followed by cleanUid
        const userFollowing = await Follow.find({ followerUid: cleanUid }).select('followingUid').lean();
        const followingUids = userFollowing.map(f => f.followingUid);
        const friendsCount = await Follow.countDocuments({
            followerUid: { $in: followingUids },
            followingUid: cleanUid
        });

        // Check if viewerUid is following cleanUid
        let isFollowing = false;
        if (viewerUid && viewerUid !== cleanUid) {
            const check = await Follow.findOne({ followerUid: viewerUid, followingUid: cleanUid });
            isFollowing = !!check;
        }

        return res.json({
            success: true,
            followingCount,
            followersCount,
            friendsCount,
            isFollowing
        });
    } catch (e) {
        console.error('[MongoDB Social] Stats error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. GET /api/user/:uid/followers: Get list of followers for a user
router.get('/user/:uid/followers', async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const follows = await Follow.find({ followingUid: uid.trim() }).lean();
        return res.json({ success: true, followers: follows });
    } catch (e) {
        console.error('[MongoDB Social] Get followers error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. GET /api/user/:uid/following: Get list of users followed by this user
router.get('/user/:uid/following', async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const follows = await Follow.find({ followerUid: uid.trim() }).lean();
        return res.json({ success: true, following: follows });
    } catch (e) {
        console.error('[MongoDB Social] Get following error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
