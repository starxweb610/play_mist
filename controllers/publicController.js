const db = require('../config/database');

/**
 * GET /
 * Public landing page (moved from inline server.js)
 */
exports.getHome = async (req, res) => {
  let stats = { totalGames: 50, totalUsers: '10K+', rating: '4.8' };

  try {
    const [rows] = await db.query('SELECT * FROM site_stats WHERE id = 1');
    if (rows.length > 0) {
      stats = {
        totalGames: rows[0].total_games || stats.totalGames,
        totalUsers: rows[0].total_users || stats.totalUsers,
        rating:     rows[0].rating      || stats.rating,
      };
    }
  } catch (_) {
    // DB not ready — defaults used
  }

  res.render('index', {
    title:      `${res.locals.appName} – All-in-One Mobile Gaming Platform`,
    appUrl:     process.env.APP_URL         || 'https://playmist.app',
    androidUrl: process.env.ANDROID_STORE_URL || '#',
    iosUrl:     process.env.IOS_STORE_URL    || '#',
    stats,
  });
};

/**
 * GET /privacy-policy
 * Privacy Policy page
 */
exports.getPrivacyPolicy = (req, res) => {
  const appUrl = process.env.APP_URL || 'https://playmist.app';
  const updated = new Date('2025-04-18').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  res.render('privacy-policy', {
    title:       `Privacy Policy – ${res.locals.appName}`,
    appUrl,
    lastUpdated: updated,
  });
};
