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
  if (stat.size < 10000) {
    throw new Error('Cobalt download too small (' + stat.size + ' bytes) — likely empty/error response');
  }
  // Read first 16 bytes and check for a known video container magic
  let head;
  try {
    const fd = fs.openSync(destPath, 'r');
    head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
  } catch (e) {
    throw new Error('Cobalt download unreadable: ' + e.message);
  }
  // MP4: bytes 4-7 == "ftyp"
  const isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
  // Matroska/WebM: starts with 1A 45 DF A3 (EBML)
  const isMkv = head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3;
  // RIFF/AVI
  const isRiff = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  // FLV
  const isFlv = head[0] === 0x46 && head[1] === 0x4C && head[2] === 0x56;
  if (!isMp4 && !isMkv && !isRiff && !isFlv) {
    const preview = head.toString('hex');
    try { fs.unlinkSync(destPath); } catch (e) {}
    throw new Error('Cobalt download is not a video container (magic=' + preview + ')');
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

module.exports = { downloadWithCobalt };
