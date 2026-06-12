const db = require('../../config/database');
const jwt = require('jsonwebtoken');

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
      'SELECT id, username, email, credits FROM users WHERE id = ?',
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(rows[0]);
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

    // Get the game cost
    const [games] = await db.query(
      'SELECT credits_cost, type FROM games WHERE id = ?',
      [gameId]
    );

    if (!games.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const cost = games[0].credits_cost !== null ? games[0].credits_cost : (games[0].type === 'premium' ? 25 : 5);

    // Atomic conditional deduction — a read-then-write here can double-spend
    // under concurrent requests. COALESCE patches legacy NULL balances.
    const [result] = await db.query(
      `UPDATE users
       SET credits = COALESCE(credits, 1000) - ?
       WHERE id = ? AND COALESCE(credits, 1000) >= ?`,
      [cost, userId, cost]
    );

    if (result.affectedRows === 0) {
      const [users] = await db.query('SELECT credits FROM users WHERE id = ?', [userId]);
      if (!users.length) {
        return res.status(404).json({ error: 'User not found' });
      }
      const balance = users[0].credits !== null ? users[0].credits : 1000;
      return res.status(400).json({ error: 'Insufficient credits', balance, cost });
    }

    const [updated] = await db.query('SELECT credits FROM users WHERE id = ?', [userId]);
    const newCredits = updated[0].credits;

    // Record the transaction
    try {
      await db.query(
        'INSERT INTO credit_transactions (user_id, game_id, credits_used) VALUES (?, ?, ?)',
        [userId, gameId, cost]
      );
    } catch (txErr) {
      console.error('Failed to log credit transaction:', txErr.message);
    }

    return res.json({ success: true, balance: newCredits, cost });
  } catch (err) {
    console.error('deductCredits error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── Rewarded-ad credits ──────────────────────────────────────────────────────
const REWARDED_AD_CREDITS = 200;
const REWARDED_ADS_DAILY_CAP = 20;

/**
 * POST /api/v1/user/reward-credits
 * Grants credits for a completed rewarded ad. The server owns the amount;
 * the client only reports the event. Rewards are recorded in
 * credit_transactions as negative credits_used with game_id NULL, which
 * also powers the per-day cap.
 *
 * NOTE: for production-grade fraud resistance, verify rewards via AdMob
 * server-side verification (SSV) callbacks instead of trusting the client.
 */
exports.rewardCredits = async (req, res) => {
  try {
    const userId = req.user.id;

    const [todayRewards] = await db.query(
      `SELECT COUNT(*) AS c FROM credit_transactions
       WHERE user_id = ? AND credits_used < 0 AND created_at >= CURDATE()`,
      [userId]
    );
    if (todayRewards[0].c >= REWARDED_ADS_DAILY_CAP) {
      return res.status(429).json({ error: 'Daily ad reward limit reached' });
    }

    const [result] = await db.query(
      'UPDATE users SET credits = COALESCE(credits, 1000) + ? WHERE id = ?',
      [REWARDED_AD_CREDITS, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    try {
      await db.query(
        'INSERT INTO credit_transactions (user_id, game_id, credits_used) VALUES (?, NULL, ?)',
        [userId, -REWARDED_AD_CREDITS]
      );
    } catch (txErr) {
      console.error('Failed to log reward transaction:', txErr.message);
    }

    const [updated] = await db.query('SELECT credits FROM users WHERE id = ?', [userId]);
    return res.json({ success: true, balance: updated[0].credits, amount: REWARDED_AD_CREDITS });
  } catch (err) {
    console.error('rewardCredits error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT t.id, t.credits_used, t.created_at, g.title AS gamename, g.id AS game_id
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
