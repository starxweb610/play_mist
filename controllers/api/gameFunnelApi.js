const db = require('../../config/database');

/**
 * POST /api/v1/games/:gameId/track-event   { eventKey }
 *
 * Marks a funnel milestone as reached for this player, for drop-off
 * analytics (not XP — see gameXpApi.js for that). A milestone is a
 * reached/not-reached flag per player, not a repeatable/accumulating value:
 * calling this again for the same milestone is a harmless no-op.
 */
exports.trackEvent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;
    const { eventKey } = req.body;

    if (!eventKey) return res.status(400).json({ error: 'eventKey is required' });

    const [eventRows] = await db.query(
      'SELECT id FROM game_funnel_events WHERE game_id = ? AND event_key = ? AND is_active = 1',
      [gameId, eventKey]
    );
    if (!eventRows.length) return res.status(404).json({ error: 'Unknown or inactive event' });

    const [result] = await db.query(
      'INSERT IGNORE INTO game_funnel_progress (user_id, event_id) VALUES (?, ?)',
      [userId, eventRows[0].id]
    );

    return res.json({ tracked: true, firstTime: result.affectedRows > 0 });
  } catch (err) {
    console.error('trackEvent error:', err);
    return res.status(500).json({ error: err.message });
  }
};
