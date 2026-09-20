/**
 * scripts/test-devapi.js — end-to-end test of the Studio app's surface.
 *
 * Walks the path the Playmist Developer Hub walks: log in, create a project,
 * open a test session, and confirm the session really is the player path —
 * the build downloads as a zip a device can extract, and the test player's
 * token works against the live /api/v1 endpoints the Playmist SDK calls.
 *
 * It also guards the containment rule: a sandbox game must never reach the
 * app's Coming Soon rail, which is the one catalogue query that does not
 * filter on is_active and therefore the one a test game could slip through.
 *
 * Needs the server running and the DB reachable. Writes and then deletes one
 * developer, one project, one sandbox game and one test player.
 *
 *   node scripts/test-devapi.js              # against localhost:3002
 *   BASE_URL=http://127.0.0.1:3599 node scripts/test-devapi.js
 */
const path = require('path');
const fs   = require('fs');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const AdmZip = require('adm-zip');

const ORIGIN = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3002}`;
const BASE = `${ORIGIN}/api/dev/v1`;
const EMAIL = 'studio_e2e@playmist.local';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  ← ${JSON.stringify(detail)?.slice(0, 200)}`}`);
  if (!ok) failures++;
};

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  // Schema the Test Lab depends on
  const [cols] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME='games' AND COLUMN_NAME='is_sandbox')
         OR (TABLE_NAME='users' AND COLUMN_NAME IN ('is_test_account','owner_developer_id'))
         OR (TABLE_NAME='developer_projects' AND COLUMN_NAME='sandbox_game_id'))`);
  check('migrations added the sandbox columns', cols.length === 4, cols);

  // A developer to act as
  await db.query('DELETE FROM developers WHERE email = ?', [EMAIL]);
  const [ins] = await db.query(
    `INSERT INTO developers (name, email, country, studio_name, password_hash, handle, is_active)
     VALUES ('E2E Tester', ?, 'IN', 'E2E Studio', ?, ?, 1)`,
    [EMAIL, await bcrypt.hash('hunter2hunter2', 10), `e2e_${Date.now().toString(36)}`]
  );
  const devId = ins.insertId;

  // 1. Login
  let res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'hunter2hunter2' }),
  });
  const session = await res.json();
  check('login returns tokens and the developer', res.status === 200 && !!session.accessToken && session.developer?.studioName === 'E2E Studio', session);
  const authed = { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };

  // 2. Create a project
  res = await fetch(`${BASE}/projects`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ name: 'E2E Rocket', description: 'from the e2e test' }),
  });
  const { project } = await res.json();
  check('project created', res.status === 201 && !!project?.id, project);

  // 3. Stand in for the Game Builder: a workspace with an index.html on disk
  const workspace = path.join(ROOT, 'uploads', 'builder', String(devId), String(project.id));
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'index.html'),
    '<!doctype html><html><body><script>window.Playmist&&Playmist.trackEvent("opened_game")</script></body></html>');
  fs.writeFileSync(path.join(workspace, 'game.js'), 'console.log("hello");');
  await db.query(
    `INSERT INTO developer_builder_workspaces (project_id, developer_id, template_name, rel_path)
     VALUES (?, ?, 'E2E Template', ?)`,
    [project.id, devId, `${devId}/${project.id}`]
  );

  // 4. A test session — the call the Test Lab's Run button makes
  res = await fetch(`${BASE}/sandbox/${project.slug}/session`, {
    method: 'POST', headers: authed, body: JSON.stringify({ orientation: 'portrait' }),
  });
  const sess = await res.json();
  check('test session mints a sandbox game + test player',
    res.status === 200 && !!sess.gameId && !!sess.player?.accessToken && !!sess.buildUrl, sess);
  check('session orientation is honoured', sess.orientation === 'portrait', sess.orientation);

  // 5. The sandbox game must be contained
  const [[game]] = await db.query('SELECT * FROM games WHERE id = ?', [sess.gameId]);
  check('sandbox game is inactive and flagged', game.is_active === 0 && game.is_sandbox === 1, game);
  const [[player]] = await db.query('SELECT * FROM users WHERE id = ?', [sess.player.userId]);
  check('test player is flagged and owned by the developer',
    player.is_test_account === 1 && player.owner_developer_id === devId, player);

  // 6. It must NOT reach the app's Coming Soon rail (the one catalogue query
  //    that doesn't filter is_active)
  res = await fetch(`${ORIGIN}/api/v1/coming-soon-games`, {
    headers: { Authorization: `Bearer ${sess.player.accessToken}` },
  });
  const comingSoon = await res.json();
  check('sandbox game stays off the Coming Soon rail',
    Array.isArray(comingSoon) && !comingSoon.some(g => g.id === sess.gameId),
    comingSoon);

  // 7. The device download link (no auth header — the Kotlin downloader sends none)
  res = await fetch(`${ORIGIN}${sess.buildUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let entries = [];
  try { entries = new AdmZip(buf).getEntries().map(e => e.entryName); } catch (_) {}
  check('build downloads as a zip with index.html at the root',
    res.status === 200 && entries.includes('index.html') && entries.includes('game.js'), entries);

  // 8. The player token the game will use actually works on the player API
  res = await fetch(`${ORIGIN}/api/v1/user/profile`, {
    headers: { Authorization: `Bearer ${sess.player.accessToken}` },
  });
  const profile = await res.json();
  check('the test player token works on the real player API',
    res.status === 200 && profile.credits >= 0, profile);

  // 9. The SDK path a game exercises: configure an XP event, then report it
  //    exactly as PlaymistBridge.reportEvent does.
  await fetch(`${BASE}/sandbox/${project.slug}/config/xp-events`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ eventKey: 'coin_collected', name: 'Collected a coin', xpReward: 10 }),
  });
  res = await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/xp-event`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sess.player.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventKey: 'coin_collected' }),
  });
  const xp = await res.json();
  check('Playmist.reportEvent awards the configured XP', res.status === 200 && xp.xpAwarded === 10, xp);

  res = await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/xp-event`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sess.player.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventKey: 'not_configured' }),
  });
  check('an unconfigured event key rejects, as it would in production', res.status === 404, res.status);

  // 10. A cloud save round-trips (Playmist.saveData → loadData)
  await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sess.player.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '{"level":5}' }),
  });
  res = await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/save`, {
    headers: { Authorization: `Bearer ${sess.player.accessToken}` },
  });
  const save = await res.json();
  check('cloud save round-trips for the test player', save.data === '{"level":5}', save);

  // 11. Reset progress clears it
  await fetch(`${BASE}/sandbox/${project.slug}/reset-progress`, { method: 'POST', headers: authed, body: '{}' });
  res = await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/save`, {
    headers: { Authorization: `Bearer ${sess.player.accessToken}` },
  });
  check('reset clears the cloud save', (await res.json()).data === '', 'save survived reset');

  // ── SDK activity: every call the game made, and what it did ───────────────
  // A shop item the game can buy, and one call with a mistyped key — the kind
  // of failure that used to be a silent 404 with no trace anywhere.
  await fetch(`${BASE}/sandbox/${project.slug}/config/shop-items`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ itemKey: 'extra_life', name: 'Extra life', priceCredits: 50 }),
  });
  const asPlayer = { Authorization: `Bearer ${sess.player.accessToken}`, 'Content-Type': 'application/json' };
  await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/purchase`, {
    method: 'POST', headers: asPlayer, body: JSON.stringify({ itemKey: 'extra_life' }) });
  await fetch(`${ORIGIN}/api/v1/games/${sess.gameId}/purchase`, {
    method: 'POST', headers: asPlayer, body: JSON.stringify({ itemKey: 'extra_lfe' }) });
  await fetch(`${ORIGIN}/api/v1/user/profile`, { headers: asPlayer });   // Playmist.getCredits()

  // The log is written as each response finishes, off the request path.
  await new Promise(r => setTimeout(r, 400));

  const activity = await (await fetch(`${BASE}/sandbox/${project.slug}/activity`, { headers: authed })).json();
  const calls = activity.calls || [];
  const find = (method, key) => calls.find(c => c.method === method && c.key === key);

  check('a successful purchase is logged with its price and the new balance',
    find('spendCredits', 'extra_life')?.ok === true
      && /−50 credits · balance \d+/.test(find('spendCredits', 'extra_life')?.detail || ''),
    find('spendCredits', 'extra_life'));
  check('a purchase with a mistyped key is logged as a failure, with the reason',
    find('spendCredits', 'extra_lfe')?.ok === false
      && /Unknown item/i.test(find('spendCredits', 'extra_lfe')?.detail || ''),
    find('spendCredits', 'extra_lfe'));
  check('XP events and cloud saves appear in the log',
    find('reportEvent', 'coin_collected')?.ok === true && calls.some(c => c.method === 'saveData'),
    calls.map(c => `${c.method}:${c.key}:${c.ok}`));
  check('getCredits (an account call, no game id) is attributed to this game',
    calls.some(c => c.method === 'getCredits' && c.ok), calls.map(c => c.method));

  const usage = await (await fetch(`${BASE}/sandbox/${project.slug}/usage/shop-items`, { headers: authed })).json();
  check('SDK setup can see that a configured shop item was used',
    usage.keys?.extra_life?.okCount === 1, usage);
  check('…and which keys the game used that are not configured',
    usage.unconfigured?.some(u => u.key === 'extra_lfe' && u.failCount === 1), usage.unconfigured);

  // Containment: a REAL player on a REAL game must never be logged.
  const realGame = (await db.query(
    'SELECT id FROM games WHERE is_sandbox = 0 AND is_active = 1 LIMIT 1'))[0][0];
  const reg = await (await fetch(`${ORIGIN}/api/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `devapi_real_${Date.now().toString(36)}` }) })).json();
  if (realGame && reg.accessToken) {
    await fetch(`${ORIGIN}/api/v1/games/${realGame.id}/save`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '{"real":true}' }) });
    await fetch(`${ORIGIN}/api/v1/user/profile`, { headers: { Authorization: `Bearer ${reg.accessToken}` } });
    await new Promise(r => setTimeout(r, 400));
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM sandbox_sdk_calls WHERE user_id = ?', [reg.user?.id ?? reg.userId ?? -1]);
    const [[{ onReal }]] = await db.query('SELECT COUNT(*) AS onReal FROM sandbox_sdk_calls WHERE game_id = ?', [realGame.id]);
    check('a real player on a real game is never logged', n === 0 && onReal === 0, { n, onReal });
    await db.query('DELETE FROM game_saves WHERE game_id = ? AND save_data = ?', [realGame.id, '{"real":true}']);
    await db.query("DELETE FROM users WHERE username LIKE 'devapi_real_%'");
  } else {
    check('a real player on a real game is never logged', false, 'no live game or registration failed');
  }

  res = await fetch(`${BASE}/sandbox/${project.slug}/activity`, { method: 'DELETE', headers: authed });
  const afterClear = await (await fetch(`${BASE}/sandbox/${project.slug}/activity`, { headers: authed })).json();
  check('the log can be cleared', res.status === 200 && afterClear.calls.length === 0, afterClear.calls.length);

  // ── Uploaded builds (an engine export, not the in-app editor) ─────────────
  // A Godot 4 web export, in miniature: the file types that matter are .wasm
  // and .pck, and .pck is the one the original allowlist did not have.
  const godotZip = new AdmZip();
  godotZip.addFile('index.html', Buffer.from('<!doctype html><canvas id=canvas></canvas>'));
  godotZip.addFile('index.js', Buffer.from('// engine loader'));
  godotZip.addFile('index.wasm', Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  godotZip.addFile('index.pck', Buffer.from('GDPC fake pack'));
  godotZip.addFile('index.audio.worklet.js', Buffer.from('// worklet'));
  const godotPath = path.join(ROOT, 'uploads', 'temp', `e2e-godot-${Date.now()}.zip`);
  fs.mkdirSync(path.dirname(godotPath), { recursive: true });
  godotZip.writeZip(godotPath);

  const uploadZip = async (filePath, name) => {
    const fd = new FormData();
    fd.append('build', new Blob([fs.readFileSync(filePath)]), name);
    return fetch(`${BASE}/projects/${project.slug}/build/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: fd,
    });
  };

  res = await uploadZip(godotPath, 'godot-export.zip');
  const uploaded = await res.json();
  check('a Godot export (.wasm + .pck) is accepted',
    res.status === 201 && uploaded.upload?.files === 5, uploaded);

  // A zip whose index.html is one folder down — the commonest mistake, and the
  // one the device would show as a blank screen.
  const nestedZip = new AdmZip();
  nestedZip.addFile('MyGame/index.html', Buffer.from('<!doctype html>'));
  const nestedPath = path.join(ROOT, 'uploads', 'temp', `e2e-nested-${Date.now()}.zip`);
  nestedZip.writeZip(nestedPath);
  res = await uploadZip(nestedPath, 'nested.zip');
  const nested = await res.json();
  check('a zip with no root index.html is rejected',
    res.status === 400 && /index\.html at the root/i.test(nested.error || ''), nested);

  // An executable that a build has no business carrying.
  const badZip = new AdmZip();
  badZip.addFile('index.html', Buffer.from('<!doctype html>'));
  badZip.addFile('tool.exe', Buffer.from('MZ'));
  const badPath = path.join(ROOT, 'uploads', 'temp', `e2e-bad-${Date.now()}.zip`);
  badZip.writeZip(badPath);
  res = await uploadZip(badPath, 'bad.zip');
  const bad = await res.json();
  check('a disallowed file type is rejected',
    res.status === 400 && /\.exe/i.test(bad.error || ''), bad);

  check('the rejected uploads did not replace the good one',
    (await (await fetch(`${BASE}/projects/${project.slug}/build`, { headers: authed })).json())
      .upload?.files === 5, 'upload was clobbered by a rejected zip');

  // The Test Lab must now serve the UPLOADED build, .pck and all — the editor
  // allowlist would have dropped exactly those files.
  res = await fetch(`${BASE}/sandbox/${project.slug}/session`, {
    method: 'POST', headers: authed, body: JSON.stringify({ orientation: 'landscape' }),
  });
  const upSession = await res.json();
  res = await fetch(`${ORIGIN}${upSession.buildUrl}`);
  const upEntries = new AdmZip(Buffer.from(await res.arrayBuffer())).getEntries().map(e => e.entryName);
  check('the test build served is the uploaded one, engine files intact',
    upEntries.includes('index.pck') && upEntries.includes('index.wasm'), upEntries);

  // Switching back to the editor source restores the workspace build.
  await fetch(`${BASE}/projects/${project.slug}/build/source`, {
    method: 'PUT', headers: authed, body: JSON.stringify({ buildSource: 'editor' }),
  });
  res = await fetch(`${BASE}/sandbox/${project.slug}/session`, {
    method: 'POST', headers: authed, body: JSON.stringify({}),
  });
  const backToEditor = await res.json();
  res = await fetch(`${ORIGIN}${backToEditor.buildUrl}`);
  const editorEntries = new AdmZip(Buffer.from(await res.arrayBuffer())).getEntries().map(e => e.entryName);
  check('switching back to the editor serves the workspace again',
    editorEntries.includes('game.js') && !editorEntries.includes('index.pck'), editorEntries);

  for (const f of [godotPath, nestedPath, badPath]) fs.rmSync(f, { force: true });
  fs.rmSync(path.join(ROOT, 'uploads', 'dev-builds', String(devId)), { recursive: true, force: true });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await db.query('DELETE FROM users WHERE id = ?', [sess.player.userId]);
  await db.query('DELETE FROM games WHERE id = ?', [sess.gameId]);
  await db.query('DELETE FROM developers WHERE id = ?', [devId]);
  fs.rmSync(path.join(ROOT, 'uploads', 'builder', String(devId)), { recursive: true, force: true });
  await db.end();

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
