const db   = require('../../config/database');
const fs   = require('fs');
const path = require('path');
const PATHS = require('../../config/paths');

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
 * Recursively collect all file paths under `dir` and convert them to
 * public URLs by stripping the PREMIUM_DIR prefix and prepending /games/premium.
 * Returns [] if the directory doesn't exist or the walk fails.
 */
function collectAdFiles(dir, type) {
  const results = [];
  if (!dir || !fs.existsSync(dir)) return results;
  const baseDir = type === 'premium' && dir.includes('premium') ? PATHS.PREMIUM_DIR : PATHS.WEBGL_DIR;
  const urlPrefix = type === 'premium' && dir.includes('premium') ? '/games/premium' : '/games/webgl';
  
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
  })(dir);
  return results;
}

exports.getAllGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, short_description, long_description,
              play_url, thumbnail_url, secondary_thumbnail, promotional_thumbnail, trailer_url,
              orientation, version, type, is_active, is_featured, created_at,
              file_path, zip_url,
              genre, studio, size, plays, rating, credits_cost, flag
       FROM games
       WHERE is_active = 1
       ORDER BY is_featured DESC, created_at DESC`
    );

    // Fetch all active game tags
    const [tagsRows] = await db.query(
      `SELECT gt.game_id, t.name
       FROM game_tags gt
       JOIN tags t ON gt.tag_id = t.id`
    );

    // Fetch all game screenshots
    const [screenshotsRows] = await db.query(
      `SELECT game_id, image_url FROM game_screenshots`
    );

    // Map tags and screenshots in memory
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

    const games = rows.map(g => ({
      id:                   String(g.id),
      gamename:             g.title,
      gameurl:              g.play_url  || '',
      description:          g.long_description || g.short_description || '',
      imageurl:             g.thumbnail_url    || '',
      secondaryThumbnail:   g.secondary_thumbnail || '',
      promotionalThumbnail: g.promotional_thumbnail || '',
      trailerurl:           g.trailer_url      || '',
      uploadedat:           g.created_at ? g.created_at.toISOString() : '',
      gameorientation:      g.orientation || 'landscape',
      gameversion:          g.version    || '1.0.0',
      gametype:             g.type,
      gamestatus:           g.is_active ? 'active' : 'inactive',
      isFeatured:           g.is_featured === 1,
      zipurl:               g.zip_url    || '',
      adFiles:              g.type === 'premium' ? collectAdFiles(g.file_path, g.type) : [],
      genre:                g.genre || '',
      studio:               g.studio || '',
      size:                 g.size || '',
      plays:                g.plays || '',
      rating:               g.rating || '',
      creditsCost:          g.credits_cost || 0,
      flag:                 g.flag || null,
      tags:                 tagsMap[g.id] || [],
      screenshots:          screenshotsMap[g.id] || [],
    }));

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
      `SELECT id, title, short_description, long_description,
              play_url, thumbnail_url, secondary_thumbnail, promotional_thumbnail, trailer_url,
              orientation, version, type, is_active, is_featured, created_at,
              file_path, zip_url,
              genre, studio, size, plays, rating, credits_cost, flag
       FROM games
       WHERE is_active = 1
       ORDER BY created_at DESC, id DESC
       LIMIT 8`
    );

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

    const games = rows.map(g => ({
      id:                   String(g.id),
      gamename:             g.title,
      gameurl:              g.play_url  || '',
      description:          g.long_description || g.short_description || '',
      imageurl:             g.thumbnail_url    || '',
      secondaryThumbnail:   g.secondary_thumbnail || '',
      promotionalThumbnail: g.promotional_thumbnail || '',
      trailerurl:           g.trailer_url      || '',
      uploadedat:           g.created_at ? g.created_at.toISOString() : '',
      gameorientation:      g.orientation || 'landscape',
      gameversion:          g.version    || '1.0.0',
      gametype:             g.type,
      gamestatus:           g.is_active ? 'active' : 'inactive',
      isFeatured:           g.is_featured === 1,
      zipurl:               g.zip_url    || '',
      adFiles:              g.type === 'premium' ? collectAdFiles(g.file_path, g.type) : [],
      genre:                g.genre || '',
      studio:               g.studio || '',
      size:                 g.size || '',
      plays:                g.plays || '',
      rating:               g.rating || '',
      creditsCost:          g.credits_cost || 0,
      flag:                 g.flag || null,
      tags:                 tagsMap[g.id] || [],
      screenshots:          screenshotsMap[g.id] || [],
    }));

    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/latest-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getPopularGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT g.id, g.title, g.short_description, g.long_description,
              g.play_url, g.thumbnail_url, g.secondary_thumbnail, g.promotional_thumbnail, g.trailer_url,
              g.orientation, g.version, g.type, g.is_active, g.is_featured, g.created_at,
              g.file_path, g.zip_url,
              g.genre, g.studio, g.size, g.plays, g.rating, g.credits_cost, g.flag,
              COUNT(CASE WHEN a.event_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN a.id END) as play_count
       FROM games g
       LEFT JOIN analytics_games a ON g.id = a.game_id
       WHERE g.is_active = 1
       GROUP BY g.id
       ORDER BY play_count DESC, g.id DESC
       LIMIT 5`
    );

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

    const games = rows.map(g => ({
      id:                   String(g.id),
      gamename:             g.title,
      gameurl:              g.play_url  || '',
      description:          g.long_description || g.short_description || '',
      imageurl:             g.thumbnail_url    || '',
      secondaryThumbnail:   g.secondary_thumbnail || '',
      promotionalThumbnail: g.promotional_thumbnail || '',
      trailerurl:           g.trailer_url      || '',
      uploadedat:           g.created_at ? g.created_at.toISOString() : '',
      gameorientation:      g.orientation || 'landscape',
      gameversion:          g.version    || '1.0.0',
      gametype:             g.type,
      gamestatus:           g.is_active ? 'active' : 'inactive',
      isFeatured:           g.is_featured === 1,
      zipurl:               g.zip_url    || '',
      adFiles:              g.type === 'premium' ? collectAdFiles(g.file_path, g.type) : [],
      genre:                g.genre || '',
      studio:               g.studio || '',
      size:                 g.size || '',
      plays:                g.plays || '',
      rating:               g.rating || '',
      creditsCost:          g.credits_cost || 0,
      flag:                 g.flag || null,
      tags:                 tagsMap[g.id] || [],
      screenshots:          screenshotsMap[g.id] || [],
    }));

    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/popular-games error:', err.message);
    res.status(500).json({ error: err.message });
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
