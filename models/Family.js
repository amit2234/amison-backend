const mongoose = require('mongoose');

/**
 * Pure MongoDB Family Model (replaces legacy Firestore families collection).
 */
const familySchema = new mongoose.Schema({
    familyId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    tagline: { type: String, default: '', trim: true },
    photoUrl: { type: String, default: '' },
    announcement: { type: String, default: 'Welcome to join my family' },
    xp: { type: Number, default: 0, min: 0 },
    maxXp: { type: Number, default: 5000000 },
    level: { type: String, default: 'Stray Soul' },
    vibe: { type: String, default: 'General' },
    ownerUid: { type: String, required: true, index: true },
    ownerName: { type: String, default: '' },
    ownerAvatar: { type: String, default: '' },
    memberUids: { type: [String], default: [], index: true },
    maxMembers: { type: Number, default: 50 }
}, {
    collection: 'families',
    timestamps: true
});

const Family = mongoose.models.Family || mongoose.model('Family', familySchema);
module.exports = Family;
