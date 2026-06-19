const path = require('path');
const db   = require('../../config/database');
const r2   = require('../../config/r2');

async function ownedProject(projectId, devId) {
  const [rows] = await db.query(
    'SELECT id FROM developer_projects WHERE id = ? AND developer_id = ?',
    [projectId, devId]
  );
  return rows.length > 0;
}

exports.listDocs = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const [docs] = await db.query(
      `SELECT id, title, doc_type, file_name, file_size, mime_type, file_url,
              is_pinned, created_at, updated_at
       FROM developer_project_docs
       WHERE project_id = ? ORDER BY is_pinned DESC, created_at DESC`,
      [id]
    );
    res.json({ docs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load docs.' });
  }
};

exports.createDoc = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  const { title, doc_type, content } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!['rich_text', 'html'].includes(doc_type)) return res.status(400).json({ error: 'Invalid doc type.' });
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const [result] = await db.query(
      `INSERT INTO developer_project_docs (project_id, developer_id, title, doc_type, content)
       VALUES (?, ?, ?, ?, ?)`,
      [id, devId, title.trim(), doc_type, content || '']
    );
    const [rows] = await db.query(
      'SELECT * FROM developer_project_docs WHERE id = ?', [result.insertId]
    );
    res.json({ doc: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create doc.' });
  }
};

exports.uploadDoc = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const { id } = req.params;
  const devId = req.session.developer.id;
  const { title } = req.body;
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.bin';
    const key = `developers/docs/${devId}/${id}/${Date.now()}${ext}`;
    const url = await r2.uploadBuffer(key, req.file.buffer, req.file.mimetype);
    const docTitle = title?.trim() || req.file.originalname;
    const [result] = await db.query(
      `INSERT INTO developer_project_docs
         (project_id, developer_id, title, doc_type, file_url, file_name, file_size, mime_type)
       VALUES (?, ?, ?, 'upload', ?, ?, ?, ?)`,
      [id, devId, docTitle, url, req.file.originalname, req.file.size, req.file.mimetype]
    );
    const [rows] = await db.query(
      'SELECT * FROM developer_project_docs WHERE id = ?', [result.insertId]
    );
    res.json({ doc: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload doc.' });
  }
};

exports.getDoc = async (req, res) => {
  const { docId } = req.params;
  const devId = req.session.developer.id;
  try {
    const [rows] = await db.query(
      `SELECT d.* FROM developer_project_docs d
       JOIN developer_projects p ON p.id = d.project_id
       WHERE d.id = ? AND p.developer_id = ?`,
      [docId, devId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Doc not found.' });
    res.json({ doc: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load doc.' });
  }
};

exports.updateDoc = async (req, res) => {
  const { docId } = req.params;
  const devId = req.session.developer.id;
  const { title, content } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT d.id, d.doc_type FROM developer_project_docs d
       JOIN developer_projects p ON p.id = d.project_id
       WHERE d.id = ? AND p.developer_id = ?`,
      [docId, devId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Doc not found.' });
    if (rows[0].doc_type === 'upload') return res.status(400).json({ error: 'Cannot edit uploaded files.' });

    const fields = [], vals = [];
    if (title   !== undefined) { fields.push('title = ?');   vals.push(title.trim()); }
    if (content !== undefined) { fields.push('content = ?'); vals.push(content); }
    if (fields.length) {
      vals.push(docId);
      await db.query(`UPDATE developer_project_docs SET ${fields.join(', ')} WHERE id = ?`, vals);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update doc.' });
  }
};

exports.deleteDoc = async (req, res) => {
  const { docId } = req.params;
  const devId = req.session.developer.id;
  try {
    const [rows] = await db.query(
      `SELECT d.file_url FROM developer_project_docs d
       JOIN developer_projects p ON p.id = d.project_id
       WHERE d.id = ? AND p.developer_id = ?`,
      [docId, devId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Doc not found.' });
    if (rows[0].file_url) {
      const key = r2.keyFromUrl(rows[0].file_url);
      if (key) await r2.deleteObject(key).catch(() => {});
    }
    await db.query('DELETE FROM developer_project_docs WHERE id = ?', [docId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete doc.' });
  }
};

exports.pinDoc = async (req, res) => {
  const { docId } = req.params;
  const devId = req.session.developer.id;
  try {
    const [rows] = await db.query(
      `SELECT d.is_pinned FROM developer_project_docs d
       JOIN developer_projects p ON p.id = d.project_id
       WHERE d.id = ? AND p.developer_id = ?`,
      [docId, devId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Doc not found.' });
    const newPin = rows[0].is_pinned ? 0 : 1;
    await db.query('UPDATE developer_project_docs SET is_pinned = ? WHERE id = ?', [newPin, docId]);
    res.json({ ok: true, is_pinned: !!newPin });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pin.' });
  }
};
