const path = require('path');
const db   = require('../config/database');

let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;

  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled');
    return null;
  }

  try {
    // firebase-admin v12+ uses modular API
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getMessaging: _getMsg }        = require('firebase-admin/messaging');

    if (getApps().length === 0) {
      const serviceAccount = require(path.resolve(process.cwd(), saPath));
      initializeApp({ credential: cert(serviceAccount) });
    }

    _messaging = _getMsg();
    console.log('✅ Firebase Admin initialized successfully');
    return _messaging;
  } catch (err) {
    console.error('Firebase Admin init error:', err.message);
    return null;
  }
}

// FCM can only fetch absolute http(s) URLs. Legacy rows store local paths
// like /images/foo.png — resolve those against BASE_URL, drop anything else.
function normalizeImageUrl(url) {
  if (!url) return null;
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  const base = (process.env.BASE_URL || '').replace(/\/+$/, '');
  if (u.startsWith('/') && base) return base + u;
  return null;
}

// Send to all stored device tokens (multicast, max 500 per batch)
// Returns the number of tokens targeted.
exports.sendBroadcast = async ({ title, body, imageUrl, data = {} }) => {
  const m = getMessaging();
  imageUrl = normalizeImageUrl(imageUrl);

  // Always fetch the real token count from DB
  let tokenRows = [];
  try {
    const [rows] = await db.query('SELECT DISTINCT fcm_token FROM push_tokens');
    tokenRows = rows;
  } catch (dbErr) {
    console.error('FCM: failed to fetch tokens from DB:', dbErr.message);
    return 0;
  }

  if (tokenRows.length === 0) {
    console.warn('FCM: no registered tokens to send to');
    return 0;
  }

  if (!m) {
    console.warn('FCM not configured — notification saved to DB but not delivered');
    return tokenRows.length; // still record the intended recipients
  }

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const tokens = tokenRows.map(r => r.fcm_token);
  const BATCH  = 500;
  let   sent   = 0;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    try {
      const result = await m.sendEachForMulticast({
        tokens: batch,
        notification: {
          title,
          body,
          ...(imageUrl ? { imageUrl } : {}),
        },
        data: stringData,
        android: {
          priority: 'high',
          // Image must also be set here for Android to render BigPicture
          notification: imageUrl ? { imageUrl } : {},
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              // Required so the iOS notification service extension can attach the image
              ...(imageUrl ? { 'mutable-content': 1 } : {}),
            },
          },
          ...(imageUrl ? { fcmOptions: { imageUrl } } : {}),
        },
      });

      sent += result.successCount;

      // Clean up tokens that are permanently invalid
      const invalid = [];
      result.responses.forEach((r, idx) => {
        if (!r.success && r.error) {
          const code = r.error.code;
          if (code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token') {
            invalid.push(batch[idx]);
          }
        }
      });
      if (invalid.length) {
        await db.query(
          `DELETE FROM push_tokens WHERE fcm_token IN (${invalid.map(() => '?').join(',')})`,
          invalid
        ).catch(() => {});
      }
    } catch (err) {
      console.error('FCM multicast error (batch):', err.message);
    }
  }

  console.log(`FCM: sent ${sent}/${tokens.length} successfully`);
  return tokens.length;
};

// Push to all users when a game goes live (inactive → active).
// Uses the secondary thumbnail as the notification image (falls back to primary).
exports.sendGameLiveNotification = async (gameId, sentBy = null) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, genre, short_description, secondary_thumbnail, thumbnail_url
       FROM games WHERE id = ?`,
      [gameId]
    );
    if (!rows.length) return null;

    const g    = rows[0];
    const desc = (g.short_description || '').trim();
    const body = desc
      ? `${desc.slice(0, 140)}${desc.length > 140 ? '…' : ''} Tap to play now!`
      : `"${g.title}"${g.genre ? ` — a new ${g.genre} game` : ''} just landed on Play Mist. Tap to play now!`;

    return await exports.sendAndSaveNotification({
      type:     'new_game',
      title:    `🎮 ${g.title} is now live!`,
      body,
      imageUrl: g.secondary_thumbnail || g.thumbnail_url || null,
      gameId:   g.id,
      sentBy,
      data:     { type: 'new_game', game_id: g.id },
    });
  } catch (err) {
    console.error('sendGameLiveNotification error:', err.message);
    return null;
  }
};

// Save a notification record to DB and fire the broadcast
exports.sendAndSaveNotification = async ({ type, title, body, imageUrl, gameId, sentBy, data = {} }) => {
  const totalRecipients = await exports.sendBroadcast({ title, body, imageUrl, data });

  try {
    const [result] = await db.query(
      `INSERT INTO notifications (type, title, body, image_url, data_json, game_id, sent_by, total_recipients)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        type || 'custom', title, body,
        imageUrl || null,
        Object.keys(data).length ? JSON.stringify(data) : null,
        gameId || null, sentBy || null, totalRecipients,
      ]
    );
    return result.insertId;
  } catch (err) {
    console.error('Failed to save notification:', err.message);
    return null;
  }
};
