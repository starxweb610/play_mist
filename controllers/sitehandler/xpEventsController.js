const db = require('../../config/database');

// ── GET /sitehandler/games/:id/xp-events ─────────────────────────────────────
exports.getIndex = async (req, res) => {
  const { id } = req.params;
  try {
    const [gameRows] = await db.query('SELECT id, title FROM games WHERE id = ?', [id]);
    if (!gameRows.length) {
      req.flash('error_msg', 'Game not found.');
      return res.redirect('/sitehandler/games');
    }

    const [events] = await db.query(
      'SELECT * FROM game_xp_events WHERE game_id = ? ORDER BY created_at DESC',
      [id]
    );

    res.render('sitehandler/games/xp-events', {
      title: `XP Events – ${gameRows[0].title}`,
      activePage: 'games',
      game: gameRows[0],
      events,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/xp-events/create ─────────────────────────────
exports.postCreate = async (req, res) => {
  const { id } = req.params;
  const { event_key, name, xp_reward } = req.body;

  if (!event_key?.trim() || !name?.trim()) {
    req.flash('error_msg', 'Event key and name are required.');
    return res.redirect(`/sitehandler/games/${id}/xp-events`);
  }

  try {
    await db.query(
      `INSERT INTO game_xp_events (game_id, event_key, name, xp_reward)
       VALUES (?, ?, ?, ?)`,
      [id, event_key.trim(), name.trim(), parseInt(xp_reward, 10) || 0]
    );
    req.flash('success_msg', `Event "${event_key.trim()}" added.`);
  } catch (err) {
    req.flash('error_msg', err.code === 'ER_DUP_ENTRY'
      ? `Event key "${event_key.trim()}" already exists for this game.`
      : 'Failed to add event: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/xp-events`);
};

// ── POST /sitehandler/games/:id/xp-events/:eventId/update ────────────────────
exports.postUpdate = async (req, res) => {
  const { id, eventId } = req.params;
  const { name, xp_reward } = req.body;

  try {
    await db.query(
      `UPDATE game_xp_events SET name = ?, xp_reward = ? WHERE id = ? AND game_id = ?`,
      [name?.trim(), parseInt(xp_reward, 10) || 0, eventId, id]
    );
    req.flash('success_msg', 'Event updated.');
  } catch (err) {
    req.flash('error_msg', 'Failed to update: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/xp-events`);
};

// ── POST /sitehandler/games/:id/xp-events/:eventId/toggle ────────────────────
exports.postToggle = async (req, res) => {
  const { id, eventId } = req.params;
  try {
    await db.query(
      'UPDATE game_xp_events SET is_active = NOT is_active WHERE id = ? AND game_id = ?',
      [eventId, id]
    );
  } catch (err) {
    req.flash('error_msg', 'Failed to toggle: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/xp-events`);
};

// ── POST /sitehandler/games/:id/xp-events/:eventId/delete ────────────────────
exports.postDelete = async (req, res) => {
  const { id, eventId } = req.params;
  try {
    await db.query('DELETE FROM game_xp_events WHERE id = ? AND game_id = ?', [eventId, id]);
    req.flash('success_msg', 'Event deleted.');
  } catch (err) {
    req.flash('error_msg', 'Failed to delete: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/xp-events`);
};
