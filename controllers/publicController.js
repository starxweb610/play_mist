const db = require('../config/database');
const { formatImagePath } = require('../utils/images');

const APP_URL = () => process.env.APP_URL || 'https://playmist.app';

/**
 * Shape a DB game row into the fields the public templates need.
 */
function toCardView(g) {
  return {
    id:          g.id,
    title:       g.title,
    slug:        g.slug,
    genre:       g.genre || 'Game',
    type:        g.type,
    orientation: g.orientation || 'landscape',
    shortDesc:   g.short_description || '',
    thumbnail:   formatImagePath(g.promotional_thumbnail || g.thumbnail_url),
    rating:      g.rating || null,
    plays:       g.plays || null,
    flag:        g.flag || null,
    isFeatured:  !!g.is_featured,
    playable:    g.type === 'webgl' && !!g.play_url,
  };
}

const GAME_FIELDS = `
  id, title, slug, short_description, long_description, genre, type, orientation,
  version, play_url, trailer_url, thumbnail_url, secondary_thumbnail, promotional_thumbnail,
  studio, size, plays, rating, credits_cost, flag, is_featured, created_at
`;

/**
 * GET /
 * Public landing page (moved from inline server.js)
 */
exports.getHome = async (req, res) => {
  let stats = { totalGames: 50, totalUsers: '10K+', rating: '4.8' };
  let webglGames = [];
  let premiumGames = [];

  try {
    const [statRows] = await db.query('SELECT * FROM site_stats WHERE id = 1');
    if (statRows.length > 0) {
      stats = {
        totalGames: statRows[0].total_games || stats.totalGames,
        totalUsers: statRows[0].total_users || stats.totalUsers,
        rating:     statRows[0].rating      || stats.rating,
      };
    }

    const [games] = await db.query(
      `SELECT ${GAME_FIELDS} FROM games
       WHERE is_active = 1
       ORDER BY is_featured DESC, created_at DESC`
    );

    const cards = games.map(toCardView);
    webglGames   = cards.filter(g => g.type === 'webgl').slice(0, 8);
    premiumGames = cards.filter(g => g.type === 'premium').slice(0, 6);
  } catch (_) {
    // DB not ready — defaults used
  }

  res.render('index', {
    title:      `${res.locals.appName} – All-in-One Mobile Gaming Platform`,
    appUrl:     APP_URL(),
    androidUrl: process.env.ANDROID_STORE_URL || '#',
    iosUrl:     process.env.IOS_STORE_URL    || '#',
    stats,
    webglGames,
    premiumGames,
  });
};

/**
 * GET /games
 * Game library / discovery page — browse all published games.
 */
exports.getGames = async (req, res) => {
  const { type, genre, q } = req.query;
  const validType = type === 'webgl' || type === 'premium' ? type : null;

  let games = [];
  let genres = [];

  try {
    const where = ['is_active = 1'];
    const params = [];

    if (validType) { where.push('type = ?'); params.push(validType); }
    if (genre)     { where.push('genre = ?'); params.push(genre); }
    if (q)         { where.push('title LIKE ?'); params.push(`%${q}%`); }

    const [rows] = await db.query(
      `SELECT ${GAME_FIELDS} FROM games
       WHERE ${where.join(' AND ')}
       ORDER BY is_featured DESC, created_at DESC`,
      params
    );
    games = rows.map(toCardView);

    const [genreRows] = await db.query(
      `SELECT g.name, COUNT(gm.id) AS gameCount
       FROM genres g
       LEFT JOIN games gm ON g.name = gm.genre AND gm.is_active = 1
       GROUP BY g.name
       HAVING gameCount > 0
       ORDER BY g.name ASC`
    );
    genres = genreRows;
  } catch (_) {
    // DB not ready — empty library shown
  }

  res.render('games', {
    title:       `Game Library – ${res.locals.appName}`,
    appUrl:      APP_URL(),
    games,
    genres,
    filters: { type: validType, genre: genre || '', q: q || '' },
  });
};

/**
 * GET /games/:slug
 * Game detail page — description, screenshots, trailer, play / download CTA.
 */
exports.getGameDetail = async (req, res) => {
  const { slug } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT ${GAME_FIELDS} FROM games WHERE slug = ? AND is_active = 1`,
      [slug]
    );

    if (rows.length === 0) {
      return res.redirect('/games');
    }

    const g = rows[0];

    const [tagRows] = await db.query(
      `SELECT t.name FROM game_tags gt JOIN tags t ON gt.tag_id = t.id WHERE gt.game_id = ?`,
      [g.id]
    );
    const [screenshotRows] = await db.query(
      `SELECT image_url FROM game_screenshots WHERE game_id = ?`,
      [g.id]
    );

    const [relatedRows] = await db.query(
      `SELECT ${GAME_FIELDS} FROM games
       WHERE is_active = 1 AND genre = ? AND id != ?
       ORDER BY is_featured DESC, created_at DESC
       LIMIT 4`,
      [g.genre, g.id]
    );

    const game = {
      ...toCardView(g),
      longDesc:    g.long_description || g.short_description || '',
      studio:      g.studio || 'Tiny Bear',
      version:     g.version || '1.0.0',
      size:        g.size || null,
      creditsCost: g.credits_cost || 0,
      trailerUrl:  g.trailer_url || null,
      tags:        tagRows.map(t => t.name),
      screenshots: screenshotRows.map(s => formatImagePath(s.image_url)),
    };

    res.render('game-detail', {
      title:       `${game.title} – ${res.locals.appName}`,
      appUrl:      APP_URL(),
      androidUrl:  process.env.ANDROID_STORE_URL || '#',
      iosUrl:      process.env.IOS_STORE_URL    || '#',
      game,
      relatedGames: relatedRows.map(toCardView),
    });
  } catch (_) {
    res.redirect('/games');
  }
};

/**
 * GET /play/:slug
 * In-browser player for WebGL games. Premium (offline-only) games fall back
 * to the detail page where players are pointed to the app.
 */
exports.getPlayGame = async (req, res) => {
  const { slug } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT ${GAME_FIELDS} FROM games WHERE slug = ? AND is_active = 1`,
      [slug]
    );

    if (rows.length === 0) {
      return res.redirect('/games');
    }

    const g = rows[0];
    if (g.type !== 'webgl' || !g.play_url) {
      return res.redirect(`/games/${slug}`);
    }

    res.render('play', {
      title:  `Play ${g.title} – ${res.locals.appName}`,
      appUrl: APP_URL(),
      game:   toCardView(g),
      playUrl: g.play_url,
    });
  } catch (_) {
    res.redirect('/games');
  }
};

/**
 * GET /sitemap.xml
 * Dynamic XML sitemap for all public, indexable pages.
 */
exports.getSitemap = async (req, res) => {
  const appUrl = APP_URL();

  const staticUrls = [
    { loc: appUrl,                      changefreq: 'weekly',  priority: '1.0' },
    { loc: `${appUrl}/games`,           changefreq: 'daily',   priority: '0.9' },
    { loc: `${appUrl}/privacy-policy`,  changefreq: 'monthly', priority: '0.3' },
  ];

  let gameUrls = [];
  try {
    const [rows] = await db.query(
      `SELECT slug, created_at FROM games WHERE is_active = 1 ORDER BY created_at DESC`
    );
    gameUrls = rows.map(g => ({
      loc:        `${appUrl}/games/${g.slug}`,
      changefreq: 'weekly',
      priority:   '0.8',
      lastmod:    g.created_at ? new Date(g.created_at).toISOString().split('T')[0] : null,
    }));
  } catch (_) {
    // DB unavailable — serve static URLs only
  }

  const allUrls = [...staticUrls, ...gameUrls];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...allUrls.map(u => [
      '  <url>',
      `    <loc>${u.loc}</loc>`,
      u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : '',
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`,
      '  </url>',
    ].filter(Boolean).join('\n')),
    '</urlset>',
  ].join('\n');

  res.set('Content-Type', 'application/xml');
  res.send(xml);
};

/**
 * GET /privacy-policy
 * Privacy Policy page
 */
exports.getPrivacyPolicy = (req, res) => {
  const appUrl = APP_URL();
  const updated = new Date('2025-04-18').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  res.render('privacy-policy', {
    title:       `Privacy Policy – ${res.locals.appName}`,
    appUrl,
    lastUpdated: updated,
  });
};
