const db = require('../../config/database');

// ── Helper: verify project belongs to this developer ─────────────────────────
async function ownedProject(projectId, devId) {
  const [rows] = await db.query(
    'SELECT id FROM developer_projects WHERE id = ? AND developer_id = ?',
    [projectId, devId]
  );
  return rows.length > 0;
}

// ── Project list ──────────────────────────────────────────────────────────────

exports.getProjects = async (req, res) => {
  try {
    const [projects] = await db.query(
      `SELECT p.*,
         COUNT(t.id)                                AS task_count,
         SUM(t.status = 'done')                     AS completed_tasks
       FROM developer_projects p
       LEFT JOIN developer_project_tasks t ON t.project_id = p.id
       WHERE p.developer_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.session.developer.id]
    );
    res.render('developer/projects', { title: 'Projects', projects });
  } catch (err) {
    req.flash('error_msg', 'Failed to load projects.');
    res.render('developer/projects', { title: 'Projects', projects: [] });
  }
};

// ── Create project ────────────────────────────────────────────────────────────

exports.postProject = async (req, res) => {
  const { name, description, status, deadline } = req.body;
  if (!name?.trim()) {
    req.flash('error_msg', 'Project name is required.');
    return res.redirect('/developer/projects');
  }
  try {
    const [result] = await db.query(
      `INSERT INTO developer_projects (developer_id, name, description, status, deadline)
       VALUES (?, ?, ?, ?, ?)`,
      [req.session.developer.id, name.trim(), description?.trim() || null, status || 'active', deadline || null]
    );
    res.redirect(`/developer/projects/${result.insertId}`);
  } catch (err) {
    req.flash('error_msg', 'Failed to create project.');
    res.redirect('/developer/projects');
  }
};

// ── Project detail (page shell — tasks loaded via AJAX) ───────────────────────

exports.getProjectDetail = async (req, res) => {
  const devId = req.session.developer.id;
  try {
    const [rows] = await db.query(
      `SELECT p.*,
         COUNT(t.id)            AS task_count,
         SUM(t.status = 'done') AS completed_tasks
       FROM developer_projects p
       LEFT JOIN developer_project_tasks t ON t.project_id = p.id
       WHERE p.id = ? AND p.developer_id = ?
       GROUP BY p.id`,
      [req.params.id, devId]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Project not found.');
      return res.redirect('/developer/projects');
    }
    res.render('developer/project-detail', { title: rows[0].name, project: rows[0] });
  } catch (err) {
    req.flash('error_msg', 'Failed to load project.');
    res.redirect('/developer/projects');
  }
};

// ── Update project ────────────────────────────────────────────────────────────

exports.postUpdateProject = async (req, res) => {
  const { name, description, status, deadline } = req.body;
  const { id } = req.params;
  const devId = req.session.developer.id;
  try {
    await db.query(
      `UPDATE developer_projects
       SET name = ?, description = ?, status = ?, deadline = ?
       WHERE id = ? AND developer_id = ?`,
      [name?.trim() || 'Untitled', description?.trim() || null, status || 'active', deadline || null, id, devId]
    );
    req.flash('success_msg', 'Project updated.');
    res.redirect(`/developer/projects/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Failed to update project.');
    res.redirect(`/developer/projects/${id}`);
  }
};

// ── Delete project ────────────────────────────────────────────────────────────

exports.postDeleteProject = async (req, res) => {
  try {
    await db.query(
      'DELETE FROM developer_projects WHERE id = ? AND developer_id = ?',
      [req.params.id, req.session.developer.id]
    );
    req.flash('success_msg', 'Project deleted.');
    res.redirect('/developer/projects');
  } catch (err) {
    req.flash('error_msg', 'Failed to delete project.');
    res.redirect('/developer/projects');
  }
};

// ── Task JSON API ─────────────────────────────────────────────────────────────

exports.listTasks = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const [tasks] = await db.query(
      `SELECT * FROM developer_project_tasks
       WHERE project_id = ? ORDER BY position ASC, created_at ASC`,
      [id]
    );
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tasks.' });
  }
};

exports.createTask = async (req, res) => {
  const { id } = req.params;
  const devId = req.session.developer.id;
  const { title, description, priority, due_date, labels } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  try {
    if (!(await ownedProject(id, devId))) return res.status(404).json({ error: 'Project not found.' });
    const [result] = await db.query(
      `INSERT INTO developer_project_tasks
         (project_id, title, description, priority, due_date, labels, status)
       VALUES (?, ?, ?, ?, ?, ?, 'todo')`,
      [id, title.trim(), description?.trim() || null, priority || 'medium', due_date || null, labels || null]
    );
    const [rows] = await db.query(
      'SELECT * FROM developer_project_tasks WHERE id = ?', [result.insertId]
    );
    res.json({ task: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task.' });
  }
};

exports.updateTask = async (req, res) => {
  const { id, taskId } = req.params;
  const devId = req.session.developer.id;
  try {
    const [owned] = await db.query(
      `SELECT t.id FROM developer_project_tasks t
       JOIN developer_projects p ON p.id = t.project_id
       WHERE t.id = ? AND p.id = ? AND p.developer_id = ?`,
      [taskId, id, devId]
    );
    if (!owned.length) return res.status(404).json({ error: 'Task not found.' });

    const { title, description, status, priority, due_date, labels } = req.body;
    const fields = [], vals = [];
    if (title       !== undefined) { fields.push('title = ?');       vals.push(title.trim()); }
    if (description !== undefined) { fields.push('description = ?'); vals.push(description?.trim() || null); }
    if (status      !== undefined) { fields.push('status = ?');      vals.push(status); }
    if (priority    !== undefined) { fields.push('priority = ?');    vals.push(priority); }
    if (due_date    !== undefined) { fields.push('due_date = ?');    vals.push(due_date || null); }
    if (labels      !== undefined) { fields.push('labels = ?');      vals.push(labels || null); }

    if (fields.length) {
      vals.push(taskId);
      await db.query(`UPDATE developer_project_tasks SET ${fields.join(', ')} WHERE id = ?`, vals);
    }
    const [rows] = await db.query('SELECT * FROM developer_project_tasks WHERE id = ?', [taskId]);
    res.json({ task: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task.' });
  }
};

exports.deleteTask = async (req, res) => {
  const { id, taskId } = req.params;
  const devId = req.session.developer.id;
  try {
    await db.query(
      `DELETE t FROM developer_project_tasks t
       JOIN developer_projects p ON p.id = t.project_id
       WHERE t.id = ? AND p.id = ? AND p.developer_id = ?`,
      [taskId, id, devId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task.' });
  }
};

exports.moveTask = async (req, res) => {
  const { id, taskId } = req.params;
  const { status } = req.body;
  const devId = req.session.developer.id;
  const valid = ['todo', 'in_progress', 'in_review', 'done'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    await db.query(
      `UPDATE developer_project_tasks t
       JOIN developer_projects p ON p.id = t.project_id
       SET t.status = ?
       WHERE t.id = ? AND p.id = ? AND p.developer_id = ?`,
      [status, taskId, id, devId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to move task.' });
  }
};

// ── Comments ──────────────────────────────────────────────────────────────────

async function verifyTaskOwnership(taskId, projectId, devId) {
  const [rows] = await db.query(
    `SELECT t.id FROM developer_project_tasks t
     JOIN developer_projects p ON p.id = t.project_id
     WHERE t.id = ? AND p.id = ? AND p.developer_id = ?`,
    [taskId, projectId, devId]
  );
  return rows.length > 0;
}

exports.listComments = async (req, res) => {
  const { id, taskId } = req.params;
  const devId = req.session.developer.id;
  try {
    if (!(await verifyTaskOwnership(taskId, id, devId)))
      return res.status(404).json({ error: 'Task not found.' });
    const [comments] = await db.query(
      `SELECT c.*, d.name AS developer_name, d.avatar_url
       FROM developer_task_comments c
       JOIN developers d ON d.id = c.developer_id
       WHERE c.task_id = ? ORDER BY c.created_at ASC`,
      [taskId]
    );
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load comments.' });
  }
};

exports.addComment = async (req, res) => {
  const { id, taskId } = req.params;
  const devId = req.session.developer.id;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
  try {
    if (!(await verifyTaskOwnership(taskId, id, devId)))
      return res.status(404).json({ error: 'Task not found.' });
    const [result] = await db.query(
      'INSERT INTO developer_task_comments (task_id, developer_id, content) VALUES (?, ?, ?)',
      [taskId, devId, content]
    );
    const [rows] = await db.query(
      `SELECT c.*, d.name AS developer_name, d.avatar_url
       FROM developer_task_comments c
       JOIN developers d ON d.id = c.developer_id
       WHERE c.id = ?`,
      [result.insertId]
    );
    res.json({ comment: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment.' });
  }
};

exports.deleteComment = async (req, res) => {
  const { id, taskId, commentId } = req.params;
  const devId = req.session.developer.id;
  try {
    await db.query(
      `DELETE c FROM developer_task_comments c
       JOIN developer_project_tasks t ON t.id = c.task_id
       JOIN developer_projects p ON p.id = t.project_id
       WHERE c.id = ? AND t.id = ? AND p.id = ? AND p.developer_id = ?`,
      [commentId, taskId, id, devId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment.' });
  }
};
