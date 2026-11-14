const mongoose = require('mongoose');

/**
 * Tracks unique daily profile visits per viewer with a 7-day automatic TTL expiry.
 */
const profileVisitorSchema = new mongoose.Schema({
    targetUid: { type: String, required: true, index: true },
    visitorUid: { type: String, required: true, index: true },
    dayKey: { type: String, required: true }, // e.g., YYYY-MM-DD
    updatedAt: { type: Date, default: Date.now, expires: 604800 } // Auto-expires after 7 days
}, { collection: 'profile_visitors' });

profileVisitorSchema.index({ targetUid: 1, visitorUid: 1, dayKey: 1 }, { unique: true });

const ProfileVisitor = mongoose.models.ProfileVisitor || mongoose.model('ProfileVisitor', profileVisitorSchema);
module.exports = ProfileVisitor;
