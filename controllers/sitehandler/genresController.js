const db = require('../../config/database');

// ── GET /sitehandler/genres ──────────────────────────────────────────────────
exports.getIndex = async (req, res) => {
  try {
    const [genres] = await db.query(
      `SELECT g.id, g.name, COUNT(gm.id) AS game_count
       FROM genres g
       LEFT JOIN games gm ON g.name = gm.genre
       GROUP BY g.id, g.name
       ORDER BY g.name ASC`
    );
    res.render('sitehandler/genres/index', {
      title: 'Manage Genres',
      activePage: 'genres',
      genres,
    });
  } catch (err) {
    req.flash('error_msg', 'Failed to load genres: ' + err.message);
    res.redirect('/sitehandler/dashboard');
  }
};

// ── POST /sitehandler/genres/create ──────────────────────────────────────────
exports.postCreate = async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error_msg', 'Genre name is required.');
    return res.redirect('/sitehandler/genres');
  }
  const cleanName = name.trim();

  try {
    // Check duplicate case-insensitive
    const [existing] = await db.query(
      'SELECT id FROM genres WHERE LOWER(name) = LOWER(?)',
      [cleanName]
    );
    if (existing.length > 0) {
      req.flash('error_msg', `Genre "${cleanName}" already exists.`);
      return res.redirect('/sitehandler/genres');
    }

    await db.query('INSERT INTO genres (name) VALUES (?)', [cleanName]);
    req.flash('success_msg', `Genre "${cleanName}" created successfully.`);
    res.redirect('/sitehandler/genres');
  } catch (err) {
    req.flash('error_msg', 'Failed to create genre: ' + err.message);
    res.redirect('/sitehandler/genres');
  }
};

// ── GET /sitehandler/genres/:id/edit ─────────────────────────────────────────
exports.getEdit = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM genres WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      req.flash('error_msg', 'Genre not found.');
      return res.redirect('/sitehandler/genres');
    }
    res.render('sitehandler/genres/edit', {
      title: 'Edit Genre',
      activePage: 'genres',
      genre: rows[0],
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/genres');
  }
};

// ── POST /sitehandler/genres/:id/update ──────────────────────────────────────
exports.postUpdate = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error_msg', 'Genre name is required.');
    return res.redirect(`/sitehandler/genres/${id}/edit`);
  }
  const cleanName = name.trim();

  try {
    const [rows] = await db.query('SELECT * FROM genres WHERE id = ?', [id]);
    if (!rows.length) {
      req.flash('error_msg', 'Genre not found.');
      return res.redirect('/sitehandler/genres');
    }
    const oldName = rows[0].name;

    // Check duplicate for other genres
    const [existing] = await db.query(
      'SELECT id FROM genres WHERE LOWER(name) = LOWER(?) AND id != ?',
      [cleanName, id]
    );
    if (existing.length > 0) {
      req.flash('error_msg', `Another genre with name "${cleanName}" already exists.`);
      return res.redirect(`/sitehandler/genres/${id}/edit`);
    }

    // Update genres table
    await db.query('UPDATE genres SET name = ? WHERE id = ?', [cleanName, id]);

    // Cascade update to games table
    await db.query('UPDATE games SET genre = ? WHERE genre = ?', [cleanName, oldName]);

    req.flash('success_msg', `Genre renamed to "${cleanName}". Associated games updated.`);
    res.redirect('/sitehandler/genres');
  } catch (err) {
    req.flash('error_msg', 'Update failed: ' + err.message);
    res.redirect(`/sitehandler/genres/${id}/edit`);
  }
};

// ── POST /sitehandler/genres/:id/delete ──────────────────────────────────────
exports.postDelete = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM genres WHERE id = ?', [id]);
    if (!rows.length) {
      req.flash('error_msg', 'Genre not found.');
      return res.redirect('/sitehandler/genres');
    }
    const genreName = rows[0].name;

    // Delete genre
    await db.query('DELETE FROM genres WHERE id = ?', [id]);

    // Update associated games to 'Other'
    await db.query("UPDATE games SET genre = 'Other' WHERE genre = ?", [genreName]);

    req.flash('success_msg', `Genre "${genreName}" deleted. Associated games set to "Other".`);
    res.redirect('/sitehandler/genres');
  } catch (err) {
    req.flash('error_msg', 'Delete failed: ' + err.message);
    res.redirect('/sitehandler/genres');
  }
};
