const Agency = require('../models/Agency');
const AgencyHost = require('../models/AgencyHost');
const AgencySettlement = require('../models/AgencySettlement');
const BdAgent = require('../models/BdAgent');
const User = require('../models/User');

class AgencyService {
    /**
     * Get all registered agencies with optional filtering and search
     */
    static async getAllAgencies(query = {}) {
        const filter = {};
        if (query.search) {
            filter.$or = [
                { agencyName: { $regex: query.search, $options: 'i' } },
                { agencyId: { $regex: query.search, $options: 'i' } },
                { ownerNumericId: { $regex: query.search, $options: 'i' } },
                { ownerName: { $regex: query.search, $options: 'i' } }
            ];
        }
        if (query.status) {
            filter.status = query.status;
        }
        if (query.bdAgentId) {
            filter.bdAgentId = query.bdAgentId;
        }
        return await Agency.find(filter).sort({ createdAt: -1 });
    }

    /**
     * Create a new agency
     */
    static async createAgency({ agencyName, ownerNumericId, ownerUid, bdAgentId, bdAgentName, commissionPercent, monthlyTargetCoins, logoUrl, createdBy }) {
        if (!agencyName) {
            throw new Error('agencyName is required');
        }

        let resolvedOwnerUid = ownerUid || '';
        let resolvedOwnerNumericId = ownerNumericId ? String(ownerNumericId) : '';
        let resolvedOwnerName = '';
        let resolvedOwnerPhone = '';

        // Try to resolve user by ownerNumericId or ownerUid if available
        if (ownerNumericId || ownerUid) {
            const userFilter = ownerNumericId ? { numericId: Number(ownerNumericId) } : { uid: ownerUid };
            const user = await User.findOne(userFilter);
            if (user) {
                resolvedOwnerUid = user.uid;
                resolvedOwnerNumericId = String(user.numericId);
                resolvedOwnerName = user.name || '';
                
                // Update user role to agency_owner if appropriate
                user.role = 'agency_owner';
                await user.save();
            }
        }

        if (!resolvedOwnerNumericId) {
            resolvedOwnerNumericId = String(ownerNumericId || Math.floor(100000000 + Math.random() * 900000000));
        }
        if (!resolvedOwnerUid) {
            resolvedOwnerUid = `UID_AGY_OWNER_${resolvedOwnerNumericId}`;
        }

        // Generate unique agency code e.g. AGY_99812
        const randomNum = Math.floor(10000 + Math.random() * 90000);
        const agencyId = `AGY_${randomNum}`;

        let resolvedBdAgentName = bdAgentName || '';
        if (bdAgentId && !resolvedBdAgentName) {
            const bdAgent = await BdAgent.findOne({ $or: [{ userId: bdAgentId }, { numericId: bdAgentId }] });
            if (bdAgent) {
                resolvedBdAgentName = bdAgent.name;
                bdAgent.assignedAgenciesCount = (bdAgent.assignedAgenciesCount || 0) + 1;
                await bdAgent.save();
            }
        }

        const agency = new Agency({
            agencyId,
            agencyName,
            logoUrl: logoUrl || '',
            ownerUid: resolvedOwnerUid,
            ownerNumericId: resolvedOwnerNumericId,
            ownerName: resolvedOwnerName,
            ownerPhone: resolvedOwnerPhone,
            bdAgentId: bdAgentId || '',
            bdAgentName: resolvedBdAgentName,
            commissionPercent: commissionPercent !== undefined ? Number(commissionPercent) : 20.0,
            monthlyTargetCoins: monthlyTargetCoins ? Number(monthlyTargetCoins) : 50000000,
            status: 'Active',
            createdBy: createdBy || 'super_admin'
        });

        await agency.save();
        return agency;
    }

    /**
     * Update an agency record
     */
    static async updateAgency(agencyId, updateData) {
        const agency = await Agency.findOne({ agencyId });
        if (!agency) {
            throw new Error(`Agency ${agencyId} not found`);
        }

        // Check if BD Agent assignment changed to update counters
        if (updateData.bdAgentId !== undefined && updateData.bdAgentId !== agency.bdAgentId) {
            // Decrement old BD Agent count if existed
            if (agency.bdAgentId) {
                await BdAgent.updateOne(
                    { $or: [{ userId: agency.bdAgentId }, { numericId: agency.bdAgentId }] },
                    { $inc: { assignedAgenciesCount: -1 } }
                );
            }
            // Increment new BD Agent count if provided
            if (updateData.bdAgentId) {
                const newBd = await BdAgent.findOne({ $or: [{ userId: updateData.bdAgentId }, { numericId: updateData.bdAgentId }] });
                if (newBd) {
                    agency.bdAgentName = newBd.name;
                    newBd.assignedAgenciesCount = (newBd.assignedAgenciesCount || 0) + 1;
                    await newBd.save();
                }
            } else {
                agency.bdAgentName = '';
            }
        }

        if (updateData.agencyName) agency.agencyName = updateData.agencyName;
        if (updateData.logoUrl !== undefined) agency.logoUrl = updateData.logoUrl;
        if (updateData.commissionPercent !== undefined) agency.commissionPercent = Number(updateData.commissionPercent);
        if (updateData.monthlyTargetCoins !== undefined) agency.monthlyTargetCoins = Number(updateData.monthlyTargetCoins);
        if (updateData.status) agency.status = updateData.status;

        await agency.save();
        return agency;
    }

    /**
     * Block / Unblock agency
     */
    static async setAgencyStatus(agencyId, status) {
        const agency = await Agency.findOne({ agencyId });
        if (!agency) {
            throw new Error(`Agency ${agencyId} not found`);
        }
        agency.status = status;
        await agency.save();
        return agency;
    }

    /**
     * List hosts mapped under an agency
     */
    static async getAgencyHosts(agencyId) {
        return await AgencyHost.find({ agencyId, status: 'Active' }).sort({ joinedAt: -1 });
    }

    /**
     * Add host to agency
     */
    static async addHostToAgency({ agencyId, hostNumericId, hostUid, hostName, hostAvatar }) {
        const agency = await Agency.findOne({ agencyId });
        if (!agency) {
            throw new Error(`Agency ${agencyId} not found`);
        }

        let resolvedUid = hostUid || '';
        let resolvedNumericId = hostNumericId ? String(hostNumericId) : '';
        let resolvedName = hostName || '';
        let resolvedAvatar = hostAvatar || '';

        if (hostNumericId || hostUid) {
            const userFilter = hostNumericId ? { numericId: Number(hostNumericId) } : { uid: hostUid };
            const user = await User.findOne(userFilter);
            if (user) {
                resolvedUid = user.uid;
                resolvedNumericId = String(user.numericId);
                resolvedName = user.name || resolvedName;
                resolvedAvatar = user.avatarUrl || resolvedAvatar;
            }
        }

        if (!resolvedUid) {
            throw new Error('Host user identity could not be resolved');
        }

        let existingMapping = await AgencyHost.findOne({ hostUid: resolvedUid });
        if (existingMapping) {
            if (existingMapping.agencyId === agencyId && existingMapping.status === 'Active') {
                return existingMapping;
            }
            // Re-assign to new agency
            existingMapping.agencyId = agencyId;
            existingMapping.status = 'Active';
            existingMapping.hostName = resolvedName;
            existingMapping.hostAvatar = resolvedAvatar;
            existingMapping.hostNumericId = resolvedNumericId;
            await existingMapping.save();
        } else {
            existingMapping = new AgencyHost({
                agencyId,
                hostUid: resolvedUid,
                hostNumericId: resolvedNumericId,
                hostName: resolvedName,
                hostAvatar: resolvedAvatar,
                status: 'Active'
            });
            await existingMapping.save();
        }

        // Update host count on Agency
        const count = await AgencyHost.countDocuments({ agencyId, status: 'Active' });
        agency.totalHostsCount = count;
        await agency.save();

        return existingMapping;
    }

    /**
     * Kick host from agency
     */
    static async removeHostFromAgency(agencyId, hostUid) {
        const mapping = await AgencyHost.findOne({ agencyId, hostUid });
        if (!mapping) {
            throw new Error(`Host ${hostUid} not mapped under agency ${agencyId}`);
        }
        mapping.status = 'Kicked';
        await mapping.save();

        const count = await AgencyHost.countDocuments({ agencyId, status: 'Active' });
        await Agency.updateOne({ agencyId }, { totalHostsCount: count });

        return mapping;
    }

    /**
     * Gifting commission propagation engine
     */
    static async processGiftingCommission(hostUid, giftingCoins) {
        if (!giftingCoins || giftingCoins <= 0) return null;

        const hostMapping = await AgencyHost.findOne({ hostUid, status: 'Active' });
        if (!hostMapping) return null;

        const agency = await Agency.findOne({ agencyId: hostMapping.agencyId, status: 'Active' });
        if (!agency) return null;

        // Add coins to host gifting record & agency current month progress
        hostMapping.totalGiftingReceived += giftingCoins;
        await hostMapping.save();

        agency.currentMonthCoins += giftingCoins;
        // Calculate earnings in USD (assuming standard coin to USD rate e.g. 1M coins = $100 base * commission %)
        const commissionCoins = (giftingCoins * agency.commissionPercent) / 100;
        agency.totalEarningsUsd += commissionCoins / 10000;
        await agency.save();

        // Propagate to linked BD Agent if present
        if (agency.bdAgentId) {
            const bdAgent = await BdAgent.findOne({ $or: [{ userId: agency.bdAgentId }, { numericId: agency.bdAgentId }], status: 'Active' });
            if (bdAgent) {
                bdAgent.currentMonthAchieved = (bdAgent.currentMonthAchieved || 0) + giftingCoins;
                await bdAgent.save();
            }
        }

        return {
            agencyId: agency.agencyId,
            commissionCoins,
            currentMonthCoins: agency.currentMonthCoins
        };
    }
}

module.exports = AgencyService;
