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

const analyticsApi      = require('../controllers/api/analyticsApi');
const ticketsApi        = require('../controllers/api/ticketsApi');
const gamesApi          = require('../controllers/api/gamesApi');
const authApi           = require('../controllers/api/authApi');
const adsApi            = require('../controllers/api/adsApi');
const streakApi         = require('../controllers/api/streakApi');
const dailyPickApi      = require('../controllers/api/dailyPickApi');
const achievementsApi   = require('../controllers/api/achievementsApi');
const challengeApi      = require('../controllers/api/challengeApi');
const notificationsApi  = require('../controllers/api/notificationsApi');
const profileApi        = require('../controllers/api/profileApi');
const gameSaveApi       = require('../controllers/api/gameSaveApi');
const gameXpApi         = require('../controllers/api/gameXpApi');
const gameFunnelApi     = require('../controllers/api/gameFunnelApi');
const gameShopApi       = require('../controllers/api/gameShopApi');
const multiplayerApi    = require('../controllers/api/multiplayerApi');
const appConfigApi      = require('../controllers/api/appConfigApi');
const { verifyJwt }     = require('../middleware/auth');
const { avatarUpload }  = require('../config/upload');

// Multer errors (size cap, wrong type) must surface as clean 400s, not 500s.
const avatarUploadGuard = (req, res, next) =>
  avatarUpload.single('avatar')(req, res, (err) =>
    err ? res.status(400).json({ error: err.message }) : next());

// ─── /api/v1 routes (Unity client & React client) ────────────────────────────

// Auth endpoints
v1Router.post('/auth/check-username', authApi.checkUsername);
v1Router.post('/auth/register', authApi.register);
v1Router.post('/auth/refresh', authApi.refresh);
v1Router.post('/auth/gpgs', authApi.gpgsAuth);
v1Router.post('/auth/gpgs/avatar', verifyJwt, authApi.gpgsSyncAvatar);
v1Router.post('/auth/web-link/start',   authApi.webLinkStart);
v1Router.get ('/auth/web-link/status',  authApi.webLinkStatus);
v1Router.post('/auth/web-link/approve', verifyJwt, authApi.webLinkApprove);

// Image/file proxy to bypass Nginx regex interception
v1Router.get('/image-proxy', gamesApi.imageProxy);

// App version / force-update check — public, must work before login too
v1Router.get('/app-config', appConfigApi.getAppConfig);

/**
 * GET /api/v1/all-games
 * Returns a raw JSON array of active games.
 * Protected by JWT authorization.
 */
v1Router.get('/all-games', verifyJwt, gamesApi.getAllGames);
v1Router.get('/latest-games', verifyJwt, gamesApi.getLatestGames);
v1Router.get('/popular-games', verifyJwt, gamesApi.getPopularGames);
v1Router.get('/genres', verifyJwt, gamesApi.getGenres);

// Star ratings — user-submitted, prompted by the app after repeat launches
v1Router.post('/games/:id/rate', verifyJwt, gamesApi.rateGame);

// Cloud save: opaque per-user per-game JSON blob, called by the game itself
// via the native Playmist SDK bridge (not the app UI directly)
v1Router.post('/games/:gameId/save', verifyJwt, gameSaveApi.saveGameData);
v1Router.get ('/games/:gameId/save', verifyJwt, gameSaveApi.loadGameData);
v1Router.post('/games/:gameId/xp-event',   verifyJwt, gameXpApi.reportEvent);
v1Router.get ('/games/:gameId/leaderboard', verifyJwt, gameXpApi.getLeaderboard);
v1Router.post('/games/:gameId/track-event', verifyJwt, gameFunnelApi.trackEvent);
v1Router.post('/games/:gameId/purchase',    verifyJwt, gameShopApi.purchase);

// User profile and credits
v1Router.get('/user/profile',       verifyJwt, authApi.getProfile);
v1Router.get('/user/transactions',  verifyJwt, authApi.getTransactions);
v1Router.post('/user/deduct-credits', verifyJwt, authApi.deductCredits);
v1Router.get('/user/tickets',       verifyJwt, ticketsApi.getUserTickets);

// Profile settings: display name/bio, custom avatar, voluntary email linking
v1Router.post('/user/profile/update',   verifyJwt, profileApi.updateProfile);
v1Router.post('/user/avatar',           verifyJwt, avatarUploadGuard, profileApi.uploadAvatar);
v1Router.post('/user/email/send-otp',   verifyJwt, profileApi.sendEmailOtp);
v1Router.post('/user/email/verify-otp', verifyJwt, profileApi.verifyEmailOtp);
v1Router.get('/user/achievements',  verifyJwt, achievementsApi.getUserAchievements);

// Streak / daily check-in
v1Router.post('/user/daily-checkin', verifyJwt, streakApi.dailyCheckin);
v1Router.get('/user/streak',         verifyJwt, streakApi.getStreak);

// Daily free pick
v1Router.get('/daily-pick', verifyJwt, dailyPickApi.getDailyPick);

// Daily challenge
v1Router.get('/daily-challenge',       verifyJwt, challengeApi.getChallenge);
v1Router.post('/daily-challenge/claim', verifyJwt, challengeApi.claimChallenge);

// AdMob rewarded-ad server-side verification (SSV) callback — called by
// Google's ad servers directly, authenticated via signature, not JWT.
v1Router.get('/ads/ssv-callback', adsApi.ssvCallback);

// Push notifications
v1Router.post('/push-token',                verifyJwt, notificationsApi.registerToken);
v1Router.get ('/notifications',             verifyJwt, notificationsApi.getNotifications);
v1Router.post('/notifications/mark-read',  verifyJwt, notificationsApi.markAllRead);

// Multiplayer signaling — mints a short-lived token for the WebRTC signaling server
v1Router.get('/multiplayer/token', verifyJwt, multiplayerApi.getSignalingToken);

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

    // users: XP, level, streak columns
    const xpMigrated       = await migrateColumn('users', 'xp',               'INT DEFAULT 0 AFTER credits');
    const levelMigrated    = await migrateColumn('users', 'level',             'INT DEFAULT 1 AFTER xp');
    const streakMigrated   = await migrateColumn('users', 'current_streak',    'INT DEFAULT 0 AFTER level');
    const longestMigrated  = await migrateColumn('users', 'longest_streak',    'INT DEFAULT 0 AFTER current_streak');
    const lastDateMigrated = await migrateColumn('users', 'last_streak_date',  'DATE DEFAULT NULL AFTER longest_streak');

    // credit_transactions table (created via schema.sql for new installs; add for existing DBs)
    await db.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id                INT PRIMARY KEY AUTO_INCREMENT,
        user_id           INT NOT NULL,
        game_id           INT DEFAULT NULL,
        credits_used      INT NOT NULL,
        ad_transaction_id VARCHAR(255) DEFAULT NULL UNIQUE,
        source            ENUM('game','ad','streak','achievement','challenge','welcome','other') DEFAULT 'game',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
      )
    `);

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

    // Add source column to existing credit_transactions tables
    const sourceMigrated = await migrateColumn('credit_transactions', 'source',
      "ENUM('game','ad','streak','achievement','challenge','welcome','other') DEFAULT 'game'");

    // daily_picks, achievements, user_achievements, daily_challenges, user_challenge_completions
    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_picks (
        id        INT PRIMARY KEY AUTO_INCREMENT,
        game_id   INT NOT NULL,
        pick_date DATE NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id             INT PRIMARY KEY AUTO_INCREMENT,
        key_name       VARCHAR(80)  NOT NULL UNIQUE,
        name           VARCHAR(120) NOT NULL,
        description    TEXT,
        xp_reward      INT DEFAULT 0,
        credits_reward INT DEFAULT 0,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed achievement definitions (safe — INSERT IGNORE skips existing rows)
    await db.query(`
      INSERT IGNORE INTO achievements (key_name, name, description, xp_reward, credits_reward) VALUES
      ('first_game',      'Into the Mist',      'Play your first game',                   100, 50),
      ('games_5',         'Getting Warm',        'Play 5 different games',                 150, 75),
      ('games_25',        'Mist Walker',         'Play 25 games',                          300, 150),
      ('streak_3',        'On a Roll',           'Maintain a 3-day login streak',          100, 50),
      ('streak_7',        'Week of Mist',        'Maintain a 7-day login streak',          250, 150),
      ('streak_30',       'Mist Devotee',        'Maintain a 30-day login streak',         500, 500),
      ('first_premium',   'Premium Taste',       'Play a premium game for the first time', 200, 100),
      ('daily_pick',      'Today''s Pick',       'Play the daily free game',               50,  25),
      ('challenge_first', 'Challenge Accepted',  'Complete your first daily challenge',    100, 50),
      ('challenge_7',     'Challenger',          'Complete 7 daily challenges',            300, 200)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        user_id        INT NOT NULL,
        achievement_id INT NOT NULL,
        earned_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, achievement_id),
        FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE CASCADE,
        FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_challenges (
        id                INT PRIMARY KEY AUTO_INCREMENT,
        challenge_date    DATE         NOT NULL UNIQUE,
        description       VARCHAR(255) NOT NULL,
        requirement_type  ENUM('play_count','play_mini','play_premium') NOT NULL,
        requirement_value INT          DEFAULT 1,
        credits_reward    INT          DEFAULT 150,
        xp_reward         INT          DEFAULT 75,
        created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_challenge_completions (
        user_id      INT NOT NULL,
        challenge_id INT NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, challenge_id),
        FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE,
        FOREIGN KEY (challenge_id) REFERENCES daily_challenges(id) ON DELETE CASCADE
      )
    `);

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
        usersXp: xpMigrated,
        usersLevel: levelMigrated,
        usersStreak: streakMigrated,
        usersLongestStreak: longestMigrated,
        usersLastStreakDate: lastDateMigrated,
        txGameIdNullable: gameIdNullableMigrated,
        txSource: sourceMigrated,
      }
    });
  } catch (err) {
    console.error("Health check diagnostics error:", err);
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
