const db = require('../../config/database');

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
 * adFiles                →  [] (reserved for future ad asset list)
 */
exports.getAllGames = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, short_description, long_description,
              play_url, thumbnail_url, trailer_url,
              orientation, version, type, is_active, created_at
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
      adFiles:         [],
    }));

    // Unity's JsonUtility expects a plain JSON array at the root
    res.json(games);
  } catch (err) {
    console.error('GET /api/v1/all-games error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
