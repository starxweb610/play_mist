/**
 * utils/backupScheduler.js
 * Schedules the daily MySQL → R2 backup (scripts/backup-db.js) without any
 * external cron dependency.
 *
 *  - Runs every day at 03:30 server time.
 *  - Also runs ~60s after startup if the newest backup in R2 is older than
 *    20 hours (or none exists), so every deploy/restart snapshots the DB.
 *  - Disable entirely with DB_BACKUP_ENABLED=false (e.g. on dev machines
 *    without mysqldump installed).
 */
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { backupDatabase, PREFIX } = require('../scripts/backup-db');

const DAILY_HOUR = 3;
const DAILY_MINUTE = 30;
const CATCHUP_MAX_AGE_MS = 20 * 60 * 60 * 1000;

const msUntilNextRun = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_HOUR, DAILY_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
};

const runSafely = async (label) => {
  try {
    await backupDatabase();
  } catch (err) {
    console.error(`❌ ${label} DB backup failed:`, err.message);
  }
};

const latestBackupTime = async () => {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  let latest = 0;
  let continuationToken;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: PREFIX,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents || []) {
      if (!obj.Key.endsWith('.sql.gz')) continue;
      latest = Math.max(latest, new Date(obj.LastModified).getTime());
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return latest;
};

const scheduleDaily = () => {
  const delay = msUntilNextRun();
  setTimeout(async () => {
    await runSafely('Scheduled');
    scheduleDaily();
  }, delay);
  console.log(`🗄️  Next DB backup in ${(delay / 3600000).toFixed(1)}h (daily at 0${DAILY_HOUR}:${DAILY_MINUTE})`);
};

exports.startBackupScheduler = () => {
  if (process.env.DB_BACKUP_ENABLED === 'false') {
    console.log('🗄️  DB backup scheduler disabled (DB_BACKUP_ENABLED=false)');
    return;
  }

  scheduleDaily();

  // Catch-up pass shortly after boot — covers deploys and missed windows.
  setTimeout(async () => {
    try {
      const latest = await latestBackupTime();
      if (Date.now() - latest > CATCHUP_MAX_AGE_MS) {
        console.log('🗄️  No recent DB backup found — running catch-up backup now');
        await runSafely('Catch-up');
      }
    } catch (err) {
      console.error('❌ Backup catch-up check failed:', err.message);
    }
  }, 60 * 1000);
};
