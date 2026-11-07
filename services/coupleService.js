const mongoose = require('mongoose');
const CouplePartner = require('../models/CouplePartner');
const CoupleInvitation = require('../models/CoupleInvitation');
const Message = require('../models/Message');
const User = require('../models/User');
const cacheService = require('./cacheService');

const COOLDOWN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

const CP_LEVELS = [
    { level: 1, minXp: 0, maxXp: 1000, title: 'Lv.1 New Romance' },
    { level: 2, minXp: 1000, maxXp: 2000, title: 'Lv.2 Sweet Companion' },
    { level: 3, minXp: 2000, maxXp: 4000, title: 'Lv.3 Harmonious Bond' },
    { level: 4, minXp: 4000, maxXp: 8000, title: 'Lv.4 True Devotion' },
    { level: 5, minXp: 8000, maxXp: 16000, title: 'Lv.5 Radiant Pair' },
    { level: 6, minXp: 16000, maxXp: 32000, title: 'Lv.6 Silver Romance' },
    { level: 7, minXp: 32000, maxXp: 64000, title: 'Lv.7 Golden Promise' },
    { level: 8, minXp: 64000, maxXp: 128000, title: 'Lv.8 Eternal Symphony' },
    { level: 9, minXp: 128000, maxXp: 256000, title: 'Lv.9 Celestial Harmony' },
    { level: 10, minXp: 256000, maxXp: 999999999, title: 'Lv.10 Crowned Soulmates' }
];

function calculateCpLevel(xp) {
    const safeXp = Math.max(0, Number(xp) || 0);
    for (const lvl of CP_LEVELS) {
        if (safeXp >= lvl.minXp && safeXp < lvl.maxXp) {
            return lvl.level;
        }
    }
    return 10;
}

function getDeterministicBondId(uidA, uidB) {
    const a = String(uidA || '').trim();
    const b = String(uidB || '').trim();
    return a < b ? `cp_${a}_${b}` : `cp_${b}_${a}`;
}

const coupleService = {
    /**
     * Get active bond for user (Redis First, then MongoDB)
     */
    async getActiveBond(userId) {
        if (!userId) return null;
        const cleanUid = String(userId).trim();

        // 1. Check Redis / RAM cache
        const cached = await cacheService.getCachedCoupleBond(cleanUid);
        if (cached) {
            return cached;
        }

        // 2. Query MongoDB
        const doc = await CouplePartner.findOne({
            $or: [{ userAId: cleanUid }, { userBId: cleanUid }],
            status: 'ACTIVE'
        }).lean();

        if (doc) {
            // Determine partner info relative to this user
            const isUserA = doc.userAId === cleanUid;
            const partner = isUserA ? doc.userB : doc.userA;
            const connectedMillis = new Date(doc.connectedAt).getTime();
            const formatted = {
                bondId: doc.bondId,
                myUid: cleanUid,
                partnerUid: partner.uid,
                partnerName: partner.name,
                partnerAvatar: partner.avatar,
                partnerDisplayId: partner.displayId,
                partnerGender: partner.gender,
                userAId: doc.userAId,
                userAName: doc.userA ? doc.userA.name : '',
                userAAvatar: doc.userA ? doc.userA.avatar : '',
                userBId: doc.userBId,
                userBName: doc.userB ? doc.userB.name : '',
                userBAvatar: doc.userB ? doc.userB.avatar : '',
                totalXp: doc.totalXp,
                level: doc.level,
                affectionScore: doc.affectionScore,
                connectedAt: doc.connectedAt,
                connectedAtMillis: connectedMillis,
                daysTogether: Math.max(1, Math.floor((Date.now() - connectedMillis) / (24 * 60 * 60 * 1000))),
                status: doc.status
            };

            // Seed cache for both users
            await cacheService.syncCoupleBondCache(cleanUid, formatted);
            return formatted;
        }

        return null;
    },

    /**
     * Send CP invitation from User A to User B
     */
    async sendInvitation({ senderId, receiverId, proposalText }) {
        const cleanSender = String(senderId || '').trim();
        const cleanReceiver = String(receiverId || '').trim();

        if (!cleanSender || !cleanReceiver || cleanSender === cleanReceiver) {
            throw new Error('Invalid sender or receiver ID');
        }

        // 1. Verify Sender has no active CP
        const senderExisting = await this.getActiveBond(cleanSender);
        if (senderExisting) {
            throw new Error('You already have an active Couple Partner.');
        }

        // 2. Verify Receiver has no active CP
        const receiverExisting = await this.getActiveBond(cleanReceiver);
        if (receiverExisting) {
            throw new Error('Target user already has an active Couple Partner.');
        }

        // 3. Fetch user profiles from MongoDB using UID primary key
        const senderDoc = await User.findOne({ $or: [{ uid: cleanSender }, { numericId: Number(cleanSender) || 0 }] }).lean() || {};
        const receiverDoc = await User.findOne({ $or: [{ uid: cleanReceiver }, { numericId: Number(cleanReceiver) || 0 }] }).lean() || {};

        const senderGender = String(senderDoc.gender || 'Male').toLowerCase();
        const receiverGender = String(receiverDoc.gender || 'Female').toLowerCase();

        // Opposite gender validation check
        const isSenderMale = senderGender.includes('male') && !senderGender.includes('female');
        const isSenderFemale = senderGender.includes('female');
        const isReceiverMale = receiverGender.includes('male') && !receiverGender.includes('female');
        const isReceiverFemale = receiverGender.includes('female');

        if ((isSenderMale && isReceiverMale) || (isSenderFemale && isReceiverFemale)) {
            throw new Error('Couple Partner bond can only be formed between opposite genders.');
        }

        // 4. Check for active pending invitation between these two users
        const pendingInvite = await CoupleInvitation.findOne({
            senderId: cleanSender,
            receiverId: cleanReceiver,
            status: 'PENDING',
            expiresAt: { $gt: new Date() }
        }).lean();

        if (pendingInvite) {
            throw new Error('An active invitation is already pending for this user.');
        }

        // 5. Create Invitation document
        const now = Date.now();
        const invitationId = `cp_inv_${now}_${Math.random().toString(36).substring(2, 8)}`;
        const expiresAt = new Date(now + COOLDOWN_DURATION_MS);

        const senderProfile = {
            name: senderDoc.name || 'Amison User',
            avatar: senderDoc.avatar || senderDoc.photoUrl || '',
            displayId: senderDoc.numericId || senderDoc.displayUserId || '',
            gender: senderDoc.gender || 'Male'
        };

        const receiverProfile = {
            name: receiverDoc.name || 'Amison User',
            avatar: receiverDoc.avatar || receiverDoc.photoUrl || '',
            displayId: receiverDoc.numericId || receiverDoc.displayUserId || '',
            gender: receiverDoc.gender || 'Female'
        };

        const invitation = await CoupleInvitation.create({
            invitationId,
            senderId: cleanSender,
            receiverId: cleanReceiver,
            senderProfile,
            receiverProfile,
            status: 'PENDING',
            proposalText: proposalText || 'Would you like to be my Couple Partner on Amison?',
            createdAt: new Date(now),
            expiresAt
        });

        // 6. Dispatch Official Notice to User B's Inbox via AMISON_OFFICIAL
        const convId = `conv_amison_official_${cleanReceiver}`;
        await Message.create({
            conversationId: convId,
            senderId: 'AMISON_OFFICIAL',
            recipientId: cleanReceiver,
            text: `💕 Couple Partner Proposal: ${senderProfile.name} has invited you to become Couple Partners!`,
            type: 'official_couple_invite',
            metadata: {
                invitationId,
                senderUid: cleanSender,
                senderName: senderProfile.name,
                senderAvatar: senderProfile.avatar,
                proposalText: proposalText || 'Would you like to be my Couple Partner on Amison?'
            },
            isRead: false,
            createdAt: new Date()
        });

        // Increment unread count in cache
        await cacheService.incrementUnread(cleanReceiver, convId);

        // 7. Emit WebSocket event to User B if online
        cacheService.emitToUser(cleanReceiver, {
            type: 'couple:invite_received',
            invitation: {
                invitationId,
                senderId: cleanSender,
                senderProfile,
                proposalText: invitation.proposalText,
                expiresAt
            }
        });

        return {
            success: true,
            message: 'Couple Partner invitation sent successfully via Amison Official System.',
            invitationId
        };
    },

    /**
     * Respond to Invitation: Accept or Reject
     */
    async respondToInvitation({ invitationId, userId, accept }) {
        const cleanUid = String(userId || '').trim();
        const cleanInvId = String(invitationId || '').trim();

        if (!cleanUid || !cleanInvId) {
            throw new Error('Missing invitationId or userId');
        }

        const invite = await CoupleInvitation.findOne({ invitationId: cleanInvId });
        if (!invite) {
            throw new Error('Invitation not found');
        }

        if (invite.receiverId !== cleanUid) {
            throw new Error('Unauthorized to respond to this invitation');
        }

        if (invite.status !== 'PENDING') {
            throw new Error(`Invitation already ${invite.status.toLowerCase()}`);
        }

        if (new Date() > new Date(invite.expiresAt)) {
            invite.status = 'EXPIRED';
            await invite.save();
            throw new Error('Invitation has expired');
        }

        const senderUid = invite.senderId;
        const receiverUid = invite.receiverId;

        if (!accept) {
            // REJECT
            invite.status = 'REJECTED';
            await invite.save();

            // Notify sender via Official System Message & WebSocket
            await Message.create({
                conversationId: `conv_amison_official_${senderUid}`,
                senderId: 'AMISON_OFFICIAL',
                recipientId: senderUid,
                text: `Notice: Your Couple Partner invitation to ${invite.receiverProfile.name} was declined.`,
                type: 'official_notice',
                isRead: false,
                createdAt: new Date()
            });

            cacheService.emitToUser(senderUid, {
                type: 'couple:invite_rejected',
                invitationId: cleanInvId,
                partnerName: invite.receiverProfile.name
            });

            return { success: true, status: 'REJECTED' };
        }

        // ACCEPT
        // Acquire Mutex Lock to prevent double-bonding race conditions
        return await cacheService.withUserLock(cleanUid, async () => {
            // Re-check both users for active bonds
            const senderActive = await CouplePartner.findOne({
                $or: [{ userAId: senderUid }, { userBId: senderUid }],
                status: 'ACTIVE'
            });
            if (senderActive) {
                invite.status = 'EXPIRED';
                await invite.save();
                throw new Error('The inviting user is already in another couple bond.');
            }

            const receiverActive = await CouplePartner.findOne({
                $or: [{ userAId: receiverUid }, { userBId: receiverUid }],
                status: 'ACTIVE'
            });
            if (receiverActive) {
                invite.status = 'EXPIRED';
                await invite.save();
                throw new Error('You already have an active couple partner.');
            }

            // Create CouplePartner bond
            const bondId = getDeterministicBondId(senderUid, receiverUid);
            const isSenderA = senderUid < receiverUid;

            const userAData = isSenderA ? {
                uid: senderUid,
                displayId: invite.senderProfile.displayId,
                name: invite.senderProfile.name,
                avatar: invite.senderProfile.avatar,
                gender: invite.senderProfile.gender
            } : {
                uid: receiverUid,
                displayId: invite.receiverProfile.displayId,
                name: invite.receiverProfile.name,
                avatar: invite.receiverProfile.avatar,
                gender: invite.receiverProfile.gender
            };

            const userBData = isSenderA ? {
                uid: receiverUid,
                displayId: invite.receiverProfile.displayId,
                name: invite.receiverProfile.name,
                avatar: invite.receiverProfile.avatar,
                gender: invite.receiverProfile.gender
            } : {
                uid: senderUid,
                displayId: invite.senderProfile.displayId,
                name: invite.senderProfile.name,
                avatar: invite.senderProfile.avatar,
                gender: invite.senderProfile.gender
            };

            const now = new Date();
            const bond = await CouplePartner.findOneAndUpdate(
                { bondId },
                {
                    $set: {
                        bondId,
                        userAId: userAData.uid,
                        userBId: userBData.uid,
                        userA: userAData,
                        userB: userBData,
                        status: 'ACTIVE',
                        connectedAt: now,
                        totalXp: 0,
                        level: 1,
                        affectionScore: 0,
                        dailyXp: 0,
                        weeklyXp: 0,
                        monthlyXp: 0,
                        updatedAt: now
                    }
                },
                { upsert: true, new: true, lean: true }
            );

            // Update invitation status
            invite.status = 'ACCEPTED';
            await invite.save();

            // Link in users collection
            await User.updateOne({ userId: senderUid }, { $set: { couplePartnerId: receiverUid, coupleBondId: bondId } });
            await User.updateOne({ userId: receiverUid }, { $set: { couplePartnerId: senderUid, coupleBondId: bondId } });

            // Invalidate and refresh cache for both
            await cacheService.invalidateCoupleBondCache(senderUid, receiverUid);
            await this.getActiveBond(senderUid);
            await this.getActiveBond(receiverUid);

            // Send official confirmation messages to both
            const celebrationText = `🎉 Congratulations! You and ${invite.receiverProfile.name} are now officially Couple Partners on Amison!`;
            await Message.create({
                conversationId: `conv_amison_official_${senderUid}`,
                senderId: 'AMISON_OFFICIAL',
                recipientId: senderUid,
                text: celebrationText,
                type: 'official_notice',
                isRead: false,
                createdAt: new Date()
            });

            await Message.create({
                conversationId: `conv_amison_official_${receiverUid}`,
                senderId: 'AMISON_OFFICIAL',
                recipientId: receiverUid,
                text: `🎉 Congratulations! You and ${invite.senderProfile.name} are now officially Couple Partners on Amison!`,
                type: 'official_notice',
                isRead: false,
                createdAt: new Date()
            });

            // Real-time WebSocket emission to both users
            const socketPayload = {
                type: 'couple:bond_established',
                bondId,
                connectedAt: now,
                level: 1,
                totalXp: 0,
                affectionScore: 0
            };

            cacheService.emitToUser(senderUid, {
                ...socketPayload,
                partner: invite.receiverProfile
            });

            cacheService.emitToUser(receiverUid, {
                ...socketPayload,
                partner: invite.senderProfile
            });

            return {
                success: true,
                status: 'ACCEPTED',
                bond
            };
        });
    },

    /**
     * Increment XP and Affection Score on Gifting
     * Formula: 100 Gift Coins = 1 CP XP + Affection Score
     */
    async addGiftXp(senderId, receiverId, coinsSpent) {
        const cleanSender = String(senderId || '').trim();
        const cleanReceiver = String(receiverId || '').trim();
        const coins = Math.max(0, Number(coinsSpent) || 0);

        if (!cleanSender || !cleanReceiver || coins < 100) return null;

        const bondId = getDeterministicBondId(cleanSender, cleanReceiver);
        const bond = await CouplePartner.findOne({ bondId, status: 'ACTIVE' });
        if (!bond) return null;

        const xpGained = Math.floor(coins / 100);
        bond.totalXp += xpGained;
        bond.affectionScore += coins;
        bond.dailyXp += xpGained;
        bond.weeklyXp += xpGained;
        bond.monthlyXp += xpGained;
        bond.lastGiftTimestamp = new Date();
        bond.level = calculateCpLevel(bond.totalXp);
        bond.updatedAt = new Date();
        await bond.save();

        // Invalidate and refresh cache
        await cacheService.invalidateCoupleBondCache(cleanSender, cleanReceiver);

        // Real-time WebSocket update to both partners
        const event = {
            type: 'couple:bond_updated',
            bondId,
            totalXp: bond.totalXp,
            level: bond.level,
            affectionScore: bond.affectionScore,
            xpGained
        };
        cacheService.emitToUser(cleanSender, event);
        cacheService.emitToUser(cleanReceiver, event);

        return bond;
    }
};

module.exports = coupleService;