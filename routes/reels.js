const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const Reel = require('../models/Reel');
const ReelLike = require('../models/ReelLike');
const ReelComment = require('../models/ReelComment');
const User = require('../models/User');

// Configure Cloudinary from env variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 1. GET UPLOAD SIGNATURE FOR MOBILE APP DIRECT UPLOAD
router.get('/upload-signature', (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const paramsToSign = {
      timestamp: timestamp,
      folder: 'amison_reels',
      eager: 'sp_auto/m3u8',
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.json({
      success: true,
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
  } catch (err) {
    console.error("GET /upload-signature error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET REELS FEED (/api/reels/feed?page=0)
router.get('/feed', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 10;
    const skip = page * limit;

    const reels = await Reel.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      page,
      reels: reels.map(item => ({
        reelId: item.reelId,
        userUid: item.userUid,
        numericId: item.numericId,
        userName: item.userName,
        userAvatar: item.userAvatar,
        userLevel: item.userLevel,
        gender: item.gender,
        videoHlsUrl: item.videoHlsUrl,
        coverUrl: item.coverUrl,
        mediaType: item.mediaType,
        caption: item.caption,
        hashtags: item.hashtags,
        fullDescription: item.fullDescription,
        likesCount: item.likesCount,
        commentsCount: item.commentsCount,
        createdAt: item.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /feed error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. GET USER REELS & PHOTOS (/api/reels/user/:userUid)
router.get('/user/:userUid', async (req, res) => {
  try {
    const { userUid } = req.params;
    const reels = await Reel.find({ userUid, isPublished: true })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      userUid,
      count: reels.length,
      reels: reels.map(item => ({
        reelId: item.reelId,
        userUid: item.userUid,
        numericId: item.numericId,
        userName: item.userName,
        userAvatar: item.userAvatar,
        userLevel: item.userLevel,
        gender: item.gender,
        videoHlsUrl: item.videoHlsUrl,
        coverUrl: item.coverUrl,
        mediaType: item.mediaType,
        caption: item.caption,
        hashtags: item.hashtags,
        fullDescription: item.fullDescription,
        likesCount: item.likesCount,
        commentsCount: item.commentsCount,
        createdAt: item.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /user/:userUid error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUBLISH NEW REEL POST (/api/reels/publish)
router.post('/publish', async (req, res) => {
  try {
    const {
      reelId,
      userUid,
      numericId,
      userName,
      userAvatar,
      userLevel,
      gender,
      videoHlsUrl,
      coverUrl,
      mediaType,
      caption,
      hashtags,
      description
    } = req.body;

    if (!userUid || !videoHlsUrl) {
      return res.status(400).json({ success: false, error: 'Missing userUid or videoHlsUrl' });
    }

    // Lookup user in existing Users collection to keep stats aligned
    const userDoc = await User.findOne({ $or: [{ uid: userUid }, { numericId: parseInt(numericId) || 0 }] });
    const finalUserName = userName || (userDoc ? userDoc.name : 'Amit');
    const finalAvatar = userAvatar || (userDoc ? userDoc.avatarUrl : '');
    const finalNumericId = numericId || (userDoc ? userDoc.numericId : 102030);

    const finalReelId = reelId || `post_${Date.now()}`;
    const fullDesc = description || `@${finalUserName} ${caption || ''} ${hashtags || ''}`.trim();

    const newReel = await Reel.create({
      reelId: finalReelId,
      userUid: userUid,
      numericId: finalNumericId,
      userName: finalUserName,
      userAvatar: finalAvatar,
      userLevel: userLevel || (userDoc ? userDoc.level : 1),
      gender: gender || (userDoc ? userDoc.gender : 'Male'),
      videoHlsUrl: videoHlsUrl,
      coverUrl: coverUrl || videoHlsUrl,
      mediaType: mediaType || 'VIDEO',
      caption: caption || '',
      hashtags: hashtags || '',
      fullDescription: fullDesc
    });

    console.log(`🎬 [Reels] Published new reel ${finalReelId} for user ${userUid}`);
    return res.json({ success: true, reel: newReel });
  } catch (err) {
    console.error("POST /publish error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. TOGGLE LIKE REEL (/api/reels/like)
router.post('/like', async (req, res) => {
  try {
    const { reelId, userUid } = req.body;

    if (!reelId || !userUid) {
      return res.status(400).json({ success: false, error: 'Missing reelId or userUid' });
    }

    let isLiked = false;
    let newLikesCount = 0;

    const existingLike = await ReelLike.findOne({ reelId, userUid });
    if (existingLike) {
      await ReelLike.deleteOne({ _id: existingLike._id });
      const updatedReel = await Reel.findOneAndUpdate(
        { reelId },
        { $inc: { likesCount: -1 } },
        { new: true }
      );
      newLikesCount = Math.max(0, updatedReel ? updatedReel.likesCount : 0);
      isLiked = false;
    } else {
      await ReelLike.create({ reelId, userUid });
      const updatedReel = await Reel.findOneAndUpdate(
        { reelId },
        { $inc: { likesCount: 1 } },
        { new: true }
      );
      newLikesCount = updatedReel ? updatedReel.likesCount : 1;
      isLiked = true;
    }

    return res.json({ success: true, reelId, likesCount: newLikesCount, isLiked });
  } catch (err) {
    console.error("POST /like error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST A COMMENT (/api/reels/comment)
router.post('/comment', async (req, res) => {
  try {
    const { reelId, userUid, commentText, userName, userAvatar, numericId } = req.body;

    if (!reelId || !userUid || !commentText) {
      return res.status(400).json({ success: false, error: 'Missing reelId, userUid, or commentText' });
    }

    const userDoc = await User.findOne({ uid: userUid });
    const finalUserName = userName || (userDoc ? userDoc.name : 'User');
    const finalAvatar = userAvatar || (userDoc ? userDoc.avatarUrl : '');
    const finalNumericId = numericId || (userDoc ? userDoc.numericId : 0);

    const commentId = `comment_${Date.now()}_${Math.floor(Math.random()*1000)}`;

    const newComment = await ReelComment.create({
      commentId,
      reelId,
      userUid,
      numericId: finalNumericId,
      userName: finalUserName,
      userAvatar: finalAvatar,
      commentText
    });

    // Increment comment count on Reel
    const updatedReel = await Reel.findOneAndUpdate(
      { reelId },
      { $inc: { commentsCount: 1 } },
      { new: true }
    );

    return res.json({
      success: true,
      comment: newComment,
      commentsCount: updatedReel ? updatedReel.commentsCount : 1
    });
  } catch (err) {
    console.error("POST /comment error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. GET COMMENTS FOR A REEL (/api/reels/comments/:reelId)
router.get('/comments/:reelId', async (req, res) => {
  try {
    const { reelId } = req.params;
    const comments = await ReelComment.find({ reelId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      reelId,
      comments: comments.map(c => ({
        commentId: c.commentId,
        reelId: c.reelId,
        userUid: c.userUid,
        numericId: c.numericId,
        userName: c.userName,
        userAvatar: c.userAvatar,
        commentText: c.commentText,
        createdAt: c.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /comments/:reelId error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
