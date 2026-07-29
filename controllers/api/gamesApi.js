const db   = require('../../config/database');
const fs   = require('fs');
const path = require('path');
const PATHS = require('../../config/paths');
const r2   = require('../../config/r2');
const { formatImagePath } = require('../../utils/images');
const { formatBytes, formatCount, formatRating } = require('../../utils/format');

/**
 * GET /api/v1/all-games
 *
 * Returns a raw JSON array of active games.
 * Field names mirror the GameInfo.cs model in Unity exactly so that
 * GameInfoParser.FromJsonArray() can deserialise without modification.
 *
 * Unity GameInfo fields  →  DB column
 * ─────────────────────────────────────
 * id                     →  id          (cast to string)
 * gamename               →  title
 * gameurl                →  play_url
 * description            →  long_description  (falls back to short_description)
 * imageurl               →  thumbnail_url     (nullable)
 * trailerurl             →  trailer_url       (nullable)
 * uploadedat             →  created_at
 * gameorientation        →  orientation
 * gameversion            →  version
 * gametype               →  type
 * gamestatus             →  is_active → 'active' | 'inactive'
 * adFiles                →  public URLs for every file inside the premium
 *                            addressables directory (empty for webgl games)
 */

/**
 * Returns public URLs for every file belonging to a premium game's
 * addressable bundle.
 *
 * New games store `file_path` as an R2 key prefix (e.g. "games/webgl/my-slug")
 * — list the bucket under that prefix and return R2 public URLs.
 *
 * Legacy games store `file_path` as an absolute local filesystem path —
 * walk that directory and build /games/webgl or /games/premium URLs as before.
 * Returns [] if neither resolves to anything.
 */
async function collectAdFiles(filePath, type) {
  if (!filePath) return [];

  if (!path.isAbsolute(filePath)) {
    const keys = await r2.listPrefix(`${filePath}/`);
    return keys.map(key => r2.getPublicUrl(key));
  }

  const results = [];
  if (!fs.existsSync(filePath)) return results;
  const baseDir = type === 'premium' && filePath.includes('premium') ? PATHS.PREMIUM_DIR : PATHS.WEBGL_DIR;
  const urlPrefix = type === 'premium' && filePath.includes('premium') ? '/games/premium' : '/games/webgl';

  (function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      // Skip macOS metadata folders and dotfiles created by macOS zip tool
      if (entry.name === '__MACOSX' || entry.name.startsWith('._')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        results.push(`${urlPrefix}/${rel}`);
      }
    }
  })(filePath);
  return results;
}

/**
 * Columns shared by every game-list query. `plays` and `rating` are no longer
 * read from the manual varchar columns — plays is the real count of rows in
 * analytics_games and rating is the live average of user-submitted ratings.
 */
const GAME_LIST_COLUMNS = `
       g.id, g.title, g.slug, g.short_description, g.long_description,
       g.play_url, g.thumbnail_url, g.secondary_thumbnail, g.promotional_thumbnail, g.trailer_url,
       g.orientation, g.version, g.type, g.is_active, g.is_featured, g.created_at,
       g.file_path, g.zip_url,
       g.genre, g.studio, g.size, g.size_bytes, g.credits_cost, g.flag,
       (SELECT COUNT(*)       FROM analytics_games ag WHERE ag.game_id = g.id) AS play_count,
       (SELECT AVG(gr.rating) FROM game_ratings    gr WHERE gr.game_id = g.id) AS avg_rating,
       (SELECT COUNT(*)       FROM game_ratings    gr WHERE gr.game_id = g.id) AS rating_count`;

async function fetchTagsAndScreenshotsMaps() {
  const [tagsRows] = await db.query(
    `SELECT gt.game_id, t.name
     FROM game_tags gt
     JOIN tags t ON gt.tag_id = t.id`
  );
  const [screenshotsRows] = await db.query(
    `SELECT game_id, image_url FROM game_screenshots`
  );

  const tagsMap = {};
  for (const r of tagsRows) {
    if (!tagsMap[r.game_id]) tagsMap[r.game_id] = [];
    tagsMap[r.game_id].push(r.name);
  }

  const screenshotsMap = {};
  for (const r of screenshotsRows) {
    if (!screenshotsMap[r.game_id]) screenshotsMap[r.game_id] = [];
    screenshotsMap[r.game_id].push(r.image_url);
  }

  return { tagsMap, screenshotsMap };
}

// Field names mirror the GameInfo.cs model in Unity exactly (see header note)
async function mapGameRow(g, tagsMap, screenshotsMap) {
  return {
    id:                   String(g.id),
    slug:                 g.slug || null,
    gamename:             g.title,
    gameurl:              g.play_url  || '',
    description:          g.long_description || g.short_description || '',
    imageurl:             formatImagePath(g.thumbnail_url),
    secondaryThumbnail:   formatImagePath(g.secondary_thumbnail),
    promotionalThumbnail: formatImagePath(g.promotional_thumbnail),
    trailerurl:           g.trailer_url      || '',
    uploadedat:           g.created_at ? g.created_at.toISOString() : '',
    gameorientation:      g.orientation || 'landscape',
    gameversion:          g.version    || '1.0.0',
    gametype:             g.type,
    gamestatus:           g.is_active ? 'active' : 'inactive',
    isFeatured:           g.is_featured === 1,
    zipurl:               g.zip_url    || '',
    adFiles:              g.type === 'premium' ? await collectAdFiles(g.file_path, g.type) : [],
    genre:                g.genre || '',
    studio:               g.studio || '',
    // size_bytes (auto-captured at upload) wins; legacy manual `size` is the fallback
    size:                 g.size_bytes ? formatBytes(g.size_bytes) : (g.size || ''),
    plays:                formatCount(g.play_count),
    rating:               formatRating(g.avg_rating),
    ratingCount:          Number(g.rating_count) || 0,
    creditsCost:          g.credits_cost || 0,
    flag:                 g.flag || null,
    tags:                 tagsMap[g.id] || [],
    screenshots:          (screenshotsMap[g.id] || []).map(formatImagePath),
  };
}

exports.getAllGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${GAME_LIST_COLUMNS}
       FROM games g
       WHERE g.is_active = 1
       ORDER BY g.is_featured DESC, g.created_at DESC`
    );

    const { tagsMap, screenshotsMap } = await fetchTagsAndScreenshotsMaps();
    const games = await Promise.all(rows.map(g => mapGameRow(g, tagsMap, screenshotsMap)));

    // Unity's JsonUtility expects a plain JSON array at the root
    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/all-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getLatestGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${GAME_LIST_COLUMNS}
       FROM games g
       WHERE g.is_active = 1
       ORDER BY g.created_at DESC, g.id DESC
       LIMIT 8`
    );

    const { tagsMap, screenshotsMap } = await fetchTagsAndScreenshotsMaps();
    const games = await Promise.all(rows.map(g => mapGameRow(g, tagsMap, screenshotsMap)));

    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/latest-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getPopularGames = async (req, res) => {
  try {
    // Popularity ranks by last-7-days plays; displayed `plays` stays all-time
    const [rows] = await db.query(
      `SELECT ${GAME_LIST_COLUMNS},
              (SELECT COUNT(*) FROM analytics_games a
               WHERE a.game_id = g.id
                 AND a.event_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS recent_play_count
       FROM games g
       WHERE g.is_active = 1
       ORDER BY recent_play_count DESC, g.id DESC
       LIMIT 5`
    );

    const { tagsMap, screenshotsMap } = await fetchTagsAndScreenshotsMaps();
    const games = await Promise.all(rows.map(g => mapGameRow(g, tagsMap, screenshotsMap)));

    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/popular-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── Coming Soon (in-development titles) ──────────────────────────────────────

/** Hard cap on how many in-development titles the app will ever be shown. */
const COMING_SOON_LIMIT = 5;

/**
 * Deliberately NOT mapGameRow: the list payload carries no build URLs at all
 * (`zipurl`, `gameurl`, `adFiles`) and no price. An unreleased build's location
 * never leaves the server from this endpoint, so no client — modified or not —
 * can download a game from the Coming Soon rail. The demo build URL is served
 * only by getComingSoonGameDetail below, and only when a demo is published.
 */
function mapComingSoonRow(g, screenshotsMap) {
  return {
    id:                   String(g.id),
    slug:                 g.slug || null,
    gamename:             g.title,
    description:          g.long_description || g.short_description || '',
    imageurl:             formatImagePath(g.thumbnail_url),
    secondaryThumbnail:   formatImagePath(g.secondary_thumbnail),
    promotionalThumbnail: formatImagePath(g.promotional_thumbnail),
    trailerurl:           g.trailer_url || '',
    screenshots:          (screenshotsMap[g.id] || []).map(formatImagePath),
    gameorientation:      g.orientation || 'landscape',
    gametype:             g.type,
    genre:                g.genre  || '',
    studio:               g.studio || '',
    releaseStage:         g.release_stage,
    expectedRelease:      g.expected_release || '',
    // A demo exists and is switched on — the client shows a "Play the demo" CTA
    // and then fetches the detail endpoint for the actual build URL.
    hasDemo:              !!(g.demo_enabled && g.demo_zip_url),
    demoVersion:          (g.demo_enabled && g.demo_zip_url) ? (g.demo_version || '0.1.0') : null,
    demoSize:             g.demo_size_bytes ? formatBytes(g.demo_size_bytes) : '',
  };
}

const COMING_SOON_COLUMNS = `
       g.id, g.title, g.slug, g.short_description, g.long_description,
       g.thumbnail_url, g.secondary_thumbnail, g.promotional_thumbnail, g.trailer_url,
       g.orientation, g.type, g.genre, g.studio,
       g.release_stage, g.expected_release, g.coming_soon_rank,
       g.demo_zip_url, g.demo_version, g.demo_enabled, g.demo_size_bytes`;

/**
 * GET /api/v1/coming-soon-games
 * Up to COMING_SOON_LIMIT in-development titles for the Dashboard rail.
 * The LIMIT is authoritative here — the client caps again defensively, but the
 * server decides which five exist.
 */
exports.getComingSoonGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${COMING_SOON_COLUMNS}
       FROM games g
       WHERE g.release_stage = 'in_development'
       ORDER BY g.coming_soon_rank ASC, g.created_at DESC
       LIMIT ${COMING_SOON_LIMIT}`
    );

    const [screenshotsRows] = await db.query('SELECT game_id, image_url FROM game_screenshots');
    const screenshotsMap = {};
    for (const r of screenshotsRows) {
      if (!screenshotsMap[r.game_id]) screenshotsMap[r.game_id] = [];
      screenshotsMap[r.game_id].push(r.image_url);
    }

    res.json(rows.map(g => mapComingSoonRow(g, screenshotsMap)));
  } catch (err) {
    console.error('GET /api/v1/coming-soon-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/v1/coming-soon-games/:id
 * Full detail for one in-development title, including the demo build URL when
 * a demo is published, plus this user's own feedback for the current demo
 * version (so the UI can show "give feedback" vs "you already told us").
 */
exports.getComingSoonGameDetail = async (req, res) => {
  const gameId = parseInt(req.params.id, 10);
  if (!gameId) return res.status(400).json({ error: 'Invalid game id' });

  try {
    const [rows] = await db.query(
      `SELECT ${COMING_SOON_COLUMNS}
       FROM games g
       WHERE g.id = ? AND g.release_stage = 'in_development'`,
      [gameId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Game not found' });

    const g = rows[0];
    const [screenshotsRows] = await db.query(
      'SELECT game_id, image_url FROM game_screenshots WHERE game_id = ?', [gameId]
    );
    const screenshotsMap = { [gameId]: screenshotsRows.map(r => r.image_url) };

    const game = mapComingSoonRow(g, screenshotsMap);

    // The build URL is attached here and nowhere else — and only if the demo
    // is actually switched on.
    if (game.hasDemo) {
      game.demoZipUrl = g.demo_zip_url;
    }

    // Has this player already given feedback on the CURRENT demo version?
    let myFeedback = null;
    if (game.hasDemo && req.user?.id) {
      const [fb] = await db.query(
        `SELECT overall, fun, difficulty, performance, liked, frustration, would_play
         FROM demo_feedback
         WHERE game_id = ? AND user_id = ? AND demo_version = ?`,
        [gameId, req.user.id, game.demoVersion]
      );
      if (fb.length) myFeedback = fb[0];
    }

    res.json({ game, myFeedback });
  } catch (err) {
    console.error('GET /api/v1/coming-soon-games/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/v1/games/:id/rate   (JWT-protected)
 * Body: { rating: 1..5 }
 * Upserts the calling user's rating for the game (one rating per user per
 * game — re-rating overwrites). Returns the new live average.
 */
exports.rateGame = async (req, res) => {
  const gameId = parseInt(req.params.id, 10);
  const userId = req.user?.id;
  const rating = parseInt(req.body?.rating, 10);

  if (!gameId)  return res.status(400).json({ success: false, error: 'Invalid game id' });
  if (!userId)  return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'rating must be an integer 1–5' });
  }

  try {
    const [gameRows] = await db.query('SELECT id FROM games WHERE id = ? AND is_active = 1', [gameId]);
    if (!gameRows.length) return res.status(404).json({ success: false, error: 'Game not found' });

    await db.query(
      `INSERT INTO game_ratings (game_id, user_id, rating)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating)`,
      [gameId, userId, rating]
    );

    const [[stats]] = await db.query(
      'SELECT AVG(rating) AS avg_rating, COUNT(*) AS rating_count FROM game_ratings WHERE game_id = ?',
      [gameId]
    );

    res.json({
      success:     true,
      rating:      formatRating(stats.avg_rating),
      ratingCount: Number(stats.rating_count) || 0,
      userRating:  rating,
    });
  } catch (err) {
    console.error('POST /api/v1/games/:id/rate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/v1/genres
 * Returns a JSON array of genre objects: [{ name, gameCount }]
 * Only genres that have at least one active game are included.
 */
exports.getGenres = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT g.name,
              COUNT(gm.id) AS gameCount
       FROM genres g
       LEFT JOIN games gm ON g.name = gm.genre AND gm.is_active = 1
       GROUP BY g.name
       HAVING gameCount > 0
       ORDER BY g.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/v1/genres error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/v1/image-proxy
 * Proxies static image requests to bypass Nginx regex caching blocks.
 */
exports.imageProxy = (req, res) => {
  const { file } = req.query;
  if (!file) {
    return res.status(400).send('File parameter is required');
  }

  // Prevent directory traversal (e.g. file=../../etc/passwd)
  const cleanPath = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  
  // Restrict access to /images/ and /games/ premium/webgl directories
  const isAllowed = cleanPath.startsWith('/images/') || 
                    cleanPath.startsWith('images/') ||
                    cleanPath.startsWith('/games/') ||
                    cleanPath.startsWith('games/');

  if (!isAllowed) {
    return res.status(403).send('Forbidden');
  }

  let fullPath;
  if (cleanPath.startsWith('/games/premium/') || cleanPath.startsWith('games/premium/')) {
    const relativePart = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    const diskPath = relativePart.replace('games/premium', 'uploads/games/premium');
    fullPath = path.join(__dirname, '../..', diskPath);
  } else {
    fullPath = path.join(__dirname, '../..', 'public', cleanPath);
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return res.status(404).send('File not found');
  }

  // Determine content type based on extension
  const ext = path.extname(fullPath).toLowerCase();
  const contentTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };

  const contentType = contentTypes[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.sendFile(fullPath);
};
