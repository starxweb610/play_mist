/**
 * utils/builderFs.js
 * The filesystem layer under the in-browser Game Builder.
 *
 * Every path that arrives from a developer's browser is resolved through
 * `resolve()` before anything touches the disk. That function is the single
 * trust boundary in this feature: a workspace holds attacker-controlled file
 * NAMES as well as attacker-controlled file CONTENT, so a path that escapes
 * its root reads or overwrites the server's own source.
 *
 * Two escapes are guarded separately because they defeat different checks:
 *   - `../` traversal   — caught by normalising and rejecting a leading '..'
 *   - symlink traversal — a normalised path can sit inside the root while the
 *                         inode it names does not. Only realpath() sees that,
 *                         so every resolve re-checks the real path of whatever
 *                         already exists. (Extraction never writes symlinks,
 *                         but a future import path might.)
 */
const path = require('path');
const fs   = require('fs');
const fsp  = require('fs/promises');

const BUILDER_ROOT = path.join(__dirname, '..', 'uploads', 'builder');

// ── What a developer may keep in a workspace ─────────────────────────────────
// Deliberately narrower than the store-submission allowlist: this is a source
// tree being edited in a browser, not a finished Unity build.
const TEXT_EXTENSIONS = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS]);

// The entry point the "Run" button always targets. It may be edited, never
// renamed or deleted — a workspace without it has nothing to preview.
const PROTECTED_ROOT_FILE = 'index.html';

// ── Limits ───────────────────────────────────────────────────────────────────
const MAX_TEXT_FILE_BYTES  = 2 * 1024 * 1024;    // 2 MB — the editor has to hold it
const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;    // 5 MB
const MAX_WORKSPACE_BYTES  = 100 * 1024 * 1024;  // 100 MB per project
const MAX_WORKSPACE_FILES  = 500;
const MAX_DEPTH            = 12;
const MAX_NAME_LENGTH      = 120;

/** MIME types for previewing a workspace file. */
const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  htm:  'text/html; charset=utf-8',
  css:  'text/css; charset=utf-8',
  js:   'text/javascript; charset=utf-8',
  mjs:  'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt:  'text/plain; charset=utf-8',
  md:   'text/markdown; charset=utf-8',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  svg:  'image/svg+xml',
  ico:  'image/x-icon',
};

/** The CodeMirror mode each editable extension opens in. */
const EDITOR_MODES = {
  html: 'htmlmixed', htm: 'htmlmixed',
  css:  'css',
  js:   'javascript', mjs: 'javascript', json: 'application/json',
  md:   'markdown',
  txt:  'null',
  svg:  'xml',
};

/** A caller-facing failure. The controllers turn these into 400s. */
class BuilderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BuilderError';
    this.status = status;
  }
}

const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();

const isTextFile  = (name) => TEXT_EXTENSIONS.has(extOf(name));
const isImageFile = (name) => IMAGE_EXTENSIONS.has(extOf(name));
const isAllowed   = (name) => ALLOWED_EXTENSIONS.has(extOf(name));

const mimeFor = (name) => MIME_TYPES[extOf(name)] || 'application/octet-stream';
const modeFor = (name) => EDITOR_MODES[extOf(name)] || 'null';

const maxBytesFor = (name) => (isImageFile(name) ? MAX_IMAGE_FILE_BYTES : MAX_TEXT_FILE_BYTES);

// ── Names ────────────────────────────────────────────────────────────────────

// Windows reserved device names. A developer on macOS can happily create
// `aux.html`; the same workspace exported and unzipped on Windows cannot.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Validates one path SEGMENT (never a path — no separators allowed).
 * Returns the clean name or throws.
 */
function cleanSegment(raw, { kind = 'file' } = {}) {
  const name = String(raw ?? '').trim();

  if (!name)                       throw new BuilderError(`A ${kind} name is required.`);
  if (name.length > MAX_NAME_LENGTH) throw new BuilderError(`That ${kind} name is too long (max ${MAX_NAME_LENGTH} characters).`);
  if (name === '.' || name === '..') throw new BuilderError(`"${name}" is not a valid ${kind} name.`);
  if (/[/\\]/.test(name))          throw new BuilderError(`A ${kind} name cannot contain slashes.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new BuilderError(`That ${kind} name contains invalid characters.`);
  if (/[<>:"|?*]/.test(name))      throw new BuilderError(`A ${kind} name cannot contain < > : " | ? *`);
  if (name.startsWith('.'))        throw new BuilderError(`A ${kind} name cannot start with a dot.`);
  if (name.endsWith('.') || name.endsWith(' ')) throw new BuilderError(`A ${kind} name cannot end with a dot or a space.`);
  if (RESERVED_NAMES.test(name))   throw new BuilderError(`"${name}" is a reserved name on Windows — pick another.`);

  if (kind === 'file' && !isAllowed(name)) {
    throw new BuilderError(
      `Only ${[...ALLOWED_EXTENSIONS].join(', ')} files are allowed — "${name}" is not one of them.`
    );
  }
  return name;
}

/**
 * Normalises a workspace-relative path to POSIX form with no leading slash.
 * '' means the workspace root.
 */
function normalizeRel(raw) {
  const asPosix = String(raw ?? '').replace(/\\/g, '/');
  const joined  = path.posix.normalize(asPosix).replace(/^\/+/, '').replace(/\/+$/, '');
  if (joined === '.' || joined === '') return '';
  return joined;
}

// ── The trust boundary ───────────────────────────────────────────────────────

/**
 * Resolves a developer-supplied relative path inside `root` to an absolute
 * path, or throws. Nothing in this module writes to a path it did not get
 * back from here.
 */
function resolve(root, relPath) {
  // Absoluteness is judged on the RAW input, before normalising: normalizeRel
  // strips a leading slash, so '/etc/passwd' would arrive here as the harmless
  // -looking 'etc/passwd' and quietly resolve to a file inside the workspace.
  // Contained, but not what the caller asked for — reject it by name instead.
  const raw = String(relPath ?? '').replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw new BuilderError('That path is outside the project.', 403);
  }

  const rel = normalizeRel(relPath);

  // Reject before touching the filesystem: anything that normalised its way
  // out of the tree.
  if (rel.startsWith('..') || rel.split('/').includes('..')) {
    throw new BuilderError('That path is outside the project.', 403);
  }
  if (rel && rel.split('/').length > MAX_DEPTH) {
    throw new BuilderError(`Folders can only be nested ${MAX_DEPTH} levels deep.`);
  }

  const absRoot = path.resolve(root);
  const abs     = path.resolve(absRoot, rel);

  // String containment catches traversal; the separator stops '/a/workspace2'
  // passing as a child of '/a/workspace'.
  if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
    throw new BuilderError('That path is outside the project.', 403);
  }

  // A normalised path can still name a symlink pointing anywhere on the disk.
  // realpath() only works on something that exists, so walk up to the nearest
  // existing ancestor and check that instead.
  let probe = abs;
  while (probe !== absRoot && !fs.existsSync(probe)) probe = path.dirname(probe);
  try {
    const realProbe = fs.realpathSync(probe);
    const realRoot  = fs.realpathSync(absRoot);
    if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
      throw new BuilderError('That path is outside the project.', 403);
    }
  } catch (err) {
    if (err instanceof BuilderError) throw err;
    // The root itself is missing — the caller reports a broken workspace.
  }

  return { abs, rel };
}

// ── Workspace location ───────────────────────────────────────────────────────

/** Workspace path relative to uploads/builder, as stored in the database. */
const workspaceRelPath = (developerId, projectId) => `${developerId}/${projectId}`;

/** Absolute path of a workspace on this machine. */
const workspaceDir = (developerId, projectId) =>
  path.join(BUILDER_ROOT, String(developerId), String(projectId));

// ── Reading the tree ─────────────────────────────────────────────────────────

/**
 * Recursively lists a workspace as a nested tree the file explorer renders
 * directly. Folders sort before files, both alphabetically, so the panel has a
 * stable order across reloads regardless of what the filesystem returns.
 */
async function readTree(root) {
  async function walk(absDir, relDir, depth) {
    if (depth > MAX_DEPTH) return [];
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch (_) {
      return [];
    }

    const nodes = [];
    for (const entry of entries) {
      // Hidden files and macOS metadata are never shown or served — a
      // developer cannot create them either (cleanSegment rejects a dot).
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      if (entry.isSymbolicLink()) continue;

      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: rel, type: 'dir', children: await walk(abs, rel, depth + 1) });
      } else if (entry.isFile() && isAllowed(entry.name)) {
        let size = 0;
        try { size = (await fsp.stat(abs)).size; } catch (_) {}
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'file',
          size,
          editable: isTextFile(entry.name),
          image: isImageFile(entry.name),
          mode: modeFor(entry.name),
          protected: rel === PROTECTED_ROOT_FILE,
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
    });
    return nodes;
  }

  return walk(path.resolve(root), '', 0);
}

/** Running totals used to enforce the per-workspace quota. */
async function measure(root) {
  let files = 0;
  let bytes = 0;
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs, depth + 1);
      else if (entry.isFile()) {
        files += 1;
        try { bytes += (await fsp.stat(abs)).size; } catch (_) {}
      }
    }
  }
  await walk(path.resolve(root), 0);
  return { files, bytes };
}

/**
 * Throws when writing `incomingBytes` more would break the workspace quota.
 * `replacingBytes` is the size of the file being overwritten, which is freed
 * by the same write — without it, saving a large file repeatedly would count
 * its own size again on every save.
 */
async function assertQuota(root, incomingBytes, { replacingBytes = 0, newFile = false } = {}) {
  const { files, bytes } = await measure(root);
  if (newFile && files >= MAX_WORKSPACE_FILES) {
    throw new BuilderError(`This project has reached the limit of ${MAX_WORKSPACE_FILES} files.`);
  }
  if (bytes - replacingBytes + incomingBytes > MAX_WORKSPACE_BYTES) {
    throw new BuilderError(
      `This project would exceed its ${Math.round(MAX_WORKSPACE_BYTES / (1024 * 1024))} MB storage limit.`
    );
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

async function exists(abs) {
  try { await fsp.access(abs); return true; } catch (_) { return false; }
}

/** Creates an empty file. Fails when something is already there. */
async function createFile(root, parentRel, rawName) {
  const name = cleanSegment(rawName, { kind: 'file' });
  const { abs: parentAbs } = resolve(root, parentRel);
  if (!(await exists(parentAbs))) throw new BuilderError('That folder no longer exists.', 404);

  const rel = parentRel ? `${normalizeRel(parentRel)}/${name}` : name;
  const { abs } = resolve(root, rel);
  if (await exists(abs)) throw new BuilderError(`"${name}" already exists here.`, 409);

  await assertQuota(root, 0, { newFile: true });
  // 'wx' fails rather than truncating, closing the gap between the check above
  // and the write when two tabs create the same name at once.
  await fsp.writeFile(abs, '', { flag: 'wx' });
  return rel;
}

async function createFolder(root, parentRel, rawName) {
  const name = cleanSegment(rawName, { kind: 'folder' });
  const { abs: parentAbs } = resolve(root, parentRel);
  if (!(await exists(parentAbs))) throw new BuilderError('That folder no longer exists.', 404);

  const rel = parentRel ? `${normalizeRel(parentRel)}/${name}` : name;
  const { abs } = resolve(root, rel);
  if (await exists(abs)) throw new BuilderError(`"${name}" already exists here.`, 409);

  await fsp.mkdir(abs);
  return rel;
}

/** Reads a text file for the editor. */
async function readTextFile(root, relPath) {
  const { abs, rel } = resolve(root, relPath);
  if (!isTextFile(rel)) throw new BuilderError('That file cannot be opened in the editor.');

  let stat;
  try { stat = await fsp.stat(abs); } catch (_) { throw new BuilderError('That file no longer exists.', 404); }
  if (!stat.isFile()) throw new BuilderError('That is not a file.', 400);
  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new BuilderError(`That file is too large to edit (over ${Math.round(MAX_TEXT_FILE_BYTES / (1024 * 1024))} MB).`);
  }

  return {
    path: rel,
    content: await fsp.readFile(abs, 'utf8'),
    size: stat.size,
    mode: modeFor(rel),
    protected: rel === PROTECTED_ROOT_FILE,
  };
}

async function writeTextFile(root, relPath, content) {
  const { abs, rel } = resolve(root, relPath);
  if (!isTextFile(rel)) throw new BuilderError('That file cannot be edited.');

  let stat = null;
  try { stat = await fsp.stat(abs); } catch (_) {}
  if (!stat) throw new BuilderError('That file no longer exists.', 404);
  if (!stat.isFile()) throw new BuilderError('That is not a file.', 400);

  const body  = String(content ?? '');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_TEXT_FILE_BYTES) {
    throw new BuilderError(`That file is too large to save (over ${Math.round(MAX_TEXT_FILE_BYTES / (1024 * 1024))} MB).`);
  }
  await assertQuota(root, bytes, { replacingBytes: stat.size });

  await fsp.writeFile(abs, body, 'utf8');
  return { path: rel, size: bytes };
}

/** Writes an uploaded image. Overwrites an existing file of the same name. */
async function writeBinaryFile(root, parentRel, rawName, buffer) {
  const name = cleanSegment(rawName, { kind: 'file' });
  if (!isImageFile(name)) throw new BuilderError('Only image files can be uploaded here.');
  if (buffer.length > MAX_IMAGE_FILE_BYTES) {
    throw new BuilderError(`That image is too large (over ${Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))} MB).`);
  }

  const { abs: parentAbs } = resolve(root, parentRel);
  if (!(await exists(parentAbs))) throw new BuilderError('That folder no longer exists.', 404);

  const rel = parentRel ? `${normalizeRel(parentRel)}/${name}` : name;
  const { abs } = resolve(root, rel);

  let replacing = 0;
  let isNew = true;
  try {
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) throw new BuilderError(`"${name}" is a folder.`, 409);
    replacing = stat.size;
    isNew = false;
  } catch (err) {
    if (err instanceof BuilderError) throw err;
  }

  await assertQuota(root, buffer.length, { replacingBytes: replacing, newFile: isNew });
  await fsp.writeFile(abs, buffer);
  return rel;
}

/** Renames a file or folder in place — the parent never changes. */
async function renameEntry(root, relPath, rawName) {
  const { abs, rel } = resolve(root, relPath);
  if (!rel) throw new BuilderError('The project root cannot be renamed.');
  if (rel === PROTECTED_ROOT_FILE) {
    throw new BuilderError('index.html is the project entry point and cannot be renamed.');
  }

  let stat;
  try { stat = await fsp.stat(abs); } catch (_) { throw new BuilderError('That item no longer exists.', 404); }

  const kind = stat.isDirectory() ? 'folder' : 'file';
  const name = cleanSegment(rawName, { kind });
  // Renaming a file to a different extension changes what it IS — an .html
  // renamed to .png would be served as an image and stop opening in the
  // editor. cleanSegment already rejects a disallowed extension; this keeps
  // the two sides of the rename consistent.
  if (kind === 'file' && extOf(name) !== extOf(rel)) {
    throw new BuilderError(`A file's type cannot change on rename — keep the .${extOf(rel)} extension.`);
  }

  const parentRel = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
  const nextRel   = parentRel ? `${parentRel}/${name}` : name;
  const { abs: nextAbs } = resolve(root, nextRel);

  if (nextRel === rel) return rel;
  // A case-only rename ('logo.png' → 'Logo.png') collides with itself on the
  // case-insensitive filesystems macOS and Windows default to, so the exists()
  // check has to let that one case through.
  if (nextRel.toLowerCase() !== rel.toLowerCase() && await exists(nextAbs)) {
    throw new BuilderError(`"${name}" already exists here.`, 409);
  }

  await fsp.rename(abs, nextAbs);
  return nextRel;
}

/** Deletes a file, or a folder and everything under it. */
async function deleteEntry(root, relPath) {
  const { abs, rel } = resolve(root, relPath);
  if (!rel) throw new BuilderError('The project root cannot be deleted.');
  if (rel === PROTECTED_ROOT_FILE) {
    throw new BuilderError('index.html is the project entry point and cannot be deleted.');
  }

  let stat;
  try { stat = await fsp.stat(abs); } catch (_) { throw new BuilderError('That item no longer exists.', 404); }

  // Deleting a folder takes index.html with it when it lives inside — and the
  // only folder that can is the root, which is already refused above. A
  // root-level folder can never contain the root index.html, so no extra
  // check is needed here.
  if (stat.isDirectory()) await fsp.rm(abs, { recursive: true, force: true });
  else                    await fsp.unlink(abs);

  return rel;
}

/** Resolves a path for the preview server. Returns null when unservable. */
async function resolveForPreview(root, relPath) {
  let resolved;
  try { resolved = resolve(root, relPath); } catch (_) { return null; }

  const { abs, rel } = resolved;
  if (rel && !isAllowed(rel)) return null;

  let stat;
  try { stat = await fsp.stat(abs); } catch (_) { return null; }

  // A directory URL serves its index.html, the way a static host would.
  if (stat.isDirectory()) {
    const indexRel = rel ? `${rel}/index.html` : 'index.html';
    const { abs: indexAbs } = resolve(root, indexRel);
    try {
      const indexStat = await fsp.stat(indexAbs);
      if (!indexStat.isFile()) return null;
      return { abs: indexAbs, rel: indexRel, size: indexStat.size, mime: mimeFor(indexRel) };
    } catch (_) { return null; }
  }

  if (!stat.isFile()) return null;
  return { abs, rel, size: stat.size, mime: mimeFor(rel) };
}

module.exports = {
  BuilderError,
  BUILDER_ROOT,
  ALLOWED_EXTENSIONS,
  TEXT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PROTECTED_ROOT_FILE,
  MAX_TEXT_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_FILES,
  extOf,
  isTextFile,
  isImageFile,
  isAllowed,
  mimeFor,
  modeFor,
  maxBytesFor,
  cleanSegment,
  normalizeRel,
  resolve,
  workspaceDir,
  workspaceRelPath,
  readTree,
  measure,
  assertQuota,
  createFile,
  createFolder,
  readTextFile,
  writeTextFile,
  writeBinaryFile,
  renameEntry,
  deleteEntry,
  resolveForPreview,
};
