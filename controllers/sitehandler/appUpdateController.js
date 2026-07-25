const db = require('../../config/database');

const CONFIG_KEY = 'app_update_config';
const DEFAULT_UPDATE_URL = 'https://play.google.com/store/apps/details?id=com.playmist.app&hl=en_IN';

exports.getEdit = async (req, res) => {
  let config = { latestVersion: '', forceUpdate: false, updateMessage: '', updateUrl: DEFAULT_UPDATE_URL };
  try {
    const [rows] = await db.query('SELECT content FROM site_content WHERE key_name = ?', [CONFIG_KEY]);
    if (rows.length && rows[0].content) {
      config = { ...config, ...JSON.parse(rows[0].content) };
    }
  } catch (_) {}

  res.render('sitehandler/app-update/edit', {
    title: 'App Update',
    activePage: 'app-update',
    config,
    defaultUpdateUrl: DEFAULT_UPDATE_URL,
  });
};

exports.postSave = async (req, res) => {
  const { latestVersion, forceUpdate, updateMessage, updateUrl } = req.body;
  const config = {
    latestVersion: (latestVersion || '').trim(),
    forceUpdate: forceUpdate === 'on',
    updateMessage: (updateMessage || '').trim(),
    updateUrl: (updateUrl || '').trim() || DEFAULT_UPDATE_URL,
  };
  try {
    await db.query(
      `INSERT INTO site_content (key_name, content) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content)`,
      [CONFIG_KEY, JSON.stringify(config)]
    );
    req.flash('success_msg', 'App update config saved successfully.');
  } catch (err) {
    req.flash('error_msg', 'Failed to save: ' + err.message);
  }
  res.redirect('/sitehandler/app-update');
};
