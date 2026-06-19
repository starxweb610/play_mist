const db = require('../../config/database');
const jwt = require('jsonwebtoken');
const { grantAchievement } = require('../../utils/achievements');
const { isTodaysDailyPick, handleDailyPickPlay } = require('./dailyPickApi');
const { toLocalDateStr } = require('../../utils/dates');

const accessSecret = process.env.JWT_SECRET || 'playmist_jwt_access_secret_123';
const refreshSecret = process.env.JWT_REFRESH_SECRET || 'playmist_jwt_refresh_secret_123';

exports.checkUsername = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const [rows] = await db.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    return res.json({ taken: rows.length > 0 });
  } catch (err) {
    console.error('checkUsername error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.register = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const email = `${username}@playmist.local`;

    // Double check if username or email already exists
    const [existing] = await db.query(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Insert user (password_hash and avatar can be null)
    const [result] = await db.query(
      'INSERT INTO users (username, email) VALUES (?, ?)',
      [username, email]
    );

    const userId = result.insertId;

    // Generate tokens
    const accessToken = jwt.sign(
      { id: userId, username },
      accessSecret,
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { id: userId, username },
      refreshSecret,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      user: {
        id: userId,
        username,
        credits: 1000
      },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    jwt.verify(refreshToken, refreshSecret, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired refresh token' });
      }

      const accessToken = jwt.sign(
        { id: decoded.id, username: decoded.username },
        accessSecret,
        { expiresIn: '1h' }
      );

      return res.json({ accessToken });
    });
  } catch (err) {
    console.error('refresh token error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT id, username, email, credits, xp, level,
              current_streak, longest_streak, last_streak_date
       FROM users WHERE id = ?`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = rows[0];
    const today    = toLocalDateStr();
    const lastDate = u.last_streak_date ? toLocalDateStr(u.last_streak_date) : null;

    return res.json({
      id:            u.id,
      username:      u.username,
      email:         u.email,
      credits:       u.credits,
      xp:            u.xp    ?? 0,
      level:         u.level ?? 1,
      currentStreak: u.current_streak  ?? 0,
      longestStreak: u.longest_streak  ?? 0,
      claimedToday:  lastDate === today,
    });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.deductCredits = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.body;

    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required' });
    }

    const [games] = await db.query(
      'SELECT credits_cost, type FROM games WHERE id = ?',
      [gameId]
    );

    if (!games.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Check if this is today's daily pick — server-authoritative, client cannot fake it.
    // Wrapped in try/catch: if the daily_picks table doesn't exist yet (migrations pending)
    // we degrade gracefully instead of crashing the whole deduction.
    let freeToday = false;
    try { freeToday = await isTodaysDailyPick(gameId); } catch (_) {}

    const baseCost  = games[0].credits_cost !== null
      ? games[0].credits_cost
      : (games[0].type === 'premium' ? 25 : 5);
    const cost = freeToday ? 0 : baseCost;

    if (cost > 0) {
      // Atomic conditional deduction — prevents double-spend under concurrent requests
      const [result] = await db.query(
        `UPDATE users
         SET credits = COALESCE(credits, 1000) - ?
         WHERE id = ? AND COALESCE(credits, 1000) >= ?`,
        [cost, userId, cost]
      );

      if (result.affectedRows === 0) {
        const [users] = await db.query('SELECT credits FROM users WHERE id = ?', [userId]);
        if (!users.length) return res.status(404).json({ error: 'User not found' });
        const balance = users[0].credits !== null ? users[0].credits : 1000;
        return res.status(400).json({ error: 'Insufficient credits', balance, cost });
      }
    }

    const [updated] = await db.query('SELECT credits, xp, level FROM users WHERE id = ?', [userId]);

    // Record the transaction
    try {
      await db.query(
        `INSERT INTO credit_transactions (user_id, game_id, credits_used, source)
         VALUES (?, ?, ?, 'game')`,
        [userId, gameId, cost]
      );
    } catch (txErr) {
      console.error('Failed to log credit transaction:', txErr.message);
    }

    // Fire achievement checks (non-blocking — failures don't affect the response)
    const newAchievements = [];
    try {
      // Count total distinct games played by this user
      const [playCount] = await db.query(
        `SELECT COUNT(DISTINCT game_id) AS c FROM credit_transactions
         WHERE user_id = ? AND source = 'game'`,
        [userId]
      );
      const total = playCount[0].c;

      if (total === 1) {
        const r = await grantAchievement(userId, 'first_game'); if (r.granted) newAchievements.push(r.achievement);
      }
      if (total >= 5) {
        const r = await grantAchievement(userId, 'games_5');   if (r.granted) newAchievements.push(r.achievement);
      }
      if (total >= 25) {
        const r = await grantAchievement(userId, 'games_25');  if (r.granted) newAchievements.push(r.achievement);
      }
      if (games[0].type === 'premium') {
        const r = await grantAchievement(userId, 'first_premium'); if (r.granted) newAchievements.push(r.achievement);
      }
      if (freeToday) {
        const r = await handleDailyPickPlay(userId, gameId);   if (r.granted) newAchievements.push(r.achievement);
      }
    } catch (achErr) {
      console.error('Achievement check error:', achErr.message);
    }

    // Re-fetch updated credits/xp/level after potential achievement grants
    const [final] = await db.query('SELECT credits, xp, level FROM users WHERE id = ?', [userId]);

    return res.json({
      success:         true,
      balance:         final[0].credits,
      cost,
      freeToday,
      xp:              final[0].xp,
      level:           final[0].level,
      newAchievements,
    });
  } catch (err) {
    console.error('deductCredits error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT t.id, t.credits_used, t.created_at, t.source, g.title AS gamename, g.id AS game_id
       FROM credit_transactions t
       LEFT JOIN games g ON t.game_id = g.id
       WHERE t.user_id = ?
       ORDER BY t.created_at DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getTransactions API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
