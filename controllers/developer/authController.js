const bcrypt    = require('bcryptjs');
const db        = require('../../config/database');
const mailer    = require('../../utils/mailer');
const templates = require('../../utils/emailTemplates');

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Signup ─────────────────────────────────────────────────────────────────────

exports.getSignup = (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  res.render('developer/signup', { title: 'Developer Signup', errors: [], form: {} });
};

exports.postSignup = async (req, res) => {
  const { name, email, phone, country, studio_name, password, confirm_password } = req.body;
  const form = { name, email, phone, country, studio_name };
  const errors = [];

  if (!name?.trim())        errors.push('Full name is required.');
  else if (name.trim().length > 200) errors.push('Full name must be 200 characters or fewer.');
  if (!email?.trim())       errors.push('Email address is required.');
  else if (email.trim().length > 200) errors.push('Email must be 200 characters or fewer.');
  if (!country?.trim())     errors.push('Country is required.');
  else if (country.trim().length > 200) errors.push('Country must be 200 characters or fewer.');
  if (!studio_name?.trim()) errors.push('Studio name is required.');
  else if (studio_name.trim().length > 200) errors.push('Studio name must be 200 characters or fewer.');
  if (phone?.trim() && phone.trim().length > 200) errors.push('Phone must be 200 characters or fewer.');
  if (!password)            errors.push('Password is required.');
  else if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirm_password) errors.push('Passwords do not match.');

  if (errors.length) {
    return res.render('developer/signup', { title: 'Developer Signup', errors, form });
  }

  const normalEmail = email.trim().toLowerCase();

  try {
    const [existing] = await db.query('SELECT id FROM developers WHERE email = ?', [normalEmail]);
    if (existing.length) {
      return res.render('developer/signup', {
        title: 'Developer Signup',
        errors: ['An account with this email already exists.'],
        form,
      });
    }

    const hash     = await bcrypt.hash(password, 12);
    const code     = generateCode();
    const formData = JSON.stringify({
      name: name.trim(),
      email: normalEmail,
      phone: phone?.trim() || null,
      country: country.trim(),
      studio_name: studio_name.trim(),
      password_hash: hash,
    });

    // Clear any previous pending verifications for this email
    await db.query('DELETE FROM developer_email_verifications WHERE email = ?', [normalEmail]);

    await db.query(
      `INSERT INTO developer_email_verifications (email, code, form_data, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [normalEmail, code, formData]
    );

    // Send verification email (fire-and-forget; don't block on failure)
    mailer.sendMail({
      to:      normalEmail,
      subject: `${process.env.APP_NAME || 'PlayMist'} — Verify your developer account`,
      html:    templates.verificationCode({ name: name.trim(), code }),
    }).catch(err => console.error('Verification email failed:', err.message));

    req.session.pendingVerification = { email: normalEmail, name: name.trim() };
    res.redirect('/developer/verify-email');
  } catch (err) {
    console.error('postSignup error:', err);
    res.render('developer/signup', {
      title: 'Developer Signup',
      errors: ['Registration failed. Please try again.'],
      form,
    });
  }
};

// ── Email Verification ─────────────────────────────────────────────────────────

exports.getVerifyEmail = (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  if (!req.session.pendingVerification) return res.redirect('/developer/signup');

  res.render('developer/verify-email', {
    title: 'Verify Email',
    email: req.session.pendingVerification.email,
    errors: [],
    success: null,
  });
};

exports.postVerifyEmail = async (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  if (!req.session.pendingVerification) return res.redirect('/developer/signup');

  const { email } = req.session.pendingVerification;
  const code = (req.body.code || '').trim().replace(/\s/g, '');

  const renderError = (msg) => res.render('developer/verify-email', {
    title: 'Verify Email',
    email,
    errors: [msg],
    success: null,
  });

  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return renderError('Please enter the 6-digit code sent to your email.');
  }

  try {
    const [rows] = await db.query(
      `SELECT * FROM developer_email_verifications
       WHERE email = ? AND code = ? AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );

    if (!rows.length) {
      // Check if an unexpired row exists (wrong code)
      const [anyRows] = await db.query(
        'SELECT id FROM developer_email_verifications WHERE email = ? AND expires_at > NOW()',
        [email]
      );
      return renderError(anyRows.length
        ? 'Incorrect code. Please try again.'
        : 'This code has expired. Please request a new one.');
    }

    const { form_data, id: verificationId } = rows[0];
    const { name, email: devEmail, phone, country, studio_name, password_hash } = JSON.parse(form_data);

    // Double-check email not taken (race condition guard)
    const [dupCheck] = await db.query('SELECT id FROM developers WHERE email = ?', [devEmail]);
    if (dupCheck.length) {
      await db.query('DELETE FROM developer_email_verifications WHERE id = ?', [verificationId]);
      delete req.session.pendingVerification;
      return res.redirect('/developer/login');
    }

    const [result] = await db.query(
      `INSERT INTO developers (name, email, phone, country, studio_name, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, devEmail, phone, country, studio_name, password_hash]
    );

    await db.query('DELETE FROM developer_email_verifications WHERE email = ?', [devEmail]);

    req.session.pendingVerification = null;
    req.session.developer = {
      id:          result.insertId,
      name,
      email:       devEmail,
      studio_name,
      avatar_url:  null,
    };

    req.flash('success_msg', `Welcome, ${name}! Your developer account is ready.`);
    res.redirect('/developer/dashboard');
  } catch (err) {
    console.error('postVerifyEmail error:', err);
    renderError('Verification failed. Please try again.');
  }
};

exports.postResendVerification = async (req, res) => {
  if (!req.session.pendingVerification) {
    return res.json({ ok: false, error: 'No pending verification found.' });
  }

  const { email, name } = req.session.pendingVerification;

  try {
    const [rows] = await db.query(
      'SELECT created_at FROM developer_email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [email]
    );

    // Rate-limit: 60 seconds between resends
    if (rows.length) {
      const secondsAgo = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
      if (secondsAgo < 60) {
        return res.json({ ok: false, error: `Please wait ${Math.ceil(60 - secondsAgo)} seconds before requesting a new code.` });
      }
    }

    // Need the form data from most recent pending row
    const [pendingRows] = await db.query(
      'SELECT form_data FROM developer_email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [email]
    );
    if (!pendingRows.length) {
      return res.json({ ok: false, error: 'Signup session expired. Please sign up again.' });
    }

    const code = generateCode();
    await db.query('DELETE FROM developer_email_verifications WHERE email = ?', [email]);
    await db.query(
      `INSERT INTO developer_email_verifications (email, code, form_data, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [email, code, pendingRows[0].form_data]
    );

    mailer.sendMail({
      to:      email,
      subject: `${process.env.APP_NAME || 'PlayMist'} — New verification code`,
      html:    templates.verificationCode({ name, code }),
    }).catch(err => console.error('Resend email failed:', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('postResendVerification error:', err);
    res.json({ ok: false, error: 'Failed to resend code. Please try again.' });
  }
};

// ── Login ──────────────────────────────────────────────────────────────────────

exports.getLogin = (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  res.render('developer/login', { title: 'Developer Login', errors: [] });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  const errors = [];

  if (!email?.trim() || !password) {
    errors.push('Email and password are required.');
    return res.render('developer/login', { title: 'Developer Login', errors });
  }

  try {
    const [rows] = await db.query('SELECT * FROM developers WHERE email = ?', [email.trim().toLowerCase()]);
    if (!rows.length) {
      return res.render('developer/login', { title: 'Developer Login', errors: ['Invalid email or password.'] });
    }

    const dev = rows[0];
    const match = await bcrypt.compare(password, dev.password_hash);
    if (!match) {
      return res.render('developer/login', { title: 'Developer Login', errors: ['Invalid email or password.'] });
    }

    if (!dev.is_active) {
      return res.render('developer/login', {
        title: 'Developer Login',
        errors: [`Your account has been suspended${dev.ban_reason ? ': ' + dev.ban_reason : '.'}`],
      });
    }

    await db.query('UPDATE developers SET last_login = NOW() WHERE id = ?', [dev.id]);

    req.session.developer = {
      id:          dev.id,
      name:        dev.name,
      email:       dev.email,
      studio_name: dev.studio_name,
      avatar_url:  dev.avatar_url || null,
    };
    res.redirect('/developer/dashboard');
  } catch (err) {
    res.render('developer/login', { title: 'Developer Login', errors: ['Login failed. Please try again.'] });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/developer/login'));
};

// ── Password Reset ───────────────────────────────────────────────────────────

exports.getForgotPassword = (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  res.render('developer/forgot-password', { title: 'Reset Password', errors: [], form: {} });
};

exports.postForgotPassword = async (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');

  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.render('developer/forgot-password', {
      title: 'Reset Password',
      errors: ['Email address is required.'],
      form: { email },
    });
  }

  try {
    const [rows] = await db.query('SELECT id, name FROM developers WHERE email = ?', [email]);

    // Only generate + send a code if an account actually exists. We respond the
    // same way either way to avoid leaking which emails are registered.
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
        subject: `${process.env.APP_NAME || 'PlayMist'} — Reset your password`,
        html:    templates.resetPasswordCode({ name: rows[0].name, code }),
      }).catch(err => console.error('Reset email failed:', err.message));
    }

    req.session.pendingReset = { email };
    res.redirect('/developer/reset-password');
  } catch (err) {
    console.error('postForgotPassword error:', err);
    res.render('developer/forgot-password', {
      title: 'Reset Password',
      errors: ['Something went wrong. Please try again.'],
      form: { email },
    });
  }
};

exports.getResetPassword = (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  if (!req.session.pendingReset) return res.redirect('/developer/forgot-password');

  res.render('developer/reset-password', {
    title: 'Reset Password',
    email: req.session.pendingReset.email,
    errors: [],
  });
};

exports.postResetPassword = async (req, res) => {
  if (req.session.developer) return res.redirect('/developer/dashboard');
  if (!req.session.pendingReset) return res.redirect('/developer/forgot-password');

  const { email } = req.session.pendingReset;
  const code = (req.body.code || '').trim().replace(/\s/g, '');
  const { new_password, confirm_password } = req.body;

  const renderError = (msg) => res.render('developer/reset-password', {
    title: 'Reset Password',
    email,
    errors: Array.isArray(msg) ? msg : [msg],
  });

  const errors = [];
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) errors.push('Please enter the 6-digit code sent to your email.');
  if (!new_password)                    errors.push('New password is required.');
  else if (new_password.length < 8)     errors.push('Password must be at least 8 characters.');
  if (new_password !== confirm_password) errors.push('Passwords do not match.');
  if (errors.length) return renderError(errors);

  try {
    const [rows] = await db.query(
      `SELECT * FROM developer_password_resets
       WHERE email = ? AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      return renderError('This code has expired. Please request a new one.');
    }

    const reset = rows[0];

    // Too many wrong attempts — invalidate the code.
    if (reset.attempts >= 5) {
      await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);
      return renderError('Too many incorrect attempts. Please request a new code.');
    }

    if (reset.code !== code) {
      await db.query('UPDATE developer_password_resets SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
      return renderError('Incorrect code. Please try again.');
    }

    const [devRows] = await db.query('SELECT id, name, email FROM developers WHERE email = ?', [email]);
    if (!devRows.length) {
      await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);
      delete req.session.pendingReset;
      return res.redirect('/developer/login');
    }

    const dev  = devRows[0];
    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE developers SET password_hash = ? WHERE id = ?', [hash, dev.id]);
    await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);

    // Confirmation email (fire-and-forget)
    mailer.sendMail({
      to:      dev.email,
      subject: `Your ${process.env.APP_NAME || 'PlayMist'} developer password was changed`,
      html:    templates.passwordChanged({ name: dev.name }),
    }).catch(err => console.error('passwordChanged email failed:', err.message));

    delete req.session.pendingReset;
    req.flash('success_msg', 'Your password has been reset. Please log in with your new password.');
    res.redirect('/developer/login');
  } catch (err) {
    console.error('postResetPassword error:', err);
    renderError('Password reset failed. Please try again.');
  }
};

exports.postResendResetCode = async (req, res) => {
  if (!req.session.pendingReset) {
    return res.json({ ok: false, error: 'No password reset in progress.' });
  }

  const { email } = req.session.pendingReset;

  try {
    const [rows] = await db.query(
      'SELECT created_at FROM developer_password_resets WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [email]
    );

    // Rate-limit: 60 seconds between resends
    if (rows.length) {
      const secondsAgo = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
      if (secondsAgo < 60) {
        return res.json({ ok: false, error: `Please wait ${Math.ceil(60 - secondsAgo)} seconds before requesting a new code.` });
      }
    }

    const [devRows] = await db.query('SELECT name FROM developers WHERE email = ?', [email]);

    // Always reply ok to avoid account enumeration; only send if account exists.
    if (devRows.length) {
      const code = generateCode();
      await db.query('DELETE FROM developer_password_resets WHERE email = ?', [email]);
      await db.query(
        `INSERT INTO developer_password_resets (email, code, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
        [email, code]
      );

      mailer.sendMail({
        to:      email,
        subject: `${process.env.APP_NAME || 'PlayMist'} — New password reset code`,
        html:    templates.resetPasswordCode({ name: devRows[0].name, code }),
      }).catch(err => console.error('Resend reset email failed:', err.message));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('postResendResetCode error:', err);
    res.json({ ok: false, error: 'Failed to resend code. Please try again.' });
  }
};
