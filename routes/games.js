const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

router.get('/', gameController.getGames);
router.post('/', gameController.addGame);
router.patch('/:gameId/status', gameController.toggleGameStatus);

module.exports = router;