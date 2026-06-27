const db = require('../../config/database');
const r2 = require('../../config/r2');

// ── Ownership helpers ─────────────────────────────────────────────────────────

async function ownedProject(projectId, devId) {
  const [rows] = await db.query(
    'SELECT id FROM developer_projects WHERE id = ? AND developer_id = ?',
    [projectId, devId]
  );
  return rows.length > 0;
}

async function ownedStoryboard(sbId, devId) {
  const [rows] = await db.query(
    `SELECT s.id, s.project_id FROM developer_storyboards s
     JOIN developer_projects p ON p.id = s.project_id
     WHERE s.id = ? AND p.developer_id = ?`,
    [sbId, devId]
  );
  return rows[0] || null;
}

async function ownedFrame(frameId, devId) {
  const [rows] = await db.query(
    `SELECT f.* FROM developer_storyboard_frames f
     JOIN developer_storyboards s ON s.id = f.storyboard_id
     JOIN developer_projects p ON p.id = s.project_id
     WHERE f.id = ? AND p.developer_id = ?`,
    [frameId, devId]
  );
  return rows[0] || null;
}

// Decode a PNG data-URL or use an uploaded file buffer → upload to R2, return URL.
async function uploadSketch(key, file) {
  const url = await r2.uploadBuffer(key, file.buffer, file.mimetype || 'image/png');
  return url;
}

function deleteFrameAssets(frame) {
  [frame.image_url, frame.thumb_url].forEach((u) => {
    const k = r2.keyFromUrl(u);
    if (k) r2.deleteObject(k).catch(() => {});
  });
}

// ── Storyboards ───────────────────────────────────────────────────────────────

exports.listStoryboards = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const [storyboards] = await db.query(
      `SELECT s.id, s.title, s.position, s.created_at, s.updated_at,
              COUNT(f.id) AS frame_count,
              (SELECT thumb_url FROM developer_storyboard_frames
                 WHERE storyboard_id = s.id ORDER BY position ASC, id ASC LIMIT 1) AS cover_url
       FROM developer_storyboards s
       LEFT JOIN developer_storyboard_frames f ON f.storyboard_id = s.id
       WHERE s.project_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC, s.created_at ASC`,
      [id]
    );
    res.json({ storyboards });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load storyboards.' });
  }
};

exports.createStoryboard = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const [[{ pos }]] = await db.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM developer_storyboards WHERE project_id = ?',
      [id]
    );
    const [result] = await db.query(
      'INSERT INTO developer_storyboards (project_id, developer_id, title, position) VALUES (?, ?, ?, ?)',
      [id, devId, title.trim(), pos]
    );
    const [rows] = await db.query('SELECT * FROM developer_storyboards WHERE id = ?', [result.insertId]);
    res.json({ storyboard: { ...rows[0], frame_count: 0, cover_url: null } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create storyboard.' });
  }
};

exports.updateStoryboard = async (req, res) => {
  const { sbId } = req.params;
  const devId = req.session.developer.id;
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  try {
    if (!(await ownedStoryboard(sbId, devId))) return res.status(404).json({ error: 'Storyboard not found.' });
    await db.query('UPDATE developer_storyboards SET title = ? WHERE id = ?', [title.trim(), sbId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update storyboard.' });
  }
};

exports.deleteStoryboard = async (req, res) => {
  const { sbId } = req.params;
  const devId = req.session.developer.id;
  try {
    if (!(await ownedStoryboard(sbId, devId))) return res.status(404).json({ error: 'Storyboard not found.' });
    const [frames] = await db.query(
      'SELECT image_url, thumb_url FROM developer_storyboard_frames WHERE storyboard_id = ?',
      [sbId]
    );
    frames.forEach(deleteFrameAssets);
    await db.query('DELETE FROM developer_storyboards WHERE id = ?', [sbId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete storyboard.' });
  }
};

// ── Frames ────────────────────────────────────────────────────────────────────

exports.listFrames = async (req, res) => {
  const { sbId } = req.params;
  const devId = req.session.developer.id;
  try {
    if (!(await ownedStoryboard(sbId, devId))) return res.status(404).json({ error: 'Storyboard not found.' });
    const [frames] = await db.query(
      `SELECT id, title, description, image_url, thumb_url, bg_color, position, created_at, updated_at
       FROM developer_storyboard_frames
       WHERE storyboard_id = ? ORDER BY position ASC, id ASC`,
      [sbId]
    );
    res.json({ frames });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load frames.' });
  }
};

exports.getFrame = async (req, res) => {
  const { frameId } = req.params;
  const devId = req.session.developer.id;
  try {
    const frame = await ownedFrame(frameId, devId);
    if (!frame) return res.status(404).json({ error: 'Frame not found.' });
    res.json({ frame });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load frame.' });
  }
};

// Same-origin proxy for a frame's full sketch, so the editor can load it onto a
// canvas without cross-origin tainting (which would break PNG re-export).
exports.streamFrameImage = async (req, res) => {
  const { frameId } = req.params;
  const devId = req.session.developer.id;
  try {
    const frame = await ownedFrame(frameId, devId);
    if (!frame || !frame.image_url) return res.status(404).send('Not found');
    const key = r2.keyFromUrl(frame.image_url);
    if (!key) return res.redirect(frame.image_url); // legacy/non-R2 URL
    const body = await r2.downloadStream(key);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    body.pipe(res);
  } catch (err) {
    res.status(500).send('Failed to load image');
  }
};

exports.createFrame = async (req, res) => {
  const { sbId } = req.params;
  const devId = req.session.developer.id;
  const { title, description, bg_color } = req.body;
  const image = req.files?.image?.[0];
  const thumb = req.files?.thumb?.[0];
  if (!image || !thumb) return res.status(400).json({ error: 'Sketch image is required.' });
  try {
    const sb = await ownedStoryboard(sbId, devId);
    if (!sb) return res.status(404).json({ error: 'Storyboard not found.' });

    const [[{ pos }]] = await db.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM developer_storyboard_frames WHERE storyboard_id = ?',
      [sbId]
    );
    const stamp = Date.now();
    const base  = `developers/storyboards/${devId}/${sb.project_id}/${sbId}`;
    const imageUrl = await uploadSketch(`${base}/${stamp}-full.png`, image);
    const thumbUrl = await uploadSketch(`${base}/${stamp}-thumb.png`, thumb);

    const [result] = await db.query(
      `INSERT INTO developer_storyboard_frames
         (storyboard_id, title, description, image_url, thumb_url, bg_color, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sbId, title?.trim() || null, description?.trim() || null, imageUrl, thumbUrl, bg_color || '#ffffff', pos]
    );
    const [rows] = await db.query('SELECT * FROM developer_storyboard_frames WHERE id = ?', [result.insertId]);
    res.json({ frame: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create frame.' });
  }
};

exports.updateFrame = async (req, res) => {
  const { frameId } = req.params;
  const devId = req.session.developer.id;
  const { title, description, bg_color } = req.body;
  const image = req.files?.image?.[0];
  const thumb = req.files?.thumb?.[0];
  try {
    const frame = await ownedFrame(frameId, devId);
    if (!frame) return res.status(404).json({ error: 'Frame not found.' });

    const fields = [], vals = [];
    if (title       !== undefined) { fields.push('title = ?');       vals.push(title?.trim() || null); }
    if (description !== undefined) { fields.push('description = ?'); vals.push(description?.trim() || null); }
    if (bg_color    !== undefined) { fields.push('bg_color = ?');    vals.push(bg_color || '#ffffff'); }

    // Replace sketch only when new image data is supplied
    if (image && thumb) {
      const stamp = Date.now();
      const base  = `developers/storyboards/${devId}/${frame.storyboard_id}`;
      const imageUrl = await uploadSketch(`${base}/${frameId}-${stamp}-full.png`, image);
      const thumbUrl = await uploadSketch(`${base}/${frameId}-${stamp}-thumb.png`, thumb);
      fields.push('image_url = ?'); vals.push(imageUrl);
      fields.push('thumb_url = ?'); vals.push(thumbUrl);
      deleteFrameAssets(frame); // remove the old assets after new ones are stored
    }

    if (fields.length) {
      vals.push(frameId);
      await db.query(`UPDATE developer_storyboard_frames SET ${fields.join(', ')} WHERE id = ?`, vals);
    }
    const [rows] = await db.query('SELECT * FROM developer_storyboard_frames WHERE id = ?', [frameId]);
    res.json({ frame: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update frame.' });
  }
};

exports.deleteFrame = async (req, res) => {
  const { frameId } = req.params;
  const devId = req.session.developer.id;
  try {
    const frame = await ownedFrame(frameId, devId);
    if (!frame) return res.status(404).json({ error: 'Frame not found.' });
    deleteFrameAssets(frame);
    await db.query('DELETE FROM developer_storyboard_frames WHERE id = ?', [frameId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete frame.' });
  }
};

// Reorder frames within a storyboard: body = { order: [frameId, ...] }
exports.reorderFrames = async (req, res) => {
  const { sbId } = req.params;
  const devId = req.session.developer.id;
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Invalid order.' });
  try {
    if (!(await ownedStoryboard(sbId, devId))) return res.status(404).json({ error: 'Storyboard not found.' });
    await Promise.all(order.map((fid, idx) =>
      db.query(
        'UPDATE developer_storyboard_frames SET position = ? WHERE id = ? AND storyboard_id = ?',
        [idx, fid, sbId]
      )
    ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder frames.' });
  }
};
