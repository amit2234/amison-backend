const { DirectConversation, DirectMessage } = require('./Message.model');
const User = require('../../models/User');
const messagingCache = require('./messaging.cache');
const {
    OFFICIAL_SENDER_ID,
    OFFICIAL_CONVERSATION_PREFIX,
    OFFICIAL_DISPLAY_NAME,
    MAX_MESSAGE_LENGTH,
    DEFAULT_CHAT_THEME,
    RECALLED_MESSAGE_TEXT,
    DEFAULT_HISTORY_LIMIT,
    MAX_HISTORY_LIMIT
} = require('./messaging.constants');

function createHttpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

const messagingService = {
    async getActiveZegoChatConfig() {
        try {
            const newopZegoService = require('../../services/newopZegoService');
            const cfg = await newopZegoService.getZegoConfig();
            return {
                chatAppId: cfg.chatAppId || 0,
                rtcAppId: cfg.rtcAppId || 0
            };
        } catch (e) {
            return { chatAppId: 0, rtcAppId: 0 };
        }
    },

    async resolveCanonicalUid(rawId) {
        const clean = String(rawId || '').trim();
        if (!clean) return '';
        if (clean === OFFICIAL_SENDER_ID) return OFFICIAL_SENDER_ID;

        if (/^\d{5,12}$/.test(clean)) {
            const num = Number(clean);
            if (Number.isSafeInteger(num) && num > 0) {
                const found = await User.findOne({ numericId: num }).select('uid').lean();
                if (found && found.uid) {
                    return String(found.uid).trim();
                }
            }
        }
        return clean;
    },

    buildConversationId(uid1, uid2) {
        const a = String(uid1 || '').trim();
        const b = String(uid2 || '').trim();
        if (a === OFFICIAL_SENDER_ID) {
            return b && b !== OFFICIAL_SENDER_ID
                ? `${OFFICIAL_CONVERSATION_PREFIX}_${b}`
                : OFFICIAL_CONVERSATION_PREFIX;
        }
        if (b === OFFICIAL_SENDER_ID) {
            return a && a !== OFFICIAL_SENDER_ID
                ? `${OFFICIAL_CONVERSATION_PREFIX}_${a}`
                : OFFICIAL_CONVERSATION_PREFIX;
        }
        return a < b ? `${a}_${b}` : `${b}_${a}`;
    },

    async normalizeIncomingConversationId(rawConvId, cleanSender, cleanReceiver) {
        const canonical = this.buildConversationId(cleanSender, cleanReceiver);
        const provided = String(rawConvId || '').trim();
        if (!provided) return canonical;

        if (provided === OFFICIAL_CONVERSATION_PREFIX || provided.startsWith(`${OFFICIAL_CONVERSATION_PREFIX}_`)) {
            if (cleanSender === OFFICIAL_SENDER_ID || cleanReceiver === OFFICIAL_SENDER_ID) {
                return canonical;
            }
        }
        // Always enforce canonical UID-based conversationId for deterministic 1-to-1 threads
        return canonical;
    },

    async assertConversationAccess(convId, callerUid) {
        const cleanConvId = String(convId || '').trim();
        const cleanUid = String(callerUid || '').trim();
        if (!cleanConvId || !cleanUid) {
            throw createHttpError(400, 'Missing conversationId or authentication');
        }

        const conv = await DirectConversation.findOne({ conversationId: cleanConvId })
            .select('participants isOfficial')
            .lean();

        if (conv) {
            const parts = Array.isArray(conv.participants) ? conv.participants.map(String) : [];
            if (!parts.includes(cleanUid)) {
                throw createHttpError(403, 'Forbidden: You are not a participant of this conversation.');
            }
            return conv;
        }

        // Conversation not created yet: validate deterministic conversationId pattern
        const isOfficialOwn = cleanConvId === OFFICIAL_CONVERSATION_PREFIX ||
            cleanConvId === `${OFFICIAL_CONVERSATION_PREFIX}_${cleanUid}`;
        if (isOfficialOwn) {
            return null;
        }

        const segments = cleanConvId.split('_');
        if (!segments.includes(cleanUid)) {
            throw createHttpError(403, 'Forbidden: Conversation access denied.');
        }
        return null;
    },

    async getConversations(rawUid) {
        const cleanUid = String(rawUid || '').trim();
        if (!cleanUid) {
            throw createHttpError(401, 'Authentication required');
        }

        const rawConvs = await DirectConversation.find({
            participants: cleanUid,
            deletedConversationFor: { $ne: cleanUid }
        })
            .sort({ timeMillis: -1 })
            .limit(100)
            .lean();

        const otherUids = new Set();
        for (const c of rawConvs) {
            const parts = Array.isArray(c.participants) ? c.participants : [];
            const other = parts.find(p => p && p !== cleanUid);
            if (other && other !== OFFICIAL_SENDER_ID) {
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
            const isOfficial = Boolean(
                c.isOfficial ||
                otherUserId === OFFICIAL_SENDER_ID ||
                String(c.conversationId || '').startsWith(OFFICIAL_CONVERSATION_PREFIX)
            );
            if (isOfficial) {
                otherUserId = OFFICIAL_SENDER_ID;
            }

            const storedProfiles = c.userProfiles || {};
            const storedOther = storedProfiles[otherUserId] || {};
            const liveOther = userLookupMap.get(otherUserId);

            const otherUserName = isOfficial
                ? OFFICIAL_DISPLAY_NAME
                : (liveOther?.name || storedOther?.name || `User ${otherUserId}`);
            const otherUserAvatar = isOfficial
                ? ''
                : (liveOther?.avatarUrl || storedOther?.avatarUrl || '');

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
                isOfficial,
                chatTheme: c.chatTheme || DEFAULT_CHAT_THEME
            };
        });

        const zegoConfig = await this.getActiveZegoChatConfig();
        return {
            success: true,
            zegoChatAppId: zegoConfig.chatAppId,
            conversations
        };
    },

    async getHistory(convId, viewerUid, rawLimit) {
        await this.assertConversationAccess(convId, viewerUid);

        const limit = Math.min(
            Math.max(Number(rawLimit) || DEFAULT_HISTORY_LIMIT, 10),
            MAX_HISTORY_LIMIT
        );

        const docs = await DirectMessage.find({
            conversationId: String(convId).trim(),
            deletedFor: { $ne: viewerUid }
        })
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
            text: m.isRecalled ? RECALLED_MESSAGE_TEXT : (m.text || ''),
            imageUrl: m.isRecalled ? '' : (m.imageUrl || ''),
            isPrivatePhoto: Boolean(m.isPrivatePhoto),
            replyToUser: m.replyToUser || '',
            replyToText: m.replyToText || '',
            timestamp: m.timestamp || 'Now',
            status: m.isRead ? 'Read' : (m.status || 'Delivered'),
            isRead: Boolean(m.isRead),
            isRecalled: Boolean(m.isRecalled)
        }));

        return {
            success: true,
            conversationId: String(convId).trim(),
            messages
        };
    },

    async sendMessage(data) {
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
        } = data || {};

        const cleanSender = String(senderId || '').trim();
        const cleanReceiver = await this.resolveCanonicalUid(receiverId);
        const cleanText = String(text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
        const cleanImg = String(imageUrl || '').trim();

        if (!cleanSender || !cleanReceiver || (!cleanText && !cleanImg)) {
            throw createHttpError(400, 'Missing senderId, receiverId, or message content');
        }

        const convId = await this.normalizeIncomingConversationId(rawConvId, cleanSender, cleanReceiver);
        const nowMillis = Date.now();
        const msgId = Number(messageId) > 0 ? Number(messageId) : nowMillis;
        const formattedTime = timestamp || new Date(nowMillis).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const displayLastText = cleanImg && !cleanText ? '🖼️ [Photo]' : cleanText;

        const nextReceiverUnread = await messagingCache.incrementUnread(cleanReceiver, convId);
        await messagingCache.clearUnread(cleanSender, convId);

        const messageDoc = await DirectMessage.findOneAndUpdate(
            { conversationId: convId, messageId: msgId },
            {
                $setOnInsert: {
                    messageId: msgId,
                    conversationId: convId,
                    participants: [cleanSender, cleanReceiver],
                    senderId: cleanSender,
                    receiverId: cleanReceiver,
                    isRead: false,
                    isRecalled: false,
                    deletedFor: [],
                    createdAt: new Date(nowMillis)
                },
                $set: {
                    senderName: String(senderName || 'User').trim(),
                    senderAvatar: String(senderAvatar || '').trim(),
                    receiverName: String(receiverName || 'User').trim(),
                    text: cleanText,
                    imageUrl: cleanImg,
                    isPrivatePhoto: Boolean(isPrivatePhoto),
                    replyToUser: String(replyToUser || '').trim(),
                    replyToText: String(replyToText || '').trim(),
                    timestamp: formattedTime,
                    status: 'Delivered'
                }
            },
            { upsert: true, new: true, lean: true }
        );

        const isOfficial = cleanSender === OFFICIAL_SENDER_ID || cleanReceiver === OFFICIAL_SENDER_ID;
        const updateConvFields = {
            conversationId: convId,
            participants: [cleanSender, cleanReceiver],
            lastMessage: displayLastText,
            lastSenderId: cleanSender,
            lastTimestamp: formattedTime,
            timeMillis: nowMillis,
            readParticipants: [cleanSender],
            [`unreadCounts.${cleanSender}`]: 0,
            isOfficial,
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
                $pull: { deletedConversationFor: { $in: [cleanSender, cleanReceiver] } },
                $inc: { [`unreadCounts.${cleanReceiver}`]: 1 }
            },
            { upsert: true, new: true, lean: true }
        );

        // Push real-time packet over /ws/chat if receiver is connected
        if (cleanReceiver !== OFFICIAL_SENDER_ID && cleanReceiver !== cleanSender) {
            messagingCache.emitToUser(cleanReceiver, {
                type: 'dm:receive',
                id: msgId,
                messageId: String(msgId),
                conversationId: convId,
                senderId: cleanSender,
                senderName: String(senderName || 'User').trim(),
                senderAvatar: String(senderAvatar || '').trim(),
                text: cleanText,
                mediaUrl: cleanImg,
                imageUrl: cleanImg,
                isPrivatePhoto: Boolean(isPrivatePhoto),
                replyToUser: String(replyToUser || '').trim(),
                replyToText: String(replyToText || '').trim(),
                timestamp: nowMillis
            });
        }

        const zegoConfig = await this.getActiveZegoChatConfig();
        return {
            success: true,
            conversationId: convId,
            messageId: msgId,
            status: 'Delivered',
            receiverUnreadCount: nextReceiverUnread,
            zegoChatAppId: zegoConfig.chatAppId,
            message: messageDoc
        };
    },

    async markRead(convId, cleanUid) {
        await this.assertConversationAccess(convId, cleanUid);
        await messagingCache.clearUnread(cleanUid, convId);

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

        return { success: true, conversationId: convId, unreadCount: 0 };
    },

    async recallMessage(convId, msgId, callerUid) {
        await this.assertConversationAccess(convId, callerUid);

        const targetMsg = await DirectMessage.findOne({ conversationId: convId, messageId: msgId }).lean();
        if (!targetMsg) {
            throw createHttpError(404, 'Message not found');
        }
        if (String(targetMsg.senderId || '').trim() !== String(callerUid || '').trim()) {
            throw createHttpError(403, 'Forbidden: You can only recall your own messages.');
        }

        await DirectMessage.updateOne(
            { conversationId: convId, messageId: msgId },
            {
                $set: {
                    text: RECALLED_MESSAGE_TEXT,
                    imageUrl: '',
                    isRecalled: true
                }
            }
        );

        if (targetMsg.receiverId && targetMsg.receiverId !== OFFICIAL_SENDER_ID) {
            messagingCache.emitToUser(targetMsg.receiverId, {
                type: 'dm:recalled',
                conversationId: convId,
                messageId: msgId,
                text: RECALLED_MESSAGE_TEXT
            });
        }

        return { success: true };
    },

    async deleteMessageOrConversation({ convId, cleanUid, msgId, deleteConversation }) {
        await this.assertConversationAccess(convId, cleanUid);

        if (deleteConversation) {
            // Per-user soft delete so the other participant never loses their conversation history
            await DirectConversation.updateOne(
                { conversationId: convId },
                {
                    $addToSet: { deletedConversationFor: cleanUid },
                    $set: { [`unreadCounts.${cleanUid}`]: 0 }
                }
            );
            await DirectMessage.updateMany(
                { conversationId: convId },
                { $addToSet: { deletedFor: cleanUid } }
            );
            if (cleanUid) await messagingCache.clearUnread(cleanUid, convId);
            return { success: true, deletedConversation: true };
        }

        if (msgId && cleanUid) {
            await DirectMessage.updateOne(
                { conversationId: convId, messageId: msgId },
                { $addToSet: { deletedFor: cleanUid } }
            );
        }

        return { success: true };
    },

    async setTheme(convId, chatTheme, callerUid) {
        await this.assertConversationAccess(convId, callerUid);
        const cleanTheme = String(chatTheme || '').trim();
        await DirectConversation.updateOne(
            { conversationId: convId },
            { $set: { chatTheme: cleanTheme } },
            { upsert: true }
        );
        return { success: true, conversationId: convId, chatTheme: cleanTheme };
    },

    async getTheme(convId, callerUid) {
        await this.assertConversationAccess(convId, callerUid);
        const doc = await DirectConversation.findOne({ conversationId: convId })
            .select('chatTheme')
            .lean();
        return {
            success: true,
            chatTheme: doc?.chatTheme || DEFAULT_CHAT_THEME
        };
    }
};

module.exports = messagingService;
