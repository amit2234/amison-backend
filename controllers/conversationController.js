const { DirectConversation } = require('../models/Message');
const User = require('../models/User');
const messagingService = require('../services/messagingService');

/**
 * Controller for Managing Conversation List and Inbox
 */
const conversationController = {
    /**
     * GET /api/messages/conversations/:uid
     */
    async getConversations(req, res) {
        try {
            const cleanUid = String(req.params.uid || '').trim();
            if (!cleanUid) {
                return res.status(400).json({ success: false, conversations: [], error: 'Missing UID' });
            }

            const rawConvs = await DirectConversation.find({
                participants: cleanUid
            })
                .sort({ timeMillis: -1 })
                .limit(100)
                .lean();

            const otherUids = new Set();
            for (const c of rawConvs) {
                const parts = Array.isArray(c.participants) ? c.participants : [];
                const other = parts.find(p => p && p !== cleanUid);
                if (other && other !== 'AMISON_OFFICIAL') {
                    otherUids.add(other);
                }
            }

            const userLookupMap = new Map();
            if (otherUids.size > 0) {
                const uidList = Array.from(otherUids);
                const numericList = uidList.map(u => Number(u)).filter(n => !isNaN(n) && n > 0);
                const users = await User.find({
                    $or: [
                        { uid: { $in: uidList } },
                        ...(numericList.length > 0 ? [{ numericId: { $in: numericList } }] : [])
                    ]
                })
                    .select('uid numericId name avatarUrl')
                    .lean();

                for (const u of users) {
                    if (u.uid) userLookupMap.set(String(u.uid), u);
                    if (u.numericId) userLookupMap.set(String(u.numericId), u);
                }
            }

            const conversations = rawConvs.map(c => {
                const parts = Array.isArray(c.participants) ? c.participants : [];
                let otherUserId = parts.find(p => p && p !== cleanUid) || '';
                if (c.isOfficial || String(c.conversationId || '').startsWith('conv_amison_official')) {
                    otherUserId = 'AMISON_OFFICIAL';
                }

                const storedProfiles = c.userProfiles || {};
                const storedOther = storedProfiles[otherUserId] || {};
                const liveOther = userLookupMap.get(otherUserId);

                const otherUserName = otherUserId === 'AMISON_OFFICIAL'
                    ? '𝘼𝙈𝙄𝙎の𝙉'
                    : (liveOther?.name || storedOther?.name || `User ${otherUserId}`);
                const otherUserAvatar = liveOther?.avatarUrl || storedOther?.avatarUrl || '';

                const unreadMap = c.unreadCounts || {};
                const mongoUnread = Number(unreadMap[cleanUid]) || 0;
                const readList = Array.isArray(c.readParticipants) ? c.readParticipants : [];
                const fallbackUnread = (c.lastSenderId && c.lastSenderId !== cleanUid && !readList.includes(cleanUid)) ? 1 : 0;
                const effectiveUnread = Math.max(mongoUnread, fallbackUnread);

                return {
                    conversationId: c.conversationId,
                    otherUserId,
                    otherUserName,
                    otherUserAvatar,
                    lastMessage: c.lastMessage || '',
                    timestamp: c.lastTimestamp || '',
                    timeMillis: Number(c.timeMillis) || (c.updatedAt ? new Date(c.updatedAt).getTime() : 0),
                    unreadCount: effectiveUnread,
                    isOfficial: Boolean(c.isOfficial || otherUserId === 'AMISON_OFFICIAL'),
                    chatTheme: c.chatTheme || '#EFF1F5'
                };
            });

            const zegoConfig = await messagingService.getActiveZegoChatConfig();

            return res.json({
                success: true,
                zegoChatAppId: zegoConfig.chatAppId,
                conversations
            });
        } catch (e) {
            console.error('[ConversationController] Fetch conversations error:', e);
            return res.status(500).json({ success: false, conversations: [], error: e.message });
        }
    }
};

module.exports = conversationController;