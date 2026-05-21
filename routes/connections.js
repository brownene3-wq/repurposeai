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
  getConnectedPlatforms,
  publishToConnection
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

// POST /api/connections/:id/publish — Phase 2a publish dispatcher
//
// Body (JSON):
//   { title, description, caption, mediaPath, mediaUrl, thumbnailUrl,
//     tags, privacy, scheduledAt }
//
// If scheduledAt is omitted or in the past, publishes immediately.
// If scheduledAt is in the future, a Phase 2b follow-up will queue it —
// for now this endpoint returns 501 with a clear message so callers
// can wire the UI before scheduling is implemented.
router.post('/:id/publish', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};

    // Defer scheduling — Phase 2b implements the queue.
    if (body.scheduledAt) {
      const when = new Date(body.scheduledAt);
      if (!isNaN(when.getTime()) && when.getTime() > Date.now() + 60_000) {
        return res.status(501).json({
          success: false,
          error: 'Scheduled publishing is not yet implemented (Phase 2b). Use the Calendar to schedule for now.',
          deferUntil: when.toISOString()
        });
      }
    }

    const result = await publishToConnection(req.user.id, id, body);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('[POST /api/connections/:id/publish] error:', err.message);
    res.status(500).json({ success: false, error: 'Publish failed' });
  }
});

module.exports = router;
