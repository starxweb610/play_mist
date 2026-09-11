const bcrypt    = require('bcryptjs');
const db        = require('../../config/database');
const r2        = require('../../config/r2');
const { toWebp, IMMUTABLE_CACHE } = require('../../utils/images');
const mailer    = require('../../utils/mailer');
const templates = require('../../utils/emailTemplates');
const handles   = require('../../utils/handles');

const DEV_SELECT = `SELECT id, name, email, phone, country, studio_name, bio, avatar_url,
  handle, handle_changed_at, headline, website_url, header_url, created_at
  FROM developers WHERE id = ?`;

const LIMITS = { name: 120, studio_name: 150, country: 100, phone: 30, bio: 1000, headline: 120 };

const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Accepts "mystudio.com" or a full URL; only http(s) links with a real host are
// stored, so a profile can never carry a javascript: or data: link.
function normalizeWebsite(raw) {
  const input = String(raw || '').trim();
  if (!input) return { value: null };
  let url;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch (_) { return { error: 'Website must be a valid URL.' }; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
    return { error: 'Website must be a valid http(s) URL.' };
  }
  if (url.href.length > 300) return { error: 'Website URL must be 300 characters or fewer.' };
  return { value: url.href };
}

function renderProfile(res, devProfile, extra = {}) {
  res.render('developer/profile', {
    title: 'My Profile',
    devProfile,
    form: extra.form || devProfile,
    nextHandleChange: handles.nextHandleChangeAt(devProfile.handle_changed_at),
    handleCooldownDays: handles.CHANGE_COOLDOWN_DAYS,
    ...extra,
  });
}

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.query(DEV_SELECT, [req.session.developer.id]);
    if (!rows.length) return res.redirect('/developer/login');
    renderProfile(res, rows[0]);
  } catch (err) {
    req.flash('error_msg', 'Failed to load profile.');
    res.redirect('/developer/dashboard');
  }
};

exports.postProfile = async (req, res) => {
  const devId = req.session.developer.id;
  const { name, studio_name, country, phone, bio, headline, website_url, handle } = req.body;
  const errors = [];

  if (!name?.trim())        errors.push('Full name is required.');
  else if (name.trim().length > LIMITS.name) errors.push(`Full name must be ${LIMITS.name} characters or fewer.`);
  if (!studio_name?.trim()) errors.push('Studio name is required.');
  else if (studio_name.trim().length > LIMITS.studio_name) errors.push(`Studio name must be ${LIMITS.studio_name} characters or fewer.`);
  if (!country?.trim())     errors.push('Country is required.');
  else if (country.trim().length > LIMITS.country) errors.push(`Country must be ${LIMITS.country} characters or fewer.`);
  if ((phone || '').trim().length > LIMITS.phone) errors.push(`Phone must be ${LIMITS.phone} characters or fewer.`);
  if ((bio || '').trim().length > LIMITS.bio) errors.push(`Bio must be ${LIMITS.bio} characters or fewer.`);
  const cleanHeadline = String(headline || '').replace(/\s+/g, ' ').trim();
  if (cleanHeadline.length > LIMITS.headline) errors.push(`Headline must be ${LIMITS.headline} characters or fewer.`);
  const website = normalizeWebsite(website_url);
  if (website.error) errors.push(website.error);

  let current;
  try {
    [[current]] = await db.query(DEV_SELECT, [devId]);
    if (!current) return res.redirect('/developer/login');

    // ── Handle (profile URL) ────────────────────────────────────────────────
    const wanted = handles.normalizeHandle(handle);
    let newHandle = current.handle;
    if (handle !== undefined && wanted !== current.handle) {
      const check = handles.validateHandle(wanted);
      const lockedUntil = handles.nextHandleChangeAt(current.handle_changed_at);
      if (!check.valid) errors.push(check.error);
      else if (lockedUntil) errors.push(`You can change your handle again on ${fmtDate(lockedUntil)}.`);
      else if (!(await handles.isHandleAvailable(check.value, devId))) errors.push(`@${check.value} is already taken.`);
      else newHandle = check.value;
    }

    if (errors.length) {
      return renderProfile(res, current, {
        errors,
        form: { ...current, name, studio_name, country, phone, bio, headline, website_url, handle: wanted || current.handle },
      });
    }

    if (newHandle !== current.handle) {
      // Reserve the old handle first, so there's no moment where someone else
      // could grab it; the UNIQUE index settles any race on the new one.
      if (current.handle) {
        await db.query('INSERT IGNORE INTO developer_handle_history (handle, developer_id) VALUES (?, ?)', [current.handle, devId]);
      }
      try {
        await db.query('UPDATE developers SET handle = ?, handle_changed_at = NOW() WHERE id = ?', [newHandle, devId]);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        return renderProfile(res, current, {
          errors: [`@${newHandle} was just taken by someone else. Try another handle.`],
          form: { ...current, name, studio_name, country, phone, bio, headline, website_url, handle: newHandle },
        });
      }
      // Reclaiming one of your own old handles removes it from history.
      await db.query('DELETE FROM developer_handle_history WHERE handle = ? AND developer_id = ?', [newHandle, devId]);
    }

    await db.query(
      `UPDATE developers SET name = ?, studio_name = ?, country = ?, phone = ?, bio = ?, headline = ?, website_url = ?
       WHERE id = ?`,
      [
        name.trim(),
        studio_name.trim(),
        country.trim(),
        phone?.trim() || null,
        bio?.trim() || null,
        cleanHeadline || null,
        website.value,
        devId,
      ]
    );
    req.session.developer.name        = name.trim();
    req.session.developer.studio_name = studio_name.trim();
    req.session.developer.handle      = newHandle;
    req.flash('success_msg', newHandle !== current.handle
      ? `Profile updated. Your public profile is now playmist.app/@${newHandle}`
      : 'Profile updated successfully.');
    res.redirect('/developer/profile');
  } catch (err) {
    console.error('postProfile error:', err);
    req.flash('error_msg', 'Failed to update profile.');
    res.redirect('/developer/profile');
  }
};

// Live availability feedback for the handle field. Advisory only — postProfile
// re-validates and the UNIQUE index has the final word.
exports.checkHandle = async (req, res) => {
  const devId = req.session.developer.id;
  const check = handles.validateHandle(req.query.h);
  if (!check.valid) return res.json({ available: false, error: check.error });
  try {
    const [[me]] = await db.query('SELECT handle FROM developers WHERE id = ?', [devId]);
    if (me && me.handle === check.value) return res.json({ available: true, current: true, handle: check.value });
    const available = await handles.isHandleAvailable(check.value, devId);
    res.json({ available, handle: check.value, error: available ? null : `@${check.value} is already taken.` });
  } catch (err) {
    res.status(500).json({ error: 'Could not check that handle right now.' });
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
      return renderProfile(res, rows[0] || {}, { errors, activeTab: 'security' });
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
      return renderProfile(res, devRows[0] || {}, {
        errors: ['Current password is incorrect.'],
        activeTab: 'security',
      });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE developers SET password_hash = ? WHERE id = ?', [hash, req.session.developer.id]);

    const { name, email } = req.session.developer;
    mailer.sendMail({
      to:      email,
      subject: `Your ${process.env.APP_NAME || 'PlayMist'} developer password was changed`,
      html:    templates.passwordChanged({ name }),
    }).catch(err => console.error('passwordChanged email failed:', err.message));

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

  try {
    const { buffer, hash } = await toWebp(req.file.buffer, 'avatar');
    const key = `developers/avatars/${devId}-${hash}.webp`;

    // Delete old avatar from R2 if it exists (and isn't this very same image)
    const [rows] = await db.query('SELECT avatar_url FROM developers WHERE id = ?', [devId]);
    if (rows.length && rows[0].avatar_url) {
      const oldKey = r2.keyFromUrl(rows[0].avatar_url);
      if (oldKey && oldKey !== key) await r2.deleteObject(oldKey).catch(() => {});
    }

    const url = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);

    await db.query('UPDATE developers SET avatar_url = ? WHERE id = ?', [url, devId]);
    req.session.developer.avatar_url = url;

    return res.json({ avatar_url: url });
  } catch (err) {
    console.error('Avatar upload error:', err);
    return res.status(500).json({ error: 'Failed to upload avatar.' });
  }
};

// Profile cover image (the wide banner on /@handle), LinkedIn-style.
exports.postHeader = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const devId = req.session.developer.id;

  try {
    let converted;
    try { converted = await toWebp(req.file.buffer, 'header'); }
    catch (_) { return res.status(400).json({ error: 'That file isn’t a readable image.' }); }

    const key = `developers/headers/${devId}-${converted.hash}.webp`;
    const [rows] = await db.query('SELECT header_url FROM developers WHERE id = ?', [devId]);
    const url = await r2.uploadBuffer(key, converted.buffer, 'image/webp', IMMUTABLE_CACHE);
    await db.query('UPDATE developers SET header_url = ? WHERE id = ?', [url, devId]);

    // Remove the previous cover only once the new one is stored and saved.
    const oldKey = r2.keyFromUrl(rows[0]?.header_url);
    if (oldKey && oldKey !== key) r2.deleteObject(oldKey).catch(() => {});

    return res.json({ header_url: url });
  } catch (err) {
    console.error('Header upload error:', err);
    return res.status(500).json({ error: 'Failed to upload cover image.' });
  }
};

exports.deleteHeader = async (req, res) => {
  const devId = req.session.developer.id;
  try {
    const [rows] = await db.query('SELECT header_url FROM developers WHERE id = ?', [devId]);
    await db.query('UPDATE developers SET header_url = NULL WHERE id = ?', [devId]);
    const oldKey = r2.keyFromUrl(rows[0]?.header_url);
    if (oldKey) r2.deleteObject(oldKey).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove cover image.' });
  }
};
