/**
 * routes/devapi.js — /api/dev/v1, the Playmist Studio app's surface.
 *
 * Mounted BEFORE express-session in server.js (see the comment there): these
 * routes authenticate with a bearer token, and keeping them off the session
 * middleware means requireDeveloperJwt can present `req.session.developer`
 * to the portal controllers below without ever touching the session store.
 *
 * Most handlers here ARE the portal's handlers. Anything the portal already
 * answers as JSON — tasks, task comments, docs, storyboards, builder files —
 * is mounted unchanged, so the app and the website are the same feature with
 * two front ends rather than two implementations that drift.
 */
const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');

const { requireDeveloperJwt } = require('../middleware/devApiAuth');
const {
  developerThumbnail, developerHeader, developerDoc, developerSketch,
  developerDocImage, builderAsset, developerSubmissionFiles,
} = require('../config/upload');

// Studio-specific controllers
const authApi        = require('../controllers/devapi/authApi');
const projectsApi    = require('../controllers/devapi/projectsApi');
const builderApi     = require('../controllers/devapi/builderApi');
const submissionsApi = require('../controllers/devapi/submissionsApi');
const buildApi       = require('../controllers/devapi/buildApi');
const sandboxApi     = require('../controllers/devapi/sandboxApi');

// Portal controllers, reused verbatim
const projectsController    = require('../controllers/developer/projectsController');
const projectDocsController = require('../controllers/developer/projectDocsController');
const storyboardController  = require('../controllers/developer/storyboardController');
const builderController     = require('../controllers/developer/builderController');
const profileController     = require('../controllers/developer/profileController');

// ── Rate limiters ────────────────────────────────────────────────────────────
// IP-keyed for the unauthenticated endpoints; account-keyed once there is an
// account to key on, since a studio can share one office IP.

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Too many signups from this network. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
});

const byDeveloper = (req) => `devapi:${req.session.developer.id}`;
const jsonLimit = (message) => (req, res) => res.status(429).json({ error: message });

const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 400, keyGenerator: byDeveloper,
  handler: jsonLimit('Too many changes. Please try again in a little while.'),
  standardHeaders: true, legacyHeaders: false,
});

// The editor saves on a debounce and on Ctrl/Cmd+S — the ceiling has to clear
// a busy session without letting a runaway loop hammer the disk (same shape
// as the portal's builderWriteLimiter).
const builderWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 600, keyGenerator: byDeveloper,
  handler: jsonLimit('You’re saving too quickly. Give it a moment and try again.'),
  standardHeaders: true, legacyHeaders: false,
});

// Each test launch packs a zip out of the workspace, so it is capped far
// lower than the file API.
const sandboxLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 40, keyGenerator: byDeveloper,
  handler: jsonLimit('Too many test launches. Give it a moment and try again.'),
  standardHeaders: true, legacyHeaders: false,
});

// A build upload is a 250 MB write plus an extraction, so it gets its own,
// tighter ceiling than the general write limiter.
const buildUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, keyGenerator: byDeveloper,
  handler: jsonLimit('Too many build uploads. Please try again in a little while.'),
  standardHeaders: true, legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 5, keyGenerator: byDeveloper,
  handler: jsonLimit('Daily submission limit reached. Try again tomorrow.'),
  standardHeaders: true, legacyHeaders: false,
});

/**
 * The build zip upload. Reuses the submission uploader, so the app's 250 MB
 * ceiling and "must be a zip" filter are the website's, not a second pair of
 * numbers that can drift from it. Multer's own rejection is recorded rather
 * than thrown, so the controller answers with JSON the app can show.
 */
const buildZipUpload = (req, res, next) =>
  developerSubmissionFiles.single('build')(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'That build is too large — the limit is 250 MB.'
        : (err.message || 'Upload failed.');
    }
    next();
  });

// Turns multer's size/type errors into the JSON body the app shows, instead of
// the generic 500 handler.
const jsonUpload = (uploader, field) => (req, res, next) =>
  uploader.single(field)(req, res, (err) => {
    if (!err) return next();
    const error = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : (err.message || 'Upload failed.');
    res.status(400).json({ error });
  });

// ── Public (no token) ────────────────────────────────────────────────────────
router.post('/auth/signup',              signupLimiter, authApi.signup);
router.post('/auth/verify-email',        authLimiter,   authApi.verifyEmail);
router.post('/auth/resend-verification', authLimiter,   authApi.resendVerification);
router.post('/auth/login',               authLimiter,   authApi.login);
router.post('/auth/refresh',                            authApi.refresh);
router.post('/auth/forgot-password',     authLimiter,   authApi.forgotPassword);
router.post('/auth/reset-password',      authLimiter,   authApi.resetPassword);

// ── Test build download (token in the URL, deliberately outside the gate) ────
// WebGLPlayerPlugin downloads this with a plain HttpURLConnection that sends
// no Authorization header — and that Kotlin file is shared byte-for-byte with
// the player app, so it stays that way. The unguessable, short-lived,
// single-project token is the authorisation. Same reasoning as the Game
// Builder's preview route (§5.7).
// Its own prefix, not /sandbox/build/:token: that shape also matches
// /sandbox/:project/<anything> for a project whose slug is "build", and a
// developer is entirely entitled to call a project "Build".
router.get('/sandbox-build/:token', sandboxApi.downloadBuild);

// ── Everything below requires a developer bearer token ───────────────────────
router.use(requireDeveloperJwt);

router.get ('/auth/me',     authApi.me);
router.get ('/dashboard',   projectsApi.dashboard);
router.get ('/genres',      submissionsApi.genres);

// Projects
router.get   ('/projects',        projectsApi.list);
router.post  ('/projects',        writeLimiter, projectsApi.create);
router.get   ('/projects/:id',    projectsApi.detail);
router.put   ('/projects/:id',    writeLimiter, projectsApi.update);
router.delete('/projects/:id',    projectsApi.remove);
router.put   ('/projects/:id/visibility', writeLimiter, projectsController.putVisibility);

// The project's playable build — the Game Builder workspace, or a zip the
// developer exported from Godot/Unity/Construct and uploaded here.
router.get   ('/projects/:project/build',         buildApi.getBuild);
router.post  ('/projects/:project/build/upload',  buildUploadLimiter, buildZipUpload, buildApi.uploadBuild);
router.put   ('/projects/:project/build/source',  writeLimiter, buildApi.setSource);
router.delete('/projects/:project/build/upload',  buildApi.deleteUpload);

// Tasks & task comments — the portal's own JSON handlers
router.get   ('/projects/:id/tasks',                             projectsController.listTasks);
router.post  ('/projects/:id/tasks',                             writeLimiter, projectsController.createTask);
router.put   ('/projects/:id/tasks/:taskId',                     writeLimiter, projectsController.updateTask);
router.delete('/projects/:id/tasks/:taskId',                     projectsController.deleteTask);
router.put   ('/projects/:id/tasks/:taskId/move',                writeLimiter, projectsController.moveTask);
router.get   ('/projects/:id/tasks/:taskId/comments',            projectsController.listComments);
router.post  ('/projects/:id/tasks/:taskId/comments',            writeLimiter, projectsController.addComment);
router.delete('/projects/:id/tasks/:taskId/comments/:commentId', projectsController.deleteComment);

// Documents
router.get   ('/projects/:id/docs',        projectDocsController.listDocs);
router.post  ('/projects/:id/docs',        writeLimiter, projectDocsController.createDoc);
router.post  ('/projects/:id/docs/upload', writeLimiter, jsonUpload(developerDoc, 'doc'), projectDocsController.uploadDoc);
router.post  ('/projects/:id/docs/image',  writeLimiter, jsonUpload(developerDocImage, 'image'), projectDocsController.uploadDocImage);
router.get   ('/docs/:docId',              projectDocsController.getDoc);
router.put   ('/docs/:docId',              writeLimiter, projectDocsController.updateDoc);
router.delete('/docs/:docId',              projectDocsController.deleteDoc);
router.put   ('/docs/:docId/pin',          projectDocsController.pinDoc);

// Storyboards
const sketchFields = developerSketch.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);
router.get   ('/projects/:id/storyboards',         storyboardController.listStoryboards);
router.post  ('/projects/:id/storyboards',         writeLimiter, storyboardController.createStoryboard);
router.put   ('/storyboards/:sbId',                writeLimiter, storyboardController.updateStoryboard);
router.delete('/storyboards/:sbId',                storyboardController.deleteStoryboard);
router.get   ('/storyboards/:sbId/frames',         storyboardController.listFrames);
router.post  ('/storyboards/:sbId/frames',         writeLimiter, sketchFields, storyboardController.createFrame);
router.put   ('/storyboards/:sbId/frames/reorder', writeLimiter, storyboardController.reorderFrames);
router.get   ('/frames/:frameId',                  storyboardController.getFrame);
router.get   ('/frames/:frameId/image',            storyboardController.streamFrameImage);
router.put   ('/frames/:frameId',                  writeLimiter, sketchFields, storyboardController.updateFrame);
router.delete('/frames/:frameId',                  storyboardController.deleteFrame);

// Game Builder — page-shaped actions as JSON, file API reused verbatim
router.get ('/builder/templates',              builderApi.listTemplates);
router.get ('/builder/:project',               builderApi.getWorkspace);
router.post('/builder/:project/template',      writeLimiter, builderApi.selectTemplate);
router.post('/builder/:project/reset',         writeLimiter, builderApi.resetWorkspace);
router.get ('/builder/:project/export',        builderController.exportWorkspace);

router.get   ('/builder/:project/files',  builderController.listFiles);
router.get   ('/builder/:project/file',   builderController.readFile);
router.put   ('/builder/:project/file',   builderWriteLimiter, builderController.saveFile);
router.post  ('/builder/:project/file',   builderWriteLimiter, builderController.createFile);
router.post  ('/builder/:project/folder', builderWriteLimiter, builderController.createFolder);
router.post  ('/builder/:project/rename', builderWriteLimiter, builderController.renameEntry);
router.delete('/builder/:project/entry',  builderWriteLimiter, builderController.deleteEntry);
// The in-app preview frame. Mints the same short-lived grant the website's
// IDE uses, and the preview itself is served by the portal route
// (/developer/builder-preview/<token>/) — one sandboxed preview server, not a
// second one that could diverge on what it injects or what it refuses.
router.post  ('/builder/:project/preview-token', builderWriteLimiter, builderController.createPreviewToken);

router.post  ('/builder/:project/upload', builderWriteLimiter,
  (req, res, next) => builderAsset.single('file')(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'That image is too large — the limit is 5 MB.'
        : (err.message || 'Upload failed.');
    }
    next();
  }), builderController.uploadAsset);

// Test Lab
router.post  ('/sandbox/:project/session',            sandboxLimiter, sandboxApi.createSession);
router.post  ('/sandbox/:project/reset-progress',     writeLimiter,   sandboxApi.resetProgress);
router.get   ('/sandbox/player',                      sandboxApi.getTestPlayer);

// What the game's Playmist SDK calls actually did during test sessions —
// successes and, above all, the failures that used to vanish.
router.get   ('/sandbox/:project/activity',           sandboxApi.listActivity);
router.delete('/sandbox/:project/activity',           sandboxApi.clearActivity);
router.get   ('/sandbox/:project/usage/:kind',        sandboxApi.usage);
router.post  ('/sandbox/player/topup',                writeLimiter, sandboxApi.topUpTestPlayer);
router.get   ('/sandbox/:project/config/:kind',                     sandboxApi.listConfig);
router.post  ('/sandbox/:project/config/:kind',        writeLimiter, sandboxApi.createConfig);
router.put   ('/sandbox/:project/config/:kind/:itemId', writeLimiter, sandboxApi.updateConfig);
router.delete('/sandbox/:project/config/:kind/:itemId', sandboxApi.deleteConfig);

// Submissions
router.get ('/submissions',                          submissionsApi.list);
router.get ('/submissions/:slug',                    submissionsApi.detail);
router.post('/submissions/from-project/:project',    uploadLimiter, submissionsApi.createFromProject);
router.post('/submissions/:slug/submit-review',      submissionsApi.submitForReview);

// Profile — the portal's own handlers, which already answer JSON
router.get ('/profile/handle-check', profileController.checkHandle);
router.post('/profile/avatar',       writeLimiter, jsonUpload(developerThumbnail, 'avatar'), profileController.postAvatar);
router.post('/profile/header',       writeLimiter, jsonUpload(developerHeader, 'header'), profileController.postHeader);
router.delete('/profile/header',     profileController.deleteHeader);

module.exports = router;
