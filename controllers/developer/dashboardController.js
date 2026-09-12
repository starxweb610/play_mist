const db = require('../../config/database');
const { matchClause, shouldRedirectToSlug } = require('../../utils/slugs');

exports.getDashboard = async (req, res) => {
  try {
    const [submissions] = await db.query(
      `SELECT s.*, g.slug AS game_slug, g.is_active AS game_is_active
       FROM developer_submissions s
       LEFT JOIN games g ON s.game_id = g.id
       WHERE s.developer_id = ?
       ORDER BY s.created_at DESC`,
      [req.session.developer.id]
    );
    res.render('developer/dashboard', {
      title: 'My Submissions',
      developer: req.session.developer,
      submissions,
    });
  } catch (err) {
    res.render('developer/dashboard', {
      title: 'My Submissions',
      developer: req.session.developer,
      submissions: [],
    });
  }
};

exports.getSubmissionDetail = async (req, res) => {
  try {
    // Addressed by slug; a bare id still resolves for links made before slugs.
    const match = matchClause(req.params.slug, 's');
    if (!match) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/dashboard');
    }
    const [rows] = await db.query(
      `SELECT s.*, g.slug AS game_slug, g.is_active AS game_is_active
       FROM developer_submissions s
       LEFT JOIN games g ON s.game_id = g.id
       WHERE ${match.sql} AND s.developer_id = ?`,
      [...match.params, req.session.developer.id]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/dashboard');
    }
    if (shouldRedirectToSlug(req.params.slug, rows[0])) {
      return res.redirect(`/developer/submissions/${rows[0].slug}`);
    }
    res.render('developer/submission-detail', {
      title: rows[0].title,
      developer: req.session.developer,
      submission: rows[0],
    });
  } catch (err) {
    req.flash('error_msg', 'Failed to load submission.');
    res.redirect('/developer/dashboard');
  }
};
