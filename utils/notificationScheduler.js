/**
 * utils/notificationScheduler.js
 * Sends admin-scheduled push notifications (scheduled_notifications) when they
 * fall due, without any external cron dependency.
 *
 *  - Polls every 30s. Due-ness is decided by MySQL's NOW(), i.e. server local
 *    time — the same clock the admin form's times are entered in.
 *  - Each row is claimed atomically (pending → sending) before it is pushed,
 *    so a notification can never go out twice.
 *  - A notification more than MISSED_AFTER_MIN late (server was down at the
 *    time) is marked 'missed' rather than pushed at an unexpected hour.
 *  - Rows left in 'sending' by a crash/restart mid-send are marked 'failed' on
 *    boot instead of retried, to avoid duplicate pushes. (Assumes the single
 *    pm2 fork-mode process the app runs as.)
 */
const db  = require('../config/database');
const fcm = require('./fcm');

const POLL_MS = 30 * 1000;
const MISSED_AFTER_MIN = 60;

let ticking = false;

const markFinished = (id, fields) => {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  return db.query(
    `UPDATE scheduled_notifications SET ${sets}, processed_at = NOW() WHERE id = ?`,
    [...Object.values(fields), id]
  );
};

async function sendDue() {
  if (ticking) return;
  ticking = true;
  try {
    await db.query(
      `UPDATE scheduled_notifications
       SET status = 'missed', processed_at = NOW(),
           error = 'Not sent: the server was unavailable at the scheduled time'
       WHERE status = 'pending' AND scheduled_at < NOW() - INTERVAL ? MINUTE`,
      [MISSED_AFTER_MIN]
    );

    const [due] = await db.query(
      `SELECT * FROM scheduled_notifications
       WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC`
    );

    for (const row of due) {
      const [claim] = await db.query(
        `UPDATE scheduled_notifications SET status = 'sending' WHERE id = ? AND status = 'pending'`,
        [row.id]
      );
      if (!claim.affectedRows) continue; // cancelled or claimed in the meantime

      try {
        const notificationId = await fcm.sendAndSaveNotification({
          type:     'custom',
          title:    row.title,
          body:     row.body,
          imageUrl: row.image_url,
          sentBy:   row.created_by,
          data:     { type: 'custom' },
        });
        await markFinished(row.id, { status: 'sent', notification_id: notificationId });
        console.log(`🔔 Scheduled notification #${row.id} sent ("${row.title}")`);
      } catch (err) {
        await markFinished(row.id, { status: 'failed', error: String(err.message).slice(0, 500) });
        console.error(`❌ Scheduled notification #${row.id} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Notification scheduler tick failed:', err.message);
  } finally {
    ticking = false;
  }
}

exports.sendDue = sendDue;

exports.startNotificationScheduler = async () => {
  try {
    const [r] = await db.query(
      `UPDATE scheduled_notifications
       SET status = 'failed', processed_at = NOW(),
           error = 'Interrupted by a server restart while sending — not retried to avoid duplicates'
       WHERE status = 'sending'`
    );
    if (r.affectedRows) console.warn(`⚠️  Marked ${r.affectedRows} interrupted scheduled notification(s) as failed`);
  } catch (err) {
    console.error('❌ Notification scheduler recovery failed:', err.message);
  }

  sendDue();
  setInterval(sendDue, POLL_MS);
  console.log(`🔔 Notification scheduler running (checks every ${POLL_MS / 1000}s)`);
};
