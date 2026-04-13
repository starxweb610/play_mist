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
    // Name after game slug so it's deterministic and easy to replace
    const slug = req.params.id ? `game-${req.params.id}` : `game-${Date.now()}`;
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

module.exports = { upload, uploadImage };
