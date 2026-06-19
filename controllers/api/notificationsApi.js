const db = require('../../config/database');

// POST /api/v1/push-token
// Body: { fcm_token, device_id?, platform? }
exports.registerToken = async (req, res) => {
  const { fcm_token, device_id, platform } = req.body;
  const userId = req.user?.id;

  if (!fcm_token) return res.status(400).json({ error: 'fcm_token required' });
  if (!userId)    return res.status(401).json({ error: 'Unauthorized' });

  try {
    await db.query(
      `INSERT INTO push_tokens (user_id, fcm_token, device_id, platform)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE device_id = VALUES(device_id), platform = VALUES(platform), updated_at = NOW()`,
      [userId, fcm_token, device_id || null, platform || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('registerToken error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/v1/notifications
// Returns all notifications newest-first, with a read flag per user
exports.getNotifications = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [rows] = await db.query(
      `SELECT n.*,
              CASE WHEN r.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_read
       FROM notifications n
       LEFT JOIN user_notification_reads r
         ON r.notification_id = n.id AND r.user_id = ?
       ORDER BY n.sent_at DESC
       LIMIT 50`,
      [userId]
    );

    const unreadCount = rows.filter(r => !r.is_read).length;
    res.json({ notifications: rows, unreadCount });
  } catch (err) {
    console.error('getNotifications error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/v1/notifications/mark-read
// Marks all current notifications as read for this user
exports.markAllRead = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Get IDs of all unread notifications for this user
    const [unread] = await db.query(
      `SELECT n.id FROM notifications n
       LEFT JOIN user_notification_reads r ON r.notification_id = n.id AND r.user_id = ?
       WHERE r.user_id IS NULL`,
      [userId]
    );

    if (unread.length > 0) {
      const values = unread.map(n => [userId, n.id]);
      await db.query(
        'INSERT IGNORE INTO user_notification_reads (user_id, notification_id) VALUES ?',
        [values]
      );
    }

    res.json({ ok: true, marked: unread.length });
  } catch (err) {
    console.error('markAllRead error:', err);
    res.status(500).json({ error: err.message });
  }
};
