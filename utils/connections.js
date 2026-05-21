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
