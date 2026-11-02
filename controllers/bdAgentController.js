const BdAgentService = require('../services/bdAgentService');

class BdAgentController {
    /**
     * Get all BD Agents
     * GET /api/newop/bd-agents
     */
    static async getAllAgents(req, res) {
        try {
            const list = await BdAgentService.getAllAgents();
            return res.json({
                success: true,
                count: list.length,
                data: list
            });
        } catch (err) {
            console.error('❌ [BdAgentController] getAllAgents error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Assign a user as BD Agent
     * POST /api/newop/bd-agents/add
     */
    static async addAgent(req, res) {
        try {
            const { userId, numericId, name, phone, email, commissionPercent, monthlyTarget } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, error: 'userId is required' });
            }

            const agent = await BdAgentService.addAgent({
                userId,
                numericId,
                name,
                phone,
                email,
                commissionPercent,
                monthlyTarget,
                assignedBy: req.adminUser ? req.adminUser.uid : 'admin'
            });

            return res.json({
                success: true,
                message: `BD Agent ${agent.name} (${agent.numericId}) assigned successfully`,
                data: agent
            });
        } catch (err) {
            console.error('❌ [BdAgentController] addAgent error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Update BD Agent details
     * POST /api/newop/bd-agents/update
     */
    static async updateAgent(req, res) {
        try {
            const { userId, ...updateData } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, error: 'userId is required' });
            }

            const updated = await BdAgentService.updateAgent(userId, updateData);
            return res.json({
                success: true,
                message: 'BD Agent updated successfully',
                data: updated
            });
        } catch (err) {
            console.error('❌ [BdAgentController] updateAgent error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Remove / Delete a BD Agent
     * POST /api/newop/bd-agents/remove
     */
    static async removeAgent(req, res) {
        try {
            const userId = req.body.userId || req.params.userId;
            if (!userId) {
                return res.status(400).json({ success: false, error: 'userId is required' });
            }

            const deleted = await BdAgentService.removeAgent(userId);
            return res.json({
                success: true,
                message: 'BD Agent removed successfully',
                data: deleted
            });
        } catch (err) {
            console.error('❌ [BdAgentController] removeAgent error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
}

module.exports = BdAgentController;