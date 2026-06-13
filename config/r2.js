/**
 * config/r2.js
 * Cloudflare R2 client (S3-compatible) and helpers for storing game zips,
 * extracted WebGL/premium build files, thumbnails, and screenshots.
 */
const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ── Content-type / encoding detection ───────────────────────────────────────
const CONTENT_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.mem': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.unityweb': 'application/octet-stream',
  '.symbols': 'application/octet-stream',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Resolves the content-type for a file, accounting for Unity's pre-compressed
 * build artifacts (e.g. `foo.wasm.gz` is application/wasm + Content-Encoding: gzip).
 */
function getContentType(filename) {
  let base = filename;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.gz') || lower.endsWith('.br')) {
    base = filename.slice(0, -3);
  }
  const ext = path.extname(base).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function getContentEncoding(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.gz')) return 'gzip';
  if (lower.endsWith('.br')) return 'br';
  return undefined;
}

// ── Public URL helper ────────────────────────────────────────────────────────
function getPublicUrl(key) {
  return `${PUBLIC_URL}/${key}`;
}

/**
 * Converts a stored R2 public URL back to its bucket key, or null if the
 * URL doesn't belong to this bucket (e.g. a legacy local path).
 */
function keyFromUrl(url) {
  if (!url || !PUBLIC_URL || !url.startsWith(`${PUBLIC_URL}/`)) return null;
  return url.slice(PUBLIC_URL.length + 1);
}

// ── Upload helpers ────────────────────────────────────────────────────────────
async function uploadBuffer(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return getPublicUrl(key);
}

async function uploadFile(key, filePath, contentType, contentEncoding) {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
      ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
    },
  });
  await upload.done();
  return getPublicUrl(key);
}

// ── Delete helpers ────────────────────────────────────────────────────────────
async function deleteObject(key) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Deletes every object whose key starts with `prefix` (e.g. "games/webgl/my-slug/").
 */
async function deletePrefix(prefix) {
  let continuationToken;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (list.Contents || []).map(o => ({ Key: o.Key }));
    if (objects.length) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: objects },
      }));
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

/**
 * Lists every object key under `prefix`, skipping macOS zip metadata.
 */
async function listPrefix(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents || []) {
      const rel = obj.Key.slice(prefix.length);
      if (rel.startsWith('__MACOSX/') || rel.split('/').some(p => p.startsWith('._'))) continue;
      keys.push(obj.Key);
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

module.exports = {
  getContentType,
  getContentEncoding,
  getPublicUrl,
  keyFromUrl,
  uploadBuffer,
  uploadFile,
  deleteObject,
  deletePrefix,
  listPrefix,
};
