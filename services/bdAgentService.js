const BdAgent = require('../models/BdAgent');
const User = require('../models/User');

class BdAgentService {
    /**
     * Get all BD Agents
     */
    static async getAllAgents() {
        return BdAgent.find().sort({ createdAt: -1 }).lean();
    }

    /**
     * Add / Assign a user as BD Agent
     */
    static async addAgent({ userId, numericId = '', name = '', phone = '', email = '', commissionPercent = 5.0, monthlyTarget = 10000000, assignedBy = 'admin' }) {
        if (!userId) {
            throw new Error('User ID / UID is required');
        }

        // Check if user exists in User collection
        let resolvedUser = await User.findOne({
            $or: [{ uid: userId }, { numericId: userId }, { id: userId }]
        }).lean();

        const canonicalUid = resolvedUser ? (resolvedUser.uid || resolvedUser.id) : userId;
        const displayId = resolvedUser ? (resolvedUser.numericId || resolvedUser.id) : (numericId || userId);
        const resolvedName = (resolvedUser && resolvedUser.name) ? resolvedUser.name : (name || `BD Agent ${displayId}`);
        const avatar = (resolvedUser && resolvedUser.profilePhoto) ? resolvedUser.profilePhoto : '';

        const agent = await BdAgent.findOneAndUpdate(
            { userId: canonicalUid },
            {
                $set: {
                    userId: canonicalUid,
                    numericId: displayId,
                    name: resolvedName,
                    avatar,
                    phone: phone || (resolvedUser && resolvedUser.phone) || '',
                    email: email || (resolvedUser && resolvedUser.email) || '',
                    status: 'Active',
                    commissionPercent: Number(commissionPercent) || 5.0,
                    monthlyTarget: Number(monthlyTarget) || 10000000,
                    assignedBy
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`✅ [BdAgentService] Assigned BD Agent: ${canonicalUid} (${resolvedName})`);
        return agent;
    }

    /**
     * Update BD Agent details
     */
    static async updateAgent(userId, updateData) {
        const allowed = {};
        if (updateData.status) allowed.status = updateData.status;
        if (updateData.commissionPercent !== undefined) allowed.commissionPercent = Number(updateData.commissionPercent);
        if (updateData.monthlyTarget !== undefined) allowed.monthlyTarget = Number(updateData.monthlyTarget);
        if (updateData.phone !== undefined) allowed.phone = updateData.phone;
        if (updateData.email !== undefined) allowed.email = updateData.email;

        const updated = await BdAgent.findOneAndUpdate(
            { $or: [{ userId }, { numericId: userId }] },
            { $set: allowed },
            { new: true }
        );

        return updated;
    }

    /**
     * Remove / Deactivate a BD Agent
     */
    static async removeAgent(userId) {
        return BdAgent.findOneAndDelete({
            $or: [{ userId }, { numericId: userId }]
        });
    }
}

module.exports = BdAgentService;
