/**
 * utils/sessionStore.js
 * express-session store backed by the existing MySQL pool.
 *
 * The default MemoryStore lost every developer/admin session on each pm2
 * restart (every deploy), so pages left open broke with confusing errors —
 * their JSON calls were answered with a redirect to the login page. Sessions
 * now live in the `sessions` table (created in utils/migrate.js) and survive
 * restarts. Expired rows are pruned on an interval.
 */
const session = require('express-session');
const db      = require('../config/database');

const DEFAULT_TTL_MS   = 1000 * 60 * 60 * 8;
const PRUNE_EVERY_MS   = 1000 * 60 * 15;

class MySQLSessionStore extends session.Store {
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_EVERY_MS);
    this.pruneTimer.unref();
  }

  get(sid, cb) {
    db.query('SELECT data FROM sessions WHERE sid = ? AND expires > ?', [sid, Date.now()])
      .then(([rows]) => {
        if (!rows.length) return cb(null, null);
        try { cb(null, JSON.parse(rows[0].data)); }
        catch (_) { cb(null, null); } // corrupt row — treat as no session
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    const expires = sess?.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + this.ttlMs;
    db.query(
      `INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sid, expires, JSON.stringify(sess)]
    ).then(() => cb(null)).catch(cb);
  }

  destroy(sid, cb = () => {}) {
    db.query('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb(null)).catch(cb);
  }

  prune() {
    db.query('DELETE FROM sessions WHERE expires <= ?', [Date.now()]).catch(() => {});
  }
}

module.exports = { MySQLSessionStore };
