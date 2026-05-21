// ─────────────────────────────────────────────────────────────────────
// routes/connections.js
//
// REST surface for the centralized Connected Accounts system. Mounted
// at /api/connections in server.js.
//
// Every user-facing feature (Smart Shorts, Video Editor, AI Tools,
// Calendar, Repurpose) consumes this endpoint to render its own
// "Publish to…" / "Pull from…" dropdowns. The /distribute UI still
// owns the OAuth handshake; this router only reads.
//
// Phase 1 (this commit): GET-only.
// Phase 2 (later): POST /api/connections/:id/publish — direct publish
// or schedule, depending on the body.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  getConnections,
  getConnectionById,
  getConnectedPlatforms
} = require('../utils/connections');

// GET /api/connections             — list all (optional ?platform=tiktok)
// GET /api/connections?platforms=1 — just the set of distinct platforms
router.get('/', requireAuth, async (req, res) => {
  try {
    if (req.query.platforms === '1' || req.query.platforms === 'true') {
      const platforms = await getConnectedPlatforms(req.user.id);
      return res.json({ success: true, platforms });
    }
    const platform = req.query.platform || null;
    const accounts = await getConnections(req.user.id, platform ? { platform } : {});
    res.json({ success: true, accounts });
  } catch (err) {
    console.error('[GET /api/connections] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load connections' });
  }
});

// GET /api/connections/:id — single connection (404 if not the user's)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const account = await getConnectionById(req.user.id, req.params.id);
    if (!account) return res.status(404).json({ success: false, error: 'Connection not found' });
    res.json({ success: true, account });
  } catch (err) {
    console.error('[GET /api/connections/:id] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load connection' });
  }
});

module.exports = router;
