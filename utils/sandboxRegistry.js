/**
 * utils/sandboxRegistry.js — "is this a Test Lab call?", answered from memory.
 *
 * The SDK call log (middleware/sandboxSdkLog.js) sits on the player API's hot
 * path: every real player's save, XP event and purchase passes through it. It
 * must cost those players nothing, so the question it asks — "is this game a
 * sandbox game?", "is this user a test player?" — is a Set lookup, never a
 * query. The sets are loaded once, lazily, and extended the moment the Test
 * Lab creates a new sandbox game or test player (controllers/devapi/sandboxApi).
 *
 * Only ever grows during a process's life. A sandbox row deleted underneath it
 * leaves a stale id that matches nothing, which is harmless: the log insert's
 * foreign key simply fails, and logging never blocks the request.
 */
const db = require('../config/database');

const sandboxGames = new Set();
const testUsers    = new Set();
let loading = null;

function load() {
  if (!loading) {
    loading = (async () => {
      try {
        const [games] = await db.query('SELECT id FROM games WHERE is_sandbox = 1');
        for (const g of games) sandboxGames.add(Number(g.id));
        const [users] = await db.query('SELECT id FROM users WHERE is_test_account = 1');
        for (const u of users) testUsers.add(Number(u.id));
      } catch (err) {
        // A failed load must not wedge every later call waiting on it; retry
        // on the next use instead.
        console.error('sandboxRegistry load failed:', err.message);
        loading = null;
      }
    })();
  }
  return loading;
}

module.exports = {
  load,
  addGame:  (id) => { if (id) sandboxGames.add(Number(id)); },
  addUser:  (id) => { if (id) testUsers.add(Number(id)); },
  isSandboxGame: (id) => sandboxGames.has(Number(id)),
  isTestUser:    (id) => testUsers.has(Number(id)),
};
