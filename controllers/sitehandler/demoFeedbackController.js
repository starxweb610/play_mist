/**
 * controllers/sitehandler/demoFeedbackController.js
 * Playtest feedback inbox for one in-development game.
 *
 * Everything is grouped by demo_version, because the question that matters is
 * never "what do players think" but "did the change I shipped in v0.4 fix what
 * they complained about in v0.3".
 */
const db = require('../../config/database');

// ── GET /sitehandler/games/:id/demo-feedback ─────────────────────────────────
exports.getIndex = async (req, res) => {
  const { id } = req.params;
  try {
    const [gameRows] = await db.query(
      'SELECT id, title, slug, demo_version, demo_enabled FROM games WHERE id = ?', [id]
    );
    if (!gameRows.length) {
      req.flash('error_msg', 'Game not found.');
      return res.redirect('/sitehandler/games');
    }

    // Which version is being viewed — defaults to the current demo build
    const [versionRows] = await db.query(
      `SELECT demo_version, COUNT(*) AS responses
       FROM demo_feedback WHERE game_id = ?
       GROUP BY demo_version ORDER BY demo_version DESC`,
      [id]
    );
    const selectedVersion = req.query.version
      || versionRows[0]?.demo_version
      || gameRows[0].demo_version
      || '0.1.0';

    const [[stats]] = await db.query(
      `SELECT COUNT(*)          AS responses,
              AVG(overall)      AS avg_overall,
              AVG(fun)          AS avg_fun,
              AVG(difficulty)   AS avg_difficulty,
              AVG(performance)  AS avg_performance,
              SUM(would_play = 'yes')   AS would_yes,
              SUM(would_play = 'maybe') AS would_maybe,
              SUM(would_play = 'no')    AS would_no,
              AVG(session_seconds)      AS avg_session,
              COUNT(session_seconds)    AS with_session
       FROM demo_feedback WHERE game_id = ? AND demo_version = ?`,
      [id, selectedVersion]
    );

    const [rows] = await db.query(
      `SELECT f.*, u.username, u.display_name
       FROM demo_feedback f
       JOIN users u ON f.user_id = u.id
       WHERE f.game_id = ? AND f.demo_version = ?
       ORDER BY f.created_at DESC`,
      [id, selectedVersion]
    );

    const round1 = (v) => (v === null || v === undefined) ? null : Number(v).toFixed(1);

    // Short sessions are the most important signal a playtest produces — a
    // 40-second bounce must not render as "0m" and look like missing data.
    const formatDuration = (secs) => {
      if (secs === null || secs === undefined) return null;
      const s = Math.round(Number(secs));
      if (s < 60) return `${s}s`;
      const mins = Math.floor(s / 60);
      const rem = s % 60;
      return rem ? `${mins}m ${rem}s` : `${mins}m`;
    };

    res.render('sitehandler/games/demo-feedback', {
      title: `${gameRows[0].title} — Playtest Feedback`,
      activePage: 'games',
      game: gameRows[0],
      versions: versionRows,
      selectedVersion,
      // Pre-format per row: EJS has no access to the helper above
      feedback: rows.map(r => ({ ...r, session_label: formatDuration(r.session_seconds) })),
      stats: {
        responses:      Number(stats.responses) || 0,
        avgOverall:     round1(stats.avg_overall),
        avgFun:         round1(stats.avg_fun),
        avgDifficulty:  round1(stats.avg_difficulty),
        avgPerformance: round1(stats.avg_performance),
        wouldYes:       Number(stats.would_yes) || 0,
        wouldMaybe:     Number(stats.would_maybe) || 0,
        wouldNo:        Number(stats.would_no) || 0,
        avgSession: formatDuration(stats.avg_session),
        // How many responses actually carry a measured session, so a run of
        // NULLs is visible as such instead of hiding behind the average.
        withSession: Number(stats.with_session) || 0,
      },
    });
  } catch (err) {
    req.flash('error_msg', 'Could not load feedback: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── GET /sitehandler/games/:id/demo-feedback/export ──────────────────────────
exports.getExport = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT f.demo_version, u.username, f.overall, f.fun, f.difficulty, f.performance,
              f.would_play, f.session_seconds, f.device, f.liked, f.frustration, f.created_at
       FROM demo_feedback f
       JOIN users u ON f.user_id = u.id
       WHERE f.game_id = ?
       ORDER BY f.demo_version DESC, f.created_at DESC`,
      [id]
    );

    // Quote every field and double embedded quotes — free-text answers contain
    // commas and newlines routinely.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['version', 'player', 'overall', 'fun', 'difficulty', 'performance',
      'would_play', 'session_seconds', 'device', 'liked', 'frustration', 'submitted'];
    const csv = [
      header.join(','),
      ...rows.map(r => [
        r.demo_version, r.username, r.overall, r.fun, r.difficulty, r.performance,
        r.would_play, r.session_seconds, r.device, r.liked, r.frustration,
        r.created_at ? r.created_at.toISOString() : '',
      ].map(esc).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="demo-feedback-${id}.csv"`);
    res.send(csv);
  } catch (err) {
    req.flash('error_msg', 'Export failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}/demo-feedback`);
  }
};
