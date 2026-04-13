require('dotenv').config();
const express = require('express');
const path    = require('path');
const morgan  = require('morgan');
const helmet  = require('helmet');
const session = require('express-session');
const flash   = require('connect-flash');
const db      = require('./config/database');

const publicRoutes      = require('./routes/index');
const sitehandlerRoutes = require('./routes/sitehandler');
const apiRoutes         = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ─── View Engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Static Files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
// Serve premium/addressable game assets (extracted ZIPs in uploads/games/premium)
app.use('/games/premium', express.static(path.join(__dirname, 'uploads', 'games', 'premium')));

// ─── Body Parsers ────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─── Sessions ────────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'playmist_dev_secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   1000 * 60 * 60 * 8,
  },
}));

// ─── Flash ───────────────────────────────────────────────────────────────────
app.use(flash());

// ─── Global Template Locals ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.appName     = process.env.APP_NAME || 'Playmist';
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg   = req.flash('error_msg');
  res.locals.error       = req.flash('error');
  res.locals.admin       = req.session.admin || null;
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);
app.use('/sitehandler', sitehandlerRoutes);
app.use('/', publicRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/sitehandler')) {
    return res.status(404).render('sitehandler/errors/404', { title: 'Not Found' });
  }
  res.redirect('/');
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('❌', err.stack || err);
  if (req.path.startsWith('/sitehandler')) {
    return res.status(500).render('sitehandler/errors/500', {
      title: 'Server Error',
      error: process.env.NODE_ENV !== 'production' ? err.message : null,
    });
  }
  res.status(500).send('Something went wrong.');
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎮 Playmist website → http://localhost:${PORT}`);
  console.log(`🛠️  Admin panel     → http://localhost:${PORT}/sitehandler`);
  console.log(`📡 Mobile API      → http://localhost:${PORT}/api`);
});
