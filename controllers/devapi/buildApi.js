/**
 * controllers/devapi/buildApi.js — a project's playable build.
 *
 * A project's build comes from one of two places:
 *
 *   'editor' — the Game Builder workspace, edited in the app or on the website
 *   'upload' — a zip the developer exported from a real engine
 *
 * The second exists because the in-app editor is for hand-written HTML5, and
 * that is not how most games get made: Godot exports a web build from a phone,
 * Unity and Construct export one from a laptop. Without this, the Test Lab
 * could only test games written inside the Test Lab's own editor — which is
 * the smallest and least interesting class of build it could possibly check.
 *
 * An upload is validated against utils/gameBuild (the same rules the website's
 * submission form enforces) and extracted to a directory; from there the Test
 * Lab and the submission flow treat it exactly like a workspace, because by
 * then it is just a directory with an index.html at its root.
 */
const path = require('path');
const fs   = require('fs');
const fse  = require('fs-extra');
const db   = require('../../config/database');
const gameBuild = require('../../utils/gameBuild');
const builder   = require('../developer/builderController');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'dev-builds');

/** Where an uploaded build is extracted. Ids only — never developer-supplied text. */
const uploadDir = (developerId, projectId) =>
  path.join(UPLOAD_ROOT, String(developerId), String(projectId));

const dirHasEntry = (dir) => {
  try { return fs.statSync(path.join(dir, gameBuild.ENTRY_POINT)).isFile(); } catch (_) { return false; }
};

/**
 * The directory a test run serves and a submission packs, for either source.
 * Everything downstream of this function is source-agnostic — which is the
 * point: one launch path, one submission path, two ways to fill a folder.
 */
function resolveBuildRoot(project, developerId) {
  if (project.build_source === 'upload') {
    const dir = uploadDir(developerId, project.id);
    return dirHasEntry(dir) ? dir : null;
  }
  const dir = builder.workspacePath(developerId, project.id);
  return builder.dirExists(dir) && dirHasEntry(dir) ? dir : null;
}

/** Why there is nothing to run, phrased for the source the project is set to. */
function missingBuildError(project) {
  return project.build_source === 'upload'
    ? 'This project has no uploaded build yet — upload a zip with index.html at its root.'
    : 'This project has no playable build yet. Pick a template in the editor and make sure index.html exists at the root.';
}

// ── GET /projects/:project/build ─────────────────────────────────────────────
exports.getBuild = async (req, res) => {
  const developerId = req.session.developer.id;
  try {
    const project = await builder.ownedProject(req.params.project, developerId, 'id, slug, name, build_source, upload_filename, upload_size, upload_files, uploaded_at');
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const workspaceDir = builder.workspacePath(developerId, project.id);
    const uploaded     = uploadDir(developerId, project.id);

    res.json({
      buildSource: project.build_source || 'editor',
      editor: {
        available: builder.dirExists(workspaceDir) && dirHasEntry(workspaceDir),
        ...(builder.dirExists(workspaceDir) ? gameBuild.measure(workspaceDir) : { files: 0, bytes: 0 }),
      },
      upload: dirHasEntry(uploaded) ? {
        available: true,
        filename: project.upload_filename,
        zipBytes: project.upload_size,
        files:    project.upload_files,
        uploadedAt: project.uploaded_at,
        ...gameBuild.measure(uploaded),
      } : { available: false },
      // The app shows these verbatim rather than restating them, so the rules
      // a developer reads are the rules the server actually applies.
      rules: {
        maxZipBytes:          gameBuild.MAX_ZIP_BYTES,
        maxUncompressedBytes: gameBuild.MAX_UNCOMPRESSED_BYTES,
        entryPoint:           gameBuild.ENTRY_POINT,
        allowedExtensions:    [...gameBuild.ALLOWED_EXTENSIONS],
      },
    });
  } catch (err) {
    console.error('devapi getBuild error:', err);
    res.status(500).json({ error: 'Failed to load build info.' });
  }
};

// ── POST /projects/:project/build/upload  (multipart: build=<zip>) ───────────
exports.uploadBuild = async (req, res) => {
  const developerId = req.session.developer.id;

  // multer's own rejection (too large, not a zip) is reported before anything
  // else — there is nothing to validate without the file.
  if (req.uploadError) return res.status(400).json({ error: req.uploadError });
  if (!req.file) return res.status(400).json({ error: 'A ZIP file is required.' });

  const zipPath = req.file.path;
  let target = null;
  let backup = null;

  try {
    const project = await builder.ownedProject(req.params.project, developerId, 'id, slug, name, build_source');
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    // The same validation the website's submission form runs, on the same
    // code — allowlist, 1 GB uncompressed ceiling, path traversal, and
    // index.html at the root. A build rejected here would have been rejected
    // at submission, so the developer finds out now rather than after filling
    // in a store listing.
    try {
      gameBuild.validateZip(zipPath);
    } catch (err) {
      return res.status(400).json({ error: err.message, rejectedByRules: true });
    }

    target = uploadDir(developerId, project.id);

    // Replace atomically-ish: the previous build is moved aside and only
    // deleted once the new one is extracted, so a zip that fails halfway
    // leaves the developer with the build they had rather than nothing.
    if (fs.existsSync(target)) {
      backup = `${target}.previous-${Date.now()}`;
      await fse.move(target, backup);
    }

    const files = await gameBuild.extractTo(zipPath, target);

    await db.query(
      `UPDATE developer_projects
       SET build_source = 'upload', upload_filename = ?, upload_size = ?, upload_files = ?, uploaded_at = NOW()
       WHERE id = ? AND developer_id = ?`,
      [req.file.originalname?.slice(0, 255) || 'build.zip', req.file.size, files, project.id, developerId]
    );

    if (backup) await fse.remove(backup).catch(() => {});

    const { bytes } = gameBuild.measure(target);
    res.status(201).json({
      buildSource: 'upload',
      upload: {
        available: true,
        filename: req.file.originalname,
        zipBytes: req.file.size,
        files,
        bytes,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Put the old build back before reporting failure.
    if (backup) {
      await fse.remove(target).catch(() => {});
      await fse.move(backup, target).catch(() => {});
    }
    console.error('devapi uploadBuild error:', err.stack || err);
    res.status(500).json({ error: 'Could not unpack that build. Please try again.' });
  } finally {
    await fse.remove(zipPath).catch(() => {});
  }
};

// ── PUT /projects/:project/build/source   { buildSource } ────────────────────
exports.setSource = async (req, res) => {
  const developerId = req.session.developer.id;
  const source = req.body?.buildSource === 'upload' ? 'upload' : 'editor';
  try {
    const project = await builder.ownedProject(req.params.project, developerId, 'id, slug, name, build_source');
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    if (source === 'upload' && !dirHasEntry(uploadDir(developerId, project.id))) {
      return res.status(409).json({ error: 'There is no uploaded build to switch to yet.' });
    }
    await db.query('UPDATE developer_projects SET build_source = ? WHERE id = ? AND developer_id = ?',
      [source, project.id, developerId]);
    res.json({ buildSource: source });
  } catch (err) {
    console.error('devapi setSource error:', err);
    res.status(500).json({ error: 'Failed to switch build source.' });
  }
};

// ── DELETE /projects/:project/build/upload ───────────────────────────────────
exports.deleteUpload = async (req, res) => {
  const developerId = req.session.developer.id;
  try {
    const project = await builder.ownedProject(req.params.project, developerId, 'id, slug, name, build_source');
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    await fse.remove(uploadDir(developerId, project.id)).catch(() => {});
    await db.query(
      `UPDATE developer_projects
       SET build_source = 'editor', upload_filename = NULL, upload_size = NULL,
           upload_files = NULL, uploaded_at = NULL
       WHERE id = ? AND developer_id = ?`,
      [project.id, developerId]
    );
    res.json({ ok: true, buildSource: 'editor' });
  } catch (err) {
    console.error('devapi deleteUpload error:', err);
    res.status(500).json({ error: 'Failed to remove the uploaded build.' });
  }
};

exports.resolveBuildRoot   = resolveBuildRoot;
exports.missingBuildError  = missingBuildError;
exports.uploadDir          = uploadDir;
