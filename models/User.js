const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    uid: { type: String, default: '' },
    name: { type: String, default: 'User' },
    profilePhoto: { type: String, default: '' },
    email: { type: String, default: '', index: true },
    googleAccount: { type: String, default: '' },
    gender: { type: String, default: 'Male' },
    dob: { type: String, default: '2000-01-01' },
    country: { type: String, default: 'India' },
    coins: { type: Number, default: 1000 },
    diamonds: { type: Number, default: 0 },
    userLevel: { type: Number, default: 1 },
    userXp: { type: Number, default: 0 },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 1 },
    friendsCount: { type: Number, default: 0 },
    visitorsCount: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: '' },
    deviceId: { type: String, default: '' },
    sessionId: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
