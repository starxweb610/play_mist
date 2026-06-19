const db = require('../../config/database');
const r2 = require('../../config/r2');
const crypto = require('crypto');

exports.getEdit = async (req, res) => {
  let content = '';
  try {
    const [rows] = await db.query('SELECT content FROM site_content WHERE key_name = ?', ['submission_guidelines']);
    if (rows.length) content = rows[0].content || '';
  } catch (_) {}

  res.render('sitehandler/guidelines/edit', {
    title: 'Submission Guidelines',
    activePage: 'guidelines',
    content,
  });
};

exports.postSave = async (req, res) => {
  const { content } = req.body;
  try {
    await db.query(
      `INSERT INTO site_content (key_name, content) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content)`,
      ['submission_guidelines', content || '']
    );
    req.flash('success_msg', 'Submission guidelines saved successfully.');
  } catch (err) {
    req.flash('error_msg', 'Failed to save: ' + err.message);
  }
  res.redirect('/sitehandler/guidelines');
};

// Image upload endpoint for the Quill editor (uses memory storage)
exports.postImageUpload = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const key = `site-content/guidelines/${crypto.randomBytes(12).toString('hex')}.${ext}`;
  try {
    const url = await r2.uploadBuffer(key, req.file.buffer, req.file.mimetype);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
