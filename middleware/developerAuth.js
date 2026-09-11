const db = require('../config/database');

// A fetch()/XHR call can't do anything useful with a redirect to the login
// page — fetch silently follows it and hands the caller an HTML document.
// Browsers tag real page loads with Sec-Fetch-Mode: navigate; everything else
// (fetch, images) gets a JSON 401 instead.
function isApiRequest(req) {
  const mode = req.get('sec-fetch-mode');
  if (mode) return mode !== 'navigate';
  return req.xhr || req.accepts(['html', 'json']) === 'json';
}

function sessionExpired(req, res, message) {
  if (isApiRequest(req)) {
    res.set('X-Session-Expired', '1');
    return res.status(401).json({ error: message, sessionExpired: true });
  }
  return null;
}

exports.isDeveloper = (req, res, next) => {
  if (req.session && req.session.developer) return next();
  if (sessionExpired(req, res, 'Your session has expired. Please log in again.')) return;
  req.session.returnTo = req.originalUrl;
  req.flash('error_msg', 'Please log in to access the developer portal.');
  return res.redirect('/developer/login');
};

exports.checkBanned = async (req, res, next) => {
  if (!req.session || !req.session.developer) return next();
  try {
    const [rows] = await db.query(
      'SELECT is_active, ban_reason, handle FROM developers WHERE id = ?',
      [req.session.developer.id]
    );
    if (!rows.length || !rows[0].is_active) {
      const reason = rows[0]?.ban_reason || 'Your account has been suspended.';
      req.session.destroy(() => {});
      if (sessionExpired(req, res, `Account suspended: ${reason}`)) return;
      req.flash('error_msg', `Account suspended: ${reason}`);
      return res.redirect('/developer/login');
    }
    // Keeps sessions created before handles existed (or before a handle
    // change) pointing at the current public profile URL.
    req.session.developer.handle = rows[0].handle;
  } catch (_) {}
  next();
};

// CSRF defence-in-depth on top of the SameSite=Lax session cookie: reject any
// state-changing request the browser itself labels as coming from another site.
exports.blockCrossSite = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
};

/**
 * Only same-site relative paths are accepted as a post-login destination, so
 * ?next= can't be abused as an open redirect (//evil.com, /\evil.com, etc.).
 */
exports.safeNextPath = (raw) => {
  const next = String(raw || '');
  if (!/^\/(?![/\\])/.test(next) || next.length > 300 || /[\r\n]/.test(next)) return null;
  return next;
};
