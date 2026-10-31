const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let isInitialized = false;

try {
    let credential = null;

    // 1. Check if service account JSON is passed directly as environment variable (Render / Heroku)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            credential = admin.credential.cert(parsed);
            console.log('🔥 [Firebase Admin] Initialized from FIREBASE_SERVICE_ACCOUNT environment variable');
        } catch (parseErr) {
            console.warn('⚠️ [Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', parseErr.message);
        }
    }

    // 2. Check Render Secret File path (/etc/secrets/serviceAccountKey.json)
    if (!credential) {
        const renderSecretPath = '/etc/secrets/serviceAccountKey.json';
        if (fs.existsSync(renderSecretPath)) {
            const serviceAccount = require(renderSecretPath);
            credential = admin.credential.cert(serviceAccount);
            console.log('🔥 [Firebase Admin] Initialized from Render Secret File (/etc/secrets/serviceAccountKey.json)');
        }
    }

    // 3. Check local directory (./serviceAccountKey.json)
    if (!credential) {
        const localPaths = [
            path.join(__dirname, 'serviceAccountKey.json'),
            path.join(__dirname, '..', 'serviceAccountKey.json'),
            path.join(process.cwd(), 'serviceAccountKey.json')
        ];

        for (const p of localPaths) {
            if (fs.existsSync(p)) {
                const serviceAccount = require(p);
                credential = admin.credential.cert(serviceAccount);
                console.log(`🔥 [Firebase Admin] Initialized from local file (${p})`);
                break;
            }
        }
    }

    if (credential) {
        admin.initializeApp({
            credential: credential
        });
        isInitialized = true;
        console.log('✅ [Firebase Admin SDK] Successfully initialized & ready for Google Auth Token verification');
    } else {
        console.warn('⚠️ [Firebase Admin SDK] serviceAccountKey.json not found yet! Please place serviceAccountKey.json in the backend folder or add as a Secret File on Render.');
    }
} catch (error) {
    console.error('❌ [Firebase Admin SDK] Initialization error:', error.message);
}

module.exports = {
    admin,
    auth: isInitialized ? admin.auth() : null,
    isFirebaseInitialized: () => isInitialized
};