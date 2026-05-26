// utils/apify-youtube.js
//
// Paid Apify YouTube downloader fallback — used as the LAST resort in the
// /shorts getOrDownloadVideo chain after Cobalt, yt-dlp (with cookies and
// proxy), and ytdl-core have all failed. Apify runs its own pool of
// residential IPs + cookie sessions inside their cloud, so it usually
// succeeds when our self-hosted chain has been blocked.
//
// Activation:
//   - Only used when APIFY_API_TOKEN env var is set.
//   - APIFY_YOUTUBE_ACTOR env var overrides the default actor. Default is
//     'streamers~youtube-video-downloader' (usage-only, ~$0.0025/video).
//
// Trade-offs:
//   - Slow: a single download can take 2-4 minutes end to end because
//     Apify spins up a worker, runs yt-dlp inside it, and writes the
//     merged file to their key-value store. Acceptable for a last-resort
//     fallback — by the time we get here our other paths have failed and
//     the user is already waiting.
//   - Cost: ~$0.0025-0.005 per call at the default actor's pricing. The
//     $5/month Apify free credit covers ~2000 fallback downloads.
//
// Returns: on success, the merged video file is written to destPath. On
// failure, throws a verbose error so the caller can roll it up into the
// '[v3] Video download failed' message the user sees.

const https = require('https');
const fs = require('fs');
const path = require('path');

const APIFY_HOST = 'api.apify.com';
const DEFAULT_ACTOR = 'streamers~youtube-video-downloader';
// Hard cap for a single fallback attempt. Beyond this the user has been
// waiting too long; better to give up and surface a friendlier error.
const RUN_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

function isApifyEnabled() {
  return !!process.env.APIFY_API_TOKEN;
}

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (!data) return resolve({ statusCode: res.statusCode, body: null });
          const ct = String(res.headers['content-type'] || '');
          if (ct.indexOf('application/json') >= 0) {
            return resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          }
          resolve({ statusCode: res.statusCode, body: data });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Apify HTTP timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function downloadFileToPath(url, destPath) {
  return new Promise((resolve, reject) => {
    const handle = (currentUrl, redirects) => {
      const u = new URL(currentUrl);
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': 'Splicora/1.0' }
      };
      const req = https.request(opts, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects > 5) return reject(new Error('Too many redirects fetching Apify file'));
          res.resume();
          return handle(new URL(res.headers.location, currentUrl).toString(), redirects + 1);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error('Apify file fetch HTTP ' + res.statusCode));
        }
        const stream = fs.createWriteStream(destPath);
        res.pipe(stream);
        stream.on('finish', () => stream.close(() => resolve()));
        stream.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(new Error('Apify file fetch timeout')); });
      req.end();
    };
    handle(url, 0);
  });
}

async function downloadWithApify(videoUrl, destPath) {
  if (!isApifyEnabled()) throw new Error('Apify fallback not configured (APIFY_API_TOKEN missing)');
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_YOUTUBE_ACTOR || DEFAULT_ACTOR;

  console.log('  Apify: starting run for ' + videoUrl + ' via actor ' + actorId);

  // Kick off the run (async — we'll poll). Use a generous per-run charge
  // cap so a runaway never hits the $5 free monthly credit in one call.
  const input = {
    videos: [{
      url: videoUrl,
      fileName: 'splicora_' + Date.now(),
      format: 'mp4'
    }],
    proxy: { useApifyProxy: true }
  };
  const startResp = await httpsRequest({
    hostname: APIFY_HOST,
    path: '/v2/acts/' + actorId + '/runs?token=' + encodeURIComponent(token),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify(input));

  if (!startResp.body || !startResp.body.data || !startResp.body.data.id) {
    throw new Error('Apify run start failed: ' + JSON.stringify(startResp.body).slice(0, 300));
  }
  const runId = startResp.body.data.id;
  console.log('  Apify: run ' + runId + ' started');

  // Poll until SUCCEEDED / FAILED / timeout.
  const startedAt = Date.now();
  let finalStatus = null;
  while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const statusResp = await httpsRequest({
      hostname: APIFY_HOST,
      path: '/v2/actor-runs/' + runId + '?token=' + encodeURIComponent(token),
      method: 'GET'
    });
    const s = statusResp.body && statusResp.body.data && statusResp.body.data.status;
    if (s === 'SUCCEEDED') { finalStatus = 'SUCCEEDED'; break; }
    if (s === 'FAILED' || s === 'ABORTED' || s === 'TIMED-OUT') {
      finalStatus = s;
      break;
    }
  }
  if (finalStatus !== 'SUCCEEDED') {
    throw new Error('Apify run did not succeed: ' + (finalStatus || 'still running after ' + RUN_TIMEOUT_MS + 'ms'));
  }

  // Fetch dataset items — first item has the file URL we need.
  const itemsResp = await httpsRequest({
    hostname: APIFY_HOST,
    path: '/v2/actor-runs/' + runId + '/dataset/items?token=' + encodeURIComponent(token),
    method: 'GET'
  });
  if (!Array.isArray(itemsResp.body) || itemsResp.body.length === 0) {
    throw new Error('Apify run produced no dataset items');
  }
  const item = itemsResp.body[0];
  const fileUrl = item.downloadedFileUrl;
  if (!fileUrl) {
    throw new Error('Apify run completed but no downloadedFileUrl in dataset item');
  }
  console.log('  Apify: fetching merged file from ' + fileUrl.slice(0, 80) + '...');

  // Download the file to destPath. Apify stores .webm but ffmpeg in the
  // downstream pipeline reads any container the file extension claims —
  // we keep destPath as caller passed it (typically _cached_<id>.mkv).
  await downloadFileToPath(fileUrl + (fileUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token), destPath);

  // Validate the result is a real video file with non-trivial size.
  const stat = fs.statSync(destPath);
  if (stat.size < 50000) {
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw new Error('Apify-downloaded file too small (' + stat.size + ' bytes)');
  }
  console.log('  Apify: downloaded ' + (stat.size / 1024 / 1024).toFixed(1) + 'MB to ' + destPath);
}

module.exports = { downloadWithApify, isApifyEnabled };
