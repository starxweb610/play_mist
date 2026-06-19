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

// Send to all stored device tokens (multicast, max 500 per batch)
// Returns the number of tokens targeted.
exports.sendBroadcast = async ({ title, body, imageUrl, data = {} }) => {
  const m = getMessaging();

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
        android: { priority: 'high' },
        apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
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
