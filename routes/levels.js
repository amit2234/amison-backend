const express = require('express');
const router = express.Router();
const LevelController = require('../controllers/levelController');

// Public Level endpoints for App Client
router.get('/all', LevelController.getAllLevels);
router.get('/rules', LevelController.getLevelRules);
router.get('/', LevelController.getLevelsByCategory);
router.post('/calculate', LevelController.calculateLevel);

module.exports = router;