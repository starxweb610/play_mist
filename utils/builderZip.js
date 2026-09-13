/**
 * utils/builderZip.js
 * Validating, extracting and re-packing Game Builder template ZIPs.
 *
 * A template zip is uploaded once by an admin and extracted many times, into
 * a different developer's workspace each time. It is therefore validated at
 * UPLOAD time — an admin sees the error immediately, and no developer ever
 * meets a broken template. Extraction re-checks the same rules anyway, because
 * the bytes have made a round trip through R2 in between.
 */
const AdmZip = require('adm-zip');
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');

const {
  isAllowed, extOf, ALLOWED_EXTENSIONS, PROTECTED_ROOT_FILE,
  MAX_WORKSPACE_BYTES, MAX_WORKSPACE_FILES, BuilderError,
} = require('./builderFs');

// A template is a starting point, not a shipped build — well under the
// workspace quota so a developer has room to work after extracting it.
const MAX_ZIP_BYTES          = 50 * 1024 * 1024;  // the upload itself
const MAX_UNCOMPRESSED_BYTES = MAX_WORKSPACE_BYTES;
const MAX_ENTRIES            = MAX_WORKSPACE_FILES;

/** macOS zips carry a metadata sidecar that is never part of the template. */
const isJunk = (name) =>
  name.startsWith('__MACOSX/') ||
  name.split('/').some((part) => part.startsWith('._')) ||
  name.split('/').includes('.DS_Store');

/** Entry names come out of adm-zip with whatever separator the zipper used. */
const posix = (name) => String(name || '').replace(/\\/g, '/');

/**
 * Most people zip a FOLDER rather than its contents, so every entry arrives
 * prefixed with `my-template/`. Extracting that verbatim buries index.html one
 * level down, where the preview server will not find it. When every entry
 * shares one top-level directory, that directory is stripped.
 *
 * Returns '' when there is nothing to strip.
 */
function detectWrapperDir(names) {
  const tops = new Set();
  for (const name of names) {
    const top = name.split('/')[0];
    if (!top) continue;
    tops.add(top);
    if (tops.size > 1) return '';
  }
  if (tops.size !== 1) return '';

  const [top] = tops;
  // Only a real directory can be stripped: a zip holding the single file
  // `index.html` has one "top" that must stay exactly where it is.
  const isDirectory = names.some((name) => name.startsWith(`${top}/`));
  return isDirectory ? top : '';
}

/**
 * Reads a zip and reports what it contains, or throws a BuilderError naming
 * the first problem. Used by both the admin upload and every extraction.
 */
function inspect(zipPath) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (_) {
    throw new BuilderError('That file could not be read as a ZIP archive.');
  }

  let entries;
  try {
    entries = zip.getEntries();
  } catch (_) {
    throw new BuilderError('That ZIP archive is corrupt.');
  }
  if (!entries.length) throw new BuilderError('That ZIP archive is empty.');

  const names = entries.map((e) => posix(e.entryName)).filter((n) => !isJunk(n));
  if (!names.length) throw new BuilderError('That ZIP contains nothing but macOS metadata.');

  const wrapper = detectWrapperDir(names);
  const strip   = (name) => (wrapper && name.startsWith(`${wrapper}/`) ? name.slice(wrapper.length + 1) : name);

  let totalBytes = 0;
  let fileCount  = 0;
  let hasIndex   = false;
  const files    = [];

  for (const entry of entries) {
    const raw = posix(entry.entryName);
    if (isJunk(raw)) continue;

    // Traversal guard. adm-zip hands back whatever the archive claims, so a
    // hostile zip can name '../../server.js'. Checked before the name is used
    // for anything at all.
    if (path.posix.normalize(raw).startsWith('..') || path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
      throw new BuilderError('That ZIP contains entries pointing outside the archive.');
    }

    const rel = strip(raw);
    if (!rel) continue;                      // the wrapper directory itself
    if (entry.isDirectory) continue;

    fileCount += 1;
    if (fileCount > MAX_ENTRIES) {
      throw new BuilderError(`A template may contain at most ${MAX_ENTRIES} files.`);
    }

    // header.size is the DECLARED uncompressed size. It is what a zip bomb
    // lies about, so it is also the cheapest place to catch one — the check
    // runs before a single byte is inflated.
    totalBytes += entry.header.size;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new BuilderError(
        `That ZIP expands to more than ${Math.round(MAX_UNCOMPRESSED_BYTES / (1024 * 1024))} MB. Suspected zip bomb.`
      );
    }

    if (!isAllowed(rel)) {
      const ext = extOf(rel) || 'unknown';
      throw new BuilderError(
        `"${rel}" is a .${ext} file. Templates may only contain: ${[...ALLOWED_EXTENSIONS].join(', ')}.`
      );
    }

    if (rel === PROTECTED_ROOT_FILE) hasIndex = true;
    files.push({ entry, rel });
  }

  if (!fileCount)  throw new BuilderError('That ZIP contains no usable files.');
  if (!hasIndex)   throw new BuilderError('A template must contain index.html at its root.');

  return { zip, files, fileCount, totalBytes, wrapper };
}

/** Validates without extracting — the admin upload path. */
function validate(zipPath) {
  const { fileCount, totalBytes } = inspect(zipPath);
  return { fileCount, totalBytes };
}

/**
 * Extracts a template into `targetDir`, which must not already exist or must
 * be empty. Entries are written one at a time through an explicit path check
 * rather than adm-zip's own extractAllTo, which has historically been lenient
 * about traversal.
 */
async function extractTo(zipPath, targetDir) {
  const { files } = inspect(zipPath);

  const absTarget = path.resolve(targetDir);
  await fsp.mkdir(absTarget, { recursive: true });

  for (const { entry, rel } of files) {
    const abs = path.resolve(absTarget, rel);
    if (abs !== absTarget && !abs.startsWith(absTarget + path.sep)) {
      throw new BuilderError('That ZIP contains entries pointing outside the archive.');
    }

    await fsp.mkdir(path.dirname(abs), { recursive: true });

    let data;
    try {
      data = entry.getData();
    } catch (_) {
      throw new BuilderError(`"${rel}" could not be read from the ZIP.`);
    }
    await fsp.writeFile(abs, data);
  }

  return files.length;
}

/**
 * Packs a workspace into a zip buffer for the "Download project" button.
 * Hidden files and anything outside the allowlist are skipped, so the export
 * matches exactly what the file explorer showed.
 */
function packDirectory(rootDir) {
  const zip = new AdmZip();

  (function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      if (entry.isSymbolicLink()) continue;

      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile() && isAllowed(entry.name)) {
        zip.addFile(rel, fs.readFileSync(abs));
      }
    }
  })(path.resolve(rootDir), '');

  return zip.toBuffer();
}

module.exports = {
  MAX_ZIP_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  inspect,
  validate,
  extractTo,
  packDirectory,
  detectWrapperDir,
};
