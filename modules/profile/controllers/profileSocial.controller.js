const User = require('../../../models/User');
const UserReport = require('../../../models/UserReport');
const profileService = require('../services/profileAggregate.service');
const { MAX_EQUIPPED_BADGES, ALLOWED_REPORT_REASONS } = require('../profile.constants');

/**
 * GET /api/profile/:targetId/gifts
 */
async function getGiftsWall(req, res) {
    try {
        const targetId = String(req.params.targetId || '').trim();
        const gifts = await profileService.getReceivedGifts(targetId);
        return res.json({ success: true, gifts });
    } catch (err) {
        console.error('❌ [ProfileSocial] GET /gifts error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * GET /api/profile/:targetId/supporters
 */
async function getSupporters(req, res) {
    try {
        const targetId = String(req.params.targetId || '').trim();
        const limit = Number(req.query.limit) || 50;
        const supporters = await profileService.getSupportersLeaderboard(targetId, limit);
        return res.json({ success: true, supporters });
    } catch (err) {
        console.error('❌ [ProfileSocial] GET /supporters error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * POST /api/profile/badges
 * Saves caller's equipped badges (up to 3) directly to MongoDB User.
 */
async function updateEquippedBadges(req, res) {
    try {
        const callerUid = String(req.callerUid || '').trim();
        const { badgeIds } = req.body || {};
        if (!callerUid) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const cleanIds = Array.isArray(badgeIds)
            ? badgeIds.map(id => String(id || '').trim()).filter(Boolean).slice(0, MAX_EQUIPPED_BADGES)
            : [];

        const updated = await User.findOneAndUpdate(
            { uid: callerUid },
            { $set: { equippedBadges: cleanIds, updatedAt: new Date() } },
            { new: true }
        ).select('equippedBadges').lean();

        return res.json({
            success: true,
            equippedBadges: updated?.equippedBadges || cleanIds
        });
    } catch (err) {
        console.error('❌ [ProfileSocial] POST /badges error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

/**
 * POST /api/profile/report
 * Submits a real safety report to MongoDB user_reports collection.
 */
async function submitReport(req, res) {
    try {
        const reporterUid = String(req.callerUid || '').trim();
        const { targetId, reason, details } = req.body || {};
        if (!reporterUid || !targetId) {
            return res.status(400).json({ success: false, error: 'Missing reporter or target user ID' });
        }

        const targetDoc = await profileService.resolveUserDocument(targetId);
        const targetUid = targetDoc ? targetDoc.uid : String(targetId).trim();
        if (targetUid === reporterUid) {
            return res.status(400).json({ success: false, error: 'Cannot report your own profile' });
        }

        const cleanReason = String(reason || '').trim();
        const validReason = ALLOWED_REPORT_REASONS.includes(cleanReason) ? cleanReason : 'Other';

        const report = new UserReport({
            reporterUid,
            targetUid,
            reason: validReason,
            details: String(details || '').trim().slice(0, 500)
        });
        await report.save();

        return res.status(201).json({
            success: true,
            reportId: String(report._id),
            message: 'Report submitted successfully. Our safety team will review it.'
        });
    } catch (err) {
        console.error('❌ [ProfileSocial] POST /report error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    getGiftsWall,
    getSupporters,
    updateEquippedBadges,
    submitReport
};
