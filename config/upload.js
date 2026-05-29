/**
 * config/upload.js
 * Multer configurations for game file uploads.
 *   upload       — .zip game builds (600 MB)
 *   uploadImage  — thumbnail images (jpg / png / webp, 10 MB)
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const TEMP_DIR   = path.join(__dirname, '..', 'uploads', 'temp');
const THUMBS_DIR = path.join(__dirname, '..', 'public',  'images', 'games');
fs.mkdirSync(TEMP_DIR,   { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

// ── Shared disk storage (temp) ───────────────────────────────────────────────
const tempStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename:    (_req, file, cb) => {
    const uid = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, uid + path.extname(file.originalname));
  },
});

// ── Zip uploader ─────────────────────────────────────────────────────────────
const zipFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const ok  = ext === '.zip' ||
    file.mimetype === 'application/zip' ||
    file.mimetype === 'application/x-zip-compressed';
  ok ? cb(null, true) : cb(new Error('Only .zip files are accepted'), false);
};

const upload = multer({
  storage: tempStorage,
  fileFilter: zipFilter,
  limits: { fileSize: 600 * 1024 * 1024 }, // 600 MB
});

// ── Image uploader ────────────────────────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, THUMBS_DIR),
  filename:    (req, file, cb) => {
    // Name after game slug and fieldname so it's deterministic and easy to replace
    let suffix = '';
    if (file.fieldname === 'secondary_image') {
      suffix = '-secondary';
    } else if (file.fieldname === 'promotional_image') {
      suffix = '-promo';
    }
    const slug = req.params.id ? `game-${req.params.id}${suffix}` : `game-${Date.now()}${suffix}`;
    cb(null, slug + path.extname(file.originalname).toLowerCase());
  },
});

const imageFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  allowed.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPG, PNG, or WebP images are accepted'), false);
};

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Screenshots uploader (multiple files) ──────────────────────────────────────
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'public', 'images', 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const screenshotStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SCREENSHOTS_DIR),
  filename:    (req, file, cb) => {
    const gameId = req.params.id || 'unknown';
    const uid = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `screenshot-${gameId}-${uid}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const uploadScreenshots = multer({
  storage: screenshotStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = { upload, uploadImage, uploadScreenshots };
