const express    = require('express');
const router     = express.Router();
const { isAdmin } = require('../middleware/auth');
const { upload, uploadImage, uploadScreenshots, builderTemplateZip } = require('../config/upload');

const authController                  = require('../controllers/sitehandler/authController');
const dashboardController             = require('../controllers/sitehandler/dashboardController');
const analyticsController             = require('../controllers/sitehandler/analyticsController');
const gamesController                 = require('../controllers/sitehandler/gamesController');
const demoFeedbackController          = require('../controllers/sitehandler/demoFeedbackController');
const ticketsController               = require('../controllers/sitehandler/ticketsController');
const adminsController                = require('../controllers/sitehandler/adminsController');
const settingsController              = require('../controllers/sitehandler/settingsController');
const genresController                = require('../controllers/sitehandler/genresController');
const tagsController                  = require('../controllers/sitehandler/tagsController');
const usersController                 = require('../controllers/sitehandler/usersController');
const developerSubmissionsController  = require('../controllers/sitehandler/developerSubmissionsController');
const developersController            = require('../controllers/sitehandler/developersController');
const guidelinesController            = require('../controllers/sitehandler/guidelinesController');
const notificationsController         = require('../controllers/sitehandler/notificationsController');
const xpEventsController              = require('../controllers/sitehandler/xpEventsController');
const funnelEventsController          = require('../controllers/sitehandler/funnelEventsController');
const shopItemsController             = require('../controllers/sitehandler/shopItemsController');
const communityNotesController        = require('../controllers/sitehandler/communityNotesController');
const appUpdateController             = require('../controllers/sitehandler/appUpdateController');
const builderTemplatesController      = require('../controllers/sitehandler/builderTemplatesController');


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
router.get('/analytics/returning-users', analyticsController.getReturningUsers);
// JSON for the DAU chart's range dropdown (no page reload)
router.get('/analytics/dau', analyticsController.getDauSeries);
router.get('/analytics/returning-series', analyticsController.getReturningSeries);
router.get('/analytics/game-plays', analyticsController.getGamePlaysSeries);

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
router.post('/games/:id/upload-demo', upload.single('demo_zip'),        gamesController.postUploadDemo);
router.post('/games/:id/demo-toggle', gamesController.postDemoToggle);
router.get ('/games/:id/demo-feedback',        demoFeedbackController.getIndex);
router.get ('/games/:id/demo-feedback/export', demoFeedbackController.getExport);
router.post('/games/:id/toggle',     gamesController.postToggle);
router.post('/games/:id/delete',     gamesController.postDelete);

// Per-game XP events (feeds that game's leaderboard)
router.get ('/games/:id/xp-events',                    xpEventsController.getIndex);
router.post('/games/:id/xp-events/create',              xpEventsController.postCreate);
router.post('/games/:id/xp-events/:eventId/update',     xpEventsController.postUpdate);
router.post('/games/:id/xp-events/:eventId/toggle',     xpEventsController.postToggle);
router.post('/games/:id/xp-events/:eventId/delete',     xpEventsController.postDelete);

// Per-game funnel analytics (drop-off milestones)
router.get ('/games/:id/funnel-events',                    funnelEventsController.getIndex);
router.post('/games/:id/funnel-events/create',              funnelEventsController.postCreate);
router.post('/games/:id/funnel-events/:eventId/update',     funnelEventsController.postUpdate);
router.post('/games/:id/funnel-events/:eventId/toggle',     funnelEventsController.postToggle);
router.post('/games/:id/funnel-events/:eventId/delete',     funnelEventsController.postDelete);

// Per-game shop items (in-game purchases against wallet credits)
router.get ('/games/:id/shop-items',                    shopItemsController.getIndex);
router.post('/games/:id/shop-items/create',              shopItemsController.postCreate);
router.post('/games/:id/shop-items/:itemId/update',      shopItemsController.postUpdate);
router.post('/games/:id/shop-items/:itemId/toggle',      shopItemsController.postToggle);
router.post('/games/:id/shop-items/:itemId/delete',      shopItemsController.postDelete);

// Users
router.get ('/users',                  usersController.getIndex);
router.post('/users/bulk',             usersController.postBulk);
router.get ('/users/:id/transactions', usersController.getTransactions);
router.post('/users/:id/toggle',       usersController.postToggle);
router.post('/users/:id/delete',       usersController.postDelete);

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

// App update / force-update version gate
router.get ('/app-update',           appUpdateController.getEdit);
router.post('/app-update',           appUpdateController.postSave);

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

// Notifications
router.get ('/notifications',              notificationsController.getIndex);
router.post('/notifications/send',         notificationsController.postSend);
router.post('/notifications/schedule',     notificationsController.postSchedule);
router.post('/notifications/scheduled/:id/cancel', notificationsController.postCancelScheduled);
router.post('/notifications/:id/delete',   notificationsController.postDelete);

// Game Builder Templates — categories + template ZIPs the developer portal offers
// The zip uploads answer a regular form post, so a multer rejection is recorded
// for the controller to flash rather than falling through to the 500 page.
const templateZipUpload = (req, res, next) =>
  builderTemplateZip.single('template_zip')(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'That ZIP is too large — templates are capped at 50 MB.'
        : (err.message || 'Upload failed.');
    }
    // uploads/temp backstop: the controller removes what it was handed, but a
    // rejected upload never reaches it (see routes/developer.js for the full
    // reasoning behind the tracked paths).
    res.on('finish', () => {
      for (const filePath of req._tempFilePaths || []) require('fs-extra').remove(filePath).catch(() => {});
    });
    next();
  });

router.get ('/builder-templates',                        builderTemplatesController.getIndex);
router.post('/builder-templates/categories',             builderTemplatesController.postCreateCategory);
router.post('/builder-templates/categories/:id/update',  builderTemplatesController.postUpdateCategory);
router.post('/builder-templates/categories/:id/delete',  builderTemplatesController.postDeleteCategory);
router.post('/builder-templates/templates',              templateZipUpload, builderTemplatesController.postCreateTemplate);
router.post('/builder-templates/templates/:id/update',   builderTemplatesController.postUpdateTemplate);
router.post('/builder-templates/templates/:id/replace',  templateZipUpload, builderTemplatesController.postReplaceTemplateZip);
router.post('/builder-templates/templates/:id/delete',   builderTemplatesController.postDeleteTemplate);

// Community Notes (Knowledge Sphere moderation)
router.get ('/community-notes',                    communityNotesController.getIndex);
router.post('/community-notes/:id/approve',        communityNotesController.postApprove);
router.post('/community-notes/:id/reject',         communityNotesController.postReject);

module.exports = router;
