/**
 * middleware/devApiAuth.js
 * Bearer-token auth for /api/dev/v1 — the Playmist Studio app's surface.
 *
 * The portal at /developer is session-and-cookie based. A Capacitor app runs
 * on the http://localhost origin, so every one of its calls is cross-site:
 * the SameSite=Lax session cookie would not be sent, and blockCrossSite would
 * reject the mutations that did arrive. Hence tokens.
 *
 * ⚠ Dev tokens are signed with their OWN secret, never JWT_SECRET. The player
 * API's verifyJwt only checks the signature and then trusts `decoded.id` as a
 * users.id — so a developer token signed with the player secret would let
 * developer #7 act as player #7. Different secret, plus a `typ` claim checked
 * on both sides, makes that impossible rather than merely unlikely.
 */
const jwt = require('jsonwebtoken');
const db  = require('../config/database');

const ACCESS_TTL  = '2h';
const REFRESH_TTL = '30d';

const accessSecret  = () => process.env.DEV_JWT_SECRET
  || `${process.env.JWT_SECRET || 'playmist_jwt_access_secret_123'}::developer`;
const refreshSecret = () => process.env.DEV_JWT_REFRESH_SECRET
  || `${process.env.JWT_REFRESH_SECRET || 'playmist_jwt_refresh_secret_123'}::developer`;

exports.signTokens = (developerId) => ({
  accessToken:  jwt.sign({ id: developerId, typ: 'dev' },     accessSecret(),  { expiresIn: ACCESS_TTL }),
  refreshToken: jwt.sign({ id: developerId, typ: 'dev-ref' }, refreshSecret(), { expiresIn: REFRESH_TTL }),
});

exports.verifyRefresh = (token) => {
  const decoded = jwt.verify(token, refreshSecret());
  if (decoded.typ !== 'dev-ref') throw new Error('wrong token type');
  return decoded;
};

/**
 * Verifies the bearer token, loads the developer, and — the point of this
 * shim — presents it as `req.session.developer`, the shape every existing
 * portal controller already reads. That is what lets /api/dev/v1 mount the
 * portal's JSON handlers verbatim instead of forking them, so the app and the
 * website can never drift apart on what a project or a task actually is.
 *
 * This router is mounted BEFORE express-session in server.js, so req.session
 * is a plain object here and assigning to it touches no session store.
 */
exports.requireDeveloperJwt = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authorization header missing' });

  let decoded;
  try {
    decoded = jwt.verify(token, accessSecret());
  } catch (err) {
    return res.status(401).json({
      error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Token invalid',
      tokenExpired: err.name === 'TokenExpiredError',
    });
  }
  if (decoded.typ !== 'dev') return res.status(401).json({ error: 'Token invalid' });

  try {
    const [rows] = await db.query(
      // No email_verified column by design: a developers row is only written
      // once the emailed code comes back, so existing ⇒ verified.
      `SELECT id, name, email, studio_name, avatar_url, handle, is_active, ban_reason
       FROM developers WHERE id = ?`,
      [decoded.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Account not found' });

    const dev = rows[0];
    if (!dev.is_active) {
      return res.status(403).json({
        error: dev.ban_reason ? `Account suspended: ${dev.ban_reason}` : 'Account suspended.',
        banned: true,
      });
    }

    req.developer = dev;
    req.session = {
      developer: {
        id:          dev.id,
        name:        dev.name,
        email:       dev.email,
        studio_name: dev.studio_name,
        avatar_url:  dev.avatar_url || null,
        handle:      dev.handle || null,
      },
    };
    // Portal handlers that share code with page routes may call req.flash on
    // an error path. Swallow it rather than 500 — the JSON body carries the
    // message the app actually shows.
    req.flash = () => [];
    next();
  } catch (err) {
    console.error('devApiAuth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
};
