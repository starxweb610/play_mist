/**
 * scripts/test-devapi-features.js
 *
 * The Studio app's project-side surface: the home screen's recent projects,
 * the editor's sandboxed preview (and the console bridge it depends on),
 * workspace asset uploads under the builder's own rules, and concept boards
 * with their sketch frames.
 *
 * Companion to test-devapi.js, which covers auth, the Test Lab and builds.
 * Needs the server running and the DB reachable; cleans up after itself.
 *
 *   node scripts/test-devapi-features.js
 *   BASE_URL=http://127.0.0.1:3599 node scripts/test-devapi-features.js
 */
const path = require('path');
const fs   = require('fs');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const ORIGIN = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3002}`;
const BASE   = `${ORIGIN}/api/dev/v1`;
const EMAIL  = 'features@playmist.local';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  ← ${JSON.stringify(detail)?.slice(0, 220)}`}`);
  if (!ok) failures++;
};

// A 1x1 PNG, enough to stand in for a sketch and for an editor asset.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  await db.query('DELETE FROM developers WHERE email = ?', [EMAIL]);
  const [ins] = await db.query(
    `INSERT INTO developers (name, email, country, studio_name, password_hash, handle, is_active)
     VALUES ('Features', ?, 'IN', 'Features Studio', ?, ?, 1)`,
    [EMAIL, await bcrypt.hash('hunter2hunter2', 10), `feat_${Date.now().toString(36)}`]);
  const devId = ins.insertId;

  const login = await (await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'hunter2hunter2' }) })).json();
  const bearer = { Authorization: `Bearer ${login.accessToken}` };
  const authed = { ...bearer, 'Content-Type': 'application/json' };

  // Six projects, so "recent 5" has something to cut.
  const made = [];
  for (let i = 1; i <= 6; i++) {
    const { project } = await (await fetch(`${BASE}/projects`, {
      method: 'POST', headers: authed, body: JSON.stringify({ name: `Project ${i}` }) })).json();
    made.push(project);
  }

  // ── #1 recent projects ───────────────────────────────────────────────────
  const dash = await (await fetch(`${BASE}/dashboard`, { headers: authed })).json();
  check('dashboard returns at most 5 recent projects',
    Array.isArray(dash.recentProjects) && dash.recentProjects.length === 5, dash.recentProjects?.length);
  check('recent projects are the most recently updated, newest first',
    dash.recentProjects?.[0]?.name === 'Project 6', dash.recentProjects?.map(p => p.name));
  check('each carries the fields the card renders',
    dash.recentProjects?.[0]?.buildSource === 'editor' && 'taskCount' in dash.recentProjects[0],
    dash.recentProjects?.[0]);

  const project = made[0];
  const ws = path.join(ROOT, 'uploads', 'builder', String(devId), String(project.id));
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'index.html'), '<!doctype html><h1>hi</h1>');
  await db.query(
    `INSERT INTO developer_builder_workspaces (project_id, developer_id, template_name, rel_path)
     VALUES (?, ?, 'Blank', ?)`, [project.id, devId, `${devId}/${project.id}`]);

  // ── #7 editor Run: a preview token, and the sandboxed page it names ──────
  let res = await fetch(`${BASE}/builder/${project.slug}/preview-token`, { method: 'POST', headers: authed, body: '{}' });
  const token = await res.json();
  check('editor preview mints a token', res.status === 200 && /builder-preview/.test(token.url || ''), token);

  res = await fetch(`${ORIGIN}${token.url}`);
  const html = await res.text();
  check('the preview page serves the game with the console bridge injected',
    res.status === 200 && html.includes('__pmBuilderConsole') && html.includes('<h1>hi</h1>'),
    html.slice(0, 120));

  // ── #6 editor asset upload, under the builder's own rules ───────────────
  const upload = async (name, type, body) => {
    const fd = new FormData();
    fd.append('parent', '');
    fd.append('file', new Blob([body], { type }), name);
    return fetch(`${BASE}/builder/${project.slug}/upload`, { method: 'POST', headers: bearer, body: fd });
  };

  res = await upload('sprite.png', 'image/png', PNG);
  const asset = await res.json();
  check('an image uploads into the workspace', res.status === 201 && asset.path === 'sprite.png', asset);
  check('the uploaded asset is really on disk',
    fs.existsSync(path.join(ws, 'sprite.png')), 'sprite.png missing from the workspace');

  res = await upload('cheat.exe', 'application/octet-stream', Buffer.from('MZ'));
  const badAsset = await res.json();
  check('a non-image is refused, as on the website', res.status === 400, { status: res.status, badAsset });

  // ── #2 concept boards and sketch frames ─────────────────────────────────
  res = await fetch(`${BASE}/projects/${project.id}/storyboards`, {
    method: 'POST', headers: authed, body: JSON.stringify({ title: 'Level 1 flow' }) });
  const { storyboard } = await res.json();
  check('a concept board is created', res.status === 200 && !!storyboard?.id, storyboard);

  const frameForm = new FormData();
  frameForm.append('image', new Blob([PNG], { type: 'image/png' }), 'frame.png');
  frameForm.append('thumb', new Blob([PNG], { type: 'image/png' }), 'thumb.png');
  frameForm.append('title', 'Opening room');
  frameForm.append('bg_color', '#ffffff');
  res = await fetch(`${BASE}/storyboards/${storyboard.id}/frames`, {
    method: 'POST', headers: bearer, body: frameForm });
  const { frame } = await res.json();
  check('a sketch frame uploads with its thumbnail',
    res.status === 200 && !!frame?.image_url && !!frame?.thumb_url, frame);
  check('the caption is stored where the website reads it',
    frame?.title === 'Opening room', frame?.title);

  res = await fetch(`${BASE}/projects/${project.id}/storyboards`, { headers: authed });
  const { storyboards } = await res.json();
  check('the board lists its frame count and cover',
    storyboards?.[0]?.frame_count === 1 && !!storyboards[0].cover_url, storyboards?.[0]);

  res = await fetch(`${BASE}/storyboards/${storyboard.id}/frames`, { headers: authed });
  const { frames } = await res.json();
  check('frames come back in order for the board grid', frames?.length === 1, frames);

  res = await fetch(`${BASE}/frames/${frame.id}`, { method: 'DELETE', headers: authed });
  check('a frame can be deleted', res.status === 200, res.status);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  await db.query('DELETE FROM developers WHERE id = ?', [devId]);
  fs.rmSync(path.join(ROOT, 'uploads', 'builder', String(devId)), { recursive: true, force: true });
  await db.end();

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
