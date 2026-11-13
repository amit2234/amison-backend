const express = require('express');
const router = express.Router();
const Follow = require('../models/Friend');
const { verifyAuthenticatedUser } = require('../middleware/authMiddleware');

// NOTE: friendsRoutes is also mounted at `/api` (`/api/user/follow`).
// Attach verifyAuthenticatedUser per route so unrelated `/api/*` routers aren't shadowed.

// ============================================================================
// 1. POST /api/friends/follow (or /api/user/follow) - Follow a user
// ============================================================================
async function handleFollow(req, res) {
    try {
        const { followingUid } = req.body || {};
        const cleanFollower = String(req.callerUid || '').trim();
        const cleanFollowing = String(followingUid || '').trim();
        if (!cleanFollower || !cleanFollowing) {
            return res.status(400).json({ success: false, error: 'followingUid is required' });
        }

        if (cleanFollower === cleanFollowing) {
            return res.status(400).json({ success: false, error: 'Users cannot follow themselves' });
        }

        const existing = await Follow.findOne({ followerUid: cleanFollower, followingUid: cleanFollowing });
        if (existing) {
            return res.json({ success: true, message: 'Already following' });
        }

        const newFollow = new Follow({
            followerUid: cleanFollower,
            followingUid: cleanFollowing
        });

        await newFollow.save();
        console.log(`[Friends Route] User ${cleanFollower} followed ${cleanFollowing}`);
        return res.json({ success: true, message: 'Successfully followed' });
    } catch (e) {
        console.error('[Friends Route] Follow error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/follow', verifyAuthenticatedUser, handleFollow);
router.post('/user/follow', verifyAuthenticatedUser, handleFollow);

// ============================================================================
// 2. POST /api/friends/unfollow (or /api/user/unfollow) - Unfollow a user
// ============================================================================
async function handleUnfollow(req, res) {
    try {
        const { followingUid } = req.body || {};
        const cleanFollower = String(req.callerUid || '').trim();
        const cleanFollowing = String(followingUid || '').trim();
        if (!cleanFollower || !cleanFollowing) {
            return res.status(400).json({ success: false, error: 'followingUid is required' });
        }

        await Follow.deleteOne({ followerUid: cleanFollower, followingUid: cleanFollowing });
        console.log(`[Friends Route] User ${cleanFollower} unfollowed ${cleanFollowing}`);
        return res.json({ success: true, message: 'Successfully unfollowed' });
    } catch (e) {
        console.error('[Friends Route] Unfollow error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.post('/unfollow', verifyAuthenticatedUser, handleUnfollow);
router.post('/user/unfollow', verifyAuthenticatedUser, handleUnfollow);

// ============================================================================
// 3. GET /api/friends/stats/:uid (or /api/user/:uid/stats) - Social stats
// ============================================================================
async function handleGetStats(req, res) {
    try {
        const { uid } = req.params;
        const viewerUid = (req.query.viewerUid || '').trim();
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const cleanUid = String(uid).trim();

        const followingCount = await Follow.countDocuments({ followerUid: cleanUid });
        const followersCount = await Follow.countDocuments({ followingUid: cleanUid });

        // Calculate Mutual Friends
        const userFollowing = await Follow.find({ followerUid: cleanUid }).select('followingUid').lean();
        const followingUids = userFollowing.map(f => f.followingUid);
        const friendsCount = await Follow.countDocuments({
            followerUid: { $in: followingUids },
            followingUid: cleanUid
        });

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
        console.error('[Friends Route] Stats error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.get('/stats/:uid', verifyAuthenticatedUser, handleGetStats);
router.get('/user/:uid/stats', verifyAuthenticatedUser, handleGetStats);

// ============================================================================
// 4. GET /api/friends/followers/:uid (or /api/user/:uid/followers)
// ============================================================================
async function handleGetFollowers(req, res) {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const follows = await Follow.find({ followingUid: String(uid).trim() }).lean();
        return res.json({ success: true, followers: follows });
    } catch (e) {
        console.error('[Friends Route] Get followers error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.get('/followers/:uid', verifyAuthenticatedUser, handleGetFollowers);
router.get('/user/:uid/followers', verifyAuthenticatedUser, handleGetFollowers);

// ============================================================================
// 5. GET /api/friends/following/:uid (or /api/user/:uid/following)
// ============================================================================
async function handleGetFollowing(req, res) {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ success: false, error: 'Missing UID' });

        const follows = await Follow.find({ followerUid: String(uid).trim() }).lean();
        return res.json({ success: true, following: follows });
    } catch (e) {
        console.error('[Friends Route] Get following error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.get('/following/:uid', verifyAuthenticatedUser, handleGetFollowing);
router.get('/user/:uid/following', verifyAuthenticatedUser, handleGetFollowing);

module.exports = router;
