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

    // First-time-only completion flag for the task list — reportEvent stays
    // repeatable above, but INSERT IGNORE means a second (or hundredth) fire
    // of the same event is a harmless no-op against the unique key.
    await db.query(
      'INSERT IGNORE INTO game_xp_event_completions (user_id, game_id, event_key) VALUES (?, ?, ?)',
      [userId, gameId, eventKey]
    );

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

    // Ties (equal xp) are broken by who reached that total first — updated_at
    // bumps on every xp gain (see reportEvent's upsert), so an earlier
    // updated_at means they got there first and ranks above a later tie.
    // `gx.id` is a last-resort tiebreak for same-second updates.
    // A player's chosen display_name (once set) is the sole public-facing
    // identity — the immutable handle in `username` is never shown to other
    // players, only ever resolved into this same-named field so existing
    // consumers of `username` need no changes.
    const [leaderboard] = await db.query(
      `SELECT gx.user_id, gx.xp,
              COALESCE(NULLIF(TRIM(u.display_name), ''), u.username) AS username,
              u.avatar,
              (SELECT COUNT(*) + 1 FROM game_xp gx2
               WHERE gx2.game_id = gx.game_id
                 AND (gx2.xp > gx.xp
                      OR (gx2.xp = gx.xp AND gx2.updated_at < gx.updated_at)
                      OR (gx2.xp = gx.xp AND gx2.updated_at = gx.updated_at AND gx2.id < gx.id))
              ) AS \`rank\`
       FROM game_xp gx
       JOIN users u ON u.id = gx.user_id
       WHERE gx.game_id = ?
       ORDER BY gx.xp DESC, gx.updated_at ASC, gx.id ASC
       LIMIT ?`,
      [gameId, limit]
    );

    let me = leaderboard.find(r => r.user_id === userId) || null;
    if (!me) {
      const [meRows] = await db.query(
        `SELECT gx.user_id, gx.xp,
                COALESCE(NULLIF(TRIM(u.display_name), ''), u.username) AS username,
                u.avatar,
                (SELECT COUNT(*) + 1 FROM game_xp gx2
                 WHERE gx2.game_id = gx.game_id
                   AND (gx2.xp > gx.xp
                        OR (gx2.xp = gx.xp AND gx2.updated_at < gx.updated_at)
                        OR (gx2.xp = gx.xp AND gx2.updated_at = gx.updated_at AND gx2.id < gx.id))
                ) AS \`rank\`
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

/**
 * GET /api/v1/games/:gameId/xp-tasks
 *
 * This game's admin-configured XP tasks (name + xp_reward), each flagged
 * with whether the calling player has completed it at least once — see
 * game_xp_event_completions, written by reportEvent above. Pairs with
 * getLeaderboard: the leaderboard shows who's winning, this shows what
 * actually earns the XP behind it.
 */
exports.getXpTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;

    const [tasks] = await db.query(
      `SELECT e.id, e.event_key, e.name, e.xp_reward,
              c.completed_at
       FROM game_xp_events e
       LEFT JOIN game_xp_event_completions c
         ON c.game_id = e.game_id AND c.event_key = e.event_key AND c.user_id = ?
       WHERE e.game_id = ? AND e.is_active = 1
       ORDER BY e.xp_reward ASC, e.id ASC`,
      [userId, gameId]
    );

    const normalized = tasks.map(({ completed_at, ...t }) => ({
      ...t,
      completed: !!completed_at,
    }));

    return res.json({ tasks: normalized });
  } catch (err) {
    console.error('getXpTasks error:', err);
    return res.status(500).json({ error: err.message });
  }
};
