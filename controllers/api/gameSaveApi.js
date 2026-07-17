/**
 * controllers/api/gameSaveApi.js
 * Cloud save for hosted games: one opaque JSON blob per user per game.
 * The payload is never parsed/validated server-side — games define their own
 * save shape, the backend just stores and returns it verbatim.
 */
const db = require('../../config/database');

/**
 * POST /api/v1/games/:gameId/save  { data: "<json string>" }
 */
exports.saveGameData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;
    const { data } = req.body;

    if (typeof data !== 'string') {
      return res.status(400).json({ error: 'data (string) is required' });
    }

    await db.query(
      `INSERT INTO game_saves (user_id, game_id, save_data)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE save_data = VALUES(save_data)`,
      [userId, gameId, data]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('saveGameData error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/v1/games/:gameId/save
 */
exports.loadGameData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;

    const [rows] = await db.query(
      'SELECT save_data FROM game_saves WHERE user_id = ? AND game_id = ?',
      [userId, gameId]
    );

    return res.json({ data: rows.length ? rows[0].save_data : '' });
  } catch (err) {
    console.error('loadGameData error:', err);
    return res.status(500).json({ error: err.message });
  }
};
