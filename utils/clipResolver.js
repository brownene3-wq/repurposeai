// utils/clipResolver.js
//
// Resolve a previously-rendered Smart Shorts moment clip to a local
// filesystem path that the publishers (workflowEngine, social platform
// uploaders) can read from. Shared by:
//   • routes/shorts.js  → POST /shorts/api/publish-moment  ("Post now")
//   • utils/schedulePublisher.js → cron that publishes scheduled entries
//
// The complication: Railway's /tmp is ephemeral. On every deploy /
// container restart, /tmp is wiped, so the .mp4 the user just rendered
// disappears even though the clip_renders DB row still says 'ready'.
// We keep an R2 backup of every successful render, so the fix is:
//
//   1. Look in /tmp first — that's the hot path for a single pod that
//      hasn't restarted since the render.
//   2. If nothing on disk, ask Postgres (clip_renders) for the most-
//      recent ready clip matching (userId, analysisId, momentIndex).
//   3. If a row exists and has an r2_key (or we can derive 'clips/'+
//      filename), pull the bytes from R2 down to a fresh /tmp path
//      and return that.
//   4. Anything still missing → null, caller decides how to surface it.
//
// Returns { path, source, row } on success, or { path: null, reason }
// on failure. `source` is 'disk' | 'r2-restored' so callers can log it.

const fs = require('fs');
const path = require('path');
const CLIPS_DIR = path.join('/tmp', 'repurpose-clips');
try { if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true }); } catch (_) {}

// Local /tmp scan — matches the original logic in publish-moment so we
// don't regress the hot path. Returns absolute path or null.
function scanDiskForClip(analysisId, momentIndex) {
  if (!analysisId) return null;
  try {
    const files = fs.readdirSync(CLIPS_DIR);
    const tag = '_m' + momentIndex + '_';
    const candidates = files
      .filter(f => f.endsWith('.mp4') && !f.endsWith('.encoding.mp4') && f.includes(analysisId))
      .map(f => {
        const full = path.join(CLIPS_DIR, f);
        try { return { f, full, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size }; }
        catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    const exact = candidates.find(c => c.f.includes(tag));
    const pick = exact || candidates[0];
    if (pick && pick.size > 10000) return pick.full;
  } catch (_) {}
  return null;
}

// True while a render is actively in flight for this analysis (a
// .progress or .encoding.mp4 file is sitting in CLIPS_DIR). Used by
// /api/publish-moment to wait out the rename race when the user
// clicks Publish the same second the render finishes.
function isRenderInFlight(analysisId) {
  if (!analysisId) return false;
  try {
    const files = fs.readdirSync(CLIPS_DIR);
    return files.some(f =>
      f.includes(analysisId) && (f.endsWith('.progress') || f.endsWith('.encoding.mp4'))
    );
  } catch (_) { return false; }
}

// Pull a clip's bytes from R2 back into /tmp using the clip's stored
// filename so subsequent lookups (and the schedulePublisher cron) can
// find it again on the same pod. Returns the absolute local path or
// null on failure.
async function restoreFromR2(row) {
  if (!row || !row.filename) return null;
  let r2;
  try { r2 = require('./r2'); } catch (_) { return null; }
  if (!r2.isConfigured()) return null;
  const key = row.r2_key || ('clips/' + row.filename);
  try {
    const got = await r2.getObject(key);
    if (!got || !got.ok || !got.body || got.body.length < 10000) return null;
    const dest = path.join(CLIPS_DIR, path.basename(row.filename));
    fs.writeFileSync(dest, got.body);
    return dest;
  } catch (e) {
    return null;
  }
}

// Main entry point — try disk first, then DB+R2.
//   userId       — for ownership check on the DB lookup
//   analysisId   — analyses.id
//   momentIndex  — integer 0..N
//   clipRenderOps — pass the db ops module so this util has no DB import
//   opts.waitForInFlight  → if true, poll while a render is in flight
//   opts.timeoutMs        → max wait when waiting for in-flight (default 60s)
async function resolveClipPath(userId, analysisId, momentIndex, clipRenderOps, opts = {}) {
  if (analysisId == null || momentIndex == null) {
    return { path: null, reason: 'missing-args' };
  }
  // 1. Hot path: scan disk.
  let mediaPath = scanDiskForClip(analysisId, momentIndex);
  if (mediaPath) return { path: mediaPath, source: 'disk' };

  // 2. Race guard for the "user clicked Publish while render finishes"
  //    edge case. Only retry briefly if a render is actually in flight.
  if (opts.waitForInFlight) {
    const startTs = Date.now();
    const hardCap = opts.timeoutMs || 60_000;
    while (!mediaPath) {
      const inFlight = isRenderInFlight(analysisId);
      const elapsed = Date.now() - startTs;
      if (!inFlight && elapsed >= 3000) break;
      if (inFlight && elapsed >= hardCap) break;
      await new Promise(r => setTimeout(r, 500));
      mediaPath = scanDiskForClip(analysisId, momentIndex);
      if (mediaPath) return { path: mediaPath, source: 'disk' };
    }
  }

  // 3. Cold path: ask the DB.
  if (!clipRenderOps || typeof clipRenderOps.getByAnalysisAndMoment !== 'function') {
    return { path: null, reason: 'db-not-available' };
  }
  let row;
  try {
    row = await clipRenderOps.getByAnalysisAndMoment(userId, analysisId, momentIndex);
  } catch (e) {
    return { path: null, reason: 'db-error: ' + (e.message || e) };
  }
  if (!row) return { path: null, reason: 'no-db-row' };
  if (row.status !== 'ready') {
    return { path: null, reason: 'row-status-' + row.status, row };
  }

  // 4. Try once more: maybe a parallel request restored it.
  mediaPath = scanDiskForClip(analysisId, momentIndex);
  if (mediaPath) return { path: mediaPath, source: 'disk', row };

  // 5. Final fallback: pull from R2.
  const restored = await restoreFromR2(row);
  if (restored) return { path: restored, source: 'r2-restored', row };

  return { path: null, reason: 'r2-restore-failed', row };
}

module.exports = {
  CLIPS_DIR,
  resolveClipPath,
  scanDiskForClip,
  isRenderInFlight,
  restoreFromR2
};
