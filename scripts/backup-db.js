/**
 * scripts/backup-db.js
 * Dumps the MySQL database, gzips it, and uploads it to R2 under
 * playmist_data_backup/. Also prunes backups older than the retention window.
 *
 * Run manually:  npm run backup-db
 * Run daily:     scheduled by utils/backupScheduler.js from server.js
 *
 * Filenames get a random suffix because the bucket is publicly readable via
 * its r2.dev URL — the suffix keeps backup URLs unguessable.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const BUCKET = process.env.R2_BUCKET_NAME;
const PREFIX = 'playmist_data_backup/';
const RETENTION_DAYS = parseInt(process.env.DB_BACKUP_RETENTION_DAYS, 10) || 30;
const MYSQLDUMP = process.env.MYSQLDUMP_PATH || 'mysqldump';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const timestamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

async function runBackup() {
  const dbName = process.env.DB_NAME || 'playmist';
  const key = `${PREFIX}${dbName}-${timestamp()}-${crypto.randomBytes(4).toString('hex')}.sql.gz`;

  const dump = spawn(MYSQLDUMP, [
    '-h', process.env.DB_HOST || 'localhost',
    '-P', process.env.DB_PORT || '3306',
    '-u', process.env.DB_USER || 'root',
    '--single-transaction',
    '--quick',
    '--routines',
    '--triggers',
    '--events',
    '--no-tablespaces',
    '--set-gtid-purged=OFF',
    dbName,
  ], {
    // Password via env, not argv, so it never shows up in `ps` output
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' },
  });

  let stderr = '';
  dump.stderr.on('data', (c) => { stderr += c; });

  const gzip = zlib.createGzip({ level: 6 });
  dump.stdout.pipe(gzip);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: gzip,
      ContentType: 'application/gzip',
    },
  });

  const dumpExit = new Promise((resolve, reject) => {
    dump.on('error', reject); // e.g. mysqldump binary not found
    dump.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`mysqldump exited with code ${code}: ${stderr.trim()}`));
    });
  });

  // If mysqldump fails, destroy the gzip stream so the upload aborts too
  // instead of finishing successfully with a truncated dump.
  dumpExit.catch((err) => gzip.destroy(err));

  await Promise.all([upload.done(), dumpExit]);
  return key;
}

async function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = [];
  let continuationToken;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents || []) {
      if (!obj.Key.endsWith('.sql.gz')) continue; // never touch non-dump files
      if (new Date(obj.LastModified).getTime() < cutoff) stale.push({ Key: obj.Key });
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  if (stale.length) {
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: stale } }));
  }
  return stale.length;
}

async function backupDatabase() {
  const started = Date.now();
  const key = await runBackup();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`✅ DB backup uploaded to r2://${BUCKET}/${key} (${secs}s)`);

  try {
    const pruned = await pruneOldBackups();
    if (pruned) console.log(`🧹 Pruned ${pruned} backup(s) older than ${RETENTION_DAYS} days`);
  } catch (err) {
    console.warn('⚠️  Backup prune failed (backup itself succeeded):', err.message);
  }
  return key;
}

module.exports = { backupDatabase, PREFIX };

if (require.main === module) {
  backupDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ DB backup failed:', err.message);
      process.exit(1);
    });
}
