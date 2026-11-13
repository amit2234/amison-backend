const User = require('../models/User');

/**
 * Resolves a user document by Permanent Auth UID or 9-digit numericId
 * Enforces Document ID = Auth UID rule across the application.
 */
async function resolveUser(rawId) {
    if (!rawId) return null;
    const clean = String(rawId).trim();
    const numId = Number(clean);
    const query = (!isNaN(numId) && numId > 0 && /^\d+$/.test(clean))
        ? { $or: [{ uid: clean }, { numericId: numId }] }
        : { uid: clean };
    return await User.findOne(query).lean();
}

module.exports = {
    resolveUser
};
