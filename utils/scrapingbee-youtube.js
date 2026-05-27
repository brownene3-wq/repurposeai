// utils/scrapingbee-youtube.js
//
// Paid ScrapingBee YouTube fallback. Used as a LATE-stage step in the
// /shorts download chain after Cobalt + yt-dlp (5 IPRoyal ISP proxies in
// rotation) + ytdl-core have all failed. ScrapingBee runs a managed pool
// of residential and ISP IPs with cookie rotation on their side, so it
// usually succeeds when our self-hosted chain has been blocked.
//
// We use it in HTTP-proxy mode rather than the REST scraper mode so
// yt-dlp can handle the complex YouTube extraction (signature decoding,
// stream merging, throttling probe, etc.) without us reimplementing it.
//
// ScrapingBee proxy URL format:
//   http://<API_KEY>:premium_proxy=true&country_code=us@proxy.scrapingbee.com:8886
//
// Cost: ScrapingBee's "Premium Proxy" mode bills 25 credits per request.
// One yt-dlp video download involves multiple requests (page HTML, player
// JS, stream chunks), so a typical video uses 75-200 credits. Freelance
// plan ($49.99/mo) ships 250,000 credits = ~1,250-3,300 videos/month
// worth of fallback. At Splicora's scale we should rarely hit this layer.
//
// Activation: set SCRAPINGBEE_API_KEY env var. If unset, this module is
// a no-op (the chain just falls through to the error response).

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

function isScrapingBeeEnabled() {
  return !!process.env.SCRAPINGBEE_API_KEY;
}

// Build the proxy URL ScrapingBee accepts. The "username" half is the API
// key, the "password" half is a &-separated parameter string. The
// premium_proxy=true flag is what gives us the residential / cookie
// rotation on their side that bypasses YouTube's bot wall.
function buildProxyUrl(opts = {}) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) return null;
  const params = [
    'premium_proxy=true',
    'country_code=' + (opts.country || 'us'),
  ];
  // We DON'T want JS rendering on a yt-dlp proxy — the proxy serves
  // bytes through to yt-dlp directly. render_js=true would only matter
  // for the scraper API mode (not used here).
  return 'http://' + apiKey + ':' + params.join('&') + '@proxy.scrapingbee.com:8886';
}

// Wrap yt-dlp with the ScrapingBee proxy. Mirrors the yt-dlp invocation
// the main chain already uses, but with --proxy set to the ScrapingBee
// URL. Returns the path the file was written to on success.
async function downloadWithScrapingBee(videoUrl, destPath, ytdlpPath, ytdlpCommonArgs, writeProgress) {
  if (!isScrapingBeeEnabled()) throw new Error('SCRAPINGBEE_API_KEY not set');
  const proxyUrl = buildProxyUrl();
  if (!proxyUrl) throw new Error('Could not construct ScrapingBee proxy URL');

  writeProgress && writeProgress('Trying paid fallback (ScrapingBee)...');
  console.log('  ScrapingBee: starting yt-dlp download via premium proxy for ' + videoUrl);

  // Clean any stale partial file at the destination.
  try { fs.unlinkSync(destPath); } catch (_) {}

  const args = [
    '--no-playlist',
    '-f', 'bestvideo[height<=1920]+bestaudio/best[height<=1920]/best',
    '--merge-output-format', 'mkv',
    '-o', destPath,
    '--no-part',
    '--force-overwrites',
    '--proxy', proxyUrl,
    ...(Array.isArray(ytdlpCommonArgs) ? ytdlpCommonArgs : []),
    videoUrl,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath || 'yt-dlp', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
    proc.stdout.on('data', (d) => {
      const pct = d.toString().match(/(\d+\.?\d*)%/);
      if (pct && writeProgress) writeProgress('ScrapingBee: ' + Math.round(parseFloat(pct[1])) + '%');
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const pct = d.toString().match(/(\d+\.?\d*)%/);
      if (pct && writeProgress) writeProgress('ScrapingBee: ' + Math.round(parseFloat(pct[1])) + '%');
    });
    proc.on('error', (err) => settle(reject, err));
    proc.on('close', (code) => {
      if (code === 0) settle(resolve);
      else settle(reject, new Error('yt-dlp exit ' + code + ' via ScrapingBee: ' + stderr.slice(-300)));
    });
    // 6-min hard cap. ScrapingBee proxy adds latency (~3-5x normal) so
    // we give yt-dlp more time than usual before giving up.
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      settle(reject, new Error('ScrapingBee download timed out after 360s'));
    }, 360000);
  });

  if (!fs.existsSync(destPath)) throw new Error('ScrapingBee: yt-dlp produced no output file');
  const size = fs.statSync(destPath).size;
  if (size < 50000) {
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw new Error('ScrapingBee: output file too small (' + size + ' bytes)');
  }
  console.log('  ScrapingBee: downloaded ' + (size / 1024 / 1024).toFixed(1) + 'MB to ' + destPath);
}

module.exports = { downloadWithScrapingBee, isScrapingBeeEnabled };
