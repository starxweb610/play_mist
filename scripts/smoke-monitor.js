/**
 * scripts/smoke-monitor.js
 * Hourly production monitor: runs the smoke test and emails ALERT_EMAIL when
 * it fails (and again when it recovers). Installed as a cron job on the VPS:
 *
 *   17 * * * * cd /var/www/play_mist && /usr/bin/node scripts/smoke-monitor.js >> smoke-monitor.log 2>&1
 *
 * Flap protection: a failure is only alerted after a second run, 30s later,
 * also fails — so a deploy restart or transient blip doesn't page anyone.
 * State (pass/fail) is kept in .smoke-state so recovery sends exactly one
 * "all clear" email instead of alerting forever.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const STATE_FILE = path.join(APP_DIR, '.smoke-state');
const SMOKE_SCRIPT = path.join(__dirname, 'smoke-test.js');
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'i.motionveda@gmail.com';
const RETRY_DELAY_MS = 30 * 1000;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const runSmokeTest = () => new Promise((resolve) => {
  execFile('node', [SMOKE_SCRIPT], { cwd: APP_DIR, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
    resolve({ ok: !err, output: `${stdout}\n${stderr}`.trim() });
  });
});

const readState = () => {
  try { return fs.readFileSync(STATE_FILE, 'utf8').trim(); } catch { return 'pass'; }
};

const sendAlert = async (subject, bodyText) => {
  const { sendMail } = require('../utils/mailer');
  await sendMail({
    to: ALERT_EMAIL,
    subject,
    html: `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap">${bodyText
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
  });
};

async function main() {
  const prevState = readState();
  let { ok, output } = await runSmokeTest();

  // Confirm failures before alerting — one retry after a short wait.
  if (!ok) {
    console.log(`[${stamp()}] smoke test failed — retrying in 30s to rule out a blip`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    ({ ok, output } = await runSmokeTest());
  }

  fs.writeFileSync(STATE_FILE, ok ? 'pass' : 'fail');

  if (!ok) {
    console.log(`[${stamp()}] ❌ FAILED (confirmed on retry) — alerting ${ALERT_EMAIL}`);
    await sendAlert(
      '🚨 Playmist smoke test FAILING',
      `The hourly smoke test failed twice in a row at ${stamp()} (server time).\n\n${output}\n\nDebug: ssh cgpixels-vps, then: pm2 logs playmist --lines 100`
    );
  } else if (prevState === 'fail') {
    console.log(`[${stamp()}] ✅ recovered — sending all-clear to ${ALERT_EMAIL}`);
    await sendAlert(
      '✅ Playmist smoke test recovered',
      `All checks passing again as of ${stamp()} (server time).\n\n${output}`
    );
  } else {
    console.log(`[${stamp()}] ✅ all checks passed`);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[${stamp()}] monitor crashed:`, err.message);
  process.exit(1);
});
