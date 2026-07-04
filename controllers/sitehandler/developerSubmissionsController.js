const db        = require('../../config/database');
const AdmZip    = require('adm-zip');
const fse       = require('fs-extra');
const path      = require('path');
const fs        = require('fs');
const PATHS     = require('../../config/paths');
const r2        = require('../../config/r2');
const mailer    = require('../../utils/mailer');
const templates = require('../../utils/emailTemplates');
const { formatBytes } = require('../../utils/format');

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

// ── GET /sitehandler/developer-submissions ───────────────────────────────────
exports.getIndex = async (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT s.*, d.name AS developer_name, d.studio_name, d.email AS developer_email
    FROM developer_submissions s
    JOIN developers d ON s.developer_id = d.id
    WHERE s.status != 'draft'`;
  const params = [];
  if (status) { sql += ' AND s.status = ?'; params.push(status); }
  sql += ' ORDER BY s.created_at DESC';

  let submissions = [], counts = {};
  try {
    const [rows] = await db.query(sql, params);
    submissions = rows.map(r => ({ ...r, zip_size_fmt: formatBytes(r.zip_size) }));

    const [countRows] = await db.query(`
      SELECT status, COUNT(*) AS n FROM developer_submissions GROUP BY status`);
    countRows.forEach(r => { counts[r.status] = r.n; });
  } catch (_) {}

  res.render('sitehandler/developer-submissions/index', {
    title: 'Game Submissions',
    activePage: 'dev-submissions',
    submissions,
    counts,
    filter: status || '',
  });
};

// ── GET /sitehandler/developer-submissions/:id ───────────────────────────────
exports.getDetail = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT s.*, d.name AS developer_name, d.studio_name, d.email AS developer_email,
             d.country, d.phone, a.name AS reviewer_name
      FROM developer_submissions s
      JOIN developers d ON s.developer_id = d.id
      LEFT JOIN admins a ON s.reviewed_by = a.id
      WHERE s.id = ?`, [req.params.id]);

    if (!rows.length) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/sitehandler/developer-submissions');
    }

    const sub = rows[0];
    sub.zip_size_fmt = formatBytes(sub.zip_size);

    res.render('sitehandler/developer-submissions/detail', {
      title: sub.title,
      activePage: 'dev-submissions',
      sub,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/developer-submissions');
  }
};

// ── GET /sitehandler/developer-submissions/:id/download ──────────────────────
exports.getDownload = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT zip_r2_key, title FROM developer_submissions WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).send('Not found'); return; }

    const { zip_r2_key, title } = rows[0];
    const stream = await r2.downloadStream(zip_r2_key);
    const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    stream.pipe(res);
  } catch (err) {
    req.flash('error_msg', 'Download failed: ' + err.message);
    res.redirect(`/sitehandler/developer-submissions/${req.params.id}`);
  }
};

// ── POST /sitehandler/developer-submissions/:id/mark-reviewing ───────────────
exports.postMarkReviewing = async (req, res) => {
  const { id } = req.params;
  try {
    const [subRows] = await db.query(
      `SELECT s.title, d.name AS developer_name, d.email AS developer_email
       FROM developer_submissions s JOIN developers d ON s.developer_id = d.id
       WHERE s.id = ? AND s.status = 'pending'`,
      [id]
    );

    await db.query(
      `UPDATE developer_submissions SET status = 'under_review', reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.session.admin.id, id]
    );

    if (subRows.length) {
      const { title, developer_name, developer_email } = subRows[0];
      mailer.sendMail({
        to:      developer_email,
        subject: `Your game is under review — ${process.env.APP_NAME || 'PlayMist'}`,
        html:    templates.submissionStatusChanged({
          name: developer_name,
          gameTitle: title,
          status: 'under_review',
        }),
      }).catch(err => console.error('under_review email failed:', err.message));
    }

    req.flash('success_msg', 'Submission marked as under review.');
  } catch (err) {
    req.flash('error_msg', err.message);
  }
  res.redirect(`/sitehandler/developer-submissions/${id}`);
};

// ── POST /sitehandler/developer-submissions/:id/approve ──────────────────────
exports.postApprove = async (req, res) => {
  const { id } = req.params;
  let extractDir = null;
  let tempZip    = null;

  try {
    const [rows] = await db.query(`
      SELECT s.*, d.studio_name
      FROM developer_submissions s
      JOIN developers d ON s.developer_id = d.id
      WHERE s.id = ?`, [id]);

    if (!rows.length) throw new Error('Submission not found.');
    const sub = rows[0];
    if (sub.status === 'approved') {
      req.flash('error_msg', 'Already approved.');
      return res.redirect(`/sitehandler/developer-submissions/${id}`);
    }

    // Download zip from R2 to temp
    tempZip = path.join(PATHS.TEMP_DIR, `devzip_${Date.now()}_${id}.zip`);
    const stream = await r2.downloadStream(sub.zip_r2_key);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tempZip);
      stream.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      stream.on('error', reject);
    });

    // Validate & extract
    const zip = new AdmZip(tempZip);
    const entries = zip.getEntries().map(e => e.entryName.replace(/\\/g, '/'));
    const hasRoot = entries.some(e => e === 'index.html');
    if (!hasRoot) throw new Error('ZIP does not contain index.html at root.');

    extractDir = path.join(PATHS.TEMP_DIR, `devextract_${Date.now()}_${id}`);
    await fse.ensureDir(extractDir);
    zip.extractAllTo(extractDir, true);

    // Upload extracted files to R2 public games path
    const r2Prefix = `games/webgl/${sub.slug}`;
    await r2.deletePrefix(`${r2Prefix}/`);

    const files = walkFiles(extractDir);
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      await Promise.all(files.slice(i, i + CONCURRENCY).map(filePath => {
        const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');
        const key = `${r2Prefix}/${rel}`;
        return r2.uploadFile(key, filePath, r2.getContentType(rel), r2.getContentEncoding(rel));
      }));
    }

    // Upload zip alongside extracted build
    await r2.uploadFile(`${r2Prefix}/game.zip`, tempZip, 'application/zip');

    const playUrl = r2.getPublicUrl(`${r2Prefix}/index.html`);
    const zipUrl  = r2.getPublicUrl(`${r2Prefix}/game.zip`);
    const shortDesc = sub.description.substring(0, 200).trim();

    // Create game record
    const [result] = await db.query(
      `INSERT INTO games
         (title, slug, short_description, long_description, genre, type, orientation,
          version, file_path, play_url, zip_url, size_bytes, size, studio, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, 'webgl', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        sub.title, sub.slug, shortDesc, sub.description,
        sub.genre, sub.orientation, sub.version,
        r2Prefix, playUrl, zipUrl,
        sub.zip_size || null, sub.zip_size ? formatBytes(sub.zip_size) : null,
        sub.studio_name, req.session.admin.id,
      ]
    );

    await db.query(
      `UPDATE developer_submissions
       SET status = 'approved', game_id = ?, reviewed_by = ?, reviewed_at = NOW(), rejection_reason = NULL
       WHERE id = ?`,
      [result.insertId, req.session.admin.id, id]
    );

    // Fetch developer email for notification
    const [devRows] = await db.query(
      `SELECT d.name AS developer_name, d.email AS developer_email
       FROM developer_submissions s JOIN developers d ON s.developer_id = d.id
       WHERE s.id = ?`,
      [id]
    );
    if (devRows.length) {
      const { developer_name, developer_email } = devRows[0];
      mailer.sendMail({
        to:      developer_email,
        subject: `Your game "${sub.title}" has been approved! — ${process.env.APP_NAME || 'PlayMist'}`,
        html:    templates.submissionStatusChanged({
          name: developer_name,
          gameTitle: sub.title,
          status: 'approved',
        }),
      }).catch(err => console.error('approved email failed:', err.message));
    }

    req.flash('success_msg', `"${sub.title}" approved. Game created as draft (ID: ${result.insertId}). Add thumbnails and publish it from the Games panel.`);
    res.redirect(`/sitehandler/developer-submissions/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Approval failed: ' + err.message);
    res.redirect(`/sitehandler/developer-submissions/${id}`);
  } finally {
    if (tempZip)    await fse.remove(tempZip).catch(() => {});
    if (extractDir) await fse.remove(extractDir).catch(() => {});
  }
};

// ── POST /sitehandler/developer-submissions/:id/reject ───────────────────────
exports.postReject = async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body;

  if (!rejection_reason?.trim()) {
    req.flash('error_msg', 'A rejection reason is required.');
    return res.redirect(`/sitehandler/developer-submissions/${id}`);
  }
  try {
    const [subRows] = await db.query(
      `SELECT s.title, d.name AS developer_name, d.email AS developer_email
       FROM developer_submissions s JOIN developers d ON s.developer_id = d.id
       WHERE s.id = ?`,
      [id]
    );

    await db.query(
      `UPDATE developer_submissions
       SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ?`,
      [rejection_reason.trim(), req.session.admin.id, id]
    );

    if (subRows.length) {
      const { title, developer_name, developer_email } = subRows[0];
      mailer.sendMail({
        to:      developer_email,
        subject: `Update on your submission "${title}" — ${process.env.APP_NAME || 'PlayMist'}`,
        html:    templates.submissionStatusChanged({
          name: developer_name,
          gameTitle: title,
          status: 'rejected',
          rejectionReason: rejection_reason.trim(),
        }),
      }).catch(err => console.error('rejected email failed:', err.message));
    }

    req.flash('success_msg', 'Submission rejected and developer notified.');
  } catch (err) {
    req.flash('error_msg', err.message);
  }
  res.redirect(`/sitehandler/developer-submissions/${id}`);
};
