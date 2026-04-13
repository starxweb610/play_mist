const bcrypt = require('bcryptjs');
const db     = require('../../config/database');

/**
 * GET /sitehandler/login
 */
exports.getLogin = (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session.admin) return res.redirect('/sitehandler/dashboard');

  res.render('sitehandler/auth/login', {
    title: 'Admin Login',
  });
};

/**
 * POST /sitehandler/login
 */
exports.postLogin = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.flash('error_msg', 'Please fill in all fields.');
    return res.redirect('/sitehandler/login');
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM admins WHERE username = ? AND is_active = 1 LIMIT 1',
      [username.trim()]
    );

    if (rows.length === 0) {
      req.flash('error_msg', 'Invalid credentials.');
      return res.redirect('/sitehandler/login');
    }

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);

    if (!match) {
      req.flash('error_msg', 'Invalid credentials.');
      return res.redirect('/sitehandler/login');
    }

    // Store minimal info in session (never store the hash)
    req.session.admin = {
      id:       admin.id,
      username: admin.username,
      name:     admin.name,
      role:     admin.role,
    };

    // Update last_login timestamp
    await db.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);

    req.flash('success_msg', `Welcome back, ${admin.name}!`);
    res.redirect('/sitehandler/dashboard');

  } catch (err) {
    console.error('Login error:', err);
    req.flash('error_msg', 'Server error. Please try again.');
    res.redirect('/sitehandler/login');
  }
};

/**
 * GET /sitehandler/logout
 */
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.redirect('/sitehandler/login');
  });
};
