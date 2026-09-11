const express = require('express');
const router  = express.Router();
const profilesController = require('../controllers/profilesController');

// Public developer profiles — https://playmist.app/@handle. No login required;
// everything here is read-only. Follows and comments go through /developer.
router.get('/@:handle',                                      profilesController.getProfile);
router.get('/@:handle/followers',                            profilesController.getConnections('followers'));
router.get('/@:handle/following',                            profilesController.getConnections('following'));
router.get('/@:handle/projects/:projectId',                  profilesController.getProject);
router.get('/@:handle/projects/:projectId/docs/:docId',      profilesController.getDoc);
router.get('/@:handle/projects/:projectId/docs/:docId/content', profilesController.getDocContent);

module.exports = router;
