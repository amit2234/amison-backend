const mongoose = require('mongoose');
const NewopAdmin = require('../models/NewopAdmin');
const User = require('../models/User');

const getCoreUserModel = () => mongoose.models.User || User;

const NewopAuthService = {
    /**
     * Checks if a user's permanent Auth UID has active Newop permissions
     */
    async isAuthorizedNewopAdmin(uid) {
        if (!uid || typeof uid !== 'string') return false;
        const cleanUid = uid.trim();
        if (!cleanUid) return false;

        // 1. Check newop_admins collection in MongoDB Atlas
        const admin = await NewopAdmin.findOne({ uid: cleanUid, isActive: true }).lean();
        if (admin) return true;

        // 2. Check Core User role for super_admin / super_master
        const CoreUser = getCoreUserModel();
        if (CoreUser) {
            const coreUser = await CoreUser.findOne({ uid: cleanUid }).lean();
            if (coreUser && (coreUser.role === 'super_admin' || coreUser.role === 'super_master')) {
                return true;
            }
        }

        return false;
    }
};

module.exports = NewopAuthService;