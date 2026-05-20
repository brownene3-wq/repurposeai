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
// For each entry we synthesize the destAccount + sourceItem shapes that
// services/workflowEngine.js already understands, read the pre-rendered
// clip file from disk (atcModal generates it at schedule time), and
// dispatch to the appropriate publish<Platform>() helper.
//
// Per-attempt outcome is written back to the entry. On success:
//   status = 'published', published_at = NOW(), publish_error = ''
// On failure:
//   publish_attempts++, publish_error = <message>
// After three failed attempts the cron skips the entry (the user can see
// the error in the calendar and reschedule).

const fs = require('fs');
const path = require('path');

const { calendarOps, pool } = require('../db/database');
const wf = require('../services/workflowEngine');

// Same directory routes/shorts.js writes clips to.
const CLIPS_DIR = path.join('/tmp', 'repurpose-clips');

// Map a calendar_entries.platform value to the workflowEngine helper +
// the user-column we expect the access token in.
const PLATFORM_TABLE = {
  twitter:   { publish: wf.publishTwitter,   tokenCol: 'twitter_access_token',   refreshCol: 'twitter_refresh_token' },
  facebook:  { publish: wf.publishFacebook,  tokenCol: 'facebook_access_token',  refreshCol: null },
  instagram: { publish: wf.publishInstagram, tokenCol: 'instagram_access_token', refreshCol: null },
  tiktok:    { publish: wf.publishTikTok,    tokenCol: 'tiktok_access_token',    refreshCol: 'tiktok_refresh_token' },
  youtube:   { publish: wf.publishYouTube,   tokenCol: 'youtube_access_token',   refreshCol: 'youtube_refresh_token' },
  // 'shorts' on the form is YouTube Shorts — same publish path, same token.
  shorts:    { publish: wf.publishYouTube,   tokenCol: 'youtube_access_token',   refreshCol: 'youtube_refresh_token' },
  // 'x' is just Twitter rebranded.
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
    // publishFacebook posts via /<pageId>/photos with the PAGE token, not
    // the user token. Prefer page_token when we have it.
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

function resolveClipPath(filename) {
  if (!filename) return null;
  const safe = path.basename(filename);
  const full = path.join(CLIPS_DIR, safe);
  try {
    const st = fs.statSync(full);
    if (st.size > 10000) return full;
  } catch (_) {}
  return null;
}

async function publishOneEntry(entry) {
  const platformKey = (entry.platform || '').toLowerCase();
  const cfg = PLATFORM_TABLE[platformKey];
  if (!cfg) {
    throw new Error(`Auto-publish not supported for platform "${entry.platform}"`);
  }
  const user = await loadUser(entry.user_id);
  if (!user) throw new Error('User not found for entry');
  const destAccount = buildDestAccount(platformKey, user);
  if (!destAccount) {
    throw new Error(
      `${entry.platform} isn't connected for this user. Reconnect the account in /settings and reschedule.`
    );
  }
  const mediaPath = resolveClipPath(entry.clip_filename);
  if (!mediaPath) {
    throw new Error(
      'Pre-rendered clip is missing on disk (likely cleared by a server restart). ' +
      'Re-open the moment and schedule again.'
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
