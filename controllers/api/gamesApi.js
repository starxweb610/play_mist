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
function collectAdFiles(dir) {
  const results = [];
  if (!dir || !fs.existsSync(dir)) return results;
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
        // Build a URL relative to PREMIUM_DIR → /games/premium/<slug>/...
        const rel = path.relative(PATHS.PREMIUM_DIR, full).replace(/\\/g, '/');
        results.push(`/games/premium/${rel}`);
      }
    }
  })(dir);
  return results;
}

exports.getAllGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, short_description, long_description,
              play_url, thumbnail_url, trailer_url,
              orientation, version, type, is_active, created_at,
              file_path
       FROM games
       WHERE is_active = 1
       ORDER BY is_featured DESC, created_at DESC`
    );

    const games = rows.map(g => ({
      id:              String(g.id),
      gamename:        g.title,
      gameurl:         g.play_url  || '',
      description:     g.long_description || g.short_description || '',
      imageurl:        g.thumbnail_url    || '',
      trailerurl:      g.trailer_url      || '',
      uploadedat:      g.created_at ? g.created_at.toISOString() : '',
      gameorientation: g.orientation || 'landscape',
      gameversion:     g.version    || '1.0.0',
      gametype:        g.type,
      gamestatus:      g.is_active ? 'active' : 'inactive',
      adFiles:         g.type === 'premium' ? collectAdFiles(g.file_path) : [],
    }));

    // Unity's JsonUtility expects a plain JSON array at the root
    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/all-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
