const db        = require('../../config/database');
const mailer    = require('../../utils/mailer');
const templates = require('../../utils/emailTemplates');

// ── GET /sitehandler/community-notes ─────────────────────────────────────────
exports.getIndex = async (req, res) => {
  const { filter = 'pending_review' } = req.query;
  const allowedFilters = ['pending_review', 'approved', 'rejected', 'all'];
  const activeFilter = allowedFilters.includes(filter) ? filter : 'pending_review';

  let sql = `
    SELECT n.id, n.title, n.description, n.content, n.is_shared,
           n.share_status, n.share_rejection_reason, n.created_at, n.updated_at,
           d.id AS developer_id, d.name AS developer_name, d.email AS developer_email,
           d.studio_name
    FROM developer_notes n
    JOIN developers d ON n.developer_id = d.id
    WHERE n.share_status != 'private'`;

  const params = [];
  if (activeFilter !== 'all') {
    sql += ' AND n.share_status = ?';
    params.push(activeFilter);
  }
  sql += ' ORDER BY n.updated_at DESC';

  let notes = [];
  let counts = {};
  try {
    const [rows]      = await db.query(sql, params);
    notes             = rows;
    const [countRows] = await db.query(
      `SELECT share_status, COUNT(*) AS n FROM developer_notes
       WHERE share_status != 'private' GROUP BY share_status`
    );
    countRows.forEach(r => { counts[r.share_status] = r.n; });
  } catch (err) {
    console.error('communityNotes.getIndex:', err);
  }

  res.render('sitehandler/community-notes/index', {
    title: 'Community Notes',
    activePage: 'community-notes',
    notes,
    counts,
    activeFilter,
  });
};

// ── POST /sitehandler/community-notes/:id/approve ────────────────────────────
exports.postApprove = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT n.*, d.name AS developer_name, d.email AS developer_email
       FROM developer_notes n JOIN developers d ON n.developer_id = d.id
       WHERE n.id = ?`,
      [id]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Note not found.');
      return res.redirect('/sitehandler/community-notes');
    }

    const note = rows[0];
    await db.query(
      `UPDATE developer_notes
       SET share_status = 'approved', is_shared = 1,
           share_reviewed_by = ?, share_reviewed_at = NOW(), share_rejection_reason = NULL
       WHERE id = ?`,
      [req.session.admin.id, id]
    );

    mailer.sendMail({
      to:      note.developer_email,
      subject: `Your note is now live on ${process.env.APP_NAME || 'PlayMist'} Developer Community`,
      html:    templates.noteApproved({ name: note.developer_name, noteTitle: note.title }),
    }).catch(err => console.error('noteApproved email failed:', err.message));

    req.flash('success_msg', `"${note.title}" approved and is now visible in the community.`);
  } catch (err) {
    req.flash('error_msg', 'Failed to approve note: ' + err.message);
  }
  res.redirect('/sitehandler/community-notes');
};

// ── POST /sitehandler/community-notes/:id/reject ─────────────────────────────
exports.postReject = async (req, res) => {
  const { id } = req.params;
  const reason = req.body.reason?.trim() || '';

  if (!reason) {
    req.flash('error_msg', 'A rejection reason is required.');
    return res.redirect('/sitehandler/community-notes');
  }

  try {
    const [rows] = await db.query(
      `SELECT n.*, d.name AS developer_name, d.email AS developer_email
       FROM developer_notes n JOIN developers d ON n.developer_id = d.id
       WHERE n.id = ?`,
      [id]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Note not found.');
      return res.redirect('/sitehandler/community-notes');
    }

    const note = rows[0];
    await db.query(
      `UPDATE developer_notes
       SET share_status = 'rejected', is_shared = 0,
           share_reviewed_by = ?, share_reviewed_at = NOW(), share_rejection_reason = ?
       WHERE id = ?`,
      [req.session.admin.id, reason, id]
    );

    mailer.sendMail({
      to:      note.developer_email,
      subject: `Update on your note — ${process.env.APP_NAME || 'PlayMist'} Developer Community`,
      html:    templates.noteRejected({ name: note.developer_name, noteTitle: note.title, reason }),
    }).catch(err => console.error('noteRejected email failed:', err.message));

    req.flash('success_msg', `"${note.title}" rejected and developer notified.`);
  } catch (err) {
    req.flash('error_msg', 'Failed to reject note: ' + err.message);
  }
  res.redirect('/sitehandler/community-notes');
};
