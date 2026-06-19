/**
 * config/upload.js
 * Multer configurations for game file uploads.
 *   upload             — .zip game builds (600 MB), staged on disk before R2 upload
 *   uploadImage        — thumbnail images (jpg / png / webp, 10 MB), in-memory for R2
 *   uploadScreenshots  — screenshot images, in-memory for R2
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const TEMP_DIR = path.join(__dirname, '..', 'uploads', 'temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

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

// ── Image uploader (in-memory — buffer is pushed to R2 by the controller) ─────
const imageFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  allowed.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPG, PNG, or WebP images are accepted'), false);
};

const uploadImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Screenshots uploader (multiple files, in-memory) ───────────────────────────
const uploadScreenshots = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Developer submission zip (250 MB hard cap) ───────────────────────────────
const developerUpload = multer({
  storage: tempStorage,
  fileFilter: zipFilter,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB
});

// ── Developer thumbnail (in-memory, 5 MB) ────────────────────────────────────
const developerThumbnail = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Developer document upload — PDF / TXT only (in-memory, 10 MB) ────────────
const docFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const ok  = ext === '.pdf' || ext === '.txt' ||
              file.mimetype === 'application/pdf' ||
              file.mimetype === 'text/plain';
  ok ? cb(null, true) : cb(new Error('Only PDF and TXT files are accepted'), false);
};

const developerDoc = multer({
  storage: multer.memoryStorage(),
  fileFilter: docFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = { upload, uploadImage, uploadScreenshots, developerUpload, developerThumbnail, developerDoc };
