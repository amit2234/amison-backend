const User = require('../../../models/User');
const Follow = require('../../../models/Friend');
const Room = require('../../../models/Room');
const Merchant = require('../../../models/Merchant');
const UserInventory = require('../../../models/UserInventory');
const CouplePartner = require('../../../models/CouplePartner');
const Family = require('../../../models/Family');
const WalletTransaction = require('../../../models/Transaction');
const Gift = require('../../../models/Gift');
const ProfileVisitor = require('../../../models/ProfileVisitor');
const { MAX_EQUIPPED_BADGES } = require('../profile.constants');

/**
 * Resolves either Firebase Auth UID or 9-digit Numeric ID into the canonical User document.
 */
async function resolveUserDocument(rawIdentifier) {
    const clean = String(rawIdentifier || '').trim();
    if (!clean) return null;

    const numId = /^\d+$/.test(clean) ? Number(clean) : 0;
    const orQuery = [{ uid: clean }];
    if (numId > 0) orQuery.push({ numericId: numId });

    return User.findOne({ $or: orQuery }).lean();
}

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Single Parallel Aggregate API Builder for User Profile Page.
 * Replaces 8+ separate Firestore/Mongo calls with 1 fast Promise.all query.
 */
async function getProfileSummary(targetIdentifier, viewerUid) {
    const userDoc = await resolveUserDocument(targetIdentifier);
    if (!userDoc) return null;

    const targetUid = userDoc.uid;
    const cleanViewerUid = String(viewerUid || '').trim();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Record visitor asynchronously when someone else views this profile
    if (cleanViewerUid && cleanViewerUid !== targetUid) {
        ProfileVisitor.updateOne(
            { targetUid, visitorUid: cleanViewerUid, dayKey: getTodayKey() },
            { $set: { updatedAt: new Date() } },
            { upsert: true }
        ).catch(() => {});
    }

    const [
        followingCount,
        followersCount,
        followingDocs,
        isFollowingDoc,
        visitorsCount,
        inventoryDoc,
        merchantDoc,
        activeRoomDoc,
        cpBondDoc,
        familyDoc,
        sendingAgg,
        receivingAgg,
        supportersDistinctAgg
    ] = await Promise.all([
        Follow.countDocuments({ followerUid: targetUid }),
        Follow.countDocuments({ followingUid: targetUid }),
        Follow.find({ followerUid: targetUid }).select('followingUid').lean(),
        (cleanViewerUid && cleanViewerUid !== targetUid)
            ? Follow.exists({ followerUid: cleanViewerUid, followingUid: targetUid })
            : Promise.resolve(false),
        ProfileVisitor.countDocuments({ targetUid, updatedAt: { $gte: weekAgo } }),
        UserInventory.findOne({ userId: targetUid }).select('equipped').lean(),
        Merchant.findOne({ uid: targetUid, status: 'active' }).select('role').lean(),
        Room.findOne({
            isLive: true,
            isBlocked: { $ne: true },
            $or: [{ ownerUid: targetUid }, { 'seats.userId': targetUid }]
        }).select('displayRoomId roomName roomId').lean(),
        CouplePartner.findOne({
            status: 'ACTIVE',
            $or: [{ userAId: targetUid }, { userBId: targetUid }]
        }).lean(),
        Family.findOne({
            $or: [{ ownerUid: targetUid }, { memberUids: targetUid }]
        }).lean(),
        WalletTransaction.aggregate([
            { $match: { senderUid: targetUid, type: { $in: ['GIFT_SEND', 'GIFT_MULTI'] } } },
            { $group: { _id: null, totalCoins: { $sum: { $abs: '$coinsDelta' } } } }
        ]),
        WalletTransaction.aggregate([
            {
                $match: {
                    type: { $in: ['GIFT_SEND', 'GIFT_MULTI'] },
                    $or: [{ receiverUid: targetUid }, { recipientUids: targetUid }]
                }
            },
            { $group: { _id: null, totalGifts: { $sum: { $max: [1, '$multiplier'] } } } }
        ]),
        WalletTransaction.distinct('senderUid', {
            type: { $in: ['GIFT_SEND', 'GIFT_MULTI'] },
            $or: [{ receiverUid: targetUid }, { recipientUids: targetUid }]
        })
    ]);

    const followingUids = followingDocs.map(d => d.followingUid);
    const friendsCount = followingUids.length > 0
        ? await Follow.countDocuments({ followerUid: { $in: followingUids }, followingUid: targetUid })
        : 0;

    // Resolve VIP ID & Equipped Frame
    const equipped = inventoryDoc?.equipped || {};
    const vipNumber = (equipped.vipId?.vipNumber && (!equipped.vipId.expiresAt || new Date(equipped.vipId.expiresAt) > new Date()))
        ? String(equipped.vipId.vipNumber).trim()
        : '';

    const sellerRole = merchantDoc?.role || userDoc.sellerCenterRole || (userDoc.isMerchant ? 'marchent' : (userDoc.isSeller ? 'seller' : ''));

    // Build CP Partner summary from MongoDB CouplePartner collection
    let cpPartner = null;
    if (cpBondDoc) {
        const isUserA = cpBondDoc.userAId === targetUid;
        const partnerUid = isUserA ? cpBondDoc.userBId : cpBondDoc.userAId;
        const rawPartner = isUserA ? cpBondDoc.userB : cpBondDoc.userA;
        const livePartnerUser = await User.findOne({ uid: partnerUid }).select('uid numericId name avatarUrl gender level').lean();
        cpPartner = {
            bondId: cpBondDoc.bondId,
            partnerUid,
            partnerNumericId: livePartnerUser?.numericId ? String(livePartnerUser.numericId) : (rawPartner?.displayId || ''),
            partnerName: livePartnerUser?.name || rawPartner?.name || 'Partner',
            partnerAvatar: livePartnerUser?.avatarUrl || rawPartner?.avatar || '',
            partnerGender: livePartnerUser?.gender || rawPartner?.gender || 'Female',
            partnerLevel: livePartnerUser?.level || 1,
            cpLevel: cpBondDoc.level || 1,
            totalXp: cpBondDoc.totalXp || 0
        };
    }

    // Build real Family summary (null if user has NO family — never fake "testing"/"abcd"!)
    const family = familyDoc ? {
        familyId: familyDoc.familyId,
        name: familyDoc.name,
        tagline: familyDoc.tagline || '',
        photoUrl: familyDoc.photoUrl || '',
        level: familyDoc.level || 'Stray Soul',
        xp: familyDoc.xp || 0,
        maxXp: familyDoc.maxXp || 5000000,
        memberCount: Array.isArray(familyDoc.memberUids) ? familyDoc.memberUids.length : 1,
        ownerUid: familyDoc.ownerUid
    } : null;

    // Top 6 supporters quick preview (for avatar circles on profile card)
    const topSupporters = await getSupportersLeaderboard(targetUid, 6);

    return {
        user: {
            uid: userDoc.uid,
            numericId: String(userDoc.numericId || ''),
            displayId: vipNumber || String(userDoc.numericId || userDoc.uid),
            isVipIdActive: Boolean(vipNumber),
            name: userDoc.name || 'User',
            avatarUrl: userDoc.avatarUrl || '',
            backgroundUrls: Array.isArray(userDoc.backgroundUrls) ? userDoc.backgroundUrls : [],
            dob: userDoc.dob || '',
            gender: userDoc.gender || 'Male',
            country: userDoc.country || 'India',
            level: Number(userDoc.level) || 1,
            xp: Number(userDoc.xp) || 0,
            role: userDoc.role || 'user',
            sellerRole: sellerRole || '',
            isOfficial: String(userDoc.role || '').toLowerCase() === 'official' || String(userDoc.name || '').toLowerCase() === 'help',
            isBanned: Boolean(userDoc.isBanned),
            equippedFrameId: equipped.frame?.itemId || '',
            equippedFrameUrl: equipped.frame?.mediaUrl || '',
            equippedBadges: Array.isArray(userDoc.equippedBadges) ? userDoc.equippedBadges.slice(0, MAX_EQUIPPED_BADGES) : []
        },
        stats: {
            friendsCount,
            followingCount,
            followersCount,
            visitorsCount,
            sendingCoins: sendingAgg?.[0]?.totalCoins || 0,
            receivingGiftsCount: receivingAgg?.[0]?.totalGifts || 0,
            supportersCount: Array.isArray(supportersDistinctAgg) ? supportersDistinctAgg.length : 0,
            isFollowing: Boolean(isFollowingDoc)
        },
        liveRoom: activeRoomDoc ? {
            isInRoom: true,
            displayRoomId: String(activeRoomDoc.displayRoomId || ''),
            roomName: activeRoomDoc.roomName || 'Live Room'
        } : {
            isInRoom: false,
            displayRoomId: '',
            roomName: ''
        },
        cpPartner,
        family,
        topSupporters
    };
}

/**
 * Received Gifts Wall from MongoDB WalletTransaction + Gift catalog (Zero Firestore)
 */
async function getReceivedGifts(targetIdentifier) {
    const userDoc = await resolveUserDocument(targetIdentifier);
    if (!userDoc) return [];

    const targetUid = userDoc.uid;
    const agg = await WalletTransaction.aggregate([
        {
            $match: {
                type: { $in: ['GIFT_SEND', 'GIFT_MULTI'] },
                $or: [{ receiverUid: targetUid }, { recipientUids: targetUid }]
            }
        },
        {
            $group: {
                _id: '$giftId',
                giftName: { $first: '$giftName' },
                count: { $sum: { $max: [1, '$multiplier'] } }
            }
        },
        { $sort: { count: -1 } },
        { $limit: 50 }
    ]);

    const giftIds = agg.map(g => g._id).filter(Boolean);
    const catalogDocs = giftIds.length > 0
        ? await Gift.find({ giftId: { $in: giftIds } }).select('giftId name iconUrl iconEmoji').lean()
        : [];
    const catalogMap = new Map(catalogDocs.map(c => [c.giftId, c]));

    return agg.map(item => {
        const cat = catalogMap.get(item._id);
        return {
            giftId: item._id || 'gift',
            giftName: cat?.name || item.giftName || 'Gift',
            giftThumbnail: cat?.iconUrl || '',
            iconEmoji: cat?.iconEmoji || '🎁',
            count: item.count || 1
        };
    });
}

/**
 * Top Supporters Leaderboard (Weekly / Monthly / Always) from MongoDB WalletTransaction
 */
async function getSupportersLeaderboard(targetIdentifier, limit = 50) {
    const userDoc = await resolveUserDocument(targetIdentifier);
    if (!userDoc) return [];

    const targetUid = userDoc.uid;
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const agg = await WalletTransaction.aggregate([
        {
            $match: {
                type: { $in: ['GIFT_SEND', 'GIFT_MULTI'] },
                $or: [{ receiverUid: targetUid }, { recipientUids: targetUid }]
            }
        },
        {
            $group: {
                _id: '$senderUid',
                alwaysPoints: { $sum: { $abs: '$coinsDelta' } },
                monthlyPoints: {
                    $sum: {
                        $cond: [{ $gte: ['$createdAt', monthAgo] }, { $abs: '$coinsDelta' }, 0]
                    }
                },
                weeklyPoints: {
                    $sum: {
                        $cond: [{ $gte: ['$createdAt', weekAgo] }, { $abs: '$coinsDelta' }, 0]
                    }
                },
                updatedAt: { $max: '$createdAt' }
            }
        },
        { $sort: { alwaysPoints: -1 } },
        { $limit: Math.max(1, Math.min(100, Number(limit) || 50)) }
    ]);

    const senderUids = agg.map(a => a._id).filter(Boolean);
    const senderUsers = senderUids.length > 0
        ? await User.find({ uid: { $in: senderUids } }).select('uid numericId name avatarUrl level gender').lean()
        : [];
    const userMap = new Map(senderUsers.map(u => [u.uid, u]));

    return agg.map(item => {
        const u = userMap.get(item._id);
        return {
            supporterId: item._id,
            numericId: u?.numericId ? String(u.numericId) : '',
            supporterName: u?.name || 'Supporter',
            supporterAvatar: u?.avatarUrl || '',
            level: u?.level || 1,
            gender: u?.gender || 'Male',
            weeklyPoints: item.weeklyPoints || 0,
            monthlyPoints: item.monthlyPoints || 0,
            alwaysPoints: item.alwaysPoints || 0,
            updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : now
        };
    });
}

module.exports = {
    resolveUserDocument,
    getProfileSummary,
    getReceivedGifts,
    getSupportersLeaderboard
};