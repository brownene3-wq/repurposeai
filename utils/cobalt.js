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
}

module.exports = { downloadWithCobalt };
