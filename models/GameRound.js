const mongoose = require('mongoose');

const gameRoundSchema = new mongoose.Schema({
    gameId: { type: String, default: 'galaxy_star', index: true },
    roundId: { type: Number, required: true, unique: true, index: true },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    winningPlanet: { type: String, default: '' },
    multiplier: { type: Number, default: 1 },
    totalBetPool: { type: Number, default: 0 },
    totalPayout: { type: Number, default: 0 },
    planetPools: {
        type: Map,
        of: Number,
        default: {}
    },
    status: { type: String, enum: ['BETTING', 'LOCKED', 'RESULT', 'COMPLETED'], default: 'BETTING' }
}, { timestamps: true });

module.exports = mongoose.models.GameRound || mongoose.model('GameRound', gameRoundSchema);
