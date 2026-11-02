const mongoose = require('mongoose');

const LevelRuleSchema = new mongoose.Schema({
    ruleKey: {
        type: String,
        required: true,
        unique: true,
        default: 'GLOBAL_LEVEL_RULES'
    },
    userXpPerCoinSpent: {
        type: Number,
        default: 10
    },
    userXpPerCoinReceived: {
        type: Number,
        default: 5
    },
    roomXpPerCoinSpent: {
        type: Number,
        default: 10
    },
    cpXpPerCoinSent: {
        type: Number,
        default: 10
    },
    dailyXpCap: {
        type: Number,
        default: 0
    },
    isLiveEnabled: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('LevelRule', LevelRuleSchema);