const express      = require('express');
const router       = express.Router();
const rateLimit    = require('express-rate-limit');
const fse          = require('fs-extra');
const { isDeveloper, checkBanned, blockCrossSite } = require('../middleware/developerAuth');
const { developerSubmissionFiles, developerThumbnail, developerHeader, developerPortfolioImage, developerDoc, developerSketch, developerDocImage, uploadScreenshots } = require('../config/upload');

const authController        = require('../controllers/developer/authController');
const dashboardController   = require('../controllers/developer/dashboardController');
const submissionsController = require('../controllers/developer/submissionsController');
const guidelinesController  = require('../controllers/developer/guidelinesController');
const knowledgeController   = require('../controllers/developer/knowledgeController');
const projectsController    = require('../controllers/developer/projectsController');
const profileController     = require('../controllers/developer/profileController');
const projectDocsController = require('../controllers/developer/projectDocsController');
const storyboardController  = require('../controllers/developer/storyboardController');
const socialController      = require('../controllers/developer/socialController');
const portfolioController   = require('../controllers/developer/portfolioController');
const listingController     = require('../controllers/developer/listingController');

// ── Rate limiters ─────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: 'Too many attempts. Please try again in 15 minutes.',
  standardHeaders: true, legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: 'Too many signups from this IP. Please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 3,
  message: 'Daily submission limit (3) reached. Try again tomorrow.',
  standardHeaders: true, legacyHeaders: false,
});

const noteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  message: 'Too many notes created. Please wait before creating more.',
  standardHeaders: true, legacyHeaders: false,
});

const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: 'Too many profile updates. Please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

const avatarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: 'Too many avatar uploads. Please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

const communityLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: 'Too many requests. Please slow down.',
  standardHeaders: true, legacyHeaders: false,
});

const projectMutateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 100,
  message: 'Too many project changes. Please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

const docUploadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 20,
  message: 'Daily document upload limit reached. Try again tomorrow.',
  standardHeaders: true, legacyHeaders: false,
});

const docImageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 100,
  message: 'Too many image uploads. Please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: 'Too many password reset attempts. Please try again later.',
  standardHeaders: true, legacyHeaders: false,
});

// Social limits are keyed by account rather than IP: these routes always run
// behind isDeveloper, and a whole studio can share one office IP.
const byDeveloper = (req) => `dev:${req.session.developer.id}`;

// Image uploads answered by fetch(): turn multer's size/type errors into JSON
// the page can show, instead of the generic 500 error handler.
const jsonUpload = (uploader, field) => (req, res, next) =>
  uploader.single(field)(req, res, (err) => {
    if (!err) return next();
    const error = err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large.' : (err.message || 'Upload failed.');
    res.status(400).json({ error });
  });

// Image uploads from a regular <form> post: record multer's error for the
// controller to show on the re-rendered form, instead of failing the request.
// (Those forms put the file input last, so text fields are already parsed.)
// Each uploader has its own cap, so read it off the instance rather than
// quoting a number that may not be this field's.
const sizeLimitMb = (uploader) => Math.round((uploader?.limits?.fileSize || 0) / (1024 * 1024));

const formUpload = (uploader, field) => (req, res, next) =>
  uploader.single(field)(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? `That image is too large — the limit is ${sizeLimitMb(uploader)} MB.`
        : (err.message || 'Image upload failed.');
    }
    next();
  });

// The submit form posts a build zip plus an optional reference image. Errors
// here (oversized zip, wrong file type) used to fall through to the generic
// 500 page, losing everything the developer had typed; recording them lets the
// controller re-render the form with the message and the fields intact.
const submissionUpload = (req, res, next) => {
  // Backstop for uploads/temp. The controller removes the files it was handed,
  // but a rejected upload never reaches it: multer abandons the request with
  // req.files empty, and can still be writing the *next* file when its error
  // callback fires — so sweeping there loses the race. The storage engine
  // records each path as it writes (config/upload.js); running the sweep once
  // the response is done catches every one of them. Removing a path the
  // controller already cleaned is a no-op.
  res.on('finish', () => {
    for (const p of req._tempFilePaths || []) fse.remove(p).catch(() => {});
  });

  return developerSubmissionFiles.fields([
    { name: 'game_zip',        maxCount: 1 },
    { name: 'reference_image', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is too large — builds are capped at 250 MB.'
        : (err.message || 'Upload failed.');
    }
    next();
  });
};

// Same contract as formUpload, for inputs that accept several files at once.
const formUploadMany = (uploader, field, max) => (req, res, next) =>
  uploader.array(field, max)(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? `One of those images is too large — the limit is ${sizeLimitMb(uploader)} MB each.`
        : (err.message || 'Image upload failed.');
    }
    next();
  });

const listingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60, keyGenerator: byDeveloper,
  handler: (req, res) => {
    req.flash('error_msg', 'Too many listing changes. Please try again in a little while.');
    res.redirect('/developer/listings');
  },
  standardHeaders: true, legacyHeaders: false,
});

const portfolioLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40, keyGenerator: byDeveloper,
  handler: (req, res) => {
    req.flash('error_msg', 'Too many portfolio changes. Please try again in a little while.');
    res.redirect('/developer/portfolio');
  },
  standardHeaders: true, legacyHeaders: false,
});
const jsonLimit   = (message) => (req, res) => res.status(429).json({ error: message });

const followLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 60, keyGenerator: byDeveloper,
  handler: jsonLimit('You’re following and unfollowing too quickly. Try again in a few minutes.'),
  standardHeaders: true, legacyHeaders: false,
});

const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, keyGenerator: byDeveloper,
  handler: jsonLimit('You’re commenting too quickly. Try again in a few minutes.'),
  standardHeaders: true, legacyHeaders: false,
});

const handleCheckLimiter = rateLimit({
  windowMs: 60 * 1000, max: 40, keyGenerator: byDeveloper,
  handler: jsonLimit('Too many checks. Please slow down.'),
  standardHeaders: true, legacyHeaders: false,
});

// ── Public ────────────────────────────────────────────────────────────────────
router.use(blockCrossSite);
router.get ('/',        (req, res) => req.session.developer ? res.redirect('/developer/dashboard') : res.redirect('/developer/login'));
router.get ('/signup',  authController.getSignup);
router.post('/signup',  signupLimiter, authController.postSignup);
router.get ('/verify-email',        authController.getVerifyEmail);
router.post('/verify-email',        authController.postVerifyEmail);
router.post('/resend-verification', authController.postResendVerification);
router.get ('/login',   authController.getLogin);
router.post('/login',   authLimiter,   authController.postLogin);
router.get ('/logout',  authController.logout);

// Password reset
router.get ('/forgot-password',  authController.getForgotPassword);
router.post('/forgot-password',  passwordResetLimiter, authController.postForgotPassword);
router.get ('/reset-password',   authController.getResetPassword);
router.post('/reset-password',   passwordResetLimiter, authController.postResetPassword);
router.post('/resend-reset',     passwordResetLimiter, authController.postResendResetCode);

// ── Protected (requires developer session + ban check) ────────────────────────
router.use(isDeveloper, checkBanned);

// Dashboard & Submissions
router.get ('/dashboard',                             dashboardController.getDashboard);
// Submissions are addressed by slug — no database id in a portal URL. Each
// resolver still accepts a bare numeric id and redirects, because approval
// emails sent before this carry one.
router.get ('/submissions/:slug',                     dashboardController.getSubmissionDetail);
router.get ('/submit',                                submissionsController.getSubmit);
router.post('/submit',                                uploadLimiter, submissionUpload, submissionsController.postSubmit);
router.post('/submissions/:slug/submit-review',       submissionsController.postSubmitReview);

// Store Listing — the second gate, opened once a build passes review
router.get ('/listings',                              listingController.getListings);
router.get ('/submissions/:slug/listing',             listingController.getListing);
router.post('/submissions/:slug/listing',             listingLimiter, listingController.postListing);
router.post('/submissions/:slug/listing/thumbnail',   listingLimiter, formUpload(developerThumbnail, 'thumbnail'), listingController.postThumbnail);
router.post('/submissions/:slug/listing/banner',      listingLimiter, formUpload(developerPortfolioImage, 'banner'), listingController.postBanner);
router.post('/submissions/:slug/listing/screenshots', listingLimiter, formUploadMany(uploadScreenshots, 'screenshots', 8), listingController.postScreenshots);
router.post('/submissions/:slug/listing/screenshots/:shotId/delete', listingLimiter, listingController.postDeleteScreenshot);

// Guidelines
router.get ('/guidelines',                            guidelinesController.getGuidelines);

// Knowledge Sphere
router.get ('/knowledge',                             knowledgeController.getKnowledge);
router.get ('/knowledge/notes',                       knowledgeController.listNotes);
router.post('/knowledge/notes',                       noteLimiter, knowledgeController.createNote);
router.put ('/knowledge/notes/:id',                   noteLimiter, knowledgeController.updateNote);
router.delete('/knowledge/notes/:id',                 knowledgeController.deleteNote);
router.get ('/knowledge/community',                   communityLimiter, knowledgeController.getCommunity);

// Community — follows, discovery, game comments
router.get   ('/community',                           socialController.getCommunity);
router.post  ('/follow/:handle',                      followLimiter, socialController.follow);
router.delete('/follow/:handle',                      followLimiter, socialController.unfollow);
router.post  ('/games/:gameId/comments',              commentLimiter, socialController.postComment);
router.delete('/game-comments/:commentId',            socialController.deleteComment);

// External Portfolio — games shipped outside Play Mist, shown on /@handle
router.get ('/portfolio',                             portfolioController.getPortfolio);
router.get ('/portfolio/new',                         portfolioController.getNew);
router.post('/portfolio',                             portfolioLimiter, formUpload(developerPortfolioImage, 'image'), portfolioController.postCreate);
router.put ('/portfolio/reorder',                     projectMutateLimiter, portfolioController.putReorder);
router.get ('/portfolio/:id/edit',                    portfolioController.getEdit);
router.post('/portfolio/:id',                         portfolioLimiter, formUpload(developerPortfolioImage, 'image'), portfolioController.postUpdate);
router.post('/portfolio/:id/delete',                  portfolioController.postDelete);

// Projects — page
router.get ('/projects',                              projectsController.getProjects);
router.post('/projects',                              projectMutateLimiter, projectsController.postProject);
router.get ('/projects/:id',                          projectsController.getProjectDetail);
router.post('/projects/:id/update',                   projectMutateLimiter, projectsController.postUpdateProject);
router.put ('/projects/:id/visibility',               projectMutateLimiter, projectsController.putVisibility);
router.post('/projects/:id/delete',                   projectsController.postDeleteProject);

// Projects — task JSON API
router.get   ('/projects/:id/tasks',                              projectsController.listTasks);
router.post  ('/projects/:id/tasks',                              projectMutateLimiter, projectsController.createTask);
router.put   ('/projects/:id/tasks/:taskId',                      projectMutateLimiter, projectsController.updateTask);
router.delete('/projects/:id/tasks/:taskId',                      projectsController.deleteTask);
router.put   ('/projects/:id/tasks/:taskId/move',                 projectMutateLimiter, projectsController.moveTask);

// Projects — comment JSON API
router.get   ('/projects/:id/tasks/:taskId/comments',             projectsController.listComments);
router.post  ('/projects/:id/tasks/:taskId/comments',             noteLimiter, projectsController.addComment);
router.delete('/projects/:id/tasks/:taskId/comments/:commentId',  projectsController.deleteComment);

// Projects — docs JSON API
router.get   ('/projects/:id/docs',           projectDocsController.listDocs);
router.post  ('/projects/:id/docs',           projectMutateLimiter, projectDocsController.createDoc);
router.post  ('/projects/:id/docs/upload',    docUploadLimiter, developerDoc.single('doc'), projectDocsController.uploadDoc);
router.post  ('/projects/:id/docs/image',     docImageLimiter, developerDocImage.single('image'), projectDocsController.uploadDocImage);

// Projects — storyboard JSON API
const sketchFields = developerSketch.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);
router.get   ('/projects/:id/storyboards',            storyboardController.listStoryboards);
router.post  ('/projects/:id/storyboards',            projectMutateLimiter, storyboardController.createStoryboard);
router.put   ('/storyboards/:sbId',                   projectMutateLimiter, storyboardController.updateStoryboard);
router.delete('/storyboards/:sbId',                   storyboardController.deleteStoryboard);
router.get   ('/storyboards/:sbId/frames',            storyboardController.listFrames);
router.post  ('/storyboards/:sbId/frames',            projectMutateLimiter, sketchFields, storyboardController.createFrame);
router.put   ('/storyboards/:sbId/frames/reorder',    projectMutateLimiter, storyboardController.reorderFrames);
router.get   ('/frames/:frameId',                     storyboardController.getFrame);
router.get   ('/frames/:frameId/image',               storyboardController.streamFrameImage);
router.put   ('/frames/:frameId',                     projectMutateLimiter, sketchFields, storyboardController.updateFrame);
router.delete('/frames/:frameId',                     storyboardController.deleteFrame);

// Docs — by docId (no project prefix needed, ownership verified via JOIN)
router.get   ('/docs/:docId',                 projectDocsController.getDoc);
router.put   ('/docs/:docId',                 projectMutateLimiter, projectDocsController.updateDoc);
router.delete('/docs/:docId',                 projectDocsController.deleteDoc);
router.put   ('/docs/:docId/pin',             projectDocsController.pinDoc);

// Profile
router.get ('/profile',                               profileController.getProfile);
router.post('/profile',                               profileUpdateLimiter, profileController.postProfile);
router.get ('/profile/handle-check',                  handleCheckLimiter, profileController.checkHandle);
router.post('/profile/password',                      profileUpdateLimiter, profileController.postPassword);
router.post('/profile/avatar',                        avatarLimiter, jsonUpload(developerThumbnail, 'avatar'), profileController.postAvatar);
router.post('/profile/header',                        avatarLimiter, jsonUpload(developerHeader, 'header'), profileController.postHeader);
router.delete('/profile/header',                      profileController.deleteHeader);

module.exports = router;
