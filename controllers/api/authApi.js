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

    // Get the user's current credits
    const [users] = await db.query(
      'SELECT credits FROM users WHERE id = ?',
      [userId]
    );

    if (!users.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentCredits = users[0].credits !== null ? users[0].credits : 1000;

    if (currentCredits < cost) {
      return res.status(400).json({ error: 'Insufficient credits', balance: currentCredits, cost });
    }

    const newCredits = currentCredits - cost;
    await db.query(
      'UPDATE users SET credits = ? WHERE id = ?',
      [newCredits, userId]
    );

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
