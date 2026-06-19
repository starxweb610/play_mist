const db  = require('../../config/database');
const fcm = require('../../utils/fcm');

// ── GET /sitehandler/notifications ───────────────────────────────────────────
exports.getIndex = async (req, res) => {
  let notifications = [], tokenCount = 0;
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

    const [[countRow]] = await db.query('SELECT COUNT(DISTINCT user_id) AS c FROM push_tokens');
    tokenCount = countRow?.c || 0;
  } catch (_) {}

  res.render('sitehandler/notifications/index', {
    title: 'Notifications',
    activePage: 'notifications',
    notifications,
    tokenCount,
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
  const { title, body, image_url } = req.body;
  if (!title?.trim() || !body?.trim()) {
    req.flash('error_msg', 'Title and message body are required.');
    return res.redirect('/sitehandler/notifications');
  }

  try {
    await fcm.sendAndSaveNotification({
      type:     'custom',
      title:    title.trim(),
      body:     body.trim(),
      imageUrl: image_url?.trim() || null,
      sentBy:   req.session.admin.id,
      data:     { type: 'custom' },
    });
    req.flash('success_msg', `Notification "${title}" sent to all users.`);
  } catch (err) {
    req.flash('error_msg', 'Failed to send: ' + err.message);
  }
  res.redirect('/sitehandler/notifications');
};
