const db     = require('../../config/database');
const bcrypt = require('bcryptjs');

exports.getIndex = async (req, res) => {
  let admins = [];
  try { [admins] = await db.query('SELECT id, username, name, email, role, is_active, last_login, created_at FROM admins ORDER BY created_at DESC'); }
  catch (_) {}
  res.render('sitehandler/admins/index', {
    title: 'Manage Admins', activePage: 'admins', admins,
  });
};

exports.postCreate = async (req, res) => {
  const { username, name, email, password, role } = req.body;
  if (!username || !name || !password || !role) {
    req.flash('error_msg', 'All fields are required.'); return res.redirect('/sitehandler/admins');
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    await db.query('INSERT INTO admins (username, name, email, password_hash, role) VALUES (?,?,?,?,?)',
      [username.trim(), name.trim(), email?.trim() || null, hash, role]);
    req.flash('success_msg', `Admin "${name}" created.`);
    res.redirect('/sitehandler/admins');
  } catch (err) {
    req.flash('error_msg', err.code === 'ER_DUP_ENTRY' ? 'Username already exists.' : err.message);
    res.redirect('/sitehandler/admins');
  }
};

exports.postToggle = async (req, res) => {
  if (req.params.id == req.session.admin.id) {
    req.flash('error_msg', "You can't deactivate yourself.");
    return res.redirect('/sitehandler/admins');
  }
  try {
    await db.query('UPDATE admins SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    res.redirect('/sitehandler/admins');
  } catch (err) {
    req.flash('error_msg', err.message); res.redirect('/sitehandler/admins');
  }
};

exports.postDelete = async (req, res) => {
  if (req.params.id == req.session.admin.id) {
    req.flash('error_msg', "You can't delete your own account.");
    return res.redirect('/sitehandler/admins');
  }
  try {
    await db.query('DELETE FROM admins WHERE id = ?', [req.params.id]);
    req.flash('success_msg', 'Admin removed.');
    res.redirect('/sitehandler/admins');
  } catch (err) {
    req.flash('error_msg', err.message); res.redirect('/sitehandler/admins');
  }
};
