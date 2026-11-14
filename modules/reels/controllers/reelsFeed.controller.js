const Reel = require('../../../models/Reel');
const ReelLike = require('../../../models/ReelLike');
const User = require('../../../models/User');
const Follow = require('../../../models/Friend');
const { FEED_FILTERS, formatRelativeTime } = require('../reels.constants');
const { normalizeFeedFilter, normalizePageAndLimit } = require('../reels.validation');

/**
 * Enriches raw Reel documents with live User profile data, caller-specific isLiked,
 * caller-specific isFollowing (strictly false for own posts), and relative timestamps.
 */
async function enrichReelsForViewer(reels, viewerUid) {
    if (!Array.isArray(reels) || reels.length === 0) return [];

    const cleanViewerUid = String(viewerUid || '').trim();
    const reelIds = reels.map(r => r.reelId).filter(Boolean);
    const authorUids = [...new Set(reels.map(r => r.userUid).filter(Boolean))];

    const [userDocs, likeDocs, followDocs] = await Promise.all([
        User.find({ uid: { $in: authorUids } })
            .select('uid numericId name avatarUrl level gender')
            .lean(),
        cleanViewerUid
            ? ReelLike.find({ userUid: cleanViewerUid, reelId: { $in: reelIds } })
                .select('reelId')
                .lean()
            : Promise.resolve([]),
        cleanViewerUid
            ? Follow.find({ followerUid: cleanViewerUid, followingUid: { $in: authorUids } })
                .select('followingUid')
                .lean()
            : Promise.resolve([])
    ]);

    const userMap = new Map(userDocs.map(u => [u.uid, u]));
    const likedSet = new Set(likeDocs.map(l => l.reelId));
    const followingSet = new Set(followDocs.map(f => f.followingUid));

    return reels.map(item => {
        const u = userMap.get(item.userUid);
        const isOwnPost = Boolean(cleanViewerUid && cleanViewerUid === item.userUid);

        return {
            reelId: item.reelId,
            userUid: item.userUid,
            numericId: (u && u.numericId) ? u.numericId : item.numericId,
            userName: (u && u.name) ? u.name : item.userName,
            userAvatar: (u && u.avatarUrl) ? u.avatarUrl : item.userAvatar,
            userLevel: (u && u.level) ? u.level : item.userLevel,
            gender: (u && u.gender) ? u.gender : item.gender,
            videoHlsUrl: item.videoHlsUrl,
            coverUrl: item.coverUrl,
            mediaType: item.mediaType || 'VIDEO',
            aspectRatio: Number(item.aspectRatio) || 0,
            durationSeconds: Number(item.durationSeconds) || 30,
            trimStartSec: Number(item.trimStartSec) || 0,
            trimEndSec: Number(item.trimEndSec) || 30,
            caption: item.caption || '',
            hashtags: item.hashtags || '',
            fullDescription: item.fullDescription || '',
            musicTitle: item.musicTitle || 'Original Sound',
            musicCoverUrl: item.musicCoverUrl || ((u && u.avatarUrl) ? u.avatarUrl : item.userAvatar) || '',
            likesCount: Math.max(0, Number(item.likesCount) || 0),
            commentsCount: Math.max(0, Number(item.commentsCount) || 0),
            isLiked: likedSet.has(item.reelId),
            isFollowing: isOwnPost ? false : followingSet.has(item.userUid),
            isOwnPost,
            createdAt: item.createdAt,
            timeAgo: formatRelativeTime(item.createdAt)
        };
    });
}

/**
 * GET /api/reels/feed?page=0&limit=15&mediaType=ALL|VIDEO|PHOTO
 */
async function getFeed(req, res) {
    try {
        const { page, limit, skip } = normalizePageAndLimit(req.query.page, req.query.limit);
        const filterType = normalizeFeedFilter(req.query.mediaType);
        const viewerUid = String(req.callerUid || '').trim();

        const query = { isPublished: true };
        if (filterType === FEED_FILTERS.VIDEO || filterType === FEED_FILTERS.PHOTO) {
            query.mediaType = filterType;
        }

        const rawReels = await Reel.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit + 1)
            .lean();

        const hasMore = rawReels.length > limit;
        const pageSlice = hasMore ? rawReels.slice(0, limit) : rawReels;
        const enriched = await enrichReelsForViewer(pageSlice, viewerUid);

        return res.json({
            success: true,
            page,
            limit,
            hasMore,
            mediaType: filterType,
            reels: enriched
        });
    } catch (err) {
        console.error('❌ [ReelsFeed] GET /feed error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * GET /api/reels/user/:userUid?mediaType=ALL|VIDEO|PHOTO
 */
async function getUserReels(req, res) {
    try {
        const targetUid = String(req.params.userUid || '').trim();
        if (!targetUid) {
            return res.status(400).json({ success: false, error: 'Missing userUid' });
        }

        const filterType = normalizeFeedFilter(req.query.mediaType);
        const viewerUid = String(req.callerUid || '').trim();

        const query = { userUid: targetUid, isPublished: true };
        if (filterType === FEED_FILTERS.VIDEO || filterType === FEED_FILTERS.PHOTO) {
            query.mediaType = filterType;
        }

        const rawReels = await Reel.find(query)
            .sort({ createdAt: -1 })
            .lean();

        const enriched = await enrichReelsForViewer(rawReels, viewerUid);

        return res.json({
            success: true,
            userUid: targetUid,
            count: enriched.length,
            reels: enriched
        });
    } catch (err) {
        console.error('❌ [ReelsFeed] GET /user/:userUid error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    enrichReelsForViewer,
    getFeed,
    getUserReels
};
