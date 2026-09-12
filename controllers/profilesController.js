/**
 * controllers/profilesController.js
 * Public developer profiles (/@handle) and read-only shared projects.
 *
 * Access rule for projects: a project is visible only when its owner is an
 * active developer AND developer_projects.is_public = 1. Every query below
 * filters on both — there is no code path that loads a private project and
 * decides afterwards.
 */
const db = require('../config/database');
const r2 = require('../config/r2');
const { GAME_FIELDS, toCardView } = require('../utils/gameCards');
const { normalizeHandle, isHandleShape } = require('../utils/handles');
const { matchClause, shouldRedirectToSlug } = require('../utils/slugs');
const { formatBytes, formatCount } = require('../utils/format');
const { itemView: portfolioItemView } = require('../utils/portfolio');

const PORTFOLIO_FIELDS = `id, slug, title, description, image_url, video_provider, video_id,
  play_store_url, app_store_url, steam_url, itch_url, drive_url, updated_at`;

const APP_URL = () => process.env.APP_URL || 'https://playmist.app';

const PROFILE_FIELDS = `id, name, handle, studio_name, country, bio, headline, website_url,
  avatar_url, header_url, created_at`;

const TASK_COLUMNS = [
  { key: 'todo',        label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review',   label: 'In Review' },
  { key: 'done',        label: 'Done' },
];
const STATUS_LABEL = { active: 'Active', on_track: 'On Track', at_risk: 'At Risk', completed: 'Completed' };

function notFound(req, res) {
  res.status(404).render('profile/not-found', {
    title: `Not found – ${res.locals.appName}`,
    appUrl: APP_URL(),
  });
}

/**
 * Resolves :handle to an active developer. Sends a redirect (wrong case, or a
 * handle the developer has since changed) or a 404 and returns null otherwise.
 */
async function resolveDeveloper(req, res) {
  const raw    = req.params.handle;
  const handle = normalizeHandle(raw);
  if (raw.startsWith('@') || !isHandleShape(handle)) { notFound(req, res); return null; }

  // raw passed the shape check, so it is plain [A-Za-z0-9_] and appears
  // verbatim in req.path — safe to slice the remainder of the path off it.
  const rest = req.path.slice(`/@${raw}`.length);

  const [rows] = await db.query(`SELECT ${PROFILE_FIELDS} FROM developers WHERE handle = ? AND is_active = 1`, [handle]);
  if (rows.length) {
    if (raw !== handle) { res.redirect(301, `/@${handle}${rest}`); return null; }
    return rows[0];
  }

  const [moved] = await db.query(
    `SELECT d.handle FROM developer_handle_history h
     JOIN developers d ON d.id = h.developer_id AND d.is_active = 1
     WHERE h.handle = ?`,
    [handle]
  );
  if (moved.length && moved[0].handle) { res.redirect(301, `/@${moved[0].handle}${rest}`); return null; }

  notFound(req, res);
  return null;
}

async function resolvePublicProject(req, res, dev) {
  const match = matchClause(req.params.projectId);
  if (!match) { notFound(req, res); return null; }
  const [rows] = await db.query(
    `SELECT id, slug, name, description, status, deadline, created_at, updated_at
     FROM developer_projects WHERE ${match.sql} AND developer_id = ? AND is_public = 1`,
    [...match.params, dev.id]
  );
  if (!rows.length) { notFound(req, res); return null; }
  return rows[0];
}

async function resolvePublicDoc(req, res, project) {
  const match = matchClause(req.params.docId);
  if (!match) { notFound(req, res); return null; }
  const [rows] = await db.query(
    `SELECT id, slug, title, doc_type, content, file_name, file_size, file_url, mime_type, updated_at
     FROM developer_project_docs WHERE ${match.sql} AND project_id = ?`,
    [...match.params, project.id]
  );
  if (!rows.length) { notFound(req, res); return null; }
  return rows[0];
}

/**
 * Sends a permanent redirect when the request arrived on a legacy numeric
 * URL. Old links and sitemap entries still resolve; search engines and
 * anyone who shares the page end up on the canonical slug URL.
 */
function redirectedToSlug(req, res, pairs) {
  const stale = pairs.some(([param, row]) => shouldRedirectToSlug(param, row));
  if (!stale) return false;
  let path = req.path;
  for (const [param, row] of pairs) {
    if (shouldRedirectToSlug(param, row)) path = path.replace(`/${param}`, `/${row.slug}`);
  }
  res.redirect(301, path);
  return true;
}

const viewerOf = (req, dev) => {
  const id = req.session?.developer?.id || null;
  return { id, loggedIn: !!id, isSelf: !!id && id === dev.id };
};

// ── GET /@:handle ───────────────────────────────────────────────────────────

exports.getProfile = async (req, res) => {
  try {
    const dev = await resolveDeveloper(req, res);
    if (!dev) return;
    const viewer = viewerOf(req, dev);

    const [games] = await db.query(
      `SELECT ${GAME_FIELDS} FROM games WHERE developer_id = ? AND is_active = 1 ORDER BY created_at DESC`,
      [dev.id]
    );
    const [projects] = await db.query(
      `SELECT p.id, p.slug, p.name, p.description, p.status, p.updated_at,
              COUNT(t.id) AS task_count, COALESCE(SUM(t.status = 'done'), 0) AS done_count
       FROM developer_projects p
       LEFT JOIN developer_project_tasks t ON t.project_id = p.id
       WHERE p.developer_id = ? AND p.is_public = 1
       GROUP BY p.id ORDER BY p.updated_at DESC`,
      [dev.id]
    );
    const [portfolioRows] = await db.query(
      `SELECT ${PORTFOLIO_FIELDS} FROM developer_portfolio_items
       WHERE developer_id = ? ORDER BY position ASC, created_at DESC`,
      [dev.id]
    );
    const [[counts]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM developer_follows WHERE following_id = ?) AS followers,
              (SELECT COUNT(*) FROM developer_follows WHERE follower_id  = ?) AS following,
              (SELECT COUNT(*) FROM analytics_games ag JOIN games g ON g.id = ag.game_id
                 WHERE g.developer_id = ? AND g.is_active = 1) AS plays`,
      [dev.id, dev.id, dev.id]
    );

    let isFollowing = false;
    if (viewer.loggedIn && !viewer.isSelf) {
      const [f] = await db.query(
        'SELECT 1 FROM developer_follows WHERE follower_id = ? AND following_id = ?',
        [viewer.id, dev.id]
      );
      isFollowing = f.length > 0;
    }

    const profileUrl = `${APP_URL()}/@${dev.handle}`;
    res.render('profile/show', {
      title: `${dev.name} (@${dev.handle}) – Indie game developer on ${res.locals.appName}`,
      appUrl: APP_URL(),
      profileUrl,
      dev,
      games: games.map(toCardView),
      projects: projects.map((p) => ({
        ...p,
        statusLabel: STATUS_LABEL[p.status] || p.status,
        pct: Number(p.task_count) ? Math.round((Number(p.done_count) / Number(p.task_count)) * 100) : 0,
      })),
      portfolio: portfolioRows.map(portfolioItemView),
      stats: {
        games:     games.length,
        followers: formatCount(counts.followers),
        following: formatCount(counts.following),
        plays:     formatCount(counts.plays),
      },
      viewer: { ...viewer, isFollowing },
      // Empty profiles stay out of search results (thin content).
      indexable: games.length > 0 || projects.length > 0 || portfolioRows.length > 0 || !!dev.bio,
    });
  } catch (err) {
    console.error('getProfile error:', err);
    res.status(500).send('Something went wrong.');
  }
};

// ── GET /@:handle/portfolio/:itemId ─────────────────────────────────────────

exports.getPortfolioItem = async (req, res) => {
  try {
    const dev = await resolveDeveloper(req, res);
    if (!dev) return;
    const match = matchClause(req.params.itemId);
    if (!match) return notFound(req, res);

    const [rows] = await db.query(
      `SELECT ${PORTFOLIO_FIELDS} FROM developer_portfolio_items
       WHERE ${match.sql} AND developer_id = ?`,
      [...match.params, dev.id]
    );
    if (!rows.length) return notFound(req, res);
    if (redirectedToSlug(req, res, [[req.params.itemId, rows[0]]])) return;

    const [others] = await db.query(
      `SELECT id, slug, title, image_url FROM developer_portfolio_items
       WHERE developer_id = ? AND id <> ? ORDER BY position ASC, created_at DESC LIMIT 6`,
      [dev.id, rows[0].id]
    );

    res.render('profile/portfolio-item', {
      title: `${rows[0].title} by ${dev.name} – ${res.locals.appName}`,
      appUrl: APP_URL(),
      dev,
      item: portfolioItemView(rows[0]),
      others,
      viewer: viewerOf(req, dev),
    });
  } catch (err) {
    console.error('getPortfolioItem error:', err);
    res.status(500).send('Something went wrong.');
  }
};

// ── GET /@:handle/followers, /@:handle/following ────────────────────────────

exports.getConnections = (kind) => async (req, res) => {
  try {
    const dev = await resolveDeveloper(req, res);
    if (!dev) return;
    const join = kind === 'followers'
      ? 'JOIN developer_follows f ON f.follower_id = d.id AND f.following_id = ?'
      : 'JOIN developer_follows f ON f.following_id = d.id AND f.follower_id = ?';
    const [people] = await db.query(
      `SELECT d.name, d.handle, d.avatar_url, d.headline, d.studio_name
       FROM developers d ${join}
       WHERE d.is_active = 1 ORDER BY f.created_at DESC LIMIT 500`,
      [dev.id]
    );
    res.render('profile/connections', {
      title: `${kind === 'followers' ? 'Followers' : 'Following'} · ${dev.name} (@${dev.handle}) – ${res.locals.appName}`,
      appUrl: APP_URL(),
      dev, people, kind,
    });
  } catch (err) {
    console.error('getConnections error:', err);
    res.status(500).send('Something went wrong.');
  }
};

// ── GET /@:handle/projects/:projectId ───────────────────────────────────────

exports.getProject = async (req, res) => {
  try {
    const dev = await resolveDeveloper(req, res);
    if (!dev) return;
    const project = await resolvePublicProject(req, res, dev);
    if (!project) return;
    if (redirectedToSlug(req, res, [[req.params.projectId, project]])) return;

    const [tasks] = await db.query(
      `SELECT id, title, description, status, priority, due_date, labels, updated_at
       FROM developer_project_tasks WHERE project_id = ?
       ORDER BY position ASC, created_at ASC`,
      [project.id]
    );
    const [storyboards] = await db.query(
      `SELECT id, title FROM developer_storyboards WHERE project_id = ?
       ORDER BY position ASC, created_at ASC`,
      [project.id]
    );
    let frames = [];
    if (storyboards.length) {
      [frames] = await db.query(
        `SELECT id, storyboard_id, title, description, image_url, thumb_url
         FROM developer_storyboard_frames WHERE storyboard_id IN (?)
         ORDER BY position ASC, id ASC`,
        [storyboards.map((s) => s.id)]
      );
    }
    const [docs] = await db.query(
      `SELECT id, slug, title, doc_type, file_name, file_size, is_pinned, updated_at
       FROM developer_project_docs WHERE project_id = ?
       ORDER BY is_pinned DESC, updated_at DESC`,
      [project.id]
    );

    const shapedTasks = tasks.map((t) => ({
      ...t,
      labelList: String(t.labels || '').split(',').map((l) => l.trim()).filter(Boolean),
    }));
    const done = shapedTasks.filter((t) => t.status === 'done').length;

    res.render('profile/project', {
      title: `${project.name} · ${dev.name} (@${dev.handle}) – ${res.locals.appName}`,
      appUrl: APP_URL(),
      dev,
      project: { ...project, statusLabel: STATUS_LABEL[project.status] || project.status },
      columns: TASK_COLUMNS.map((c) => ({ ...c, tasks: shapedTasks.filter((t) => (t.status || 'todo') === c.key) })),
      taskStats: {
        total: shapedTasks.length,
        done,
        pct: shapedTasks.length ? Math.round((done / shapedTasks.length) * 100) : 0,
      },
      storyboards: storyboards.map((s) => ({ ...s, frames: frames.filter((f) => f.storyboard_id === s.id) })),
      docs: docs.map((d) => ({ ...d, sizeLabel: d.file_size ? formatBytes(d.file_size) : '' })),
      viewer: viewerOf(req, dev),
    });
  } catch (err) {
    console.error('getProject error:', err);
    res.status(500).send('Something went wrong.');
  }
};

// ── GET /@:handle/projects/:projectId/docs/:docId ───────────────────────────

exports.getDoc = async (req, res) => {
  try {
    const dev = await resolveDeveloper(req, res);
    if (!dev) return;
    const project = await resolvePublicProject(req, res, dev);
    if (!project) return;
    const doc = await resolvePublicDoc(req, res, project);
    if (!doc) return;
    if (redirectedToSlug(req, res, [[req.params.projectId, project], [req.params.docId, doc]])) return;

    // Uploaded files live on the R2 public bucket; only link URLs we issued.
    const fileUrl = doc.doc_type === 'upload' && r2.keyFromUrl(doc.file_url) ? doc.file_url : null;

    res.render('profile/doc', {
      title: `${doc.title} · ${project.name} – ${res.locals.appName}`,
      appUrl: APP_URL(),
      dev, project,
      doc: { id: doc.id, slug: doc.slug, title: doc.title, docType: doc.doc_type, fileName: doc.file_name,
             sizeLabel: doc.file_size ? formatBytes(doc.file_size) : '', updatedAt: doc.updated_at },
      fileUrl,
      contentUrl: `/@${dev.handle}/projects/${project.slug}/docs/${doc.slug}/content`,
    });
  } catch (err) {
    console.error('getDoc error:', err);
    res.status(500).send('Something went wrong.');
  }
};

// ── GET /@:handle/projects/:projectId/docs/:docId/content ───────────────────
//
// Doc bodies are HTML the developer wrote (rich text or raw HTML). Rendering
// that inline on playmist.app would let any public project run script against
// every visitor. Instead it is served as its own document under a CSP
// `sandbox` policy: the browser gives it an opaque origin with scripts, forms
// and same-origin access all disabled — even if the URL is opened directly
// rather than through the page's <iframe sandbox>.

const DOC_CSP = [
  'sandbox allow-popups allow-popups-to-escape-sandbox',
  "default-src 'none'",
  'img-src https: data:',
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https: data:',
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

function wrapRichText(html) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base target="_blank">
<style>
  body{margin:0;padding:26px 30px;background:#15121F;color:#E9E5F5;font:15px/1.7 Manrope,system-ui,-apple-system,sans-serif;word-wrap:break-word}
  p{margin:0} img{max-width:100%;height:auto;border-radius:6px} a{color:#B5FF6B}
  h1,h2,h3{line-height:1.25;color:#fff;margin:.6em 0 .3em}
  pre,code{background:#0B0911;border-radius:6px;font-family:ui-monospace,Menlo,monospace}
  code{padding:1px 5px} pre{padding:12px;overflow:auto}
  blockquote{border-left:3px solid #9B7DFF;margin:.5em 0;padding-left:14px;color:#C9C3DB}
  .ql-align-center{text-align:center}.ql-align-right{text-align:right}.ql-align-justify{text-align:justify}
  .ql-indent-1{padding-left:3em}.ql-indent-2{padding-left:6em}.ql-indent-3{padding-left:9em}
  .ql-size-small{font-size:.75em}.ql-size-large{font-size:1.5em}.ql-size-huge{font-size:2.5em}
  .ql-font-serif{font-family:Georgia,serif}.ql-font-monospace{font-family:ui-monospace,monospace}
</style></head><body>${html || ''}</body></html>`;
}

exports.getDocContent = async (req, res) => {
  try {
    const dev = await resolveDeveloper(req, res);
    if (!dev) return;
    const project = await resolvePublicProject(req, res, dev);
    if (!project) return;
    const doc = await resolvePublicDoc(req, res, project);
    if (!doc) return;
    if (doc.doc_type === 'upload') { notFound(req, res); return; }

    res.set({
      'Content-Type':            'text/html; charset=utf-8',
      'Content-Security-Policy': DOC_CSP,
      'X-Content-Type-Options':  'nosniff',
      'Referrer-Policy':         'no-referrer',
      'Cache-Control':           'no-cache',
      'X-Robots-Tag':            'noindex',
    });
    res.send(doc.doc_type === 'html' ? (doc.content || '') : wrapRichText(doc.content));
  } catch (err) {
    console.error('getDocContent error:', err);
    res.status(500).send('Something went wrong.');
  }
};
