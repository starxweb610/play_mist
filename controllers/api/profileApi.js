/**
 * controllers/api/profileApi.js
 * Player profile settings: display name / bio, custom avatar upload, and
 * voluntary email linking via 6-digit OTP.
 *
 * Email linking rules:
 *  - never forced — registration only sets a <username>@playmist.local stub
 *  - verified emails are unique across accounts (users.email is UNIQUE, and we
 *    pre-check) so the one-time "The Activist" reward can't be farmed by
 *    verifying the same inbox on many accounts
 *  - the reward itself is grantAchievement('email_verified') — INSERT IGNORE
 *    makes it exactly-once per account even if a user re-links a new email
 */
const crypto = require('crypto');
const db = require('../../config/database');
const { uploadBuffer, deleteObject, keyFromUrl } = require('../../config/r2');
const { grantAchievement } = require('../../utils/achievements');
const { sendMail } = require('../../utils/mailer');
const templates = require('../../utils/emailTemplates');

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_S = 60;
const OTP_MAX_ATTEMPTS = 5;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isValidEmail = (e) =>
  typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 255;

/**
 * POST /api/v1/user/profile/update  { displayName?, bio? }
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = [];
    const params = [];

    if (req.body.displayName !== undefined) {
      const name = String(req.body.displayName).trim().slice(0, 80);
      updates.push('display_name = ?');
      params.push(name || null);
    }
    if (req.body.bio !== undefined) {
      const bio = String(req.body.bio).trim().slice(0, 200);
      updates.push('bio = ?');
      params.push(bio || null);
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(userId);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await db.query(
      'SELECT display_name, bio FROM users WHERE id = ?', [userId]
    );
    return res.json({
      success: true,
      displayName: rows[0]?.display_name || null,
      bio: rows[0]?.bio || null,
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/v1/user/avatar — multipart, field "avatar" (jpeg/png/webp ≤ 5 MB,
 * enforced by the route's multer config). Replaces any previous custom avatar.
 */
exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: 'Only JPG, PNG, or WebP images are accepted' });

    const [rows] = await db.query('SELECT avatar FROM users WHERE id = ?', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const key = `avatars/u${userId}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const url = await uploadBuffer(key, req.file.buffer, req.file.mimetype);
    await db.query('UPDATE users SET avatar = ? WHERE id = ?', [url, userId]);

    // Remove the old custom avatar from R2 (Google-hosted PGS photos are
    // external URLs — keyFromUrl returns null for those and we skip).
    const oldKey = keyFromUrl(rows[0].avatar);
    if (oldKey && oldKey.startsWith('avatars/')) {
      deleteObject(oldKey).catch((e) => console.warn('old avatar cleanup failed:', e.message));
    }

    return res.json({ success: true, avatar: url });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/v1/user/email/send-otp  { email }
 */
exports.sendEmailOtp = async (req, res) => {
  try {
    const userId = req.user.id;
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (email.endsWith('@playmist.local')) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Uniqueness: an email can only ever be linked to one account.
    const [taken] = await db.query(
      'SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]
    );
    if (taken.length) {
      return res.status(409).json({ error: 'This email is already linked to another account' });
    }

    // Resend cooldown
    const [existing] = await db.query(
      'SELECT last_sent_at FROM user_email_otps WHERE user_id = ?', [userId]
    );
    if (existing.length) {
      const elapsed = (Date.now() - new Date(existing[0].last_sent_at).getTime()) / 1000;
      if (elapsed < OTP_RESEND_COOLDOWN_S) {
        return res.status(429).json({
          error: 'Please wait before requesting another code',
          retryAfter: Math.ceil(OTP_RESEND_COOLDOWN_S - elapsed),
        });
      }
    }

    const code = String(crypto.randomInt(100000, 1000000)); // 6 digits, no leading-zero ambiguity
    await db.query(
      `REPLACE INTO user_email_otps (user_id, email, code_hash, attempts, expires_at, last_sent_at)
       VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())`,
      [userId, email, sha256(code), OTP_TTL_MINUTES]
    );

    await sendMail({
      to: email,
      subject: `${code} is your Playmist verification code`,
      html: templates.playerEmailOtp({ name: req.user.username || 'player', code }),
    });

    return res.json({ success: true, expiresInMinutes: OTP_TTL_MINUTES });
  } catch (err) {
    console.error('sendEmailOtp error:', err);
    return res.status(502).json({ error: 'Could not send the verification email, please try again' });
  }
};

/**
 * POST /api/v1/user/email/verify-otp  { email, code }
 * On success links the email, marks it verified, and grants "The Activist"
 * (500 XP + 300 credits) exactly once per account.
 */
exports.verifyEmailOtp = async (req, res) => {
  try {
    const userId = req.user.id;
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid email or code' });
    }

    const [rows] = await db.query(
      'SELECT email, code_hash, attempts, expires_at FROM user_email_otps WHERE user_id = ?',
      [userId]
    );
    if (!rows.length || rows[0].email !== email) {
      return res.status(400).json({ error: 'No code was requested for this email' });
    }
    const otp = rows[0];

    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await db.query('DELETE FROM user_email_otps WHERE user_id = ?', [userId]);
      return res.status(400).json({ error: 'This code has expired — request a new one' });
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts — request a new code' });
    }
    if (sha256(code) !== otp.code_hash) {
      await db.query('UPDATE user_email_otps SET attempts = attempts + 1 WHERE user_id = ?', [userId]);
      return res.status(400).json({
        error: 'Incorrect code',
        attemptsLeft: OTP_MAX_ATTEMPTS - otp.attempts - 1,
      });
    }

    // Re-check uniqueness at claim time (someone else may have verified it
    // during the OTP window), then link.
    const [taken] = await db.query(
      'SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]
    );
    if (taken.length) {
      return res.status(409).json({ error: 'This email is already linked to another account' });
    }

    await db.query(
      'UPDATE users SET email = ?, email_verified = 1 WHERE id = ?', [email, userId]
    );
    await db.query('DELETE FROM user_email_otps WHERE user_id = ?', [userId]);

    // One-time reward — no-op if the account earned it before (e.g. re-linking).
    const newAchievements = [];
    try {
      const r = await grantAchievement(userId, 'email_verified');
      if (r.granted) newAchievements.push(r.achievement);
    } catch (achErr) {
      console.error('email_verified achievement grant failed:', achErr.message);
    }

    const [u] = await db.query('SELECT credits, xp, level FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      email,
      emailVerified: true,
      newAchievements,
      credits: u[0].credits,
      xp: u[0].xp,
      level: u[0].level,
    });
  } catch (err) {
    console.error('verifyEmailOtp error:', err);
    return res.status(500).json({ error: err.message });
  }
};
