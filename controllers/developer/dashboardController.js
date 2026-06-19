const db = require('../../config/database');

exports.getDashboard = async (req, res) => {
  try {
    const [submissions] = await db.query(
      `SELECT s.*, g.slug AS game_slug
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
    const [rows] = await db.query(
      `SELECT s.*, g.slug AS game_slug
       FROM developer_submissions s
       LEFT JOIN games g ON s.game_id = g.id
       WHERE s.id = ? AND s.developer_id = ?`,
      [req.params.id, req.session.developer.id]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/dashboard');
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
