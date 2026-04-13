const db = require('../../config/database');

/**
 * POST /api/analytics/app-open
 * Called by the mobile app on each session start.
 * Body: { device: 'android'|'ios'|'other', session_id: string }
 */
exports.logAppOpen = async (req, res) => {
  const { device = 'other', session_id = null } = req.body;
  const now  = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  try {
    await db.query(
      'INSERT INTO analytics_app (device, session_id, event_date, event_time) VALUES (?, ?, ?, ?)',
      [device, session_id, date, time]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('analytics/app-open error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/analytics/game-play
 * Called by the mobile app when a user opens a game.
 * Body: { device: 'android'|'ios'|'other', session_id: string, game_id: number }
 */
exports.logGamePlay = async (req, res) => {
  const { device = 'other', session_id = null, game_id } = req.body;
  if (!game_id) return res.status(400).json({ success: false, error: 'game_id required' });

  const now  = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  try {
    await db.query(
      'INSERT INTO analytics_games (game_id, device, session_id, event_date, event_time) VALUES (?, ?, ?, ?, ?)',
      [game_id, device, session_id, date, time]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('analytics/game-play error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
