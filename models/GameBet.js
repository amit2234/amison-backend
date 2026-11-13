const mongoose = require('mongoose');

const gameBetSchema = new mongoose.Schema({
    roundId: { type: Number, required: true, index: true },
    gameId: { type: String, default: 'galaxy_star', index: true },
    uid: { type: String, required: true, index: true },
    numericId: { type: Number },
    userName: { type: String, default: 'Player' },
    userAvatar: { type: String, default: '' },
    planet: { type: String, required: true, index: true },
    betAmount: { type: Number, required: true, min: 1 },
    txId: { type: String, required: true, unique: true, index: true },
    isWinner: { type: Boolean, default: false },
    payoutAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['ACCEPTED', 'SETTLED', 'CANCELLED'], default: 'ACCEPTED' },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

gameBetSchema.index({ roundId: 1, planet: 1 });
gameBetSchema.index({ uid: 1, createdAt: -1 });

module.exports = mongoose.models.GameBet || mongoose.model('GameBet', gameBetSchema);
