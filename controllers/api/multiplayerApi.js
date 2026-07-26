const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const multiplayerSecret = process.env.MULTIPLAYER_JWT_SECRET;
const multiplayerWsUrl = process.env.MULTIPLAYER_WS_URL || 'wss://multiplayer.cgpixels.com';

// Mints a short-lived token scoped to the multiplayer signaling server only —
// separate from the app's own access/refresh tokens so that server never has
// to trust (or verify) our primary auth secret.
exports.getSignalingToken = async (req, res) => {
  if (!multiplayerSecret) {
    return res.status(503).json({ error: 'Multiplayer signaling is not configured' });
  }

  // req.user.username is the JWT claim baked in at login — always the raw
  // handle, never live. Look up the current display_name so opponents see
  // the same public identity the leaderboard shows, not the raw handle.
  let publicName = req.user.username;
  try {
    const [[row]] = await db.query(
      'SELECT COALESCE(NULLIF(TRIM(display_name), \'\'), username) AS name FROM users WHERE id = ?',
      [req.user.id]
    );
    if (row?.name) publicName = row.name;
  } catch (err) {
    console.warn('getSignalingToken: display_name lookup failed, using handle:', err.message);
  }

  const token = jwt.sign(
    { id: req.user.id, username: publicName },
    multiplayerSecret,
    { expiresIn: '30m' }
  );

  return res.json({ token, wsUrl: multiplayerWsUrl, expiresIn: 1800 });
};
