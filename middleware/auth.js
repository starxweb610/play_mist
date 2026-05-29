/**
 * middleware/auth.js
 * Authentication & authorization guards for the /sitehandler admin panel
 */

/**
 * isAdmin — ensures a valid admin session exists.
 * Attach to any route or router that requires authentication.
 */
exports.isAdmin = (req, res, next) => {
  if (req.session && req.session.admin) return next();

  // Store the intended URL so we can redirect after login (optional UX improvement)
  req.session.returnTo = req.originalUrl;
  req.flash('error_msg', 'Please log in to access the admin panel.');
  return res.redirect('/sitehandler/login');
};

/**
 * hasRole(roles) — restricts to specific admin roles.
 * Usage: router.get('/admins', isAdmin, hasRole(['superadmin']), controller)
 *
 * @param {string[]} roles  Array of allowed role strings e.g. ['superadmin', 'manager']
 */
exports.hasRole = (roles) => (req, res, next) => {
  if (!req.session.admin) {
    req.flash('error_msg', 'Unauthorized.');
    return res.redirect('/sitehandler/login');
  }
  if (roles.includes(req.session.admin.role)) return next();

  req.flash('error_msg', 'You do not have permission to access this page.');
  return res.redirect('/sitehandler/dashboard');
};

const jwt = require('jsonwebtoken');

/**
 * verifyJwt — ensures a valid JWT access token exists in headers.
 */
exports.verifyJwt = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>
  if (!token) {
    return res.status(401).json({ error: 'Token missing' });
  }

  const accessSecret = process.env.JWT_SECRET || 'playmist_jwt_access_secret_123';
  jwt.verify(token, accessSecret, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalid or expired' });
    }
    req.user = decoded;
    next();
  });
};
