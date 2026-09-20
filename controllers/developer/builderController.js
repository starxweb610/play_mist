/**
 * controllers/developer/builderController.js
 * The in-browser Game Builder.
 *
 * Flow: pick a project → pick a category → pick a template → the template is
 * extracted into a private workspace on disk → the IDE edits it in place.
 *
 * Two things here are load-bearing:
 *
 *  1. Every path from the browser goes through utils/builderFs, which is the
 *     only code allowed to turn a developer-supplied string into a real path.
 *
 *  2. The preview runs a developer's own HTML and JavaScript. It is served
 *     from a token URL that sits OUTSIDE the session gate and rendered in an
 *     iframe WITHOUT allow-same-origin, so the game gets an opaque origin: it
 *     cannot read the portal's cookies, its DOM, or anything else on the
 *     playmist.app origin. The token is what authorises the read, which is
 *     also why the route cannot depend on the session cookie — a sandboxed
 *     frame is not guaranteed to send one.
 */
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const crypto = require('crypto');
const fse    = require('fs-extra');

const db     = require('../../config/database');
const r2     = require('../../config/r2');
const bfs    = require('../../utils/builderFs');
const zipper = require('../../utils/builderZip');
const { matchClause } = require('../../utils/slugs');
const { BuilderError } = bfs;

const TEMP_DIR = path.join(__dirname, '..', '..', 'uploads', 'temp');

// ── Preview tokens ───────────────────────────────────────────────────────────
// In-process, short-lived, single-workspace. Deliberately not in the session:
// the preview iframe has an opaque origin and no reliable cookie, and putting
// the grant in memory keeps the preview route free of any session lookup.
// A restart drops them; the IDE asks for a fresh one on every Run, so the only
// visible effect is that an idle preview tab needs a re-run.
const PREVIEW_TTL_MS = 4 * 60 * 60 * 1000;
const previewTokens = new Map();

function issuePreviewToken(developerId, projectId, rootDir) {
  const token = crypto.randomBytes(24).toString('hex');
  previewTokens.set(token, { developerId, projectId, rootDir, expiresAt: Date.now() + PREVIEW_TTL_MS });
  // Opportunistic sweep — there is no scheduler for this and the map would
  // otherwise grow for the life of the process.
  if (previewTokens.size > 500) {
    const now = Date.now();
    for (const [key, grant] of previewTokens) if (grant.expiresAt <= now) previewTokens.delete(key);
  }
  return token;
}

function readPreviewToken(token) {
  const grant = previewTokens.get(token);
  if (!grant) return null;
  if (grant.expiresAt <= Date.now()) { previewTokens.delete(token); return null; }
  return grant;
}

/** Drops every token pointing at a workspace whose files just went away. */
function revokeTokensFor(projectId) {
  for (const [key, grant] of previewTokens) {
    if (grant.projectId === projectId) previewTokens.delete(key);
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

const devId = (req) => req.session.developer.id;

/**
 * Resolves a :project param (slug, or a legacy numeric id) this developer owns.
 * `columns` is a caller-supplied column list — never anything from a request —
 * so the Studio app's build endpoints can read build_source and the upload
 * metadata without a second query.
 */
async function ownedProject(param, developerId, columns = 'id, slug, name, status') {
  const match = matchClause(param);
  if (!match) return null;
  const [rows] = await db.query(
    `SELECT ${columns} FROM developer_projects WHERE ${match.sql} AND developer_id = ?`,
    [...match.params, developerId]
  );
  return rows[0] || null;
}

async function loadWorkspace(projectId) {
  const [rows] = await db.query(
    'SELECT * FROM developer_builder_workspaces WHERE project_id = ?', [projectId]
  );
  return rows[0] || null;
}

/** The absolute workspace directory, or null when the row exists but the files do not. */
function workspacePath(developerId, projectId) {
  return bfs.workspaceDir(developerId, projectId);
}

const dirExists = (abs) => {
  try { return fs.statSync(abs).isDirectory(); } catch (_) { return false; }
};

/**
 * Wraps a JSON handler so a BuilderError becomes its own status and message
 * rather than the generic 500 page — these are answered by fetch(), and the
 * IDE shows the message verbatim.
 */
const json = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (err instanceof BuilderError) return res.status(err.status).json({ error: err.message });
    console.error('❌ builder:', err.stack || err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

/**
 * Resolves project + workspace + root directory for every JSON file call, or
 * answers the request itself and returns null.
 */
async function requireWorkspace(req, res) {
  const developerId = devId(req);
  const project = await ownedProject(req.params.project, developerId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return null;
  }

  const workspace = await loadWorkspace(project.id);
  if (!workspace) {
    res.status(409).json({ error: 'This project has no builder workspace yet.', needsTemplate: true });
    return null;
  }

  const root = workspacePath(developerId, project.id);
  if (!dirExists(root)) {
    res.status(410).json({
      error: 'This project’s files are missing from the server. Choose a template to start again.',
      needsTemplate: true,
    });
    return null;
  }

  return { developerId, project, workspace, root };
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** GET /developer/builder — project picker. */
exports.getIndex = async (req, res) => {
  const developerId = devId(req);
  try {
    const [projects] = await db.query(
      `SELECT p.id, p.slug, p.name, p.description, p.status, p.updated_at,
              w.id AS workspace_id, w.template_name, w.last_opened_at
         FROM developer_projects p
         LEFT JOIN developer_builder_workspaces w ON w.project_id = p.id
        WHERE p.developer_id = ?
        ORDER BY (w.id IS NULL), COALESCE(w.last_opened_at, p.updated_at) DESC`,
      [developerId]
    );
    res.render('developer/builder', {
      title: 'Game Builder',
      developer: req.session.developer,
      projects,
    });
  } catch (err) {
    req.flash('error_msg', 'Failed to load the Game Builder.');
    res.redirect('/developer/dashboard');
  }
};

/**
 * GET /developer/builder/:project
 * The IDE when a workspace exists, the template picker when it does not.
 */
exports.getProject = async (req, res) => {
  const developerId = devId(req);
  try {
    const project = await ownedProject(req.params.project, developerId);
    if (!project) {
      req.flash('error_msg', 'Project not found.');
      return res.redirect('/developer/builder');
    }

    const workspace = await loadWorkspace(project.id);
    const root = workspacePath(developerId, project.id);

    // A row without files means the workspace was wiped underneath us (a
    // restored VPS, a manual cleanup). Treat it as "no template yet" rather
    // than opening an IDE onto nothing.
    if (!workspace || !dirExists(root)) {
      if (workspace) {
        await db.query('DELETE FROM developer_builder_workspaces WHERE id = ?', [workspace.id]);
        req.flash('error_msg', 'This project’s builder files were not found on the server. Pick a template to start again.');
      }
      return renderTemplatePicker(req, res, project);
    }

    await db.query(
      'UPDATE developer_builder_workspaces SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?',
      [workspace.id]
    );

    const [tree, usage] = await Promise.all([bfs.readTree(root), bfs.measure(root)]);

    res.render('developer/builder-ide', {
      title: `${project.name} — Builder`,
      developer: req.session.developer,
      project,
      workspace,
      tree,
      usage,
      limits: {
        maxFiles: bfs.MAX_WORKSPACE_FILES,
        maxBytes: bfs.MAX_WORKSPACE_BYTES,
        maxTextBytes: bfs.MAX_TEXT_FILE_BYTES,
        maxImageBytes: bfs.MAX_IMAGE_FILE_BYTES,
        extensions: [...bfs.ALLOWED_EXTENSIONS],
        protectedFile: bfs.PROTECTED_ROOT_FILE,
      },
    });
  } catch (err) {
    console.error('❌ builder page:', err.stack || err);
    req.flash('error_msg', 'Failed to open the builder.');
    res.redirect('/developer/builder');
  }
};

/** Renders the category → template chooser for a project with no workspace. */
async function renderTemplatePicker(req, res, project) {
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

  res.render('developer/builder-template', {
    title: `Choose a template — ${project.name}`,
    developer: req.session.developer,
    project,
    categories,
    templates,
  });
}

/**
 * Extracts a template into a project's workspace.
 *
 * Shared by the portal's form post below and the Studio app's JSON endpoint
 * (controllers/devapi/builderApi.js): both surfaces edit the same workspaces,
 * so the setup that creates one has to be the same code, not a second copy
 * that drifts. Throws a BuilderError carrying the message either surface
 * shows; the caller decides whether that becomes a flash or a JSON body.
 */
async function applyTemplate(developerId, project, templateIdRaw) {
  const templateId = Number.parseInt(templateIdRaw, 10);

  let tempZip = null;
  let root = null;
  let createdRoot = false;

  try {
    // One template per project: re-choosing would silently delete a workspace
    // the developer has been working in. Changing it is its own explicit,
    // confirmed action (clearWorkspace).
    const existing = await loadWorkspace(project.id);
    if (existing && dirExists(workspacePath(developerId, project.id))) {
      throw new BuilderError('This project already has a template. Open it from the builder.', 409);
    }
    if (existing) await db.query('DELETE FROM developer_builder_workspaces WHERE id = ?', [existing.id]);

    if (!Number.isInteger(templateId)) throw new BuilderError('Choose a template to continue.', 400);

    const [rows] = await db.query(
      `SELECT t.id, t.name, t.r2_key
         FROM builder_templates t
         JOIN builder_template_categories c ON c.id = t.category_id
        WHERE t.id = ? AND t.is_active = 1 AND c.is_active = 1`,
      [templateId]
    );
    if (!rows.length) throw new BuilderError('That template is no longer available.', 404);
    const template = rows[0];

    // Pull the archive down to a temp file. adm-zip needs random access to the
    // central directory, so it cannot read a stream.
    await fsp.mkdir(TEMP_DIR, { recursive: true });
    tempZip = path.join(TEMP_DIR, `builder-${crypto.randomBytes(8).toString('hex')}.zip`);
    const stream = await r2.downloadStream(template.r2_key);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tempZip);
      stream.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      stream.on('error', reject);
    });

    root = workspacePath(developerId, project.id);
    await fsp.mkdir(path.dirname(root), { recursive: true });
    // A leftover directory from a failed earlier attempt would merge into the
    // new template and produce a mongrel project.
    await fse.remove(root);
    createdRoot = true;

    await zipper.extractTo(tempZip, root);

    await db.query(
      `INSERT INTO developer_builder_workspaces
         (project_id, developer_id, template_id, template_name, rel_path, last_opened_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [project.id, developerId, template.id, template.name, bfs.workspaceRelPath(developerId, project.id)]
    );
    await db.query('UPDATE builder_templates SET use_count = use_count + 1 WHERE id = ?', [template.id]);

    return template;
  } catch (err) {
    // The files and the row go together: a half-extracted workspace with no
    // row is invisible to the developer and never cleaned up otherwise.
    if (createdRoot && root) await fse.remove(root).catch(() => {});
    if (err instanceof BuilderError) throw err;
    console.error('❌ builder template:', err.stack || err);
    throw new BuilderError('Failed to set up that template. Please try again.', 500);
  } finally {
    if (tempZip) await fse.remove(tempZip).catch(() => {});
  }
}

/** Deletes a project's workspace and every preview token pointing into it. */
async function clearWorkspace(developerId, projectId) {
  revokeTokensFor(projectId);
  await fse.remove(workspacePath(developerId, projectId)).catch(() => {});
  await db.query('DELETE FROM developer_builder_workspaces WHERE project_id = ?', [projectId]);
}

/**
 * POST /developer/builder/:project/template
 * Extracts the chosen template into this project's workspace.
 */
exports.postSelectTemplate = async (req, res) => {
  const developerId = devId(req);
  const back = (message) => {
    req.flash('error_msg', message);
    return res.redirect(`/developer/builder/${req.params.project}`);
  };

  try {
    const project = await ownedProject(req.params.project, developerId);
    if (!project) return back('Project not found.');

    const template = await applyTemplate(developerId, project, req.body.template_id);
    req.flash('success_msg', `"${template.name}" is ready — start building.`);
    res.redirect(`/developer/builder/${project.slug}`);
  } catch (err) {
    return back(err instanceof BuilderError ? err.message : 'Failed to set up that template. Please try again.');
  }
};

/**
 * POST /developer/builder/:project/reset
 * Deletes the workspace so a different template can be chosen. Destructive,
 * so it is gated on the developer typing the project name.
 */
exports.postResetWorkspace = async (req, res) => {
  const developerId = devId(req);
  try {
    const project = await ownedProject(req.params.project, developerId);
    if (!project) {
      req.flash('error_msg', 'Project not found.');
      return res.redirect('/developer/builder');
    }

    const confirm = String(req.body.confirm_name || '').trim();
    if (confirm.toLowerCase() !== project.name.trim().toLowerCase()) {
      req.flash('error_msg', 'The project name did not match — nothing was deleted.');
      return res.redirect(`/developer/builder/${project.slug}`);
    }

    await clearWorkspace(developerId, project.id);

    req.flash('success_msg', 'Workspace cleared. Choose a new template to start again.');
    res.redirect(`/developer/builder/${project.slug}`);
  } catch (err) {
    req.flash('error_msg', 'Failed to clear the workspace.');
    res.redirect('/developer/builder');
  }
};

// Shared with the Studio app's JSON surface.
exports.applyTemplate    = applyTemplate;
exports.clearWorkspace   = clearWorkspace;
exports.ownedProject     = ownedProject;
exports.loadWorkspace    = loadWorkspace;
exports.workspacePath    = workspacePath;
exports.dirExists        = dirExists;

// ── File JSON API ────────────────────────────────────────────────────────────

/** GET /developer/builder/:project/files — the whole tree plus quota usage. */
exports.listFiles = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  const [tree, usage] = await Promise.all([bfs.readTree(ctx.root), bfs.measure(ctx.root)]);
  res.json({ tree, usage });
});

/** GET /developer/builder/:project/file?path=… — one file's text. */
exports.readFile = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  res.json(await bfs.readTextFile(ctx.root, req.query.path));
});

/** PUT /developer/builder/:project/file — save. */
exports.saveFile = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  const saved = await bfs.writeTextFile(ctx.root, req.body.path, req.body.content);
  res.json({ ...saved, savedAt: new Date().toISOString() });
});

/** POST /developer/builder/:project/file — create an empty file. */
exports.createFile = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  const created = await bfs.createFile(ctx.root, req.body.parent, req.body.name);
  res.status(201).json({ path: created });
});

/** POST /developer/builder/:project/folder */
exports.createFolder = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  const created = await bfs.createFolder(ctx.root, req.body.parent, req.body.name);
  res.status(201).json({ path: created });
});

/** POST /developer/builder/:project/rename */
exports.renameEntry = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  const renamed = await bfs.renameEntry(ctx.root, req.body.path, req.body.name);
  res.json({ path: renamed });
});

/** DELETE /developer/builder/:project/entry?path=… */
exports.deleteEntry = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  const removed = await bfs.deleteEntry(ctx.root, req.query.path);
  res.json({ path: removed });
});

/** POST /developer/builder/:project/upload — drop an image into a folder. */
exports.uploadAsset = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;
  if (req.uploadError) throw new BuilderError(req.uploadError);
  if (!req.file) throw new BuilderError('Choose an image to upload.');

  const created = await bfs.writeBinaryFile(
    ctx.root, req.body.parent || '', req.file.originalname, req.file.buffer
  );
  res.status(201).json({ path: created });
});

/**
 * POST /developer/builder/:project/preview-token
 * Mints the grant the sandboxed preview frame loads under.
 */
exports.createPreviewToken = json(async (req, res) => {
  const ctx = await requireWorkspace(req, res);
  if (!ctx) return;

  // Nothing to preview without an entry point — say so here rather than
  // letting the iframe show a bare 404.
  const entry = path.join(ctx.root, bfs.PROTECTED_ROOT_FILE);
  try {
    if (!(await fsp.stat(entry)).isFile()) throw new Error('not a file');
  } catch (_) {
    throw new BuilderError(`${bfs.PROTECTED_ROOT_FILE} is missing from this project — create it to run the game.`);
  }

  const token = issuePreviewToken(ctx.developerId, ctx.project.id, ctx.root);
  res.json({ url: `/developer/builder-preview/${token}/`, expiresIn: PREVIEW_TTL_MS });
});

/** GET /developer/builder/:project/export — the whole workspace as a zip. */
exports.exportWorkspace = async (req, res) => {
  const developerId = devId(req);
  try {
    const project = await ownedProject(req.params.project, developerId);
    if (!project) {
      req.flash('error_msg', 'Project not found.');
      return res.redirect('/developer/builder');
    }
    const root = workspacePath(developerId, project.id);
    if (!(await loadWorkspace(project.id)) || !dirExists(root)) {
      req.flash('error_msg', 'This project has no builder files to download yet.');
      return res.redirect(`/developer/builder/${project.slug}`);
    }

    const buffer = zipper.packDirectory(root);
    // The slug is already [a-z0-9-] only, so it is safe in a header value.
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${project.slug}-build.zip"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('❌ builder export:', err.stack || err);
    req.flash('error_msg', 'Failed to package the project.');
    res.redirect('/developer/builder');
  }
};

// ── Preview server ───────────────────────────────────────────────────────────

/**
 * The console bridge, injected into every previewed HTML document.
 *
 * It runs inside the sandboxed frame, which has an opaque origin, so it can
 * only talk to the IDE by postMessage — and the IDE identifies it by
 * `event.source`, not by origin, because an opaque origin arrives as "null".
 *
 * Injected at the very top of <head> so a script that throws on line 1 of the
 * developer's own markup is still reported.
 */
const CONSOLE_BRIDGE = `<script>
(function () {
  var seq = 0;
  function send(level, parts) {
    try {
      parent.postMessage({
        __pmBuilderConsole: true,
        level: level,
        seq: ++seq,
        time: Date.now(),
        parts: parts
      }, '*');
    } catch (_) {}
  }
  function render(value, depth) {
    if (value instanceof Error) return value.stack || (value.name + ': ' + value.message);
    if (typeof value === 'string') return value;
    if (typeof value === 'function') return '[function ' + (value.name || 'anonymous') + ']';
    if (typeof value === 'undefined') return 'undefined';
    if (value === null) return 'null';
    if (typeof value !== 'object') return String(value);
    if (depth > 2) return Array.isArray(value) ? '[Array]' : '[Object]';
    try {
      var seen = new WeakSet();
      return JSON.stringify(value, function (key, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        if (typeof val === 'function') return '[function]';
        return val;
      }, 2);
    } catch (_) {
      return Object.prototype.toString.call(value);
    }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var parts = Array.prototype.map.call(arguments, function (a) { return render(a, 0); });
      send(level, parts);
      if (original) try { original.apply(console, arguments); } catch (_) {}
    };
  });
  window.addEventListener('error', function (e) {
    if (e.error) send('error', [e.error.stack || (e.error.name + ': ' + e.error.message)]);
    else send('error', [e.message + '  (' + (e.filename || 'inline') + ':' + e.lineno + ')']);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    send('error', ['Unhandled promise rejection: ' + render(reason, 0)]);
  });

  // A <script src>, <link> or <img> that 404s fires 'error' ON THE ELEMENT and
  // does NOT bubble, so the window-level handler above never sees it — a
  // mistyped path used to fail in total silence. Only the capture phase gets
  // these. (Script RUNTIME errors reach here too, but with target === window,
  // so they are left to the handler above and skipped here.)
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el === window || !el.tagName) return;
    var url = el.getAttribute('src') || el.getAttribute('href');
    if (!url) return;
    send('error', ['Failed to load <' + el.tagName.toLowerCase() + '> "' + url + '" \\u2014 check the path is relative to the file that references it.']);
  }, true);

  window.addEventListener('DOMContentLoaded', function () {
    send('info', ['\\u2713 Page loaded']);

    // A URL beginning with a single '/' resolves against the SITE root, not
    // the project — it leaves the preview entirely and Play Mist answers with
    // its own page, so it looks like a success (HTTP 200) while loading the
    // wrong thing. Nothing else would ever tell the developer.
    try {
      var flagged = [];
      var nodes = document.querySelectorAll('[src],[href]');
      for (var i = 0; i < nodes.length; i++) {
        var raw = nodes[i].getAttribute('src') || nodes[i].getAttribute('href') || '';
        // '//host/path' is protocol-relative and genuinely external: not this.
        if (raw.charAt(0) === '/' && raw.charAt(1) !== '/') {
          flagged.push('<' + nodes[i].tagName.toLowerCase() + '> "' + raw + '"');
        }
      }
      if (flagged.length) {
        send('warn', ['These paths start with "/" so they point at the Play Mist site root, not your project. Drop the leading slash to make them relative: ' + flagged.join(', ')]);
      }
    } catch (_) {}
  });
})();
</script>`;

/**
 * Puts the bridge first inside <head> — or first in the document when the
 * markup has no head at all, which a hand-written game page often does not.
 */
function injectBridge(html) {
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + '\n' + CONSOLE_BRIDGE + html.slice(at);
  }
  const htmlOpen = html.match(/<html[^>]*>/i);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + '\n' + CONSOLE_BRIDGE + html.slice(at);
  }
  return CONSOLE_BRIDGE + '\n' + html;
}

/**
 * GET /developer/builder-preview/:token/*
 *
 * Mounted before the session gate on purpose — see the note at the top of this
 * file. The token is the whole authorisation, and it only ever names one
 * workspace directory.
 */
exports.servePreview = async (req, res) => {
  // ⚠ Set before anything can return: helmet sets X-Frame-Options: SAMEORIGIN
  // app-wide. The website's IDE is same-origin with this route so it never
  // noticed, but the Studio app embeds the preview from https://localhost
  // while the backend is somewhere else entirely — a different origin, so the
  // frame was refused and the developer got a blank box while the server
  // logged a cheerful 200.
  //
  // X-Frame-Options has no syntax for "these origins", so it is replaced
  // rather than extended, with a frame-ancestors list naming the portal and
  // the app's WebView origins. Safe on this route alone: the token is the
  // authorisation, the frame is sandboxed without allow-same-origin, and the
  // bytes are the developer's own files with no session behind them. It covers
  // the error responses too — an "expired link" message nobody is allowed to
  // render is just a blank box with extra steps.
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://localhost http://localhost capacitor://localhost"
  );

  const grant = readPreviewToken(req.params.token);
  if (!grant) {
    return res.status(403)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#555">'
          + 'This preview link has expired. Press <b>Run</b> in the builder again.</body>');
  }

  // Everything after the token is the path inside the workspace. Express gives
  // it to us already percent-decoded on req.params[0] — so '%2e%2e%2f' arrives
  // as '../' and still has to clear resolveForPreview's traversal check.
  const requested = req.params[0] || '';

  // The entry point must be addressed WITH a trailing slash: relative URLs in
  // the game ('game.js', 'img/a.png') resolve against the directory, and
  // without it they would resolve a level too high and 404. Strict routing is
  // off, so the two shapes cannot be told apart by route — only by the raw URL.
  if (!requested) {
    const rawPath = req.originalUrl.split('?')[0];
    if (!rawPath.endsWith('/')) {
      const query = req.originalUrl.slice(rawPath.length);
      return res.redirect(302, rawPath + '/' + query);
    }
  }
  const target = await bfs.resolveForPreview(grant.rootDir, requested);

  if (!target) {
    return res.status(404)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#555">'
          + `Not found: <code>${String(requested).replace(/[<>&]/g, '')}</code></body>`);
  }

  // The preview is a live view of files being edited — never cache it, or a
  // developer saves a change and reruns into the previous version.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // ⚠ Required, not optional. helmet sets Cross-Origin-Resource-Policy:
  // same-origin for the whole app, and the preview frame is sandboxed WITHOUT
  // allow-same-origin — so it has an opaque origin and every subresource it
  // asks for counts as cross-origin. With the app-wide default the browser
  // silently discarded each one: the server logged 200 for game.js, style.css
  // and every image, and the frame ran nothing but inline <script>. Relaxing
  // it here is safe because the token already authorises the read and the
  // bytes are the developer's own files; it applies to this route alone.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const ext = bfs.extOf(target.rel);
  if (ext === 'html' || ext === 'htm') {
    const html = await fsp.readFile(target.abs, 'utf8');
    res.type('text/html; charset=utf-8').send(injectBridge(html));
    return;
  }

  res.type(target.mime);
  fs.createReadStream(target.abs).pipe(res);
};
