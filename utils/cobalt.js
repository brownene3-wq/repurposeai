// Cobalt API integration for video downloading
// Self-hosted Cobalt instance on Hetzner VPS (Railway IPs are blocked by YouTube)
const fs = require('fs');
const https = require('https');
const http = require('http');

const COBALT_API_URL = process.env.COBALT_API_URL || 'http://46.224.167.94:9000';

function cobaltRequest(videoUrl) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(COBALT_API_URL);
    const postData = JSON.stringify({ url: videoUrl, videoQuality: '720', youtubeVideoCodec: 'h264' });
    const transport = urlObj.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname || '/',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Cobalt parse error: ' + body.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Cobalt API timeout')); });
    req.write(postData);
    req.end();
  });
}

// Download file with proper timeout, redirect following, and stall detection
function downloadFile(url, destPath, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(overallTimer); fn(val); } };

    // Overall timeout for the entire download
    const overallTimer = setTimeout(() => {
      settle(reject, new Error('Cobalt download timed out after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);

    function doGet(targetUrl, redirectCount) {
      if (redirectCount > 5) {
        return settle(reject, new Error('Too many redirects'));
      }
      console.log(`  Cobalt download: GET ${targetUrl.substring(0, 120)}... (redirect #${redirectCount})`);
      const get = targetUrl.startsWith('https') ? https.get : http.get;
      const req = get(targetUrl, (res) => {
        console.log(`  Cobalt download: status=${res.statusCode} ct=${res.headers['content-type'] || 'none'} cl=${res.headers['content-length'] || 'none'}`);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // Drain the response
          doGet(res.headers.location, redirectCount + 1);
        } else if (res.statusCode >= 200 && res.statusCode < 300) {
          const ws = fs.createWriteStream(destPath);
          let bytesWritten = 0;
          let lastProgress = Date.now();

          res.on('data', (chunk) => {
            bytesWritten += chunk.length;
            lastProgress = Date.now();
          });

          // Detect stalled downloads (no data for 30s)
          const stallCheck = setInterval(() => {
            if (Date.now() - lastProgress > 30000 && bytesWritten > 0) {
              clearInterval(stallCheck);
              res.destroy();
              ws.destroy();
              settle(reject, new Error('Cobalt download stalled after ' + (bytesWritten / 1024).toFixed(0) + 'KB'));
            }
          }, 5000);

          res.pipe(ws);
          ws.on('finish', () => {
            clearInterval(stallCheck);
            ws.close();
            console.log(`  Cobalt download: completed ${(bytesWritten / 1024 / 1024).toFixed(1)}MB`);
            settle(resolve, undefined);
          });
          ws.on('error', (e) => { clearInterval(stallCheck); settle(reject, e); });
          res.on('error', (e) => { clearInterval(stallCheck); ws.destroy(); settle(reject, e); });
        } else {
          res.resume();
          settle(reject, new Error('Cobalt download HTTP ' + res.statusCode));
        }
      });
      req.on('error', (e) => settle(reject, e));
      req.setTimeout(60000, () => { req.destroy(); settle(reject, new Error('Cobalt connection timeout')); });
    }

    doGet(url, 0);
  });
}

// Verify the file we just wrote is actually a video container, not empty
// or HTML/JSON garbage. Cobalt's tunnel URL has been observed returning
// 0 bytes (or stale redirect bodies) for some YouTube videos, which
// would otherwise propagate downstream and confuse ffmpeg.
function validateDownloadedVideo(destPath) {
  let stat;
  try { stat = fs.statSync(destPath); } catch (e) {
    throw new Error('Cobalt download produced no file');
  }
  if (stat.size < 10000) {
    throw new Error('Cobalt download too small (' + stat.size + ' bytes) — likely empty/error response');
  }

  let head;
  try {
    const fd = fs.openSync(destPath, 'r');
    head = Buffer.alloc(256);
    fs.readSync(fd, head, 0, 256, 0);
    fs.closeSync(fd);
  } catch (e) {
    throw new Error('Cobalt download unreadable: ' + e.message);
  }
  const ascii = head.toString('latin1');
  const knownMarkers = [
    'ftyp', 'moov', 'mdat', 'wide', 'styp', 'free', 'pdin', 'sidx', 'mfra',
    'WEBM', 'webm',
    'RIFF',
    'FLV',
  ];
  const ebmlHead = head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3;
  const looksLikeContainer = ebmlHead || knownMarkers.some(m => ascii.indexOf(m) >= 0);
  if (!looksLikeContainer) {
    const preview = head.slice(0, 32).toString('hex');
    try { fs.unlinkSync(destPath); } catch (e) {}
    throw new Error('Cobalt download is not a video container (first 32 bytes: ' + preview + ')');
  }
}

async function downloadWithCobalt(videoUrl, destPath) {
  console.log(`  Cobalt: requesting download for ${videoUrl}`);
  const data = await cobaltRequest(videoUrl);
  console.log(`  Cobalt: API response status=${data.status} hasUrl=${!!data.url} hasPicker=${!!(data.picker && data.picker.length)}`);

  if (data.status === 'tunnel' || data.status === 'redirect') {
    await downloadFile(data.url, destPath);
  } else if (data.status === 'picker' && data.picker && data.picker.length) {
    const pick = data.picker.find(p => p.type === 'video') || data.picker[0];
    if (pick && pick.url) {
      await downloadFile(pick.url, destPath);
    } else {
      throw new Error('Cobalt picker returned no video URL');
    }
  } else {
    throw new Error('Cobalt error: ' + (data.error && data.error.code || JSON.stringify(data.error) || data.status || 'unknown'));
  }
  validateDownloadedVideo(destPath);
}

module.exports = { downloadWithCobalt, validateDownloadedVideo };
