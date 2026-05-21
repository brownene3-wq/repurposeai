// ─────────────────────────────────────────────────────────────────────
// utils/connections.js
//
// Single source of truth for "what social accounts has this user
// connected, and how do features other than /distribute consume them."
//
// Today every feature (Smart Shorts, Video Editor, AI Tools, Calendar,
// etc.) is blind to the connected_accounts table. This module + the
// matching /api/connections REST router exist so that:
//
//   1. Any server-side handler can `require('../utils/connections')` and
//      ask "give me this user's TikTok accounts" in one line.
//
//   2. Any frontend can call `fetch('/api/connections?platform=tiktok')`
//      to populate a "Publish to…" dropdown — no per-feature DB code,
//      no per-feature token handling.
//
// Phase 1 (this commit) is read-only: list + lookup helpers + their
// REST endpoints. The publish-dispatch layer (publishToConnection /
// scheduleConnectionPublish) gets added in Phase 2 once a feature
// actually wires the new "Publish to…" UI.
// ─────────────────────────────────────────────────────────────────────

const { connectedAccountOps } = require('../db/database');

// Strip credentials before returning a connection to the frontend. The
// browser never needs to see access_token / refresh_token — only the
// stable display fields. Keep this list tight.
function sanitizeForClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    platformUserId: row.platform_user_id || null,
    platformUsername: row.platform_username || '',
    accountName: row.account_name || row.platform_username || row.platform,
    accountType: row.account_type || 'source_destination',
    tokenExpiresAt: row.token_expires_at || null,
    isActive: row.is_active !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

// ── Read helpers ────────────────────────────────────────────────────

// List every active connection a user has. Returns sanitized rows.
async function getConnections(userId, opts = {}) {
  if (!userId) return [];
  let rows = await connectedAccountOps.getByUser(userId);
  if (opts.platform) {
    rows = rows.filter(r => r.platform === opts.platform);
  }
  return rows.map(sanitizeForClient);
}

// Filter to one platform — common case for "Publish to TikTok" dropdowns.
async function getConnectionsForPlatform(userId, platform) {
  if (!userId || !platform) return [];
  const rows = await connectedAccountOps.getByUserAndPlatform(userId, platform);
  return rows.map(sanitizeForClient);
}

// Look up a single connection. Always scope by userId so one user can't
// query another user's account row. Returns sanitized row or null.
async function getConnectionById(userId, connectionId) {
  if (!userId || !connectionId) return null;
  const row = await connectedAccountOps.getById(connectionId);
  if (!row || row.user_id !== userId) return null;
  return sanitizeForClient(row);
}

// Internal helper for the future publish dispatcher — returns the raw
// row including tokens. NEVER expose this through the REST surface.
// Phase 2 publishers will use this to call the per-platform APIs.
async function getRawConnectionById(userId, connectionId) {
  if (!userId || !connectionId) return null;
  const row = await connectedAccountOps.getById(connectionId);
  if (!row || row.user_id !== userId) return null;
  return row;
}

// Convenience: which platforms does the user have at least one
// connection for? Useful for building "Publish to…" menus that only
// show options the user can actually use.
async function getConnectedPlatforms(userId) {
  const rows = await getConnections(userId);
  const set = new Set(rows.map(r => r.platform));
  return Array.from(set);
}

module.exports = {
  // Public (safe to expose via REST)
  getConnections,
  getConnectionsForPlatform,
  getConnectionById,
  getConnectedPlatforms,
  sanitizeForClient,
  // Internal (server-only)
  getRawConnectionById
};


// ─────────────────────────────────────────────────────────────────────
// Phase 2a — Publish dispatcher
//
// publishToConnection(userId, connectionId, payload) is the single
// entry point every feature uses to actually post something. Behind
// the scenes it:
//   1. Loads the raw connection row (including access/refresh tokens)
//   2. Refreshes the token if needed (LinkedIn etc. expire after hours)
//   3. Dispatches to the platform-specific publisher already living
//      inside services/workflowEngine.js
//
// payload shape (all optional except mediaPath when publishing video):
//   {
//     title:        'Post title or video title',
//     description:  'Longer body text',
//     caption:      'Short caption (Instagram/TikTok-style)',
//     mediaPath:    '/absolute/path/to/video.mp4',
//     mediaUrl:     'https://...',   // fallback if no local path
//     thumbnailUrl: 'https://...',
//     tags:         ['array', 'of', 'tags'],
//     privacy:      'public' | 'unlisted' | 'private'   // YouTube
//   }
//
// Returns: { success: true, platform, externalId?, raw }
//          or { success: false, error: 'message' }
// ─────────────────────────────────────────────────────────────────────

let _engine = null;
function loadEngine() {
  if (_engine) return _engine;
  try { _engine = require('../services/workflowEngine'); } catch (e) { _engine = {}; }
  return _engine;
}

async function publishToConnection(userId, connectionId, payload = {}) {
  if (!userId || !connectionId) {
    return { success: false, error: 'userId and connectionId required' };
  }
  const raw = await getRawConnectionById(userId, connectionId);
  if (!raw) return { success: false, error: 'Connection not found' };
  if (raw.is_active === false) return { success: false, error: 'Connection is inactive' };

  const engine = loadEngine();
  if (!engine || !engine.publishToDestination) {
    return { success: false, error: 'Publisher engine not available' };
  }

  // Refresh tokens if a refresh path exists (LinkedIn today; others can be
  // added without changes here). refreshTokenIfNeeded is a no-op for
  // platforms that don't need it.
  let account = raw;
  if (typeof engine.refreshTokenIfNeeded === 'function') {
    try { account = (await engine.refreshTokenIfNeeded(raw)) || raw; }
    catch (e) { console.error('[publishToConnection] token refresh:', e.message); }
  }

  // Synthesize the 'workflow' + 'sourceItem' shapes the existing
  // publishToDestination expects. The workflow is only used for logging +
  // destination_platform; the sourceItem provides title/description/url/
  // thumbnail to the per-platform publisher.
  const platform = raw.platform;
  const syntheticWorkflow = {
    id: 'oneoff-' + Date.now(),
    destination_platform: platform,
    settings: {}
  };
  const sourceItem = {
    id: payload.externalSourceId || ('oneoff-' + Date.now()),
    title: payload.title || payload.caption || 'Untitled',
    description: payload.description || payload.caption || '',
    caption: payload.caption || payload.description || payload.title || '',
    thumbnail: payload.thumbnailUrl || null,
    url: payload.mediaUrl || null,
    tags: payload.tags || [],
    privacy: payload.privacy || 'public',
    platform: platform,
    publishedAt: new Date()
  };

  try {
    const result = await engine.publishToDestination(
      syntheticWorkflow, account, sourceItem, payload.mediaPath || null
    );
    return { success: true, platform, externalId: result?.videoId || result?.tweetId || result?.id || null, raw: result };
  } catch (err) {
    console.error(`[publishToConnection] ${platform} failed:`, err.message);
    return { success: false, error: err.message || 'Publish failed' };
  }
}

module.exports.publishToConnection = publishToConnection;
