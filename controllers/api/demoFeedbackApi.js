/**
 * controllers/api/demoFeedbackApi.js
 * Structured playtest feedback on in-development ("Coming Soon") games.
 *
 * The reward is deliberately attached to *submitting feedback*, not to playing
 * the demo — paying for launches buys bounces, paying for feedback buys data.
 * It is granted at most once per (user, game, demo_version): re-submitting the
 * same version edits the existing answer, and a new demo build asks again.
 */
const db = require('../../config/database');

const FEEDBACK_CREDITS = 200;
const FEEDBACK_XP      = 100;

const clampScore = (v) => {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
};

const trimText = (v, max = 1000) =>
  (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;

/**
 * POST /api/v1/coming-soon-games/:id/feedback   (JWT-protected)
 * Body: { overall, fun, difficulty, performance, liked, frustration,
 *         wouldPlay, sessionSeconds, device }
 *
 * Response: { success, rewarded, creditsEarned, xpEarned, balance, xp, level }
 */
exports.submitFeedback = async (req, res) => {
  const gameId = parseInt(req.params.id, 10);
  const userId = req.user?.id;

  if (!gameId) return res.status(400).json({ error: 'Invalid game id' });
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const overall = clampScore(req.body?.overall);
  if (overall === null) {
    return res.status(400).json({ error: 'overall must be an integer 1–5' });
  }

  const fun         = clampScore(req.body?.fun);
  const difficulty  = clampScore(req.body?.difficulty);
  const performance = clampScore(req.body?.performance);
  const liked       = trimText(req.body?.liked);
  const frustration = trimText(req.body?.frustration);
  const wouldPlay   = ['yes', 'maybe', 'no'].includes(req.body?.wouldPlay)
    ? req.body.wouldPlay : null;
  const sessionSeconds = Number.isFinite(parseInt(req.body?.sessionSeconds, 10))
    ? Math.max(0, Math.min(86400, parseInt(req.body.sessionSeconds, 10)))
    : null;
  const device = trimText(req.body?.device, 40);

  const conn = await db.getConnection();
  try {
    // Only in-development games with a published demo accept feedback — this
    // is what stops the endpoint being used as a second rating system on live
    // titles (those go through /games/:id/rate).
    const [gameRows] = await conn.query(
      `SELECT demo_version, demo_enabled, demo_zip_url
       FROM games WHERE id = ? AND release_stage = 'in_development'`,
      [gameId]
    );
    // Both early returns fall through to the `finally` below, which is the one
    // and only place the pooled connection is released.
    if (!gameRows.length) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (!gameRows[0].demo_enabled || !gameRows[0].demo_zip_url) {
      return res.status(403).json({ error: 'This game has no demo to give feedback on' });
    }
    const demoVersion = gameRows[0].demo_version || '0.1.0';

    await conn.beginTransaction();

    // Existence decides reward eligibility. Checked inside the transaction with
    // FOR UPDATE rather than inferring from affectedRows, whose value for an
    // upsert (1 = insert, 2 = update, 0 = unchanged) can't distinguish a
    // re-submit that changed nothing from a fresh row.
    const [existing] = await conn.query(
      `SELECT id FROM demo_feedback
       WHERE game_id = ? AND user_id = ? AND demo_version = ? FOR UPDATE`,
      [gameId, userId, demoVersion]
    );
    const isFirstSubmission = existing.length === 0;

    await conn.query(
      `INSERT INTO demo_feedback
         (game_id, user_id, demo_version, overall, fun, difficulty, performance,
          liked, frustration, would_play, session_seconds, device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         overall = VALUES(overall), fun = VALUES(fun),
         difficulty = VALUES(difficulty), performance = VALUES(performance),
         liked = VALUES(liked), frustration = VALUES(frustration),
         would_play = VALUES(would_play),
         session_seconds = VALUES(session_seconds), device = VALUES(device)`,
      [gameId, userId, demoVersion, overall, fun, difficulty, performance,
       liked, frustration, wouldPlay, sessionSeconds, device]
    );

    if (isFirstSubmission) {
      await conn.query(
        `UPDATE users
         SET credits = COALESCE(credits, 1000) + ?,
             xp      = COALESCE(xp, 0) + ?,
             level   = FLOOR((COALESCE(xp, 0) + ?) / 500) + 1
         WHERE id = ?`,
        [FEEDBACK_CREDITS, FEEDBACK_XP, FEEDBACK_XP, userId]
      );
      // Negative credits_used = credits granted (see ARCHITECTURE.md §4.3).
      // source 'other': the enum predates playtests and adding a value would
      // need an ALTER on a large table for no analytical gain — game_id
      // already identifies these rows as demo feedback.
      await conn.query(
        `INSERT INTO credit_transactions (user_id, game_id, credits_used, source)
         VALUES (?, ?, ?, 'other')`,
        [userId, gameId, -FEEDBACK_CREDITS]
      );
    }

    await conn.commit();

    const [updated] = await db.query(
      'SELECT credits, xp, level FROM users WHERE id = ?', [userId]
    );

    return res.json({
      success:       true,
      rewarded:      isFirstSubmission,
      creditsEarned: isFirstSubmission ? FEEDBACK_CREDITS : 0,
      xpEarned:      isFirstSubmission ? FEEDBACK_XP : 0,
      balance:       updated[0]?.credits ?? null,
      xp:            updated[0]?.xp ?? null,
      level:         updated[0]?.level ?? null,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('submitFeedback error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};
