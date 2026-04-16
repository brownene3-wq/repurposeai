const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { renderRssForm, connectRssFeed } = require('./audiopodcast');

router.get('/connect', requireAuth, (req, res) => {
  res.send(renderRssForm('Video Podcast'));
});

router.post('/authenticate', requireAuth, async (req, res) => {
  await connectRssFeed(req, res, 'videopodcast');
});

module.exports = router;
