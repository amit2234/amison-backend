const Reel = require('../../../models/Reel');
const ReelLike = require('../../../models/ReelLike');
const ReelComment = require('../../../models/ReelComment');
const User = require('../../../models/User');
const {
    MAX_CAPTION_LENGTH,
    MAX_COMMENT_LENGTH,
    MAX_HASHTAGS_LENGTH,
    formatRelativeTime
} = require('../reels.constants');
const {
    isValidHttpUrl,
    normalizeMediaType,
    normalizeAspectRatio,
    normalizeDuration,
    sanitizeText
} = require('../reels.validation');
const { generateUploadSignature } = require('../services/reelsMedia.service');

/**
 * GET /api/reels/upload-signature?resourceType=video|image
 */
function getUploadSignature(req, res) {
    try {
        const resourceType = req.query.resourceType || 'video';
        const data = generateUploadSignature(resourceType);
        return res.json({
            success: true,
            ...data
        });
    } catch (err) {
        console.error('❌ [ReelsAction] GET /upload-signature error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * POST /api/reels/publish
 */
async function publishReel(req, res) {
    try {
        const {
            reelId,
            videoHlsUrl,
            coverUrl,
            mediaType,
            aspectRatio,
            durationSeconds,
            trimStartSec,
            trimEndSec,
            caption,
            hashtags,
            description,
            musicTitle,
            musicCoverUrl
        } = req.body || {};

        const userUid = String(req.callerUid || '').trim();
        if (!userUid) {
            return res.status(401).json({ success: false, error: 'Unauthorized user' });
        }

        const cleanMediaUrl = String(videoHlsUrl || '').trim();
        if (!isValidHttpUrl(cleanMediaUrl)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid media URL: upload media to CDN before publishing'
            });
        }

        const cleanCoverUrl = isValidHttpUrl(coverUrl) ? String(coverUrl).trim() : cleanMediaUrl;
        const normalizedType = normalizeMediaType(mediaType);
        const normalizedRatio = normalizeAspectRatio(aspectRatio);
        const normalizedDuration = normalizedType === 'PHOTO' ? 0 : normalizeDuration(durationSeconds);
        const cleanTrimStart = Math.max(0, Number(trimStartSec) || 0);
        const cleanTrimEnd = Math.max(cleanTrimStart, Math.min(30, Number(trimEndSec) || normalizedDuration || 30));

        // Authoritative user lookup strictly via verified Firebase Auth UID
        const userDoc = await User.findOne({ uid: userUid })
            .select('uid numericId name avatarUrl level gender')
            .lean();

        const finalUserName = (userDoc && userDoc.name) ? userDoc.name : 'Amison User';
        const finalAvatar = (userDoc && userDoc.avatarUrl) ? userDoc.avatarUrl : '';
        const finalNumericId = (userDoc && userDoc.numericId) ? userDoc.numericId : 0;
        const finalLevel = (userDoc && userDoc.level) ? userDoc.level : 1;
        const finalGender = (userDoc && userDoc.gender) ? userDoc.gender : 'Male';

        const cleanCaption = sanitizeText(caption, MAX_CAPTION_LENGTH);
        const cleanHashtags = sanitizeText(hashtags, MAX_HASHTAGS_LENGTH);
        const cleanDescription = sanitizeText(description, MAX_CAPTION_LENGTH + MAX_HASHTAGS_LENGTH) ||
            `${cleanCaption} ${cleanHashtags}`.trim();

        const finalReelId = sanitizeText(reelId, 80) || `post_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const created = await Reel.create({
            reelId: finalReelId,
            userUid,
            numericId: finalNumericId,
            userName: finalUserName,
            userAvatar: finalAvatar,
            userLevel: finalLevel,
            gender: finalGender,
            videoHlsUrl: cleanMediaUrl,
            coverUrl: cleanCoverUrl,
            mediaType: normalizedType,
            aspectRatio: normalizedRatio,
            durationSeconds: normalizedDuration,
            trimStartSec: cleanTrimStart,
            trimEndSec: cleanTrimEnd,
            caption: cleanCaption,
            hashtags: cleanHashtags,
            fullDescription: cleanDescription,
            musicTitle: sanitizeText(musicTitle, 120) || `Original Sound - ${finalUserName}`,
            musicCoverUrl: isValidHttpUrl(musicCoverUrl) ? String(musicCoverUrl).trim() : finalAvatar
        });

        console.log(`🎬 [ReelsAction] Published ${normalizedType} ${finalReelId} for ${userUid}`);
        return res.json({
            success: true,
            reel: {
                ...created.toObject(),
                isLiked: false,
                isFollowing: false,
                isOwnPost: true,
                timeAgo: 'Just now'
            }
        });
    } catch (err) {
        console.error('❌ [ReelsAction] POST /publish error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * DELETE /api/reels/:reelId
 */
async function deleteReel(req, res) {
    try {
        const reelId = sanitizeText(req.params.reelId, 80);
        const userUid = String(req.callerUid || '').trim();
        if (!reelId || !userUid) {
            return res.status(400).json({ success: false, error: 'Missing reelId or auth' });
        }

        const existing = await Reel.findOne({ reelId }).select('reelId userUid').lean();
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Reel not found' });
        }
        if (existing.userUid !== userUid) {
            return res.status(403).json({ success: false, error: 'Forbidden: You can only delete your own posts' });
        }

        await Promise.all([
            Reel.deleteOne({ reelId, userUid }),
            ReelLike.deleteMany({ reelId }),
            ReelComment.deleteMany({ reelId })
        ]);

        return res.json({ success: true, reelId });
    } catch (err) {
        console.error('❌ [ReelsAction] DELETE /:reelId error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * POST /api/reels/like (Atomic & Race-Safe)
 */
async function toggleLike(req, res) {
    try {
        const reelId = sanitizeText(req.body?.reelId, 80);
        const userUid = String(req.callerUid || '').trim();

        if (!reelId || !userUid) {
            return res.status(400).json({ success: false, error: 'Missing reelId or userUid' });
        }

        const targetReel = await Reel.findOne({ reelId }).select('reelId likesCount').lean();
        if (!targetReel) {
            return res.status(404).json({ success: false, error: 'Reel not found' });
        }

        // 1. Try atomic delete first (unlike path)
        const deleted = await ReelLike.findOneAndDelete({ reelId, userUid });
        if (deleted) {
            const updatedReel = await Reel.findOneAndUpdate(
                { reelId, likesCount: { $gt: 0 } },
                { $inc: { likesCount: -1 } },
                { new: true }
            ).lean();
            const likesCount = updatedReel ? Math.max(0, updatedReel.likesCount) : 0;
            return res.json({ success: true, reelId, likesCount, isLiked: false });
        }

        // 2. Otherwise atomic upsert (like path) so concurrent taps never double-increment
        const upsertResult = await ReelLike.updateOne(
            { reelId, userUid },
            { $setOnInsert: { reelId, userUid, createdAt: new Date() } },
            { upsert: true }
        );

        let likesCount = Math.max(0, Number(targetReel.likesCount) || 0);
        if (upsertResult.upsertedCount > 0) {
            const updatedReel = await Reel.findOneAndUpdate(
                { reelId },
                { $inc: { likesCount: 1 } },
                { new: true }
            ).lean();
            if (updatedReel) likesCount = Math.max(0, updatedReel.likesCount);
        }

        return res.json({ success: true, reelId, likesCount, isLiked: true });
    } catch (err) {
        console.error('❌ [ReelsAction] POST /like error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * POST /api/reels/comment
 */
async function postComment(req, res) {
    try {
        const reelId = sanitizeText(req.body?.reelId, 80);
        const commentText = sanitizeText(req.body?.commentText, MAX_COMMENT_LENGTH);
        const userUid = String(req.callerUid || '').trim();

        if (!reelId || !userUid || !commentText) {
            return res.status(400).json({ success: false, error: 'Missing reelId or commentText' });
        }

        const existingReel = await Reel.findOne({ reelId }).select('reelId').lean();
        if (!existingReel) {
            return res.status(404).json({ success: false, error: 'Reel not found' });
        }

        const userDoc = await User.findOne({ uid: userUid })
            .select('uid numericId name avatarUrl')
            .lean();

        const finalUserName = (userDoc && userDoc.name) ? userDoc.name : 'User';
        const finalAvatar = (userDoc && userDoc.avatarUrl) ? userDoc.avatarUrl : '';
        const finalNumericId = (userDoc && userDoc.numericId) ? userDoc.numericId : 0;

        const commentId = `comment_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const newComment = await ReelComment.create({
            commentId,
            reelId,
            userUid,
            numericId: finalNumericId,
            userName: finalUserName,
            userAvatar: finalAvatar,
            commentText
        });

        const updatedReel = await Reel.findOneAndUpdate(
            { reelId },
            { $inc: { commentsCount: 1 } },
            { new: true }
        ).lean();

        return res.json({
            success: true,
            comment: {
                ...newComment.toObject(),
                timeAgo: 'Just now'
            },
            commentsCount: updatedReel ? updatedReel.commentsCount : 1
        });
    } catch (err) {
        console.error('❌ [ReelsAction] POST /comment error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * GET /api/reels/comments/:reelId
 */
async function getComments(req, res) {
    try {
        const reelId = sanitizeText(req.params.reelId, 80);
        if (!reelId) {
            return res.status(400).json({ success: false, error: 'Missing reelId' });
        }

        const comments = await ReelComment.find({ reelId })
            .sort({ createdAt: -1 })
            .lean();

        const commentUserUids = [...new Set(comments.map(c => c.userUid).filter(Boolean))];
        const commentUserDocs = await User.find({ uid: { $in: commentUserUids } })
            .select('uid numericId name avatarUrl')
            .lean();
        const commentUserMap = new Map(commentUserDocs.map(u => [u.uid, u]));

        return res.json({
            success: true,
            reelId,
            comments: comments.map(c => {
                const u = commentUserMap.get(c.userUid);
                return {
                    commentId: c.commentId,
                    reelId: c.reelId,
                    userUid: c.userUid,
                    numericId: (u && u.numericId) ? u.numericId : c.numericId,
                    userName: (u && u.name) ? u.name : c.userName,
                    userAvatar: (u && u.avatarUrl) ? u.avatarUrl : c.userAvatar,
                    commentText: c.commentText,
                    createdAt: c.createdAt,
                    timeAgo: formatRelativeTime(c.createdAt)
                };
            })
        });
    } catch (err) {
        console.error('❌ [ReelsAction] GET /comments/:reelId error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    getUploadSignature,
    publishReel,
    deleteReel,
    toggleLike,
    postComment,
    getComments
};
