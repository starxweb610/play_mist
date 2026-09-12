/**
 * config/upload.js
 * Multer configurations for game file uploads.
 *   upload             — .zip game builds (600 MB), staged on disk before R2 upload
 *   uploadImage        — thumbnail images (jpg / png / webp, 10 MB), in-memory; converted to WebP before R2
 *   uploadScreenshots  — screenshot images, in-memory; converted to WebP before R2
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

// ── Player avatar (in-memory, 5 MB) ──────────────────────────────────────────
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Screenshots uploader (multiple files, in-memory) ───────────────────────────
const uploadScreenshots = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Developer submission: the build zip plus an optional reference image ─────
// Both land on disk because the zip is far too large to buffer. multer's size
// limit is per-instance, not per-field, so the cap here is the zip's and the
// controller enforces REFERENCE_IMAGE_MAX_BYTES on the image separately.
const REFERENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const submissionFilter = (_req, file, cb) => {
  if (file.fieldname === 'reference_image') return imageFilter(_req, file, cb);
  return zipFilter(_req, file, cb);
};

/**
 * Disk storage that records every path it is about to write on
 * `req._tempFilePaths`, so the route wrapper can sweep uploads/temp afterwards.
 *
 * When multer rejects one file of a multi-field upload it abandons the request
 * with `req.files` empty AND destroys the stream of whatever it was writing —
 * leaving a truncated build on disk whose completion callback never fires. So
 * the path has to be recorded before the first byte lands; anything recorded
 * later misses exactly the case that leaks. (uploads/temp still holds
 * leftovers from before this existed.)
 */
const trackedTempStorage = {
  _handleFile(req, file, cb) {
    const uid       = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const filename  = uid + path.extname(file.originalname);
    const finalPath = path.join(TEMP_DIR, filename);

    if (!req._tempFilePaths) req._tempFilePaths = [];
    req._tempFilePaths.push(finalPath);

    const out = fs.createWriteStream(finalPath);
    out.on('error', cb);
    out.on('finish', () => cb(null, {
      destination: TEMP_DIR,
      filename,
      path: finalPath,
      size: out.bytesWritten,
    }));
    file.stream.pipe(out);
  },
  _removeFile(_req, file, cb) {
    fs.unlink(file.path, cb);
  },
};

const developerSubmissionFiles = multer({
  storage: trackedTempStorage,
  fileFilter: submissionFilter,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB — the zip's ceiling
});

// ── Developer thumbnail (in-memory, 5 MB) ────────────────────────────────────
const developerThumbnail = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Developer profile header / cover image (in-memory, 8 MB) ─────────────────
const developerHeader = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// ── Developer external-portfolio image (in-memory, 10 MB) ────────────────────
const developerPortfolioImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
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

// ── Storyboard sketch upload — PNG layers (in-memory, 15 MB each) ────────────
const developerSketch = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// ── Rich-text doc inline images (in-memory, 10 MB) ───────────────────────────
const developerDocImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = { upload, uploadImage, avatarUpload, uploadScreenshots, developerSubmissionFiles, REFERENCE_IMAGE_MAX_BYTES, developerThumbnail, developerHeader, developerPortfolioImage, developerDoc, developerSketch, developerDocImage };
