const db = require('../../config/database');

// ── GET /sitehandler/tags ────────────────────────────────────────────────────
exports.getIndex = async (req, res) => {
  try {
    const [tags] = await db.query(
      `SELECT t.id, t.name, COUNT(gt.game_id) AS game_count
       FROM tags t
       LEFT JOIN game_tags gt ON t.id = gt.tag_id
       GROUP BY t.id, t.name
       ORDER BY t.name ASC`
    );
    res.render('sitehandler/tags/index', {
      title: 'Manage Tags',
      activePage: 'tags',
      tags,
    });
  } catch (err) {
    req.flash('error_msg', 'Failed to load tags: ' + err.message);
    res.redirect('/sitehandler/dashboard');
  }
};

// ── POST /sitehandler/tags/create ────────────────────────────────────────────
exports.postCreate = async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error_msg', 'Tag name is required.');
    return res.redirect('/sitehandler/tags');
  }
  const cleanName = name.trim();

  try {
    // Check duplicate case-insensitive
    const [existing] = await db.query(
      'SELECT id FROM tags WHERE LOWER(name) = LOWER(?)',
      [cleanName]
    );
    if (existing.length > 0) {
      req.flash('error_msg', `Tag "${cleanName}" already exists.`);
      return res.redirect('/sitehandler/tags');
    }

    await db.query('INSERT INTO tags (name) VALUES (?)', [cleanName]);
    req.flash('success_msg', `Tag "${cleanName}" created successfully.`);
    res.redirect('/sitehandler/tags');
  } catch (err) {
    req.flash('error_msg', 'Failed to create tag: ' + err.message);
    res.redirect('/sitehandler/tags');
  }
};

// ── GET /sitehandler/tags/:id/edit ───────────────────────────────────────────
exports.getEdit = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tags WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      req.flash('error_msg', 'Tag not found.');
      return res.redirect('/sitehandler/tags');
    }
    res.render('sitehandler/tags/edit', {
      title: 'Edit Tag',
      activePage: 'tags',
      tag: rows[0],
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/tags');
  }
};

// ── POST /sitehandler/tags/:id/update ────────────────────────────────────────
exports.postUpdate = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error_msg', 'Tag name is required.');
    return res.redirect(`/sitehandler/tags/${id}/edit`);
  }
  const cleanName = name.trim();

  try {
    const [rows] = await db.query('SELECT * FROM tags WHERE id = ?', [id]);
    if (!rows.length) {
      req.flash('error_msg', 'Tag not found.');
      return res.redirect('/sitehandler/tags');
    }

    // Check duplicate for other tags
    const [existing] = await db.query(
      'SELECT id FROM tags WHERE LOWER(name) = LOWER(?) AND id != ?',
      [cleanName, id]
    );
    if (existing.length > 0) {
      req.flash('error_msg', `Another tag with name "${cleanName}" already exists.`);
      return res.redirect(`/sitehandler/tags/${id}/edit`);
    }

    await db.query('UPDATE tags SET name = ? WHERE id = ?', [cleanName, id]);
    req.flash('success_msg', `Tag renamed to "${cleanName}".`);
    res.redirect('/sitehandler/tags');
  } catch (err) {
    req.flash('error_msg', 'Update failed: ' + err.message);
    res.redirect(`/sitehandler/tags/${id}/edit`);
  }
};

// ── POST /sitehandler/tags/:id/delete ────────────────────────────────────────
exports.postDelete = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM tags WHERE id = ?', [id]);
    if (!rows.length) {
      req.flash('error_msg', 'Tag not found.');
      return res.redirect('/sitehandler/tags');
    }
    const tagName = rows[0].name;

    await db.query('DELETE FROM tags WHERE id = ?', [id]);
    req.flash('success_msg', `Tag "${tagName}" deleted successfully.`);
    res.redirect('/sitehandler/tags');
  } catch (err) {
    req.flash('error_msg', 'Delete failed: ' + err.message);
    res.redirect('/sitehandler/tags');
  }
};
