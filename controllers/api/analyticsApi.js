const db = require('../../config/database');

/**
 * POST /api/analytics/app-open
 * Called by the mobile app on each session start.
 * Body: { device: 'android'|'ios'|'other', session_id: string }
 */
exports.logAppOpen = async (req, res) => {
  const { device = 'other', session_id = null, user_id = null } = req.body;
  const now  = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  try {
    // Check if app open already recorded today for this user (or session if guest)
    let existing = [];
    if (user_id) {
      [existing] = await db.query(
        'SELECT id FROM analytics_app WHERE user_id = ? AND event_date = ?',
        [user_id, date]
      );
    } else if (session_id) {
      [existing] = await db.query(
        'SELECT id FROM analytics_app WHERE user_id IS NULL AND session_id = ? AND event_date = ?',
        [session_id, date]
      );
    }

    if (existing.length > 0) {
      return res.json({ success: true, duplicate: true });
    }

    await db.query(
      'INSERT INTO analytics_app (device, user_id, session_id, event_date, event_time) VALUES (?, ?, ?, ?, ?)',
      [device, user_id, session_id, date, time]
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
  const fs = require('fs');
  const path = require('path');
  const logFile = path.join(__dirname, '../../play_log.txt');

  const { device = 'other', session_id = null, game_id, user_id, player_id } = req.body;
  const finalUserId = user_id || player_id || null;

  // Append incoming request info to log file
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] Incoming Request: ${JSON.stringify(req.body)}\n`);

  if (!game_id) {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Validation Failed: game_id required\n`);
    return res.status(400).json({ success: false, error: 'game_id required' });
  }

  const now  = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  try {
    // Check if play already recorded today for this user (or session if guest)
    let existing = [];
    if (finalUserId) {
      [existing] = await db.query(
        'SELECT id FROM analytics_games WHERE game_id = ? AND user_id = ? AND event_date = ?',
        [game_id, finalUserId, date]
      );
    } else if (session_id) {
      [existing] = await db.query(
        'SELECT id FROM analytics_games WHERE game_id = ? AND user_id IS NULL AND session_id = ? AND event_date = ?',
        [game_id, session_id, date]
      );
    }

    if (existing.length > 0) {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] Duplicate play skipped today\n`);
      return res.json({ success: true, duplicate: true });
    }

    await db.query(
      'INSERT INTO analytics_games (game_id, user_id, device, session_id, event_date, event_time) VALUES (?, ?, ?, ?, ?, ?)',
      [game_id, finalUserId, device, session_id, date, time]
    );
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] DB Insertion SUCCESS\n`);
    res.json({ success: true });
  } catch (err) {
    console.error('analytics/game-play error:', err.message);
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] DB Insertion FAILED: ${err.message}\n`);
    res.status(500).json({ success: false, error: err.message });
  }
};
