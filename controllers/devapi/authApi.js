/**
 * controllers/devapi/authApi.js
 * Account endpoints for the Playmist Studio app (/api/dev/v1/auth/*).
 *
 * Same accounts, same tables and same emails as the web portal
 * (controllers/developer/authController.js) — the difference is only that
 * nothing here leans on a session. The portal parks a pending signup in
 * req.session.pendingVerification; the app carries the email back with the
 * code instead, so a phone that lost the app mid-signup can finish on the
 * website and vice versa.
 */
const bcrypt    = require('bcryptjs');
const db        = require('../../config/database');
const mailer    = require('../../utils/mailer');
const templates = require('../../utils/emailTemplates');
const { generateUniqueHandle } = require('../../utils/handles');
const { signTokens, verifyRefresh } = require('../../middleware/devApiAuth');

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

const publicDeveloper = (dev) => ({
  id:          dev.id,
  name:        dev.name,
  email:       dev.email,
  studioName:  dev.studio_name,
  avatarUrl:   dev.avatar_url || null,
  headerUrl:   dev.header_url || null,
  handle:      dev.handle || null,
  headline:    dev.headline || null,
  country:     dev.country || null,
});

// Copied in spirit from authController.insertDeveloper: the availability check
// and the insert aren't atomic, so a UNIQUE collision is retried with a fresh
// pick rather than failing the signup.
async function insertDeveloper({ name, email, phone, country, studio_name, password_hash }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await generateUniqueHandle(name, studio_name);
    try {
      const [result] = await db.query(
        `INSERT INTO developers (name, email, phone, country, studio_name, password_hash, handle)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, email, phone, country, studio_name, password_hash, handle]
      );
      return { id: result.insertId, handle };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' || !String(err.message).includes('uniq_developer_handle')) throw err;
    }
  }
  throw new Error('Could not allocate a profile handle.');
}

// ── POST /auth/signup ────────────────────────────────────────────────────────
// Mails a 6-digit code; the account row itself is not created until the code
// comes back (same as the portal), so an unverified email can't squat a handle.
exports.signup = async (req, res) => {
  const { name, email, phone, country, studio_name, password } = req.body || {};
  const errors = [];

  if (!name?.trim())        errors.push('Full name is required.');
  else if (name.trim().length > 200) errors.push('Full name must be 200 characters or fewer.');
  if (!email?.trim())       errors.push('Email address is required.');
  if (!country?.trim())     errors.push('Country is required.');
  if (!studio_name?.trim()) errors.push('Studio name is required.');
  if (!password)            errors.push('Password is required.');
  else if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const normalEmail = email.trim().toLowerCase();

  try {
    const [existing] = await db.query('SELECT id FROM developers WHERE email = ?', [normalEmail]);
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    const code     = generateCode();
    const formData = JSON.stringify({
      name: name.trim(),
      email: normalEmail,
      phone: phone?.trim() || null,
      country: country.trim(),
      studio_name: studio_name.trim(),
      password_hash: await bcrypt.hash(password, 12),
    });

    await db.query('DELETE FROM developer_email_verifications WHERE email = ?', [normalEmail]);
    await db.query(
      `INSERT INTO developer_email_verifications (email, code, form_data, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [normalEmail, code, formData]
    );

    mailer.sendMail({
      to:      normalEmail,
      subject: `${process.env.APP_NAME || 'PlayMist'} — Verify your developer account`,
      html:    templates.verificationCode({ name: name.trim(), code }),
    }).catch(err => console.error('Verification email failed:', err.message));

    res.json({ pendingVerification: true, email: normalEmail });
  } catch (err) {
    console.error('devapi signup error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

// ── POST /auth/verify-email ──────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const code  = (req.body?.code  || '').trim().replace(/\s/g, '');

  if (!email) return res.status(400).json({ error: 'Email is required.' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code sent to your email.' });

  try {
    const [rows] = await db.query(
      `SELECT * FROM developer_email_verifications
       WHERE email = ? AND code = ? AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (!rows.length) {
      const [anyRows] = await db.query(
        'SELECT id FROM developer_email_verifications WHERE email = ? AND expires_at > NOW()',
        [email]
      );
      return res.status(400).json({
        error: anyRows.length ? 'Incorrect code. Please try again.' : 'This code has expired. Please request a new one.',
      });
    }

    const { form_data, id: verificationId } = rows[0];
    const { name, email: devEmail, phone, country, studio_name, password_hash } = JSON.parse(form_data);

    const [dupCheck] = await db.query('SELECT id FROM developers WHERE email = ?', [devEmail]);
    if (dupCheck.length) {
      await db.query('DELETE FROM developer_email_verifications WHERE id = ?', [verificationId]);
      return res.status(409).json({ error: 'That account already exists. Please log in.' });
    }

    const created = await insertDeveloper({ name, email: devEmail, phone, country, studio_name, password_hash });
    await db.query('DELETE FROM developer_email_verifications WHERE email = ?', [devEmail]);

    const [[dev]] = await db.query('SELECT * FROM developers WHERE id = ?', [created.id]);
    res.json({ ...signTokens(created.id), developer: publicDeveloper(dev) });
  } catch (err) {
    console.error('devapi verifyEmail error:', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
};

// ── POST /auth/resend-verification ───────────────────────────────────────────
exports.resendVerification = async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const [rows] = await db.query(
      'SELECT created_at, form_data FROM developer_email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [email]
    );
    if (!rows.length) return res.status(400).json({ error: 'Signup session expired. Please sign up again.' });

    const secondsAgo = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
    if (secondsAgo < 60) {
      return res.status(429).json({ error: `Please wait ${Math.ceil(60 - secondsAgo)} seconds before requesting a new code.` });
    }

    const code = generateCode();
    const { name } = JSON.parse(rows[0].form_data);
    await db.query('DELETE FROM developer_email_verifications WHERE email = ?', [email]);
    await db.query(
      `INSERT INTO developer_email_verifications (email, code, form_data, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [email, code, rows[0].form_data]
    );

    mailer.sendMail({
      to:      email,
      subject: `${process.env.APP_NAME || 'PlayMist'} — New verification code`,
      html:    templates.verificationCode({ name, code }),
    }).catch(err => console.error('Resend email failed:', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('devapi resendVerification error:', err);
    res.status(500).json({ error: 'Failed to resend code. Please try again.' });
  }
};

// ── POST /auth/login ─────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email?.trim() || !password) return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const [rows] = await db.query('SELECT * FROM developers WHERE email = ?', [email.trim().toLowerCase()]);
    // Same message for "no such account" and "wrong password" — the portal
    // does this too, and it keeps the endpoint from confirming which emails
    // have accounts.
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });

    const dev = rows[0];
    if (!(await bcrypt.compare(password, dev.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!dev.is_active) {
      return res.status(403).json({ error: `Your account has been suspended${dev.ban_reason ? ': ' + dev.ban_reason : '.'}` });
    }

    await db.query('UPDATE developers SET last_login = NOW() WHERE id = ?', [dev.id]);
    res.json({ ...signTokens(dev.id), developer: publicDeveloper(dev) });
  } catch (err) {
    console.error('devapi login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// ── POST /auth/refresh ───────────────────────────────────────────────────────
exports.refresh = async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });

  try {
    const decoded = verifyRefresh(refreshToken);
    const [rows] = await db.query('SELECT * FROM developers WHERE id = ? AND is_active = 1', [decoded.id]);
    if (!rows.length) return res.status(401).json({ error: 'Account not found or suspended' });
    res.json({ ...signTokens(decoded.id), developer: publicDeveloper(rows[0]) });
  } catch (_) {
    res.status(401).json({ error: 'Refresh token invalid or expired' });
  }
};

// ── GET /auth/me ─────────────────────────────────────────────────────────────
exports.me = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM developers WHERE id = ?', [req.session.developer.id]);
  if (!rows.length) return res.status(404).json({ error: 'Account not found' });
  res.json({ developer: publicDeveloper(rows[0]) });
};

// ── POST /auth/forgot-password ───────────────────────────────────────────────
// Always answers 200: whether an email has an account is not this endpoint's
// to disclose.
exports.forgotPassword = async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const [rows] = await db.query('SELECT id, name FROM developers WHERE email = ?', [email]);
    if (rows.length) {
      const code = generateCode();
      await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);
      await db.query(
        `INSERT INTO developer_password_resets (email, code, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
        [email, code]
      );
      mailer.sendMail({
        to:      email,
        subject: `${process.env.APP_NAME || 'PlayMist'} — Password reset code`,
        html:    templates.resetPasswordCode({ name: rows[0].name, code }),
      }).catch(err => console.error('Password reset email failed:', err.message));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('devapi forgotPassword error:', err);
    res.status(500).json({ error: 'Could not start a password reset. Please try again.' });
  }
};

// ── POST /auth/reset-password ────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const email    = (req.body?.email || '').trim().toLowerCase();
  const code     = (req.body?.code  || '').trim().replace(/\s/g, '');
  const password = req.body?.password || '';

  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const [rows] = await db.query(
      `SELECT * FROM developer_password_resets
       WHERE email = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    if (!rows.length) return res.status(400).json({ error: 'This code has expired. Please request a new one.' });

    const reset = rows[0];
    if (reset.attempts >= 5) {
      await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }
    if (reset.code !== code) {
      await db.query('UPDATE developer_password_resets SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    const [devRows] = await db.query('SELECT * FROM developers WHERE email = ?', [email]);
    if (!devRows.length) {
      await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);
      return res.status(404).json({ error: 'Account not found.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await db.query('UPDATE developers SET password_hash = ? WHERE id = ?', [hash, devRows[0].id]);
    await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);

    res.json({ ...signTokens(devRows[0].id), developer: publicDeveloper(devRows[0]) });
  } catch (err) {
    console.error('devapi resetPassword error:', err);
    res.status(500).json({ error: 'Password reset failed. Please try again.' });
  }
};
