require('dotenv').config();

process.on('uncaughtException', (err) => {
  require('fs').appendFileSync(
    require('path').join(__dirname, 'crash.log'),
    `[${new Date().toISOString()}] Uncaught Exception: ${err.stack || err}\n`
  );
});

process.on('unhandledRejection', (reason) => {
  require('fs').appendFileSync(
    require('path').join(__dirname, 'crash.log'),
    `[${new Date().toISOString()}] Unhandled Rejection: ${reason?.stack || reason}\n`
  );
});

const express = require('express');
const path    = require('path');
const morgan  = require('morgan');
const helmet  = require('helmet');
const session = require('express-session');
const flash   = require('connect-flash');
const cors    = require('cors');
const db      = require('./config/database');

const publicRoutes      = require('./routes/index');
const sitehandlerRoutes = require('./routes/sitehandler');
const apiRoutes         = require('./routes/api');

const app  = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ─── View Engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Static Files ────────────────────────────────────────────────────────────
// redirect: false — 'public/games' is a real directory, but '/games' must
// reach our game-library route rather than getting a 301 to '/games/'.
app.use(express.static(path.join(__dirname, 'public'), { redirect: false }));
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
app.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const lanIp = Object.values(networkInterfaces())
    .flat()
    .find((i) => i.family === 'IPv4' && !i.internal)?.address;

  console.log(`🎮 Playmist website → http://localhost:${PORT}`);
  console.log(`🛠️  Admin panel     → http://localhost:${PORT}/sitehandler`);
  console.log(`📡 Mobile API      → http://localhost:${PORT}/api`);
  if (lanIp) {
    console.log(`🌐 LAN access      → http://${lanIp}:${PORT}`);
  }
});
// Trigger nodemon reload

