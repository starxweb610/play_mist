/**
 * controllers/devapi/builderApi.js
 * The Game Builder's page-shaped actions, re-expressed as JSON for the app.
 *
 * The file API itself (list/read/save/create/rename/delete/upload) is NOT here
 * — those handlers already answer JSON and are mounted verbatim from
 * controllers/developer/builderController.js, so the phone editor and the web
 * editor write through exactly the same code onto the same workspace. A
 * developer can start a file on their laptop and keep typing on the bus.
 */
const db  = require('../../config/database');
const bfs = require('../../utils/builderFs');
const { BuilderError } = bfs;
const builder = require('../developer/builderController');

/** GET /builder/templates — the catalogue the template picker renders. */
exports.listTemplates = async (req, res) => {
  try {
    const [categories] = await db.query(
      `SELECT c.id, c.name, c.slug, c.description,
              COUNT(t.id) AS template_count
         FROM builder_template_categories c
         LEFT JOIN builder_templates t ON t.category_id = c.id AND t.is_active = 1
        WHERE c.is_active = 1
        GROUP BY c.id
       HAVING template_count > 0
        ORDER BY c.position ASC, c.name ASC`
    );
    const [templates] = await db.query(
      `SELECT t.id, t.category_id, t.name, t.description, t.file_count, t.size_bytes
         FROM builder_templates t
         JOIN builder_template_categories c ON c.id = t.category_id
        WHERE t.is_active = 1 AND c.is_active = 1
        ORDER BY t.name ASC`
    );
    res.json({
      categories: categories.map(c => ({
        id: c.id, name: c.name, slug: c.slug, description: c.description,
        templateCount: Number(c.template_count),
      })),
      templates: templates.map(t => ({
        id: t.id, categoryId: t.category_id, name: t.name, description: t.description,
        fileCount: t.file_count, sizeBytes: t.size_bytes,
      })),
    });
  } catch (err) {
    console.error('devapi listTemplates error:', err);
    res.status(500).json({ error: 'Failed to load templates.' });
  }
};

/** GET /builder/:project — whether this project has a workspace yet. */
exports.getWorkspace = async (req, res) => {
  const developerId = req.session.developer.id;
  try {
    const project = await builder.ownedProject(req.params.project, developerId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const workspace = await builder.loadWorkspace(project.id);
    const onDisk    = workspace && builder.dirExists(builder.workspacePath(developerId, project.id));

    res.json({
      project: { id: project.id, slug: project.slug, name: project.name },
      // A row whose directory has vanished is reported as "no template yet"
      // rather than opening an editor onto nothing (§5.7).
      workspace: onDisk ? {
        templateId:   workspace.template_id,
        templateName: workspace.template_name,
        lastOpenedAt: workspace.last_opened_at,
      } : null,
      needsTemplate: !onDisk,
    });
  } catch (err) {
    console.error('devapi getWorkspace error:', err);
    res.status(500).json({ error: 'Failed to load the workspace.' });
  }
};

/** POST /builder/:project/template  { templateId } */
exports.selectTemplate = async (req, res) => {
  const developerId = req.session.developer.id;
  try {
    const project = await builder.ownedProject(req.params.project, developerId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const template = await builder.applyTemplate(developerId, project, req.body?.templateId);
    res.status(201).json({ template: { id: template.id, name: template.name } });
  } catch (err) {
    if (err instanceof BuilderError) return res.status(err.status).json({ error: err.message });
    console.error('devapi selectTemplate error:', err);
    res.status(500).json({ error: 'Failed to set up that template.' });
  }
};

/**
 * POST /builder/:project/reset  { confirmName }
 * Destructive, so it is gated on the developer typing the project name —
 * the same confirmation the portal asks for.
 */
exports.resetWorkspace = async (req, res) => {
  const developerId = req.session.developer.id;
  try {
    const project = await builder.ownedProject(req.params.project, developerId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const confirm = String(req.body?.confirmName || '').trim();
    if (confirm.toLowerCase() !== project.name.trim().toLowerCase()) {
      return res.status(400).json({ error: 'The project name did not match — nothing was deleted.' });
    }

    await builder.clearWorkspace(developerId, project.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('devapi resetWorkspace error:', err);
    res.status(500).json({ error: 'Failed to clear the workspace.' });
  }
};
