const db     = require('../../config/database');
const AdmZip = require('adm-zip');
const fse    = require('fs-extra');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const r2     = require('../../config/r2');
const PATHS  = require('../../config/paths');

const ALLOWED_EXTENSIONS = new Set([
  'html','htm','css','js','mjs','json','wasm',
  'png','jpg','jpeg','gif','webp','svg','ico',
  'mp3','ogg','wav','mp4','webm',
  'ttf','woff','woff2','otf',
  'data','unityweb','bin','mem','symbols',
  'gz','br',
]);

const MAX_UNCOMPRESSED_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB zip-bomb guard

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function uniqueSlug(base) {
  let slug = base, n = 1;
  while (true) {
    const [rows] = await db.query('SELECT id FROM developer_submissions WHERE slug = ?', [slug]);
    if (!rows.length) return slug;
    slug = `${base}-${++n}`;
  }
}

function validateZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  let totalUncompressed = 0;
  let hasRootIndex = false;

  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');

    // Skip macOS metadata
    if (name.startsWith('__MACOSX/') || name.split('/').some(p => p.startsWith('._'))) continue;

    // Path traversal guard
    const normalized = path.normalize(name);
    if (normalized.startsWith('..')) throw new Error('ZIP contains invalid path traversal entries.');

    if (!entry.isDirectory) {
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP uncompressed content exceeds 1 GB. Suspected zip bomb.');
      }

      // File extension allowlist (handle .gz/.br double extensions)
      let base = name;
      const lower = name.toLowerCase();
      if (lower.endsWith('.gz') || lower.endsWith('.br')) base = name.slice(0, -3);
      const ext = path.extname(base).toLowerCase().replace('.', '');
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`Disallowed file type in ZIP: .${ext}. Only web-safe files are permitted.`);
      }
    }

    // index.html must be at root (not in a subdirectory)
    if (name === 'index.html') hasRootIndex = true;
  }

  if (!hasRootIndex) throw new Error('ZIP must contain index.html at the root level.');
}

function walkFiles(dir) {
  const results = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__MACOSX' || entry.name.startsWith('._')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  })(dir);
  return results;
}

async function fetchGuidelines() {
  try {
    const [rows] = await db.query('SELECT content FROM site_content WHERE key_name = ?', ['submission_guidelines']);
    return (rows.length && rows[0].content) ? rows[0].content : null;
  } catch (_) { return null; }
}

exports.getSubmit = async (req, res) => {
  const [[genres], guidelines] = await Promise.all([
    db.query('SELECT * FROM genres ORDER BY name ASC'),
    fetchGuidelines(),
  ]);
  res.render('developer/submit', {
    title: 'Upload a Game',
    developer: req.session.developer,
    genres,
    guidelines,
    errors: [],
    form: {},
  });
};

exports.postSubmit = async (req, res) => {
  const zipFile = req.file;
  const { title, description, genre, orientation, version } = req.body;
  const form = { title, description, genre, orientation, version };
  const developer = req.session.developer;

  const renderError = async (errors) => {
    if (zipFile) await fse.remove(zipFile.path).catch(() => {});
    const [[genres], guidelines] = await Promise.all([
      db.query('SELECT * FROM genres ORDER BY name ASC'),
      fetchGuidelines(),
    ]);
    return res.render('developer/submit', {
      title: 'Upload a Game',
      developer,
      genres,
      guidelines,
      errors,
      form,
    });
  };

  const errors = [];
  if (!title?.trim())       errors.push('Game title is required.');
  if (!description?.trim()) errors.push('Description is required.');
  if (!genre?.trim())       errors.push('Genre is required.');
  if (!zipFile)             errors.push('A ZIP file is required.');
  if (errors.length) return renderError(errors);

  try {
    validateZip(zipFile.path);
  } catch (err) {
    return renderError([err.message]);
  }

  const uuid = crypto.randomBytes(16).toString('hex');
  const r2Key = `developer-submissions/${developer.id}/${uuid}/game.zip`;
  const base = slugify(title.trim());
  const slug = await uniqueSlug(base);
  const previewPrefix = `developer-previews/${developer.id}/${slug}`;
  let extractDir = null;
  let insertId = null;

  try {
    // Upload ZIP to R2
    await r2.uploadFile(r2Key, zipFile.path, 'application/zip');

    // Extract to temp dir and upload preview files to R2
    extractDir = path.join(PATHS.TEMP_DIR, `devpreview_${Date.now()}_${uuid}`);
    await fse.ensureDir(extractDir);
    const zip = new AdmZip(zipFile.path);
    zip.extractAllTo(extractDir, true);

    await r2.deletePrefix(`${previewPrefix}/`);

    const files = walkFiles(extractDir);
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      await Promise.all(files.slice(i, i + CONCURRENCY).map(filePath => {
        const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');
        const key = `${previewPrefix}/${rel}`;
        return r2.uploadFile(key, filePath, r2.getContentType(rel), r2.getContentEncoding(rel));
      }));
    }

    const previewPlayUrl = r2.getPublicUrl(`${previewPrefix}/index.html`);

    const [result] = await db.query(
      `INSERT INTO developer_submissions
         (developer_id, title, slug, description, genre, orientation, version, zip_r2_key, zip_size, preview_play_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        developer.id,
        title.trim(),
        slug,
        description.trim(),
        genre,
        orientation || 'landscape',
        version?.trim() || '1.0',
        r2Key,
        zipFile.size,
        previewPlayUrl,
      ]
    );
    insertId = result.insertId;

    req.flash('success_msg', `"${title.trim()}" uploaded! Test your game below, then submit for review when you're ready.`);
    res.redirect(`/developer/submissions/${insertId}`);
  } catch (err) {
    await r2.deleteObject(r2Key).catch(() => {});
    await r2.deletePrefix(`${previewPrefix}/`).catch(() => {});
    return renderError(['Upload failed. Please try again.']);
  } finally {
    if (extractDir) await fse.remove(extractDir).catch(() => {});
    await fse.remove(zipFile.path).catch(() => {});
  }
};

exports.postSubmitReview = async (req, res) => {
  const { id } = req.params;
  const developer = req.session.developer;

  try {
    const [rows] = await db.query(
      'SELECT id, title, status FROM developer_submissions WHERE id = ? AND developer_id = ?',
      [id, developer.id]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/dashboard');
    }
    const sub = rows[0];
    if (sub.status !== 'draft') {
      req.flash('error_msg', 'Only draft submissions can be submitted for review.');
      return res.redirect(`/developer/submissions/${id}`);
    }

    await db.query(
      `UPDATE developer_submissions SET status = 'pending' WHERE id = ?`,
      [id]
    );

    req.flash('success_msg', `"${sub.title}" has been submitted for review. We'll get back to you soon!`);
    res.redirect(`/developer/submissions/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Failed to submit for review. Please try again.');
    res.redirect(`/developer/submissions/${id}`);
  }
};
