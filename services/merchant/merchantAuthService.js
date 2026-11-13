const User = require('../../models/User');
const Merchant = require('../../models/Merchant');
const cacheService = require('../cacheService');
const { resolveUser } = require('../../utils/userResolver');

const merchantAuthService = {
    /**
     * Get all registered Merchants & Sellers for Newop Management
     */
    async getAllMerchants({ role, status } = {}) {
        const query = {};
        if (status) {
            query.status = status.toLowerCase();
        } else {
            query.status = { $ne: 'revoked' };
        }

        const merchants = await Merchant.find(query).sort({ updatedAt: -1 }).lean();
        
        const enriched = await Promise.all(merchants.map(async (m) => {
            const userDoc = await User.findOne({ uid: m.uid }).lean();
            return {
                ...m,
                userId: m.uid,
                numericId: userDoc ? userDoc.numericId : 'N/A',
                name: userDoc ? userDoc.name : 'Unknown Seller',
                avatarUrl: userDoc ? userDoc.avatarUrl : '',
                email: userDoc ? userDoc.email : '',
                level: userDoc ? userDoc.level : 1
            };
        }));

        if (role) {
            const roleLower = role.toLowerCase().includes('marchent') ? 'marchent' : 'seller';
            return enriched.filter(m => (m.role === roleLower) || (m.roleTagline || '').toLowerCase().includes(roleLower));
        }

        return enriched;
    },

    /**
     * Promote a user to Seller / Merchant role in MongoDB
     */
    async addOrUpdateMerchant({ userId, role = 'seller', roleTagline, dailyTransferLimit, assignedBy = 'Super Master' }) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) {
            throw new Error(`User not found with ID: ${userId}`);
        }

        const roleLower = String(role || 'seller').toLowerCase().includes('marchent') ? 'marchent' : 'seller';
        const defaultTagline = roleLower === 'marchent' ? 'Authorized Merchant' : 'Authorized Seller';
        const effectiveTagline = roleTagline || defaultTagline;
        const initialStock = roleLower === 'marchent' ? 100000 : 50000;
        const transferLimit = roleLower === 'marchent' ? 500000 : 50000;

        let assignerName = 'Super Master Admin';
        let assignerAvatar = '';
        if (assignedBy && assignedBy !== 'Super Master') {
            const assignerDoc = await resolveUser(assignedBy);
            if (assignerDoc) {
                assignerName = assignerDoc.name || 'Super Master Admin';
                assignerAvatar = assignerDoc.avatarUrl || '';
            }
        }

        const updated = await Merchant.findOneAndUpdate(
            { uid: userDoc.uid },
            {
                $set: {
                    uid: userDoc.uid,
                    role: roleLower,
                    roleTagline: effectiveTagline,
                    dailyTransferLimit: Number(dailyTransferLimit) || transferLimit,
                    status: 'active',
                    assignedByUid: String(assignedBy || ''),
                    assignedByName: assignerName,
                    assignedByAvatar: assignerAvatar,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    sellingStock: initialStock,
                    totalSold: 0,
                    dailyTransferredToday: 0,
                    createdAt: new Date()
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        await User.updateOne(
            { uid: userDoc.uid },
            {
                $set: {
                    isSeller: true,
                    isMerchant: roleLower === 'marchent',
                    sellerCenterRole: roleLower
                }
            }
        );

        try {
            const Message = require('../../models/Message');
            await Message.create({
                conversationId: `CONV_SYSTEM_${userDoc.uid}`,
                senderId: 'AMISON_OFFICIAL',
                recipientId: userDoc.uid,
                type: 'official_role_announcement',
                text: roleLower === 'marchent'
                    ? `Congratulations 🎉! You have been appointed as an official Merchant by ${assignerName}. Your dedicated Seller Stock is now active. Access Marchent Centre from your Me tab.`
                    : `Congratulations 🎉! You have been appointed as an official Seller by ${assignerName}. Your dedicated Seller Stock is now active. Access Seller Centre from your Me tab.`,
                metadata: {
                    assignedRole: roleLower,
                    promoterUid: String(assignedBy || ''),
                    promoterName: assignerName,
                    promoterAvatar: assignerAvatar,
                    stockAllocated: updated.sellingStock || initialStock
                },
                isRead: false
            });
        } catch (msgErr) {
            console.error('⚠️ [MerchantAuthService] Failed to create system notice message:', msgErr.message);
        }

        cacheService.emitToUser(userDoc.uid, {
            type: 'ROLE_AUTHORIZATION_CHANGED',
            role: roleLower,
            centerTitle: roleLower === 'marchent' ? 'Marchent Centre' : 'Seller Centre',
            stock: updated.sellingStock || initialStock,
            isAuthorized: true,
            timestamp: Date.now()
        });

        cacheService.emitToUser(userDoc.uid, {
            type: 'role:updated',
            role: roleLower,
            roleTagline: effectiveTagline,
            timestamp: Date.now()
        });

        const sysMessage = {
            type: 'dm:receive',
            messageId: `SYS_MSG_${Date.now()}`,
            conversationId: `CONV_SYSTEM_${userDoc.uid}`,
            senderId: 'AMISON_OFFICIAL',
            senderName: 'AMISON Official',
            senderAvatar: assignerAvatar || '',
            text: roleLower === 'marchent'
                ? `Congratulations 🎉! You have been appointed as an official Merchant by ${assignerName}. Your dedicated Seller Stock is now active. Access Marchent Centre from your Me tab.`
                : `Congratulations 🎉! You have been appointed as an official Seller by ${assignerName}. Your dedicated Seller Stock is now active. Access Seller Centre from your Me tab.`,
            messageType: 'official_announcement',
            timestamp: Date.now(),
            promotedBy: {
                name: assignerName,
                avatar: assignerAvatar
            },
            role: roleLower
        };
        cacheService.emitToUser(userDoc.uid, sysMessage);

        cacheService.broadcastToAll({
            type: 'NEWOP_LIST_UPDATED',
            user: {
                uid: userDoc.uid,
                numericId: userDoc.numericId,
                name: userDoc.name,
                avatarUrl: userDoc.avatarUrl,
                role: roleLower,
                sellingStock: updated.sellingStock || initialStock
            }
        });

        return {
            ...updated,
            userId: updated.uid,
            numericId: userDoc.numericId,
            name: userDoc.name,
            avatarUrl: userDoc.avatarUrl,
            email: userDoc.email,
            role: roleLower
        };
    },

    /**
     * Get user's current live Merchant/Seller authorization and status
     */
    async getMyMerchantStatus(userId) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) {
            return { isAuthorized: false, role: null, centerTitle: null, stock: 0 };
        }
        const merchant = await Merchant.findOne({ uid: userDoc.uid, status: 'active' }).lean();
        if (!merchant) {
            return { isAuthorized: false, role: null, centerTitle: null, stock: 0 };
        }
        const role = merchant.role || (merchant.roleTagline?.toLowerCase().includes('marchent') ? 'marchent' : 'seller');
        return {
            isAuthorized: true,
            role: role,
            centerTitle: role === 'marchent' ? 'Marchent Centre' : 'Seller Centre',
            stock: merchant.sellingStock || 0,
            assignedByName: merchant.assignedByName || 'Super Master Admin',
            assignedByAvatar: merchant.assignedByAvatar || ''
        };
    },

    /**
     * Revoke or remove Seller / Merchant role
     */
    async removeMerchant({ userId }) {
        const userDoc = await resolveUser(userId);
        const uid = userDoc ? userDoc.uid : String(userId).trim();

        return await Merchant.findOneAndUpdate(
            { uid },
            {
                $set: {
                    status: 'revoked',
                    updatedAt: new Date()
                }
            },
            { new: true }
        ).lean();
    },

    /**
     * Get details for single Merchant including live stock
     */
    async getMerchantDetails(userId) {
        const userDoc = await resolveUser(userId);
        if (!userDoc) return null;

        const merchant = await Merchant.findOne({ uid: userDoc.uid, status: { $ne: 'revoked' } }).lean();
        if (!merchant) return null;

        return {
            ...merchant,
            userId: userDoc.uid,
            numericId: userDoc.numericId,
            name: userDoc.name,
            avatarUrl: userDoc.avatarUrl,
            email: userDoc.email,
            level: userDoc.level
        };
    }
};

module.exports = merchantAuthService;
