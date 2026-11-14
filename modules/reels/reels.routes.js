const express = require('express');
const router = express.Router();
const { verifyAuthenticatedUser } = require('../../middleware/authMiddleware');

const feedController = require('./controllers/reelsFeed.controller');
const actionController = require('./controllers/reelsAction.controller');

router.use(verifyAuthenticatedUser);

router.get('/upload-signature', actionController.getUploadSignature);
router.get('/feed', feedController.getFeed);
router.get('/user/:userUid', feedController.getUserReels);
router.post('/publish', actionController.publishReel);
router.delete('/:reelId', actionController.deleteReel);
router.post('/like', actionController.toggleLike);
router.post('/comment', actionController.postComment);
router.get('/comments/:reelId', actionController.getComments);

module.exports = router;