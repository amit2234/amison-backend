const mongoose = require('mongoose');

const emojiSchema = new mongoose.Schema({
  emojiId: { type: String, required: true, unique: true }, // e.g., 'emoji_173000000'
  name: { type: String, required: true, trim: true },      // e.g., 'Fire Crown'
  category: { type: String, default: 'Emoji', trim: true },// 'Emoji', 'SVIP Emoji', 'VIP'
  mediaUrl: { type: String, required: true },               // Cloudinary CDN URL (.webp, .gif, .svga)
  isSvga: { type: Boolean, default: false },               // true if SVGA 60fps animation
  isActive: { type: Boolean, default: true },             // Active/Inactive toggle from Newop
  sortOrder: { type: Number, default: 0 },                // Sorting order in picker bottom sheet
  minVipLevel: { type: Number, default: 0 }               // 0 = Free/All Users, 1 = VIP1, 2 = SVIP
}, { timestamps: true });

emojiSchema.index({ isActive: 1, category: 1, sortOrder: 1 });

module.exports = mongoose.model('Emoji', emojiSchema);
