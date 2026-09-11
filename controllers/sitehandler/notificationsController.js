const db  = require('../../config/database');
const fcm = require('../../utils/fcm');

// Scheduled times are entered and shown in server-local time (IST on the VPS) —
// the same clock MySQL's NOW() uses when the scheduler decides what is due.
const SERVER_TZ = new Intl.DateTimeFormat('en-IN', { timeZoneName: 'short' })
  .formatToParts(new Date())
  .find((p) => p.type === 'timeZoneName')?.value || 'server time';

const formatServerTime = (d) =>
  `${new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} ${SERVER_TZ}`;

// 'YYYY-MM-DDTHH:MM' in server-local time — the value format of <input type="datetime-local">.
const toDateTimeLocal = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const readMessage = (body) => ({
  title:    body.title?.trim(),
  message:  body.body?.trim(),
  imageUrl: body.image_url?.trim() || null,
});

// ── GET /sitehandler/notifications ───────────────────────────────────────────
exports.getIndex = async (req, res) => {
  let notifications = [], scheduled = [], tokenCount = 0;
  try {
    const [rows] = await db.query(
      `SELECT n.*, a.name AS sent_by_name, g.title AS game_title
       FROM notifications n
       LEFT JOIN admins a ON a.id = n.sent_by
       LEFT JOIN games  g ON g.id = n.game_id
       ORDER BY n.sent_at DESC
       LIMIT 100`
    );
    notifications = rows;

    const [scheduledRows] = await db.query(
      `SELECT s.*, a.name AS created_by_name
       FROM scheduled_notifications s
       LEFT JOIN admins a ON a.id = s.created_by
       ORDER BY s.status = 'pending' DESC,
                CASE WHEN s.status = 'pending' THEN s.scheduled_at END ASC,
                s.scheduled_at DESC
       LIMIT 100`
    );
    scheduled = scheduledRows;

    const [[countRow]] = await db.query('SELECT COUNT(DISTINCT user_id) AS c FROM push_tokens');
    tokenCount = countRow?.c || 0;
  } catch (_) {}

  res.render('sitehandler/notifications/index', {
    title: 'Notifications',
    activePage: 'notifications',
    notifications,
    scheduled,
    tokenCount,
    serverTz: SERVER_TZ,
    minScheduleAt: toDateTimeLocal(new Date(Date.now() + 60 * 1000)),
    formatServerTime,
  });
};

// ── POST /sitehandler/notifications/:id/delete ───────────────────────────────
exports.postDelete = async (req, res) => {
  try {
    await db.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    req.flash('success_msg', 'Notification deleted.');
  } catch (err) {
    req.flash('error_msg', 'Failed to delete: ' + err.message);
  }
  res.redirect('/sitehandler/notifications');
};

// ── POST /sitehandler/notifications/send ─────────────────────────────────────
exports.postSend = async (req, res) => {
  const { title, message, imageUrl } = readMessage(req.body);
  if (!title || !message) {
    req.flash('error_msg', 'Title and message body are required.');
    return res.redirect('/sitehandler/notifications');
  }

  try {
    await fcm.sendAndSaveNotification({
      type:     'custom',
      title,
      body:     message,
      imageUrl,
      sentBy:   req.session.admin.id,
      data:     { type: 'custom' },
    });
    req.flash('success_msg', `Notification "${title}" sent to all users.`);
  } catch (err) {
    req.flash('error_msg', 'Failed to send: ' + err.message);
  }
  res.redirect('/sitehandler/notifications');
};

// ── POST /sitehandler/notifications/schedule ─────────────────────────────────
exports.postSchedule = async (req, res) => {
  const { title, message, imageUrl } = readMessage(req.body);
  if (!title || !message) {
    req.flash('error_msg', 'Title and message body are required.');
    return res.redirect('/sitehandler/notifications');
  }

  // datetime-local values carry no offset, so new Date() reads them as server-local time.
  const raw = String(req.body.scheduled_at || '');
  const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? new Date(raw) : null;
  if (!when || Number.isNaN(when.getTime())) {
    req.flash('error_msg', 'Pick a date and time to schedule this notification.');
    return res.redirect('/sitehandler/notifications');
  }
  if (when.getTime() < Date.now() + 60 * 1000) {
    req.flash('error_msg', `The scheduled time must be at least 1 minute from now (${SERVER_TZ}).`);
    return res.redirect('/sitehandler/notifications');
  }

  try {
    await db.query(
      `INSERT INTO scheduled_notifications (title, body, image_url, scheduled_at, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [title, message, imageUrl, when, req.session.admin.id]
    );
    req.flash('success_msg', `Notification "${title}" scheduled for ${formatServerTime(when)}.`);
  } catch (err) {
    req.flash('error_msg', 'Failed to schedule: ' + err.message);
  }
  res.redirect('/sitehandler/notifications');
};

// ── POST /sitehandler/notifications/scheduled/:id/cancel ─────────────────────
exports.postCancelScheduled = async (req, res) => {
  try {
    const [r] = await db.query(
      `UPDATE scheduled_notifications SET status = 'cancelled', processed_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.params.id]
    );
    if (r.affectedRows) req.flash('success_msg', 'Scheduled notification cancelled.');
    else req.flash('error_msg', 'That notification is no longer pending — it may already have been sent.');
  } catch (err) {
    req.flash('error_msg', 'Failed to cancel: ' + err.message);
  }
  res.redirect('/sitehandler/notifications');
};
