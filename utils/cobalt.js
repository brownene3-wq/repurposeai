// Cobalt API integration for video downloading
// Self-hosted Cobalt instance on Railway
const fs = require('fs');
const https = require('https');
const http = require('http');

const COBALT_API_URL = process.env.COBALT_API_URL || 'https://cobalt-production-0ab0.up.railway.app';

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
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Cobalt parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Cobalt API timeout')); });
    req.write(postData);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const get2 = res.headers.location.startsWith('https') ? https.get : http.get;
        get2(res.headers.location, (res2) => {
          const ws = fs.createWriteStream(destPath);
          res2.pipe(ws);
          ws.on('finish', () => { ws.close(); resolve(); });
          ws.on('error', reject);
        }).on('error', reject);
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        const ws = fs.createWriteStream(destPath);
        res.pipe(ws);
        ws.on('finish', () => { ws.close(); resolve(); });
        ws.on('error', reject);
      } else {
        reject(new Error('Download HTTP ' + res.statusCode));
      }
    }).on('error', reject);
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
  // The actual smoking-gun symptom we've seen with Cobalt is the
  // tunnel URL returning Content-Length: 0 for unsupported videos.
  // Anything under 10 KB cannot be a real video.
  if (stat.size < 10000) {
    throw new Error('Cobalt download too small (' + stat.size + ' bytes) — likely empty/error response');
  }

  // Scan the first 256 bytes for ANY known container marker. We used to
  // require 'ftyp' at exactly offset 4, which over-rejected legit MP4s
  // that begin with a 'wide', 'styp', 'free', 'moov', or 'pdin' box.
  // Over-rejection was masquerading as 'Video download failed' because
  // the yt-dlp fallback can't always fetch the same URL.
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
    'ftyp', 'moov', 'mdat', 'wide', 'styp', 'free', 'pdin', 'sidx', 'mfra', // MP4-family box types
    'WEBM', 'webm',                                                          // WebM signature
    'RIFF',                                                                  // AVI
    'FLV',                                                                   // FLV
  ];
  const ebmlHead = head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3; // Matroska/WebM EBML
  const looksLikeContainer = ebmlHead || knownMarkers.some(m => ascii.indexOf(m) >= 0);
  if (!looksLikeContainer) {
    // Looks like an HTML/JSON error body. Reject so the caller can
    // fall through to the next downloader.
    const preview = head.slice(0, 32).toString('hex');
    try { fs.unlinkSync(destPath); } catch (e) {}
    throw new Error('Cobalt download is not a video container (first 32 bytes: ' + preview + ')');
  }
}

async function downloadWithCobalt(videoUrl, destPath) {
  const data = await cobaltRequest(videoUrl);
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
    throw new Error('Cobalt error: ' + (data.error && data.error.code || data.status || 'unknown'));
  }
  validateDownloadedVideo(destPath);
}

module.exports = { downloadWithCobalt, validateDownloadedVideo };
