const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: ZEGO CONFIGURATION (zego_configs)
// Pure MongoDB Atlas collection for global Zego Cloud RTC & Chat credentials
// ============================================================================
const zegoConfigSchema = new mongoose.Schema({
    configKey: { type: String, required: true, unique: true, default: 'global_zego' },
    rtcAppId: { type: Number, default: 0 },
    rtcAppSign: { type: String, default: '' },
    chatAppId: { type: Number, default: 0 },
    chatAppSign: { type: String, default: '' },
    isVoiceEnabled: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'zego_configs' });

const ZegoConfig = mongoose.models.ZegoConfig || mongoose.model('ZegoConfig', zegoConfigSchema);

module.exports = ZegoConfig;