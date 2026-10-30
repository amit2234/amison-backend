const mongoose = require('mongoose');

// ============================================================================
// MONGOOSE SCHEMA: USERS COLLECTION
// User Document Architecture: Document ID = Firebase Auth UID
// 9-digit numericId is purely for display (numericId / displayUserId)
// ============================================================================
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true }, // Permanent Firebase Auth Google UID
    numericId: { type: Number, required: true, unique: true }, // 9-digit unique public display ID
    name: { type: String, required: true, trim: true }, // User Display Name
    avatarUrl: { type: String, default: "" }, // Profile Photo URL (Cloudinary)
    dob: { type: String, default: "" }, // Date of Birth (YYYY-MM-DD)
    gender: { type: String, enum: ["Male", "Female", ""], default: "" }, // Gender
    country: { type: String, default: "India" }, // Country
    email: { type: String, default: "", index: true }, // Google Sign-In Email
    coins: { type: Number, default: 0, min: 0 }, // Gold Coins Balance (Me -> Wallet)
    diamonds: { type: Number, default: 0, min: 0 }, // Diamonds Balance (Me -> Wallet)
    level: { type: Number, default: 1, min: 1 }, // User Level
    role: { type: String, default: "user" }, // user, admin, super_admin, etc.
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

userSchema.index({ uid: 1, email: 1 });

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
module.exports.User = User;
module.exports.userSchema = userSchema;