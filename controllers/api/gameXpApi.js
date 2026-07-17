const db = require('../../config/database');
const { grantXp } = require('../../utils/achievements');

/**
 * POST /api/v1/games/:gameId/xp-event   { eventKey }
 *
 * The game only ever sends the event key — never an amount. game_xp_events
 * (admin-configured per game) is the sole authority on what that's worth, so
 * a buggy or malicious game can't inflate its own players' XP.
 */
exports.reportEvent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;
    const { eventKey } = req.body;

    if (!eventKey) return res.status(400).json({ error: 'eventKey is required' });

    const [eventRows] = await db.query(
      'SELECT xp_reward FROM game_xp_events WHERE game_id = ? AND event_key = ? AND is_active = 1',
      [gameId, eventKey]
    );
    if (!eventRows.length) return res.status(404).json({ error: 'Unknown or inactive event' });

    const xpReward = eventRows[0].xp_reward;

    await db.query(
      `INSERT INTO game_xp (user_id, game_id, xp) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE xp = xp + ?`,
      [userId, gameId, xpReward, xpReward]
    );
    await grantXp(userId, xpReward);

    const [[gameXpRow]] = await db.query(
      'SELECT xp FROM game_xp WHERE user_id = ? AND game_id = ?',
      [userId, gameId]
    );
    const [[userRow]] = await db.query('SELECT xp FROM users WHERE id = ?', [userId]);

    return res.json({ xpAwarded: xpReward, gameXp: gameXpRow.xp, totalXp: userRow.xp });
  } catch (err) {
    console.error('reportEvent error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/v1/games/:gameId/leaderboard?limit=50
 *
 * Top players by XP for this game, plus the caller's own rank/xp even when
 * outside the top N — otherwise a player who isn't near the top never sees
 * where they stand.
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

    const [leaderboard] = await db.query(
      `SELECT gx.user_id, gx.xp, u.username, u.avatar,
              (SELECT COUNT(*) + 1 FROM game_xp gx2
               WHERE gx2.game_id = gx.game_id AND gx2.xp > gx.xp) AS rank
       FROM game_xp gx
       JOIN users u ON u.id = gx.user_id
       WHERE gx.game_id = ?
       ORDER BY gx.xp DESC
       LIMIT ?`,
      [gameId, limit]
    );

    let me = leaderboard.find(r => r.user_id === userId) || null;
    if (!me) {
      const [meRows] = await db.query(
        `SELECT gx.user_id, gx.xp, u.username, u.avatar,
                (SELECT COUNT(*) + 1 FROM game_xp gx2
                 WHERE gx2.game_id = gx.game_id AND gx2.xp > gx.xp) AS rank
         FROM game_xp gx
         JOIN users u ON u.id = gx.user_id
         WHERE gx.game_id = ? AND gx.user_id = ?`,
        [gameId, userId]
      );
      me = meRows[0] || null;
    }

    return res.json({ leaderboard, me });
  } catch (err) {
    console.error('getLeaderboard error:', err);
    return res.status(500).json({ error: err.message });
  }
};
