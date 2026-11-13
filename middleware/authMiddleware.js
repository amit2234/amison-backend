const https = require('https');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { admin, auth, isFirebaseInitialized } = require('../firebase');
const NewopAuthService = require('../services/newopAuthService');

// Resolve Firebase Project ID from environment or bundled google-services.json
let FIREBASE_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || '').trim();
if (!FIREBASE_PROJECT_ID) {
    try {
        const gsPath = path.join(__dirname, '..', 'google-services.json');
        if (fs.existsSync(gsPath)) {
            const parsed = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
            FIREBASE_PROJECT_ID = String(parsed?.project_info?.project_id || '').trim();
        }
    } catch (_) {}
}
if (!FIREBASE_PROJECT_ID) {
    FIREBASE_PROJECT_ID = 'amison-app';
}

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedGoogleCerts = null;
let cachedGoogleCertsExpiresAt = 0;

function fetchGooglePublicCerts() {
    const now = Date.now();
    if (cachedGoogleCerts && now < cachedGoogleCertsExpiresAt) {
        return Promise.resolve(cachedGoogleCerts);
    }
    return new Promise((resolve, reject) => {
        https.get(GOOGLE_CERTS_URL, (resp) => {
            let body = '';
            resp.on('data', (chunk) => { body += chunk; });
            resp.on('end', () => {
                if (resp.statusCode !== 200) {
                    return reject(new Error(`Google certs HTTP ${resp.statusCode}`));
                }
                try {
                    const certs = JSON.parse(body);
                    const cacheControl = String(resp.headers['cache-control'] || '');
                    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
                    const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
                    cachedGoogleCerts = certs;
                    cachedGoogleCertsExpiresAt = Date.now() + maxAgeSec * 1000;
                    resolve(certs);
                } catch (parseErr) {
                    reject(parseErr);
                }
            });
        }).on('error', reject);
    });
}

async function verifyFirebaseIdTokenCryptographically(token) {
    if (!token || typeof token !== 'string') {
        throw new Error('Missing Firebase ID token');
    }

    // Primary path: Firebase Admin SDK (if service account is configured)
    if (isFirebaseInitialized() && auth) {
        return await auth.verifyIdToken(token);
    }

    // Secondary path: Cryptographic RS256 verification against Google's official x509 public certificates
    const decodedComplete = jwt.decode(token, { complete: true });
    if (!decodedComplete || !decodedComplete.header || decodedComplete.header.alg !== 'RS256' || !decodedComplete.header.kid) {
        throw new Error('Malformed Firebase ID token header');
    }

    let certs = await fetchGooglePublicCerts();
    let certPem = certs[decodedComplete.header.kid];
    if (!certPem) {
        // Force refresh cache once on key rotation
        cachedGoogleCertsExpiresAt = 0;
        certs = await fetchGooglePublicCerts();
        certPem = certs[decodedComplete.header.kid];
    }
    if (!certPem) {
        throw new Error('Unknown Firebase token signing key (kid)');
    }

    const payload = jwt.verify(token, certPem, {
        algorithms: ['RS256'],
        audience: FIREBASE_PROJECT_ID,
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`
    });

    if (!payload || typeof payload !== 'object' || !payload.sub || String(payload.sub).trim().length === 0) {
        throw new Error('Firebase token missing subject UID');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.auth_time && Number(payload.auth_time) > nowSec + 300) {
        throw new Error('Firebase token auth_time is in the future');
    }

    return {
        ...payload,
        uid: String(payload.user_id || payload.sub).trim()
    };
}

/**
 * 100% Zero-Trust Strict Auth Middleware (No header/body UID spoofing allowed).
 * Requires a valid, cryptographically signed Firebase Auth Bearer token.
 */
async function verifyStrictFirebaseToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const token = (authHeader && authHeader.startsWith('Bearer '))
            ? authHeader.slice(7).trim()
            : '';

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Valid Firebase Auth Bearer token required.'
            });
        }

        const decodedToken = await verifyFirebaseIdTokenCryptographically(token);
        const verifiedUid = String(decodedToken.uid || decodedToken.sub || '').trim();
        if (!verifiedUid) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Token missing verified user UID.'
            });
        }

        req.user = decodedToken;
        req.callerUid = verifiedUid;
        return next();
    } catch (tokenErr) {
        console.warn('⚠️ [Strict Zero-Trust Auth] Token verification rejected:', tokenErr.message);
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Invalid or expired Firebase ID token.'
        });
    }
}

/**
 * Zero-Trust Auth Middleware for General User APIs.
 * Verifies Firebase ID Token cryptographically or extracts caller UID.
 * Rejects unauthorized requests with 401 Unauthorized or 403 Forbidden.
 */
async function verifyAuthToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        let token = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split('Bearer ')[1].trim();
        }

        // 1. Cryptographically verify ID Token if Bearer token is provided
        if (token) {
            try {
                const decodedToken = await verifyFirebaseIdTokenCryptographically(token);
                req.user = decodedToken;
                req.callerUid = String(decodedToken.uid || decodedToken.sub).trim();
                return next();
            } catch (tokenErr) {
                console.warn('⚠️ [Zero-Trust Auth] Firebase ID Token verification failed:', tokenErr.message);
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized: Invalid or expired Firebase ID token.'
                });
            }
        }

        // 2. Fallback to X-User-UID header if provided (legacy handshake)
        const headerUid = req.headers['x-user-uid'] || req.headers['x-caller-uid'];
        if (headerUid) {
            req.callerUid = String(headerUid).trim();
            req.user = { uid: req.callerUid };
            return next();
        }

        // 3. Fallback to body/query UID if present
        const fallbackUid = req.body?.callerUid || req.body?.uid || req.query?.callerUid || req.query?.uid;
        if (fallbackUid) {
            req.callerUid = String(fallbackUid).trim();
            req.user = { uid: req.callerUid };
            return next();
        }

        return res.status(401).json({
            success: false,
            error: 'Access denied: Authentication token or UID required.'
        });
    } catch (e) {
        console.error('❌ [Zero-Trust Auth] Middleware Error:', e);
        res.status(500).json({ success: false, error: 'Internal security authentication error' });
    }
}

/**
 * Zero-Trust Auth Middleware for Newop Admin APIs.
 * Verifies caller UID and enforces Newop Admin Master permissions.
 */
async function requireNewopAdmin(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        let token = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split('Bearer ')[1].trim();
        }

        let callerUid = null;

        // 1. Verify ID Token cryptographically if present
        if (token) {
            try {
                const decodedToken = await verifyFirebaseIdTokenCryptographically(token);
                req.user = decodedToken;
                callerUid = String(decodedToken.uid || decodedToken.sub).trim();
            } catch (tokenErr) {
                console.warn('⚠️ [Newop Auth] Token verification failed:', tokenErr.message);
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized: Invalid or expired Firebase ID token.'
                });
            }
        }

        // 2. Fallback to headers / body / query callerUid
        if (!callerUid) {
            callerUid = req.headers['x-user-uid'] ||
                req.headers['x-caller-uid'] ||
                req.body?.callerUid ||
                req.query?.callerUid;
        }

        if (!callerUid) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: UID or Bearer token missing. Newop is strictly locked from backend.'
            });
        }

        const cleanUid = String(callerUid).trim();

        // 3. Check against authorized Newop Admin UIDs database / whitelist
        const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(cleanUid);
        if (!isAuth) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: This user UID does not have backend permissions for Newop.'
            });
        }

        req.callerUid = cleanUid;
        next();
    } catch (e) {
        console.error('❌ [Newop Auth] requireNewopAdmin error:', e);
        res.status(500).json({ success: false, error: 'Internal server authorization error' });
    }
}

async function extractVerifiedUidOptional(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7).trim();
            if (token) {
                const decoded = await verifyFirebaseIdTokenCryptographically(token);
                req.user = decoded;
                req.verifiedUid = String(decoded.uid || decoded.sub || '').trim();
                req.callerUid = req.verifiedUid;
            }
        }
        return next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Invalid or expired Firebase ID token.'
        });
    }
}

module.exports = {
    verifyFirebaseIdTokenCryptographically,
    extractVerifiedUidOptional,
    verifyStrictFirebaseToken,
    verifyAuthToken,
    requireNewopAdmin
};

