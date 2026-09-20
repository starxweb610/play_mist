/**
 * middleware/sandboxSdkLog.js — records what a Test Lab game's SDK calls did.
 *
 * Mounted on the player API routes the Playmist SDK calls (routes/api.js). It
 * never changes a response and never delays one: it notes the outcome as the
 * response goes out and writes the log row afterwards, fire-and-forget.
 *
 * ⚠ Real players pay nothing for this. The first check is an in-memory Set
 * lookup (utils/sandboxRegistry) on the game id or user id; anything that is
 * not a sandbox game or a test player calls next() and is never looked at
 * again. Only Test Lab traffic reaches a query.
 */
const db       = require('../config/database');
const registry = require('../utils/sandboxRegistry');

const KEEP_PER_GAME = 500;

const kb = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`);

/**
 * One line a developer can read at a glance — what happened, not the payload.
 * Failures carry the server's own error message, since that is precisely the
 * thing that used to disappear.
 */
const SUMMARISE = {
  saveData: (ok, body, req) => ok
    ? `saved ${kb(Buffer.byteLength(String(req.body?.data ?? ''), 'utf8'))}`
    : body?.error,
  loadData: (ok, body) => ok
    ? (body?.data ? `loaded ${kb(Buffer.byteLength(String(body.data), 'utf8'))}` : 'nothing saved yet — returned null')
    : body?.error,
  reportEvent: (ok, body) => ok
    ? `+${body.xpAwarded} XP · this game's total ${body.gameXp}`
    : body?.error,
  trackEvent: (ok, body) => ok
    ? (body.firstTime ? 'reached for the first time' : 'already reached — no-op')
    : body?.error,
  spendCredits: (ok, body, req, extra) => ok
    ? `${extra?.price != null ? `−${extra.price} credits · ` : ''}balance ${body.balance}`
    : (body?.error === 'Insufficient credits' ? `insufficient credits (balance ${body.balance})` : body?.error),
  getCredits: (ok, body) => ok ? `balance ${body?.credits}` : body?.error,
  getMultiplayerToken: (ok, body) => ok ? 'signalling token issued' : body?.error,
};

/**
 * @param {string} method   the SDK method this route serves (Playmist.<method>)
 * @param {object} opts
 * @param {'game'|'account'} opts.scope  game routes carry :gameId; account
 *        routes (getCredits, getMultiplayerToken) do not
 * @param {string} [opts.keyField]       request body field holding the SDK key
 */
module.exports = function logSandboxSdkCall(method, { scope = 'game', keyField } = {}) {
  return async (req, res, next) => {
    try {
      await registry.load();

      const userId = req.user?.id;
      const relevant = scope === 'game'
        ? registry.isSandboxGame(req.params.gameId)
        : registry.isTestUser(userId);
      if (!relevant) return next();

      // Keep the body the controller answers with; the status is read off the
      // response once it has actually been sent.
      let responseBody;
      const json = res.json.bind(res);
      res.json = (body) => { responseBody = body; return json(body); };

      res.on('finish', () => {
        record({ method, scope, keyField, req, res, userId, body: responseBody })
          .catch(err => console.error('sandbox SDK log failed:', err.message));
      });
    } catch (err) {
      // Logging must never be the reason a game call fails.
      console.error('sandbox SDK log setup failed:', err.message);
    }
    next();
  };
};

async function record({ method, scope, keyField, req, res, userId, body }) {
  let gameId = scope === 'game' ? Number(req.params.gameId) : null;
  if (!gameId) {
    const [[row]] = await db.query('SELECT last_sandbox_game_id AS g FROM users WHERE id = ?', [userId]);
    gameId = row?.g;
    if (!gameId) return;   // an account call from no session we know of
  }

  const ok  = res.statusCode >= 200 && res.statusCode < 300;
  const key = keyField ? String(req.body?.[keyField] ?? '').slice(0, 120) || null : null;

  // The purchase response carries the balance but not the price, and "what did
  // that cost?" is the first thing a developer asks — so look it up. This only
  // ever runs for sandbox games.
  let extra = null;
  if (method === 'spendCredits' && ok && key) {
    const [[item]] = await db.query(
      'SELECT price_credits FROM game_shop_items WHERE game_id = ? AND item_key = ?', [gameId, key]);
    extra = { price: item?.price_credits };
  }

  let detail = null;
  try { detail = SUMMARISE[method]?.(ok, body || {}, req, extra) || null; } catch { detail = null; }
  if (!ok && !detail) detail = `HTTP ${res.statusCode}`;

  const [result] = await db.query(
    `INSERT INTO sandbox_sdk_calls (game_id, user_id, method, sdk_key, ok, status, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [gameId, userId, method, key, ok ? 1 : 0, res.statusCode, detail ? String(detail).slice(0, 500) : null]
  );

  // Bounded without a scheduler: every 50th row trims that game's log back to
  // its most recent KEEP_PER_GAME calls.
  if (result.insertId % 50 === 0) {
    await db.query(
      `DELETE FROM sandbox_sdk_calls
       WHERE game_id = ? AND id < (
         SELECT id FROM (
           SELECT id FROM sandbox_sdk_calls WHERE game_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?
         ) AS keep_from
       )`,
      [gameId, gameId, KEEP_PER_GAME - 1]
    );
  }
}
