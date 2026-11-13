const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: NEWOP ADMIN PERMISSIONS (newop_admins)
// Dedicated collection to lock Newop master access strictly to authorized UIDs
// ============================================================================
const newopAdminSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true }, // Permanent Firebase Auth UID
    adminName: { type: String, default: 'Super Master' },
    role: { type: String, enum: ['super_admin', 'super_master', 'admin'], default: 'super_admin' },
    passwordHash: { type: String, default: '123456' },
    isActive: { type: Boolean, default: true, index: true },
    grantedBy: { type: String, default: 'owner' },
    grantedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'newop_admins' });

const NewopAdmin = mongoose.models.NewopAdmin || mongoose.model('NewopAdmin', newopAdminSchema);

module.exports = NewopAdmin;
