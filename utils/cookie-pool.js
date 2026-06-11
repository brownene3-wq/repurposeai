// utils/cookie-pool.js
//
// Cookie-pool provider for YouTube downloads. Lets every downloader in
// Splicora try a manually-warmed Gmail account's cookies first
// (highest-reliability layer) before falling back to proxies / paid APIs.
//
// USAGE:
//   const { withCookiePool, getCookiesArgs } = require('./cookie-pool');
//   await withCookiePool(async (cookieArgs) => {
//     // cookieArgs is ['--cookies', '/tmp/yt-pool-xxx.txt'] or []
//     // run yt-dlp with [...baseArgs, ...cookieArgs] and check outcome
//     ...
//   });
//
// Or the lower-level API:
//   const handle = await pickCookieHandle();
//   if (handle) {
//     // use handle.args (a ['--cookies', tmpPath] array) with yt-dlp
//     // when done:
//     await handle.markSuccess();  // or handle.markFailure(errMsg)
//     handle.cleanup();
//   }
//
// On 3+ failures within 24h the cookie set is auto-expired and an email
// notification is sent to hello@splicora.ai and brownene3@gmail.com
// so the operator knows to re-export from Multilogin.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TMP_DIR = path.join(os.tmpdir(), 'repurpose-yt-cookies');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) {}

let _lastNotificationAt = 0;
const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hr — never spam more than once per hour

// Resolve the proxy URL for a given cookie's geo region.
// Lookup order:
//   1. process.env.YT_PROXY_URL_<REGION>  (e.g. YT_PROXY_URL_US, YT_PROXY_URL_BG)
//   2. process.env.YT_PROXY_URL           (legacy/default — current Bulgarian IPRoyal URL)
//   3. none — empty args, no proxy
// Returns ['--proxy', url] or [].
function resolveProxyForRegion(region) {
  if (region) {
    const key = 'YT_PROXY_URL_' + String(region).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    const regionProxy = process.env[key];
    if (regionProxy && regionProxy.trim()) {
      // Support comma-separated proxy lists per region — pick at random per request
      const pool = regionProxy.split(',').map(s => s.trim()).filter(Boolean);
      if (pool.length) return ['--proxy', pool[Math.floor(Math.random() * pool.length)]];
    }
  }
  const fallback = process.env.YT_PROXY_URL;
  if (fallback && fallback.trim()) {
    const pool = fallback.split(',').map(s => s.trim()).filter(Boolean);
    if (pool.length) return ['--proxy', pool[Math.floor(Math.random() * pool.length)]];
  }
  return [];
}

async function sendExpiryNotification(label) {
  // Throttle so a burst of failures doesn't email a dozen times.
  const now = Date.now();
  if (now - _lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return;
  _lastNotificationAt = now;
  try {
    const { sendEmail } = require('./email');
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:24px auto;">
      <h2 style="color:#dc2626;">YouTube cookie set expired</h2>
      <p>The cookie set <strong>${(label || '').replace(/[<>&"]/g, '')}</strong> failed 3+ times in 24h and was auto-disabled.</p>
      <p>To restore it: open Multilogin → log into that profile's YouTube → re-export <code>cookies.txt</code> → paste it into <a href="https://splicora.ai/admin/cookies" style="color:#7c3aed;">/admin/cookies</a> (Refresh button on that row).</p>
      <p style="color:#6b7280;font-size:13px;">This is one of multiple cookie sets — the pool continues working on the remaining active sets. Refresh at your convenience.</p>
    </body></html>`;
    await sendEmail({ to: 'brownene3@gmail.com', subject: `[Splicora] Cookie set expired: ${label}`, html });
    await sendEmail({ to: 'hello@splicora.ai', subject: `[Splicora] Cookie set expired: ${label}`, html });
  } catch (e) {
    console.error('[CookiePool] notification email failed:', e.message);
  }
}

// Return a handle the caller uses + must release. Returns null if no
// active cookie set is available (caller should fall back to other layers).
async function pickCookieHandle() {
  try {
    const { youtubeCookieOps } = require('../db/database');
    const picked = await youtubeCookieOps.pickForRequest();
    if (!picked) return null;
    // Write the cookies text to a unique temp file (yt-dlp wants a file path).
    const tmpName = 'yt-pool-' + picked.id + '-' + crypto.randomBytes(4).toString('hex') + '.txt';
    const tmpPath = path.join(TMP_DIR, tmpName);
    try {
      fs.writeFileSync(tmpPath, picked.cookies_text, { mode: 0o600 });
    } catch (e) {
      console.error('[CookiePool] failed to write temp cookies file:', e.message);
      return null;
    }
    const handle = {
      id: picked.id,
      label: picked.label,
      region: picked.region || null,
      args: ['--cookies', tmpPath],
      proxyArgs: resolveProxyForRegion(picked.region),
      _path: tmpPath,
      _settled: false,
      async markSuccess() {
        if (this._settled) return; this._settled = true;
        try { await youtubeCookieOps.markSuccess(this.id); } catch (e) { console.error('[CookiePool] markSuccess failed:', e.message); }
      },
      async markFailure(reason) {
        if (this._settled) return; this._settled = true;
        try {
          const updated = await youtubeCookieOps.markFailure(this.id, reason);
          if (updated && updated.justExpired) {
            sendExpiryNotification(updated.label || this.label).catch(() => {});
          }
        } catch (e) { console.error('[CookiePool] markFailure failed:', e.message); }
      },
      cleanup() {
        try { fs.unlinkSync(this._path); } catch (e) {}
      }
    };
    console.log(`[CookiePool] picked '${picked.label}' region=${picked.region || 'none'} (id=${picked.id.slice(0, 8)})`);
    return handle;
  } catch (e) {
    console.error('[CookiePool] pickCookieHandle error:', e.message);
    return null;
  }
}

// Convenience wrapper for the common case: try a function with cookie args,
// auto-mark success if no error thrown, auto-mark failure + propagate if it throws.
// If no cookie set is available, calls fn with empty args ([]) so the caller
// still runs (without cookies) and we don't mask the absence.
async function withCookiePool(fn) {
  const handle = await pickCookieHandle();
  if (!handle) {
    return fn([]);
  }
  try {
    const out = await fn(handle.args);
    await handle.markSuccess();
    return out;
  } catch (err) {
    await handle.markFailure(err && err.message ? err.message : String(err));
    throw err;
  } finally {
    handle.cleanup();
  }
}

// Static cookies fallback (the existing YT_COOKIES_PATH env var pattern).
// Returns ['--cookies', path] or [].
function staticCookiesArgs() {
  const p = process.env.YT_COOKIES_PATH;
  if (p && fs.existsSync(p)) return ['--cookies', p];
  return [];
}

module.exports = { pickCookieHandle, withCookiePool, staticCookiesArgs, resolveProxyForRegion };
