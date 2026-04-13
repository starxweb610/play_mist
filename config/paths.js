/**
 * config/paths.js
 * Centralised filesystem path constants for game file storage.
 */
const path = require('path');

module.exports = {
  WEBGL_DIR:   path.join(__dirname, '..', 'public',  'games', 'webgl'),
  PREMIUM_DIR: path.join(__dirname, '..', 'uploads', 'games', 'premium'),
  TEMP_DIR:    path.join(__dirname, '..', 'uploads', 'temp'),
};
