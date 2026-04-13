const db     = require('../../config/database');
const AdmZip = require('adm-zip');
const fse    = require('fs-extra');
const path   = require('path');
const PATHS  = require('../../config/paths');

// ── Helpers ─────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function uniqueSlug(base, excludeId = null) {
  let slug = base, n = 1;
  while (true) {
    const q = excludeId
      ? 'SELECT id FROM games WHERE slug = ? AND id != ?'
      : 'SELECT id FROM games WHERE slug = ?';
    const params = excludeId ? [slug, excludeId] : [slug];
    const [rows] = await db.query(q, params);
    if (rows.length === 0) return slug;
    slug = `${base}-${++n}`;
  }
}

const GENRES = ['Action','Adventure','Arcade','Casual','Puzzle',
  'Racing','RPG','Shooter','Simulation','Sports','Strategy','Tower Defense','Other'];

// ── GET /sitehandler/games ───────────────────────────────────────────────────
exports.getIndex = async (req, res) => {
  const { type, genre, status, q } = req.query;
  let sql = `SELECT g.*, a.name AS creator
             FROM games g LEFT JOIN admins a ON g.created_by = a.id WHERE 1=1`;
  const params = [];
  if (type)   { sql += ' AND g.type = ?';  params.push(type); }
  if (genre)  { sql += ' AND g.genre = ?'; params.push(genre); }
  if (status === 'active')   { sql += ' AND g.is_active = 1'; }
  if (status === 'inactive') { sql += ' AND g.is_active = 0'; }
  if (q)      { sql += ' AND g.title LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY g.created_at DESC';

  let games = [];
  try { [games] = await db.query(sql, params); } catch (_) {}

  res.render('sitehandler/games/index', {
    title: 'Manage Games', activePage: 'games',
    games, filters: { type, genre, status, q }, GENRES,
  });
};

// ── GET /sitehandler/games/create ────────────────────────────────────────────
exports.getCreate = (_req, res) => {
  res.render('sitehandler/games/create', {
    title: 'Upload New Game', activePage: 'games', GENRES,
  });
};

// ── POST /sitehandler/games/create ──────────────────────────────────────────
exports.postCreate = async (req, res) => {
  const { title, genre, orientation, type, short_description } = req.body;
  if (!title || !genre || !orientation || !type || !short_description) {
    req.flash('error_msg', 'All fields are required.');
    return res.redirect('/sitehandler/games/create');
  }
  const base = slugify(title);
  const slug = await uniqueSlug(base);

  try {
    const [result] = await db.query(
      `INSERT INTO games (title, slug, short_description, genre, type, orientation, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), slug, short_description.trim(), genre, type, orientation, req.session.admin.id]
    );
    req.flash('success_msg', `Game "${title}" created. Now add the details and upload files.`);
    res.redirect(`/sitehandler/games/${result.insertId}`);
  } catch (err) {
    req.flash('error_msg', 'Failed to create game: ' + err.message);
    res.redirect('/sitehandler/games/create');
  }
};

// ── GET /sitehandler/games/:id ───────────────────────────────────────────────
exports.getDetail = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (!rows.length) { req.flash('error_msg', 'Game not found.'); return res.redirect('/sitehandler/games'); }
    res.render('sitehandler/games/detail', {
      title: rows[0].title, activePage: 'games',
      game: rows[0], GENRES,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/update ──────────────────────────────────────
exports.postUpdate = async (req, res) => {
  const { id } = req.params;
  const {
    title, genre, orientation, type,
    short_description, long_description, trailer_url,
    version, is_active, is_featured,
  } = req.body;
  try {
    const base = slugify(title);
    const slug = await uniqueSlug(base, parseInt(id));
    await db.query(
      `UPDATE games SET title=?, slug=?, genre=?, orientation=?, type=?,
       short_description=?, long_description=?, trailer_url=?,
       version=?, is_active=?, is_featured=? WHERE id=?`,
      [
        title, slug, genre, orientation, type,
        short_description, long_description || null, trailer_url?.trim() || null,
        version || '1.0.0',
        is_active === 'on' ? 1 : 0,
        is_featured === 'on' ? 1 : 0,
        id,
      ]
    );
    req.flash('success_msg', 'Game details updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Update failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/upload ──────────────────────────────────────
exports.postUpload = async (req, res) => {
  const { id } = req.params;
  const zipFile = req.file;

  if (!zipFile) {
    req.flash('error_msg', 'No file uploaded. Please select a .zip file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (!rows.length) throw new Error('Game not found');
    const game = rows[0];

    const zip     = new AdmZip(zipFile.path);
    const entries = zip.getEntries().map(e => e.entryName.replace(/\\/g, '/'));

    if (game.type === 'webgl') {
      // Require index.html at root
      const hasRoot = entries.some(e => e === 'index.html' || e.match(/^[^/]+\/index\.html$/));
      if (!hasRoot) throw new Error('ZIP must contain index.html at root (or one folder deep).');

      const destDir = path.join(PATHS.WEBGL_DIR, game.slug);
      await fse.remove(destDir);
      await fse.ensureDir(destDir);

      // If index.html is inside a subdirectory, extract the folder's content directly
      const subFolder = entries.find(e => e.match(/^[^/]+\/index\.html$/));
      if (subFolder) {
        // Extract everything and move subfolder contents to root
        const tempExtract = path.join(PATHS.TEMP_DIR, `extract_${Date.now()}`);
        await fse.ensureDir(tempExtract);
        zip.extractAllTo(tempExtract, true);
        const folderName = subFolder.split('/')[0];
        await fse.copy(path.join(tempExtract, folderName), destDir);
        await fse.remove(tempExtract);
      } else {
        zip.extractAllTo(destDir, true);
      }

      const playUrl = `/games/webgl/${game.slug}/index.html`;
      await db.query('UPDATE games SET file_path=?, play_url=? WHERE id=?', [destDir, playUrl, id]);
      req.flash('success_msg', `✅ WebGL game uploaded! Test it at: ${playUrl}`);

    } else if (game.type === 'premium') {
      // Require at least one .json catalog file
      const hasCatalog = entries.some(e => e.endsWith('.json'));
      if (!hasCatalog) throw new Error('ZIP must contain a Unity catalog .json file.');

      const destDir = path.join(PATHS.PREMIUM_DIR, game.slug);
      await fse.remove(destDir);
      await fse.ensureDir(destDir);
      zip.extractAllTo(destDir, true);

      await db.query('UPDATE games SET file_path=? WHERE id=?', [destDir, id]);
      req.flash('success_msg', '✅ Premium game assets uploaded and extracted.');
    }

    // Delete the temp zip
    await fse.remove(zipFile.path);

    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    if (zipFile) await fse.remove(zipFile.path).catch(() => {});
    req.flash('error_msg', 'Upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/upload-image ─────────────────────────────────
exports.postUploadImage = async (req, res) => {
  const { id } = req.params;
  const imgFile = req.file;

  if (!imgFile) {
    req.flash('error_msg', 'No image uploaded. Please select a JPG, PNG, or WebP file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    // Build a public URL relative to the web root (file is in public/images/games/)
    const publicUrl = `/images/games/${imgFile.filename}`;

    // Delete old thumbnail if it has a different filename (different extension)
    const [rows] = await db.query('SELECT thumbnail_url FROM games WHERE id = ?', [id]);
    if (rows.length && rows[0].thumbnail_url) {
      const fse  = require('fs-extra');
      const path = require('path');
      const oldPath = path.join(__dirname, '../../public', rows[0].thumbnail_url);
      if (oldPath !== imgFile.path) await fse.remove(oldPath).catch(() => {});
    }

    await db.query('UPDATE games SET thumbnail_url = ? WHERE id = ?', [publicUrl, id]);
    req.flash('success_msg', '✅ Game thumbnail updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Image upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/toggle ──────────────────────────────────────
exports.postToggle = async (req, res) => {
  try {
    await db.query('UPDATE games SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    res.redirect('/sitehandler/games');
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/delete ──────────────────────────────────────
exports.postDelete = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (rows.length) {
      const game = rows[0];
      // Remove files from filesystem
      if (game.type === 'webgl') {
        const dir = path.join(PATHS.WEBGL_DIR, game.slug);
        await fse.remove(dir).catch(() => {});
      } else if (game.type === 'premium') {
        const dir = path.join(PATHS.PREMIUM_DIR, game.slug);
        await fse.remove(dir).catch(() => {});
      }
      await db.query('DELETE FROM analytics_games WHERE game_id = ?', [req.params.id]);
      await db.query('DELETE FROM games WHERE id = ?', [req.params.id]);
    }
    req.flash('success_msg', 'Game deleted.');
    res.redirect('/sitehandler/games');
  } catch (err) {
    req.flash('error_msg', 'Delete failed: ' + err.message);
    res.redirect('/sitehandler/games');
  }
};
