/**
 * controllers/devapi/submissionsApi.js
 * Submissions and store listings for the Studio app.
 *
 * The app's submit flow differs from the website's in one way, deliberately:
 * a phone has no zip lying around to pick, so a submission is packed from the
 * Game Builder workspace the developer has been editing and testing. Beyond
 * that it goes through the same validation, the same R2 layout and the same
 * row (controllers/developer/submissionsController.storeSubmission), so a
 * reviewer cannot tell which surface a build arrived from.
 */
const fsp  = require('fs/promises');
const path = require('path');
const fse  = require('fs-extra');
const crypto = require('crypto');
const db     = require('../../config/database');
const PATHS  = require('../../config/paths');
const gameBuild = require('../../utils/gameBuild');
const builder   = require('../developer/builderController');
const buildApi  = require('./buildApi');
const submissions = require('../developer/submissionsController');
const { parseVideo, watchUrl } = require('../../utils/portfolio');
const { matchClause } = require('../../utils/slugs');

const shape = (s) => ({
  id:               s.id,
  slug:             s.slug,
  title:            s.title,
  status:           s.status,
  shortDescription: s.short_description,
  description:      s.description,
  controls:         s.controls,
  genre:            s.genre,
  orientation:      s.orientation,
  version:          s.version,
  contentRating:    s.content_rating,
  hasAds:           !!s.has_ads,
  hasIap:           !!s.has_iap,
  hasExternalLinks: !!s.has_external_links,
  requiresInternet: !!s.requires_internet,
  thumbnailUrl:     s.thumbnail_url || null,
  bannerUrl:        s.banner_url || null,
  trailerUrl:       s.trailer_url || null,
  listingTags:      s.listing_tags ? s.listing_tags.split(',').filter(Boolean) : [],
  previewPlayUrl:   s.preview_play_url || null,
  rejectionReason:  s.rejection_reason || null,
  zipSize:          s.zip_size,
  gameId:           s.game_id || null,
  reviewedAt:       s.reviewed_at,
  createdAt:        s.created_at,
  updatedAt:        s.updated_at,
});

exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM developer_submissions WHERE developer_id = ? ORDER BY updated_at DESC',
      [req.session.developer.id]
    );
    res.json({ submissions: rows.map(shape) });
  } catch (err) {
    console.error('devapi submissions list error:', err);
    res.status(500).json({ error: 'Failed to load submissions.' });
  }
};

exports.detail = async (req, res) => {
  const match = matchClause(req.params.slug);
  if (!match) return res.status(404).json({ error: 'Submission not found.' });
  try {
    const [rows] = await db.query(
      `SELECT * FROM developer_submissions WHERE ${match.sql} AND developer_id = ?`,
      [...match.params, req.session.developer.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Submission not found.' });

    const [shots] = await db.query(
      'SELECT id, image_url FROM developer_submission_screenshots WHERE submission_id = ? ORDER BY position ASC, id ASC',
      [rows[0].id]
    ).catch(() => [[]]);

    res.json({ submission: { ...shape(rows[0]), screenshots: shots.map(s => ({ id: s.id, url: s.image_url })) } });
  } catch (err) {
    console.error('devapi submission detail error:', err);
    res.status(500).json({ error: 'Failed to load the submission.' });
  }
};

/** GET /genres — the picker the submit form needs. */
exports.genres = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name FROM genres ORDER BY name ASC');
    res.json({ genres: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load genres.' });
  }
};

/**
 * POST /submissions/from-project/:project
 * Packs the project's builder workspace and files it as a draft submission.
 */
exports.createFromProject = async (req, res) => {
  const developer = req.session.developer;
  const body = req.body || {};
  const flag = (v) => (v === true || v === 'on' || v === '1' || v === 1 || v === 'true') ? 1 : 0;

  const errors = [];
  if (!body.title?.trim())             errors.push('Game title is required.');
  if (!body.short_description?.trim()) errors.push('Short description is required.');
  else if (body.short_description.trim().length > 200) errors.push('Short description must be 200 characters or fewer.');
  if (!body.description?.trim())       errors.push('Description is required.');
  if (!body.controls?.trim())          errors.push('Controls / how to play is required — reviewers need it to play your game.');
  if (!body.genre?.trim())             errors.push('Genre is required.');
  if (!submissions.CONTENT_RATINGS.has(body.content_rating)) errors.push('Please select a content rating.');
  if (!flag(body.rights_confirmed))    errors.push('You must confirm you own or have licensed everything in this submission.');

  let referenceVideoUrl = null;
  const video = parseVideo(body.reference_video_url);
  if (video.error) errors.push(video.error);
  else if (video.value) referenceVideoUrl = watchUrl(video.value.provider, video.value.id);

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  let tempZip = null;
  try {
    const project = await builder.ownedProject(
      req.params.project, developer.id, 'id, slug, name, build_source');
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    // Whatever the project's build source is, this submits exactly the files
    // the Test Lab last ran — there is no second place a build can come from.
    const root = buildApi.resolveBuildRoot(project, developer.id);
    if (!root) return res.status(400).json({ error: buildApi.missingBuildError(project) });

    await fse.ensureDir(PATHS.TEMP_DIR);
    tempZip = path.join(PATHS.TEMP_DIR, `devsubmit_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.zip`);
    await fsp.writeFile(tempZip, gameBuild.packDirectory(root));

    // The same allowlist, zip-bomb guard and root-index rule the website
    // enforces — the workspace is developer-authored content too.
    try {
      submissions.validateZip(tempZip);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { size } = await fsp.stat(tempZip);
    const created = await submissions.storeSubmission({
      developer,
      zipPath: tempZip,
      zipSize: size,
      referenceVideoUrl,
      fields: {
        title:              body.title,
        short_description:  body.short_description,
        description:        body.description,
        controls:           body.controls,
        genre:              body.genre,
        orientation:        body.orientation === 'portrait' ? 'portrait' : 'landscape',
        version:            body.version,
        content_rating:     body.content_rating,
        has_ads:            flag(body.has_ads),
        has_iap:            flag(body.has_iap),
        has_external_links: flag(body.has_external_links),
        requires_internet:  flag(body.requires_internet),
      },
    });

    const [[row]] = await db.query('SELECT * FROM developer_submissions WHERE id = ?', [created.id]);
    res.status(201).json({ submission: shape(row) });
  } catch (err) {
    console.error('devapi createFromProject error:', err.stack || err);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  } finally {
    if (tempZip) await fse.remove(tempZip).catch(() => {});
  }
};

/** POST /submissions/:slug/submit-review — draft → pending. */
exports.submitForReview = async (req, res) => {
  const match = matchClause(req.params.slug);
  if (!match) return res.status(404).json({ error: 'Submission not found.' });
  try {
    const [rows] = await db.query(
      `SELECT id, slug, title, status FROM developer_submissions WHERE ${match.sql} AND developer_id = ?`,
      [...match.params, req.session.developer.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Submission not found.' });
    if (rows[0].status !== 'draft') {
      return res.status(409).json({ error: 'Only draft submissions can be submitted for review.' });
    }
    await db.query(`UPDATE developer_submissions SET status = 'pending' WHERE id = ?`, [rows[0].id]);
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error('devapi submitForReview error:', err);
    res.status(500).json({ error: 'Failed to submit for review.' });
  }
};
