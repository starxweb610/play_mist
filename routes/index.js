const express = require('express');
const router  = express.Router();
const publicController = require('../controllers/publicController');

// GET /
router.get('/', publicController.getHome);

module.exports = router;
