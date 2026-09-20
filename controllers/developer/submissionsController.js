const db     = require('../../config/database');
const AdmZip = require('adm-zip');
const fse    = require('fs-extra');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const r2     = require('../../config/r2');
const PATHS  = require('../../config/paths');
const { toWebp, IMMUTABLE_CACHE } = require('../../utils/images');
const { parseVideo, watchUrl }    = require('../../utils/portfolio');
const { REFERENCE_IMAGE_MAX_BYTES } = require('../../config/upload');
const { matchClause } = require('../../utils/slugs');

// The rules a build must satisfy live in utils/gameBuild.js — the website's
// upload form, the Studio app's zip upload and the Test Lab's packer all read
// the same allowlist, the same size ceilings and the same "index.html at the
// root" rule from there.
const { validateZip, MAX_UNCOMPRESSED_BYTES, ALLOWED_EXTENSIONS } = require('../../utils/gameBuild');

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

const CONTENT_RATINGS = new Set(['everyone', 'teen', 'mature']);

exports.postSubmit = async (req, res) => {
  // .fields() rather than .single(): the form carries the build plus an
  // optional art-direction image.
  const zipFile   = req.files?.game_zip?.[0]        || null;
  const imageFile = req.files?.reference_image?.[0] || null;
  const {
    title, short_description, description, controls, genre,
    orientation, version, content_rating,
  } = req.body;
  // Checkboxes are absent from the body when unticked, so coerce to 0/1 here
  // and re-render the form from the same shape the view reads.
  const flag = (v) => (v === 'on' || v === '1' || v === 'true') ? 1 : 0;
  const form = {
    title, short_description, description, controls, genre, orientation, version,
    content_rating,
    has_ads:            flag(req.body.has_ads),
    has_iap:            flag(req.body.has_iap),
    has_external_links: flag(req.body.has_external_links),
    requires_internet:  flag(req.body.requires_internet),
    rights_confirmed:   flag(req.body.rights_confirmed),
    // A file input can't be repopulated, so only the link survives a re-render.
    reference_video_url: req.body.reference_video_url,
  };
  const developer = req.session.developer;

  const renderError = async (errors) => {
    if (zipFile)   await fse.remove(zipFile.path).catch(() => {});
    if (imageFile) await fse.remove(imageFile.path).catch(() => {});
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

  // A multer failure (oversized build, wrong file type) is reported before
  // anything else — the rest of the form can't be judged without the files.
  if (req.uploadError) return renderError([req.uploadError]);

  const errors = [];
  if (!title?.trim())             errors.push('Game title is required.');
  if (!short_description?.trim()) errors.push('Short description is required.');
  else if (short_description.trim().length > 200) errors.push('Short description must be 200 characters or fewer.');
  if (!description?.trim())       errors.push('Description is required.');
  if (!controls?.trim())          errors.push('Controls / how to play is required — reviewers need it to play your game.');
  if (!genre?.trim())             errors.push('Genre is required.');
  if (!CONTENT_RATINGS.has(content_rating)) errors.push('Please select a content rating.');
  if (!form.rights_confirmed)     errors.push('You must confirm you own or have licensed everything in this submission.');
  if (!zipFile)                   errors.push('A ZIP file is required.');

  // Optional art direction. The multer instance is sized for the build, so the
  // image's own cap is enforced here.
  let referenceVideoUrl = null;
  const video = parseVideo(req.body.reference_video_url);
  if (video.error) errors.push(video.error);
  else if (video.value) referenceVideoUrl = watchUrl(video.value.provider, video.value.id);

  if (imageFile && imageFile.size > REFERENCE_IMAGE_MAX_BYTES) {
    errors.push(`The reference image must be ${Math.round(REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024))} MB or smaller.`);
  }

  if (errors.length) return renderError(errors);

  try {
    validateZip(zipFile.path);
  } catch (err) {
    return renderError([err.message]);
  }

  try {
    const created = await storeSubmission({
      developer,
      zipPath: zipFile.path,
      zipSize: zipFile.size,
      referenceImageBuffer: imageFile ? await fse.readFile(imageFile.path) : null,
      referenceVideoUrl,
      fields: { title, short_description, description, controls, genre, orientation, version, content_rating, ...form },
    });
    req.flash('success_msg', `"${title.trim()}" uploaded! Test your game below, then submit for review when you're ready.`);
    res.redirect(`/developer/submissions/${created.slug}`);
  } catch (err) {
    console.error('❌ submission upload:', err.stack || err);
    return renderError(['Upload failed. Please try again.']);
  } finally {
    await fse.remove(zipFile.path).catch(() => {});
    if (imageFile) await fse.remove(imageFile.path).catch(() => {});
  }
};

/**
 * Uploads a validated build and writes the draft submission row.
 *
 * Shared by the portal's form post above and the Studio app, which submits a
 * build it packs out of the Game Builder workspace rather than a file the
 * developer picked. Both produce the same row, the same R2 layout and the
 * same reviewable preview — the review team should not be able to tell which
 * surface a submission came from.
 *
 * Caller owns `zipPath` (this only reads it) and has already validated the
 * zip; everything written to R2 here is rolled back if any step fails.
 */
async function storeSubmission({ developer, zipPath, zipSize, referenceImageBuffer = null, referenceVideoUrl = null, fields }) {
  const uuid  = crypto.randomBytes(16).toString('hex');
  const r2Key = `developer-submissions/${developer.id}/${uuid}/game.zip`;
  const slug  = await uniqueSlug(slugify(fields.title.trim()));
  const previewPrefix = `developer-previews/${developer.id}/${slug}`;
  let extractDir = null;
  let referenceImageKey = null;

  try {
    await r2.uploadFile(r2Key, zipPath, 'application/zip');

    // Art-direction image, if one came with the form. Normalised to WebP like
    // every other upload, and keyed under the submission so it is cleaned up
    // with it. Stored for the review team only — never published.
    let referenceImageUrl = null;
    if (referenceImageBuffer) {
      const { buffer, hash } = await toWebp(referenceImageBuffer);
      referenceImageKey = `developer-submissions/${developer.id}/${uuid}/reference-${hash}.webp`;
      referenceImageUrl = await r2.uploadBuffer(referenceImageKey, buffer, 'image/webp', IMMUTABLE_CACHE);
    }

    // Extract to temp dir and upload preview files to R2
    extractDir = path.join(PATHS.TEMP_DIR, `devpreview_${Date.now()}_${uuid}`);
    await fse.ensureDir(extractDir);
    new AdmZip(zipPath).extractAllTo(extractDir, true);

    await r2.deletePrefix(`${previewPrefix}/`);

    const files = walkFiles(extractDir);
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      await Promise.all(files.slice(i, i + CONCURRENCY).map(filePath => {
        const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');
        return r2.uploadFile(`${previewPrefix}/${rel}`, filePath, r2.getContentType(rel), r2.getContentEncoding(rel));
      }));
    }

    const previewPlayUrl = r2.getPublicUrl(`${previewPrefix}/index.html`);

    const [result] = await db.query(
      `INSERT INTO developer_submissions
         (developer_id, title, slug, short_description, description, controls, genre,
          orientation, version, content_rating,
          has_ads, has_iap, has_external_links, requires_internet,
          rights_confirmed, rights_confirmed_at,
          reference_image_url, reference_video_url,
          zip_r2_key, zip_size, preview_play_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?, ?, ?, ?, 'draft')`,
      [
        developer.id,
        fields.title.trim(),
        slug,
        fields.short_description.trim(),
        fields.description.trim(),
        fields.controls.trim(),
        fields.genre,
        fields.orientation || 'landscape',
        fields.version?.trim() || '1.0',
        fields.content_rating,
        fields.has_ads,
        fields.has_iap,
        fields.has_external_links,
        fields.requires_internet,
        referenceImageUrl,
        referenceVideoUrl,
        r2Key,
        zipSize,
        previewPlayUrl,
      ]
    );

    return { id: result.insertId, slug, previewPlayUrl };
  } catch (err) {
    await r2.deleteObject(r2Key).catch(() => {});
    if (referenceImageKey) await r2.deleteObject(referenceImageKey).catch(() => {});
    await r2.deletePrefix(`${previewPrefix}/`).catch(() => {});
    throw err;
  } finally {
    if (extractDir) await fse.remove(extractDir).catch(() => {});
  }
}

// Shared with the Studio app's JSON surface (controllers/devapi/submissionsApi.js).
exports.storeSubmission = storeSubmission;
exports.validateZip     = validateZip;   // re-exported from utils/gameBuild
exports.CONTENT_RATINGS = CONTENT_RATINGS;

exports.postSubmitReview = async (req, res) => {
  const ref = req.params.slug;
  const developer = req.session.developer;
  let back = '/developer/dashboard';

  try {
    const match = matchClause(ref);
    if (!match) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/dashboard');
    }
    const [rows] = await db.query(
      `SELECT id, slug, title, status FROM developer_submissions WHERE ${match.sql} AND developer_id = ?`,
      [...match.params, developer.id]
    );
    if (!rows.length) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/dashboard');
    }
    const sub = rows[0];
    back = `/developer/submissions/${sub.slug}`;
    if (sub.status !== 'draft') {
      req.flash('error_msg', 'Only draft submissions can be submitted for review.');
      return res.redirect(back);
    }

    await db.query(
      `UPDATE developer_submissions SET status = 'pending' WHERE id = ?`,
      [sub.id]
    );

    req.flash('success_msg', `"${sub.title}" has been submitted for review. We'll get back to you soon!`);
    res.redirect(back);
  } catch (err) {
    req.flash('error_msg', 'Failed to submit for review. Please try again.');
    res.redirect(back);
  }
};
