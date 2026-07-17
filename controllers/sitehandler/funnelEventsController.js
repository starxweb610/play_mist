const db = require('../../config/database');

// ── GET /sitehandler/games/:id/funnel-events ─────────────────────────────────
exports.getIndex = async (req, res) => {
  const { id } = req.params;
  try {
    const [gameRows] = await db.query('SELECT id, title FROM games WHERE id = ?', [id]);
    if (!gameRows.length) {
      req.flash('error_msg', 'Game not found.');
      return res.redirect('/sitehandler/games');
    }

    const [events] = await db.query(
      'SELECT * FROM game_funnel_events WHERE game_id = ? ORDER BY step_order ASC, created_at ASC',
      [id]
    );

    // Distinct-user reach count per active step, in funnel order — the
    // chart data. Inactive steps are excluded from the chart but still
    // manageable below (same convention as XP events).
    const [funnel] = await db.query(
      `SELECT e.event_key, e.name, e.step_order,
              COUNT(DISTINCT p.user_id) AS reached
       FROM game_funnel_events e
       LEFT JOIN game_funnel_progress p ON p.event_id = e.id
       WHERE e.game_id = ? AND e.is_active = 1
       GROUP BY e.id
       ORDER BY e.step_order ASC, e.created_at ASC`,
      [id]
    );

    res.render('sitehandler/games/funnel-events', {
      title: `Funnel Analytics – ${gameRows[0].title}`,
      activePage: 'games',
      game: gameRows[0],
      events,
      funnel,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/funnel-events/create ─────────────────────────
exports.postCreate = async (req, res) => {
  const { id } = req.params;
  const { event_key, name, step_order } = req.body;

  if (!event_key?.trim() || !name?.trim()) {
    req.flash('error_msg', 'Event key and name are required.');
    return res.redirect(`/sitehandler/games/${id}/funnel-events`);
  }

  try {
    await db.query(
      `INSERT INTO game_funnel_events (game_id, event_key, name, step_order)
       VALUES (?, ?, ?, ?)`,
      [id, event_key.trim(), name.trim(), parseInt(step_order, 10) || 0]
    );
    req.flash('success_msg', `Milestone "${event_key.trim()}" added.`);
  } catch (err) {
    req.flash('error_msg', err.code === 'ER_DUP_ENTRY'
      ? `Event key "${event_key.trim()}" already exists for this game.`
      : 'Failed to add milestone: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/funnel-events`);
};

// ── POST /sitehandler/games/:id/funnel-events/:eventId/update ────────────────
exports.postUpdate = async (req, res) => {
  const { id, eventId } = req.params;
  const { name, step_order } = req.body;

  try {
    await db.query(
      `UPDATE game_funnel_events SET name = ?, step_order = ? WHERE id = ? AND game_id = ?`,
      [name?.trim(), parseInt(step_order, 10) || 0, eventId, id]
    );
    req.flash('success_msg', 'Milestone updated.');
  } catch (err) {
    req.flash('error_msg', 'Failed to update: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/funnel-events`);
};

// ── POST /sitehandler/games/:id/funnel-events/:eventId/toggle ────────────────
exports.postToggle = async (req, res) => {
  const { id, eventId } = req.params;
  try {
    await db.query(
      'UPDATE game_funnel_events SET is_active = NOT is_active WHERE id = ? AND game_id = ?',
      [eventId, id]
    );
  } catch (err) {
    req.flash('error_msg', 'Failed to toggle: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/funnel-events`);
};

// ── POST /sitehandler/games/:id/funnel-events/:eventId/delete ────────────────
exports.postDelete = async (req, res) => {
  const { id, eventId } = req.params;
  try {
    await db.query('DELETE FROM game_funnel_events WHERE id = ? AND game_id = ?', [eventId, id]);
    req.flash('success_msg', 'Milestone deleted.');
  } catch (err) {
    req.flash('error_msg', 'Failed to delete: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/funnel-events`);
};
