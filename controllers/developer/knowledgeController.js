const db = require('../../config/database');

exports.getKnowledge = (req, res) => {
  res.render('developer/knowledge', { title: 'Knowledge Sphere' });
};

// ── Notes (own) ──────────────────────────────────────────────────────────────

exports.listNotes = async (req, res) => {
  try {
    const [notes] = await db.query(
      `SELECT id, title, description, content, is_shared, created_at, updated_at
       FROM developer_notes WHERE developer_id = ? ORDER BY updated_at DESC`,
      [req.session.developer.id]
    );
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load notes.' });
  }
};

exports.createNote = async (req, res) => {
  const { title, description, content } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  try {
    const [result] = await db.query(
      `INSERT INTO developer_notes (developer_id, title, description, content)
       VALUES (?, ?, ?, ?)`,
      [req.session.developer.id, title.trim(), description?.trim() || null, content || null]
    );
    const [rows] = await db.query('SELECT * FROM developer_notes WHERE id = ?', [result.insertId]);
    res.json({ note: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create note.' });
  }
};

exports.updateNote = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  try {
    const [rows] = await db.query(
      'SELECT id FROM developer_notes WHERE id = ? AND developer_id = ?',
      [id, devId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Note not found.' });

    const { title, description, content, is_shared } = req.body;
    const fields = [];
    const vals   = [];

    if (title !== undefined)       { fields.push('title = ?');       vals.push(title.trim()); }
    if (description !== undefined) { fields.push('description = ?'); vals.push(description?.trim() || null); }
    if (content !== undefined)     { fields.push('content = ?');     vals.push(content); }
    if (is_shared !== undefined)   { fields.push('is_shared = ?');   vals.push(is_shared ? 1 : 0); }

    if (fields.length) {
      vals.push(id);
      await db.query(`UPDATE developer_notes SET ${fields.join(', ')} WHERE id = ?`, vals);
    }

    const [updated] = await db.query('SELECT * FROM developer_notes WHERE id = ?', [id]);
    res.json({ note: updated[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note.' });
  }
};

exports.deleteNote = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(
      'DELETE FROM developer_notes WHERE id = ? AND developer_id = ?',
      [id, req.session.developer.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note.' });
  }
};

// ── Community (shared notes from all developers) ──────────────────────────────

exports.getCommunity = async (req, res) => {
  const search = req.query.search?.trim() || '';
  try {
    let query = `
      SELECT n.id, n.title, n.description, n.content, n.created_at,
             n.developer_id AS user_id,
             d.name AS developer_name, d.studio_name, d.avatar_url
      FROM developer_notes n
      JOIN developers d ON n.developer_id = d.id
      WHERE n.is_shared = 1`;
    const vals = [];

    if (search) {
      query += ` AND (n.title LIKE ? OR n.description LIKE ? OR n.content LIKE ?)`;
      const like = `%${search}%`;
      vals.push(like, like, like);
    }
    query += ' ORDER BY n.updated_at DESC LIMIT 100';

    const [notes] = await db.query(query, vals);
    res.json({ notes, currentUserId: req.session.developer.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load community notes.' });
  }
};
