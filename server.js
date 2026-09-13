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
const crypto = require('crypto');
const path    = require('path');
const fs      = require('fs');
const morgan  = require('morgan');
const helmet  = require('helmet');
const session = require('express-session');
const flash   = require('connect-flash');
const cors    = require('cors');
const db      = require('./config/database');

const publicRoutes      = require('./routes/index');
const sitehandlerRoutes = require('./routes/sitehandler');
const apiRoutes         = require('./routes/api');
const developerRoutes   = require('./routes/developer');

const profileRoutes     = require('./routes/profiles');
const { MySQLSessionStore } = require('./utils/sessionStore');

const app  = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// nginx on the same host proxies every request. Trusting only the loopback hop
// makes req.ip the real client address (from X-Forwarded-For), so rate limits
// are per visitor instead of one bucket shared by everyone behind 127.0.0.1.
app.set('trust proxy', 'loopback');

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
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
app.use(session({
  secret:            process.env.SESSION_SECRET || 'playmist_dev_secret',
  store:             new MySQLSessionStore({ ttlMs: SESSION_TTL_MS }),
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // Lax keeps the cookie off cross-site POSTs (CSRF) while still sending it
    // when someone follows a link to a profile from another site.
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   SESSION_TTL_MS,
  },
}));

// ─── Flash ───────────────────────────────────────────────────────────────────
app.use(flash());

// ─── Asset cache busting ─────────────────────────────────────────────────────
// /css/*.css is served with a 4h max-age and the <link> tags carry no version,
// so after a deploy a returning visitor could get NEW html with OLD css. That
// is exactly how the portfolio store buttons rendered broken on mobile: the
// markup shipped with a `.fo-link-logo` sizing rule the cached stylesheet did
// not have. The stamp changes whenever any stylesheet OR script changes, so a
// deploy invalidates them. Scripts count too: a page whose markup and its JS
// must agree (the Game Builder IDE reads ids the view renders) breaks the same
// way when only one half is fresh. app.locals (not res.locals) so it is
// defined for every render, including any that bypasses the per-request
// middleware.
app.locals.assetV = (() => {
  try {
    // Both stylesheet roots: the admin panel's CSS lives apart from the site's,
    // and leaving it out meant an admin.css-only change produced no new stamp.
    // The script roots are in for the same reason.
    const dirs = [
      path.join(__dirname, 'public', 'css'),
      path.join(__dirname, 'public', 'sitehandler', 'css'),
      path.join(__dirname, 'public', 'js'),
      path.join(__dirname, 'public', 'sitehandler', 'js'),
    ];
    const sig = dirs.flatMap((dir) => {
      let files = [];
      try { files = fs.readdirSync(dir); } catch (_) { return []; }
      return files.filter((f) => f.endsWith('.css') || f.endsWith('.js')).sort().map((f) => {
        const st = fs.statSync(path.join(dir, f));
        // The parent is in the key as well as the directory name, so
        // public/js/x.js and public/sitehandler/js/x.js cannot collide.
        return `${path.basename(path.dirname(dir))}/${path.basename(dir)}/${f}:${st.size}:${st.mtimeMs}`;
      });
    }).join('|');
    return crypto.createHash('sha1').update(sig).digest('hex').slice(0, 8);
  } catch (_) {
    return String(Date.now()); // never block boot over a cache buster
  }
})();

// ─── Global Template Locals ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.appName     = process.env.APP_NAME || 'Playmist';
  // Lets the public navbar mark which nav item matches the current page.
  res.locals.currentPath = req.path;
  // connect-flash's req.flash(type) runs `session.flash = session.flash || {}`
  // even when it is only *reading*. That marks the session dirty, which
  // defeats saveUninitialized:false — every anonymous visitor was given a
  // persisted `sessions` row and a Set-Cookie. Only read when something was
  // actually flashed; req.flash() returns [] for a missing key anyway.
  const hasFlash = !!(req.session && req.session.flash);
  res.locals.success_msg = hasFlash ? req.flash('success_msg') : [];
  res.locals.error_msg   = hasFlash ? req.flash('error_msg')   : [];
  res.locals.error       = hasFlash ? req.flash('error')       : [];

  res.locals.admin       = req.session.admin || null;
  res.locals.developer   = req.session.developer || null;
  // Who is *logged in*, for the public navbar. Kept separate from `developer`
  // because controllers pass their own `developer` local meaning something
  // else entirely — the game detail page passes the game's AUTHOR — and a
  // template local shadows res.locals. That shadowing made the navbar show
  // "My Dashboard" to anonymous visitors on every game with an author.
  // Nothing but this line ever sets authDeveloper.
  res.locals.authDeveloper = req.session.developer || null;
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);
app.use('/sitehandler', sitehandlerRoutes);
app.use('/developer', developerRoutes);
app.use('/', profileRoutes);
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
const { runMigrations } = require('./utils/migrate');
const { startBackupScheduler } = require('./utils/backupScheduler');
const { startNotificationScheduler } = require('./utils/notificationScheduler');

runMigrations().then(() => {
  startBackupScheduler();
  startNotificationScheduler();
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
});
// Trigger nodemon reload

