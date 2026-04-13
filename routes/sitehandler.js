const express    = require('express');
const router     = express.Router();
const { isAdmin } = require('../middleware/auth');
const { upload, uploadImage } = require('../config/upload');

const authController      = require('../controllers/sitehandler/authController');
const dashboardController = require('../controllers/sitehandler/dashboardController');
const analyticsController = require('../controllers/sitehandler/analyticsController');
const gamesController     = require('../controllers/sitehandler/gamesController');
const ticketsController   = require('../controllers/sitehandler/ticketsController');
const adminsController    = require('../controllers/sitehandler/adminsController');
const settingsController  = require('../controllers/sitehandler/settingsController');

// ─── Auth (public within /sitehandler) ────────────────────────────────────────
router.get ('/login',  authController.getLogin);
router.post('/login',  authController.postLogin);
router.get ('/logout', authController.logout);

// ─── All below require admin session ─────────────────────────────────────────
router.use(isAdmin);

// Dashboard
router.get('/',           dashboardController.getIndex);
router.get('/dashboard',  dashboardController.getIndex);

// Analytics
router.get('/analytics', analyticsController.getIndex);

// Games
router.get ('/games',                gamesController.getIndex);
router.get ('/games/create',         gamesController.getCreate);
router.post('/games/create',         gamesController.postCreate);
router.get ('/games/:id',            gamesController.getDetail);
router.post('/games/:id/update',     gamesController.postUpdate);
router.post('/games/:id/upload',     upload.single('game_zip'),         gamesController.postUpload);
router.post('/games/:id/upload-image', uploadImage.single('game_image'), gamesController.postUploadImage);
router.post('/games/:id/toggle',     gamesController.postToggle);
router.post('/games/:id/delete',     gamesController.postDelete);

// Tickets
router.get ('/tickets',              ticketsController.getIndex);
router.get ('/tickets/:id',          ticketsController.getDetail);
router.post('/tickets/:id/reply',    ticketsController.postReply);
router.post('/tickets/:id/status',   ticketsController.postStatus);
router.post('/tickets/:id/assign',   ticketsController.postAssign);

// Admins
router.get ('/admins',               adminsController.getIndex);
router.post('/admins/create',        adminsController.postCreate);
router.post('/admins/:id/toggle',    adminsController.postToggle);
router.post('/admins/:id/delete',    adminsController.postDelete);

// Settings
router.get ('/settings',             settingsController.getIndex);
router.post('/settings/profile',     settingsController.postProfile);
router.post('/settings/password',    settingsController.postPassword);

module.exports = router;
