const ZegoConfig = require('../models/ZegoConfig');
const NewopAuthService = require('./newopAuthService');

// In-Memory RAM Local Cache for 0ms ultra-fast response
let ramZegoCache = null;

async function verifyZeroTrustAdmin(callerUid) {
  if (!callerUid) {
    throw new Error('Zero-Trust Security Error: callerUid is missing');
  }
  const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(callerUid);
  if (!isAuth) {
    throw new Error('Zero-Trust Security Violation: Access denied for unauthorized UID');
  }
}

/**
 * Service to manage ZEGO-RTC configuration in Node.js MongoDB Atlas + 0ms RAM Local Cache.
 */
class NewopZegoService {
  /**
   * Get active ZEGO-RTC config from MongoDB + RAM Local Cache
   */
  async getZegoConfig(callerUid) {
    if (callerUid) {
      await verifyZeroTrustAdmin(callerUid);
    }

    // Return instant 0ms RAM Cache if available
    if (ramZegoCache) {
      return ramZegoCache;
    }

    try {
      const doc = await ZegoConfig.findOne({ configKey: 'global_zego' }).lean();
      if (doc) {
        ramZegoCache = {
          rtcAppId: Number(doc.rtcAppId || 0),
          rtcAppSign: String(doc.rtcAppSign || ''),
          chatAppId: Number(doc.chatAppId || 0),
          chatAppSign: String(doc.chatAppSign || ''),
          isVoiceEnabled: doc.isVoiceEnabled !== false
        };
        return ramZegoCache;
      }

      return {
        rtcAppId: 0,
        rtcAppSign: '',
        chatAppId: 0,
        chatAppSign: '',
        isVoiceEnabled: true
      };
    } catch (error) {
      console.error('Error fetching ZEGO config from MongoDB Atlas:', error);
      return ramZegoCache || {
        rtcAppId: 0,
        rtcAppSign: '',
        chatAppId: 0,
        chatAppSign: '',
        isVoiceEnabled: true
      };
    }
  }

  /**
   * Update ZEGO-RTC config in MongoDB Atlas and refresh RAM Local Cache
   */
  async updateZegoConfig(callerUid, configData) {
    if (callerUid) {
      await verifyZeroTrustAdmin(callerUid);
    }

    try {
      const updatePayload = {
        updatedAt: new Date()
      };

      if (configData.rtcAppId !== undefined && configData.rtcAppId !== null) {
        updatePayload.rtcAppId = Number(configData.rtcAppId);
      }
      if (configData.rtcAppSign !== undefined) {
        updatePayload.rtcAppSign = String(configData.rtcAppSign).trim();
      }
      if (configData.chatAppId !== undefined && configData.chatAppId !== null) {
        updatePayload.chatAppId = Number(configData.chatAppId);
      }
      if (configData.chatAppSign !== undefined) {
        updatePayload.chatAppSign = String(configData.chatAppSign).trim();
      }
      if (configData.isVoiceEnabled !== undefined) {
        updatePayload.isVoiceEnabled = Boolean(configData.isVoiceEnabled);
      }

      const updatedDoc = await ZegoConfig.findOneAndUpdate(
        { configKey: 'global_zego' },
        { $set: updatePayload },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      ramZegoCache = {
        rtcAppId: Number(updatedDoc.rtcAppId || 0),
        rtcAppSign: String(updatedDoc.rtcAppSign || ''),
        chatAppId: Number(updatedDoc.chatAppId || 0),
        chatAppSign: String(updatedDoc.chatAppSign || ''),
        isVoiceEnabled: updatedDoc.isVoiceEnabled !== false
      };

      console.log('✅ [NewopZegoService] ZEGO Config updated in MongoDB Atlas & RAM Local Cache:', ramZegoCache);
      return ramZegoCache;
    } catch (error) {
      console.error('Error updating ZEGO config in MongoDB Atlas:', error);
      throw error;
    }
  }
}

module.exports = new NewopZegoService();