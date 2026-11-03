const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    imageUrl: {
        type: String,
        default: ''
    },
    gameUrl: {
        type: String,
        default: ''
    },
    minEntryCoins: {
        type: Number,
        default: 100
    },
    earningCoins: {
        type: Number,
        default: 0
    },
    livePlayersCount: {
        type: Number,
        default: 0
    },
    gameRound: {
        type: Number,
        default: 1
    },
    isPinned: {
        type: Boolean,
        default: false
    },
    isBlocked: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Game', GameSchema);