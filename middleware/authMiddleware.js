const { admin, auth, isFirebaseInitialized } = require('../firebase');
const NewopAuthService = require('../services/newopAuthService');

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

        // 1. If Firebase Admin is initialized & ID Token is passed, cryptographically verify it
        if (token && isFirebaseInitialized() && auth) {
            try {
                const decodedToken = await auth.verifyIdToken(token);
                req.user = decodedToken;
                req.callerUid = String(decodedToken.uid).trim();
                return next();
            } catch (tokenErr) {
                console.warn('⚠️ [Zero-Trust Auth] Firebase ID Token verification failed:', tokenErr.message);
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized: Invalid or expired Firebase ID token.'
                });
            }
        }

        // 2. Fallback to X-User-UID header if provided (e.g. initial dev handshake)
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
        if (token && isFirebaseInitialized() && auth) {
            try {
                const decodedToken = await auth.verifyIdToken(token);
                req.user = decodedToken;
                callerUid = String(decodedToken.uid).trim();
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

module.exports = {
    verifyAuthToken,
    requireNewopAdmin
};
