// utils/schedulePublisher.js
//
// Step 2 of the schedule-and-publish feature on /shorts.
//
// The 2-minute cron in server.js calls publishDueEntries() — it picks up
// calendar_entries that are:
//   * auto_publish = TRUE
//   * scheduled_date + scheduled_time <= NOW()
//   * published_at IS NULL
//   * publish_attempts < 3
//
// Two callers create those entries:
//   (a) The Add-to-Calendar atcModal on /shorts. Sets clip_filename to the
//       freshly-rendered clip and leaves connection_id null. We publish
//       via the legacy per-platform helpers in services/workflowEngine.js,
//       using the user's <platform>_access_token columns.
//   (b) The Phase 2 "Publish This Moment" modal. Sets connection_id and
//       leaves clip_filename empty (because the modal doesn't require the
//       user to render first). We publish via utils/connections.js's
//       publishToConnection(userId, connectionId, payload).
//
// In both cases we resolve the actual clip file on disk by:
//   * Honoring the literal clip_filename if it exists and is non-empty.
//   * Otherwise searching CLIPS_DIR for a file containing the analysis_id
//     (and ideally the '_m<idx>_' tag added in commit b50216b) — that's
//     the same resolver shape /shorts/api/publish-moment uses for the
//     immediate-publish path.
//
// Per-attempt outcome is written back to the entry. On success:
//   status = 'published', published_at = NOW(), publish_error = ''
// On failure: publish_attempts++, publish_error = <message>. After three
// attempts the cron stops retrying.

const fs = require('fs');
const path = require('path');

const { calendarOps, pool } = require('../db/database');
const wf = require('../services/workflowEngine');

// Same directory routes/shorts.js writes clips to.
const CLIPS_DIR = path.join('/tmp', 'repurpose-clips');

// Legacy per-platform table — used when an entry was created via the
// atcModal flow (no connection_id) and the user has the per-platform
// access token saved on the users row.
const PLATFORM_TABLE = {
  twitter:   { publish: wf.publishTwitter,   tokenCol: 'twitter_access_token',   refreshCol: 'twitter_refresh_token' },
  facebook:  { publish: wf.publishFacebook,  tokenCol: 'facebook_access_token',  refreshCol: null },
  instagram: { publish: wf.publishInstagram, tokenCol: 'instagram_access_token', refreshCol: null },
  tiktok:    { publish: wf.publishTikTok,    tokenCol: 'tiktok_access_token',    refreshCol: 'tiktok_refresh_token' },
  youtube:   { publish: wf.publishYouTube,   tokenCol: 'youtube_access_token',   refreshCol: 'youtube_refresh_token' },
  shorts:    { publish: wf.publishYouTube,   tokenCol: 'youtube_access_token',   refreshCol: 'youtube_refresh_token' },
  x:         { publish: wf.publishTwitter,   tokenCol: 'twitter_access_token',   refreshCol: 'twitter_refresh_token' },
};

async function loadUser(userId) {
  const r = await pool.query(
    `SELECT id, name, email,
            twitter_access_token, twitter_refresh_token,
            facebook_access_token, facebook_page_id, facebook_page_token,
            instagram_access_token,
            tiktok_access_token, tiktok_refresh_token,
            youtube_access_token, youtube_refresh_token, youtube_channel_name,
            linkedin_access_token, linkedin_refresh_token
     FROM users WHERE id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

function buildDestAccount(platform, user) {
  const cfg = PLATFORM_TABLE[platform];
  if (!cfg) return null;
  const token = user[cfg.tokenCol];
  if (!token) return null;
  const destAccount = {
    access_token: token,
    refresh_token: cfg.refreshCol ? user[cfg.refreshCol] : null,
    platform,
    user_id: user.id,
    metadata: {}
  };
  if (platform === 'facebook') {
    destAccount.metadata.page_id = user.facebook_page_id || null;
    destAccount.platform_user_id = user.facebook_page_id || null;
    if (user.facebook_page_token) destAccount.access_token = user.facebook_page_token;
  }
  return destAccount;
}

function buildSourceItem(entry) {
  return {
    title:       (entry.title || '').slice(0, 100),
    description: (entry.notes || entry.content_text || entry.title || '').slice(0, 2000),
    mediaType:   'VIDEO',
    thumbnail:   null
  };
}

// Resolve a clip file on disk for this entry. Prefers entry.clip_filename
// if it exists and is non-empty; otherwise searches CLIPS_DIR for the most
// recent mp4 that matches the entry's analysis_id (+ optional '_m<idx>_'
// tag). Returns null if nothing usable is found.
function resolveClipPath(entry) {
  // 1. Explicit clip_filename (the atcModal flow sets this).
  const explicit = (entry.clip_filename || '').trim();
  if (explicit) {
    const safe = path.basename(explicit);
    const full = path.join(CLIPS_DIR, safe);
    try {
      const st = fs.statSync(full);
      if (st.size > 10000) return full;
    } catch (_) {}
    // Fall through to the directory scan if the literal file is gone
    // (Railway redeploy wiped /tmp, etc.).
  }

  // 2. Directory scan — matches the publish-moment endpoint's resolver
  //    so both code paths behave consistently.
  const analysisId = entry.analysis_id;
  if (!analysisId) return null;
  try {
    const files = fs.readdirSync(CLIPS_DIR);
    const candidates = files
      .filter(f => f.endsWith('.mp4') && f.includes(analysisId))
      .map(f => {
        const full = path.join(CLIPS_DIR, f);
        try { return { f, full, mtime: fs.statSync(full).mtimeMs }; }
        catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    const tag = '_m' + entry.moment_index + '_';
    const exact = candidates.find(c => c.f.includes(tag));
    const pick = exact || candidates[0];
    if (pick && fs.statSync(pick.full).size > 10000) return pick.full;
  } catch (_) {}
  return null;
}

// === Publish dispatch ===
//
// We have two dispatch paths now:
//   - Phase-2 path: entry has connection_id → publishToConnection
//   - Legacy path:  entry has only platform → workflowEngine direct
async function publishOneEntry(entry) {
  const mediaPath = resolveClipPath(entry);
  if (!mediaPath) {
    throw new Error(
      'No rendered clip on disk for this entry. Click Download Clip on the ' +
      'matching moment so a clip is available, then the cron will pick it up ' +
      'on the next 2-minute tick.'
    );
  }

  // Phase-2 path — use connection_id + publishToConnection. This is the
  // canonical path for entries created by the new "Publish This Moment"
  // modal. publishToConnection handles per-platform tokens, refresh, etc.
  if (entry.connection_id) {
    const { publishToConnection } = require('./connections');
    const payload = {
      title:       (entry.title || '').slice(0, 100),
      description: (entry.notes || entry.content_text || entry.title || '').slice(0, 2000),
      caption:     (entry.content_text || entry.notes || '').slice(0, 2000),
      mediaPath
    };
    const result = await publishToConnection(entry.user_id, entry.connection_id, payload);
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'publishToConnection returned no success flag');
    }
    return result;
  }

  // Legacy path — entry created by atcModal, dispatch via workflowEngine
  // using the user's per-platform token columns.
  const platformKey = (entry.platform || '').toLowerCase();
  const cfg = PLATFORM_TABLE[platformKey];
  if (!cfg) {
    throw new Error(
      `Entry has no connection_id and platform "${entry.platform}" isn't ` +
      `mapped for legacy auto-publish.`
    );
  }
  const user = await loadUser(entry.user_id);
  if (!user) throw new Error('User not found for entry');
  const destAccount = buildDestAccount(platformKey, user);
  if (!destAccount) {
    throw new Error(
      `${entry.platform} isn't connected on the user row. Connect via /settings ` +
      `or use the new Publish This Moment modal which uses Connected Accounts.`
    );
  }
  const sourceItem = buildSourceItem(entry);
  try { await wf.refreshTokenIfNeeded(destAccount); } catch (_) {}
  return await cfg.publish(destAccount, sourceItem, mediaPath);
}

async function publishDueEntries() {
  let due;
  try {
    due = await calendarOps.getDueForPublish();
  } catch (e) {
    console.log('[schedulePublisher] getDueForPublish failed:', e.message);
    return;
  }
  if (!due || due.length === 0) return;
  console.log(`[schedulePublisher] ${due.length} entr${due.length === 1 ? 'y' : 'ies'} due for publish`);
  for (const entry of due) {
    try {
      const result = await publishOneEntry(entry);
      await calendarOps.markPublished(entry.id);
      console.log(
        `[schedulePublisher] published "${entry.title}" to ${entry.platform} ` +
        `via ${entry.connection_id ? 'connection ' + entry.connection_id : 'legacy'} ` +
        `(${(result && JSON.stringify(result).slice(0, 120)) || 'ok'})`
      );
    } catch (err) {
      const msg = (err && err.message) || 'Unknown publish error';
      await calendarOps.markPublishFailed(entry.id, msg);
      console.error(
        `[schedulePublisher] FAILED to publish "${entry.title}" to ${entry.platform}: ${msg}`
      );
    }
  }
}

module.exports = { publishDueEntries };
