const db = require('../../config/database');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { verifyServerAuthCode, GpgsError } = require('../../utils/gpgs');
const { grantAchievement } = require('../../utils/achievements');
const { isTodaysDailyPick, handleDailyPickPlay } = require('./dailyPickApi');
const { toLocalDateStr } = require('../../utils/dates');

const accessSecret = process.env.JWT_SECRET || 'playmist_jwt_access_secret_123';
const refreshSecret = process.env.JWT_REFRESH_SECRET || 'playmist_jwt_refresh_secret_123';

// A user-uploaded profile picture (stored in our R2 bucket under avatars/)
// always wins over the Play Games portrait — PGS syncs must never clobber it.
const isCustomAvatar = (url) => {
  const { keyFromUrl } = require('../../config/r2');
  const key = keyFromUrl(url);
  return !!key && key.startsWith('avatars/');
};

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

// Build a unique username, preferring the PGS gamer tag. Identity uniqueness is
// guaranteed by gpgs_player_id, so on a display-name collision we disambiguate
// rather than reject.
async function resolveUniqueUsername(desired, playerId, excludeUserId = null) {
  const base = (desired || '').trim().slice(0, 60) || 'Player';
  const pid = String(playerId);
  const candidates = [
    base,
    `${base.slice(0, 50)} #${pid.slice(-4)}`,
    `${base.slice(0, 40)} #${pid.slice(-8)}`,
  ];
  for (const name of candidates) {
    const [rows] = await db.query(
      excludeUserId
        ? 'SELECT id FROM users WHERE username = ? AND id <> ?'
        : 'SELECT id FROM users WHERE username = ?',
      excludeUserId ? [name, excludeUserId] : [name]
    );
    if (rows.length === 0) return name;
  }
  // Last resort: guaranteed-unique fallback.
  return `${base.slice(0, 40)} #${Date.now().toString(36)}`;
}

// POST /api/v1/auth/gpgs — durable identity via Google Play Games Services.
// The client sends a one-time PGS server auth code; we verify it with Google,
// then recover the existing account bound to that player ID (so credits survive
// cache-clears/reinstalls) or create a fresh durable account. Either way the
// username is synced to the PGS gamer tag.
exports.gpgsAuth = async (req, res) => {
  try {
    const { authCode } = req.body;
    if (!authCode) {
      return res.status(400).json({ error: 'authCode is required' });
    }

    // Verify with Google → authoritative player identity (never trust the client).
    let playerId, displayName, avatarUrl;
    try {
      ({ playerId, displayName, avatarUrl } = await verifyServerAuthCode(authCode));
    } catch (err) {
      if (err instanceof GpgsError) {
        const status = err.reason === 'config'  ? 503
                     : err.reason === 'network' ? 502
                     : 401;
        return res.status(status).json({ error: err.message, reason: err.reason });
      }
      throw err;
    }

    const [existing] = await db.query(
      'SELECT id, username, avatar FROM users WHERE gpgs_player_id = ?',
      [playerId]
    );

    let userId, username;
    if (existing.length) {
      // Recovery: a durable account already exists for this player.
      userId = existing[0].id;
      username = existing[0].username;
      if (displayName) {
        const synced = await resolveUniqueUsername(displayName, playerId, userId);
        if (synced !== existing[0].username) {
          await db.query('UPDATE users SET username = ? WHERE id = ?', [synced, userId]);
          username = synced;
        }
      }
    } else {
      // New durable account — still zero friction for the player.
      username = await resolveUniqueUsername(displayName, playerId);
      const email = `gpgs_${playerId}@playmist.local`;
      const [result] = await db.query(
        'INSERT INTO users (username, email, gpgs_player_id) VALUES (?, ?, ?)',
        [username, email, playerId]
      );
      userId = result.insertId;
    }

    // Keep the Play Games profile portrait in sync. Best-effort — never fail
    // auth over an avatar, and never overwrite a custom-uploaded picture.
    if (avatarUrl && avatarUrl !== (existing[0]?.avatar ?? null)
        && !isCustomAvatar(existing[0]?.avatar)) {
      try {
        await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, userId]);
      } catch (avErr) {
        console.warn('gpgsAuth avatar sync failed:', avErr.message);
      }
    }

    const [urows] = await db.query('SELECT credits, avatar FROM users WHERE id = ?', [userId]);
    const credits = urows.length ? urows[0].credits : 1000;
    const avatar  = urows.length ? urows[0].avatar : null;

    const accessToken  = jwt.sign({ id: userId, username }, accessSecret,  { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: userId, username }, refreshSecret, { expiresIn: '7d' });

    return res.json({
      success: true,
      recovered: existing.length > 0,
      user: { id: userId, username, credits, avatar },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('gpgsAuth error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/v1/auth/gpgs/avatar — refresh the Play Games portrait for an
// already-authenticated session. /auth/gpgs (the only other place the avatar
// is fetched from Google) runs solely at onboarding, so accounts created
// before the avatar sync — or players who later change their portrait — need
// this lightweight path. It never re-issues tokens and only touches the row
// when the verified player is this account's anchor.
exports.gpgsSyncAvatar = async (req, res) => {
  try {
    const { authCode } = req.body;
    if (!authCode) {
      return res.status(400).json({ error: 'authCode is required' });
    }

    let playerId, avatarUrl;
    try {
      ({ playerId, avatarUrl } = await verifyServerAuthCode(authCode));
    } catch (err) {
      if (err instanceof GpgsError) {
        const status = err.reason === 'config'  ? 503
                     : err.reason === 'network' ? 502
                     : 401;
        return res.status(status).json({ error: err.message, reason: err.reason });
      }
      throw err;
    }

    const [rows] = await db.query(
      'SELECT gpgs_player_id, avatar FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (rows[0].gpgs_player_id !== playerId) {
      // The signed-in Play Games player isn't this account's anchor — never
      // cross-pollinate portraits between identities.
      return res.status(409).json({ error: 'Play Games player does not match this account' });
    }

    // A custom-uploaded picture always wins — the launch-time PGS portrait
    // refresh must not clobber it (this runs silently on every app open).
    if (isCustomAvatar(rows[0].avatar)) {
      return res.json({ avatar: rows[0].avatar });
    }

    if (avatarUrl && avatarUrl !== rows[0].avatar) {
      await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, req.user.id]);
    }
    return res.json({ avatar: avatarUrl || rows[0].avatar || null });
  } catch (err) {
    console.error('gpgsSyncAvatar error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── Web QR pairing ──────────────────────────────────────────────────────────
// The web build is an anonymous guest until it claims the phone's PGS-anchored
// identity. Web asks for a short-lived link code (rendered as a QR); the phone
// app (already authenticated) scans it and approves; web then redeems the code
// for the same user's tokens. Codes are single-use and expire in ~2 minutes.
const LINK_TTL_MS = 2 * 60 * 1000;

exports.webLinkStart = async (req, res) => {
  try {
    const code = crypto.randomBytes(24).toString('base64url'); // ~32 chars
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await db.query(
      'INSERT INTO web_link_sessions (code, status, expires_at) VALUES (?, ?, ?)',
      [code, 'pending', expiresAt]
    );
    return res.json({
      code,
      qrPayload: `PMLINK:${code}`,
      expiresIn: Math.floor(LINK_TTL_MS / 1000),
    });
  } catch (err) {
    console.error('webLinkStart error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.webLinkStatus = async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const [rows] = await db.query(
      'SELECT id, status, user_id, expires_at FROM web_link_sessions WHERE code = ?',
      [code]
    );
    if (!rows.length) return res.json({ status: 'expired' });

    const session = rows[0];
    if (session.status === 'consumed') return res.json({ status: 'consumed' });
    if (new Date(session.expires_at) < new Date()) return res.json({ status: 'expired' });
    if (session.status !== 'approved' || !session.user_id) return res.json({ status: 'pending' });

    // Approved → mint tokens once, then consume the code.
    const [urows] = await db.query(
      'SELECT id, username, credits, avatar FROM users WHERE id = ?',
      [session.user_id]
    );
    if (!urows.length) {
      await db.query('UPDATE web_link_sessions SET status = ? WHERE id = ?', ['consumed', session.id]);
      return res.json({ status: 'expired' });
    }
    const user = urows[0];
    const accessToken  = jwt.sign({ id: user.id, username: user.username }, accessSecret,  { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: user.id, username: user.username }, refreshSecret, { expiresIn: '7d' });
    await db.query('UPDATE web_link_sessions SET status = ? WHERE id = ?', ['consumed', session.id]);

    return res.json({
      status: 'approved',
      user: { id: user.id, username: user.username, credits: user.credits, avatar: user.avatar || null },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('webLinkStatus error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.webLinkApprove = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const [rows] = await db.query(
      'SELECT id, status, expires_at FROM web_link_sessions WHERE code = ?',
      [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid link code' });

    const session = rows[0];
    if (new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link code expired' });
    }
    if (session.status !== 'pending') {
      return res.status(409).json({ error: 'Link code already used' });
    }

    // The authenticated phone vouches for the web session with its own user id.
    await db.query(
      'UPDATE web_link_sessions SET status = ?, user_id = ? WHERE id = ?',
      ['approved', req.user.id, session.id]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('webLinkApprove error:', err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT id, username, display_name, bio, email, email_verified,
              credits, xp, level, avatar,
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
      displayName:   u.display_name || null,
      bio:           u.bio || null,
      // Registration stores a <username>@playmist.local stub — only a
      // verified, user-entered address is ever exposed to the client.
      email:         u.email_verified ? u.email : null,
      emailVerified: !!u.email_verified,
      credits:       u.credits,
      xp:            u.xp    ?? 0,
      level:         u.level ?? 1,
      avatar:        u.avatar || null,
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
      'SELECT credits_cost, type, release_stage, demo_enabled, demo_zip_url FROM games WHERE id = ?',
      [gameId]
    );

    if (!games.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // In-development titles are playable only as a published demo, and only
    // ever for free. Enforced here rather than in the UI: this is the single
    // point every session must pass through, so a stale client, a replayed
    // request or a deep link cannot start an unreleased build.
    const isDemoSession = games[0].release_stage === 'in_development';
    if (isDemoSession && !(games[0].demo_enabled && games[0].demo_zip_url)) {
      return res.status(403).json({ error: 'This game is not available yet' });
    }

    // Check if this is today's daily pick — server-authoritative, client cannot fake it.
    // Wrapped in try/catch: if the daily_picks table doesn't exist yet (migrations pending)
    // we degrade gracefully instead of crashing the whole deduction.
    let freeToday = false;
    try { freeToday = await isTodaysDailyPick(gameId); } catch (_) {}

    const baseCost  = games[0].credits_cost !== null
      ? games[0].credits_cost
      : (games[0].type === 'premium' ? 25 : 5);
    // Demos are always free — charging players to test an unfinished game
    // inverts the favour being asked of them.
    const cost = (freeToday || isDemoSession) ? 0 : baseCost;

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

    // Record the transaction.
    // Demo sessions are logged as 'other', NOT 'game'. Daily-challenge progress
    // and the play-count achievements below both count rows with source='game',
    // and a demo is free and unlimited — logging it as a game play would let a
    // player farm challenge rewards by relaunching the same demo. The play is
    // still captured for analytics via /api/analytics/game-play.
    try {
      await db.query(
        `INSERT INTO credit_transactions (user_id, game_id, credits_used, source)
         VALUES (?, ?, ?, ?)`,
        [userId, gameId, cost, isDemoSession ? 'other' : 'game']
      );
    } catch (txErr) {
      console.error('Failed to log credit transaction:', txErr.message);
    }

    // Fire achievement checks (non-blocking — failures don't affect the response)
    // Skipped entirely for demos: "play 5 different games" should mean five
    // finished games, not five unreleased builds.
    const newAchievements = [];
    try {
      if (!isDemoSession) {
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
