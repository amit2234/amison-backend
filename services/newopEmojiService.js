const Emoji = require('../models/Emoji');
const { uploadBufferToCloudinary } = require('./cloudinaryService');

const newopEmojiService = {
  /**
   * Fetch all emojis (active & inactive) for Newop Admin Panel
   */
  async getAllEmojis(callerUid) {
    const emojis = await Emoji.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
    return emojis.map(e => ({
      emojiId: e.emojiId,
      name: e.name,
      category: e.category || 'Emoji',
      mediaUrl: e.mediaUrl,
      isSvga: Boolean(e.isSvga),
      isActive: Boolean(e.isActive),
      sortOrder: e.sortOrder || 0,
      minVipLevel: e.minVipLevel || 0,
      createdAt: e.createdAt
    }));
  },

  /**
   * Add a new Emoji with Cloudinary Upload support
   */
  async addEmoji(callerUid, bodyData, fileData) {
    let { name, category, mediaUrl, isSvga, isActive, sortOrder, minVipLevel } = bodyData || {};

    if (!name || name.trim().length === 0) {
      throw new Error('Emoji name is required');
    }

    // Check file upload from Multer
    const mediaFile = fileData?.mediaFile?.[0] || fileData?.media?.[0] || fileData?.file?.[0];
    if (mediaFile && mediaFile.buffer) {
      const folder = 'amison/emojis';
      const resourceType = mediaFile.originalname?.endsWith('.svga') ? 'raw' : 'auto';
      const uploadRes = await uploadBufferToCloudinary(mediaFile.buffer, folder, resourceType);
      if (uploadRes && uploadRes.secure_url) {
        mediaUrl = uploadRes.secure_url;
      }
    }

    if (!mediaUrl) {
      throw new Error('Media URL or asset file upload is required for Emoji');
    }

    const emojiId = `emoji_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    const newEmoji = new Emoji({
      emojiId,
      name: name.trim(),
      category: (category || 'Emoji').trim(),
      mediaUrl: mediaUrl.trim(),
      isSvga: isSvga === true || isSvga === 'true' || String(mediaUrl).endsWith('.svga'),
      isActive: isActive !== undefined ? (isActive === true || isActive === 'true') : true,
      sortOrder: Number(sortOrder) || 0,
      minVipLevel: Number(minVipLevel) || 0
    });

    await newEmoji.save();
    return newEmoji;
  },

  /**
   * Edit an existing Emoji
   */
  async editEmoji(callerUid, targetEmojiId, bodyData, fileData) {
    if (!targetEmojiId) throw new Error('Target emojiId is required');

    const emoji = await Emoji.findOne({ emojiId: targetEmojiId });
    if (!emoji) throw new Error(`Emoji not found with id ${targetEmojiId}`);

    const { name, category, mediaUrl, isSvga, isActive, sortOrder, minVipLevel } = bodyData || {};

    if (name) emoji.name = name.trim();
    if (category) emoji.category = category.trim();
    if (sortOrder !== undefined) emoji.sortOrder = Number(sortOrder);
    if (minVipLevel !== undefined) emoji.minVipLevel = Number(minVipLevel);
    if (isActive !== undefined) emoji.isActive = (isActive === true || isActive === 'true');
    if (isSvga !== undefined) emoji.isSvga = (isSvga === true || isSvga === 'true');

    // Handle optional file re-upload
    const mediaFile = fileData?.mediaFile?.[0] || fileData?.media?.[0] || fileData?.file?.[0];
    if (mediaFile && mediaFile.buffer) {
      const folder = 'amison/emojis';
      const resourceType = mediaFile.originalname?.endsWith('.svga') ? 'raw' : 'auto';
      const uploadRes = await uploadBufferToCloudinary(mediaFile.buffer, folder, resourceType);
      if (uploadRes && uploadRes.secure_url) {
        emoji.mediaUrl = uploadRes.secure_url;
      }
    } else if (mediaUrl) {
      emoji.mediaUrl = mediaUrl.trim();
    }

    await emoji.save();
    return emoji;
  },

  /**
   * Delete or deactivate an Emoji
   */
  async deleteEmoji(callerUid, targetEmojiId) {
    if (!targetEmojiId) throw new Error('Target emojiId is required');
    const result = await Emoji.findOneAndDelete({ emojiId: targetEmojiId });
    if (!result) {
      throw new Error(`Emoji with ID ${targetEmojiId} not found`);
    }
    return result;
  }
};

module.exports = newopEmojiService;
