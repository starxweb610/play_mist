const express = require('express');
const router  = express.Router();
const publicController = require('../controllers/publicController');

// GET /
router.get('/', publicController.getHome);

// GET /games — game library / discovery page
router.get('/games', publicController.getGames);

// GET /games/:slug — game detail page
router.get('/games/:slug', publicController.getGameDetail);

// GET /play/:slug — in-browser WebGL player
router.get('/play/:slug', publicController.getPlayGame);

// GET /privacy-policy
router.get('/privacy-policy', publicController.getPrivacyPolicy);

module.exports = router;
