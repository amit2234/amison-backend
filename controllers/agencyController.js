const AgencyService = require('../services/agencyService');

class AgencyController {
    /**
     * Get all agencies
     * GET /api/newop/agencies
     */
    static async getAllAgencies(req, res) {
        try {
            const list = await AgencyService.getAllAgencies(req.query);
            return res.json({
                success: true,
                count: list.length,
                data: list
            });
        } catch (err) {
            console.error('❌ [AgencyController] getAllAgencies error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Create new agency
     * POST /api/newop/agencies/create
     */
    static async createAgency(req, res) {
        try {
            const { agencyName, ownerNumericId, ownerUid, bdAgentId, bdAgentName, commissionPercent, monthlyTargetCoins, logoUrl } = req.body;
            if (!agencyName) {
                return res.status(400).json({ success: false, error: 'agencyName is required' });
            }

            const agency = await AgencyService.createAgency({
                agencyName,
                ownerNumericId,
                ownerUid,
                bdAgentId,
                bdAgentName,
                commissionPercent,
                monthlyTargetCoins,
                logoUrl,
                createdBy: req.adminUser ? req.adminUser.uid : 'super_admin'
            });

            return res.json({
                success: true,
                message: `Agency '${agency.agencyName}' (${agency.agencyId}) created successfully`,
                data: agency
            });
        } catch (err) {
            console.error('❌ [AgencyController] createAgency error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Update agency
     * POST /api/newop/agencies/update
     */
    static async updateAgency(req, res) {
        try {
            const { agencyId, ...updateData } = req.body;
            if (!agencyId) {
                return res.status(400).json({ success: false, error: 'agencyId is required' });
            }

            const updated = await AgencyService.updateAgency(agencyId, updateData);
            return res.json({
                success: true,
                message: 'Agency updated successfully',
                data: updated
            });
        } catch (err) {
            console.error('❌ [AgencyController] updateAgency error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Block / Unblock agency
     * POST /api/newop/agencies/block
     */
    static async blockAgency(req, res) {
        try {
            const { agencyId, status } = req.body;
            if (!agencyId) {
                return res.status(400).json({ success: false, error: 'agencyId is required' });
            }

            const newStatus = status || 'Blocked';
            const updated = await AgencyService.setAgencyStatus(agencyId, newStatus);
            return res.json({
                success: true,
                message: `Agency status changed to ${newStatus}`,
                data: updated
            });
        } catch (err) {
            console.error('❌ [AgencyController] blockAgency error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Get hosts under specific agency
     * GET /api/newop/agencies/:id/hosts
     */
    static async getAgencyHosts(req, res) {
        try {
            const agencyId = req.params.id;
            const hosts = await AgencyService.getAgencyHosts(agencyId);
            return res.json({
                success: true,
                count: hosts.length,
                data: hosts
            });
        } catch (err) {
            console.error('❌ [AgencyController] getAgencyHosts error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Add host to agency
     * POST /api/newop/agencies/hosts/add
     */
    static async addHost(req, res) {
        try {
            const { agencyId, hostNumericId, hostUid, hostName, hostAvatar } = req.body;
            if (!agencyId || (!hostNumericId && !hostUid)) {
                return res.status(400).json({ success: false, error: 'agencyId and host numericId/uid are required' });
            }

            const hostMapping = await AgencyService.addHostToAgency({
                agencyId,
                hostNumericId,
                hostUid,
                hostName,
                hostAvatar
            });

            return res.json({
                success: true,
                message: `Host assigned to agency ${agencyId} successfully`,
                data: hostMapping
            });
        } catch (err) {
            console.error('❌ [AgencyController] addHost error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Remove / Kick host from agency
     * POST /api/newop/agencies/hosts/remove
     */
    static async removeHost(req, res) {
        try {
            const { agencyId, hostUid } = req.body;
            if (!agencyId || !hostUid) {
                return res.status(400).json({ success: false, error: 'agencyId and hostUid are required' });
            }

            const removed = await AgencyService.removeHostFromAgency(agencyId, hostUid);
            return res.json({
                success: true,
                message: 'Host removed from agency successfully',
                data: removed
            });
        } catch (err) {
            console.error('❌ [AgencyController] removeHost error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
}

module.exports = AgencyController;