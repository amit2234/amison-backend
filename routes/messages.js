const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { DirectConversation, DirectMessage } = require('../models/Message');
const User = require('../models/User');
const cacheService = require('../services/cacheService');

// Helper to fetch Zegocloud Chat AppId from newop_zego_config (configured in newop.js)
async function getActiveZegoChatConfig() {
    try {
        const NewopZegoConfig = mongoose.models.NewopZegoConfig;
        if (!NewopZegoConfig) {
            return { chatAppId: 1905410410 };
        }
        const doc = await NewopZegoConfig.findOne({ configKey: 'global_zego_config' }).lean();
        return {
            chatAppId: Number(doc?.chatAppId) || 1905410410,
            rtcAppId: Number(doc?.rtcAppId) || 249734377
        };
    } catch (e) {
        return { chatAppId: 1905410410 };
    }
}

// Helper for deterministic conversationId
function buildConversationId(uid1, uid2) {
    const a = String(uid1 || '').trim();
    const b = String(uid2 || '').trim();
    if (a === 'AMISON_OFFICIAL') {
        return b && b !== 'AMISON_OFFICIAL' ? `conv_amison_official_${b}` : 'conv_amison_official';
    }
    if (b === 'AMISON_OFFICIAL') {
        return a && a !== 'AMISON_OFFICIAL' ? `conv_amison_official_${a}` : 'conv_amison_official';
    }
    return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ============================================================================
// 1. POST /api/messages/send
// ============================================================================
router.post('/send', async (req, res) => {
    try {
        const {
            messageId,
            conversationId: rawConvId,
            senderId,
            senderName,
            senderAvatar,
            receiverId,
            receiverName,
            receiverAvatar,
            text,
            imageUrl,
            isPrivatePhoto,
            replyToUser,
            replyToText,
            timestamp
        } = req.body || {};

        const cleanSender = String(senderId || '').trim();
        const cleanReceiver = String(receiverId || '').trim();
        const cleanText = String(text || '');
        const cleanImg = String(imageUrl || '');

        if (!cleanSender || !cleanReceiver || (!cleanText && !cleanImg)) {
            return res.status(400).json({ success: false, error: 'Missing senderId, receiverId, or message content' });
        }

        const convId = (rawConvId && String(rawConvId).trim()) || buildConversationId(cleanSender, cleanReceiver);
        const nowMillis = Date.now();
        const msgId = Number(messageId) > 0 ? Number(messageId) : nowMillis;
        const formattedTime = timestamp || new Date(nowMillis).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const displayLastText = cleanImg && !cleanText ? '🖼️ [Photo]' : cleanText;

        // 1. Increment Redis & in-memory unread count
        const nextReceiverUnread = await cacheService.incrementUnread(cleanReceiver, convId);
        await cacheService.clearUnread(cleanSender, convId);

        // 2. Upsert message into direct_messages
        const messageDoc = await DirectMessage.findOneAndUpdate(
            { conversationId: convId, messageId: msgId },
            {
                $setOnInsert: {
                    messageId: msgId,
                    conversationId: convId,
                    participants: [cleanSender, cleanReceiver],
                    senderId: cleanSender,
                    receiverId: cleanReceiver,
                    createdAt: new Date(nowMillis)
                },
                $set: {
                    senderName: senderName || 'User',
                    senderAvatar: senderAvatar || '',
                    receiverName: receiverName || 'User',
                    text: cleanText,
                    imageUrl: cleanImg,
                    isPrivatePhoto: Boolean(isPrivatePhoto),
                    replyToUser: replyToUser || '',
                    replyToText: replyToText || '',
                    timestamp: formattedTime,
                    status: 'Delivered'
                }
            },
            { upsert: true, new: true, lean: true }
        );

        // 3. Atomically update direct_conversations for instant Inbox sorting
        const updateConvFields = {
            conversationId: convId,
            participants: [cleanSender, cleanReceiver],
            lastMessage: displayLastText,
            lastSenderId: cleanSender,
            lastTimestamp: formattedTime,
            timeMillis: nowMillis,
            readParticipants: [cleanSender],
            [`unreadCounts.${cleanSender}`]: 0,
            isOfficial: cleanSender === 'AMISON_OFFICIAL' || cleanReceiver === 'AMISON_OFFICIAL',
            updatedAt: new Date(nowMillis)
        };

        if (senderName || senderAvatar) {
            updateConvFields[`userProfiles.${cleanSender}`] = {
                name: senderName || 'User',
                avatarUrl: senderAvatar || ''
            };
        }
        if (receiverName || receiverAvatar) {
            updateConvFields[`userProfiles.${cleanReceiver}`] = {
                name: receiverName || 'User',
                avatarUrl: receiverAvatar || ''
            };
        }

        await DirectConversation.findOneAndUpdate(
            { conversationId: convId },
            {
                $set: updateConvFields,
                $inc: { [`unreadCounts.${cleanReceiver}`]: 1 }
            },
            { upsert: true, new: true, lean: true }
        );

        const zegoConfig = await getActiveZegoChatConfig();

        return res.json({
            success: true,
            conversationId: convId,
            messageId: msgId,
            status: 'Delivered',
            receiverUnreadCount: nextReceiverUnread,
            zegoChatAppId: zegoConfig.chatAppId,
            message: messageDoc
        });
    } catch (e) {
        console.error('[Messages Route] Send message error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 2. GET /api/messages/conversations/:uid
// ============================================================================
router.get('/conversations/:uid', async (req, res) => {
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

        const zegoConfig = await getActiveZegoChatConfig();

        return res.json({
            success: true,
            zegoChatAppId: zegoConfig.chatAppId,
            conversations
        });
    } catch (e) {
        console.error('[Messages Route] Fetch conversations error:', e);
        return res.status(500).json({ success: false, conversations: [], error: e.message });
    }
});

// ============================================================================
// 3. GET /api/messages/history/:conversationId
// ============================================================================
router.get('/history/:conversationId', async (req, res) => {
    try {
        const convId = String(req.params.conversationId || '').trim();
        const viewerUid = String(req.query.uid || '').trim();
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 10), 250);

        if (!convId) {
            return res.status(400).json({ success: false, messages: [], error: 'Missing conversationId' });
        }

        const query = { conversationId: convId };
        if (viewerUid) {
            query.deletedFor = { $ne: viewerUid };
        }

        const docs = await DirectMessage.find(query)
            .sort({ messageId: -1 })
            .limit(limit)
            .lean();

        const messages = docs.reverse().map(m => ({
            id: Number(m.messageId) || new Date(m.createdAt).getTime(),
            conversationId: m.conversationId,
            senderId: m.senderId || '',
            senderName: m.senderName || 'User',
            senderAvatar: m.senderAvatar || '',
            receiverId: m.receiverId || '',
            text: m.isRecalled ? '🚫 [This message was recalled]' : (m.text || ''),
            imageUrl: m.isRecalled ? '' : (m.imageUrl || ''),
            isPrivatePhoto: Boolean(m.isPrivatePhoto),
            replyToUser: m.replyToUser || '',
            replyToText: m.replyToText || '',
            timestamp: m.timestamp || 'Now',
            status: m.isRead ? 'Read' : (m.status || 'Delivered'),
            isRead: Boolean(m.isRead),
            isRecalled: Boolean(m.isRecalled)
        }));

        return res.json({
            success: true,
            conversationId: convId,
            messages
        });
    } catch (e) {
        console.error('[Messages Route] Fetch history error:', e);
        return res.status(500).json({ success: false, messages: [], error: e.message });
    }
});

// ============================================================================
// 4. POST /api/messages/read
// ============================================================================
router.post('/read', async (req, res) => {
    try {
        const { conversationId, uid } = req.body || {};
        const convId = String(conversationId || '').trim();
        const cleanUid = String(uid || '').trim();

        if (!convId || !cleanUid) {
            return res.status(400).json({ success: false, error: 'Missing conversationId or uid' });
        }

        await cacheService.clearUnread(cleanUid, convId);

        await DirectConversation.updateOne(
            { conversationId: convId },
            {
                $set: { [`unreadCounts.${cleanUid}`]: 0 },
                $addToSet: { readParticipants: cleanUid }
            }
        );

        await DirectMessage.updateMany(
            { conversationId: convId, receiverId: cleanUid, isRead: false },
            { $set: { isRead: true, status: 'Read' } }
        );

        return res.json({ success: true, conversationId: convId, unreadCount: 0 });
    } catch (e) {
        console.error('[Messages Route] Mark read error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 5. POST /api/messages/recall
// ============================================================================
router.post('/recall', async (req, res) => {
    try {
        const { conversationId, messageId } = req.body || {};
        const convId = String(conversationId || '').trim();
        const msgId = Number(messageId);

        if (!convId || !msgId) {
            return res.status(400).json({ success: false, error: 'Missing conversationId or messageId' });
        }

        await DirectMessage.updateOne(
            { conversationId: convId, messageId: msgId },
            {
                $set: {
                    text: '🚫 [This message was recalled]',
                    imageUrl: '',
                    isRecalled: true
                }
            }
        );

        return res.json({ success: true });
    } catch (e) {
        console.error('[Messages Route] Recall error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 6. POST /api/messages/delete
// ============================================================================
router.post('/delete', async (req, res) => {
    try {
        const { conversationId, messageId, uid, deleteConversation } = req.body || {};
        const convId = String(conversationId || '').trim();
        const cleanUid = String(uid || '').trim();

        if (!convId) {
            return res.status(400).json({ success: false, error: 'Missing conversationId' });
        }

        if (deleteConversation) {
            await DirectConversation.deleteOne({ conversationId: convId });
            await DirectMessage.deleteMany({ conversationId: convId });
            if (cleanUid) await cacheService.clearUnread(cleanUid, convId);
            return res.json({ success: true, deletedConversation: true });
        }

        const msgId = Number(messageId);
        if (msgId && cleanUid) {
            await DirectMessage.updateOne(
                { conversationId: convId, messageId: msgId },
                { $addToSet: { deletedFor: cleanUid } }
            );
        }

        return res.json({ success: true });
    } catch (e) {
        console.error('[Messages Route] Delete error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 7. POST /api/messages/theme & GET /api/messages/theme/:conversationId
// ============================================================================
router.post('/theme', async (req, res) => {
    try {
        const { conversationId, chatTheme } = req.body || {};
        const convId = String(conversationId || '').trim();
        if (!convId || !chatTheme) {
            return res.status(400).json({ success: false, error: 'Missing conversationId or chatTheme' });
        }

        await DirectConversation.updateOne(
            { conversationId: convId },
            { $set: { chatTheme: String(chatTheme).trim() } },
            { upsert: true }
        );

        return res.json({ success: true, conversationId: convId, chatTheme });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/theme/:conversationId', async (req, res) => {
    try {
        const convId = String(req.params.conversationId || '').trim();
        const doc = await DirectConversation.findOne({ conversationId: convId }).select('chatTheme').lean();
        return res.json({
            success: true,
            chatTheme: doc?.chatTheme || '#EFF1F5'
        });
    } catch (e) {
        return res.json({ success: false, chatTheme: '#EFF1F5' });
    }
});

module.exports = router;