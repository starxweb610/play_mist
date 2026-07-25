const db = require('../../config/database');

const CONFIG_KEY = 'app_update_config';
const DEFAULT_UPDATE_URL = 'https://play.google.com/store/apps/details?id=com.playmist.app&hl=en_IN';

/**
 * GET /api/v1/app-config
 *
 * Public (no auth) — must work before login/onboarding too, since a force
 * update has to be able to block a fresh install before it ever registers.
 * `latestVersion: null` means nothing has been configured yet; the app
 * treats that as "no update available" (fails open).
 */
exports.getAppConfig = async (req, res) => {
  let config = {
    latestVersion: null,
    forceUpdate: false,
    updateMessage: '',
    updateUrl: DEFAULT_UPDATE_URL,
  };
  try {
    const [rows] = await db.query('SELECT content FROM site_content WHERE key_name = ?', [CONFIG_KEY]);
    if (rows.length && rows[0].content) {
      try { config = { ...config, ...JSON.parse(rows[0].content) }; } catch (_) {}
    }
  } catch (err) {
    console.error('getAppConfig error:', err);
  }
  return res.json(config);
};
