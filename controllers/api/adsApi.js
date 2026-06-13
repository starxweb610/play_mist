const crypto = require('crypto');
const db = require('../../config/database');

const VERIFIER_KEYS_URL = 'https://gstatic.com/admob/reward/verifier-keys.json';
const KEYS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REWARDED_ADS_DAILY_CAP = 20;

let keysCache = { fetchedAt: 0, byKeyId: new Map() };

const fetchVerifierKeys = async () => {
  const res = await fetch(VERIFIER_KEYS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch AdMob verifier keys: ${res.status}`);
  }
  const data = await res.json();
  const byKeyId = new Map();
  for (const key of data.keys || []) {
    byKeyId.set(String(key.keyId), key.pem);
  }
  keysCache = { fetchedAt: Date.now(), byKeyId };
  return byKeyId;
};

const getVerifierPem = async (keyId) => {
  if (Date.now() - keysCache.fetchedAt > KEYS_CACHE_TTL_MS || !keysCache.byKeyId.has(String(keyId))) {
    await fetchVerifierKeys();
  }
  return keysCache.byKeyId.get(String(keyId));
};

// Base64url -> standard base64 (Node's Buffer accepts 'base64url' directly,
// kept explicit here for clarity of the AdMob signature format).
const base64UrlToBuffer = (value) => Buffer.from(value, 'base64url');

/**
 * Verifies an AdMob rewarded-ad SSV callback request.
 * The signed content is the raw query string up to (but not including)
 * "&signature=" — must be taken verbatim from the request URL, not rebuilt
 * from parsed params, since encoding/order matters for the signature.
 */
const verifySsvSignature = async (req) => {
  const { signature, key_id: keyId } = req.query;
  if (!signature || !keyId) return false;

  const rawQuery = req.originalUrl.split('?')[1] || '';
  const sigMarker = '&signature=';
  const sigIndex = rawQuery.indexOf(sigMarker);
  if (sigIndex === -1) return false;
  const content = rawQuery.slice(0, sigIndex);

  const pem = await getVerifierPem(keyId);
  if (!pem) return false;

  try {
    return crypto.verify('sha256', Buffer.from(content), pem, base64UrlToBuffer(signature));
  } catch (err) {
    console.error('SSV signature verification error:', err.message);
    return false;
  }
};

/**
 * GET /api/v1/ads/ssv-callback
 * Called server-to-server by AdMob after a rewarded ad view is confirmed.
 * Credits the user named in `user_id` (set via the app's ssv.userId option)
 * with `reward_amount`, once per `transaction_id`.
 */
exports.ssvCallback = async (req, res) => {
  try {
    const isValid = await verifySsvSignature(req);
    if (!isValid) {
      console.warn('SSV callback rejected: invalid signature', req.query);
      return res.status(403).send('Invalid signature');
    }

    const userId = parseInt(req.query.user_id, 10);
    const rewardAmount = parseInt(req.query.reward_amount, 10);
    const transactionId = req.query.transaction_id;

    // AdMob's "Verify URL" check sends a signed ping without a real
    // user_id/reward_amount/transaction_id when those test fields are left
    // blank. The signature is already validated above, so acknowledge with
    // 200 rather than failing verification — there's just nothing to credit.
    if (!userId || !rewardAmount || !transactionId) {
      console.warn('SSV callback: signature valid but missing fields, nothing to credit', req.query);
      return res.status(200).send('OK (no-op)');
    }

    const [existing] = await db.query(
      'SELECT id FROM credit_transactions WHERE ad_transaction_id = ?',
      [transactionId]
    );
    if (existing.length > 0) {
      return res.status(200).send('Already processed');
    }

    const [todayRewards] = await db.query(
      `SELECT COUNT(*) AS c FROM credit_transactions
       WHERE user_id = ? AND credits_used < 0 AND created_at >= CURDATE()`,
      [userId]
    );
    if (todayRewards[0].c >= REWARDED_ADS_DAILY_CAP) {
      console.warn(`SSV callback skipped: daily cap reached for user ${userId}`);
      return res.status(200).send('Daily cap reached');
    }

    // Insert the transaction record and the credit update together, so a
    // failure on either side can never leave credits granted without a
    // matching transaction row (or vice versa).
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        'INSERT INTO credit_transactions (user_id, game_id, credits_used, ad_transaction_id) VALUES (?, NULL, ?, ?)',
        [userId, -rewardAmount, transactionId]
      );

      const [result] = await connection.query(
        'UPDATE users SET credits = COALESCE(credits, 1000) + ? WHERE id = ?',
        [rewardAmount, userId]
      );
      if (result.affectedRows === 0) {
        await connection.rollback();
        console.warn(`SSV callback: unknown user ${userId}`);
        return res.status(200).send('Unknown user');
      }

      await connection.commit();
      return res.status(200).send('OK');
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(200).send('Already processed');
      }
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('ssvCallback error:', err);
    return res.status(500).send('Internal error');
  }
};
