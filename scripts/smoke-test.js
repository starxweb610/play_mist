/**
 * scripts/smoke-test.js
 * Drives every critical user path once against a running server and fails
 * loudly if any of them is broken. Used as the deploy gate in deploy.sh and
 * runnable any time by hand:
 *
 *   node scripts/smoke-test.js                   # against http://127.0.0.1:3798
 *   BASE_URL=http://localhost:3000 node scripts/smoke-test.js
 *
 * Auth checks run as a freshly registered throwaway user (smoketest_<random>),
 * which is deleted from the database afterwards — credit_transactions rows
 * cascade with it, so runs leave no trace in user data or analytics.
 *
 * Exit code: 0 = all checks passed, 1 = at least one failed.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3798').replace(/\/+$/, '');
const TIMEOUT_MS = 10000;

const results = [];
let failed = 0;

const request = async (path, options = {}) => {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return res;
};

const check = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
    results.push(`✅ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failed++;
    results.push(`❌ ${name} — ${err.message}`);
  }
};

const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

const authed = (token) => ({ Authorization: `Bearer ${token}` });

async function main() {
  const username = `smoketest_${crypto.randomBytes(4).toString('hex')}`;
  let accessToken, refreshToken, games = [];

  // ── Unauthenticated surface ────────────────────────────────────────────────
  await check('API health (status ok, DB reachable)', async () => {
    const res = await request('/api/health');
    expect(res.status === 200, `HTTP ${res.status}`);
    const body = await res.json();
    expect(body.status === 'ok', `status "${body.status}": ${body.error || 'DB check failed'}`);
  });

  await check('Website homepage', async () => {
    const res = await request('/');
    expect(res.status === 200, `HTTP ${res.status}`);
  });

  await check('Website games library', async () => {
    const res = await request('/games');
    expect(res.status === 200, `HTTP ${res.status}`);
  });

  await check('Developer portal login page', async () => {
    const res = await request('/developer/login');
    expect(res.status === 200, `HTTP ${res.status}`);
  });

  // ── Onboarding: register a throwaway user ─────────────────────────────────
  await check('Register new user', async () => {
    const res = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    expect(res.status === 200, `HTTP ${res.status}`);
    const body = await res.json();
    expect(body.success === true && body.accessToken && body.refreshToken, 'missing tokens in response');
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  if (!accessToken) {
    // Every remaining check needs a session — report them as skipped-failures.
    failed++;
    results.push('❌ All authenticated checks skipped — registration failed');
  } else {
    await check('Refresh access token', async () => {
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      expect(res.status === 200, `HTTP ${res.status}`);
      const body = await res.json();
      expect(!!body.accessToken, 'no accessToken in response');
    });

    await check('Games list (non-empty)', async () => {
      const res = await request('/api/v1/all-games', { headers: authed(accessToken) });
      expect(res.status === 200, `HTTP ${res.status}`);
      games = await res.json();
      expect(Array.isArray(games) && games.length > 0, `expected games, got ${JSON.stringify(games).slice(0, 100)}`);
    });

    await check('Game thumbnail loads', async () => {
      expect(games.length > 0, 'no game to check');
      const img = games.map((g) => g.imageurl).find(Boolean);
      expect(!!img, 'no game in the catalog has a thumbnail');
      const res = await request(img);
      expect(res.status === 200, `HTTP ${res.status} for ${img}`);
    });

    await check('User profile', async () => {
      const res = await request('/api/v1/user/profile', { headers: authed(accessToken) });
      expect(res.status === 200, `HTTP ${res.status}`);
    });

    await check('Profile settings update', async () => {
      const res = await request('/api/v1/user/profile/update', {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ displayName: 'Smoke Tester', bio: 'smoke-test bio' }),
      });
      expect(res.status === 200, `HTTP ${res.status}`);
      const body = await res.json();
      expect(body.displayName === 'Smoke Tester', `displayName came back as "${body.displayName}"`);
    });

    await check('Daily check-in (streak)', async () => {
      const res = await request('/api/v1/user/daily-checkin', {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({}),
      });
      expect(res.status === 200, `HTTP ${res.status}`);
      const body = await res.json();
      expect(body.streak >= 1, `unexpected streak: ${body.streak}`);
    });

    await check('Daily pick', async () => {
      const res = await request('/api/v1/daily-pick', { headers: authed(accessToken) });
      expect(res.status === 200, `HTTP ${res.status}`);
    });

    await check('Daily challenge', async () => {
      const res = await request('/api/v1/daily-challenge', { headers: authed(accessToken) });
      expect(res.status === 200, `HTTP ${res.status}`);
    });

    await check('Credit deduction (balance math verified)', async () => {
      expect(games.length > 0, 'no game to deduct against');
      const before = await (await request('/api/v1/user/profile', { headers: authed(accessToken) })).json();
      const balanceBefore = before.credits ?? before.user?.credits;
      expect(Number.isFinite(balanceBefore), 'could not read starting balance');

      const res = await request('/api/v1/user/deduct-credits', {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ gameId: games[0].id }),
      });
      expect(res.status === 200, `HTTP ${res.status}`);
      const body = await res.json();
      expect(body.success === true, `success=${body.success}: ${body.error || ''}`);
      // Achievements can add credits in the same call, so balance must be
      // exactly: before - cost + any achievement credit rewards.
      const achievementCredits = (body.newAchievements || [])
        .reduce((sum, a) => sum + (a.creditsReward || 0), 0);
      const expected = balanceBefore - body.cost + achievementCredits;
      expect(body.balance === expected,
        `balance ${body.balance} ≠ expected ${expected} (before ${balanceBefore}, cost ${body.cost}, achievements +${achievementCredits})`);
    });

    await check('Notifications', async () => {
      const res = await request('/api/v1/notifications', { headers: authed(accessToken) });
      expect(res.status === 200, `HTTP ${res.status}`);
    });
  }

  // ── Cleanup: remove the throwaway user (and any stragglers from crashed runs)
  try {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'playmist',
    });
    const [del] = await conn.query("DELETE FROM users WHERE username LIKE 'smoketest\\_%'");
    await conn.end();
    results.push(`🧹 Cleaned up ${del.affectedRows} smoke-test user(s)`);
  } catch (err) {
    results.push(`⚠️  Test-user cleanup failed (checks unaffected): ${err.message}`);
  }

  console.log(`\nSmoke test against ${BASE_URL}\n`);
  for (const line of results) console.log('  ' + line);
  const total = results.filter((l) => l.startsWith('✅') || l.startsWith('❌')).length;
  console.log(`\n${failed === 0 ? '✅ SMOKE TEST PASSED' : '❌ SMOKE TEST FAILED'} — ${total - failed}/${total} checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ SMOKE TEST CRASHED:', err.message);
  process.exit(1);
});
