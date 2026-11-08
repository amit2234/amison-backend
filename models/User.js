const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: USERS COLLECTION (100% PURE MONGODB ATLAS ARCHITECTURE)
// User Document Architecture:
// - uid: Permanent Firebase Auth Google UID (Unique Index)
// - email: Verified Google Sign-In Email (Unique Index, 1 Google Account = 1 ID)
// - numericId: 9-digit unique public display ID
// ============================================================================
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    numericId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: "" },
    dob: { type: String, default: "" },
    gender: { type: String, enum: ["Male", "Female", ""], default: "" },
    country: { type: String, default: "India" },
    email: { type: String, default: "", index: true, lowercase: true, trim: true },
    coins: { type: Number, default: 0, min: 0 },
    diamonds: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 1, min: 1 },
    role: { type: String, default: "user" },
    isSeller: { type: Boolean, default: false },
    isMerchant: { type: Boolean, default: false },
    sellerCenterRole: { type: String, default: "" }, // "seller", "marchent", or ""
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
// Note: Indexes for uid, email, and numericId are declared on schema fields above.

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
module.exports.User = User;
module.exports.userSchema = userSchema;