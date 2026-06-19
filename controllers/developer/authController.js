const bcrypt = require('bcryptjs');
const db     = require('../../config/database');

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

  try {
    const [existing] = await db.query('SELECT id FROM developers WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing.length) {
      return res.render('developer/signup', {
        title: 'Developer Signup',
        errors: ['An account with this email already exists.'],
        form,
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      `INSERT INTO developers (name, email, phone, country, studio_name, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone?.trim() || null,
        country.trim(),
        studio_name.trim(),
        hash,
      ]
    );

    req.session.developer = {
      id:          result.insertId,
      name:        name.trim(),
      email:       email.trim().toLowerCase(),
      studio_name: studio_name.trim(),
      avatar_url:  null,
    };
    req.flash('success_msg', `Welcome, ${name.trim()}! Your developer account is ready.`);
    res.redirect('/developer/dashboard');
  } catch (err) {
    res.render('developer/signup', {
      title: 'Developer Signup',
      errors: ['Registration failed. Please try again.'],
      form,
    });
  }
};

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
      id:         dev.id,
      name:       dev.name,
      email:      dev.email,
      studio_name: dev.studio_name,
      avatar_url: dev.avatar_url || null,
    };
    res.redirect('/developer/dashboard');
  } catch (err) {
    res.render('developer/login', { title: 'Developer Login', errors: ['Login failed. Please try again.'] });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/developer/login'));
};
