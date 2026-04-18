const express = require('express');
const router  = express.Router();
const publicController = require('../controllers/publicController');

// GET /
router.get('/', publicController.getHome);

// GET /privacy-policy
router.get('/privacy-policy', publicController.getPrivacyPolicy);

module.exports = router;
