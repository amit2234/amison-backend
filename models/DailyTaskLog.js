const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: DAILY TASK & SPIN AUDIT LOGS
// ============================================================================
const dailyTaskLogSchema = new mongoose.Schema({
    uid: { type: String, required: true, index: true },
    actionType: {
        type: String,
        required: true,
        enum: ['CLAIM_LOGIN', 'CLAIM_MIC_60M', 'SPIN_DEDUCTION', 'SPIN_COIN_WIN', 'SPIN_FREE_TICKET']
    },
    dateKey: { type: String, required: true, index: true },
    pointsDelta: { type: Number, default: 0 },
    coinsDelta: { type: Number, default: 0 },
    freeSpinsDelta: { type: Number, default: 0 },
    details: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'daily_task_logs' });

const DailyTaskLog = mongoose.models.DailyTaskLog || mongoose.model('DailyTaskLog', dailyTaskLogSchema);

module.exports = DailyTaskLog;
module.exports.DailyTaskLog = DailyTaskLog;