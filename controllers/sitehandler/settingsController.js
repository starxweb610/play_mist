const db     = require('../../config/database');
const bcrypt = require('bcryptjs');

exports.getIndex = async (req, res) => {
  let admin = null;
  try {
    [[admin]] = await db.query('SELECT id, username, name, email, role FROM admins WHERE id = ?', [req.session.admin.id]);
  } catch (_) {}
  res.render('sitehandler/settings/index', {
    title: 'Settings', activePage: 'settings', adminData: admin,
  });
};

exports.postProfile = async (req, res) => {
  const { name, email } = req.body;
  if (!name?.trim()) { req.flash('error_msg', 'Name is required.'); return res.redirect('/sitehandler/settings'); }
  try {
    await db.query('UPDATE admins SET name = ?, email = ? WHERE id = ?',
      [name.trim(), email?.trim() || null, req.session.admin.id]);
    // Update session name
    req.session.admin.name = name.trim();
    req.flash('success_msg', 'Profile updated.');
    res.redirect('/sitehandler/settings');
  } catch (err) {
    req.flash('error_msg', err.message); res.redirect('/sitehandler/settings');
  }
};

exports.postPassword = async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    req.flash('error_msg', 'All password fields are required.'); return res.redirect('/sitehandler/settings');
  }
  if (new_password !== confirm_password) {
    req.flash('error_msg', 'New passwords do not match.'); return res.redirect('/sitehandler/settings');
  }
  if (new_password.length < 8) {
    req.flash('error_msg', 'Password must be at least 8 characters.'); return res.redirect('/sitehandler/settings');
  }
  try {
    const [[adminRow]] = await db.query('SELECT password_hash FROM admins WHERE id = ?', [req.session.admin.id]);
    const match = await bcrypt.compare(current_password, adminRow.password_hash);
    if (!match) { req.flash('error_msg', 'Current password is incorrect.'); return res.redirect('/sitehandler/settings'); }
    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, req.session.admin.id]);
    req.flash('success_msg', 'Password changed successfully.');
    res.redirect('/sitehandler/settings');
  } catch (err) {
    req.flash('error_msg', err.message); res.redirect('/sitehandler/settings');
  }
};
