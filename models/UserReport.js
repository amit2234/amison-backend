const mongoose = require('mongoose');

/**
 * Stores user safety reports submitted from User Profile or Amison Play.
 */
const userReportSchema = new mongoose.Schema({
    reporterUid: { type: String, required: true, index: true },
    targetUid: { type: String, required: true, index: true },
    reason: { type: String, required: true, trim: true },
    details: { type: String, default: '', trim: true, maxlength: 500 },
    status: {
        type: String,
        enum: ['PENDING', 'REVIEWED', 'DISMISSED', 'ACTION_TAKEN'],
        default: 'PENDING',
        index: true
    },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'user_reports' });

userReportSchema.index({ reporterUid: 1, targetUid: 1, createdAt: -1 });

const UserReport = mongoose.models.UserReport || mongoose.model('UserReport', userReportSchema);
module.exports = UserReport;
