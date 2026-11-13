const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: DAILY TASK USER PROGRESS & BALANCE
// ============================================================================
const dailyTaskUserSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, index: true },
    numericId: { type: Number, index: true, default: 0 },
    pointsBalance: { type: Number, default: 0, min: 0 }, // Daily Points for spinning the wheel (2000 = 1 Spin)
    totalPointsEarned: { type: Number, default: 0, min: 0 },
    freeSpinsAvailable: { type: Number, default: 0, min: 0 },

    // Streak System
    consecutiveDays: { type: Number, default: 1, min: 1 },
    lastLoginDateKey: { type: String, default: "" },

    // Daily Cached State (resets daily at 00:00:00 midnight IST)
    currentDateKey: { type: String, required: true, index: true },
    dailyLoginClaimed: { type: Boolean, default: false },
    dailyLoginPoints: { type: Number, default: 0, min: 0 },

    // 60-Minute Mic Seat Tracker
    micSecondsToday: { type: Number, default: 0, min: 0 }, // 3600s = 60m
    micTaskClaimed: { type: Boolean, default: false },
    micTaskPoints: { type: Number, default: 0, min: 0 },
    lastMicHeartbeatAt: { type: Date, default: null },

    updatedAt: { type: Date, default: Date.now }
}, { collection: 'daily_task_users' });

dailyTaskUserSchema.index({ uid: 1, currentDateKey: 1 });

const DailyTaskUser = mongoose.models.DailyTaskUser || mongoose.model('DailyTaskUser', dailyTaskUserSchema);

module.exports = DailyTaskUser;
module.exports.DailyTaskUser = DailyTaskUser;
