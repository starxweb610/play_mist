/**
 * controllers/devapi/projectsApi.js
 * JSON project CRUD + dashboard for the Studio app.
 *
 * The portal's own task, comment, doc and storyboard handlers are mounted
 * straight onto /api/dev/v1 (they already answer JSON and only read
 * req.session.developer.id) — only the handlers that render or redirect are
 * re-expressed here.
 */
const db = require('../../config/database');
const { uniqueSlug, matchClause } = require('../../utils/slugs');

const shape = (p) => ({
  id:             p.id,
  slug:           p.slug,
  name:           p.name,
  description:    p.description,
  status:         p.status,
  deadline:       p.deadline,
  isPublic:       !!p.is_public,
  coverUrl:       p.cover_url || null,
  taskCount:      Number(p.task_count || 0),
  completedTasks: Number(p.completed_tasks || 0),
  hasWorkspace:   p.workspace_id ? true : false,
  templateName:   p.template_name || null,
  // Which of the two build sources this project runs from (§5.8): the Game
  // Builder workspace, or a zip exported from a real engine and uploaded.
  buildSource:    p.build_source || 'editor',
  uploadFilename: p.upload_filename || null,
  uploadedAt:     p.uploaded_at || null,
  sandboxGameId:  p.sandbox_game_id || null,
  createdAt:      p.created_at,
  updatedAt:      p.updated_at,
});

const PROJECT_SELECT = `
  SELECT p.*,
         COUNT(t.id)            AS task_count,
         SUM(t.status = 'done') AS completed_tasks,
         w.id                   AS workspace_id,
         w.template_name        AS template_name
  FROM developer_projects p
  LEFT JOIN developer_project_tasks t       ON t.project_id = p.id
  LEFT JOIN developer_builder_workspaces w  ON w.project_id = p.id`;

exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `${PROJECT_SELECT} WHERE p.developer_id = ? GROUP BY p.id ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC`,
      [req.session.developer.id]
    );
    res.json({ projects: rows.map(shape) });
  } catch (err) {
    console.error('devapi projects list error:', err);
    res.status(500).json({ error: 'Failed to load projects.' });
  }
};

exports.detail = async (req, res) => {
  const match = matchClause(req.params.id);
  if (!match) return res.status(404).json({ error: 'Project not found.' });
  try {
    const [rows] = await db.query(
      `${PROJECT_SELECT} WHERE ${match.sql.replace(/\b(slug|id)\b/g, 'p.$1')} AND p.developer_id = ? GROUP BY p.id`,
      [...match.params, req.session.developer.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project: shape(rows[0]) });
  } catch (err) {
    console.error('devapi project detail error:', err);
    res.status(500).json({ error: 'Failed to load project.' });
  }
};

exports.create = async (req, res) => {
  const { name, description, status, deadline } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required.' });
  try {
    const devId = req.session.developer.id;
    const slug  = await uniqueSlug('developer_projects', 'developer_id', devId, name.trim());
    const [result] = await db.query(
      `INSERT INTO developer_projects (developer_id, slug, name, description, status, deadline)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [devId, slug, name.trim(), description?.trim() || null, status || 'active', deadline || null]
    );
    const [[row]] = await db.query('SELECT * FROM developer_projects WHERE id = ?', [result.insertId]);
    res.status(201).json({ project: shape(row) });
  } catch (err) {
    console.error('devapi project create error:', err);
    res.status(500).json({ error: 'Failed to create project.' });
  }
};

exports.update = async (req, res) => {
  const { name, description, status, deadline } = req.body || {};
  const devId = req.session.developer.id;
  try {
    // The slug is deliberately left alone on rename (see utils/slugs.js), so a
    // link someone already shared keeps working.
    const [result] = await db.query(
      `UPDATE developer_projects
       SET name = ?, description = ?, status = ?, deadline = ?
       WHERE id = ? AND developer_id = ?`,
      [name?.trim() || 'Untitled', description?.trim() || null, status || 'active', deadline || null,
       req.params.id, devId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Project not found.' });
    const [[row]] = await db.query('SELECT * FROM developer_projects WHERE id = ?', [req.params.id]);
    res.json({ project: shape(row) });
  } catch (err) {
    console.error('devapi project update error:', err);
    res.status(500).json({ error: 'Failed to update project.' });
  }
};

exports.remove = async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM developer_projects WHERE id = ? AND developer_id = ?',
      [req.params.id, req.session.developer.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Project not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('devapi project delete error:', err);
    res.status(500).json({ error: 'Failed to delete project.' });
  }
};

/**
 * GET /dashboard — the numbers the Studio home screen opens on.
 * Plays and ratings are read from the same places the portal reads them
 * (analytics_games, game_ratings), so the app and the website never quote
 * different figures for the same game.
 */
exports.dashboard = async (req, res) => {
  const devId = req.session.developer.id;
  try {
    const [[projects]] = await db.query(
      'SELECT COUNT(*) AS c FROM developer_projects WHERE developer_id = ?', [devId]
    );
    const [submissions] = await db.query(
      `SELECT status, COUNT(*) AS c FROM developer_submissions WHERE developer_id = ? GROUP BY status`,
      [devId]
    );
    const [[games]] = await db.query(
      'SELECT COUNT(*) AS c FROM games WHERE developer_id = ? AND is_active = 1 AND is_sandbox = 0', [devId]
    );
    const [[plays]] = await db.query(
      `SELECT COUNT(*) AS c FROM analytics_games ag
       JOIN games g ON g.id = ag.game_id
       WHERE g.developer_id = ? AND g.is_sandbox = 0`,
      [devId]
    );
    const [recent] = await db.query(
      `SELECT id, title, slug, status, created_at, updated_at
       FROM developer_submissions WHERE developer_id = ?
       ORDER BY updated_at DESC LIMIT 5`,
      [devId]
    );
    // The five projects the developer touched last — the home screen's main
    // content, so the app opens on work in progress rather than on counters.
    const [recentProjects] = await db.query(
      `${PROJECT_SELECT} WHERE p.developer_id = ?
       GROUP BY p.id ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC LIMIT 5`,
      [devId]
    );

    const byStatus = Object.fromEntries(submissions.map(r => [r.status, Number(r.c)]));
    res.json({
      projects:    Number(projects.c),
      liveGames:   Number(games.c),
      totalPlays:  Number(plays.c),
      submissions: {
        total:        submissions.reduce((n, r) => n + Number(r.c), 0),
        pending:      byStatus.pending || 0,
        underReview:  byStatus.under_review || 0,
        approved:     byStatus.approved || 0,
        rejected:     byStatus.rejected || 0,
        draft:        byStatus.draft || 0,
      },
      recentSubmissions: recent.map(s => ({
        id: s.id, title: s.title, slug: s.slug, status: s.status, updatedAt: s.updated_at,
      })),
      recentProjects: recentProjects.map(shape),
    });
  } catch (err) {
    console.error('devapi dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
};
