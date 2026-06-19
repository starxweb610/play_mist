const db = require('../config/database');

exports.isDeveloper = (req, res, next) => {
  if (req.session && req.session.developer) return next();
  req.session.returnTo = req.originalUrl;
  req.flash('error_msg', 'Please log in to access the developer portal.');
  return res.redirect('/developer/login');
};

exports.checkBanned = async (req, res, next) => {
  if (!req.session || !req.session.developer) return next();
  try {
    const [rows] = await db.query('SELECT is_active, ban_reason FROM developers WHERE id = ?', [req.session.developer.id]);
    if (!rows.length || !rows[0].is_active) {
      const reason = rows[0]?.ban_reason || 'Your account has been suspended.';
      req.session.destroy(() => {});
      req.flash('error_msg', `Account suspended: ${reason}`);
      return res.redirect('/developer/login');
    }
  } catch (_) {}
  next();
};
