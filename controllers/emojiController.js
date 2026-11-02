const Emoji = require('../models/Emoji');

const emojiController = {
  /**
   * Get all active emojis for live voice room emoji picker sheet
   * GET /api/emojis/active
   */
  async getActiveEmojis(req, res) {
    try {
      const emojis = await Emoji.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

      // Extract unique categories
      const categorySet = new Set(['Emoji', 'SVIP Emoji', 'Animated']);
      emojis.forEach(item => {
        if (item.category) categorySet.add(item.category);
      });

      return res.status(200).json({
        success: true,
        count: emojis.length,
        categories: Array.from(categorySet),
        emojis: emojis.map(e => ({
          emojiId: e.emojiId,
          name: e.name,
          category: e.category,
          mediaUrl: e.mediaUrl,
          isSvga: e.isSvga,
          minVipLevel: e.minVipLevel || 0,
          sortOrder: e.sortOrder || 0
        }))
      });
    } catch (error) {
      console.error('[EmojiController] getActiveEmojis error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch active emojis catalog'
      });
    }
  }
};

module.exports = emojiController;