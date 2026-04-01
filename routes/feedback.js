const express = require('express');
const router = express.Router();
const { bugReportOps } = require('../db/database');

// Submit a bug report (authenticated or anonymous)
router.post('/api/submit', async (req, res) => {
  try {
    const { category, page, description } = req.body;
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Please describe the issue' });
    }

    // Try to get user info from token if logged in
    let userId = null;
    let userEmail = '';
    try {
      const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'repurposeai-secret-key-change-in-production';
        const decoded = jwt.verify(token, JWT_SECRET);
        const { userOps } = require('../db/database');
        const user = await userOps.getById(decoded.id);
        if (user) {
          userId = user.id;
          userEmail = user.email;
        }
      }
    } catch (e) {
      // Not logged in, that's fine
    }

    const report = await bugReportOps.create(
      userId,
      userEmail,
      category || 'bug',
      page || '',
      description.trim()
    );

    res.json({ success: true, message: 'Thank you! Your feedback has been submitted.', id: report.id });
  } catch (err) {
    console.error('Bug report error:', err);
    res.status(500).json({ error: 'Failed to submit feedback. Please try again.' });
  }
});

module.exports = router;
