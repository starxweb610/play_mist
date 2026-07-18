const jwt = require('jsonwebtoken');

const multiplayerSecret = process.env.MULTIPLAYER_JWT_SECRET;
const multiplayerWsUrl = process.env.MULTIPLAYER_WS_URL || 'wss://multiplayer.cgpixels.com';

// Mints a short-lived token scoped to the multiplayer signaling server only —
// separate from the app's own access/refresh tokens so that server never has
// to trust (or verify) our primary auth secret.
exports.getSignalingToken = (req, res) => {
  if (!multiplayerSecret) {
    return res.status(503).json({ error: 'Multiplayer signaling is not configured' });
  }

  const token = jwt.sign(
    { id: req.user.id, username: req.user.username },
    multiplayerSecret,
    { expiresIn: '30m' }
  );

  return res.json({ token, wsUrl: multiplayerWsUrl, expiresIn: 1800 });
};
