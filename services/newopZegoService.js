const { db } = require('../firebase');
const NewopAuthService = require('./newopAuthService');

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
 * Service to manage ZEGO-RTC configuration in backend and Firestore.
 */
class NewopZegoService {
  /**
   * Get active ZEGO-RTC config from Firestore collection 'system_config', doc 'zego'
   */
  async getZegoConfig(callerUid) {
    if (callerUid) {
      await verifyZeroTrustAdmin(callerUid);
    }
    try {
      if (!db) {
        console.warn('⚠️ Firestore db is not initialized yet. Returning default Zego config.');
        return {
          rtcAppId: 0,
          rtcAppSign: '',
          chatAppId: 0,
          chatAppSign: '',
          isVoiceEnabled: true
        };
      }
      const docRef = db.collection('system_config').doc('zego');
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        const data = docSnap.data();
        return {
          rtcAppId: Number(data.rtcAppId || 0),
          rtcAppSign: String(data.rtcAppSign || ''),
          chatAppId: Number(data.chatAppId || 0),
          chatAppSign: String(data.chatAppSign || ''),
          isVoiceEnabled: data.isVoiceEnabled !== false
        };
      }

      // Default fallback if not yet set in database
      return {
        rtcAppId: 0,
        rtcAppSign: '',
        chatAppId: 0,
        chatAppSign: '',
        isVoiceEnabled: true
      };
    } catch (error) {
      console.error('Error fetching ZEGO config from Firestore:', error);
      return {
        rtcAppId: 0,
        rtcAppSign: '',
        chatAppId: 0,
        chatAppSign: '',
        isVoiceEnabled: true
      };
    }
  }

  /**
   * Update ZEGO-RTC config in Firestore collection 'system_config', doc 'zego'
   */
  async updateZegoConfig(callerUid, configData) {
    await verifyZeroTrustAdmin(callerUid);
    try {
      const docRef = db.collection('system_config').doc('zego');
      const updatePayload = {
        updatedAt: new Date().toISOString()
      };

      if (configData.rtcAppId !== undefined && configData.rtcAppId > 0) {
        updatePayload.rtcAppId = Number(configData.rtcAppId);
      }
      if (configData.rtcAppSign) {
        updatePayload.rtcAppSign = String(configData.rtcAppSign).trim();
      }
      if (configData.chatAppId !== undefined && configData.chatAppId > 0) {
        updatePayload.chatAppId = Number(configData.chatAppId);
      }
      if (configData.chatAppSign) {
        updatePayload.chatAppSign = String(configData.chatAppSign).trim();
      }
      if (configData.isVoiceEnabled !== undefined) {
        updatePayload.isVoiceEnabled = Boolean(configData.isVoiceEnabled);
      }

      await docRef.set(updatePayload, { merge: true });
      return await this.getZegoConfig(callerUid);
    } catch (error) {
      console.error('Error updating ZEGO config in Firestore:', error);
      throw error;
    }
  }
}

module.exports = new NewopZegoService();