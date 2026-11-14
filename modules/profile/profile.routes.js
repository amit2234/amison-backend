const express = require('express');
const router = express.Router();
const { verifyAuthenticatedUser } = require('../../middleware/authMiddleware');

const readController = require('./controllers/profileRead.controller');
const socialController = require('./controllers/profileSocial.controller');

router.use(verifyAuthenticatedUser);

router.post('/badges', socialController.updateEquippedBadges);
router.post('/report', socialController.submitReport);
router.get('/:targetId/gifts', socialController.getGiftsWall);
router.get('/:targetId/supporters', socialController.getSupporters);
router.get('/:targetId', readController.getProfileSummary);

module.exports = router;
