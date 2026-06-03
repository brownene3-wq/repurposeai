// utils/renderRecorder.js
//
// Shared helper that every tool with a "downloadable output" calls
// after a successful render. Two responsibilities:
//
//   1) Insert a user_renders row so the Library page can list this
//      output under its tool tab.
//   2) Best-effort push the file to R2 so the Library download
//      endpoint can serve it even after Railway wipes /tmp.
//
// Designed to be call-and-forget — failures are caught and logged so
// they never bubble up and break the render flow itself. The user's
// download/export still completes; the Library entry just won't
// appear if the DB or R2 hiccup.
//
// Tool slugs (the 'tool' column on user_renders) — keep these in
// sync with the tabs in /repurpose/history:
//   'video-editor'   — Video Editor timeline exports
//   'ai-captions'    — AI Captions burned-in videos
//   'ai-hook'        — AI Hook generated opener clips
//   'ai-reframe'     — AI Reframe vertical/square renders
//   'ai-broll'       — AI B-Roll final assemblies
//   'ai-thumbnail'   — AI Thumbnail PNG/JPG images
//
// 'smart-shorts' is excluded on purpose — Smart Shorts clips
// already live in clip_renders (My Clips), and the Library Clips
// tab embeds /shorts/clips directly. Don't double-record.

const fs = require('fs');
const path = require('path');

let r2 = null;
try { r2 = require('./r2'); } catch (_) {}

let userRenderOps = null;
try { userRenderOps = require('../db/database').userRenderOps; } catch (_) {}

// Upload the file at absPath to R2 under r2Key. Returns the key on
// success, null on any failure / R2 not configured. Best-effort.
async function backupToR2(absPath, r2Key) {
  if (!r2 || typeof r2.isConfigured !== 'function' || !r2.isConfigured()) return null;
  try {
    const bytes = fs.readFileSync(absPath);
    const contentType = guessContentType(absPath);
    const put = await r2.putObject(r2Key, bytes, contentType);
    return (put && put.ok) ? r2Key : null;
  } catch (e) {
    console.warn('[renderRecorder] R2 upload failed for', absPath, '-', e.message);
    return null;
  }
}

function guessContentType(p) {
  const ext = (path.extname(p) || '').toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

// Main entry point. Call after a render completes successfully.
//
//   userId            — owner
//   opts.tool         — one of the slugs listed above (required)
//   opts.absPath      — absolute path to the rendered file (required)
//   opts.kind         — 'video' | 'image' (default 'video')
//   opts.title        — human-readable title (defaults to filename)
//   opts.sourceUrl    — URL the render was generated from (optional)
//   opts.sourceId     — DB id of the source analysis/project/etc. (optional)
//   opts.thumbnailUrl — for images this is usually the file itself;
//                       for videos a poster frame URL (optional)
//   opts.durationSeconds — for videos (optional)
//   opts.metadata     — JSON-serializable extras (aspect ratio, preset,
//                       caption style, etc.) (optional)
//   opts.skipR2       — set true to log without uploading (rare)
//
// Returns { id, r2Key } on success, null on failure.
async function recordRender(userId, opts) {
  if (!userId) { console.warn('[renderRecorder] missing userId'); return null; }
  if (!opts || !opts.tool) { console.warn('[renderRecorder] missing tool'); return null; }
  if (!opts.absPath) { console.warn('[renderRecorder] missing absPath'); return null; }
  if (!userRenderOps || typeof userRenderOps.create !== 'function') {
    console.warn('[renderRecorder] userRenderOps not available');
    return null;
  }

  let fileSize = 0;
  try { fileSize = fs.statSync(opts.absPath).size; } catch (_) {}
  if (fileSize < 1) {
    console.warn('[renderRecorder] file missing or zero bytes:', opts.absPath);
    return null;
  }

  const filename = path.basename(opts.absPath);
  const title = opts.title || filename.replace(/\.[a-z0-9]+$/i, '');

  // Push to R2 first so we can record the key in the DB row.
  let r2Key = null;
  if (!opts.skipR2) {
    const key = 'library/' + opts.tool + '/' + filename;
    r2Key = await backupToR2(opts.absPath, key);
  }

  try {
    const row = await userRenderOps.create(userId, {
      tool: opts.tool,
      kind: opts.kind || 'video',
      filename,
      title,
      sourceUrl: opts.sourceUrl || null,
      sourceId: opts.sourceId || null,
      thumbnailUrl: opts.thumbnailUrl || null,
      r2Key,
      fileSize,
      durationSeconds: opts.durationSeconds || null,
      status: 'ready',
      metadata: opts.metadata || null
    });
    return { id: row && row.id, r2Key };
  } catch (e) {
    console.warn('[renderRecorder] DB insert failed for', filename, '-', e.message);
    return null;
  }
}

module.exports = { recordRender, backupToR2 };
