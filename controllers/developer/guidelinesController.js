const db = require('../../config/database');

exports.getGuidelines = async (req, res) => {
  let content = '<p>Submission guidelines are coming soon. Check back later.</p>';
  try {
    const [rows] = await db.query('SELECT content FROM site_content WHERE key_name = ?', ['submission_guidelines']);
    if (rows.length && rows[0].content) content = rows[0].content;
  } catch (_) {}

  res.render('developer/guidelines', {
    title: 'Submission Guidelines',
    activePage: 'guidelines',
    developer: req.session.developer,
    content,
  });
};
