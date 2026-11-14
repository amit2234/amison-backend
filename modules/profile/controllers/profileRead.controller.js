const profileService = require('../services/profileAggregate.service');

/**
 * GET /api/profile/:targetId
 * Single high-speed parallel endpoint returning complete User Profile summary.
 */
async function getProfileSummary(req, res) {
    try {
        const targetId = String(req.params.targetId || '').trim();
        const viewerUid = String(req.callerUid || req.query.viewerUid || '').trim();
        if (!targetId) {
            return res.status(400).json({ success: false, error: 'Missing targetId' });
        }

        const summary = await profileService.getProfileSummary(targetId, viewerUid);
        if (!summary) {
            return res.status(404).json({ success: false, error: 'User profile not found' });
        }

        return res.json({
            success: true,
            profile: summary
        });
    } catch (err) {
        console.error('❌ [ProfileRead] GET /:targetId error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    getProfileSummary
};
