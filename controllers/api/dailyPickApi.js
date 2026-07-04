const db = require('../../config/database');
const { formatImagePath } = require('../../utils/images');
const { formatBytes, formatCount, formatRating } = require('../../utils/format');
const { grantAchievement } = require('../../utils/achievements');
const { toLocalDateStr } = require('../../utils/dates');

/**
 * GET /api/v1/daily-pick
 * Returns today's free game (if one has been set by an admin).
 * Includes a `isFreeToday: true` flag so the client knows cost = 0.
 */
exports.getDailyPick = async (req, res) => {
  try {
    const today = toLocalDateStr();

    const [rows] = await db.query(
      `SELECT g.id, g.title, g.short_description, g.long_description,
              g.play_url, g.thumbnail_url, g.promotional_thumbnail,
              g.orientation, g.version, g.type, g.zip_url,
              g.genre, g.studio, g.size, g.size_bytes, g.credits_cost, g.flag,
              (SELECT COUNT(*)        FROM analytics_games ag WHERE ag.game_id = g.id) AS play_count,
              (SELECT AVG(gr.rating)  FROM game_ratings    gr WHERE gr.game_id = g.id) AS avg_rating
       FROM daily_picks dp
       JOIN games g ON dp.game_id = g.id
       WHERE dp.pick_date = ? AND g.is_active = 1`,
      [today]
    );

    if (!rows.length) {
      return res.json({ dailyPick: null });
    }

    const g = rows[0];
    return res.json({
      dailyPick: {
        id:                   String(g.id),
        gamename:             g.title,
        description:          g.long_description || g.short_description || '',
        imageurl:             formatImagePath(g.thumbnail_url),
        promotionalThumbnail: formatImagePath(g.promotional_thumbnail),
        gameurl:              g.play_url  || '',
        zipurl:               g.zip_url   || '',
        gameorientation:      g.orientation || 'landscape',
        gameversion:          g.version    || '1.0.0',
        gametype:             g.type,
        genre:                g.genre  || '',
        studio:               g.studio || '',
        size:                 g.size_bytes ? formatBytes(g.size_bytes) : (g.size || ''),
        plays:                formatCount(g.play_count),
        rating:               formatRating(g.avg_rating),
        creditsCost:          0,
        isFreeToday:          true,
        flag:                 g.flag   || null,
      },
    });
  } catch (err) {
    console.error('getDailyPick error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Called by deductCredits when the launched game is today's daily pick.
 * Grants the 'daily_pick' achievement if not yet earned.
 */
exports.handleDailyPickPlay = async (userId, gameId) => {
  return grantAchievement(userId, 'daily_pick');
};

/**
 * Checks whether `gameId` is today's daily pick.
 * Returns true/false — used by deductCredits to apply a 0-cost override.
 */
exports.isTodaysDailyPick = async (gameId) => {
  const today = toLocalDateStr();
  const [rows] = await db.query(
    'SELECT id FROM daily_picks WHERE game_id = ? AND pick_date = ?',
    [gameId, today]
  );
  return rows.length > 0;
};
