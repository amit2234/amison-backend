const gameService = require('../services/gameService');

exports.getGames = async (req, res) => {
    try {
        const games = await gameService.getAllGames();
        res.status(200).json({ success: true, games });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.addGame = async (req, res) => {
    try {
        const { gameId, title, imageUrl, gameUrl, minEntryCoins } = req.body;
        if (!title) {
            return res.status(400).json({ success: false, message: 'Game title is required' });
        }
        const gId = gameId || `game_${Date.now().toString().slice(-6)}`;
        const game = await gameService.createGame({
            gameId: gId,
            title,
            imageUrl: imageUrl || '',
            gameUrl: gameUrl || `/games/${gId}/index.html`,
            minEntryCoins: minEntryCoins ? parseInt(minEntryCoins) : 100
        });
        res.status(201).json({ success: true, game });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.toggleGameStatus = async (req, res) => {
    try {
        const { gameId } = req.params;
        const { isPinned, isBlocked } = req.body;
        const updateFields = {};
        if (typeof isPinned === 'boolean') updateFields.isPinned = isPinned;
        if (typeof isBlocked === 'boolean') updateFields.isBlocked = isBlocked;

        const updated = await gameService.updateGameStatus(gameId, updateFields);
        res.status(200).json({ success: true, game: updated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};