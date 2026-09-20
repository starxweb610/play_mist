/**
 * utils/gameBuild.js — the rules a playable web build must satisfy, in one place.
 *
 * These used to live inside submissionsController, which was fine while the
 * website's upload form was the only way a build entered the system. The
 * Studio app added two more (upload a zip to a project, and pack a project for
 * a test run), and three copies of an allowlist is how a build comes to pass
 * review and then fail on a device. Everything that accepts, extracts, packs
 * or validates a game build goes through here.
 *
 * ⚠ These are containment rules, not conveniences. A build is unpacked and
 * served to players from their own device (§6.4), so the archive is hostile
 * input: entry names decide paths, entry sizes decide disk usage, and the
 * extension list decides what a browser will later execute.
 */
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const AdmZip = require('adm-zip');

/**
 * What a web build is allowed to contain.
 *
 * `pck` is Godot's data pack: a Godot 4 web export is index.html + .js +
 * .wasm + .pck (+ .audio.worklet.js / .worker.js), and without it on this list
 * every Godot game ever exported is rejected — which mattered the moment
 * developers could export one from a phone. It is inert data read by the
 * engine, never executed by the browser.
 */
const ALLOWED_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'wasm',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'mp3', 'ogg', 'wav', 'mp4', 'webm',
  'ttf', 'woff', 'woff2', 'otf',
  'data', 'unityweb', 'pck', 'bin', 'mem', 'symbols',
  'gz', 'br',
]);

const MAX_ZIP_BYTES          = 250 * 1024 * 1024;        // the upload itself
const MAX_UNCOMPRESSED_BYTES = 1 * 1024 * 1024 * 1024;   // zip-bomb guard
const ENTRY_POINT            = 'index.html';

/** macOS metadata folders and resource forks: skipped everywhere, never an error. */
const isJunk = (name) =>
  name.startsWith('__MACOSX/') || name.split('/').some(part => part.startsWith('._'));

/** Extension, seeing through a .gz/.br transport suffix (main.wasm.br → wasm). */
function extOf(name) {
  let base = name;
  const lower = name.toLowerCase();
  if (lower.endsWith('.gz') || lower.endsWith('.br')) base = name.slice(0, -3);
  return path.extname(base).toLowerCase().replace('.', '');
}

const isAllowed = (name) => ALLOWED_EXTENSIONS.has(extOf(name));

/**
 * Throws with a message the developer can act on. Checked: path traversal,
 * total uncompressed size, the extension allowlist, and index.html at the
 * root — the last because that is literally what the device's local server
 * opens (§6.4), so a build nested one folder deep is a blank screen.
 */
function validateZip(zipPath) {
  const entries = new AdmZip(zipPath).getEntries();

  let totalUncompressed = 0;
  let hasRootIndex = false;

  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (isJunk(name)) continue;

    if (path.normalize(name).startsWith('..')) {
      throw new Error('ZIP contains invalid path traversal entries.');
    }

    if (!entry.isDirectory) {
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP uncompressed content exceeds 1 GB. Suspected zip bomb.');
      }
      if (!isAllowed(name)) {
        throw new Error(`Disallowed file type in ZIP: .${extOf(name)}. Only web-safe files are permitted.`);
      }
    }

    if (name === ENTRY_POINT) hasRootIndex = true;
  }

  if (!hasRootIndex) throw new Error('ZIP must contain index.html at the root level.');
}

/**
 * Extracts a validated build. Re-checks containment per entry rather than
 * trusting validateZip to have run: this writes to disk, and the two are
 * separated by a caller.
 */
async function extractTo(zipPath, targetDir) {
  const absTarget = path.resolve(targetDir);
  await fsp.mkdir(absTarget, { recursive: true });

  let written = 0;
  for (const entry of new AdmZip(zipPath).getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (entry.isDirectory || isJunk(name) || !isAllowed(name)) continue;

    const abs = path.resolve(absTarget, name);
    if (!abs.startsWith(absTarget + path.sep)) {
      throw new Error('ZIP contains entries pointing outside the archive.');
    }

    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, entry.getData());
    written++;
  }

  if (!written) throw new Error('That ZIP contained no usable files.');
  return written;
}

/**
 * Packs a build directory into a zip buffer — what the device downloads for a
 * test run, and what a submission uploads.
 *
 * ⚠ Uses this allowlist, not the Game Builder's (utils/builderZip). The
 * builder's list is for files you can *edit* in a browser: html/css/js/json
 * and images. Packing an uploaded Godot build with it silently drops the
 * .wasm and the .pck, and the developer gets a blank screen on device with
 * nothing in the log to explain it.
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
      else if (entry.isFile() && isAllowed(entry.name)) zip.addFile(rel, fs.readFileSync(abs));
    }
  })(path.resolve(rootDir), '');

  return zip.toBuffer();
}

/** Total bytes and file count of an extracted build, for the UI. */
function measure(rootDir) {
  let files = 0, bytes = 0;
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) { files++; bytes += fs.statSync(abs).size; }
    }
  })(path.resolve(rootDir));
  return { files, bytes };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_ZIP_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  ENTRY_POINT,
  extOf,
  isAllowed,
  validateZip,
  extractTo,
  packDirectory,
  measure,
};
