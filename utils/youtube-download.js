// Centralized YouTube video download utility
// Provides a single downloadYouTubeVideo() function used by ALL routes.
//
// Download strategy (in order):
//   1. yt-dlp with residential proxy (if YT_PROXY_URL is set)
//   2. yt-dlp with cookies (if YT_COOKIES_PATH is set)
//   3. yt-dlp bare (may work for some regions/videos)
//   4. Cobalt API tunnel (self-hosted instance)
//
// Environment variables:
//   YT_PROXY_URL         — HTTP/SOCKS5 proxy URL for yt-dlp (e.g. socks5://user:pass@host:port)
//                           This is the RECOMMENDED production setup. Use a residential proxy
//                           service like Bright Data, Oxylabs, or SmartProxy (~$5-15/mo).
//   YT_COOKIES_PATH      — Path to Netscape cookies.txt from a logged-in YouTube session
//   YT_COOKIES_BASE64    — Base64-encoded cookies.txt (auto-decoded by server.js on startup)
//   COBALT_API_URL       — URL of self-hosted Cobalt instance (default: Hetzner VPS)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { downloadWithCobalt } = require('./cobalt');

// yt-dlp base args shared across all strategies
const YTDLP_BASE_ARGS = [
  '--no-warnings',
  '--no-check-certificates',
  '--geo-bypass',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  '--retries', '3',
  '--extractor-retries', '3',
];

function getProxyArgs() {
  const p = process.env.YT_PROXY_URL;
  if (p) return ['--proxy', p];
  return [];
}

function getCookiesArgs() {
  const p = process.env.YT_COOKIES_PATH;
  if (p && fs.existsSync(p)) return ['--cookies', p];
  return [];
}

// Run yt-dlp with given args, return promise that resolves on success
function runYtdlp(args, label, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`[${label}] yt-dlp timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        console.log(`  [${label}] yt-dlp succeeded`);
        resolve();
      } else {
        reject(new Error(`[${label}] yt-dlp exited ${code}: ${stderr.substring(0, 300)}`));
      }
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`[${label}] yt-dlp spawn error: ${e.message}`));
    });
  });
}

/**
 * Download a YouTube video to destPath.
 * Tries multiple strategies in order until one succeeds.
 *
 * @param {string} videoUrl - YouTube URL
 * @param {string} destPath - Output file path
 * @param {object} [opts] - Options
 * @param {string} [opts.format] - yt-dlp format string (default: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best')
 * @param {boolean} [opts.audioOnly] - If true, extract audio only
 * @param {string} [opts.audioFormat] - Audio format when audioOnly (default: 'mp3')
 * @param {number} [opts.timeoutMs] - Timeout per attempt in ms (default: 120000)
 * @param {string[]} [opts.extraArgs] - Additional yt-dlp args
 * @returns {Promise<void>}
 */
async function downloadYouTubeVideo(videoUrl, destPath, opts = {}) {
  const format = opts.format || 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
  const timeoutMs = opts.timeoutMs || 120000;
  const extraArgs = opts.extraArgs || [];

  const baseArgs = [
    ...YTDLP_BASE_ARGS,
    ...(opts.audioOnly ? ['-x', '--audio-format', opts.audioFormat || 'mp3'] : ['-f', format]),
    ...extraArgs,
    '-o', destPath,
    videoUrl,
  ];

  const proxyArgs = getProxyArgs();
  const cookiesArgs = getCookiesArgs();
  const errors = [];

  // Strategy 1: yt-dlp with proxy (most reliable for production)
  if (proxyArgs.length) {
    try {
      console.log(`  [YouTube DL] Strategy 1: yt-dlp + proxy`);
      await runYtdlp([...baseArgs.slice(0, -2), ...proxyArgs, ...baseArgs.slice(-2)], 'proxy', timeoutMs);
      return;
    } catch (e) {
      console.log(`  [YouTube DL] Proxy failed: ${e.message}`);
      errors.push(e.message);
      try { fs.unlinkSync(destPath); } catch (_) {}
    }
  }

  // Strategy 2: yt-dlp with cookies
  if (cookiesArgs.length) {
    try {
      console.log(`  [YouTube DL] Strategy 2: yt-dlp + cookies`);
      await runYtdlp([...baseArgs.slice(0, -2), ...cookiesArgs, ...baseArgs.slice(-2)], 'cookies', timeoutMs);
      return;
    } catch (e) {
      console.log(`  [YouTube DL] Cookies failed: ${e.message}`);
      errors.push(e.message);
      try { fs.unlinkSync(destPath); } catch (_) {}
    }
  }

  // Strategy 3: yt-dlp bare (works for some videos/regions)
  try {
    console.log(`  [YouTube DL] Strategy 3: yt-dlp bare`);
    await runYtdlp(baseArgs, 'bare', timeoutMs);
    return;
  } catch (e) {
    console.log(`  [YouTube DL] Bare failed: ${e.message}`);
    errors.push(e.message);
    try { fs.unlinkSync(destPath); } catch (_) {}
  }

  // Strategy 4: Cobalt API (only for video, not audio-only)
  if (!opts.audioOnly) {
    try {
      console.log(`  [YouTube DL] Strategy 4: Cobalt API`);
      await downloadWithCobalt(videoUrl, destPath);
      return;
    } catch (e) {
      console.log(`  [YouTube DL] Cobalt failed: ${e.message}`);
      errors.push(e.message);
    }
  }

  // All strategies failed
  const hasProxy = !!proxyArgs.length;
  const hasCookies = !!cookiesArgs.length;
  let advice = '';
  if (!hasProxy && !hasCookies) {
    advice = ' Set YT_PROXY_URL to a residential proxy (recommended) or YT_COOKIES_BASE64 to YouTube cookies.';
  } else if (!hasProxy) {
    advice = ' Cookies may have expired. Set YT_PROXY_URL to a residential proxy for reliable downloads.';
  }
  throw new Error(`YouTube download failed — all strategies exhausted.${advice} Errors: ${errors.join(' | ')}`);
}

module.exports = { downloadYouTubeVideo, getProxyArgs, getCookiesArgs, YTDLP_BASE_ARGS };
