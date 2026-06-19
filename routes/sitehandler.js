const express    = require('express');
const router     = express.Router();
const { isAdmin } = require('../middleware/auth');
const { upload, uploadImage, uploadScreenshots } = require('../config/upload');

const authController                  = require('../controllers/sitehandler/authController');
const dashboardController             = require('../controllers/sitehandler/dashboardController');
const analyticsController             = require('../controllers/sitehandler/analyticsController');
const gamesController                 = require('../controllers/sitehandler/gamesController');
const ticketsController               = require('../controllers/sitehandler/ticketsController');
const adminsController                = require('../controllers/sitehandler/adminsController');
const settingsController              = require('../controllers/sitehandler/settingsController');
const genresController                = require('../controllers/sitehandler/genresController');
const tagsController                  = require('../controllers/sitehandler/tagsController');
const usersController                 = require('../controllers/sitehandler/usersController');
const developerSubmissionsController  = require('../controllers/sitehandler/developerSubmissionsController');
const developersController            = require('../controllers/sitehandler/developersController');
const guidelinesController            = require('../controllers/sitehandler/guidelinesController');


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
router.post('/games/:id/upload-secondary-image', uploadImage.single('secondary_image'), gamesController.postUploadSecondaryImage);
router.post('/games/:id/upload-promotional-image', uploadImage.single('promotional_image'), gamesController.postUploadPromotionalImage);
router.post('/games/:id/upload-screenshots', uploadScreenshots.array('screenshots', 10), gamesController.postUploadScreenshots);
router.post('/games/:id/delete-screenshot/:screenshotId', gamesController.postDeleteScreenshot);
router.post('/games/:id/toggle',     gamesController.postToggle);
router.post('/games/:id/delete',     gamesController.postDelete);

// Users
router.get ('/users',                usersController.getIndex);
router.get ('/users/:id/transactions', usersController.getTransactions);
router.post('/users/:id/toggle',     usersController.postToggle);
router.post('/users/:id/delete',     usersController.postDelete);

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

// Genres
router.get ('/genres',               genresController.getIndex);
router.post('/genres/create',        genresController.postCreate);
router.get ('/genres/:id/edit',      genresController.getEdit);
router.post('/genres/:id/update',    genresController.postUpdate);
router.post('/genres/:id/delete',    genresController.postDelete);

// Tags
router.get ('/tags',                 tagsController.getIndex);
router.post('/tags/create',          tagsController.postCreate);
router.get ('/tags/:id/edit',        tagsController.getEdit);
router.post('/tags/:id/update',      tagsController.postUpdate);
router.post('/tags/:id/delete',      tagsController.postDelete);

// Developer Submissions
router.get ('/developer-submissions',                              developerSubmissionsController.getIndex);
router.get ('/developer-submissions/:id',                          developerSubmissionsController.getDetail);
router.get ('/developer-submissions/:id/download',                 developerSubmissionsController.getDownload);
router.post('/developer-submissions/:id/mark-reviewing',           developerSubmissionsController.postMarkReviewing);
router.post('/developer-submissions/:id/approve',                  developerSubmissionsController.postApprove);
router.post('/developer-submissions/:id/reject',                   developerSubmissionsController.postReject);

// Developers Management
router.get ('/developers',           developersController.getIndex);
router.get ('/developers/:id',       developersController.getDetail);
router.post('/developers/:id/ban',   developersController.postBan);
router.post('/developers/:id/unban', developersController.postUnban);

// Guidelines Editor
router.get ('/guidelines',                    guidelinesController.getEdit);
router.post('/guidelines',                    guidelinesController.postSave);
router.post('/guidelines/image-upload',       uploadImage.single('image'), guidelinesController.postImageUpload);

module.exports = router;
