const bcrypt = require('bcryptjs');
const db     = require('../../config/database');
const r2     = require('../../config/r2');

const DEV_SELECT = 'SELECT id, name, email, phone, country, studio_name, bio, avatar_url, created_at FROM developers WHERE id = ?';

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.query(DEV_SELECT, [req.session.developer.id]);
    if (!rows.length) return res.redirect('/developer/login');
    res.render('developer/profile', { title: 'My Profile', devProfile: rows[0] });
  } catch (err) {
    req.flash('error_msg', 'Failed to load profile.');
    res.redirect('/developer/dashboard');
  }
};

exports.postProfile = async (req, res) => {
  const { name, studio_name, country, phone, bio } = req.body;
  const errors = [];

  if (!name?.trim())        errors.push('Full name is required.');
  if (!studio_name?.trim()) errors.push('Studio name is required.');
  if (!country?.trim())     errors.push('Country is required.');

  if (errors.length) {
    try {
      const [rows] = await db.query(DEV_SELECT, [req.session.developer.id]);
      return res.render('developer/profile', {
        title: 'My Profile',
        devProfile: rows[0] || {},
        errors,
      });
    } catch (_) {
      return res.redirect('/developer/profile');
    }
  }

  try {
    await db.query(
      `UPDATE developers SET name = ?, studio_name = ?, country = ?, phone = ?, bio = ? WHERE id = ?`,
      [
        name.trim(),
        studio_name.trim(),
        country.trim(),
        phone?.trim() || null,
        bio?.trim() || null,
        req.session.developer.id,
      ]
    );
    req.session.developer.name        = name.trim();
    req.session.developer.studio_name = studio_name.trim();
    req.flash('success_msg', 'Profile updated successfully.');
    res.redirect('/developer/profile');
  } catch (err) {
    req.flash('error_msg', 'Failed to update profile.');
    res.redirect('/developer/profile');
  }
};

exports.postPassword = async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const errors = [];

  if (!current_password)             errors.push('Current password is required.');
  if (!new_password)                 errors.push('New password is required.');
  else if (new_password.length < 8)  errors.push('New password must be at least 8 characters.');
  if (new_password !== confirm_password) errors.push('Passwords do not match.');

  if (errors.length) {
    try {
      const [rows] = await db.query(DEV_SELECT, [req.session.developer.id]);
      return res.render('developer/profile', {
        title: 'My Profile',
        devProfile: rows[0] || {},
        errors,
        activeTab: 'security',
      });
    } catch (_) {
      return res.redirect('/developer/profile');
    }
  }

  try {
    const [rows] = await db.query('SELECT password_hash FROM developers WHERE id = ?', [req.session.developer.id]);
    if (!rows.length) return res.redirect('/developer/login');

    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) {
      const [devRows] = await db.query(DEV_SELECT, [req.session.developer.id]);
      return res.render('developer/profile', {
        title: 'My Profile',
        devProfile: devRows[0] || {},
        errors: ['Current password is incorrect.'],
        activeTab: 'security',
      });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE developers SET password_hash = ? WHERE id = ?', [hash, req.session.developer.id]);
    req.flash('success_msg', 'Password changed successfully.');
    res.redirect('/developer/profile');
  } catch (err) {
    req.flash('error_msg', 'Failed to change password.');
    res.redirect('/developer/profile');
  }
};

exports.postAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const devId = req.session.developer.id;
  const ext   = req.file.originalname.split('.').pop().toLowerCase() || 'jpg';
  const key   = `developers/avatars/${devId}.${ext}`;

  try {
    // Delete old avatar from R2 if it exists
    const [rows] = await db.query('SELECT avatar_url FROM developers WHERE id = ?', [devId]);
    if (rows.length && rows[0].avatar_url) {
      const oldKey = r2.keyFromUrl(rows[0].avatar_url);
      if (oldKey) await r2.deleteObject(oldKey).catch(() => {});
    }

    const url = await r2.uploadBuffer(key, req.file.buffer, req.file.mimetype);

    await db.query('UPDATE developers SET avatar_url = ? WHERE id = ?', [url, devId]);
    req.session.developer.avatar_url = url;

    return res.json({ avatar_url: url });
  } catch (err) {
    console.error('Avatar upload error:', err);
    return res.status(500).json({ error: 'Failed to upload avatar.' });
  }
};
