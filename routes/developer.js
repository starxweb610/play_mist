const express      = require('express');
const router       = express.Router();
const rateLimit    = require('express-rate-limit');
const { isDeveloper, checkBanned } = require('../middleware/developerAuth');
const { developerUpload, developerThumbnail, developerDoc } = require('../config/upload');

const authController        = require('../controllers/developer/authController');
const dashboardController   = require('../controllers/developer/dashboardController');
const submissionsController = require('../controllers/developer/submissionsController');
const guidelinesController  = require('../controllers/developer/guidelinesController');
const knowledgeController   = require('../controllers/developer/knowledgeController');
const projectsController    = require('../controllers/developer/projectsController');
const profileController     = require('../controllers/developer/profileController');
const projectDocsController = require('../controllers/developer/projectDocsController');

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

// ── Public ────────────────────────────────────────────────────────────────────
router.get ('/',        (req, res) => req.session.developer ? res.redirect('/developer/dashboard') : res.redirect('/developer/login'));
router.get ('/signup',  authController.getSignup);
router.post('/signup',  signupLimiter, authController.postSignup);
router.get ('/login',   authController.getLogin);
router.post('/login',   authLimiter,   authController.postLogin);
router.get ('/logout',  authController.logout);

// ── Protected (requires developer session + ban check) ────────────────────────
router.use(isDeveloper, checkBanned);

// Dashboard & Submissions
router.get ('/dashboard',                             dashboardController.getDashboard);
router.get ('/submissions/:id',                       dashboardController.getSubmissionDetail);
router.get ('/submit',                                submissionsController.getSubmit);
router.post('/submit',                                uploadLimiter, developerUpload.single('game_zip'), submissionsController.postSubmit);
router.post('/submissions/:id/submit-review',         submissionsController.postSubmitReview);

// Guidelines
router.get ('/guidelines',                            guidelinesController.getGuidelines);

// Knowledge Sphere
router.get ('/knowledge',                             knowledgeController.getKnowledge);
router.get ('/knowledge/notes',                       knowledgeController.listNotes);
router.post('/knowledge/notes',                       noteLimiter, knowledgeController.createNote);
router.put ('/knowledge/notes/:id',                   noteLimiter, knowledgeController.updateNote);
router.delete('/knowledge/notes/:id',                 knowledgeController.deleteNote);
router.get ('/knowledge/community',                   communityLimiter, knowledgeController.getCommunity);

// Projects — page
router.get ('/projects',                              projectsController.getProjects);
router.post('/projects',                              projectMutateLimiter, projectsController.postProject);
router.get ('/projects/:id',                          projectsController.getProjectDetail);
router.post('/projects/:id/update',                   projectMutateLimiter, projectsController.postUpdateProject);
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

// Docs — by docId (no project prefix needed, ownership verified via JOIN)
router.get   ('/docs/:docId',                 projectDocsController.getDoc);
router.put   ('/docs/:docId',                 projectMutateLimiter, projectDocsController.updateDoc);
router.delete('/docs/:docId',                 projectDocsController.deleteDoc);
router.put   ('/docs/:docId/pin',             projectDocsController.pinDoc);

// Profile
router.get ('/profile',                               profileController.getProfile);
router.post('/profile',                               profileUpdateLimiter, profileController.postProfile);
router.post('/profile/password',                      profileUpdateLimiter, profileController.postPassword);
router.post('/profile/avatar',                        avatarLimiter, developerThumbnail.single('avatar'), profileController.postAvatar);

module.exports = router;
