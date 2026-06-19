const db = require('../../config/database');

// ── GET /sitehandler/developers ──────────────────────────────────────────────
exports.getIndex = async (req, res) => {
  let developers = [];
  try {
    const [rows] = await db.query(`
      SELECT d.*,
             COUNT(s.id)                                           AS total_submissions,
             SUM(s.status = 'approved')                           AS approved_count,
             SUM(s.status = 'pending' OR s.status = 'under_review') AS pending_count
      FROM developers d
      LEFT JOIN developer_submissions s ON s.developer_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC`);
    developers = rows;
  } catch (_) {}

  res.render('sitehandler/developers/index', {
    title: 'Developers',
    activePage: 'developers',
    developers,
  });
};

// ── GET /sitehandler/developers/:id ─────────────────────────────────────────
exports.getDetail = async (req, res) => {
  try {
    const [devRows] = await db.query('SELECT * FROM developers WHERE id = ?', [req.params.id]);
    if (!devRows.length) {
      req.flash('error_msg', 'Developer not found.');
      return res.redirect('/sitehandler/developers');
    }

    const [submissions] = await db.query(
      `SELECT s.*, g.slug AS game_slug
       FROM developer_submissions s
       LEFT JOIN games g ON s.game_id = g.id
       WHERE s.developer_id = ?
       ORDER BY s.created_at DESC`,
      [req.params.id]
    );

    res.render('sitehandler/developers/detail', {
      title: devRows[0].name,
      activePage: 'developers',
      developer: devRows[0],
      submissions,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/developers');
  }
};

// ── POST /sitehandler/developers/:id/ban ────────────────────────────────────
exports.postBan = async (req, res) => {
  const { ban_reason } = req.body;
  if (!ban_reason?.trim()) {
    req.flash('error_msg', 'A ban reason is required.');
    return res.redirect(`/sitehandler/developers/${req.params.id}`);
  }
  try {
    await db.query(
      `UPDATE developers
       SET is_active = 0, ban_reason = ?, banned_at = NOW(), banned_by = ?
       WHERE id = ?`,
      [ban_reason.trim(), req.session.admin.id, req.params.id]
    );
    req.flash('success_msg', 'Developer banned.');
  } catch (err) {
    req.flash('error_msg', err.message);
  }
  res.redirect(`/sitehandler/developers/${req.params.id}`);
};

// ── POST /sitehandler/developers/:id/unban ───────────────────────────────────
exports.postUnban = async (req, res) => {
  try {
    await db.query(
      `UPDATE developers
       SET is_active = 1, ban_reason = NULL, banned_at = NULL, banned_by = NULL
       WHERE id = ?`,
      [req.params.id]
    );
    req.flash('success_msg', 'Developer account reinstated.');
  } catch (err) {
    req.flash('error_msg', err.message);
  }
  res.redirect(`/sitehandler/developers/${req.params.id}`);
};
