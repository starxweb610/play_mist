/**
 * controllers/devapi/sandboxApi.js — the Test Lab.
 *
 * A developer testing a build in the Studio app has to see exactly what a
 * player will see. The way to guarantee that is not to simulate the player
 * path but to *use* it: the app downloads a zip, extracts it, serves it from
 * the same local HTTP server, opens the same GameViewerActivity and gets the
 * same PlaymistBridge, which calls the same /api/v1 endpoints. Nothing in
 * that chain knows it is a test.
 *
 * What makes that possible is provisioning two real rows:
 *
 *   · a sandbox `games` row (is_sandbox = 1, is_active = 0) — so game_saves,
 *     game_xp_events, game_shop_items and game_funnel_events all key off a
 *     real games.id, and the player controllers need no sandbox branch;
 *   · a test `users` row (is_test_account = 1, owned by the developer) — so
 *     credits, XP and saves are real rows the developer can inspect, reset
 *     and top up.
 *
 * Containment: is_active = 0 already keeps a sandbox game out of every
 * catalogue query, the public site, the sitemap and the daily pick (the same
 * rule that contains coming-soon titles, §5.5). is_sandbox is the second lock
 * and the one the admin panel filters on. A test player never registers a
 * device, so it cannot appear in DAU or push.
 */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const jwt    = require('jsonwebtoken');
const db     = require('../../config/database');
const gameBuild = require('../../utils/gameBuild');
const buildApi  = require('./buildApi');
const registry  = require('../../utils/sandboxRegistry');
const { matchClause } = require('../../utils/slugs');

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Build tokens live in memory, exactly like the Game Builder's preview tokens
 * (§5.7) and for the same reason: the downloader on the other end cannot
 * authenticate. WebGLPlayerPlugin.downloadFile() is a plain HttpURLConnection
 * with no Authorization header — and it is deliberately left that way, since
 * every byte of that Kotlin file is shared with the player app. So the URL
 * itself is the authorisation: single project, short-lived, unguessable.
 */
const buildTokens = new Map();

function issueBuildToken(developerId, projectId, rootDir) {
  const token = crypto.randomBytes(24).toString('hex');
  buildTokens.set(token, { developerId, projectId, rootDir, expires: Date.now() + TOKEN_TTL_MS });
  for (const [key, value] of buildTokens) if (value.expires < Date.now()) buildTokens.delete(key);
  return token;
}

async function ownedProject(idOrSlug, devId) {
  const match = matchClause(idOrSlug);
  if (!match) return null;
  const [rows] = await db.query(
    `SELECT * FROM developer_projects WHERE ${match.sql} AND developer_id = ?`,
    [...match.params, devId]
  );
  return rows[0] || null;
}

/**
 * A fingerprint of the workspace's current contents. The Studio app stores it
 * next to the extracted build and re-downloads only when it changes, which is
 * the same version check LaunchModal does for a real game — so "no download
 * this time" in the Test Lab means the same thing it means to a player.
 */
function buildSignature(root) {
  const parts = [];
  const walk = (dir, rel = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else {
        const st = fs.statSync(abs);
        parts.push(`${relPath}:${st.size}:${Math.round(st.mtimeMs)}`);
      }
    }
  };
  walk(root);
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

// ── Test player ──────────────────────────────────────────────────────────────

const TEST_PLAYER_CREDITS = 5000;

/** The developer's test player, created on first use and reused forever after. */
async function ensureTestPlayer(developerId, studioName) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE owner_developer_id = ? AND is_test_account = 1 LIMIT 1',
    [developerId]
  );
  if (rows.length) { registry.addUser(rows[0].id); return rows[0]; }

  // The username is visible to the game through getUserProfile(), so it reads
  // like a real player's name rather than an internal id.
  const base  = (studioName || 'Studio').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'Studio';
  const username = `${base}Tester${developerId}`;
  const email    = `devtest_${developerId}@playmist.local`;

  const [result] = await db.query(
    `INSERT INTO users (username, email, display_name, credits, is_test_account, owner_developer_id)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [username, email, `${base} Tester`, TEST_PLAYER_CREDITS, developerId]
  );
  const [[created]] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
  registry.addUser(created.id);
  return created;
}

/** Player tokens, minted the same way authApi mints them for a real device. */
function playerTokens(user) {
  const accessSecret  = process.env.JWT_SECRET         || 'playmist_jwt_access_secret_123';
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'playmist_jwt_refresh_secret_123';
  return {
    accessToken:  jwt.sign({ id: user.id, username: user.username }, accessSecret,  { expiresIn: '1h' }),
    refreshToken: jwt.sign({ id: user.id, username: user.username }, refreshSecret, { expiresIn: '7d' }),
  };
}

// ── Sandbox game row ─────────────────────────────────────────────────────────

async function ensureSandboxGame(project, developer) {
  if (project.sandbox_game_id) {
    const [rows] = await db.query(
      'SELECT * FROM games WHERE id = ? AND is_sandbox = 1', [project.sandbox_game_id]
    );
    if (rows.length) { registry.addGame(rows[0].id); return rows[0]; }
  }

  // slug is UNIQUE across the catalogue; the sandbox prefix keeps a test row
  // from ever colliding with (or being mistaken for) a published game.
  const slug = `sandbox-dev${developer.id}-p${project.id}`;
  const [result] = await db.query(
    `INSERT INTO games (title, slug, genre, type, orientation, version,
                        is_active, is_sandbox, release_stage, credits_cost, developer_id, short_description)
     VALUES (?, ?, 'Sandbox', 'webgl', 'landscape', '0.0.0', 0, 1, 'in_development', 0, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title)`,
    [`[TEST] ${project.name}`, slug, developer.id, 'Studio test build — never published']
  );

  let gameId = result.insertId;
  if (!gameId) {
    const [[existing]] = await db.query('SELECT id FROM games WHERE slug = ?', [slug]);
    gameId = existing.id;
  }
  await db.query('UPDATE developer_projects SET sandbox_game_id = ? WHERE id = ?', [gameId, project.id]);
  const [[game]] = await db.query('SELECT * FROM games WHERE id = ?', [gameId]);
  registry.addGame(game.id);
  return game;
}

// ── POST /sandbox/:project/session ───────────────────────────────────────────
/**
 * Everything the Studio app needs to launch one test run. The response is
 * shaped to be handed almost verbatim to GameViewer.open(), because the app
 * passes the same launch params the player app does.
 */
exports.createSession = async (req, res) => {
  const developer = req.session.developer;
  try {
    const project = await ownedProject(req.params.project, developer.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    // Either source — the Game Builder workspace, or a zip the developer
    // exported from Godot/Unity and uploaded. By this point both are just a
    // directory with an index.html at the root, and the rest of the launch
    // cannot tell them apart (which is the point: one tested path).
    const root = buildApi.resolveBuildRoot(project, developer.id);
    if (!root) {
      return res.status(400).json({
        error: buildApi.missingBuildError(project),
        needsWorkspace: project.build_source !== 'upload',
        needsUpload:    project.build_source === 'upload',
      });
    }

    const game   = await ensureSandboxGame(project, developer);
    const player = await ensureTestPlayer(developer.id, developer.studio_name);
    const token  = issueBuildToken(developer.id, project.id, root);
    const orientation = req.body?.orientation === 'portrait' ? 'portrait' : 'landscape';

    // Remembered so the next launch opens in the orientation the developer
    // last chose, and so the sandbox row mirrors what they'll submit.
    await db.query('UPDATE games SET orientation = ? WHERE id = ?', [orientation, game.id]);

    // getCredits() and getMultiplayerToken() carry no game id; the SDK log
    // attributes them to the game this session is about to launch.
    await db.query('UPDATE users SET last_sandbox_game_id = ? WHERE id = ?', [game.id, player.id]);

    res.json({
      gameId:      game.id,
      version:     buildSignature(root),
      buildUrl:    `/api/dev/v1/sandbox-build/${token}.zip`,
      orientation,
      player: {
        ...playerTokens(player),
        userId:      String(player.id),
        credits:     player.credits,
        profileJson: JSON.stringify({
          displayName: player.display_name || player.username,
          avatarUrl:   player.avatar || null,
        }),
      },
    });
  } catch (err) {
    console.error('devapi sandbox session error:', err);
    res.status(500).json({ error: 'Could not start a test session.' });
  }
};

// ── GET /sandbox-build/:token.zip (token-authorised, outside the JWT gate) ──
exports.downloadBuild = (req, res) => {
  const token = String(req.params.token || '').replace(/\.zip$/, '');
  const entry = buildTokens.get(token);
  if (!entry || entry.expires < Date.now()) {
    buildTokens.delete(token);
    return res.status(404).json({ error: 'This build link has expired. Start the test again.' });
  }
  try {
    // gameBuild's packer, not the Game Builder's: the editor allowlist covers
    // files you can edit in a browser and would silently drop the .wasm and
    // .pck of an engine export, leaving a blank screen on the device.
    const buffer = gameBuild.packDirectory(entry.rootDir);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    console.error('devapi sandbox build error:', err);
    res.status(500).json({ error: 'Failed to package the build.' });
  }
};

// ── Test player wallet ───────────────────────────────────────────────────────

exports.getTestPlayer = async (req, res) => {
  try {
    const player = await ensureTestPlayer(req.session.developer.id, req.session.developer.studio_name);
    res.json({
      player: {
        id: player.id, username: player.username,
        displayName: player.display_name || player.username,
        credits: player.credits, xp: player.xp, level: player.level,
      },
    });
  } catch (err) {
    console.error('devapi getTestPlayer error:', err);
    res.status(500).json({ error: 'Failed to load the test player.' });
  }
};

/** Top up the test wallet. Test credits are minted, never earned — but they
 *  are spent through the real economy, so an in-game purchase behaves (and
 *  fails) exactly as it will for a player. */
exports.topUpTestPlayer = async (req, res) => {
  const amount = Math.min(Math.max(parseInt(req.body?.amount, 10) || 1000, 1), 100000);
  try {
    const player = await ensureTestPlayer(req.session.developer.id, req.session.developer.studio_name);
    await db.query('UPDATE users SET credits = COALESCE(credits, 0) + ? WHERE id = ?', [amount, player.id]);
    const [[row]] = await db.query('SELECT credits FROM users WHERE id = ?', [player.id]);
    res.json({ credits: row.credits });
  } catch (err) {
    console.error('devapi topUpTestPlayer error:', err);
    res.status(500).json({ error: 'Top-up failed.' });
  }
};

/**
 * Wipe this project's test state: the cloud save, this game's XP, funnel
 * progress. Purpose-built for "does my first-run experience work?", which is
 * otherwise only testable once per account.
 */
exports.resetProgress = async (req, res) => {
  const developer = req.session.developer;
  try {
    const project = await ownedProject(req.params.project, developer.id);
    if (!project?.sandbox_game_id) return res.json({ ok: true, cleared: 0 });

    const player = await ensureTestPlayer(developer.id, developer.studio_name);
    const gameId = project.sandbox_game_id;

    const [save] = await db.query('DELETE FROM game_saves WHERE user_id = ? AND game_id = ?', [player.id, gameId]);
    await db.query('DELETE FROM game_xp WHERE user_id = ? AND game_id = ?', [player.id, gameId]);
    await db.query('DELETE FROM game_xp_event_completions WHERE user_id = ? AND game_id = ?', [player.id, gameId]);
    await db.query(
      `DELETE p FROM game_funnel_progress p
       JOIN game_funnel_events e ON e.id = p.event_id
       WHERE p.user_id = ? AND e.game_id = ?`,
      [player.id, gameId]
    );
    res.json({ ok: true, cleared: save.affectedRows });
  } catch (err) {
    console.error('devapi resetProgress error:', err);
    res.status(500).json({ error: 'Could not reset the test session.' });
  }
};

// ── SDK configuration (XP events, shop items, funnel milestones) ─────────────
// A game's XP amounts and item prices are server-side truth (§ GAME_SDK). In
// production an admin configures them; in the Test Lab the developer does, on
// their own sandbox game, so an event key can be tried before it is proposed.

const CONFIG_TABLES = {
  'xp-events': {
    table: 'game_xp_events',
    columns: ['event_key', 'name', 'xp_reward', 'is_active'],
    shape: (r) => ({ id: r.id, eventKey: r.event_key, name: r.name, xpReward: r.xp_reward, isActive: !!r.is_active }),
    read: (b) => ({
      event_key: String(b.eventKey || '').trim().slice(0, 80),
      name:      String(b.name || b.eventKey || '').trim().slice(0, 120),
      xp_reward: Math.min(Math.max(parseInt(b.xpReward, 10) || 0, 0), 100000),
      is_active: b.isActive === false ? 0 : 1,
    }),
  },
  'shop-items': {
    table: 'game_shop_items',
    columns: ['item_key', 'name', 'price_credits', 'is_active'],
    shape: (r) => ({ id: r.id, itemKey: r.item_key, name: r.name, priceCredits: r.price_credits, isActive: !!r.is_active }),
    read: (b) => ({
      item_key:      String(b.itemKey || '').trim().slice(0, 80),
      name:          String(b.name || b.itemKey || '').trim().slice(0, 120),
      price_credits: Math.min(Math.max(parseInt(b.priceCredits, 10) || 0, 0), 1000000),
      is_active:     b.isActive === false ? 0 : 1,
    }),
  },
  'funnel-events': {
    table: 'game_funnel_events',
    columns: ['event_key', 'name', 'step_order', 'is_active'],
    shape: (r) => ({ id: r.id, eventKey: r.event_key, name: r.name, stepOrder: r.step_order, isActive: !!r.is_active }),
    read: (b) => ({
      event_key:  String(b.eventKey || '').trim().slice(0, 80),
      name:       String(b.name || b.eventKey || '').trim().slice(0, 120),
      step_order: Math.min(Math.max(parseInt(b.stepOrder, 10) || 0, 0), 1000),
      is_active:  b.isActive === false ? 0 : 1,
    }),
  },
};

/** Resolves :kind and the caller's sandbox game together — every handler below
 *  needs both, and neither is safe to trust on its own. */
async function configContext(req, res) {
  const spec = CONFIG_TABLES[req.params.kind];
  if (!spec) {
    res.status(404).json({ error: 'Unknown configuration type.' });
    return null;
  }
  const developer = req.session.developer;
  const project   = await ownedProject(req.params.project, developer.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return null;
  }
  const game = await ensureSandboxGame(project, developer);
  return { spec, project, game };
}

exports.listConfig = async (req, res) => {
  try {
    const ctx = await configContext(req, res);
    if (!ctx) return;
    const [rows] = await db.query(
      `SELECT * FROM ${ctx.spec.table} WHERE game_id = ? ORDER BY id ASC`, [ctx.game.id]
    );
    res.json({ items: rows.map(ctx.spec.shape) });
  } catch (err) {
    console.error('devapi listConfig error:', err);
    res.status(500).json({ error: 'Failed to load configuration.' });
  }
};

exports.createConfig = async (req, res) => {
  try {
    const ctx = await configContext(req, res);
    if (!ctx) return;
    const values = ctx.spec.read(req.body || {});
    const keyColumn = ctx.spec.columns[0];
    if (!values[keyColumn]) return res.status(400).json({ error: 'A key is required.' });

    const cols = ['game_id', ...ctx.spec.columns];
    const [result] = await db.query(
      `INSERT INTO ${ctx.spec.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      [ctx.game.id, ...ctx.spec.columns.map(c => values[c])]
    );
    const [[row]] = await db.query(`SELECT * FROM ${ctx.spec.table} WHERE id = ?`, [result.insertId]);
    res.status(201).json({ item: ctx.spec.shape(row) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That key already exists for this project.' });
    console.error('devapi createConfig error:', err);
    res.status(500).json({ error: 'Failed to save.' });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const ctx = await configContext(req, res);
    if (!ctx) return;
    const values = ctx.spec.read(req.body || {});
    // game_id in the WHERE clause is the ownership check: a row id from
    // someone else's game simply matches nothing.
    const [result] = await db.query(
      `UPDATE ${ctx.spec.table} SET ${ctx.spec.columns.map(c => `${c} = ?`).join(', ')}
       WHERE id = ? AND game_id = ?`,
      [...ctx.spec.columns.map(c => values[c]), req.params.itemId, ctx.game.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Not found.' });
    const [[row]] = await db.query(`SELECT * FROM ${ctx.spec.table} WHERE id = ?`, [req.params.itemId]);
    res.json({ item: ctx.spec.shape(row) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That key already exists for this project.' });
    console.error('devapi updateConfig error:', err);
    res.status(500).json({ error: 'Failed to save.' });
  }
};

exports.deleteConfig = async (req, res) => {
  try {
    const ctx = await configContext(req, res);
    if (!ctx) return;
    const [result] = await db.query(
      `DELETE FROM ${ctx.spec.table} WHERE id = ? AND game_id = ?`, [req.params.itemId, ctx.game.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('devapi deleteConfig error:', err);
    res.status(500).json({ error: 'Failed to delete.' });
  }
};


// ── SDK activity: what the game's Playmist calls actually did ────────────────

/** What the SDK calls map to, for the per-item view in SDK setup. */
const CONFIG_METHOD = { 'xp-events': 'reportEvent', 'shop-items': 'spendCredits', 'funnel-events': 'trackEvent' };

async function projectSandboxGameId(req) {
  const project = await ownedProject(req.params.project, req.session.developer.id);
  if (!project) return { missing: true };
  return { gameId: project.sandbox_game_id || null };
}

/**
 * GET /sandbox/:project/activity?limit=100
 * The newest calls first — the log the Test Lab shows after a session.
 */
exports.listActivity = async (req, res) => {
  try {
    const { missing, gameId } = await projectSandboxGameId(req);
    if (missing) return res.status(404).json({ error: 'Project not found.' });
    if (!gameId) return res.json({ calls: [] });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const [rows] = await db.query(
      `SELECT id, method, sdk_key, ok, status, detail, created_at
       FROM sandbox_sdk_calls WHERE game_id = ? ORDER BY id DESC LIMIT ?`,
      [gameId, limit]
    );
    res.json({
      calls: rows.map(r => ({
        id: r.id, method: r.method, key: r.sdk_key, ok: !!r.ok,
        status: r.status, detail: r.detail, at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('devapi listActivity error:', err);
    res.status(500).json({ error: 'Failed to load SDK activity.' });
  }
};

/** DELETE /sandbox/:project/activity */
exports.clearActivity = async (req, res) => {
  try {
    const { missing, gameId } = await projectSandboxGameId(req);
    if (missing) return res.status(404).json({ error: 'Project not found.' });
    if (gameId) await db.query('DELETE FROM sandbox_sdk_calls WHERE game_id = ?', [gameId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('devapi clearActivity error:', err);
    res.status(500).json({ error: 'Failed to clear SDK activity.' });
  }
};

/**
 * GET /sandbox/:project/usage/:kind
 * For each key of one config kind: how many times the game used it, when it
 * last succeeded, and the last error. Plus the keys the game used that are NOT
 * configured — a mistyped key is a silent 404 in the game, and this is the
 * only place it becomes visible.
 */
exports.usage = async (req, res) => {
  const method = CONFIG_METHOD[req.params.kind];
  if (!method) return res.status(404).json({ error: 'Unknown configuration type.' });
  try {
    const { missing, gameId } = await projectSandboxGameId(req);
    if (missing) return res.status(404).json({ error: 'Project not found.' });
    if (!gameId) return res.json({ keys: {}, unconfigured: [] });

    const [rows] = await db.query(
      `SELECT sdk_key,
              SUM(ok = 1)                           AS ok_count,
              SUM(ok = 0)                           AS fail_count,
              MAX(CASE WHEN ok = 1 THEN created_at END) AS last_ok_at,
              MAX(created_at)                       AS last_at,
              SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN ok = 0 THEN detail END ORDER BY id DESC SEPARATOR '\n'), '\n', 1) AS last_error
       FROM sandbox_sdk_calls
       WHERE game_id = ? AND method = ? AND sdk_key IS NOT NULL
       GROUP BY sdk_key`,
      [gameId, method]
    );

    const spec = CONFIG_TABLES[req.params.kind];
    const keyColumn = spec.columns[0];
    const [configured] = await db.query(
      `SELECT ${keyColumn} AS k FROM ${spec.table} WHERE game_id = ?`, [gameId]);
    const known = new Set(configured.map(c => c.k));

    const keys = {};
    const unconfigured = [];
    for (const r of rows) {
      const entry = {
        okCount: Number(r.ok_count), failCount: Number(r.fail_count),
        lastOkAt: r.last_ok_at, lastAt: r.last_at, lastError: r.last_error || null,
      };
      if (known.has(r.sdk_key)) keys[r.sdk_key] = entry;
      else unconfigured.push({ key: r.sdk_key, ...entry });
    }
    unconfigured.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    res.json({ method, keys, unconfigured });
  } catch (err) {
    console.error('devapi usage error:', err);
    res.status(500).json({ error: 'Failed to load SDK usage.' });
  }
};
