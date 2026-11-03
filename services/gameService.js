const Game = require('../models/Game');

class GameService {
    async getAllGames() {
        let games = await Game.find().sort({ isPinned: -1, createdAt: -1 });
        if (games.length === 0) {
            // Seed initial mini-games
            const initialGames = [
                {
                    gameId: 'game_ludo_king',
                    title: 'Ludo King Live',
                    imageUrl: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?auto=format&fit=crop&w=300&q=80',
                    gameUrl: '/games/ludo/index.html',
                    minEntryCoins: 100,
                    earningCoins: 25000,
                    livePlayersCount: 142,
                    gameRound: 890,
                    isPinned: true,
                    isBlocked: false
                },
                {
                    gameId: 'game_fruit_loop',
                    title: 'Fruit Spin Loop',
                    imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=300&q=80',
                    gameUrl: '/games/fruit_loop/index.html',
                    minEntryCoins: 50,
                    earningCoins: 18400,
                    livePlayersCount: 98,
                    gameRound: 1204,
                    isPinned: true,
                    isBlocked: false
                },
                {
                    gameId: 'game_teen_patti',
                    title: 'Teen Patti Star',
                    imageUrl: 'https://images.unsplash.com/photo-1511193311914-0346f16efe90?auto=format&fit=crop&w=300&q=80',
                    gameUrl: '/games/teen_patti/index.html',
                    minEntryCoins: 500,
                    earningCoins: 52100,
                    livePlayersCount: 210,
                    gameRound: 450,
                    isPinned: false,
                    isBlocked: false
                }
            ];
            games = await Game.insertMany(initialGames);
        }
        return games;
    }

    async createGame(gameData) {
        const existing = await Game.findOne({ gameId: gameData.gameId });
        if (existing) {
            throw new Error(`Game ID ${gameData.gameId} already exists`);
        }
        const newGame = new Game(gameData);
        return await newGame.save();
    }

    async updateGameStatus(gameId, updateFields) {
        const game = await Game.findOneAndUpdate(
            { gameId: gameId },
            { $set: updateFields },
            { new: true }
        );
        if (!game) {
            throw new Error('Game not found');
        }
        return game;
    }
}

module.exports = new GameService();