const https = require('https');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { auth, isFirebaseInitialized } = require('../firebase');
const User = require('../models/User');
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
    const cleanToken = token.trim();
    if (!cleanToken) {
        throw new Error('Empty Firebase ID token');
    }

    // Primary path: Firebase Admin SDK (if service account is configured)
    if (isFirebaseInitialized() && auth) {
        const decoded = await auth.verifyIdToken(cleanToken);
        const uid = String(decoded?.uid || decoded?.sub || '').trim();
        if (!uid) {
            throw new Error('Firebase token missing UID');
        }
        return {
            ...decoded,
            uid
        };
    }

    // Secondary path: Cryptographic RS256 verification against Google's official x509 public certificates
    const decodedComplete = jwt.decode(cleanToken, { complete: true });
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

    const payload = jwt.verify(cleanToken, certPem, {
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

function extractBearerToken(req) {
    const authHeader = String(req?.headers?.['authorization'] || '').trim();
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        return authHeader.slice(7).trim();
    }
    return '';
}

/**
 * 100% Zero-Trust Strict Auth Middleware (No header/body/query UID spoofing allowed).
 * Requires a valid, cryptographically signed Firebase Auth Bearer token.
 */
async function verifyStrictFirebaseToken(req, res, next) {
    try {
        const token = extractBearerToken(req);

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
        req.verifiedUid = verifiedUid;
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
 * Verifies that the cryptographically authenticated Firebase UID belongs to
 * an active, registered, non-banned user inside MongoDB `users`.
 */
async function requireRegisteredMongoUser(req, res, next) {
    try {
        const verifiedUid = String(req.callerUid || req.verifiedUid || '').trim();
        if (!verifiedUid) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Verified Firebase UID missing.'
            });
        }

        const userDoc = await User.findOne({ uid: verifiedUid })
            .select('uid numericId name avatarUrl role isBanned isSeller isMerchant')
            .lean();

        if (!userDoc) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden: User account is not registered in this application.'
            });
        }

        if (userDoc.isBanned) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden: Your account has been suspended or banned.'
            });
        }

        req.authUser = userDoc;
        req.verifiedUid = userDoc.uid;
        req.callerUid = userDoc.uid;
        return next();
    } catch (err) {
        console.error('❌ [Mongo User Auth] Verification error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Internal user verification error.'
        });
    }
}

/**
 * Combined Strict Auth Gate:
 * 1) Cryptographically verifies Firebase ID Token
 * 2) Confirms user exists & is not banned in MongoDB `users`
 */
function verifyAuthenticatedUser(req, res, next) {
    return verifyStrictFirebaseToken(req, res, () => requireRegisteredMongoUser(req, res, next));
}

/**
 * Strict Auth Middleware for General User APIs (legacy alias with zero UID fallbacks).
 */
function verifyAuthToken(req, res, next) {
    return verifyAuthenticatedUser(req, res, next);
}

/**
 * Zero-Trust Auth Middleware for Newop Admin APIs.
 * Verifies Firebase ID Token + MongoDB user status + Newop Admin Master whitelist.
 */
function requireNewopAdmin(req, res, next) {
    return verifyStrictFirebaseToken(req, res, () => {
        return requireRegisteredMongoUser(req, res, async () => {
            try {
                const cleanUid = String(req.callerUid || '').trim();
                const isAuth = await NewopAuthService.isAuthorizedNewopAdmin(cleanUid);
                if (!isAuth) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied: This user UID does not have backend permissions for Newop.'
                    });
                }
                return next();
            } catch (e) {
                console.error('❌ [Newop Auth] requireNewopAdmin error:', e);
                return res.status(500).json({ success: false, error: 'Internal server authorization error' });
            }
        });
    });
}

/**
 * Verifies WebSocket upgrade requests (Authorization: Bearer <token> or ?token=<token>).
 * Enforces Firebase ID Token + active non-banned MongoDB user record.
 */
async function verifyWebSocketConnection(req, options = {}) {
    const { requireMongoUser = true } = options;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const headerToken = extractBearerToken(req);
    const queryToken = String(urlObj.searchParams.get('token') || '').trim();
    const rawToken = headerToken || queryToken;

    if (!rawToken) {
        const err = new Error('Unauthorized: Missing Firebase ID token');
        err.statusCode = 401;
        throw err;
    }

    const decoded = await verifyFirebaseIdTokenCryptographically(rawToken);
    const verifiedUid = String(decoded?.uid || decoded?.sub || '').trim();
    if (!verifiedUid) {
        const err = new Error('Unauthorized: Token missing verified UID');
        err.statusCode = 401;
        throw err;
    }

    let userDoc = null;
    if (requireMongoUser) {
        userDoc = await User.findOne({ uid: verifiedUid })
            .select('uid numericId name avatarUrl coins role isBanned')
            .lean();
        if (!userDoc) {
            const err = new Error('Forbidden: User account not registered');
            err.statusCode = 403;
            throw err;
        }
        if (userDoc.isBanned) {
            const err = new Error('Forbidden: Account is banned');
            err.statusCode = 403;
            throw err;
        }
    }

    return {
        verifiedUid,
        decoded,
        userDoc
    };
}

module.exports = {
    verifyFirebaseIdTokenCryptographically,
    extractBearerToken,
    verifyStrictFirebaseToken,
    requireRegisteredMongoUser,
    verifyAuthenticatedUser,
    extractVerifiedUidOptional: verifyAuthenticatedUser,
    verifyAuthToken,
    requireNewopAdmin,
    verifyWebSocketConnection
};
