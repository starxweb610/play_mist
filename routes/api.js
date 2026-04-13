/**
 * routes/api.js
 * Public REST API consumed by the Playmist mobile app.
 * Mounted at /api in server.js
 *
 * Versioning:
 *   /api/v1/*  — current Unity client (AppConstants.API_BASE_URL = ".../api/v1/")
 *   /api/*     — direct (analytics, tickets, health)
 */
const express    = require('express');
const router     = express.Router();
const v1Router   = express.Router();

const analyticsApi = require('../controllers/api/analyticsApi');
const ticketsApi   = require('../controllers/api/ticketsApi');
const gamesApi     = require('../controllers/api/gamesApi');

// ─── /api/v1 routes (Unity client) ───────────────────────────────────────────

/**
 * GET /api/v1/all-games
 * Returns a raw JSON array of active games.
 * Response fields match GameInfo.cs exactly; no Unity-side changes needed.
 */
v1Router.get('/all-games', gamesApi.getAllGames);

// Mount versioned router
router.use('/v1', v1Router);

// ─── Analytics ───────────────────────────────────────────────────────────────
// Called when the app is opened by a user
router.post('/analytics/app-open',  analyticsApi.logAppOpen);
// Called when a user starts playing a game
router.post('/analytics/game-play', analyticsApi.logGamePlay);

// ─── Tickets (Player Support) ─────────────────────────────────────────────────
router.post('/tickets', ticketsApi.createTicket);

// ─── Health ──────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'playmist-api' }));

module.exports = router;
