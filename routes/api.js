/**
 * routes/api.js
 * Public REST API consumed by the Playmist mobile app.
 * Mounted at /api in server.js
 *
 * Versioning:
 *   /api/v1/*  — current Unity client (AppConstants.API_BASE_URL = ".../api/v1/")
 *   /api/*     — direct (analytics, tickets, health)
 */
const express = require('express');
const router = express.Router();
const v1Router = express.Router();

const analyticsApi = require('../controllers/api/analyticsApi');
const ticketsApi = require('../controllers/api/ticketsApi');
const gamesApi = require('../controllers/api/gamesApi');
const authApi = require('../controllers/api/authApi');
const adsApi = require('../controllers/api/adsApi');
const { verifyJwt } = require('../middleware/auth');

// ─── /api/v1 routes (Unity client & React client) ────────────────────────────

// Auth endpoints
v1Router.post('/auth/check-username', authApi.checkUsername);
v1Router.post('/auth/register', authApi.register);
v1Router.post('/auth/refresh', authApi.refresh);

// Image/file proxy to bypass Nginx regex interception
v1Router.get('/image-proxy', gamesApi.imageProxy);

/**
 * GET /api/v1/all-games
 * Returns a raw JSON array of active games.
 * Protected by JWT authorization.
 */
v1Router.get('/all-games', verifyJwt, gamesApi.getAllGames);
v1Router.get('/latest-games', verifyJwt, gamesApi.getLatestGames);
v1Router.get('/popular-games', verifyJwt, gamesApi.getPopularGames);
v1Router.get('/genres', verifyJwt, gamesApi.getGenres);

// User profile and credits
v1Router.get('/user/profile', verifyJwt, authApi.getProfile);
v1Router.get('/user/transactions', verifyJwt, authApi.getTransactions);
v1Router.post('/user/deduct-credits', verifyJwt, authApi.deductCredits);
v1Router.get('/user/tickets', verifyJwt, ticketsApi.getUserTickets);

// AdMob rewarded-ad server-side verification (SSV) callback — called by
// Google's ad servers directly, authenticated via signature, not JWT.
v1Router.get('/ads/ssv-callback', adsApi.ssvCallback);

// Mount versioned router
router.use('/v1', v1Router);

// ─── Analytics ───────────────────────────────────────────────────────────────
// Called when the app is opened by a user
router.post('/analytics/app-open', analyticsApi.logAppOpen);
// Called when a user starts playing a game
router.post('/analytics/game-play', analyticsApi.logGamePlay);

// ─── Tickets (Player Support) ─────────────────────────────────────────────────
router.post('/tickets', ticketsApi.createTicket);

// ─── Health ──────────────────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    const db = require('../config/database');

    // Safe DB migration: Check if 'user_id' column exists in 'analytics_games'
    const [cols] = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analytics_games' AND COLUMN_NAME = 'user_id'`
    );

    let migrated = false;
    if (cols[0].c === 0) {
      // Add column
      await db.query('ALTER TABLE analytics_games ADD COLUMN user_id INT DEFAULT NULL AFTER game_id');
      try {
        // Add foreign key constraint
        await db.query('ALTER TABLE analytics_games ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
      } catch (fkErr) {
        console.warn("Could not add foreign key constraint:", fkErr.message);
      }
      migrated = true;
    }

    // Safe DB migration: Check if 'user_id' column exists in 'analytics_app'
    const [appCols] = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analytics_app' AND COLUMN_NAME = 'user_id'`
    );

    let appMigrated = false;
    if (appCols[0].c === 0) {
      // Add column
      await db.query('ALTER TABLE analytics_app ADD COLUMN user_id INT DEFAULT NULL AFTER device');
      try {
        // Add foreign key constraint
        await db.query('ALTER TABLE analytics_app ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
      } catch (fkErr) {
        console.warn("Could not add foreign key constraint to analytics_app:", fkErr.message);
      }
      appMigrated = true;
    }

    // Safe DB migration for games table columns
    const migrateColumn = async (table, column, definition) => {
      const [columnCheck] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      if (columnCheck[0].c === 0) {
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        return true;
      }
      return false;
    };

    const zipUrlMigrated = await migrateColumn('games', 'zip_url', 'VARCHAR(500) DEFAULT NULL AFTER play_url');
    const secThumbMigrated = await migrateColumn('games', 'secondary_thumbnail', 'VARCHAR(500) DEFAULT NULL AFTER thumbnail_url');
    const promoThumbMigrated = await migrateColumn('games', 'promotional_thumbnail', 'VARCHAR(500) DEFAULT NULL AFTER secondary_thumbnail');
    const featMigrated = await migrateColumn('games', 'is_featured', 'TINYINT(1) DEFAULT 0 AFTER is_active');

    // users.credits (older schemas lack it) + normalize legacy NULL balances
    const creditsMigrated = await migrateColumn('users', 'credits', 'INT DEFAULT 1000 AFTER avatar');
    await db.query('UPDATE users SET credits = 1000 WHERE credits IS NULL');

    // Rewarded-ad transactions have no game: game_id must be nullable
    const [gameIdCol] = await db.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND COLUMN_NAME = 'game_id'`
    );
    let gameIdNullableMigrated = false;
    if (gameIdCol.length && gameIdCol[0].IS_NULLABLE === 'NO') {
      await db.query('ALTER TABLE credit_transactions MODIFY game_id INT NULL');
      gameIdNullableMigrated = true;
    }

    // Status only — no user/game data in the response (this endpoint is public)
    res.json({
      status: 'ok',
      service: 'playmist-api',
      migrated: {
        analyticsGamesUserId: migrated,
        analyticsAppUserId: appMigrated,
        zipUrl: zipUrlMigrated,
        secondaryThumbnail: secThumbMigrated,
        promotionalThumbnail: promoThumbMigrated,
        isFeatured: featMigrated,
        usersCredits: creditsMigrated,
        txGameIdNullable: gameIdNullableMigrated
      }
    });
  } catch (err) {
    console.error("Health check diagnostics error:", err);
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
