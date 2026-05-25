const express = require('express'); 
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const OpenAI = require('openai');
const archiver = require('archiver');
const { downloadWithCobalt, validateDownloadedVideo } = require('../utils/cobalt');
// brand-templates exports fetchLogo() — used by /shorts/clip to bake
// the selected Brand Template's logo onto the rendered viral clip.
let brandTemplatesMod = null;
try { brandTemplatesMod = require('./brand-templates'); } catch (_e) { brandTemplatesMod = null; }
// Lazy-load ytdl-core to avoid crashing if it has issues
let ytdl, ytdlError;
try { ytdl = require('@distube/ytdl-core'); } catch (e) { ytdlError = e.message; console.error('ytdl-core not available:', e.message); }

// Find ffmpeg binary: check local bin/, then ffmpeg-static, then system
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) { ffmpegPath = localFfmpeg; }
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (e) {} }
if (!ffmpegPath) { try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {} }
const ffmpegAvailable = !!ffmpegPath;
console.log(ffmpegAvailable ? `ffmpeg available at: ${ffmpegPath}` : 'ffmpeg not found - clip download disabled');
const { requireAuth, checkPlanLimit, checkUsageLimit, requireFeature } = require('../middleware/auth');
const { requireCredits } = require('../middleware/credits');
const { requireStorageHeadroom, trackUploadBytes } = require('../middleware/storage');
const { shortsOps, brandKitOps, calendarOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript, getBrandKitModal } = require('../utils/theme');

// Guard boot — OpenAI SDK throws at construction if apiKey is empty,
// which would crash the entire server at startup. Use a placeholder so
// the module loads; a real check happens at request time when the API
// call returns 401 from the bogus key.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key' });

// Common yt-dlp args to handle YouTube's anti-bot measures
// PO token provider runs on port 4416 (started in Dockerfile CMD)
const YTDLP_COMMON_ARGS = [
  '--no-warnings',
  '--no-check-certificates',
  '--geo-bypass',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
  '--js-runtimes', 'node',
  '--remote-components', 'ejs:github',
  '--retries', '3',
  '--extractor-retries', '3',
];

// Pass --cookies <path> to yt-dlp when YT_COOKIES_PATH is configured and
// the file exists. This lets yt-dlp authenticate as a real YouTube user
// and bypass the "Sign in to confirm you're not a bot" wall that hits
// every Railway datacenter IP. Same pattern used by /ai-thumbnail,
// /ai-broll, and /video-editor.
function getYoutubeCookiesArgs() {
  const p = process.env.YT_COOKIES_PATH;
  if (p && fs.existsSync(p)) return ['--cookies', p];
  return [];
}

function getYoutubeProxyArgs() {
  const p = process.env.YT_PROXY_URL;
  if (p) return ['--proxy', p];
  return [];
}

// Clips directory
const CLIPS_DIR = path.join('/tmp', 'repurpose-clips');
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Shared video download cache — download each YouTube video once and reuse for all clips
const videoDownloadCache = new Map(); // videoId -> { path, refCount, timer }

async function getOrDownloadVideo(videoId, videoUrl, ytdlpPath, writeProgress) {
  const cacheKey = videoId;
  const cachedVideoPath = path.join(CLIPS_DIR, `_cached_${videoId}.mkv`);
  const lockPath = cachedVideoPath + '.downloading';

  // If already cached on disk with valid size, reuse it
  if (fs.existsSync(cachedVideoPath) && !fs.existsSync(lockPath)) {
    try {
      const stat = fs.statSync(cachedVideoPath);
      if (stat.size > 10000) {
        // Bump ref count
        const entry = videoDownloadCache.get(cacheKey) || { path: cachedVideoPath, refCount: 0 };
        entry.refCount++;
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
        videoDownloadCache.set(cacheKey, entry);
        console.log(`  Using cached video for ${videoId} (refs: ${entry.refCount})`);
        return cachedVideoPath;
      }
    } catch (e) {}
  }

  // If another clip is currently downloading this video, wait for it
  if (fs.existsSync(lockPath)) {
    writeProgress('Waiting for video download...');
    for (let i = 0; i < 120; i++) { // Wait up to 4 min
      await new Promise(r => setTimeout(r, 2000));
      if (!fs.existsSync(lockPath) && fs.existsSync(cachedVideoPath)) {
        try {
          const stat = fs.statSync(cachedVideoPath);
          if (stat.size > 10000) {
            const entry = videoDownloadCache.get(cacheKey) || { path: cachedVideoPath, refCount: 0 };
            entry.refCount++;
            if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
            videoDownloadCache.set(cacheKey, entry);
            console.log(`  Video ready after wait for ${videoId} (refs: ${entry.refCount})`);
            return cachedVideoPath;
          }
        } catch (e) {}
      }
    }
    // If still not ready, fall through and try downloading ourselves
  }

  // Download the video with a lock file
  try { fs.writeFileSync(lockPath, String(Date.now())); } catch (e) {}
  try { fs.unlinkSync(cachedVideoPath); } catch (e) {}

  const { spawn: spawnProc } = require('child_process');
  const runDl = (cmd, args, options = {}) => {
    return new Promise((resolve, reject) => {
      const proc = spawnProc(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      let settled = false;
      const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
      proc.stdout.on('data', (d) => {
        stdout += d.toString();
        const pct = d.toString().match(/(\\d+\\.?\\d*)%/);
        if (pct) writeProgress('Downloading: ' + Math.round(parseFloat(pct[1])) + '%');
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        const pct = d.toString().match(/(\\d+\\.?\\d*)%/);
        if (pct) writeProgress('Downloading: ' + Math.round(parseFloat(pct[1])) + '%');
      });
      proc.on('error', (err) => settle(reject, err));
      proc.on('close', (code) => {
        if (code === 0) settle(resolve, { stdout, stderr });
        else settle(reject, new Error('yt-dlp exit ' + code + ': ' + stderr.slice(-300)));
      });
      const timer = options.timeout ? setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch(e) {}
        settle(reject, new Error('Download timed out'));
      }, options.timeout) : null;
    });
  };

  // Track each downloader's failure reason so we can surface them in
  // the final user-facing error message when all three fall over. Albert
  // was seeing a generic 'Video download failed' with no actionable info.
  const failureLog = { cobalt: null, ytdlp: null, ytdlcore: null };

  try {
    writeProgress('Downloading video...');

    // Try Cobalt API first — most reliable on Railway (yt-dlp + ytdl-core
    // routinely get bot-blocked from datacenter IPs). Mirrors the Quick
    // Narrate flow (commits 820c8ce / 5f05882 / 48756f7).
    try {
      await downloadWithCobalt(videoUrl, cachedVideoPath);
      if (fs.existsSync(cachedVideoPath) && fs.statSync(cachedVideoPath).size > 10000) {
        try { fs.unlinkSync(lockPath); } catch (e) {}
        const entry = { path: cachedVideoPath, refCount: 1, timer: null };
        videoDownloadCache.set(cacheKey, entry);
        console.log(`  Cobalt download succeeded for ${videoId} (${(fs.statSync(cachedVideoPath).size / 1024 / 1024).toFixed(1)}MB)`);
        return cachedVideoPath;
      }
      // File missing or too small — fall through to yt-dlp
      failureLog.cobalt = 'returned empty/too-small file';
      try { fs.unlinkSync(cachedVideoPath); } catch (e) {}
    } catch (cobaltErr) {
      failureLog.cobalt = String(cobaltErr.message || cobaltErr).slice(0, 200);
      console.log(`  Cobalt failed for ${videoId}: ${failureLog.cobalt}`);
      try { fs.unlinkSync(cachedVideoPath); } catch (e) {}
    }

    await runDl(ytdlpPath, [
      '--no-playlist',
      '-f', 'bestvideo[height<=1920]+bestaudio/best[height<=1920]/best',
      '--merge-output-format', 'mkv',
      '-o', cachedVideoPath,
      '--no-part',
      '--force-overwrites',
      ...getYoutubeCookiesArgs(),
      ...getYoutubeProxyArgs(),
      ...YTDLP_COMMON_ARGS,
      videoUrl
    ], { timeout: 240000 });

    // yt-dlp may change extension — find the actual file
    if (!fs.existsSync(cachedVideoPath)) {
      const base = path.join(CLIPS_DIR, `_cached_${videoId}`);
      for (const ext of ['.mkv', '.mp4', '.webm']) {
        if (fs.existsSync(base + ext)) {
          fs.renameSync(base + ext, cachedVideoPath);
          break;
        }
      }
    }

    try { fs.unlinkSync(lockPath); } catch (e) {}

    if (!fs.existsSync(cachedVideoPath) || fs.statSync(cachedVideoPath).size < 10000) {
      throw new Error('Downloaded file is missing or too small');
    }

    const entry = { path: cachedVideoPath, refCount: 1, timer: null };
    videoDownloadCache.set(cacheKey, entry);
    console.log(`  Video cached for ${videoId} (${(fs.statSync(cachedVideoPath).size / 1024 / 1024).toFixed(1)}MB)`);
    return cachedVideoPath;

  } catch (err) {
    failureLog.ytdlp = String(err.message || err).slice(0, 200);
    console.log(`  yt-dlp failed for ${videoId}: ${failureLog.ytdlp}`);

    // Fallback: try @distube/ytdl-core if yt-dlp fails (e.g. datacenter IP blocked)
    if (ytdl) {
      try {
        writeProgress('Trying alternative download method...');
        console.log(`  Attempting ytdl-core fallback for ${videoId}`);

        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(cachedVideoPath);
          const stream = ytdl(videoUrl, {
            quality: 'highest',
            filter: 'audioandvideo',
          });

          let downloadedBytes = 0;
          stream.on('progress', (chunkLength, downloaded, total) => {
            downloadedBytes = downloaded;
            if (total) {
              writeProgress('Downloading: ' + Math.round((downloaded / total) * 100) + '%');
            }
          });

          stream.on('error', (e) => {
            writeStream.destroy();
            reject(e);
          });

          writeStream.on('finish', () => resolve());
          writeStream.on('error', (e) => reject(e));

          stream.pipe(writeStream);

          // Timeout after 4 minutes
          setTimeout(() => {
            stream.destroy();
            writeStream.destroy();
            reject(new Error('ytdl-core download timed out'));
          }, 240000);
        });

        if (fs.existsSync(cachedVideoPath) && fs.statSync(cachedVideoPath).size > 10000) {
          try { fs.unlinkSync(lockPath); } catch (e) {}
          const entry = { path: cachedVideoPath, refCount: 1, timer: null };
          videoDownloadCache.set(cacheKey, entry);
          console.log(`  ytdl-core fallback succeeded for ${videoId} (${(fs.statSync(cachedVideoPath).size / 1024 / 1024).toFixed(1)}MB)`);
          return cachedVideoPath;
        }
        throw new Error('ytdl-core downloaded file is missing or too small');
      } catch (ytdlErr) {
        failureLog.ytdlcore = String(ytdlErr.message || ytdlErr).slice(0, 200);
        console.log(`  ytdl-core fallback also failed for ${videoId}: ${failureLog.ytdlcore}`);
      }
    } else {
      failureLog.ytdlcore = 'ytdl-core module not loaded';
    }

    try { fs.unlinkSync(lockPath); } catch (e) {}
    try { fs.unlinkSync(cachedVideoPath); } catch (e) {}
    const haveCookies = !!getYoutubeCookiesArgs().length;
    // Surface the per-downloader failure reasons so the user (and the
    // operator reading Railway logs) sees which specific path broke.
    const reasonLines = [];
    if (failureLog.cobalt)   reasonLines.push('Cobalt: '   + failureLog.cobalt);
    if (failureLog.ytdlp)    reasonLines.push('yt-dlp: '   + failureLog.ytdlp);
    if (failureLog.ytdlcore) reasonLines.push('ytdl-core: ' + failureLog.ytdlcore);
    const reasonBlock = reasonLines.length ? ' Causes — ' + reasonLines.join(' | ') : '';
    const cookiesHint = haveCookies
      ? ' (YouTube cookies appear configured; they may have expired — re-export cookies.txt from a freshly-logged-in browser.)'
      : ' Set the YT_COOKIES_PATH env var to a Netscape-format cookies.txt exported from a logged-in YouTube account, then redeploy.';
    throw new Error('Video download failed for ' + videoId + '.' + reasonBlock + cookiesHint);
  }
}

function releaseVideoCache(videoId) {
  const entry = videoDownloadCache.get(videoId);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0) {
    // Clean up cached video after 2 minutes of no references
    entry.timer = setTimeout(() => {
      try { fs.unlinkSync(entry.path); } catch (e) {}
      videoDownloadCache.delete(videoId);
      console.log(`  Cleaned up cached video for ${videoId}`);
    }, 120000);
  }
}

// Helper: Extract video ID from YouTube URL
function extractVideoId(url) {
  const regexPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of regexPatterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Validate URLs from all supported platforms (YouTube, Instagram, TikTok, Facebook, Twitter/X, LinkedIn, Snapchat)
function isValidVideoUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    const validHosts = [
      'youtube.com', 'youtu.be',
      'instagram.com',
      'tiktok.com', 'vm.tiktok.com',
      'facebook.com', 'fb.watch',
      'twitter.com', 'x.com',
      'linkedin.com',
      'snapchat.com'
    ];
    return validHosts.some(h => host === h || host.endsWith('.' + h));
  } catch(e) {
    return false;
  }
}

// Helper: Format timestamp in seconds to HH:MM:SS.mmm (with millisecond precision)
function formatTimestamp(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return [hrs, mins, secs].map(x => String(x).padStart(2, '0')).join(':') + '.' + String(ms).padStart(3, '0');
}

// Helper: Combine transcript segments into text with timestamps
function buildTranscriptText(segments) {
  return segments.map(seg => {
    const timestamp = formatTimestamp(seg.offset / 1000);
    return `[${timestamp}] ${seg.text}`;
  }).join(' ');
}

// Helper: Parse stored transcript text back into timed segments
// Transcript format: "[HH:MM:SS.mmm] text" or legacy "[HH:MM:SS] text"
function parseTranscriptToSegments(transcriptText) {
  const segments = [];
  const regex = /\[(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]\s*(.*?)(?=\s*\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]|$)/g;
  let match;
  while ((match = regex.exec(transcriptText)) !== null) {
    const [, timestamp, text] = match;
    // Split "HH:MM:SS" or "HH:MM:SS.mmm"
    const [timePart, msPart] = timestamp.split('.');
    const parts = timePart.split(':').map(Number);
    const ms = msPart ? parseInt(msPart.padEnd(3, '0')) / 1000 : 0;
    const offsetSec = parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
    if (text.trim()) {
      segments.push({ offsetSec, text: text.trim() });
    }
  }
  return segments;
}

// Supported languages for caption translation
const SUPPORTED_LANGUAGES = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  hi: 'Hindi',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  tr: 'Turkish',
  nl: 'Dutch',
  pl: 'Polish',
  id: 'Indonesian',
  th: 'Thai',
  vi: 'Vietnamese',
  fil: 'Filipino',
  sv: 'Swedish'
};

// Helper: Translate caption segments using GPT-4o-mini
async function translateSegments(segments, targetLang) {
  if (!targetLang || targetLang === 'en') return segments;

  const langName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

  // Batch segments into chunks to avoid token limits
  const chunkSize = 30;
  const translatedSegments = [];

  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunk = segments.slice(i, i + chunkSize);
    const textsToTranslate = chunk.map((s, idx) => `[${idx}] ${s.text}`).join('\n');

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: `You are a professional subtitle translator. Translate the following subtitle lines to ${langName}. Keep each line short (suitable for on-screen captions). Preserve the [index] prefix exactly. Return ONLY the translated lines, one per line, with their [index] prefix. Do not add explanations.` },
          { role: 'user', content: textsToTranslate }
        ]
      });

      const translatedText = (response.choices[0]?.message?.content || '').trim();
      const translatedLines = translatedText.split('\n').filter(l => l.trim());

      // Parse translated lines back to segments
      for (const line of translatedLines) {
        const match = line.match(/^\[(\d+)\]\s*(.+)$/);
        if (match) {
          const idx = parseInt(match[1]);
          if (idx < chunk.length) {
            translatedSegments.push({
              ...chunk[idx],
              text: match[2].trim()
            });
          }
        }
      }

      // If parsing failed for some segments, keep originals
      if (translatedSegments.length < i + chunk.length) {
        for (let j = translatedSegments.length - i; j < chunk.length; j++) {
          translatedSegments.push(chunk[j]);
        }
      }
    } catch (err) {
      console.error(`  Translation chunk failed:`, err.message);
      // Keep original segments on failure
      translatedSegments.push(...chunk);
    }
  }

  return translatedSegments;
}

// Helper: Generate ASS subtitle file for burned-in captions
// Style: TikTok/Reels style - bold white text, black outline, centered in lower third
function generateASSSubtitles(segments, clipStartSec, clipDuration, captionStyle) {
  captionStyle = captionStyle || 'classic';
  const clipEndSec = clipStartSec + clipDuration;
  const clipSegments = segments.filter(seg => seg.offsetSec >= clipStartSec && seg.offsetSec < clipEndSec);
  if (clipSegments.length === 0) return null;

  const styleConfigs = {
    classic: { fontName:'Liberation Sans', fontSize:72, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&H80000000', bold:-1, outline:4, shadow:0, alignment:2, marginV:180, wordsPerLine:6, uppercase:true },
    trending: { fontName:'Liberation Sans', fontSize:85, primaryColor:'&H0000FFFF', outlineColor:'&H00000000', backColor:'&H80000000', bold:-1, outline:5, shadow:2, alignment:2, marginV:200, wordsPerLine:3, uppercase:true },
    karaoke: { fontName:'Liberation Sans', fontSize:78, primaryColor:'&H00FFFFFF', outlineColor:'&H000050FF', backColor:'&H80000000', bold:-1, outline:4, shadow:0, alignment:2, marginV:180, wordsPerLine:1, uppercase:true },
    minimal: { fontName:'Liberation Sans', fontSize:60, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&H00000000', bold:0, outline:2, shadow:0, alignment:2, marginV:160, wordsPerLine:8, uppercase:false },
    bold: { fontName:'Liberation Sans', fontSize:90, primaryColor:'&H0000FF00', outlineColor:'&H00000000', backColor:'&H80000000', bold:-1, outline:6, shadow:3, alignment:2, marginV:200, wordsPerLine:2, uppercase:true },
    neon: { fontName:'Liberation Sans', fontSize:80, primaryColor:'&H00FF50FF', outlineColor:'&H00FF0080', backColor:'&H00000000', bold:-1, outline:4, shadow:4, alignment:2, marginV:190, wordsPerLine:4, uppercase:true },
    'bold-pop': { fontName:'Liberation Sans', fontSize:95, primaryColor:'&H0000BFFF', outlineColor:'&H00000000', backColor:'&H80000000', bold:-1, outline:6, shadow:3, alignment:2, marginV:200, wordsPerLine:2, uppercase:true },
    'gradient-wave': { fontName:'Liberation Sans', fontSize:78, primaryColor:'&H00FF69B4', outlineColor:'&H009932CC', backColor:'&H00000000', bold:-1, outline:5, shadow:2, alignment:2, marginV:185, wordsPerLine:4, uppercase:true },
    typewriter: { fontName:'Liberation Mono', fontSize:65, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&H90000000', bold:0, outline:2, shadow:0, alignment:2, marginV:170, wordsPerLine:6, uppercase:false },
    cinematic: { fontName:'Liberation Sans', fontSize:70, primaryColor:'&H0074D4D4', outlineColor:'&H00000000', backColor:'&H00000000', bold:0, outline:3, shadow:2, alignment:2, marginV:180, wordsPerLine:6, uppercase:false },
    street: { fontName:'Liberation Sans', fontSize:88, primaryColor:'&H0000FFFF', outlineColor:'&H00000000', backColor:'&H80000000', bold:-1, outline:5, shadow:0, alignment:2, marginV:200, wordsPerLine:3, uppercase:true },
    hormozi: { fontName:'Liberation Sans', fontSize:85, primaryColor:'&H0000FFFF', outlineColor:'&H00000000', backColor:'&H00000000', bold:-1, outline:6, shadow:3, alignment:2, marginV:200, wordsPerLine:2, uppercase:true },
    mrbeast: { fontName:'Liberation Sans', fontSize:92, primaryColor:'&H00FFFFFF', outlineColor:'&H000000FF', backColor:'&H00000000', bold:-1, outline:7, shadow:0, alignment:2, marginV:200, wordsPerLine:2, uppercase:true },
    'classic-sub': { fontName:'Liberation Sans', fontSize:64, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&HA0000000', bold:0, outline:2, shadow:0, alignment:2, marginV:160, wordsPerLine:8, uppercase:false },
    'outline-style': { fontName:'Liberation Sans', fontSize:80, primaryColor:'&H00000000', outlineColor:'&H00FFFFFF', backColor:'&H00000000', bold:-1, outline:5, shadow:0, alignment:2, marginV:185, wordsPerLine:4, uppercase:true },
    'soft-glow': { fontName:'Liberation Sans', fontSize:72, primaryColor:'&H00FFFFFF', outlineColor:'&H00FFB0E0', backColor:'&H00000000', bold:0, outline:3, shadow:5, alignment:2, marginV:180, wordsPerLine:5, uppercase:false },
    'retro-vhs': { fontName:'Liberation Mono', fontSize:68, primaryColor:'&H0000FFFF', outlineColor:'&H000000FF', backColor:'&H80000000', bold:-1, outline:3, shadow:2, alignment:2, marginV:175, wordsPerLine:5, uppercase:true },
    comic: { fontName:'Liberation Sans', fontSize:82, primaryColor:'&H0000FFFF', outlineColor:'&H00000000', backColor:'&H00000000', bold:-1, outline:6, shadow:0, alignment:2, marginV:190, wordsPerLine:3, uppercase:true },
    fire: { fontName:'Liberation Sans', fontSize:85, primaryColor:'&H000055FF', outlineColor:'&H000000FF', backColor:'&H00000000', bold:-1, outline:5, shadow:4, alignment:2, marginV:195, wordsPerLine:3, uppercase:true },
    'clean-modern': { fontName:'Liberation Sans', fontSize:66, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&H00000000', bold:0, outline:2, shadow:1, alignment:2, marginV:165, wordsPerLine:7, uppercase:false },
    podcast: { fontName:'Liberation Sans', fontSize:70, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&HA0000000', bold:0, outline:3, shadow:0, alignment:2, marginV:175, wordsPerLine:6, uppercase:false },
    'tiktok-trend': { fontName:'Liberation Sans', fontSize:88, primaryColor:'&H0000FFFF', outlineColor:'&H00000000', backColor:'&H80000000', bold:-1, outline:5, shadow:2, alignment:2, marginV:200, wordsPerLine:3, uppercase:true },
    'shadow-drop': { fontName:'Liberation Sans', fontSize:76, primaryColor:'&H00FFFFFF', outlineColor:'&H00000000', backColor:'&H00000000', bold:-1, outline:3, shadow:6, alignment:2, marginV:185, wordsPerLine:4, uppercase:true }
  };
  const cfg = styleConfigs[captionStyle] || styleConfigs.classic;

  const assHeader = `[Script Info]
Title: Auto Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${cfg.fontName},${cfg.fontSize},${cfg.primaryColor},&H000000FF,${cfg.outlineColor},${cfg.backColor},${cfg.bold},0,0,0,100,100,0,0,1,${cfg.outline},${cfg.shadow},${cfg.alignment},40,40,${cfg.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines = [];
  for (let i = 0; i < clipSegments.length; i++) {
    const seg = clipSegments[i];
    const relStart = seg.offsetSec - clipStartSec;
    let relEnd;
    if (i + 1 < clipSegments.length) {
      relEnd = Math.min(clipSegments[i + 1].offsetSec - clipStartSec, relStart + 4);
    } else {
      relEnd = Math.min(relStart + 4, clipDuration);
    }
    if (relEnd > clipDuration) relEnd = clipDuration;
    if (relStart >= clipDuration) continue;
    const formatASSTime = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const cs = Math.round((sec % 1) * 100);
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };
    const words = seg.text.split(/\s+/);
    const wpl = cfg.wordsPerLine;
    const lineArr = [];
    for (let w = 0; w < words.length; w += wpl) { lineArr.push(words.slice(w, w + wpl).join(' ')); }
    const displayText = cfg.uppercase ? lineArr.join('\\N').toUpperCase() : lineArr.join('\\N');
    dialogueLines.push(`Dialogue: 0,${formatASSTime(relStart)},${formatASSTime(relEnd)},Default,,0,0,0,,${displayText}`);
  }
  if (dialogueLines.length === 0) return null;
  return assHeader + '\n' + dialogueLines.join('\n') + '\n';
}

// Helper: Fetch transcript using Supadata.ai API (most reliable - paid service, no YouTube blocking)
async function fetchTranscriptSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error('SUPADATA_API_KEY not configured');

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log('  Supadata: Fetching transcript for', videoId);

  const resp = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}&lang=en`, {
    headers: {
      'x-api-key': apiKey,
    }
  });

  // Handle async job (HTTP 202 for long videos)
  if (resp.status === 202) {
    const jobData = await resp.json();
    const jobId = jobData.jobId;
    if (!jobId) throw new Error('Supadata returned 202 but no jobId');

    console.log(`  Supadata: Long video, polling job ${jobId}...`);

    // Poll for up to 2 minutes
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000)); // Wait 5s between polls

      const jobResp = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
        headers: { 'x-api-key': apiKey }
      });

      if (jobResp.status === 200) {
        const result = await jobResp.json();
        if (result.content) {
          return parseSupadataResponse(result);
        }
      } else if (jobResp.status === 404) {
        throw new Error('Supadata job expired or not found');
      }
      // Otherwise keep polling (202 = still processing)
      console.log(`  Supadata: Job still processing (attempt ${i + 1}/24)...`);
    }
    throw new Error('Supadata job timed out after 2 minutes');
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supadata API returned ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  return parseSupadataResponse(data);
}

function parseSupadataResponse(data) {
  // If text mode was used, content is a string
  if (typeof data.content === 'string') {
    // Split into pseudo-segments
    const sentences = data.content.split(/[.!?]+\s+/).filter(s => s.trim());
    return sentences.map((text, i) => ({ offset: i * 5000, text: text.trim() }));
  }

  // Array mode: content is [{ text, offset, duration, lang }]
  if (!Array.isArray(data.content) || data.content.length === 0) {
    throw new Error('Supadata returned empty transcript');
  }

  const segments = data.content
    .filter(seg => seg.text && seg.text.trim())
    .map(seg => ({
      offset: seg.offset || 0,
      text: seg.text.trim()
    }));

  if (segments.length === 0) throw new Error('Supadata transcript had no text segments');
  console.log(`  Supadata: Got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Fetch transcript using YouTube's InnerTube API (free fallback)
async function fetchTranscriptInnerTube(videoId) {
  console.log('  InnerTube: Fetching transcript for', videoId);

  // Use InnerTube player API directly to get caption tracks - no HTML scraping needed
  // This bypasses YouTube's bot detection on the video page
  const apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  // Step 1: Get player data with caption tracks via InnerTube API
  console.log('  InnerTube: Calling player API');
  const playerResp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240101.00.00',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US',
        }
      },
      videoId: videoId
    })
  });

  if (!playerResp.ok) throw new Error(`InnerTube player API returned ${playerResp.status}`);
  const playerData = await playerResp.json();

  // Check for playability issues
  const playability = playerData?.playabilityStatus?.status;
  console.log('  InnerTube: Playability status:', playability);

  // Extract caption tracks from player response
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  console.log(`  InnerTube: Found ${captionTracks.length} caption tracks`);

  if (captionTracks.length > 0) {
    console.log('  Caption tracks:', captionTracks.map(t => `${t.languageCode}(${t.kind||'manual'})`).join(', '));

    // Prefer English auto-generated, then English manual, then any
    let track = captionTracks.find(t => (t.languageCode || '').startsWith('en') && t.kind === 'asr');
    if (!track) track = captionTracks.find(t => (t.languageCode || '').startsWith('en'));
    if (!track) track = captionTracks.find(t => t.kind === 'asr');
    if (!track) track = captionTracks[0];

    let subtitleUrl = track.baseUrl;
    if (!subtitleUrl) throw new Error('Caption track has no URL');

    console.log(`  Using track: ${track.languageCode} (${track.kind || 'manual'})`);

    // Try JSON3 format first (most structured)
    let segments = [];
    const json3Url = subtitleUrl + (subtitleUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    console.log('  Fetching JSON3 captions...');
    try {
      const subResp = await fetch(json3Url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (subResp.ok) {
        const subText = await subResp.text();
        try {
          const json = JSON.parse(subText);
          const events = json.events || [];
          for (const event of events) {
            if (event.segs && event.tStartMs !== undefined) {
              const text = event.segs.map(s => s.utf8 || '').join('').trim();
              if (text && text !== '\n') {
                segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
              }
            }
          }
        } catch(e) {
          console.log('  JSON3 parse failed, trying XML in same response...');
          // Response might be XML
          const textMatches = subText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
          for (const m of textMatches) {
            const startMs = Math.round(parseFloat(m[1]) * 1000);
            const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
            if (text) segments.push({ offset: startMs, text });
          }
        }
      }
    } catch(e) {
      console.log('  JSON3 fetch error:', e.message);
    }

    // Fall back to plain XML subtitle URL
    if (segments.length === 0) {
      console.log('  Trying XML captions...');
      try {
        const xmlResp = await fetch(subtitleUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (xmlResp.ok) {
          const xmlText = await xmlResp.text();
          const textMatches = xmlText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
          for (const m of textMatches) {
            const startMs = Math.round(parseFloat(m[1]) * 1000);
            const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
            if (text) segments.push({ offset: startMs, text });
          }
        }
      } catch(e) {
        console.log('  XML fetch error:', e.message);
      }
    }

    if (segments.length > 0) {
      console.log(`  InnerTube: Got ${segments.length} transcript segments from caption tracks`);
      return segments;
    }
  }

  // Step 2: Try the get_transcript endpoint (for engagement panel transcript)
  // First need to get the page to find the continuation token
  console.log('  InnerTube: Caption tracks empty, trying page scraping for transcript panel...');
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResp = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  });

  if (!pageResp.ok) throw new Error(`YouTube page returned ${pageResp.status}`);
  const pageHtml = await pageResp.text();
  console.log(`  InnerTube: Got page HTML (${pageHtml.length} bytes)`);

  // Also try to extract caption tracks from HTML as fallback
  let htmlCaptionTracks;
  const startIdx = pageHtml.indexOf('"captionTracks":');
  if (startIdx !== -1) {
    const arrStart = pageHtml.indexOf('[', startIdx);
    if (arrStart !== -1 && arrStart < startIdx + 30) {
      let depth = 0, arrEnd = arrStart;
      for (let i = arrStart; i < pageHtml.length && i < arrStart + 100000; i++) {
        if (pageHtml[i] === '[') depth++;
        if (pageHtml[i] === ']') depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
      try {
        htmlCaptionTracks = JSON.parse(pageHtml.substring(arrStart, arrEnd));
        console.log(`  Found ${htmlCaptionTracks.length} caption tracks in HTML`);
      } catch(e) {
        console.log('  captionTracks parse error:', e.message);
      }
    }
  }

  // Try fetching from HTML caption tracks
  if (htmlCaptionTracks && htmlCaptionTracks.length > 0) {
    let track = htmlCaptionTracks.find(t => (t.languageCode || '').startsWith('en'));
    if (!track) track = htmlCaptionTracks.find(t => t.kind === 'asr');
    if (!track) track = htmlCaptionTracks[0];

    let subtitleUrl = track.baseUrl;
    if (subtitleUrl) {
      let segments = [];
      const json3Url = subtitleUrl + (subtitleUrl.includes('?') ? '&' : '?') + 'fmt=json3';
      try {
        const subResp = await fetch(json3Url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (subResp.ok) {
          const subText = await subResp.text();
          try {
            const json = JSON.parse(subText);
            for (const event of (json.events || [])) {
              if (event.segs && event.tStartMs !== undefined) {
                const text = event.segs.map(s => s.utf8 || '').join('').trim();
                if (text && text !== '\n') {
                  segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
                }
              }
            }
          } catch(e) {
            const textMatches = subText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
            for (const m of textMatches) {
              const startMs = Math.round(parseFloat(m[1]) * 1000);
              const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
              if (text) segments.push({ offset: startMs, text });
            }
          }
        }
      } catch(e) {
        console.log('  HTML caption fetch error:', e.message);
      }

      if (segments.length > 0) {
        console.log(`  InnerTube/HTML captions: Got ${segments.length} transcript segments`);
        return segments;
      }
    }
  }

  // Try transcript panel continuation token
  let continuationToken = null;
  const engagementIdx = pageHtml.indexOf('"engagementPanels"');
  if (engagementIdx !== -1) {
    const searchArea = pageHtml.substring(engagementIdx, engagementIdx + 50000);
    const contMatch = searchArea.match(/"continuation"\s*:\s*"([^"]+)"[^}]*?"label"\s*:\s*"[^"]*[Tt]ranscript/);
    if (!contMatch) {
      const altMatch = searchArea.match(/Show transcript.*?"continuation"\s*:\s*"([^"]+)"/s);
      if (altMatch) continuationToken = altMatch[1];
    } else {
      continuationToken = contMatch[1];
    }
  }

  if (!continuationToken) {
    const allConts = pageHtml.matchAll(/"continuation"\s*:\s*"([^"]{50,})"/g);
    for (const m of allConts) {
      if (m[1].length > 100) {
        continuationToken = m[1];
        break;
      }
    }
  }

  if (continuationToken) {
    console.log('  InnerTube: Found continuation token, fetching transcript panel');
    const transcriptResp = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'en',
            gl: 'US',
          }
        },
        params: continuationToken
      })
    });

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      const segments = [];
      const body = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups ||
                   data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments ||
                   [];

      for (const group of body) {
        const cue = group?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
        if (cue) {
          const startMs = parseInt(cue.startOffsetMs || '0');
          const text = cue.cue?.simpleText || cue.cue?.runs?.map(r => r.text).join('') || '';
          if (text.trim()) {
            segments.push({ offset: startMs, text: text.trim() });
          }
        }
      }

      if (segments.length > 0) {
        console.log(`  InnerTube: Got ${segments.length} transcript segments from panel`);
        return segments;
      }
    }
  }

  throw new Error('InnerTube: No transcript available from any method');
}

// Helper: Fetch transcript directly from YouTube's timedtext API (legacy)
async function fetchTranscriptDirect(videoId) {
  console.log('  Fetching transcript directly from YouTube for:', videoId);

  // Step 1: Fetch the video page to get caption track URLs
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResp = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  if (!pageResp.ok) {
    throw new Error(`YouTube page returned ${pageResp.status}`);
  }

  const pageHtml = await pageResp.text();

  // Step 2: Extract caption tracks using bracket-counting (most reliable)
  let captionTracks;
  const startIdx = pageHtml.indexOf('"captionTracks":');
  if (startIdx !== -1) {
    const arrStart = pageHtml.indexOf('[', startIdx);
    if (arrStart !== -1 && arrStart < startIdx + 30) {
      let depth = 0, arrEnd = arrStart;
      for (let i = arrStart; i < pageHtml.length && i < arrStart + 100000; i++) {
        if (pageHtml[i] === '[') depth++;
        if (pageHtml[i] === ']') depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
      try {
        captionTracks = JSON.parse(pageHtml.substring(arrStart, arrEnd));
      } catch(e) {
        console.log('  captionTracks parse error:', e.message, 'raw:', pageHtml.substring(arrStart, arrStart + 200));
        throw new Error('Failed to parse captionTracks JSON: ' + e.message);
      }
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    // Check if video page has playability status
    const playMatch = pageHtml.match(/"playabilityStatus":\s*\{[^}]*"status"\s*:\s*"([^"]+)"/);
    const reason = playMatch ? playMatch[1] : 'unknown';
    throw new Error(`No caption tracks found (playability: ${reason}, pageLen: ${pageHtml.length})`);
  }

  console.log(`  Found ${captionTracks.length} caption tracks:`, captionTracks.map(t => `${t.languageCode}(${t.kind||'manual'})`).join(', '));

  // Step 3: Prefer English, fall back to first available
  let track = captionTracks.find(t => (t.languageCode || '').startsWith('en'));
  if (!track) {
    track = captionTracks.find(t => t.kind === 'asr');
  }
  if (!track) {
    track = captionTracks[0];
  }

  console.log(`  Using caption track: ${track.languageCode} (${track.kind || 'manual'})`);

  // Step 4: Fetch the subtitle content
  let subtitleUrl = track.baseUrl;
  if (!subtitleUrl) {
    throw new Error('Caption track has no URL');
  }

  // Request JSON3 format for easier parsing
  subtitleUrl += (subtitleUrl.includes('?') ? '&' : '?') + 'fmt=json3';

  const subResp = await fetch(subtitleUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  });

  if (!subResp.ok) {
    throw new Error(`Subtitle fetch returned ${subResp.status}`);
  }

  const subText = await subResp.text();
  let segments = [];

  try {
    // Try JSON3 format
    const json = JSON.parse(subText);
    const events = json.events || [];
    for (const event of events) {
      if (event.segs && event.tStartMs !== undefined) {
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text && text !== '\n') {
          segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
        }
      }
    }
    // If json3 parsed but events were empty, check for different json structure
    if (segments.length === 0 && json.actions) {
      // Some videos use actions instead of events
      for (const action of json.actions) {
        if (action.updateEngagementPanelAction) continue;
        const body = action.appendContinuationItemsAction?.continuationItems || [];
        for (const item of body) {
          const text = item?.transcriptSegmentRenderer?.snippet?.runs?.map(r => r.text).join('') || '';
          const startMs = parseInt(item?.transcriptSegmentRenderer?.startMs || '0');
          if (text.trim()) {
            segments.push({ offset: startMs, text: text.trim() });
          }
        }
      }
    }
  } catch (jsonErr) {
    // Fall back to XML parsing
    console.log('  JSON parse failed, trying XML. First 200 chars:', subText.slice(0, 200));
    const textMatches = subText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
    for (const m of textMatches) {
      const startMs = Math.round(parseFloat(m[1]) * 1000);
      const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (text) {
        segments.push({ offset: startMs, text });
      }
    }
  }

  if (segments.length === 0) {
    // Try fetching without fmt=json3 (get XML instead)
    const xmlUrl = subtitleUrl.replace('&fmt=json3', '').replace('?fmt=json3', '');
    console.log('  JSON3 was empty, trying XML format');
    const xmlResp = await fetch(xmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (xmlResp.ok) {
      const xmlText = await xmlResp.text();
      const textMatches = xmlText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
      for (const m of textMatches) {
        const startMs = Math.round(parseFloat(m[1]) * 1000);
        const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        if (text) {
          segments.push({ offset: startMs, text });
        }
      }
    }
  }

  if (segments.length === 0) {
    throw new Error('Parsed transcript was empty');
  }

  console.log(`  Direct fetch got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Run a single yt-dlp subtitle attempt with given args
function tryYtdlpSubtitles(videoId, args, tmpDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stderr = '';
    proc.stdout.on('data', (data) => { console.log('  yt-dlp subs:', data.toString().trim()); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      // Find any subtitle file for this video
      try {
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId) && !f.endsWith('.mp4'));
        if (files.length > 0) {
          resolve(path.join(tmpDir, files[0]));
        } else {
          console.log(`  yt-dlp attempt found no files (code ${code}). stderr: ${stderr.slice(-300)}`);
          resolve(null);
        }
      } catch(e) { resolve(null); }
    });
    proc.on('error', (err) => { resolve(null); });
  });
}

// Helper: Parse subtitle file content into segments
function parseSubtitleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let segments = [];

  if (filePath.endsWith('.json3')) {
    const json = JSON.parse(content);
    const events = json.events || [];
    for (const event of events) {
      if (event.segs && event.tStartMs !== undefined) {
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text && text !== '\n') {
          segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
        }
      }
    }
  } else {
    // Parse VTT/SRT format
    const lines = content.split('\n');
    let currentTime = 0;
    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
      if (timeMatch) {
        currentTime = parseInt(timeMatch[1]) * 3600000 + parseInt(timeMatch[2]) * 60000 +
                     parseInt(timeMatch[3]) * 1000 + parseInt(timeMatch[4]);
      } else if (line.trim() && !line.includes('-->') && !line.match(/^\d+$/) && !line.startsWith('WEBVTT')) {
        segments.push({ offset: currentTime, text: line.trim().replace(/<[^>]*>/g, '') });
      }
    }
  }

  // Clean up
  try { fs.unlinkSync(filePath); } catch(e) {}
  return segments;
}

// Helper: Fetch transcript using yt-dlp with multiple fallback strategies
async function fetchTranscriptWithYtdlp(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = path.join('/tmp', 'yt-subtitles');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outTemplate = path.join(tmpDir, `${videoId}`);

  // Clean up any previous subtitle files for this video
  try {
    const existing = fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId));
    existing.forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch(e) {} });
  } catch(e) {}

  const baseArgs = ['--skip-download', ...YTDLP_COMMON_ARGS, '-o', outTemplate, videoUrl];

  // extraArgs is now included in YTDLP_COMMON_ARGS
  const extraArgs = [];

  // Strategy 1: English auto-generated + manual subs in json3 (wildcard for en variants)
  console.log('  Trying: English json3 subtitles (wildcard)');
  let subFile = await tryYtdlpSubtitles(videoId, [
    '--skip-download', ...YTDLP_COMMON_ARGS,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);

  // Strategy 2: English subs in vtt format (wildcard)
  if (!subFile) {
    console.log('  Trying: English vtt subtitles (wildcard)');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', ...YTDLP_COMMON_ARGS,
      '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 3: Any language auto-generated subs (all languages)
  if (!subFile) {
    console.log('  Trying: Any language auto-generated subtitles');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', ...YTDLP_COMMON_ARGS,
      '--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 4: Any manual subs at all
  if (!subFile) {
    console.log('  Trying: Any manual subtitles');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', ...YTDLP_COMMON_ARGS,
      '--write-subs', '--sub-langs', 'all', '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  if (!subFile) {
    throw new Error('No transcript available for this video. It may not have captions enabled.');
  }

  console.log('  Found subtitle file:', path.basename(subFile));
  const segments = parseSubtitleFile(subFile);

  if (segments.length === 0) {
    throw new Error('Transcript was empty.');
  }

  console.log(`  Got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Strategy C - Use yt-dlp --dump-json to get subtitle URLs and fetch them
async function fetchTranscriptFromYtdlpJson(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Get video info JSON which includes subtitle URLs
  const jsonStr = await new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn('yt-dlp', [
      '--skip-download', '--dump-json', ...YTDLP_COMMON_ARGS,
      videoUrl
    ]);
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output.trim());
      else reject(new Error(`yt-dlp dump-json exited with code ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });

  const info = JSON.parse(jsonStr);

  // Look for subtitles in automatic_captions or subtitles
  const allSubs = { ...(info.automatic_captions || {}), ...(info.subtitles || {}) };

  // Prefer English
  let subLang = Object.keys(allSubs).find(k => k.startsWith('en'));
  if (!subLang) subLang = Object.keys(allSubs)[0];

  if (!subLang || !allSubs[subLang] || allSubs[subLang].length === 0) {
    throw new Error('No subtitles found in video metadata');
  }

  console.log(`  Found subtitle language: ${subLang} with ${allSubs[subLang].length} formats`);

  // Prefer json3 format, then vtt, then srv3
  const formats = allSubs[subLang];
  let subEntry = formats.find(f => f.ext === 'json3');
  if (!subEntry) subEntry = formats.find(f => f.ext === 'vtt');
  if (!subEntry) subEntry = formats.find(f => f.ext === 'srv3');
  if (!subEntry) subEntry = formats[0];

  if (!subEntry || !subEntry.url) {
    throw new Error('No usable subtitle URL found');
  }

  console.log(`  Fetching subtitle format: ${subEntry.ext} from URL`);
  const subResp = await fetch(subEntry.url);
  if (!subResp.ok) throw new Error(`Subtitle fetch returned ${subResp.status}`);

  const subText = await subResp.text();
  let segments = [];

  if (subEntry.ext === 'json3') {
    const json = JSON.parse(subText);
    const events = json.events || [];
    for (const event of events) {
      if (event.segs && event.tStartMs !== undefined) {
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text && text !== '\n') {
          segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
        }
      }
    }
  } else {
    // Parse VTT/SRT format
    const lines = subText.split('\n');
    let currentTime = 0;
    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
      if (timeMatch) {
        currentTime = parseInt(timeMatch[1]) * 3600000 + parseInt(timeMatch[2]) * 60000 +
                     parseInt(timeMatch[3]) * 1000 + parseInt(timeMatch[4]);
      } else if (line.trim() && !line.includes('-->') && !line.match(/^\d+$/) && !line.startsWith('WEBVTT')) {
        const cleanText = line.trim().replace(/<[^>]*>/g, '');
        if (cleanText) segments.push({ offset: currentTime, text: cleanText });
      }
    }
  }

  if (segments.length === 0) throw new Error('Parsed transcript was empty');
  console.log(`  Strategy C got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Fetch video title using yt-dlp
function fetchVideoTitle(videoId) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', [
      '--skip-download', '--print', 'title', ...YTDLP_COMMON_ARGS,
      `https://www.youtube.com/watch?v=${videoId}`
    ]);
    let title = '';
    proc.stdout.on('data', (data) => { title += data.toString(); });
    proc.on('close', () => { resolve(title.trim() || 'YouTube Video'); });
    proc.on('error', () => { resolve('YouTube Video'); });
  });
}

// Helper: Parse moment timestamp range (MM:SS-MM:SS format)
function parseTimeRange(rangeStr) {
  const [start, end] = rangeStr.split('-');
  const parseTime = (str) => {
    const [mins, secs] = str.split(':').map(Number);
    return mins * 60 + secs;
  };
  return { start: parseTime(start), end: parseTime(end) };
}

// GET / - Main Smart Shorts page
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = 15;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const analyses = await shortsOps.getByUserId(userId, limit + 1, offset);
    const hasMore = analyses.length > limit;
    if (hasMore) analyses.pop();

    // Parse moments JSON for each analysis
    for (const a of analyses) {
      if (a.moments && typeof a.moments === 'string') {
        try { a.moments = JSON.parse(a.moments); } catch (e) { a.moments = []; }
      }
    }

    const html = renderShortsPage(req.user, analyses, page, hasMore, req.teamPermissions);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error loading Smart Shorts page:', error);
    res.status(500).json({ error: 'Failed to load Smart Shorts' });
  }
});

// POST /analyze-upload — Analyze an uploaded video/audio file using the same
// AI pipeline as /analyze. Streams SSE updates and returns analysisId on completion.
const _repurposeMod = require('./repurpose');
const _fs = require('fs');
router.post('/analyze-upload', requireAuth, _repurposeMod.repurposeUpload.single('file'), async (req, res) => {
  let sseStarted = false;
  let filePath = req.file ? req.file.path : null;
  let audioPath = null;

  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI service is not configured. Please contact support.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseStarted = true;

    const sendUpdate = (data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) {}
    };

    const userId = req.user.id;
    const fileName = req.file.originalname || 'Uploaded File';

    sendUpdate({ status: 'extracting_audio', message: 'Extracting audio...' });
    try {
      audioPath = await _repurposeMod.extractAudioForRepurpose(filePath);
    } catch (err) {
      audioPath = filePath; // fallback — Whisper accepts most formats directly
    }

    sendUpdate({ status: 'transcribing', message: 'Transcribing with AI...' });
    let transcriptText;
    try {
      transcriptText = await _repurposeMod.transcribeUploadedFile(audioPath);
    } catch (err) {
      sendUpdate({ status: 'error', message: 'Transcription failed: ' + (err.message || 'unknown error') });
      return res.end();
    }
    if (!transcriptText || !transcriptText.trim()) {
      sendUpdate({ status: 'error', message: 'Could not extract any speech from the file.' });
      return res.end();
    }

    // Save analysis row using the upload\'s filename as a "video_url" stand-in.
    // The downstream /shorts page can extract a (missing) videoId — that's fine,
    // it falls back to a generic thumbnail.
    const sourceUrl = 'upload://' + encodeURIComponent(fileName);
    const analysisId = await shortsOps.create(userId, sourceUrl, fileName, transcriptText);
    await shortsOps.updateStatus(analysisId, 'analyzing');
    sendUpdate({ status: 'analyzing', message: 'Analyzing with AI to identify viral moments...' });

    const systemPrompt = `You are an expert content strategist specializing in identifying viral short-form content moments from transcripts. Analyze the provided transcript and identify the top 5-8 most compelling, viral-worthy moments that would perform exceptionally well on TikTok, Instagram Reels, and YouTube Shorts.\n\nFor each moment, evaluate based on:\n- Emotional hooks (inspiration, surprise, humor, controversy)\n- Actionable insights and practical value\n- Storytelling potential and narrative arcs\n- Relatability and universal appeal\n- Memorable quotes and quotable moments\n- Visual potential and descriptive language\n- Audience engagement probability\n\nReturn a JSON array of moments with this exact structure:\n[\n  {\n    "title": "Brief descriptive title",\n    "timeRange": "MM:SS-MM:SS",\n    "description": "Why this moment is viral-worthy (2-3 sentences)",\n    "script": "Exact transcript text for this moment",\n    "hooks": ["Hook line 1", "Hook line 2", "Hook line 3"],\n    "viralityScore": 85,\n    "keyThemes": ["theme1", "theme2"],\n    "suggestedCaptions": ["caption1", "caption2"],\n    "suggestedHashtags": ["#hashtag1", "#hashtag2"],\n    "emotion": "primary emotion (inspiration/humor/surprise/education/controversy)",\n    "platforms": ["tiktok", "instagram", "shorts"],\n    "platformScores": { "tiktok": 90, "instagram": 80, "shorts": 85, "twitter": 70, "linkedin": 60 }\n  }\n]\n\nEnsure all times are accurate to the transcript. Focus on moments that are 30-120 seconds long when extracted.`;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Analyze this transcript:\n\n' + transcriptText }
      ],
      temperature: 0.7,
      max_tokens: 3000
    });
    const momentText = aiResponse.choices[0].message.content;
    let moments = [];
    try {
      const m = momentText.match(/\[[\s\S]*\]/);
      if (m) moments = JSON.parse(m[0]);
    } catch (e) { moments = []; }

    await shortsOps.updateMoments(analysisId, moments);
    await shortsOps.updateStatus(analysisId, 'completed');

    sendUpdate({ status: 'completed', message: 'Analysis complete!', analysisId, moments });
    res.end();
  } catch (error) {
    console.error('analyze-upload error:', error);
    if (!sseStarted) {
      res.status(500).json({ error: error.message || 'Upload analysis failed.' });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ status: 'error', message: error.message || 'Upload analysis failed.' })}\n\n`);
        res.end();
      } catch (e) {}
    }
  } finally {
    try { if (filePath && _fs.existsSync(filePath)) _fs.unlinkSync(filePath); } catch (e) {}
    try { if (audioPath && audioPath !== filePath && _fs.existsSync(audioPath)) _fs.unlinkSync(audioPath); } catch (e) {}
  }
});

// POST /analyze - Analyze YouTube video
router.post('/analyze', requireAuth, requireCredits('smart-shorts'), requireStorageHeadroom(), async (req, res) => {
  let sseStarted = false;

  try {
    const { videoUrl } = req.body;
    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL. Please paste a valid YouTube video link.' });
    }

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI service is not configured. Please contact support.' });
    }

    const userId = req.user.id;

    // Check for existing analysis of same video
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const { pool } = require('../db/database');
      const existing = await pool.query(
        `SELECT id FROM smart_shorts WHERE user_id = $1 AND video_url LIKE $2 AND status = 'completed' LIMIT 1`,
        [userId, `%${videoId}%`]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'You have already analyzed this video. Check your analyses below.' });
      }
    } catch(e) {
      console.log('Duplicate check failed (non-fatal):', e.message);
    }

    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseStarted = true;

    const sendUpdate = (data) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        console.error('Error writing SSE:', e);
      }
    };

    try {
      sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript...' });

      // Try multiple transcript sources with fallbacks
      let segments;

      // Strategy 1: Supadata.ai API (most reliable - paid service, bypasses YouTube blocking)
      if (process.env.SUPADATA_API_KEY) {
        try {
          console.log('  Strategy 1: Supadata.ai API');
          segments = await fetchTranscriptSupadata(videoId);
        } catch (supadataErr) {
          console.log('  Supadata fetch failed:', supadataErr.message);
          segments = null;
        }
      } else {
        console.log('  Strategy 1: Skipped (SUPADATA_API_KEY not set)');
      }

      // Strategy 2: InnerTube player API + captionTracks (free fallback)
      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript (trying alternate method)...' });
        try {
          console.log('  Strategy 2: InnerTube API');
          segments = await fetchTranscriptInnerTube(videoId);
        } catch (innerErr) {
          console.log('  InnerTube fetch failed:', innerErr.message);
        }
      }

      // Strategy 3: yt-dlp subtitle fetching (handles geo-restricted, etc)
      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript (trying another method)...' });
        try {
          console.log('  Strategy 3: yt-dlp subtitles');
          segments = await fetchTranscriptWithYtdlp(videoId);
        } catch (ytdlpErr) {
          console.error('  yt-dlp subtitle fetch failed:', ytdlpErr.message);
        }
      }

      // Strategy 4: yt-dlp --dump-json to get subtitle URLs, then fetch directly
      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript (trying final method)...' });
        try {
          console.log('  Strategy 4: yt-dlp dump-json for subtitle URLs');
          segments = await fetchTranscriptFromYtdlpJson(videoId);
        } catch (jsonErr) {
          console.error('  yt-dlp json strategy failed:', jsonErr.message);
        }
      }

      // Strategy 5: Legacy direct fetch (original method)
      if (!segments || segments.length === 0) {
        try {
          console.log('  Strategy 5: Legacy direct fetch');
          segments = await fetchTranscriptDirect(videoId);
        } catch (directErr) {
          console.log('  Legacy fetch failed:', directErr.message);
        }
      }

      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'error', message: 'Could not fetch transcript. Make sure the video has captions/subtitles enabled.' });
        return res.end();
      }

      const transcriptText = buildTranscriptText(segments);

      // Fetch actual video title
      sendUpdate({ status: 'fetching_title', message: 'Getting video info...' });
      const videoTitle = await fetchVideoTitle(videoId);

      // Create initial record
      sendUpdate({ status: 'creating_record', message: 'Saving to database...' });
      const analysisId = await shortsOps.create(userId, videoUrl, videoTitle, transcriptText);

      // Update status
      await shortsOps.updateStatus(analysisId, 'analyzing');
      sendUpdate({ status: 'analyzing', message: 'Analyzing with AI to identify viral moments...' });

      // Call OpenAI to identify moments
      const systemPrompt = `You are an expert content strategist specializing in identifying viral short-form content moments from transcripts. Analyze the provided transcript and identify the top 5-8 most compelling, viral-worthy moments that would perform exceptionally well on TikTok, Instagram Reels, and YouTube Shorts.

For each moment, evaluate based on:
- Emotional hooks (inspiration, surprise, humor, controversy)
- Actionable insights and practical value
- Storytelling potential and narrative arcs
- Relatability and universal appeal
- Memorable quotes and quotable moments
- Visual potential and descriptive language
- Audience engagement probability

Return a JSON array of moments with this exact structure:
[
  {
    "title": "Brief descriptive title",
    "timeRange": "MM:SS-MM:SS",
    "description": "Why this moment is viral-worthy (2-3 sentences)",
    "script": "Exact transcript text for this moment",
    "hooks": ["Hook line 1", "Hook line 2", "Hook line 3"],
    "viralityScore": 85,
    "keyThemes": ["theme1", "theme2"],
    "suggestedCaptions": ["caption1", "caption2"],
    "suggestedHashtags": ["#hashtag1", "#hashtag2"],
    "emotion": "primary emotion (inspiration/humor/surprise/education/controversy)",
    "platforms": ["tiktok", "instagram", "shorts"],
    "platformScores": { "tiktok": 90, "instagram": 80, "shorts": 85, "twitter": 70, "linkedin": 60 }
  }
]

Ensure all times are accurate to the transcript. Focus on moments that are 30-120 seconds long when extracted.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this transcript:\n\n${transcriptText}` }
        ],
        temperature: 0.7,
        max_tokens: 3000
      });

      const momentText = response.choices[0].message.content;

      // Parse JSON response
      let moments = [];
      try {
        const jsonMatch = momentText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          moments = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Error parsing moments JSON:', parseError);
        moments = [];
      }

      // Save moments to database
      await shortsOps.updateMoments(analysisId, moments);
      await shortsOps.updateStatus(analysisId, 'completed');

      sendUpdate({
        status: 'completed',
        message: 'Analysis complete!',
        analysisId,
        moments
      });

      res.end();
    } catch (streamError) {
      console.error('Error during analysis stream:', streamError);
      sendUpdate({ status: 'error', message: streamError.message || 'Analysis failed unexpectedly.' });
      res.end();
    }
  } catch (error) {
    console.error('Error in analyze endpoint:', error);
    if (!sseStarted) {
      res.status(500).json({ error: error.message || 'Analysis failed. Please try again.' });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ status: 'error', message: error.message || 'Analysis failed.' })}\n\n`);
        res.end();
      } catch (e) {
        res.end();
      }
    }
  }
});

// POST /auto-generate - Auto-generate multiple shorts from a video
router.post('/auto-generate', requireAuth, async (req, res) => {
  let sseStarted = false;

  try {
    const { videoUrl, numClips, duration, clipStyle, captionStyle, language, includeCaptions } = req.body;
    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI service is not configured' });
    }

    const requestedClips = Math.min(Math.max(parseInt(numClips) || 10, 1), 20);
    const clipDuration = Math.min(Math.max(parseInt(duration) || 30, 10), 180);
    const userId = req.user.id;

    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseStarted = true;

    const sendUpdate = (data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) {}
    };

    try {
      // Step 1: Fetch transcript
      sendUpdate({ status: 'analyzing', message: 'Fetching video transcript...' });

      let segments = null;
      if (process.env.SUPADATA_API_KEY) {
        try { segments = await fetchTranscriptSupadata(videoId); } catch (e) { segments = null; }
      }
      if (!segments || segments.length === 0) {
        try { segments = await fetchTranscriptInnerTube(videoId); } catch (e) {}
      }
      if (!segments || segments.length === 0) {
        try { segments = await fetchTranscriptDirect(videoId); } catch (e) {}
      }
      if (!segments || segments.length === 0) {
        try { segments = await fetchTranscriptWithYtdlp(videoId); } catch (e) {}
      }

      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'error', message: 'Could not fetch transcript for this video. Try a different video.' });
        res.end();
        return;
      }

      const transcriptText = segments.map(s => {
        const min = Math.floor(s.start / 60);
        const sec = Math.floor(s.start % 60);
        return `[${min}:${sec < 10 ? '0' + sec : sec}] ${s.text}`;
      }).join('\n');

      // Get video title
      let videoTitle = 'Video';
      try {
        const { pool } = require('../db/database');
        const existing = await pool.query(
          `SELECT video_title FROM smart_shorts WHERE user_id = $1 AND video_url LIKE $2 LIMIT 1`,
          [userId, `%${videoId}%`]
        );
        if (existing.rows.length > 0) videoTitle = existing.rows[0].video_title;
      } catch (e) {}

      // Step 2: AI split into N clips of requested duration
      sendUpdate({ status: 'analyzing', message: 'AI is selecting the best ' + requestedClips + ' moments (' + clipDuration + 's each)...' });

      const splitPrompt = `You are an expert content strategist. Analyze this transcript and identify exactly ${requestedClips} non-overlapping segments, each approximately ${clipDuration} seconds long, that would make the best short-form content for TikTok, Instagram Reels, and YouTube Shorts.

Rules:
- Each segment MUST be approximately ${clipDuration} seconds long (within 5 seconds)
- Segments must NOT overlap with each other
- Select the most engaging, viral-worthy moments
- Spread selections across the entire video (don't cluster at the beginning)
- Each segment should be self-contained and make sense on its own
- Prioritize: emotional hooks, surprising facts, practical tips, humor, storytelling peaks

Return ONLY a JSON array with this exact structure:
[
  {
    "title": "Brief catchy title",
    "timeRange": "MM:SS-MM:SS",
    "description": "Why this makes a great short (1 sentence)",
    "viralityScore": 85,
    "keyThemes": ["theme1", "theme2"]
  }
]

The array must have exactly ${requestedClips} items. Ensure all times are accurate to the transcript.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: splitPrompt },
          { role: 'user', content: `Transcript:\n\n${transcriptText}` }
        ],
        temperature: 0.7,
        max_tokens: 4000
      });

      const momentText = response.choices[0].message.content;
      let moments = [];
      try {
        const jsonMatch = momentText.match(/\[[\s\S]*\]/);
        if (jsonMatch) moments = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error('Auto-generate: failed to parse AI moments:', parseError);
      }

      if (moments.length === 0) {
        sendUpdate({ status: 'error', message: 'AI could not identify enough moments. Try a longer video or fewer clips.' });
        res.end();
        return;
      }

      sendUpdate({ status: 'analyzing', message: 'Found ' + moments.length + ' moments. Saving analysis...' });

      // Step 3: Save as a real analysis so we can reuse /clip endpoint
      const { pool } = require('../db/database');
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const analysisResult = await pool.query(
        `INSERT INTO smart_shorts (user_id, video_url, video_title, transcript, moments, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'completed', NOW()) RETURNING id`,
        [userId, canonicalUrl, videoTitle || 'Auto-Generated', transcriptText, JSON.stringify(moments)]
      );
      const analysisId = analysisResult.rows[0].id;

      // Step 4: Generate each clip
      sendUpdate({ status: 'generating', message: 'Starting clip generation...', current: 0, total: moments.length });

      let generated = 0;
      for (let i = 0; i < moments.length; i++) {
        sendUpdate({ status: 'generating', message: 'Generating clip ' + (i + 1) + ' of ' + moments.length + ': ' + (moments[i].title || ''), current: i, total: moments.length });

        try {
          // Call the clip endpoint internally
          const clipResp = await new Promise((resolve, reject) => {
            const http = require('http');
            const postData = JSON.stringify({
              analysisId,
              momentIndex: i,
              includeCaptions: includeCaptions !== false,
              clipStyle: clipStyle || 'blur',
              captionLanguage: language || 'en',
              captionStyle: captionStyle || 'trending'
            });

            // Use internal HTTP request to our own clip endpoint
            const options = {
              hostname: '127.0.0.1',
              port: process.env.PORT || 3000,
              path: '/shorts/clip',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Cookie': req.headers.cookie || ''
              }
            };

            const clipReq = http.request(options, (clipRes) => {
              let body = '';
              clipRes.on('data', (chunk) => body += chunk);
              clipRes.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid response')); }
              });
            });
            clipReq.on('error', reject);
            clipReq.write(postData);
            clipReq.end();
          });

          if (!clipResp.success) {
            console.error('Auto-generate clip ' + i + ' failed:', clipResp.error);
            continue;
          }

          // Poll for clip readiness (max 5 min per clip)
          const filename = clipResp.filename;
          let ready = false;
          for (let attempt = 0; attempt < 150; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
              const filePath = path.join(CLIPS_DIR, filename);
              const errorPath = filePath + '.error';
              const progressPath = filePath + '.progress';

              // Check for error
              if (fs.existsSync(errorPath)) { break; }

              // Check if ready: file exists, > 10KB, no progress file
              if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                const stillProcessing = fs.existsSync(progressPath);
                if (stat.size > 10000 && !stillProcessing) { ready = true; break; }
              }
            } catch (e) {}

            if (attempt % 5 === 0) {
              sendUpdate({ status: 'generating', message: 'Processing clip ' + (i + 1) + '...', current: i, total: moments.length });
            }
          }

          if (ready) {
            generated++;
            sendUpdate({
              status: 'clip_ready',
              index: i,
              title: moments[i].title,
              timeRange: moments[i].timeRange,
              description: moments[i].description,
              viralityScore: moments[i].viralityScore,
              duration: clipDuration,
              filename: filename
            });
          }
        } catch (clipErr) {
          console.error('Auto-generate clip ' + i + ' error:', clipErr.message);
        }
      }

      // Done
      sendUpdate({ status: 'complete', totalGenerated: generated, totalRequested: requestedClips, analysisId });
      res.end();

    } catch (streamError) {
      console.error('Auto-generate stream error:', streamError);
      sendUpdate({ status: 'error', message: streamError.message || 'Auto-generation failed' });
      res.end();
    }
  } catch (error) {
    console.error('Auto-generate error:', error);
    if (!sseStarted) {
      res.status(500).json({ error: error.message || 'Auto-generation failed' });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ status: 'error', message: error.message })}\n\n`);
        res.end();
      } catch (e) { res.end(); }
    }
  }
});

// POST /generate - Generate platform-specific content
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { momentId, platforms, analysisId } = req.body;

    if (!momentId || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Fetch the analysis to get the moment details
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Parse moments JSON if needed
    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }

    const moment = (moments || []).find(m => m.timeRange === momentId);
    if (!moment) {
      return res.status(404).json({ error: 'Moment not found' });
    }

    // Generate content for each platform
    const generateForPlatform = async (platform) => {
      const platformPrompts = {
        tiktok: `Create a TikTok short optimized for maximum viral potential. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "A captivating opening hook (max 10 words)",
          "script": "30-60 second short-form script",
          "caption": "TikTok caption with emojis",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "Best times and engagement tips",
          "soundSuggestion": "Suggested audio/music style"
        }`,

        instagram: `Create an Instagram Reel optimized for Reels algorithm. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "Attention-grabbing opening (max 10 words)",
          "script": "30-60 second Reel script",
          "caption": "Instagram caption with relevant emojis and call-to-action",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "Engagement and reach tips",
          "musicSuggestion": "Audio/music recommendation"
        }`,

        shorts: `Create a YouTube Shorts script optimized for YouTube algorithm. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "Compelling opening line (max 10 words)",
          "script": "45-60 second Shorts script",
          "caption": "YouTube description text",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "YouTube Shorts best practices",
          "thumbnailSuggestion": "Key frame description"
        }`,

        twitter: `Create a Twitter/X thread or single tweet for maximum engagement. The moment is: "${moment.script}"

        Generate a JSON object with:
          "hook": "Compelling opening (max 15 words)",
          "script": "Main tweet text or thread structure",
          "caption": "Follow-up engagement prompt",
          "hashtags": ["hashtag1", "hashtag2"],
          "postingTips": "Best times and engagement tactics",
          "threadStructure": "If thread, outline each tweet"
        }`,

        linkedin: `Create professional LinkedIn content that drives engagement. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "Professional opening (max 15 words)",
          "script": "LinkedIn post (professional, insightful)",
          "caption": "Value proposition and call-to-action",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "LinkedIn engagement strategy",
          "callToAction": "Professional CTA"
        }`,

        blog: `Write a compelling blog post based on this video moment: "${moment.script}"
        Video title: "${analysis.video_title || 'Untitled'}"

        Generate a JSON object with:
        {
          "title": "SEO-optimized blog post title",
          "hook": "Attention-grabbing opening paragraph (2-3 sentences)",
          "script": "Full blog post body (500-800 words, well-structured with subheadings marked with ##). Write in an engaging, conversational tone. Include insights, examples, and actionable takeaways.",
          "caption": "Meta description for SEO (150-160 chars)",
          "hashtags": ["keyword1", "keyword2", "keyword3"],
          "postingTips": "SEO and distribution tips",
          "outline": "Brief outline of the post structure"
        }`,

        newsletter: `Create an engaging email newsletter section based on this video moment: "${moment.script}"
        Video title: "${analysis.video_title || 'Untitled'}"

        Generate a JSON object with:
        {
          "title": "Compelling email subject line",
          "hook": "Preview text / opening hook (1-2 sentences)",
          "script": "Full newsletter body (300-500 words). Write in a personal, conversational tone. Include a story angle, key insights, and a clear call-to-action. Format with short paragraphs.",
          "caption": "Preview text for email",
          "hashtags": ["topic1", "topic2"],
          "postingTips": "Email timing and segmentation tips",
          "callToAction": "Clear CTA with link placeholder"
        }`,

        thread: `Create a viral Twitter/X thread (5-8 tweets) based on this video moment: "${moment.script}"
        Video title: "${analysis.video_title || 'Untitled'}"

        Generate a JSON object with:
        {
          "hook": "Thread opener tweet - must be curiosity-inducing (max 280 chars)",
          "script": "Tweet 2 through 7, separated by \\n\\n---\\n\\n between each tweet. Each tweet must be under 280 characters. Build narrative tension. End with a call-to-action tweet.",
          "caption": "Quote tweet text for sharing the thread",
          "hashtags": ["hashtag1", "hashtag2"],
          "postingTips": "Thread posting strategy (timing, replies, engagement)",
          "threadStructure": "Numbered outline of each tweet's purpose"
        }`
      };

      const prompt = platformPrompts[platform] || platformPrompts.tiktok;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert social media content creator. Generate platform-optimized content in valid JSON format only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 1000
      });

      const contentText = response.choices[0].message.content;
      let platformContent = {};

      try {
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          platformContent = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error(`Error parsing ${platform} content:`, parseError);
      }

      return { platform, ...platformContent };
    };

    // Generate for all requested platforms
    const generatedContent = await Promise.all(
      platforms.map(p => generateForPlatform(p))
    );

    res.json({ success: true, content: generatedContent });
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// GET /history - View past analyses
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const analyses = await shortsOps.getByUserId(userId, limit, offset);
    res.json({ analyses });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /api/:id - Get specific analysis
router.get('/api/:id', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    // Parse moments JSON
    if (analysis.moments && typeof analysis.moments === 'string') {
      try { analysis.moments = JSON.parse(analysis.moments); } catch (e) { analysis.moments = []; }
    }
    res.json({ analysis });
  } catch (error) {
    console.error('Error fetching analysis:', error);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// GET /api/:id/calendar-links — count + previews of linked calendar entries
router.get('/api/:id/calendar-links', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
    if (analysis.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    const { getDb } = require('../db/database');
    const db = getDb();
    const result = await db.query(
      'SELECT id, title, platform, scheduled_date, scheduled_time FROM calendar_entries WHERE user_id = $1 AND analysis_id = $2 ORDER BY scheduled_date, scheduled_time',
      [req.user.id, req.params.id]
    );
    res.json({ count: result.rows.length, entries: result.rows });
  } catch (error) {
    console.error('Calendar-links lookup error:', error);
    res.status(500).json({ error: 'Failed to look up linked entries' });
  }
});

// DELETE /api/:id — Delete analysis. If ?cascade=1, also remove calendar entries
// linked to this analysis_id.
router.delete('/api/:id', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    let cascadedCount = 0;
    if (req.query.cascade === '1') {
      const { getDb } = require('../db/database');
      const db = getDb();
      const r = await db.query(
        'DELETE FROM calendar_entries WHERE user_id = $1 AND analysis_id = $2 RETURNING id',
        [req.user.id, req.params.id]
      );
      cascadedCount = r.rowCount || 0;
    }
    await shortsOps.delete(req.params.id);
    res.json({ success: true, cascadedCount });
  } catch (error) {
    console.error('Error deleting analysis:', error);
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

// GET /brand-kit - Get user's brand kit settings
router.get('/brand-kit', requireAuth, async (req, res) => {
  try {
    const kit = await brandKitOps.getByUserId(req.user.id);
    res.json({ success: true, brandKit: kit || {} });
  } catch (error) {
    console.error('Error fetching brand kit:', error);
    res.status(500).json({ error: 'Failed to fetch brand kit' });
  }
});

// GET /connection-status - Which social platforms can this user actually
// publish to right now? Used by the Add-to-Calendar modal to gate the Save
// button: if the chosen platform isn't connected, swap Save for a
// "Connect <Platform>" CTA. Source of truth: the user row's per-platform
// access token columns (tiktok_access_token, instagram_access_token, ...).
router.get('/connection-status', requireAuth, async (req, res) => {
  try {
    const row = (await pool.query(
      `SELECT
         tiktok_access_token, instagram_access_token, twitter_access_token,
         linkedin_access_token, facebook_access_token, youtube_access_token
       FROM users WHERE id = $1`,
      [req.user.id]
    )).rows[0] || {};
    const has = (v) => !!(v && String(v).trim());
    res.json({
      success: true,
      connections: {
        tiktok:    has(row.tiktok_access_token),
        instagram: has(row.instagram_access_token),
        twitter:   has(row.twitter_access_token),
        linkedin:  has(row.linkedin_access_token),
        facebook:  has(row.facebook_access_token),
        youtube:   has(row.youtube_access_token),
      }
    });
  } catch (error) {
    console.error('Error checking connection status:', error);
    res.status(500).json({ error: 'Failed to check connection status' });
  }
});

// GET /calendar/publish-status - In-browser auto-publish diagnostics.
//
// Returns the user's last 25 calendar entries with every column that
// matters for the schedule-publish cron — so a stuck "scheduled but
// never posted" entry can be diagnosed without Railway log access.
// Hit it from devtools:
//   fetch('/shorts/calendar/publish-status').then(r=>r.json()).then(console.table)
router.get('/calendar/publish-status', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, platform, scheduled_date, scheduled_time,
              auto_publish, connection_id, clip_filename,
              published_at, publish_attempts, publish_error, status,
              created_at
       FROM calendar_entries
       WHERE user_id = $1
       ORDER BY scheduled_date DESC, scheduled_time DESC
       LIMIT 25`,
      [req.user.id]
    );
    res.json({
      success: true,
      now: new Date().toISOString(),
      cronTickMs: 120000,
      entries: r.rows.map(e => ({
        id: e.id,
        title: e.title,
        platform: e.platform,
        scheduledFor: e.scheduled_date && (e.scheduled_date.toISOString
          ? e.scheduled_date.toISOString().slice(0, 10)
          : String(e.scheduled_date).slice(0, 10)) + ' ' + e.scheduled_time,
        auto_publish: e.auto_publish,
        has_connection: !!e.connection_id,
        has_clip_filename: !!(e.clip_filename && e.clip_filename.trim()),
        publish_attempts: e.publish_attempts || 0,
        publish_error: e.publish_error || null,
        published_at: e.published_at,
        status: e.status,
        // Why might the cron still be skipping it?
        diagnosis: (function() {
          if (e.published_at) return 'published ' + e.published_at;
          if (!e.auto_publish) return 'auto_publish=false (cron only picks up auto_publish=true)';
          if ((e.publish_attempts || 0) >= 3) return 'publish_attempts >= 3, cron has abandoned this entry — reset publish_attempts=0 to retry';
          const when = new Date((e.scheduled_date && e.scheduled_date.toISOString
            ? e.scheduled_date.toISOString().slice(0, 10)
            : String(e.scheduled_date).slice(0, 10)) + 'T' + e.scheduled_time + 'Z');
          if (when.getTime() > Date.now()) return 'scheduled time has not arrived yet (' + when.toISOString() + ')';
          return 'eligible — should fire on next cron tick (every 2 min)';
        })()
      }))
    });
  } catch (error) {
    console.error('Error reading publish-status:', error);
    res.status(500).json({ error: 'Failed to read publish-status' });
  }
});

// POST /calendar/:id/retry-publish - Reset publish_attempts + publish_error
// so the cron picks an abandoned entry up again. Useful after fixing the
// underlying cause (re-rendering a clip, reconnecting an account, etc.).
router.post('/calendar/:id/retry-publish', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE calendar_entries
       SET publish_attempts = 0, publish_error = '', published_at = NULL
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, platform`,
      [req.params.id, req.user.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true, entry: r.rows[0] });
  } catch (error) {
    console.error('Error retrying publish:', error);
    res.status(500).json({ error: 'Failed to retry publish' });
  }
});

// POST /brand-kit - Save user's brand kit settings
router.post('/brand-kit', requireAuth, async (req, res) => {
  try {
    const { brandName, watermarkText, primaryColor, secondaryColor, fontStyle, elevenlabsApiKey } = req.body;
    const kit = await brandKitOps.upsert(req.user.id, {
      brandName, watermarkText, primaryColor, secondaryColor, fontStyle, elevenlabsApiKey
    });
    res.json({ success: true, brandKit: kit });
  } catch (error) {
    console.error('Error saving brand kit:', error);
    res.status(500).json({ error: 'Failed to save brand kit' });
  }
});

  // POST /save-settings - Save settings (ElevenLabs API key) without touching brand kit fields
  router.post('/save-settings', requireAuth, async (req, res) => {
    try {
      const { elevenlabsApiKey } = req.body;
      // First get existing brand kit to preserve other fields
      const existing = await brandKitOps.getByUserId(req.user.id);
      const kit = await brandKitOps.upsert(req.user.id, {
        brandName: existing?.brand_name || '',
        watermarkText: existing?.watermark_text || '',
        primaryColor: existing?.primary_color || '#FF0050',
        secondaryColor: existing?.secondary_color || '#6c5ce7',
        fontStyle: existing?.font_style || 'modern',
        elevenlabsApiKey
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving settings:', error);
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

// GET /elevenlabs-voices - Fetch available ElevenLabs voices for the user
router.get('/elevenlabs-voices', requireAuth, async (req, res) => {
  try {
    const brandKit = await brandKitOps.getByUserId(req.user.id);
    const apiKey = brandKit?.elevenlabs_api_key;
    if (!apiKey) {
      return res.json({ voices: [], message: 'No ElevenLabs API key configured. Add it in Settings.' });
    }
    const elResp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
    if (!elResp.ok) {
      return res.status(400).json({ error: 'Invalid ElevenLabs API key or API error' });
    }
    const data = await elResp.json();
    const voices = (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category || 'custom',
      preview_url: v.preview_url || null,
      labels: v.labels || {}
    }));
    res.json({ voices });
  } catch (err) {
    console.error('ElevenLabs voices error:', err);
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

// POST /batch-analyze - Analyze multiple YouTube videos
router.post('/batch-analyze', requireAuth, requireFeature('batchAnalysis'), async (req, res) => {
  try {
    const { videoUrls } = req.body;
    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
      return res.status(400).json({ error: 'Provide an array of video URLs' });
    }
    if (videoUrls.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 videos per batch' });
    }

    // Validate all URLs first
    const validUrls = [];
    for (const url of videoUrls) {
      const vid = extractVideoId(url.trim());
      if (vid) validUrls.push({ url: url.trim(), videoId: vid });
    }
    if (validUrls.length === 0) {
      return res.status(400).json({ error: 'No valid YouTube URLs found' });
    }

    // Return immediately with batch ID, process in background
    const batchId = require('uuid').v4();
    res.json({ success: true, batchId, totalVideos: validUrls.length, message: `Processing ${validUrls.length} videos...` });

    // Process each video sequentially in background
    (async () => {
      const results = [];
      for (let i = 0; i < validUrls.length; i++) {
        const { url, videoId } = validUrls[i];
        try {
          // Simulate the analyze endpoint logic inline
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

          // Fetch transcript
          let transcript = null;
          try {
            // Try Supadata
            if (process.env.SUPADATA_API_KEY) {
              const supResp = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}&lang=en`, {
                headers: { 'x-api-key': process.env.SUPADATA_API_KEY }
              });
              if (supResp.ok) {
                const supData = await supResp.json();
                if (supData.content && supData.content.length > 0) {
                  transcript = supData.content.map(s => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`).join(' ');
                }
              }
            }
          } catch (e) { console.log(`  Batch: transcript failed for ${videoId}:`, e.message); }

          // Get video title
          let videoTitle = 'Video ' + (i + 1);
          try {
            const pageResp = await fetch(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`);
            if (pageResp.ok) {
              const oembed = await pageResp.json();
              videoTitle = oembed.title || videoTitle;
            }
          } catch (e) {}

          // Use AI to find moments
          const promptText = transcript
            ? `Analyze this YouTube video transcript and find the top 3-5 most viral-worthy moments.\n\nTranscript:\n${transcript.substring(0, 4000)}`
            : `Analyze this YouTube video (ID: ${videoId}, Title: ${videoTitle}) and suggest 3-5 potential viral moments based on the title.`;

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a viral content analyst. Return a JSON array of moments with: title, timeRange (HH:MM:SS-HH:MM:SS), description, viralityScore (0-100), keyThemes (array), platforms (array).' },
              { role: 'user', content: promptText }
            ],
            response_format: { type: 'json_object' }
          });

          let moments = [];
        try {
          const parsed = JSON.parse(completion.choices[0].message.content);
          if (Array.isArray(parsed)) {
            moments = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            // json_object format returns an object - find the first array value
            for (const key of Object.keys(parsed)) {
              if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
                moments = parsed[key];
                break;
              }
            }
          }
        } catch (e) {
          // Fallback: extract JSON array from raw text
          try {
            const raw = completion.choices[0].message.content;
            const m = raw.match(/\[[\s\S]*\]/);
            if (m) moments = JSON.parse(m[0]);
          } catch (e2) {}
        }

          // Save to DB
        const analysisId = await shortsOps.create(req.user.id, videoUrl, videoTitle, transcript || '');
        await shortsOps.updateMoments(analysisId, moments);
        await shortsOps.updateStatus(analysisId, 'completed');

          results.push({ videoId, title: videoTitle, analysisId, momentCount: moments.length, status: 'completed' });
          console.log(`  Batch [${i+1}/${validUrls.length}]: ${videoTitle} - ${moments.length} moments`);
        } catch (err) {
          console.error(`  Batch [${i+1}] failed:`, err.message);
          results.push({ videoId, status: 'failed', error: err.message });
        }
      }
      // Store batch results in a temp file
      try {
        fs.writeFileSync(path.join(CLIPS_DIR, `batch_${batchId}.json`), JSON.stringify(results));
      } catch (e) {}
    })();

  } catch (error) {
    console.error('Batch analyze error:', error);
    res.status(500).json({ error: 'Batch analysis failed' });
  }
});

// GET /batch-status/:batchId - Check batch progress
router.get('/batch-status/:batchId', requireAuth, (req, res) => {
  const batchId = req.params.batchId.replace(/[^a-f0-9-]/g, '');
  const resultPath = path.join(CLIPS_DIR, `batch_${batchId}.json`);
  if (fs.existsSync(resultPath)) {
    const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    res.json({ complete: true, results });
  } else {
    res.json({ complete: false, message: 'Still processing...' });
  }
});

// Helper for timestamp formatting (with millisecond precision)
// Note: primary formatTimestamp is defined at top of file, this is kept for backward compat
function formatTimestampCompat(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

// In-flight lock map so concurrent requests for the same preview
// don't double-spawn ffmpeg. Key: output path on disk. Value: Promise
// that resolves once the writer finishes.
const previewGenerationLocks = new Map();

// GET /moment-preview/:analysisId/:momentIdx
// Returns a 9:16 vertical, center-cropped, trimmed-to-timeRange MP4 for
// a single moment so the analysis card can autoplay it in a <video> tag.
// Lazily ffmpegs the first request and caches the output in CLIPS_DIR
// as _preview_<id>_m<idx>.mp4 (small file, ~1-3MB at 360x640@CRF 28).
router.get('/moment-preview/:analysisId/:momentIdx', requireAuth, async (req, res) => {
  try {
    if (!ffmpegAvailable) return res.status(503).end();

    const analysisId = req.params.analysisId;
    const momentIdx = parseInt(req.params.momentIdx, 10);
    if (!Number.isFinite(momentIdx) || momentIdx < 0) return res.status(400).end();

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) return res.status(404).end();

    let moments = analysis.moments || [];
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIdx];
    if (!moment || !moment.timeRange) return res.status(404).end();

    const outPath = path.join(CLIPS_DIR, `_preview_${analysisId}_m${momentIdx}.mp4`);

    // Helper to stream the cached file with proper headers.
    const sendCached = () => {
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('Content-Type', 'video/mp4');
      return res.sendFile(outPath);
    };

    // Cache hit — serve immediately.
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
      return sendCached();
    }

    // Wait on any in-flight generation for the same file before kicking
    // off a new ffmpeg. Two simultaneous requests for the same preview
    // (page refresh, hot reload) would otherwise race for the same path.
    if (previewGenerationLocks.has(outPath)) {
      try { await previewGenerationLocks.get(outPath); } catch (_) { /* swallow — handled below */ }
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
        return sendCached();
      }
    }

    // Parse the moment time range. parseTimeRange handles MM:SS-MM:SS.
    let startSec, endSec;
    try {
      const r = parseTimeRange(moment.timeRange);
      startSec = r.start;
      endSec = r.end;
    } catch (e) { return res.status(400).end(); }
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      return res.status(400).end();
    }
    const duration = Math.max(1, endSec - startSec);

    // Extract YouTube videoId from the analysis URL.
    const ytRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
    const vidMatch = (analysis.video_url || '').match(ytRegex);
    if (!vidMatch) return res.status(400).end();
    const videoId = vidMatch[1];
    const videoUrl = analysis.video_url;

    // Register lock so concurrent requests block instead of racing.
    let lockResolve, lockReject;
    const lockPromise = new Promise((resolve, reject) => {
      lockResolve = resolve;
      lockReject = reject;
    });
    previewGenerationLocks.set(outPath, lockPromise);

    try {
      // Reuse the cached source video if available; download otherwise.
      const ytdlpPath = 'yt-dlp';
      const sourceVideoPath = await getOrDownloadVideo(videoId, videoUrl, ytdlpPath, () => {});

      // ffmpeg pipeline:
      //   -ss before -i = fast seek (keyframe-accurate enough for a preview)
      //   -t duration   = trim to the moment's window
      //   crop=ih*9/16:ih  = center crop the source into a 9:16 column
      //   scale=360:640    = downscale for fast playback / small file size
      //   libx264 veryfast crf 28 + faststart for browser streaming
      //   aac 64k stereo audio so the user can unmute meaningfully
      const ffArgs = [
        '-y',
        '-ss', String(startSec),
        '-t', String(duration),
        '-i', sourceVideoPath,
        '-vf', 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=360:640:flags=lanczos',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '64k', '-ac', '2', '-ar', '44100',
        '-movflags', '+faststart',
        outPath
      ];

      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('error', e => settle(reject, e));
        proc.on('close', code => code === 0
          ? settle(resolve)
          : settle(reject, new Error(`ffmpeg preview exit ${code}: ${stderr.slice(-300)}`)));
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch (_) {}
          settle(reject, new Error('ffmpeg preview timeout (90s)'));
        }, 90000);
      });

      lockResolve();
    } catch (genErr) {
      lockReject(genErr);
      previewGenerationLocks.delete(outPath);
      // Clean up any half-written file so the next request retries.
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
      console.error('  Moment preview generation failed:', genErr && genErr.message);
      return res.status(500).json({ error: 'preview generation failed', detail: String(genErr && genErr.message || '').slice(0, 300) });
    }
    previewGenerationLocks.delete(outPath);

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
      return res.status(500).end();
    }
    return sendCached();
  } catch (err) {
    console.error('Moment preview error:', err);
    return res.status(500).end();
  }
});

// GET /analysis/:id - Get analysis data (used by client-side export)
router.get('/analysis/:id', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    let moments = analysis.moments || [];
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    res.json({
      id: analysis.id,
      video_title: analysis.video_title,
      video_url: analysis.video_url,
      moments
    });
  } catch (err) {
    console.error('Get analysis error:', err);
    res.status(500).json({ error: 'Failed to load analysis' });
  }
});

// GET /export/:analysisId - Export all clips from an analysis as ZIP (legacy)
router.get('/export/:analysisId', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Find all clip files for this analysis
    const analysisId = req.params.analysisId;
    const analysisTag = `a${analysisId}`;
    const files = fs.readdirSync(CLIPS_DIR);
    const clipFiles = files.filter(f => f.endsWith('.mp4') && !f.includes('.encoding') && !f.includes('.temp'));
    const thumbFiles = files.filter(f => f.endsWith('.jpg') && f.startsWith('thumb_'));

    // First try to match clips by analysis ID tag in filename
    let matchedClips = clipFiles.filter(f => f.includes(analysisTag));
    let matchedThumbs = thumbFiles.filter(f => f.includes(analysisTag));

    // Fallback: if no tagged clips found, use recent clips (within last 24 hours) for backward compat
    if (matchedClips.length === 0 && matchedThumbs.length === 0) {
      const oneDayAgo = Date.now() - 86400000;
      matchedClips = clipFiles.filter(f => {
        try {
          const stat = fs.statSync(path.join(CLIPS_DIR, f));
          return stat.mtimeMs > oneDayAgo && stat.size > 50000;
        } catch (e) { return false; }
      });
      matchedThumbs = thumbFiles.filter(f => {
        try {
          const stat = fs.statSync(path.join(CLIPS_DIR, f));
          return stat.mtimeMs > oneDayAgo && stat.size > 1000;
        } catch (e) { return false; }
      });
    }

    if (matchedClips.length === 0 && matchedThumbs.length === 0) {
      return res.status(404).json({ error: 'No clips found. Clips are cleared on server updates — please download clips individually after generating them, or generate and export in the same session.' });
    }

    const safeTitle = (analysis.video_title || 'export').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const zipFilename = `${safeTitle}_export_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => { console.error('Archive error:', err); res.status(500).end(); });
    archive.pipe(res);

    // Add clips
    for (const clip of matchedClips) {
      archive.file(path.join(CLIPS_DIR, clip), { name: `clips/${clip}` });
    }
    // Add thumbnails
    for (const thumb of matchedThumbs) {
      archive.file(path.join(CLIPS_DIR, thumb), { name: `thumbnails/${thumb}` });
    }

    // Add content summary JSON
    const summary = {
      videoTitle: analysis.video_title,
      videoUrl: analysis.video_url,
      exportDate: new Date().toISOString(),
      clips: matchedClips.length,
      thumbnails: matchedThumbs.length,
      moments: analysis.moments
    };
    archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });

    await archive.finalize();

  } catch (error) {
    console.error('Export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
  }
});

// POST /virality-analysis - Get detailed virality breakdown for a moment
router.post('/virality-analysis', requireAuth, async (req, res) => {
  try {
    const { analysisId, momentIndex } = req.body;
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a viral content expert. Analyze this moment and return a JSON object with:
          - hookStrength (0-100): How strong the opening hook is
          - emotionalImpact (0-100): Emotional resonance score
          - shareability (0-100): How likely people are to share
          - trendAlignment (0-100): How aligned with current trends
          - audienceReach (0-100): Potential audience size
          - boostTips (array of 3-5 strings): Specific actionable tips to increase virality
          - bestTimeToPost (string): Best time/day to post this content
          - targetAudience (string): Description of ideal target audience
          - predictedViews (string): Estimated view range (e.g. "10K-50K")` },
        { role: 'user', content: `Analyze this moment for virality:\nTitle: ${moment.title}\nDescription: ${moment.description}\nScore: ${moment.viralityScore}%\nThemes: ${(moment.keyThemes || []).join(', ')}\nPlatforms: ${(moment.platforms || []).join(', ')}` }
      ],
      response_format: { type: 'json_object' }
    });

    let breakdown = {};
    try {
      breakdown = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      breakdown = { error: 'Could not parse analysis' };
    }

    res.json({ success: true, breakdown });
  } catch (error) {
    console.error('Virality analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze virality' });
  }
});

// POST /broll-suggestions - AI-powered auto B-Roll scene selector
router.post('/broll-suggestions', requireAuth, async (req, res) => {
  try {
    const { analysisId, momentIndex } = req.body;
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    // Use AI to analyze the moment script and pick specific B-Roll scenes
    let scenes = [];
    if (process.env.OPENAI_API_KEY) {
      try {
        const scenePrompt = `You are a professional video editor. Analyze this short-form video moment and suggest exactly 3-5 specific B-Roll scenes that would visually enhance the content. For each scene, pick the BEST visual that matches what is being discussed.

Moment Title: ${moment.title}
Script/Transcript: ${moment.script || moment.description || ''}
Key Themes: ${(moment.keyThemes || []).join(', ')}
Emotion: ${moment.emotion || 'educational'}

For each B-Roll scene, return:
- "timestamp_hint": approximate point in the moment where this B-Roll should appear (e.g. "beginning", "middle", "end", "0:15")
- "scene_description": what the viewer should see (1 sentence)
- "search_query": the BEST 2-4 word Pexels search query to find this exact footage. Be VERY specific — use concrete nouns and actions, NOT abstract concepts. For example: "person typing laptop" not "productivity", "cash register payment" not "business", "doctor stethoscope" not "health". Pexels works best with literal visual descriptions.
- "why": brief reason this visual fits (1 sentence)

Return a JSON array:
[
  {
    "timestamp_hint": "beginning",
    "scene_description": "Close-up of hands typing on a laptop keyboard",
    "search_query": "typing laptop closeup",
    "why": "Shows the work being discussed in the opening"
  }
]

IMPORTANT RULES:
- Pick visuals that DIRECTLY relate to what is being said at each point
- Use CONCRETE, LITERAL search terms — describe what the camera would see
- Avoid abstract/generic terms like "success", "motivation", "growth", "business"
- Prefer close-up and medium shots over wide/aerial shots for short-form content
- Think about what a human video editor would actually cut to`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: scenePrompt }
          ],
          temperature: 0.7,
          max_tokens: 1000
        });

        const sceneText = completion.choices[0].message.content;
        try {
          const jsonMatch = sceneText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            scenes = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          console.error('Error parsing AI scenes:', e.message);
        }
      } catch (aiErr) {
        console.error('AI scene analysis error:', aiErr.message);
      }
    }

    // Fallback if AI didn't produce scenes
    if (scenes.length === 0) {
      const keywords = (moment.keyThemes || []).slice(0, 3);
      const fallbackQueries = keywords.length > 0 ? keywords : [moment.title.split(' ').slice(0, 3).join(' ')];
      scenes = fallbackQueries.map((q, i) => ({
        timestamp_hint: i === 0 ? 'beginning' : i === 1 ? 'middle' : 'end',
        scene_description: 'Stock footage related to: ' + q,
        search_query: q,
        why: 'Matches the key theme of the moment'
      }));
    }

    // Fetch best matching video from Pexels for each scene
    const pexelsKey = process.env.PEXELS_API_KEY;
    const autoSelectedScenes = [];

    for (const scene of scenes) {
      const sceneResult = {
        ...scene,
        video: null,
        alternatives: [],
        searchUrl: `https://www.pexels.com/search/videos/${encodeURIComponent(scene.search_query)}/`
      };

      if (pexelsKey) {
        try {
          const pxResp = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(scene.search_query)}&per_page=8&orientation=portrait`, {
            headers: { 'Authorization': pexelsKey }
          });
          if (pxResp.ok) {
            const pxData = await pxResp.json();
            const videos = (pxData.videos || []).map(v => {
              // Prefer HD files, sorted by quality (hd first, then sd)
              const allFiles = (v.video_files || [])
                .filter(f => f.quality === 'hd' || f.quality === 'sd')
                .sort((a, b) => (b.quality === 'hd' ? 1 : 0) - (a.quality === 'hd' ? 1 : 0));
              return {
                id: v.id,
                duration: v.duration,
                thumbnail: v.image,
                url: v.url,
                videoFiles: allFiles.slice(0, 2)
                  .map(f => ({ quality: f.quality, link: f.link, width: f.width, height: f.height })),
                user: v.user ? v.user.name : 'Pexels'
              };
            });

            // Auto-select the best (first) result
            if (videos.length > 0) {
              sceneResult.video = videos[0];
              sceneResult.alternatives = videos.slice(1, 4);
            }
          }
        } catch (e) {
          console.error('Pexels API error for scene:', scene.search_query, e.message);
        }
      }

      autoSelectedScenes.push(sceneResult);
    }

    const hasPexels = !!pexelsKey;
    res.json({
      success: true,
      autoMode: true,
      scenes: autoSelectedScenes,
      message: hasPexels ? null : 'Add PEXELS_API_KEY for auto video previews. Browse Pexels links for now.'
    });
  } catch (error) {
    console.error('B-Roll suggestions error:', error);
    res.status(500).json({ error: 'Failed to get B-Roll suggestions' });
  }
});

// === Content Calendar API ===
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = end || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
    const entries = await calendarOps.getByUserId(req.user.id, startDate, endDate);
    res.json({ success: true, entries });
  } catch (error) {
    console.error('Calendar fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

// Phase 2b — POST /shorts/api/publish-moment
// Unified Smart Shorts -> Connected Account publish bridge.
// Body: { analysisId, momentIndex, connectionId, title, caption,
//         description, scheduledAt? }
// If scheduledAt is in the future -> creates a calendar_entries row with
//   auto_publish=true and connection_id set. The existing
//   utils/schedulePublisher cron picks it up and runs publishToConnection
//   when the scheduled time arrives.
// Otherwise -> renders the clip (if not already on disk) and calls
//   publishToConnection immediately.
router.post('/api/publish-moment', requireAuth, async (req, res) => {
  try {
    const { analysisId, momentIndex, connectionId, title, caption, description, scheduledAt } = req.body || {};
    if (!analysisId || momentIndex == null) return res.status(400).json({ success: false, error: 'analysisId and momentIndex are required' });
    if (!connectionId) return res.status(400).json({ success: false, error: 'connectionId is required' });

    // Look up the analysis so we can synthesize a clip render request if needed.
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) return res.status(404).json({ success: false, error: 'Analysis not found' });
    const moment = analysis.moments && analysis.moments[momentIndex];
    if (!moment) return res.status(404).json({ success: false, error: 'Moment not found' });

    // Validate the connection belongs to this user before we burn time on a render.
    const { getConnectionById, publishToConnection } = require('../utils/connections');
    const acct = await getConnectionById(req.user.id, connectionId);
    if (!acct) return res.status(404).json({ success: false, error: 'Connection not found' });

    // Schedule path — defer to the calendar/schedulePublisher infra.
    if (scheduledAt) {
      const when = new Date(scheduledAt);
      if (!isNaN(when.getTime()) && when.getTime() > Date.now() + 60_000) {
        const dateStr = when.toISOString().slice(0, 10);
        const timeStr = String(when.getUTCHours()).padStart(2, '0') + ':' + String(when.getUTCMinutes()).padStart(2, '0');
        const entry = await calendarOps.create({
          userId: req.user.id,
          title: title || moment.title || ('Viral moment ' + (momentIndex + 1)),
          platform: acct.platform,
          scheduledDate: dateStr,
          scheduledTime: timeStr,
          contentText: caption || description || '',
          analysisId, momentIndex,
          // Forward the schedule-modal extras (notification + notes) added
          // when we merged 'Schedule This Moment' into 'Publish This Moment'.
          notes: req.body.notes || '',
          color: '#6c5ce7',
          reminderEmail: req.body.reminderEmail || '',
          reminderMinutes: parseInt(req.body.reminderMinutes, 10) || 0,
          autoPublish: true,
          // schedulePublisher renders the clip if clipFilename is empty; setting
          // it later via a /shorts/clip call would also work, but leaving it
          // blank means the cron will skip until the clip is rendered. So we
          // require the caller to have downloaded the clip already, OR we
          // can leave clipFilename blank and the cron will retry until the
          // user clicks Download Clip.
          clipFilename: '',
          connectionId: acct.id
        });
        return res.json({ success: true, scheduled: true, scheduledFor: dateStr + ' ' + timeStr, entryId: entry.id });
      }
    }

    // Post-now path — we need a media path on disk. Reuse the most recent
    // rendered clip for this analysis/moment if present; otherwise return a
    // clear error so the UI can prompt the user to click Download Clip
    // first. (Rendering synchronously here would block the request for
    // 30-60 seconds.)
    const fs = require('fs');
    const path = require('path');
    const CLIPS_DIR = path.join('/tmp', 'repurpose-clips');
    let mediaPath = null;
    try {
      const files = fs.readdirSync(CLIPS_DIR);
      const candidates = files
        .filter(f => f.endsWith('.mp4') && f.includes(analysisId))
        .map(f => ({ f, full: path.join(CLIPS_DIR, f), mtime: fs.statSync(path.join(CLIPS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      // Prefer a clip that explicitly encodes this moment index (new naming
      // from the same commit). Otherwise, accept any clip for this analysis —
      // handles older clips that were rendered before the m<idx> tag landed.
      const tag = '_m' + momentIndex + '_';
      const exact = candidates.find(c => c.f.includes(tag));
      const pick = exact || candidates[0];
      if (pick && fs.statSync(pick.full).size > 10000) mediaPath = pick.full;
    } catch (_) {}
    if (!mediaPath) {
      return res.status(409).json({ success: false, error: 'No rendered clip found. Click "Download Clip" first to render the file, then try Publish again.' });
    }

    const result = await publishToConnection(req.user.id, connectionId, {
      title: title || moment.title || ('Viral moment ' + (momentIndex + 1)),
      description: description || caption || moment.description || '',
      caption: caption || moment.description || '',
      mediaPath
    });
    if (!result.success) return res.status(400).json(result);
    return res.json({ success: true, platform: acct.platform, externalId: result.externalId || null });
  } catch (err) {
    console.error('[POST /shorts/api/publish-moment]', err.message);
    res.status(500).json({ success: false, error: 'Publish failed' });
  }
});

router.post('/calendar', requireAuth, async (req, res) => {
  try {
    const { title, platform, scheduledDate, scheduledTime, contentText, analysisId, momentIndex, notes, color, reminderEmail, reminderMinutes } = req.body;
    if (!title || !scheduledDate) return res.status(400).json({ error: 'Title and date required' });
    const entry = await calendarOps.create({
      userId: req.user.id, title, platform, scheduledDate, scheduledTime, contentText, analysisId, momentIndex, notes, color,
      reminderEmail: reminderEmail || '', reminderMinutes: reminderMinutes || 0
    });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Calendar create error:', error);
    res.status(500).json({ error: 'Failed to create calendar entry' });
  }
});

router.put('/calendar/:id', requireAuth, async (req, res) => {
  try {
    const entry = await calendarOps.update(req.params.id, req.user.id, req.body);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Calendar update error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

router.delete('/calendar/:id', requireAuth, async (req, res) => {
  try {
    await calendarOps.delete(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

router.post('/thumbnail', requireAuth, checkPlanLimit('thumbnailsPerMonth'), async (req, res) => {
  try {
    if (!ffmpegAvailable) {
      return res.status(503).json({ error: 'ffmpeg is not available on this server.' });
    }

    const { analysisId, momentIndex, style, titleText, titleColor, bgColor, fontSize } = req.body;

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const videoId = extractVideoId(analysis.video_url);
    if (!videoId) return res.status(400).json({ error: 'Invalid video URL' });

    // Fetch brand kit for colors
    let brandKit = null;
    try { brandKit = await brandKitOps.getByUserId(req.user.id); } catch (e) {}

    const thumbTitle = (titleText || moment.title || 'Viral Moment').substring(0, 60);
    const thumbColor = titleColor || (brandKit && brandKit.primary_color) || '#FFFFFF';
    const thumbBg = bgColor || '#000000';
    const thumbFontSize = fontSize || 72;
    const thumbStyle = style || 'gradient';
    const thumbAnalysisTag = `a${req.body.analysisId || 'unknown'}`;
    const filename = `thumb_${thumbAnalysisTag}_${Date.now()}.jpg`;
    const outputPath = path.join(CLIPS_DIR, filename);

    // Parse time to get a frame
    const rangeParts = (moment.timeRange || '').split('-');
    const parseTime = (str) => {
      const parts = (str || '').trim().split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTime(rangeParts[0]);
    // Use a point slightly into the moment for a better frame
    const frameSec = startSec + 2;

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    res.json({ success: true, status: 'processing', filename });

    // Background processing
    (async () => {
      try {
        // Download a short segment for frame extraction
        const tempVideo = outputPath + '.temp.mkv';
        try { fs.unlinkSync(tempVideo); } catch(e) {}

        // Try to download just a few seconds
        let ytdlpPath = 'yt-dlp';
        try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (e) {
          // If yt-dlp not available, use YouTube thumbnail API as fallback
          console.log('  yt-dlp not available for thumbnail, using YouTube API thumbnail');
          // Generate thumbnail from YouTube's static image
          const https = require('https');
          const thumbUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
          const tempImg = outputPath + '.temp.jpg';

          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(tempImg);
            https.get(thumbUrl, (response) => {
              if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              } else {
                // Fallback to mqdefault
                https.get(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, (r2) => {
                  r2.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                });
              }
            }).on('error', reject);
          });

          // Apply text overlay to downloaded thumbnail
          await applyThumbnailOverlay(tempImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
          try { fs.unlinkSync(tempImg); } catch(e) {}
          return;
        }

        // Download video segment
        const runCmd = (cmd, args, opts = {}) => {
          return new Promise((resolve, reject) => {
            const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            let settled = false;
            const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('error', e => settle(reject, e));
            proc.on('close', code => code === 0 ? settle(resolve, { stdout, stderr }) : settle(reject, new Error(stderr.slice(-300))));
            const timer = opts.timeout ? setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} settle(reject, new Error('timeout')); }, opts.timeout) : null;
          });
        };

        try {
          await runCmd(ytdlpPath, [
            '--no-playlist', '-f', 'bestvideo[height<=1920]/best[height<=1920]/best',
            '--merge-output-format', 'mkv', '-o', tempVideo,
            '--no-part', '--force-overwrites',
            ...getYoutubeCookiesArgs(),
            ...getYoutubeProxyArgs(),
            ...YTDLP_COMMON_ARGS,
            '--download-sections', `*${frameSec}-${frameSec + 5}`,
            videoUrl
          ], { timeout: 120000 });
        } catch (dlErr) {
          // download-sections might not be supported, download full and seek
          try {
            await runCmd(ytdlpPath, [
              '--no-playlist', '-f', 'bestvideo[height<=1920]/best[height<=1920]/best',
              '--merge-output-format', 'mkv', '-o', tempVideo,
              '--no-part', '--force-overwrites',
              ...getYoutubeCookiesArgs(),
              ...getYoutubeProxyArgs(),
              ...YTDLP_COMMON_ARGS,
              videoUrl
            ], { timeout: 180000 });
          } catch (e2) {
            console.error('  Thumbnail: video download failed, falling back to YT thumbnail');
            // Fallback: use YouTube thumbnail
            const https = require('https');
            const tempImg = outputPath + '.temp.jpg';
            await new Promise((resolve, reject) => {
              const file = fs.createWriteStream(tempImg);
              https.get(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, (response) => {
                if (response.statusCode === 200) {
                  response.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                } else {
                  https.get(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, (r2) => {
                    r2.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                  });
                }
              }).on('error', reject);
            });
            await applyThumbnailOverlay(tempImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
            try { fs.unlinkSync(tempImg); } catch(e) {}
            return;
          }
        }

        // Find actual download
        let actualVideo = tempVideo;
        if (!fs.existsSync(tempVideo)) {
          const base = outputPath + '.temp';
          for (const ext of ['.mkv', '.mp4', '.webm']) {
            if (fs.existsSync(base + ext)) { actualVideo = base + ext; break; }
          }
        }

        if (!fs.existsSync(actualVideo)) {
          console.error('  Thumbnail: downloaded video not found');
          return;
        }

      // Extract frame at timestamp
      const frameImg = outputPath.replace(/\.jpg$/, '') + '.frame.jpg';
      let frameExtracted = false;
      try {
        await runCmd(ffmpegPath, [
          '-y', '-ss', String(frameSec), '-i', actualVideo,
          '-frames:v', '1', '-q:v', '2',
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
          frameImg
        ], { timeout: 30000 });
        frameExtracted = fs.existsSync(frameImg);
      } catch (e) {
        // Try without seek (beginning of video)
        try {
          await runCmd(ffmpegPath, [
            '-y', '-i', actualVideo, '-frames:v', '1', '-q:v', '2',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
            frameImg
          ], { timeout: 30000 });
          frameExtracted = fs.existsSync(frameImg);
        } catch (e2) {
          console.error('  Frame extraction failed:', e2.message);
        }
      }

      try { fs.unlinkSync(actualVideo); } catch(e) {}

      if (frameExtracted) {
        // Apply text overlay to extracted frame
        await applyThumbnailOverlay(frameImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
        try { fs.unlinkSync(frameImg); } catch(e) {}
      } else {
        // Fallback: use YouTube thumbnail image instead of video frame
        console.log('  Frame extraction failed, falling back to YouTube thumbnail');
        const https2 = require('https');
        const fallbackImg = outputPath + '.fallback.jpg';
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(fallbackImg);
          https2.get(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, (response) => {
            if (response.statusCode === 200) {
              response.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            } else {
              https2.get(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, (r2) => {
                r2.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              });
            }
          }).on('error', reject);
        });
        await applyThumbnailOverlay(fallbackImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
        try { fs.unlinkSync(fallbackImg); } catch(e) {}
      }

        console.log(`  Thumbnail generated: ${filename}`);
      } catch (err) {
        console.error('  Thumbnail generation failed:', err.message);
        try { fs.writeFileSync(outputPath + '.error', err.message); } catch(e) {}
      }
    })();

  } catch (error) {
    console.error('Error generating thumbnail:', error);
    res.status(500).json({ error: 'Failed to start thumbnail generation' });
  }
});

// Helper: Apply text overlay to create a styled thumbnail
async function applyThumbnailOverlay(inputImg, outputPath, title, titleColor, bgColor, fontSize, style, brandKit) {
  const runCmd = (cmd, args, opts = {}) => {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      let settled = false;
      const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('error', e => settle(reject, e));
      proc.on('close', code => code === 0 ? settle(resolve, { stdout, stderr }) : settle(reject, new Error(stderr.slice(-300))));
      const timer = opts.timeout ? setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} settle(reject, new Error('timeout')); }, opts.timeout) : null;
    });
  };

  const safeTitle = title.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
  const cleanColor = (titleColor || '#FFFFFF').replace('#', '');
  const wmText = (brandKit && brandKit.watermark_text) ? brandKit.watermark_text.replace(/'/g, "'\\''").replace(/:/g, '\\:') : '';

  // Split title into lines if too long (max ~25 chars per line)
  const words = title.split(' ');
  let lines = [];
  let currentLine = '';
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > 25) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine = (currentLine + ' ' + word).trim();
    }
  }
  if (currentLine) lines.push(currentLine.trim());

  // Build drawtext filter chain for each line
  const lineHeight = Math.round(fontSize * 1.3);
  const totalTextHeight = lines.length * lineHeight;
  const startY = Math.round((1080 - totalTextHeight) / 2);

  let textFilters = lines.map((line, i) => {
    const safeLine = line.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
    const y = startY + (i * lineHeight);
    return `drawtext=text='${safeLine.toUpperCase()}':fontsize=${fontSize}:fontcolor=${cleanColor}:` +
           `borderw=4:bordercolor=black:font=Liberation Sans Bold:x=(w-text_w)/2:y=${y}`;
  }).join(',');

  let filterStr;
  if (style === 'dark') {
    // Dark overlay + centered text
    filterStr = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
                `colorbalance=bs=-0.3:gs=-0.3:rs=-0.3,eq=brightness=-0.3:contrast=1.2,${textFilters}`;
  } else if (style === 'border') {
    // Colored border frame + text
    const borderColor = (brandKit && brandKit.primary_color) || '#FF0050';
    const bc = borderColor.replace('#', '');
    filterStr = `scale=1860:1020:force_original_aspect_ratio=decrease,pad=1920:1080:30:30:${bc},${textFilters}`;
  } else if (style === 'split') {
    // Left half colored, right half video frame, text on left
    filterStr = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
                `drawbox=x=0:y=0:w=iw/2:h=ih:color=${cleanColor}@0.85:t=fill,${textFilters}`;
    } else {
      // gradient: subtle bottom overlay + text positioned in lower third
      const gradientStartY = Math.round(1080 * 0.73);
  let textFilters = lines.map((line, i) => {
    const safeLine = line.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
    const y = gradientStartY + (i * lineHeight);
    return `drawtext=text='${safeLine.toUpperCase()}':fontsize=${fontSize}:fontcolor=${cleanColor}:` +
           `borderw=4:bordercolor=black:font=Liberation Sans Bold:x=(w-text_w)/2:y=${y}`;
  }).join(',');
      filterStr = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
        `drawbox=x=0:y=ih*3/4:w=iw:h=ih/4:color=black@0.4:t=fill,${textFilters}`;
    }

  // Add watermark if brand kit has one
  if (wmText) {
    const wmColor = (brandKit.primary_color || '#FFFFFF').replace('#', '');
    filterStr += `,drawtext=text='${wmText}':fontsize=32:fontcolor=${wmColor}@0.5:x=w-tw-40:y=h-th-30:font=Liberation Sans`;
  }

  await runCmd(ffmpegPath, [
    '-y', '-i', inputImg, '-vf', filterStr,
    '-q:v', '2', '-frames:v', '1', outputPath
  ], { timeout: 30000 });
}

// GET /thumbnail/status/:filename - Check if thumbnail is ready
router.get('/thumbnail/status/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CLIPS_DIR, filename);
  const errorPath = filePath + '.error';

  if (fs.existsSync(errorPath)) {
    const msg = fs.readFileSync(errorPath, 'utf8');
    res.json({ ready: false, failed: true, message: msg });
  } else if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    if (stats.size > 1000) {
      res.json({ ready: true, size: stats.size, filename });
    } else {
      res.json({ ready: false, message: 'Generating...' });
    }
  } else {
    res.json({ ready: false, message: 'Generating thumbnail...' });
  }
});

// GET /thumbnail/download/:filename - Download generated thumbnail
router.get('/thumbnail/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.jpg') && !filename.endsWith('.png')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(CLIPS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Thumbnail not found' });
  }
  res.download(filePath, filename);
});

// POST /thumbnail-ai - Generate an AI thumbnail using DALL-E
router.post('/thumbnail-ai', requireAuth, checkPlanLimit('thumbnailsPerMonth'), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OpenAI API key not configured.' });
    }

    const { analysisId, momentIndex, customPrompt, aspectRatio } = req.body;

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    // Fetch brand kit for style context
    let brandKit = null;
    try { brandKit = await brandKitOps.getByUserId(req.user.id); } catch (e) {}

    const thumbTitle = (moment.title || 'Viral Moment').substring(0, 60);
    const thumbHook = (moment.hook || '').substring(0, 100);
    const ratio = aspectRatio || 'landscape'; // landscape (1792x1024) or portrait (1024x1792) or square (1024x1024)

    const dalleSize = ratio === 'portrait' ? '1024x1792' : ratio === 'square' ? '1024x1024' : '1792x1024';

    const filename = `aithumb_a${analysisId}_${Date.now()}.png`;
    const outputPath = path.join(CLIPS_DIR, filename);

    res.json({ success: true, status: 'processing', filename });

    // Background processing
    (async () => {
      try {
        // Build a smart prompt based on moment content
        let dallePrompt;
        if (customPrompt && customPrompt.trim()) {
          dallePrompt = customPrompt.trim().substring(0, 900);
        } else {
          // Use GPT to craft an optimal DALL-E prompt from the moment
          const brandContext = brandKit ? `Brand colors: ${brandKit.primary_color || '#6c5ce7'}, ${brandKit.secondary_color || '#FF0050'}. Brand name: ${brandKit.watermark_text || ''}.` : '';
          const promptResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 300,
            messages: [
              { role: 'system', content: `You are a YouTube thumbnail designer. Given a video moment title and hook, generate a DALL-E image prompt for an eye-catching, click-worthy thumbnail. The thumbnail should be bold, vibrant, and attention-grabbing. Do NOT include any text or words or letters in the image — only visual elements. Focus on expressive imagery, dramatic lighting, bold colors, and visual metaphors that relate to the topic. ${brandContext}` },
              { role: 'user', content: `Moment title: "${thumbTitle}"\nHook: "${thumbHook}"\nVideo topic: "${(analysis.video_title || '').substring(0, 100)}"\n\nGenerate a DALL-E prompt for a stunning thumbnail image. Remember: NO TEXT in the image.` }
            ]
          });
          dallePrompt = (promptResponse.choices[0]?.message?.content || '').trim().substring(0, 900);
        }

        if (!dallePrompt) {
          dallePrompt = `A vibrant, eye-catching YouTube thumbnail background about "${thumbTitle}". Bold colors, dramatic lighting, no text or letters.`;
        }

        console.log(`  AI Thumbnail: generating with DALL-E for "${thumbTitle}" (${dalleSize})`);
        console.log(`  Prompt: ${dallePrompt.substring(0, 100)}...`);

            // Generate with DALL-E 3 (with retry on content policy rejection)
            let imageResponse;
            let retries = 0;
            const maxRetries = 2;
            while (retries <= maxRetries) {
              try {
                imageResponse = await openai.images.generate({
                  model: 'dall-e-3',
                  prompt: dallePrompt,
                  n: 1,
                  size: dalleSize,
                  quality: 'standard',
                  response_format: 'url'
                });
                break;
              } catch (dalleErr) {
                retries++;
                console.error(`  DALL-E attempt ${retries} failed: ${dalleErr.message}`);
                if (retries > maxRetries) throw dalleErr;
                dallePrompt = `A vibrant, eye-catching YouTube thumbnail background. Bold colors, dramatic lighting, professional graphic design. Abstract modern design with geometric shapes and gradients. No text, no faces, no people. Clean and striking.`;
                console.log('  Retrying with simplified prompt...');
              }
            }

        const imageUrl = imageResponse.data[0]?.url;
        if (!imageUrl) throw new Error('No image URL returned from DALL-E');

        // Download the generated image
        const https = require('https');
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(outputPath);
          https.get(imageUrl, (response) => {
            if (response.statusCode === 200) {
              response.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            } else {
              reject(new Error(`Failed to download: ${response.statusCode}`));
            }
          }).on('error', reject);
        });

        // If ffmpeg is available, overlay the title text on the AI image
        if (ffmpegAvailable) {
          const tempAiImg = outputPath + '.temp_ai.png';
          fs.renameSync(outputPath, tempAiImg);

          const titleColor = (brandKit && brandKit.primary_color) || '#FFFFFF';
          await applyThumbnailOverlay(tempAiImg, outputPath, thumbTitle, titleColor, '#000000', 72, 'gradient', brandKit);
          try { fs.unlinkSync(tempAiImg); } catch(e) {}
        }

        console.log(`  AI Thumbnail generated: ${filename}`);
      } catch (err) {
        console.error('  AI Thumbnail generation failed:', err.message);
        try { fs.writeFileSync(outputPath + '.error', err.message); } catch(e) {}
      }
    })();

  } catch (error) {
    console.error('Error generating AI thumbnail:', error);
    res.status(500).json({ error: 'Failed to start AI thumbnail generation' });
  }
});

// POST /thumbnail-ab - Generate 3 AI thumbnail variants for A/B testing
router.post('/thumbnail-ab', requireAuth, requireFeature('thumbnailAB'), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OpenAI API key not configured.' });
    }

    const { analysisId, momentIndex } = req.body;

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    let brandKit = null;
    try { brandKit = await brandKitOps.getByUserId(req.user.id); } catch (e) {}

    const thumbTitle = (moment.title || 'Viral Moment').substring(0, 60);
    const thumbHook = (moment.hook || '').substring(0, 100);
    const videoTopic = (analysis.video_title || '').substring(0, 100);
    const brandContext = brandKit ? `Brand colors: ${brandKit.primary_color || '#6c5ce7'}, ${brandKit.secondary_color || '#FF0050'}.` : '';

    const batchId = `ab_${analysisId}_${Date.now()}`;
    const filenames = [
      `${batchId}_v1.png`,
      `${batchId}_v2.png`,
      `${batchId}_v3.png`
    ];

    res.json({ success: true, status: 'processing', batchId, filenames });

    // Generate 3 variants in parallel with different visual styles
    const variantStyles = [
      { name: 'Bold & Dramatic', instruction: 'Create a BOLD, high-contrast, dramatic composition with intense lighting, deep shadows, and vivid saturated colors. Use cinematic angles and powerful visual impact.' },
      { name: 'Clean & Modern', instruction: 'Create a CLEAN, minimalist, modern composition with bright colors, smooth gradients, and a professional polished look. Use geometric shapes and contemporary design elements.' },
      { name: 'Energetic & Fun', instruction: 'Create a VIBRANT, energetic, playful composition with bright neon colors, dynamic angles, motion effects, and an exciting youthful feel. Use bold pop-art or comic-inspired elements.' }
    ];

    (async () => {
      const promises = variantStyles.map(async (variant, i) => {
        try {
          // Generate unique prompt per variant
          const promptResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 300,
            messages: [
              { role: 'system', content: `You are a YouTube thumbnail designer. Generate a DALL-E image prompt for a ${variant.name} style thumbnail. ${variant.instruction} Do NOT include any text, words, or letters in the image — only visual elements. ${brandContext}` },
              { role: 'user', content: `Topic: "${videoTopic}"\nMoment: "${thumbTitle}"\nHook: "${thumbHook}"\n\nGenerate a DALL-E prompt. NO TEXT in the image.` }
            ]
          });

          const dallePrompt = (promptResponse.choices[0]?.message?.content || '').trim().substring(0, 900) ||
            `A ${variant.name.toLowerCase()} YouTube thumbnail about "${thumbTitle}". No text or letters.`;

          console.log(`  A/B Thumbnail V${i+1} (${variant.name}): generating...`);

          const imageResponse = await openai.images.generate({
            model: 'dall-e-3',
            prompt: dallePrompt,
            n: 1,
            size: '1792x1024',
            quality: 'standard',
            response_format: 'url'
          });

          const imageUrl = imageResponse.data[0]?.url;
          if (!imageUrl) throw new Error('No image URL');

          const outputPath = path.join(CLIPS_DIR, filenames[i]);
          const https = require('https');
          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(outputPath);
            https.get(imageUrl, (response) => {
              if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              } else reject(new Error(`HTTP ${response.statusCode}`));
            }).on('error', reject);
          });

          // Overlay title text if ffmpeg available
          if (ffmpegAvailable) {
            const tempImg = outputPath + '.temp_ab.png';
                fs.renameSync(outputPath, tempImg);
                            const titleColor = (brandKit && brandKit.primary_color) || '#FFFFFF';
            await applyThumbnailOverlay(tempImg, outputPath, thumbTitle, titleColor, '#000000', 72, 'gradient', brandKit);
            try { fs.unlinkSync(tempImg); } catch(e) {}
          }

          console.log(`  A/B Thumbnail V${i+1} done: ${filenames[i]}`);
        } catch (err) {
          console.error(`  A/B Thumbnail V${i+1} failed:`, err.message);
          const outputPath = path.join(CLIPS_DIR, filenames[i]);
          try { fs.writeFileSync(outputPath + '.error', err.message); } catch(e) {}
        }
      });

      await Promise.all(promises);
      // Write a completion marker
      fs.writeFileSync(path.join(CLIPS_DIR, `${batchId}_done`), 'complete');
      console.log(`  A/B Thumbnail batch done: ${batchId}`);
    })();

  } catch (error) {
    console.error('Error generating A/B thumbnails:', error);
    res.status(500).json({ error: 'Failed to start A/B thumbnail generation' });
  }
});

// GET /thumbnail-ab/status/:batchId - Check A/B batch status
router.get('/thumbnail-ab/status/:batchId', requireAuth, (req, res) => {
  const batchId = req.params.batchId.replace(/[^a-zA-Z0-9_-]/g, '');
  const donePath = path.join(CLIPS_DIR, `${batchId}_done`);
  const filenames = [`${batchId}_v1.png`, `${batchId}_v2.png`, `${batchId}_v3.png`];

  const variants = filenames.map((fn, i) => {
    const fp = path.join(CLIPS_DIR, fn);
    const errorPath = fp + '.error';
    if (fs.existsSync(errorPath)) {
      return { variant: i + 1, ready: false, failed: true, message: fs.readFileSync(errorPath, 'utf8') };
    } else if (fs.existsSync(fp) && fs.statSync(fp).size > 1000) {
      return { variant: i + 1, ready: true, filename: fn };
    } else {
      return { variant: i + 1, ready: false };
    }
  });

  const allDone = fs.existsSync(donePath);
  const readyCount = variants.filter(v => v.ready).length;

  res.json({ allDone, readyCount, totalVariants: 3, variants });
});

// POST /clip - Generate a video clip for a specific moment
router.post('/clip', requireAuth, checkPlanLimit('clipsPerMonth'), async (req, res) => {
  try {
    if (!ytdl || !ffmpegAvailable) {
      return res.status(503).json({ error: 'Video clipping is not available on this server. ffmpeg or ytdl-core is missing.' });
    }

    let { analysisId, momentIndex, includeCaptions, clipStyle, captionLanguage, captionStyle, applyBrandKit, selectedBrandTemplateId } = req.body;

    if (!analysisId || momentIndex === undefined) {
      return res.status(400).json({ error: 'Analysis ID and moment index are required' });
    }

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Fetch user's brand kit for watermark — but only if the user opted in
    // for this clip via the per-moment "Brand Template" checkbox.
    let brandKit = null;
    if (applyBrandKit !== false) {
      try {
        brandKit = await brandKitOps.getByUserId(req.user.id);
      } catch (e) { console.log('Brand kit fetch skipped:', e.message); }
    } else {
      console.log('  Brand template explicitly disabled for this clip');
    }

    // If the user has selected a Brand Template via the /shorts Brand Kit
    // modal, look it up from the cookie store (brand-templates.js writes
    // them there) and let it influence this clip. Today we use it to set
    // the default caption style; the logo overlay during ffmpeg encode is
    // a follow-up step. Only honored when applyBrandKit isn't explicitly
    // disabled, so the per-moment checkbox still controls it.
    let selectedBrandTemplate = null;
    if (applyBrandKit !== false && selectedBrandTemplateId) {
      try {
        const raw = req.cookies && req.cookies.brandTemplates;
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            selectedBrandTemplate = list.find(t => t && t.id === selectedBrandTemplateId) || null;
          }
        }
      } catch (e) {
        console.log('  Selected brand template lookup failed:', e.message);
      }
      if (selectedBrandTemplate) {
        console.log(`  Brand Template selected: "${selectedBrandTemplate.name || selectedBrandTemplate.id}" (caption: ${selectedBrandTemplate.captionStyle || 'n/a'}, logo: ${selectedBrandTemplate.logoFilename ? 'yes' : 'no'})`);

        // The template is the active brand state at export time — its
        // captionStyle ALWAYS wins over the dropdown. Previously this was
        // gated on the dropdown being empty, but the dropdown is never
        // empty (it defaults to 'classic'), so the template was getting
        // silently ignored. The same goes for logo position/size below
        // (already pulled from the template in the ffmpeg builder).
        if (selectedBrandTemplate.captionStyle) {
          if (captionStyle && captionStyle !== selectedBrandTemplate.captionStyle) {
            console.log(`  → overriding caption style "${captionStyle}" with template's "${selectedBrandTemplate.captionStyle}"`);
          } else {
            console.log(`  → using template caption style: ${selectedBrandTemplate.captionStyle}`);
          }
          captionStyle = selectedBrandTemplate.captionStyle;
        }

        // Suppress the brand_kits watermark text when a template is
        // active — otherwise the old watermark string from the user's
        // brand_kits row layers on top of the new template's logo and
        // looks like an "outdated brand design." The template IS the
        // brand for this export.
        if (brandKit) {
          console.log('  → suppressing brand_kits watermark while template is active');
          brandKit = Object.assign({}, brandKit, { watermark_text: '' });
        }
      } else {
        console.log(`  Selected brand template id "${selectedBrandTemplateId}" not found in cookie — skipping`);
      }
    }

    // Parse moments
    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }

    const moment = moments[momentIndex];
    if (!moment) {
      return res.status(404).json({ error: 'Moment not found' });
    }

    // Parse time range
    const rangeParts = (moment.timeRange || '').split('-');
    const parseTime = (str) => {
      const parts = (str || '').trim().split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTime(rangeParts[0]);
    const endSec = rangeParts[1] ? parseTime(rangeParts[1]) : startSec + 60;
    const duration = Math.max(endSec - startSec, 5); // At least 5 seconds

    // Extract video ID
    const videoId = extractVideoId(analysis.video_url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid video URL in analysis' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const safeTitle = (moment.title || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
    const analysisTag = `a${req.body.analysisId || 'unknown'}`;
    const momentTag = `m${momentIndex}`;
    // Filename encodes analysisId + moment index so /shorts/api/publish-moment
    // can find the right pre-rendered clip on disk later.
    const filename = `${safeTitle}_${analysisTag}_${momentTag}_${Date.now()}.mp4`;
    const outputPath = path.join(CLIPS_DIR, filename);
    const tempOutputPath = outputPath + '.encoding.mp4'; // Encode to temp file, rename when done

    // Send initial response
    res.json({
      success: true,
      status: 'processing',
      message: 'Generating clip...',
      filename
    });

    // Write progress to a file so the status endpoint can report it
    const progressPath = outputPath + '.progress';
    const writeProgress = (msg) => {
      try { fs.writeFileSync(progressPath, msg); } catch (e) {}
      console.log(`  [${filename}] ${msg}`);
    };
    const writeError = (msg) => {
      try { fs.unlinkSync(progressPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch (e) {}
      console.error(`  [${filename}] ERROR: ${msg}`);
    };

    // Helper: run a command with spawn (non-blocking, keeps event loop alive)
    const runCommand = (cmd, args, options = {}) => {
      return new Promise((resolve, reject) => {
        const cmdLabel = path.basename(cmd);
        console.log(`  Running ${cmdLabel}: ${args.slice(0, 4).join(' ')}...`);
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          const pctMatch = data.toString().match(/(\d+\.?\d*)%/);
          if (pctMatch) writeProgress(`Downloading: ${Math.round(parseFloat(pctMatch[1]))}%`);
        });
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          // yt-dlp sends progress to stderr when piped
          const pctMatch = data.toString().match(/(\d+\.?\d*)%/);
          if (pctMatch) writeProgress(`Downloading: ${Math.round(parseFloat(pctMatch[1]))}%`);
          // ffmpeg progress
          const timeMatch = data.toString().match(/time=(\d+:\d+:\d+)/);
          if (timeMatch) writeProgress(`Encoding: ${timeMatch[1]}`);
        });
        proc.on('error', (err) => settle(reject, new Error(`${cmdLabel} process error: ${err.message}`)));
        proc.on('close', (code, signal) => {
          if (code === 0) settle(resolve, { stdout, stderr });
          else settle(reject, new Error(`${cmdLabel} exit ${code}${signal ? '/'+signal : ''}: ${stderr.slice(-500)}`));
        });

        // Timeout: kill process
        const timer = options.timeout ? setTimeout(() => {
          console.error(`  ${cmdLabel} timed out after ${options.timeout/1000}s`);
          try { proc.kill('SIGKILL'); } catch(e) {}
          settle(reject, new Error(`${cmdLabel} timed out after ${options.timeout/1000}s`));
        }, options.timeout) : null;
      });
    };

    // Process in background (non-blocking - keeps event loop alive for health checks)
    (async () => {
      const timeout = setTimeout(() => {
        writeError('Clip generation timed out after 8 minutes. Try a shorter moment or one closer to the start.');
      }, 480000);

      try {
        writeProgress('Downloading video...');

        // Check if yt-dlp is available
        let ytdlpPath = 'yt-dlp';
        try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (e) {
          clearTimeout(timeout);
          writeError('yt-dlp is not installed on this server');
          return;
        }

        // === STEP 1: Download full video (shared cache — one download per video) ===
        console.log(`  Downloading video: start=${startSec}s, dur=${duration}s`);

        let actualDownload;
        try {
          actualDownload = await getOrDownloadVideo(videoId, videoUrl, ytdlpPath, writeProgress);
        } catch (dlErr) {
          clearTimeout(timeout);
          // getOrDownloadVideo throws a verbose message listing each
          // downloader's specific failure (Cobalt / yt-dlp / ytdl-core)
          // plus a cookies hint. Pass it through unchanged so the user
          // sees the actionable diagnosis, not a generic 'try again.'
          //
          // The '[v3]' tag lets Albert verify at a glance that this
          // commit is actually live on dev — if the tag isn't in the
          // error message, the deploy hasn't propagated yet.
          var rawMsg = (dlErr && dlErr.message) ? String(dlErr.message) : '';
          var detail = rawMsg
            ? '[v3] ' + rawMsg
            : '[v3] Download path threw without a message — check Railway logs for the stack trace.';
          console.error('  Video download failed:', detail);
          writeError(detail);
          return;
        }

        const dlSize = fs.statSync(actualDownload).size;
        console.log(`  Using video: ${(dlSize / 1024 / 1024).toFixed(1)}MB`);

        // === STEP 2: ffmpeg encode (non-blocking spawn) ===
        // Blur-background style: full video centered with blurred background
        // [0:v] = blurred background scaled to fill 1080x1920
        // [1:v] = foreground video scaled to fit within 1080x1920 (preserving aspect ratio)
        // Overlay foreground centered on blurred background
        writeProgress('Creating vertical clip...');

        // === Generate captions if requested ===
        let assFilePath = null;
        if (includeCaptions && analysis.transcript) {
          try {
            console.log('  Generating captions...');
            let segments = parseTranscriptToSegments(analysis.transcript);
            console.log(`  Parsed ${segments.length} transcript segments`);

            // Translate captions if a non-English language is selected
            const lang = captionLanguage || 'en';
            if (lang !== 'en' && SUPPORTED_LANGUAGES[lang]) {
              console.log(`  Translating captions to ${SUPPORTED_LANGUAGES[lang]}...`);
              const clipSegments = segments.filter(seg => seg.offsetSec >= startSec && seg.offsetSec < startSec + duration);
              const translated = await translateSegments(clipSegments, lang);
              // Replace matching segments with translations
              segments = segments.map(seg => {
                const match = translated.find(t => t.offsetSec === seg.offsetSec);
                return match || seg;
              });
              console.log(`  Captions translated to ${SUPPORTED_LANGUAGES[lang]}`);
            }

            const assContent = generateASSSubtitles(segments, startSec, duration, captionStyle);
            if (assContent) {
              assFilePath = outputPath + '.ass';
              fs.writeFileSync(assFilePath, assContent, 'utf8');
              console.log(`  ASS subtitle file written: ${assFilePath}`);
            } else {
              console.log('  No caption segments found for this time range');
            }
          } catch (captionErr) {
            console.error('  Caption generation failed:', captionErr.message);
            // Continue without captions
          }
        }

        // Brand-template logo overlay: if the user selected a template that
        // has a saved logo, fetch the bytes, write to disk, and remember the
        // path + position. The actual filter splicing happens after we
        // build videoFilter below.
        let brandLogoPath = null;
        let brandLogoPos = 'top-right';
        let brandLogoSizePct = 12; // % of clip width (1080 → ~130px)
        if (selectedBrandTemplate && selectedBrandTemplate.logoFilename && brandTemplatesMod && brandTemplatesMod.fetchLogo) {
          try {
            const row = await brandTemplatesMod.fetchLogo(selectedBrandTemplate.logoFilename);
            if (row && row.data) {
              const ext = (row.mime_type || '').includes('jpeg') ? 'jpg'
                       : (row.mime_type || '').includes('webp') ? 'webp'
                       : 'png';
              brandLogoPath = path.join(CLIPS_DIR, `_logo_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`);
              fs.writeFileSync(brandLogoPath, row.data);
              brandLogoPos = selectedBrandTemplate.logoPosition || 'top-right';
              const rawSize = parseInt(selectedBrandTemplate.logoSize, 10);
              if (!isNaN(rawSize) && rawSize > 0) brandLogoSizePct = Math.max(5, Math.min(40, rawSize));
              console.log(`  Brand logo prepared: ${brandLogoPath} (pos=${brandLogoPos}, size=${brandLogoSizePct}%)`);
            }
          } catch (e) {
            console.log('  Brand logo fetch failed:', e.message);
            brandLogoPath = null;
          }
        }

        // Build filter based on selected clip style
        const captionFilter = assFilePath ? `,ass='${assFilePath.replace(/'/g, "'\\''").replace(/:/g, '\\:')}'` : '';

        // Build watermark filter from brand kit
        let watermarkFilter = '';
        if (brandKit && brandKit.watermark_text && brandKit.watermark_text.trim()) {
          const wmText = brandKit.watermark_text.trim().replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
          const wmColor = (brandKit.primary_color || '#FFFFFF').replace('#', '');
          // Semi-transparent watermark in bottom-right corner
          watermarkFilter = `,drawtext=text='${wmText}':fontsize=28:fontcolor=${wmColor}@0.6:x=w-tw-30:y=h-th-30:font=Liberation Sans`;
        }

        const style = clipStyle || 'blur';
        let videoFilter;

        console.log(`  Clip style: ${style}, captions: ${!!assFilePath}, watermark: ${!!watermarkFilter}`);

        if (style === 'crop') {
          // Center crop: zoom in and crop to 9:16 (loses sides but fills frame)
          videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${captionFilter}${watermarkFilter}`;
        } else if (style === 'fit') {
          // Fit with black background: full video centered on black
          videoFilter = [
            'color=c=black:s=1080x1920:r=30[bg]',
            '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]',
            '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1' + captionFilter + watermarkFilter
          ].join(';');
        } else if (style === 'pip') {
          // Picture-in-Picture: cropped background + small PiP in top-right corner
          // Uses two -i inputs of same file to avoid split filter deadlocks
          // Background gets unsharp mask to recover sharpness lost in the crop-zoom
          // PiP corner shows original framing with rounded appearance at 384x216
          videoFilter = [
            '[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,unsharp=5:5:0.8:5:5:0.4,setsar=1[bg]',
            '[1:v]scale=384:216:flags=lanczos,setsar=1[pip]',
            '[bg][pip]overlay=W-w-20:20,setsar=1' + captionFilter + watermarkFilter
          ].join(';');
        } else {
          // Default: blur background (most popular for repurposed content)
          videoFilter = [
            '[0:v]scale=270:-2,boxblur=8:3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]',
            '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]',
            '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1' + captionFilter + watermarkFilter
          ].join(';');
        }

        // PiP uses two inputs of same file to avoid split filter deadlocks
        const isPip = style === 'pip';

        // If a brand-template logo is set, splice an overlay step onto the
        // existing video filter chain. The logo file becomes a NEW ffmpeg
        // input, which means its index depends on whether PiP is on.
        const logoInputIdx = isPip ? 2 : 1;
        let finalVideoFilter = videoFilter;
        if (brandLogoPath) {
          // Tag the existing chain's output as [vid] so we can chain on top.
          if (finalVideoFilter.includes('[')) {
            // filter_complex chain — already named labels. Append [vid]
            // to whatever the last filter step produces.
            finalVideoFilter = finalVideoFilter + '[vid]';
          } else {
            // -vf chain (single ',-style' string). Wrap as a complex filter
            // so we can name its output and then chain the logo overlay.
            finalVideoFilter = '[0:v]' + finalVideoFilter + '[vid]';
          }
          // Logo width as a fraction of the 1080-wide canvas. The
          // force_divisible_by=2 keeps libx264's yuv420p happy.
          const logoW = Math.round(1080 * brandLogoSizePct / 100);
          const margin = 30;
          const overlayPos =
            brandLogoPos === 'top-left'     ? `${margin}:${margin}` :
            brandLogoPos === 'bottom-left'  ? `${margin}:H-h-${margin}` :
            brandLogoPos === 'bottom-right' ? `W-w-${margin}:H-h-${margin}` :
            /* top-right default */          `W-w-${margin}:${margin}`;
          finalVideoFilter +=
            `;[${logoInputIdx}:v]format=rgba,scale=${logoW}:-2:flags=lanczos[logo];` +
            `[vid][logo]overlay=${overlayPos}[ovr];[ovr]format=yuv420p[final]`;
        }

        const ffmpegArgs = [
          '-y',
          '-ss', String(startSec),
          '-i', actualDownload,
          ...(isPip ? ['-ss', String(startSec), '-i', actualDownload] : []),
          ...(brandLogoPath ? ['-i', brandLogoPath] : []),
          '-t', String(duration),
          ...(brandLogoPath
            ? ['-filter_complex', finalVideoFilter, '-map', '[final]', '-map', '0:a?']
            : (videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter])),
          '-c:v', 'libx264',
          '-profile:v', 'high',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '2',
          '-preset', 'medium',
          '-crf', '18',
          '-movflags', '+faststart',
          '-max_muxing_queue_size', '2048',
          tempOutputPath
        ];

        let ffmpegSuccess = false;
        try {
          await runCommand(ffmpegPath, ffmpegArgs, { timeout: 240000 });
          console.log('  ffmpeg completed successfully');
          ffmpegSuccess = true;
        } catch (ffErr) {
          console.error('  ffmpeg fast-seek failed:', ffErr.message);
          try { fs.unlinkSync(tempOutputPath); } catch(e) {}
        }

        // Retry with accurate seek if fast seek failed
        if (!ffmpegSuccess) {
          console.log('  Retrying with accurate seek (-ss after -i)...');
          writeProgress('Encoding (retry)...');

          const retryArgs = [
            '-y',
            '-i', actualDownload,
            ...(isPip ? ['-i', actualDownload] : []),
            ...(brandLogoPath ? ['-i', brandLogoPath] : []),
            '-ss', String(startSec),
            '-t', String(duration),
            ...(brandLogoPath
              ? ['-filter_complex', finalVideoFilter, '-map', '[final]', '-map', '0:a?']
              : (videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter])),
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-ac', '2',
            '-preset', 'medium',
            '-crf', '18',
            '-movflags', '+faststart',
            '-max_muxing_queue_size', '2048',
            tempOutputPath
          ];

          try {
            await runCommand(ffmpegPath, retryArgs, { timeout: 300000 });
            console.log('  ffmpeg retry succeeded');
            ffmpegSuccess = true;
          } catch (retryErr) {
            clearTimeout(timeout);
            console.error('  ffmpeg retry also failed:', retryErr.message);
            try { fs.unlinkSync(tempOutputPath); } catch(e) {}
            releaseVideoCache(videoId);
            writeError('Video encoding failed. Please try again.');
            return;
          }
        }

        // Clean up temp files (release shared video cache instead of deleting directly)
        releaseVideoCache(videoId);
        if (assFilePath) { try { fs.unlinkSync(assFilePath); } catch(e) {} }
        if (brandLogoPath) { try { fs.unlinkSync(brandLogoPath); } catch(e) {} }

        // === STEP 3: Validate output and atomically rename ===
        clearTimeout(timeout);

        if (!fs.existsSync(tempOutputPath)) {
          writeError('Video encoding produced no output. Please try again.');
          return;
        }

        const size = fs.statSync(tempOutputPath).size;
        console.log(`  Encoded output size: ${size} bytes (${(size / 1024 / 1024).toFixed(1)}MB)`);

        if (size < 50000) {
          console.error(`  Output too small: ${size} bytes`);
          try { fs.unlinkSync(tempOutputPath); } catch(e) {}
          writeError('Video encoding produced empty file. Please try again.');
          return;
        }

        // Validate MP4 header
        const fd = fs.openSync(tempOutputPath, 'r');
        const header = Buffer.alloc(12);
        fs.readSync(fd, header, 0, 12, 0);
        fs.closeSync(fd);
        const ftyp = header.toString('ascii', 4, 8);

        if (ftyp !== 'ftyp') {
          console.error(`  Invalid header: ftyp='${ftyp}'`);
          try { fs.unlinkSync(tempOutputPath); } catch(e) {}
          writeError('Video encoding produced invalid file. Please try again.');
          return;
        }

        // Atomic rename: move completed file to final path
        fs.renameSync(tempOutputPath, outputPath);
        // Remove progress file LAST to signal completion
        try { fs.unlinkSync(progressPath); } catch (e) {}
        console.log(`  Clip ready: ${filename} (${(size / 1024 / 1024).toFixed(1)}MB)`);

      } catch (err) {
        clearTimeout(timeout);
        writeError(`Clip generation failed: ${err.message}`);
      }
    })();

  } catch (error) {
    console.error('Error starting clip generation:', error);
    res.status(500).json({ error: 'Failed to start clip generation' });
  }
});

// GET /clip/status/:filename - Check if clip is ready
router.get('/clip/status/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent path traversal
  const filePath = path.join(CLIPS_DIR, filename);
  const errorPath = filePath + '.error';
  const progressPath = filePath + '.progress';

  // Check for error marker first
  if (fs.existsSync(errorPath)) {
    let errorMsg = 'Clip generation failed';
    try { errorMsg = fs.readFileSync(errorPath, 'utf8'); } catch (e) {}
    try { fs.unlinkSync(errorPath); } catch (e) {}
    return res.json({ ready: false, failed: true, message: errorMsg });
  }

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    // Only report ready if: file has real content AND no progress file (encoding complete)
    const stillProcessing = fs.existsSync(progressPath);
    if (stats.size > 10000 && !stillProcessing) {
      res.json({ ready: true, size: stats.size, filename });
    } else if (stillProcessing) {
      let progressMsg = 'Still processing...';
      try { progressMsg = fs.readFileSync(progressPath, 'utf8') || progressMsg; } catch (e) {}
      res.json({ ready: false, message: progressMsg });
    } else {
      res.json({ ready: false, message: 'Finalizing...' });
    }
  } else {
    // Check for progress file
    let progressMsg = 'Still processing...';
    if (fs.existsSync(progressPath)) {
      try { progressMsg = fs.readFileSync(progressPath, 'utf8') || progressMsg; } catch (e) {}
    }
    res.json({ ready: false, message: progressMsg });
  }
});

// GET /clip/download/:filename - Download generated clip
// Supports Range requests for QuickTime/browser video player compatibility
router.get('/clip/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent path traversal
  const filePath = path.join(CLIPS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Clip not found. It may still be processing or has expired.' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Support Range requests (required by QuickTime and most video players)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    // Clean up file after full download (with delay to allow stream to finish)
    stream.on('end', () => {
      setTimeout(() => {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }, 30000); // 30s delay to allow re-downloads
    });
  }
});

// GET /clip/debug - Debug endpoint to see clip file states
router.get('/clip/debug', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(CLIPS_DIR);
    const clipInfo = files.map(f => {
      const fullPath = path.join(CLIPS_DIR, f);
      const stat = fs.statSync(fullPath);
      let content = '';
      if (f.endsWith('.progress') || f.endsWith('.error')) {
        try { content = fs.readFileSync(fullPath, 'utf8'); } catch(e) {}
      }
      return { name: f, size: stat.size, modified: stat.mtime, content };
    });
    res.json({ clips_dir: CLIPS_DIR, files: clipInfo });
  } catch (err) {
    res.json({ error: err.message, clips_dir: CLIPS_DIR });
  }
});

// POST /narrate - Generate narration for a clip
router.post('/narrate', requireAuth, checkPlanLimit('narrationsPerMonth'), async (req, res) => {
  try {
    // Only require ffmpeg when voice/video processing is needed (text-only scripts don't need it)
    if (!ffmpegAvailable && req.body.voiceEnabled !== false) {
      return res.status(503).json({ error: 'ffmpeg not available on this server.' });
    }


    const { analysisId, momentIndex, narrationStyle, voiceEnabled, audioMix, clipFilename,
            ttsProvider, elevenlabsVoiceId } = req.body;

    // Validate inputs
    if (!analysisId || momentIndex === undefined || !narrationStyle || !clipFilename) {
      return res.status(400).json({ error: 'Analysis ID, moment index, narration style, and clip filename are required' });
    }

    const validStyles = ['funny', 'documentary', 'dramatic', 'hype', 'sarcastic', 'storytime', 'news', 'poetic'];
    if (!validStyles.includes(narrationStyle)) {
      return res.status(400).json({ error: `Invalid narration style. Must be one of: ${validStyles.join(', ')}` });
    }

    // Get analysis
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Analysis not found or unauthorized' });
    }

    // Get moment
    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) {
      return res.status(404).json({ error: 'Moment not found' });
    }

    // Verify clip file exists
    const clipPath = path.join(CLIPS_DIR, clipFilename);
    if (!fs.existsSync(clipPath)) {
      return res.status(404).json({ error: 'Clip file not found', needsRegeneration: true });
    }

    // Generate output filename
    const baseName = clipFilename.replace(/\.[^.]+$/, ''); // Remove extension
    const narratedFilename = `${baseName}_narrated_${Date.now()}.mp4`;
    const outputPath = path.join(CLIPS_DIR, narratedFilename);

    // Send initial response
    res.json({
      success: true,
      status: 'processing',
      message: 'Generating narration...',
      filename: narratedFilename
    });

    // Write progress/error helpers (same pattern as clip endpoint)
    const progressPath = outputPath + '.progress';
    const writeProgress = (msg) => {
      try { fs.writeFileSync(progressPath, msg); } catch (e) {}
      console.log(`  [${narratedFilename}] ${msg}`);
    };
    const writeError = (msg) => {
      try { fs.unlinkSync(progressPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch (e) {}
      console.error(`  [${narratedFilename}] ERROR: ${msg}`);
    };

    // runCommand helper (same as clip endpoint)
    const runCommand = (cmd, args, options = {}) => {
      return new Promise((resolve, reject) => {
        const cmdLabel = path.basename(cmd);
        console.log(`  Running ${cmdLabel}: ${args.slice(0, 4).join(' ')}...`);
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          const timeMatch = data.toString().match(/time=(\d+:\d+:\d+)/);
          if (timeMatch) writeProgress(`Processing: ${timeMatch[1]}`);
        });
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          const timeMatch = data.toString().match(/time=(\d+:\d+:\d+)/);
          if (timeMatch) writeProgress(`Processing: ${timeMatch[1]}`);
        });
        proc.on('error', (err) => settle(reject, new Error(`${cmdLabel} process error: ${err.message}`)));
        proc.on('close', (code, signal) => {
          if (code === 0) settle(resolve, { stdout, stderr });
          else settle(reject, new Error(`${cmdLabel} exit ${code}${signal ? '/'+signal : ''}: ${stderr.slice(-500)}`));
        });

        const timer = options.timeout ? setTimeout(() => {
          console.error(`  ${cmdLabel} timed out after ${options.timeout/1000}s`);
          try { proc.kill('SIGKILL'); } catch(e) {}
          settle(reject, new Error(`${cmdLabel} timed out after ${options.timeout/1000}s`));
        }, options.timeout) : null;
      });
    };

    // Process in background
    (async () => {
      const timeout = setTimeout(() => {
        writeError('Narration generation timed out after 5 minutes.');
      }, 300000);

      try {
        // Step 1: Generate narration script using GPT-4o-mini
        writeProgress('Generating narration script...');

        let transcriptExcerpt = '';
        if (analysis.transcript) {
          // Try to extract transcript segment for this moment
          const segments = parseTranscriptToSegments(analysis.transcript);
          if (segments.length > 0) {
            const segmentTexts = segments.map(s => s.text).join(' ');
            transcriptExcerpt = segmentTexts.substring(0, 300); // First 300 chars
          }
        }
        if (!transcriptExcerpt) {
          transcriptExcerpt = moment.title || 'This video moment';
        }

        // Style prompts
        const stylePrompts = {
          funny: "Write a hilarious, meme-style voiceover commentary. Use modern internet humor, sarcasm, and comedic observations. Keep it punchy — max 4-5 short sentences.",
          documentary: "Write a calm, authoritative David Attenborough-style nature documentary narration. Observational, educational, and slightly awe-inspired. Max 4-5 sentences.",
          dramatic: "Write an intense, cinematic narration like a movie trailer voiceover. Build tension and drama. Max 4-5 powerful sentences.",
          hype: "Write an extremely energetic, motivational narration like a sports commentator or hype man. Use exclamation marks, energy words, and keep the audience pumped. Max 4-5 sentences.",
          sarcastic: "Write a dry, witty, sarcastic commentary like a deadpan comedian roasting what's happening. Max 4-5 sentences.",
          storytime: "Write a cozy, warm bedtime story narration as if telling this story to a fascinated audience. Use 'once upon a time' energy. Max 4-5 sentences.",
          news: "Write a professional breaking news broadcast narration. Formal, factual, slightly urgent. Max 4-5 sentences.",
          poetic: "Write a beautiful, poetic narration with metaphors and lyrical language. Almost like spoken word poetry. Max 4-5 sentences."
        };

        const systemPrompt = `You are a creative narration writer for short-form video content. Write engaging, authentic voiceover scripts that match the specified style. Write only spoken words — no emojis, no hashtags, no stage directions, no quotation marks. The text will be read aloud by a text-to-speech voice.`;
        const userPrompt = `${stylePrompts[narrationStyle]}\n\nBased on this video transcript excerpt: ${transcriptExcerpt}`;

        const narrationResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 300,
          temperature: 0.8
        });

        const narrationScript = narrationResponse.choices[0]?.message?.content || '';
        if (!narrationScript) {
          clearTimeout(timeout);
          writeError('Failed to generate narration script');
          return;
        }

        console.log(`  Generated narration: ${narrationScript.substring(0, 100)}...`);

      // Text-only mode: save script and skip video processing
      if (!voiceEnabled) {
        const scriptJsonPath = outputPath.replace('.mp4', '.script.json');
        fs.writeFileSync(scriptJsonPath, JSON.stringify({ textOnly: true, script: narrationScript }));
        try { fs.unlinkSync(outputPath + '.progress'); } catch(e) {}
        clearTimeout(timeout);
        return;
      }

        // Step 2: Generate audio if voiceEnabled
        let audioPath = null;
        if (voiceEnabled) {
          writeProgress('Generating voice audio...');

          // Get user's ElevenLabs API key from brand kit if they have one
          const brandKit = await brandKitOps.getByUserId(req.user.id);
          const userElevenLabsKey = brandKit?.elevenlabs_api_key || null;
          const useElevenLabs = ttsProvider === 'elevenlabs' && userElevenLabsKey && elevenlabsVoiceId;

          try {
            audioPath = outputPath + '.audio.mp3';

            if (useElevenLabs) {
              // ElevenLabs TTS
              writeProgress('Generating ElevenLabs voice...');
              const elResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenlabsVoiceId}`, {
                method: 'POST',
                headers: {
                  'xi-api-key': userElevenLabsKey,
                  'Content-Type': 'application/json',
                  'Accept': 'audio/mpeg'
                },
                body: JSON.stringify({
                  text: narrationScript,
                  model_id: 'eleven_multilingual_v2',
                  voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                })
              });
              if (!elResp.ok) {
                const errText = await elResp.text().catch(() => 'Unknown error');
                throw new Error(`ElevenLabs API error (${elResp.status}): ${errText}`);
              }
              const buffer = Buffer.from(await elResp.arrayBuffer());
              fs.writeFileSync(audioPath, buffer);
              console.log(`  ElevenLabs audio generated: ${audioPath} (${buffer.length} bytes)`);
            } else {
              // OpenAI TTS (default)
              let voiceName = 'nova';
              if (narrationStyle === 'documentary' || narrationStyle === 'news') voiceName = 'onyx';
              else if (narrationStyle === 'storytime' || narrationStyle === 'poetic') voiceName = 'shimmer';
              else if (narrationStyle === 'dramatic') voiceName = 'echo';
              else if (narrationStyle === 'hype') voiceName = 'fable';

              const speech = await openai.audio.speech.create({
                model: 'tts-1',
                voice: voiceName,
                input: narrationScript
              });
              const buffer = Buffer.from(await speech.arrayBuffer());
              fs.writeFileSync(audioPath, buffer);
              console.log(`  OpenAI TTS audio generated: ${audioPath}`);
            }
          } catch (ttsErr) {
            clearTimeout(timeout);
            writeError(`Voice generation failed: ${ttsErr.message}`);
            return;
          }
        }

        // Step 3: Process video with ffmpeg
        writeProgress('Processing video...');

        const tempOutput = outputPath + '.temp.mp4';

        if (voiceEnabled && audioPath) {
          // Add audio to video (mix or replace)
        try {
          if (audioMix === 'replace') {
            // Replace: discard original audio, use only narration
            await runCommand(ffmpegPath, [
              '-i', clipPath, '-i', audioPath,
              '-map', '0:v', '-map', '1:a',
              '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', tempOutput
            ], { timeout: 120000 });
          } else {
            // Mix: blend original audio (30%) with narration
            await runCommand(ffmpegPath, [
              '-i', clipPath, '-i', audioPath, '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
              '-filter_complex', '[0:a]volume=0.3[original];[1:a]volume=1[narration];[original][narration]amix=inputs=2:duration=longest',
              '-c:a', 'aac', '-shortest', '-y', tempOutput
            ], { timeout: 120000 });
          }
          } catch (ffErr) {
            clearTimeout(timeout);
            writeError(`ffmpeg audio processing failed: ${ffErr.message}`);
            try { fs.unlinkSync(audioPath); } catch(e) {}
            return;
          }
        } else if (!voiceEnabled) {
          // Text-only: burn captions with drawtext filter
          writeProgress('Adding text captions...');

          // Split narration into 2-3 line chunks with timing
          const lines = narrationScript.split(/[.!?]+/).filter(l => l.trim());
          const chunkSize = Math.ceil(lines.length / 2);
          const chunks = [];
          for (let i = 0; i < lines.length; i += chunkSize) {
            chunks.push(lines.slice(i, i + chunkSize).join('. ').trim());
          }

          // Get video duration
          let videoDuration = 5; // Default
          try {
            const probeResult = require('child_process').execSync(
              `ffprobe -v error -show_entries format=duration -of csv=p=0 "${clipPath.replace(/"/g, '\\"')}"`,
              { encoding: 'utf8' }
            );
            videoDuration = parseFloat(probeResult) || 5;
          } catch (e) {
            console.log('  Could not determine video duration, using default');
          }

          // Build drawtext filters for each chunk
          let drawTextFilters = [];
          const chunkDuration = videoDuration / chunks.length;
          chunks.forEach((chunk, idx) => {
            const startTime = idx * chunkDuration;
            const endTime = (idx + 1) * chunkDuration;
                    const escapedText = chunk.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/;/g, '\\;');

            drawTextFilters.push(
              `drawtext=text='${escapedText}':fontsize=48:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:bordercolor=black:borderw=3:x=(w-text_w)/2:y=h-text_h-80:enable='between(t,${startTime},${endTime})'`
            );
          });

          const videoFilter = drawTextFilters.join(',');

          try {
            await runCommand(ffmpegPath, [
              '-i', clipPath,
              '-vf', videoFilter,
              '-c:a', 'copy',
              '-c:v', 'libx264',
              '-preset', 'medium',
              '-y',
              tempOutput
            ], { timeout: 120000 });
          } catch (ffErr) {
            clearTimeout(timeout);
            writeError(`ffmpeg text overlay failed: ${ffErr.message}`);
            return;
          }
        } else {
          // No voice, no text - just copy the original
          try {
            await runCommand(ffmpegPath, [
              '-i', clipPath,
              '-c', 'copy',
              '-y',
              tempOutput
            ], { timeout: 120000 });
          } catch (ffErr) {
            clearTimeout(timeout);
            writeError(`ffmpeg copy failed: ${ffErr.message}`);
            return;
          }
        }

        // Step 4: Rename temp to final output
        if (fs.existsSync(tempOutput)) {
          fs.renameSync(tempOutput, outputPath);
          console.log(`  Narrated clip saved: ${outputPath}`);
        } else {
          clearTimeout(timeout);
          writeError('Output file was not created');
          return;
        }

        // Cleanup temp audio file
        if (audioPath && fs.existsSync(audioPath)) {
          try { fs.unlinkSync(audioPath); } catch (e) {}
        }

        // Clean up progress file on success
        try { fs.unlinkSync(progressPath); } catch (e) {}
        clearTimeout(timeout);
        console.log(`  Narration complete: ${narratedFilename}`);

      } catch (err) {
        clearTimeout(timeout);
         writeError(err.message || 'Unknown error during narration processing');
      }
    })();

  } catch (err) {
    console.error('POST /narrate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /quick-narrate - Download a YouTube video and add narration (standalone, no analysis needed)
router.post('/quick-narrate', requireAuth, checkPlanLimit('narrationsPerMonth'), async (req, res) => {
  try {
    if (!ffmpegAvailable) return res.status(503).json({ error: 'ffmpeg not available' });

    const { videoUrl, narrationStyle, voiceEnabled, audioMix, ttsProvider, elevenlabsVoiceId, customScript } = req.body;
    if (!videoUrl) return res.status(400).json({ error: 'Video URL is required' });

    const validStyles = ['funny', 'documentary', 'dramatic', 'hype', 'sarcastic', 'storytime', 'news', 'poetic'];
    if (narrationStyle && !validStyles.includes(narrationStyle)) {
      return res.status(400).json({ error: 'Invalid narration style' });
    }

    if (!isValidVideoUrl(videoUrl)) {
      return res.status(400).json({ error: 'Invalid video URL. Supported platforms: YouTube, Instagram, TikTok, Facebook, Twitter/X, LinkedIn, Snapchat' });
    }

    const filename = `quicknarrate_${Date.now()}.mp4`;
    const outputPath = path.join(CLIPS_DIR, filename);
    const progressPath = outputPath + '.progress';
    const writeProgress = (msg) => { try { fs.writeFileSync(progressPath, msg); } catch(e) {} console.log(`  [${filename}] ${msg}`); };
    const writeError = (msg) => {
      try { fs.unlinkSync(progressPath); } catch(e) {}
      try { fs.unlinkSync(outputPath); } catch(e) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch(e) {}
      console.error(`  [${filename}] ERROR: ${msg}`);
    };

    res.json({ success: true, filename, status: 'processing' });

    const runCommand = (cmd, args, options = {}) => {
      return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = ''; let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
        proc.stderr.on('data', (d) => { stderr += d.toString(); const m = d.toString().match(/time=(\d+:\d+:\d+)/); if (m) writeProgress('Processing: ' + m[1]); });
        proc.on('error', (err) => settle(reject, new Error(err.message)));
        proc.on('close', (code) => { if (code === 0) settle(resolve, {}); else settle(reject, new Error('exit ' + code + ': ' + stderr.slice(-300))); });
        const timer = options.timeout ? setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} settle(reject, new Error('Timed out')); }, options.timeout) : null;
      });
    };

    (async () => {
      const timeout = setTimeout(() => writeError('Timed out after 12 minutes'), 720000);
      try {
        // Step 1: Download video (try Cobalt API first, then yt-dlp, then ytdl-core fallback)
        writeProgress('Downloading video...');
        const downloadPath = outputPath + '.download.mkv';
        let downloadSuccess = false;

        // Each downloader writes to downloadPath. After it finishes, run
        // validateDownloadedVideo(): if it's empty / non-video bytes (e.g.
        // Cobalt's tunnel returned 0 bytes for this URL, or yt-dlp got
        // bot-blocked and produced a partial file), throw away the bad
        // file and try the next downloader. This stops bad bytes from
        // propagating to ffmpeg, which otherwise fails with a confusing
        // 'Invalid data found' error.
        const tryWithValidation = async (label, fn) => {
          try {
            await fn();
            validateDownloadedVideo(downloadPath);
            downloadSuccess = true;
            console.log(`  Quick Narrate: Downloaded via ${label}`);
            return true;
          } catch (err) {
            console.log(`  Quick Narrate ${label} failed: ` + String(err.message || err).slice(0, 200));
            try { fs.unlinkSync(downloadPath); } catch (e) {}
            return false;
          }
        };

        // 1. Cobalt API (preferred)
        await tryWithValidation('Cobalt API', () => downloadWithCobalt(videoUrl, downloadPath));

        // 2. yt-dlp
        if (!downloadSuccess) {
          await tryWithValidation('yt-dlp', () => runCommand('yt-dlp', [
            '--no-playlist', '-f', 'bestvideo[height<=1920]+bestaudio/best[height<=1920]/best',
            '--merge-output-format', 'mkv', '-o', downloadPath,
            '--no-part', '--force-overwrites',
            ...getYoutubeCookiesArgs(),
            ...getYoutubeProxyArgs(),
            ...YTDLP_COMMON_ARGS,
            videoUrl
          ], { timeout: 240000 }));
        }

        // 3. ytdl-core (YouTube only)
        if (!downloadSuccess && ytdl && extractVideoId(videoUrl)) {
          writeProgress('Trying alternative download...');
          await tryWithValidation('ytdl-core', () => new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(downloadPath);
            const stream = ytdl(videoUrl, { quality: 'highest', filter: 'audioandvideo' });
            stream.on('progress', (_, dl, tot) => { if (tot) writeProgress('Downloading: ' + Math.round((dl / tot) * 100) + '%'); });
            stream.on('error', e => { ws.destroy(); reject(e); });
            ws.on('finish', () => resolve());
            ws.on('error', e => reject(e));
            stream.pipe(ws);
            setTimeout(() => { stream.destroy(); ws.destroy(); reject(new Error('Download timed out')); }, 240000);
          }));
        }

        if (!downloadSuccess) {
          throw new Error('Could not download video — Cobalt, yt-dlp, and ytdl-core all failed for this URL. Try a different video or check that the URL is publicly accessible.');
        }

        // Step 2: Fetch real video context — title AND actual transcript.
        // Previously this only fetched the title, which meant GPT had no
        // idea what was actually in the video and would invent unrelated
        // narrations. Now we pull the same transcript chain that
        // /auto-generate uses (Supadata → InnerTube → Direct → yt-dlp)
        // so the script is grounded in the real content.
        writeProgress('Reading video content...');
        let videoTitle = '';
        try {
          const titleProc = require('child_process').execSync(
            'yt-dlp --get-title ' + YTDLP_COMMON_ARGS.map(a => JSON.stringify(a)).join(' ') + ' "' + videoUrl.replace(/"/g, '') + '"',
            { encoding: 'utf8', timeout: 15000 }
          ).trim();
          videoTitle = titleProc || '';
        } catch (e) { videoTitle = ''; }

        // For YouTube URLs, pull the real transcript so GPT writes a
        // narration that actually reflects what's in the video.
        let videoTranscriptText = '';
        const ytId = extractVideoId(videoUrl);
        if (ytId) {
          let segments = null;
          if (process.env.SUPADATA_API_KEY) {
            try { segments = await fetchTranscriptSupadata(ytId); } catch (e) {}
          }
          if (!segments || segments.length === 0) {
            try { segments = await fetchTranscriptInnerTube(ytId); } catch (e) {}
          }
          if (!segments || segments.length === 0) {
            try { segments = await fetchTranscriptDirect(ytId); } catch (e) {}
          }
          if (!segments || segments.length === 0) {
            try { segments = await fetchTranscriptWithYtdlp(ytId); } catch (e) {}
          }
          if (segments && segments.length > 0) {
            // Concatenate spoken text. Cap at ~3500 chars so the prompt
            // stays well under model context limits even for long videos.
            const joined = segments.map(s => (s.text || '').trim()).filter(Boolean).join(' ');
            videoTranscriptText = joined.length > 3500
              ? joined.slice(0, 3500) + '… [truncated]'
              : joined;
            console.log(`  Quick Narrate: transcript fetched (${segments.length} segments, ${videoTranscriptText.length} chars)`);
          } else {
            console.log('  Quick Narrate: no transcript available — falling back to title-only context');
          }
        }

        // Step 3: Generate narration script
        writeProgress('Generating narration script...');
        let narrationScript = customScript || '';
        if (!narrationScript) {
          const stylePrompts = {
            funny: "Write a hilarious, meme-style voiceover. Modern internet humor, punchy. Max 4-5 short sentences.",
            documentary: "Write a David Attenborough-style narration. Observational, educational. Max 4-5 sentences.",
            dramatic: "Write an intense movie trailer voiceover. Build tension. Max 4-5 powerful sentences.",
            hype: "Write an extremely energetic sports commentator narration. Max 4-5 sentences.",
            sarcastic: "Write dry, witty sarcastic commentary. Deadpan humor. Max 4-5 sentences.",
            storytime: "Write a cozy bedtime story narration. Warm and engaging. Max 4-5 sentences.",
            news: "Write a breaking news broadcast narration. Formal, slightly urgent. Max 4-5 sentences.",
            poetic: "Write beautiful poetic narration with metaphors. Max 4-5 sentences."
          };
          const styleInstruction = stylePrompts[narrationStyle] || stylePrompts.funny;
          const userParts = [
            styleInstruction,
            '',
            'The narration MUST be about the actual content of this video — reference what is being shown, said, or happening. Do not invent unrelated content.',
          ];
          if (videoTitle) userParts.push('', 'Video title: ' + videoTitle);
          if (videoTranscriptText) {
            userParts.push('', 'Video transcript (spoken content):', videoTranscriptText);
          } else {
            userParts.push('', '(No transcript available — base the narration on the title and tone described above.)');
          }
          const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a creative narration writer for short-form video content. Write only spoken words — no emojis, no hashtags, no stage directions, no quotation marks. The text will be read aloud by a text-to-speech voice. Always ground the narration in the actual content of the source video.' },
              { role: 'user', content: userParts.join('\n') }
            ],
            max_tokens: 300, temperature: 0.8
          });
          narrationScript = resp.choices[0]?.message?.content || 'What an incredible moment captured on camera.';
        }

      // Save narration script text for user to copy/download
      try { fs.writeFileSync(outputPath + '.narration.txt', narrationScript); } catch(e) {}

        // Step 4: Generate TTS audio if voice enabled
        let audioPath = null;
        if (voiceEnabled !== false) {
          writeProgress('Generating voice audio...');
          audioPath = outputPath + '.audio.mp3';
          const brandKit = await brandKitOps.getByUserId(req.user.id);
          const userElevenLabsKey = brandKit?.elevenlabs_api_key || null;
          const useElevenLabs = ttsProvider === 'elevenlabs' && userElevenLabsKey && elevenlabsVoiceId;

          if (useElevenLabs) {
            const elResp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + elevenlabsVoiceId, {
              method: 'POST',
              headers: { 'xi-api-key': userElevenLabsKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
              body: JSON.stringify({ text: narrationScript, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
            });
            if (!elResp.ok) throw new Error('ElevenLabs API error: ' + elResp.status);
            fs.writeFileSync(audioPath, Buffer.from(await elResp.arrayBuffer()));
          } else {
            let voice = 'nova';
            if (narrationStyle === 'documentary' || narrationStyle === 'news') voice = 'onyx';
            else if (narrationStyle === 'storytime' || narrationStyle === 'poetic') voice = 'shimmer';
            const speech = await openai.audio.speech.create({ model: 'tts-1', voice, input: narrationScript });
            fs.writeFileSync(audioPath, Buffer.from(await speech.arrayBuffer()));
          }
        }

        // Step 5: Combine video + narration audio
        writeProgress('Processing final video...');
        const tempOut = outputPath + '.temp.mp4';
        if (audioPath) {
          // Build args twice — once for fast stream-copy (-c:v copy), once
          // for the libx264 fallback if the source codec isn't MP4-compatible.
          // Stream-copying skips the entire video re-encode, turning what
          // used to be a 5-10 minute libx264 pass on long videos into roughly
          // the time it takes to mux: seconds, not minutes.
          const buildArgs = (videoCodec) => {
            const reencodeArgs = videoCodec === 'libx264'
              ? ['-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']
              : [];
            if (audioMix === 'replace') {
              return [
                '-i', downloadPath, '-i', audioPath,
                '-map', '0:v', '-map', '1:a',
                '-c:v', videoCodec, ...reencodeArgs,
                '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-y', tempOut
              ];
            }
            return [
              '-i', downloadPath, '-i', audioPath,
              '-c:v', videoCodec, ...reencodeArgs,
              '-filter_complex', '[0:a]volume=0.3[orig];[1:a]volume=1.0[narr];[orig][narr]amix=inputs=2:duration=longest',
              '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-y', tempOut
            ];
          };

          try {
            writeProgress('Muxing audio (fast path)...');
            await runCommand(ffmpegPath, buildArgs('copy'), { timeout: 360000 });
          } catch (copyErr) {
            console.log(`  Quick Narrate stream-copy failed (${String(copyErr.message || '').slice(0, 120)}), falling back to libx264 re-encode`);
            try { fs.unlinkSync(tempOut); } catch (e) {}
            writeProgress('Re-encoding video (fallback)...');
            await runCommand(ffmpegPath, buildArgs('libx264'), { timeout: 360000 });
          }
        } else {
          // Text-only narration overlay
          const escaped = narrationScript.replace(/'/g, "'\\''").replace(/:/g, '\\:');
          await runCommand(ffmpegPath, [
            '-i', downloadPath,
            '-vf', "drawtext=text='" + escaped.substring(0, 200) + "':fontsize=36:fontcolor=white:bordercolor=black:borderw=2:x=(w-text_w)/2:y=h-80",
            '-c:a', 'copy', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-y', tempOut
          ], { timeout: 360000 });
        }

        if (fs.existsSync(tempOut)) fs.renameSync(tempOut, outputPath);
        else { writeError('No output produced'); return; }

        // Cleanup
        try { fs.unlinkSync(downloadPath); } catch(e) {}
        if (audioPath) try { fs.unlinkSync(audioPath); } catch(e) {}
        try { fs.unlinkSync(progressPath); } catch(e) {}
        clearTimeout(timeout);
        console.log('  Quick narrate complete: ' + filename);
      } catch (err) {
        clearTimeout(timeout);
        writeError(err.message || 'Quick narrate failed');
      }
    })();
  } catch (err) {
    console.error('POST /quick-narrate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /narrate/status/:filename - Check narration processing status
router.get('/narrate/status/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CLIPS_DIR, filename);
  const progressPath = filePath + '.progress';
  const errorPath = filePath + '.error';

  // Check for error
  if (fs.existsSync(errorPath)) {
    let errorMsg = 'Unknown error';
    try { errorMsg = fs.readFileSync(errorPath, 'utf8'); } catch (e) {}
    return res.json({ ready: false, error: true, message: errorMsg });
  }

    // Check for text-only narration result
    const scriptJsonPath = filePath.replace('.mp4', '.script.json');
    if (fs.existsSync(scriptJsonPath)) {
      try {
        const scriptData = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf8'));
        return res.json({ ready: true, textOnly: true, script: scriptData.script, filename });
      } catch(e) {
        return res.json({ ready: false, error: true, message: 'Failed to read narration script' });
      }
    }

  // Check if done
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const stillProcessing = fs.existsSync(progressPath);
    if (stats.size > 10000 && !stillProcessing) {
      let _ns = ''; try { _ns = fs.readFileSync(filePath + '.narration.txt', 'utf8'); } catch(e) {}
          res.json({ ready: true, size: stats.size, filename, narrationScript: _ns });
    } else if (stillProcessing) {
      let progressMsg = 'Still processing...';
      try { progressMsg = fs.readFileSync(progressPath, 'utf8') || progressMsg; } catch (e) {}
      res.json({ ready: false, message: progressMsg });
    } else {
      res.json({ ready: false, message: 'Finalizing...' });
    }
  } else {
    let progressMsg = 'Still processing...';
    if (fs.existsSync(progressPath)) {
      try { progressMsg = fs.readFileSync(progressPath, 'utf8') || progressMsg; } catch (e) {}
    }
    res.json({ ready: false, message: progressMsg });
  }
});

// GET /narrate/download/:filename - Download narrated clip
router.get('/narrate/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CLIPS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Narrated clip not found. It may still be processing or has expired.' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Support Range requests
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    stream.on('end', () => {
      setTimeout(() => {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }, 30000);
    });
  }
});

// POST /clip-with-broll - Generate clip with B-Roll scenes spliced in
router.post('/clip-with-broll', requireAuth, requireFeature('clipWithBroll'), async (req, res) => {
  try {
    if (!ffmpegAvailable) {
      return res.status(503).json({ error: 'ffmpeg not available on this server.' });
    }

    const { analysisId, momentIndex, includeCaptions, clipStyle, captionStyle, brollScenes } = req.body;
    if (!analysisId || momentIndex === undefined || !brollScenes || brollScenes.length === 0) {
      return res.status(400).json({ error: 'Analysis ID, moment index, and B-Roll scenes are required' });
    }

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let brandKit = null;
    try { brandKit = await brandKitOps.getByUserId(req.user.id); } catch (e) {}

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const rangeParts = (moment.timeRange || '').split('-');
    const parseTime = (str) => {
      const parts = (str || '').trim().split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTime(rangeParts[0]);
    const endSec = rangeParts[1] ? parseTime(rangeParts[1]) : startSec + 60;
    const duration = Math.max(endSec - startSec, 5);

    const videoId = extractVideoId(analysis.video_url);
    if (!videoId) return res.status(400).json({ error: 'Invalid video URL' });

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const safeTitle = (moment.title || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const filename = `${safeTitle}_broll_${Date.now()}.mp4`;
    const outputPath = path.join(CLIPS_DIR, filename);
    const tempOutputPath = outputPath + '.encoding.mp4';

    res.json({ success: true, status: 'processing', message: 'Generating clip with B-Roll...', filename });

    const progressPath = outputPath + '.progress';
    const writeProgress = (msg) => { try { fs.writeFileSync(progressPath, msg); } catch (e) {} };
    const writeError = (msg) => {
      try { fs.unlinkSync(progressPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch (e) {}
    };

    const runCommand = (cmd, args, options = {}) => {
      return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
          const pct = d.toString().match(/(\d+\.?\d*)%/);
          if (pct) writeProgress(`Downloading: ${Math.round(parseFloat(pct[1]))}%`);
          const tm = d.toString().match(/time=(\d+:\d+:\d+)/);
          if (tm) writeProgress(`Encoding: ${tm[1]}`);
        });
        proc.on('error', (err) => settle(reject, err));
        proc.on('close', (code) => {
          if (code === 0) settle(resolve, { stdout, stderr });
          else settle(reject, new Error(`Exit ${code}: ${stderr.slice(-300)}`));
        });
        const timer = options.timeout ? setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch(e) {}
          settle(reject, new Error('Timed out'));
        }, options.timeout) : null;
      });
    };

    // Background processing
    (async () => {
      const timeout = setTimeout(() => writeError('Timed out after 10 minutes'), 600000);
      const tempFiles = [];

      try {
        // STEP 1: Download main video
        writeProgress('Downloading main video...');
        const tempDownload = outputPath + '.temp.mkv';
        tempFiles.push(tempDownload);

        try {
          await runCommand('yt-dlp', [
            '--no-playlist', '-f', 'bestvideo[height<=1920]+bestaudio/best[height<=1920]/best',
            '--merge-output-format', 'mkv', '-o', tempDownload,
            '--no-part', '--force-overwrites',
            ...getYoutubeCookiesArgs(),
            ...getYoutubeProxyArgs(),
            ...YTDLP_COMMON_ARGS,
            videoUrl
          ], { timeout: 240000 });
        } catch (e) {
          console.log(`  B-Roll yt-dlp failed: ${e.message.slice(0, 150)}`);
          if (ytdl) {
            try {
              writeProgress('Trying alternative download...');
              await new Promise((resolve, reject) => {
                const ws = fs.createWriteStream(tempDownload);
                const stream = ytdl(videoUrl, { quality: 'highest', filter: 'audioandvideo' });
                stream.on('progress', (_, dl, tot) => { if (tot) writeProgress('Downloading: ' + Math.round((dl / tot) * 100) + '%'); });
                stream.on('error', err => { ws.destroy(); reject(err); });
                ws.on('finish', () => resolve());
                ws.on('error', err => reject(err));
                stream.pipe(ws);
                setTimeout(() => { stream.destroy(); ws.destroy(); reject(new Error('Download timed out')); }, 240000);
              });
            } catch (e2) {
              console.log(`  B-Roll ytdl-core also failed: ${e2.message.slice(0, 150)}`);
              clearTimeout(timeout);
              writeError('Video download failed.');
              return;
            }
          } else {
            clearTimeout(timeout);
            writeError('Video download failed.');
            return;
          }
        }

        // Find actual downloaded file
        let actualDownload = tempDownload;
        if (!fs.existsSync(tempDownload)) {
          const base = outputPath + '.temp';
          for (const ext of ['.mkv', '.mp4', '.webm']) {
            if (fs.existsSync(base + ext)) { actualDownload = base + ext; break; }
          }
        }
        if (!fs.existsSync(actualDownload)) { clearTimeout(timeout); writeError('Download not found.'); return; }
        if (actualDownload !== tempDownload) tempFiles.push(actualDownload);

        // STEP 2: Extract main clip segment
        writeProgress('Extracting clip segment...');
        const mainSegment = outputPath + '.main_seg.mp4';
        tempFiles.push(mainSegment);

        const style = clipStyle || 'blur';
        let captionFilter = '';
        if (includeCaptions && analysis.transcript) {
          try {
            const segments = parseTranscriptToSegments(analysis.transcript);
            const assContent = generateASSSubtitles(segments, startSec, duration, captionStyle);
            if (assContent) {
              const assFile = outputPath + '.ass';
              fs.writeFileSync(assFile, assContent, 'utf8');
              tempFiles.push(assFile);
              captionFilter = `,ass='${assFile.replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`;
            }
          } catch (e) {}
        }

        let watermarkFilter = '';
        if (brandKit && brandKit.watermark_text && brandKit.watermark_text.trim()) {
          const wmText = brandKit.watermark_text.trim().replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
          const wmColor = (brandKit.primary_color || '#FFFFFF').replace('#', '');
          watermarkFilter = `,drawtext=text='${wmText}':fontsize=28:fontcolor=${wmColor}@0.6:x=w-tw-30:y=h-th-30:font=Liberation Sans`;
        }

        let videoFilter;
        if (style === 'crop') {
          videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${captionFilter}${watermarkFilter}`;
        } else if (style === 'fit') {
          videoFilter = ['color=c=black:s=1080x1920:r=30[bg]', '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]', '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1' + captionFilter + watermarkFilter].join(';');
        } else if (style === 'pip') {
          videoFilter = ['[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,unsharp=5:5:0.8:5:5:0.4,setsar=1[bg]', '[1:v]scale=384:216:flags=lanczos,setsar=1[pip]', '[bg][pip]overlay=W-w-20:20,setsar=1' + captionFilter + watermarkFilter].join(';');
        } else {
          videoFilter = ['[0:v]scale=270:-2,boxblur=8:3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]', '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]', '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1' + captionFilter + watermarkFilter].join(';');
        }

        const isPipBroll = style === 'pip';
        await runCommand(ffmpegPath, [
          '-y', '-ss', String(startSec), '-i', actualDownload,
          ...(isPipBroll ? ['-ss', String(startSec), '-i', actualDownload] : []),
          '-t', String(duration),
          ...(videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter]),
          '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
          mainSegment
        ], { timeout: 240000 });

        // STEP 3: Download B-Roll clips from Pexels
        writeProgress('Downloading B-Roll clips...');
        const brollSegments = [];

        for (let i = 0; i < brollScenes.length; i++) {
          const scene = brollScenes[i];
          if (!scene.videoUrl) continue;

          writeProgress(`Downloading B-Roll ${i + 1}/${brollScenes.length}...`);
          const brollRaw = outputPath + `.broll_raw_${i}.mp4`;
          const brollFormatted = outputPath + `.broll_fmt_${i}.mp4`;
          tempFiles.push(brollRaw, brollFormatted);

          try {
            // Download from Pexels
            const pxResp = await fetch(scene.videoUrl);
            if (!pxResp.ok) continue;
            const buffer = Buffer.from(await pxResp.arrayBuffer());
            fs.writeFileSync(brollRaw, buffer);

            // Reformat B-Roll to match main clip (1080x1920 vertical, 5s max)
            const brollDur = Math.min(scene.duration || 5, 8);
            await runCommand(ffmpegPath, [
              '-y', '-i', brollRaw, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-t', String(brollDur),
              '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1',
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18',
              '-c:a', 'aac', '-b:a', '128k', '-map', '0:v:0', '-map', '1:a:0', '-shortest',
              '-movflags', '+faststart',
              brollFormatted
            ], { timeout: 60000 });

            brollSegments.push({
              path: brollFormatted,
              position: scene.position || 'middle',
              positionSec: scene.positionSec || null,
              duration: brollDur
            });
          } catch (e) {
            console.error(`  B-Roll ${i} download/format failed:`, e.message);
          }
        }

        if (brollSegments.length === 0) {
          // No B-Roll succeeded — just use the main segment
          fs.renameSync(mainSegment, outputPath);
          clearTimeout(timeout);
          try { fs.unlinkSync(progressPath); } catch (e) {}
          tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
          return;
        }

        // STEP 4: Get main clip duration
        let mainDuration = duration;
        try {
          const probe = await runCommand(ffmpegPath, [
            '-i', mainSegment, '-f', 'null', '-'
          ], { timeout: 10000 }).catch(() => null);
        } catch (e) {}

        // STEP 5: Split main clip and interleave B-Roll
        writeProgress('Splicing B-Roll into clip...');

        // Sort B-Roll by position in the clip
        const sortedBroll = brollSegments.map(b => {
          let insertAt;
          if (b.positionSec !== null && b.positionSec !== undefined) {
            insertAt = parseFloat(b.positionSec);
          } else if (b.position === 'beginning') {
            insertAt = 3;
          } else if (b.position === 'end') {
            insertAt = Math.max(mainDuration - 8, mainDuration * 0.8);
          } else {
            insertAt = mainDuration * 0.5;
          }
          return { ...b, insertAt: Math.max(0, Math.min(insertAt, mainDuration - 2)) };
        }).sort((a, b) => a.insertAt - b.insertAt);

        // Create segments: split main clip at each insertion point
        const parts = [];
        let currentPos = 0;

        for (let i = 0; i < sortedBroll.length; i++) {
          const br = sortedBroll[i];
          const splitAt = br.insertAt;

          // Main segment before this B-Roll
          if (splitAt > currentPos + 0.5) {
            const partFile = outputPath + `.part_main_${i}.mp4`;
            tempFiles.push(partFile);
            await runCommand(ffmpegPath, [
              '-y', '-ss', String(currentPos), '-i', mainSegment,
              '-t', String(splitAt - currentPos),
              '-c', 'copy', '-movflags', '+faststart', partFile
            ], { timeout: 30000 });
            parts.push(partFile);
          }

          // B-Roll segment
          parts.push(br.path);
          currentPos = splitAt;
        }

        // Remaining main clip after last B-Roll
        if (currentPos < mainDuration - 0.5) {
          const lastPart = outputPath + '.part_main_last.mp4';
          tempFiles.push(lastPart);
          await runCommand(ffmpegPath, [
            '-y', '-ss', String(currentPos), '-i', mainSegment,
            '-t', String(mainDuration - currentPos),
            '-c', 'copy', '-movflags', '+faststart', lastPart
          ], { timeout: 30000 });
          parts.push(lastPart);
        }

        // STEP 6: Concat all parts
        writeProgress('Combining final video...');
        const concatList = outputPath + '.concat.txt';
        tempFiles.push(concatList);
        const concatContent = parts.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(concatList, concatContent, 'utf8');

        // Re-encode concat: use video from concat but audio from main segment (keeps original audio during B-Roll)
        await runCommand(ffmpegPath, [
          '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
          '-i', mainSegment,
          '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-shortest',
          '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
          tempOutputPath
        ], { timeout: 180000 });

        // Validate and finalize
        clearTimeout(timeout);
        if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size < 50000) {
          writeError('Final video encoding failed.');
          tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
          return;
        }

        fs.renameSync(tempOutputPath, outputPath);
        try { fs.unlinkSync(progressPath); } catch (e) {}

        // Clean up all temp files
        tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
        console.log(`  B-Roll clip ready: ${filename}`);

      } catch (err) {
        clearTimeout(timeout);
        writeError(`B-Roll clip failed: ${err.message}`);
        tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
      }
    })();

  } catch (error) {
    console.error('B-Roll clip error:', error);
    res.status(500).json({ error: 'Failed to generate B-Roll clip' });
  }
});

// Main page renderer
function renderShortsPage(user, analyses, currentPage = 1, hasMore = false, teamPermissions = null) {
  let paginationHtml = '';
  if (currentPage > 1 || hasMore) { 
    const prevBtn = currentPage > 1 ? '<a href="/shorts?page=' + (currentPage - 1) + '" style="padding:8px 16px;background:#333;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;">&larr; Previous</a>' : '<span></span>';
    const nextBtn = hasMore ? '<a href="/shorts?page=' + (currentPage + 1) + '" style="padding:8px 16px;background:#333;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;">Next &rarr;</a>' : '<span></span>';
    paginationHtml = '<div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:24px;padding-bottom:16px;">' + prevBtn + '<span style="color:#888;font-size:14px;">Page ' + currentPage + '</span>' + nextBtn + '</div>';
  }

  const platformColors = {
    tiktok: '#ff0050',
    instagram: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
    shorts: '#ff0000',
    twitter: '#000000',
    linkedin: '#0077b5'
  };

  const platformIcons = {
    tiktok: 'âª',
    instagram: 'ð·',
    shorts: 'â¶ï¸',
    twitter: 'ð',
    linkedin: 'in'
  };

  return `${getHeadHTML('Smart Shorts')}
  <style>
    ${getBaseCSS()}

    /* Add-to-Calendar modal textarea: themed thin scrollbar matching sidebar */
    .atc-themed-scroll{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    .atc-themed-scroll::-webkit-scrollbar{width:6px}
    .atc-themed-scroll::-webkit-scrollbar-track{background:transparent}
    .atc-themed-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    .atc-themed-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    body.light .atc-themed-scroll,html.light .atc-themed-scroll{scrollbar-color:rgba(0,0,0,0.15) transparent}
    body.light .atc-themed-scroll::-webkit-scrollbar-thumb,html.light .atc-themed-scroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15)}

    /* Brand Kit panel: visually elevated to feel like a modal/window
       (bordered, glow ring) — matches editor-style polish. */
    #brandKitPanel.tool-panel-open {
      background: linear-gradient(180deg, var(--surface), rgba(108,58,237,0.04)) !important;
      border: 1px solid rgba(108,58,237,0.40) !important;
      box-shadow: 0 0 0 1px rgba(108,58,237,0.20), 0 18px 60px rgba(108,58,237,0.20) !important;
      border-radius: 14px !important;
      padding: 24px !important;
      margin-top: 8px;
    }

    /* Active state for Quick Action cards — persistent visual feedback while the
       paired panel is open. Selectors include !important because the cards have
       inline styles that the toggle handler resets, which would otherwise win. */
    [onclick*="toggleToolPanel"].tool-active {
      border: 1px solid #6C3AED !important;
      background: linear-gradient(180deg, rgba(108,58,237,0.14), rgba(236,72,153,0.06)) !important;
      box-shadow: 0 0 0 2px rgba(108,58,237,0.25), 0 10px 32px rgba(108,58,237,0.30) !important;
      transform: translateY(-3px) !important;
    }
    [onclick*="toggleToolPanel"].tool-active::before {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #6C3AED, #EC4899);
      pointer-events: none;
    }
    [onclick*="toggleToolPanel"].tool-active::after {
      content: '';
      position: absolute; bottom: -11px; left: 50%; transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid #6C3AED;
      filter: drop-shadow(0 2px 4px rgba(108,58,237,0.45));
      z-index: 10;
      pointer-events: none;
    }
    /* Subtle highlight on the active panel below to reinforce the visual link */
    .tool-panel.tool-panel-open {
      box-shadow: 0 0 0 1px rgba(108,58,237,0.30), 0 12px 40px rgba(108,58,237,0.18);
      border-radius: 12px;
    }

    /* Shorts-specific styles */
    .main-content {
      margin-left: 250px;
      padding: 40px;
    }

    .header {
      margin-bottom: 40px;
    }

    .header-title {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .header-subtitle {
      font-size: 16px;
      color: var(--text-muted);
    }

    /* Cards */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
      margin-top: 24px;
    }
    .card {
      background: var(--surface-light)
      border: var(--border-subtle);
      border-radius: 12px;
      padding: 24px;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
      cursor: pointer;
    }

    .card:hover {
      border-color: var(--primary);
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(108, 92, 231, 0.2);
    }

    .card-header {
      margin-bottom: 16px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .card-meta {
      font-size: 13px;
      color: var(--text-dim);
    }

    .moments-list {
      margin-top: 16px;
    }

    .moment-item {
      background: var(--dark);
      border-left: 3px solid var(--primary);
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      font-size: 13px;
    }

    .moment-item-title {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .virality-score {
      display: inline-block;
      background: var(--gradient-1);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      margin-top: 4px;
      color: #fff;
    }

    .empty-state {
      text-align: center;
      padding: 60px 40px;
      color: var(--text-dim);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text);
    }

    .empty-state-text {
      font-size: 14px;
      margin-bottom: 24px;
    }

    /* Upload Section */
    .upload-section {
      background: rgba(108, 58, 237, 0.05);
      border: 2px dashed var(--primary);
      border-radius: 12px;
      padding: 32px;
      text-align: center;
      margin-bottom: 40px;
    }

    .upload-input-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }

    .upload-input {
      flex: 1;
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 16px;
      color: var(--text);
      font-size: 14px;
    }

    .upload-input::placeholder {
      color: var(--text-dim);
    }

    .btn-primary {
      background: var(--gradient-1);
      color: #fff;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(108, 58, 237, 0.4);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-small {
      padding: 8px 16px;
      font-size: 12px;
    }

    .loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top: 2px solid #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--surface-light);
      border: var(--border-subtle);
      color: var(--text);
      padding: 16px 20px;
      border-radius: 8px;
      font-size: 14px;
      display: block !important;
      animation: slideUp 0.3s ease;
      z-index: 10000;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }

    @keyframes slideUp {
      from {
        transform: translateY(100px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 200;
      align-items: center;
      justify-content: center;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      background: var(--surface);
      border: var(--border-subtle);
      border-radius: 12px;
      padding: 32px;
      max-width: 800px;
      max-height: 85vh;
      overflow-y: auto;
      width: 95%;
      position: relative;
      /* Sidebar-matching scrollbar (see .sidebar-nav in utils/theme.js) */
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.10) transparent;
    }
    .modal-content::-webkit-scrollbar { width: 6px; }
    .modal-content::-webkit-scrollbar-track { background: transparent; }
    .modal-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
    .modal-content::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
    body.light .modal-content,
    html.light .modal-content { scrollbar-color: rgba(0,0,0,0.15) transparent; }
    body.light .modal-content::-webkit-scrollbar-thumb,
    html.light .modal-content::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); }
    body.light .modal-content::-webkit-scrollbar-thumb:hover,
    html.light .modal-content::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.28); }
    /* Apply the same scrollbar treatment to nested overflow regions
       (e.g. the Generated Content tabbed view inside the modal). */
    .modal-content [style*="overflow-y:auto"],
    .modal-content [style*="overflow-y: auto"] {
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.10) transparent;
    }
    .modal-content [style*="overflow-y:auto"]::-webkit-scrollbar,
    .modal-content [style*="overflow-y: auto"]::-webkit-scrollbar { width: 6px; }
    .modal-content [style*="overflow-y:auto"]::-webkit-scrollbar-track,
    .modal-content [style*="overflow-y: auto"]::-webkit-scrollbar-track { background: transparent; }
    .modal-content [style*="overflow-y:auto"]::-webkit-scrollbar-thumb,
    .modal-content [style*="overflow-y: auto"]::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
    .modal-content [style*="overflow-y:auto"]::-webkit-scrollbar-thumb:hover,
    .modal-content [style*="overflow-y: auto"]::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
    body.light .modal-content [style*="overflow-y:auto"],
    body.light .modal-content [style*="overflow-y: auto"] { scrollbar-color: rgba(0,0,0,0.15) transparent; }
    body.light .modal-content [style*="overflow-y:auto"]::-webkit-scrollbar-thumb,
    body.light .modal-content [style*="overflow-y: auto"]::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); }

    .moment-video-wrap {
      position: relative;
      width: 100%;
      max-height: 180px;
      margin-bottom: 12px;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
    }

    .moment-video-wrap img {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      border: none;
      border-radius: 8px;
    }

    .modal-header {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .modal-title {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 4px;
      letter-spacing: -0.3px;
    }

    .modal-header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 12px;
    }
    .modal-header-btn {
      padding: 8px 16px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: var(--dark);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .modal-header-btn:hover {
      background: var(--surface);
      border-color: var(--primary);
      color: var(--primary);
    }
    .modal-header-btn.export {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    .modal-header-btn.export:hover {
      background: var(--primary-light);
      box-shadow: 0 2px 12px rgba(108, 58, 237, 0.3);
    }
    .moment-count-badge {
      font-size: 13px;
      color: var(--text-muted);
      flex: 1;
    }
    body.light .modal-header {
      border-bottom-color: rgba(108,58,237,0.08);
    }
    body.light .modal-header-btn {
      background: rgba(108,58,237,0.06);
      border-color: rgba(108,58,237,0.12);
    }
    body.light .modal-header-btn:hover {
      background: rgba(108,58,237,0.12);
    }
    body.light .modal-header-btn.export {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    body.light .modal-header-btn.export:hover {
      background: var(--primary-light);
      color: #fff;
    }
    body.light .clip-tool-btn.primary {
      background: var(--primary);
      color: #fff;
    }
    body.light .clip-tool-btn.accent {
      background: linear-gradient(135deg, #FF0050 0%, #FF4500 100%);
      color: #fff;
    }

    /* Modal close button — matches the site's standard close pattern
       (see .narrationModal close at line ~6261 and the various tool-panel
       close buttons): transparent background, text-muted color, sits in
       the top-right corner of its container, hovers to full text color. */
    .modal-close {
      position: absolute;
      top: 14px;
      right: 16px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      color: var(--text-muted);
      font-size: 20px;
      line-height: 1;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      z-index: 2;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .modal-close:hover {
      background: rgba(255,255,255,0.12);
      color: var(--text);
      border-color: rgba(255,255,255,0.2);
    }
    body.light .modal-close,
    html.light .modal-close {
      background: rgba(108,58,237,0.06);
      border-color: rgba(108,58,237,0.12);
      color: var(--text-muted);
    }
    body.light .modal-close:hover,
    html.light .modal-close:hover {
      background: rgba(108,58,237,0.12);
      color: var(--text);
    }

    .platform-selector {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .platform-badge {
      padding: 12px 16px;
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 13px;
      font-weight: 600;
      background: var(--surface-light);
      color: var(--text);
    }

    .platform-badge.selected {
      border-color: var(--primary);
      background: rgba(108, 58, 237, 0.1);
    }

    .moment-card {
      background: var(--dark);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 16px;
      cursor: pointer;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    .moment-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--gradient-1);
      opacity: 0;
      transition: opacity 0.3s;
    }

    .moment-card:hover {
      border-color: rgba(108, 58, 237, 0.3);
      background: rgba(108, 58, 237, 0.04);
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(108, 58, 237, 0.08);
    }
    .moment-card:hover::before { opacity: 1; }

    .moment-card.selected {
      border-color: var(--primary);
      background: rgba(108, 58, 237, 0.1);
      box-shadow: 0 0 0 1px rgba(108, 58, 237, 0.2), 0 4px 20px rgba(108, 58, 237, 0.1);
    }
    .moment-card.selected::before { opacity: 1; }

    .moment-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      gap: 12px;
    }

    .moment-card-title {
      font-weight: 700;
      font-size: 15px;
      color: var(--text);
      line-height: 1.3;
    }

    .moment-score {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--gradient-1);
      font-weight: 800;
      font-size: 13px;
      color: #fff;
      letter-spacing: -0.5px;
      box-shadow: 0 2px 8px rgba(108, 58, 237, 0.3);
    }

    .moment-card-time {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .moment-card-time .time-badge {
      background: rgba(108, 58, 237, 0.12);
      color: var(--primary-light);
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 11px;
    }

    .moment-card-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 4px;
    }

    .virality-bar-wrap {
      margin-top: 10px;
      margin-bottom: 14px;
    }
    .virality-bar-track {
      height: 5px;
      background: rgba(255,255,255,0.08);
      border-radius: 3px;
      overflow: hidden;
    }
    .virality-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.6s ease;
    }
    .virality-bar-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 5px;
    }
    .virality-label {
      font-size: 10px;
      font-weight: 600;
    }
    .virality-themes {
      font-size: 10px;
      color: var(--text-muted);
    }

    .clip-toolbar {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    /* Each toolbar row groups related controls. Wraps gracefully on narrow widths. */
    .clip-toolbar-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    /* Settings row gets a subtle inset so the grouping reads visually. */
    .clip-toolbar-row.settings {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 8px 10px;
    }
    body.light .clip-toolbar-row.settings {
      background: rgba(108,58,237,0.04);
      border-color: rgba(108,58,237,0.10);
    }
    .clip-toolbar-row-label {
      font-size: 0.66rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-right: 4px;
      flex-shrink: 0;
    }
    .clip-tool-btn {
      padding: 6px 12px;
      background: var(--dark);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: var(--text);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      white-space: nowrap;
    }
    .clip-tool-btn:hover {
      background: var(--surface);
      border-color: var(--primary);
      color: var(--primary);
    }
    .clip-tool-btn.primary {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    .clip-tool-btn.primary:hover {
      background: var(--primary-light);
      box-shadow: 0 2px 12px rgba(108, 58, 237, 0.3);
    }
    .clip-tool-btn.accent {
      background: linear-gradient(135deg, #FF0050 0%, #FF4500 100%);
      color: #fff;
      border-color: transparent;
    }
    .clip-tool-btn.accent:hover {
      box-shadow: 0 2px 12px rgba(255, 0, 80, 0.3);
      transform: translateY(-1px);
    }
    .clip-tool-select {
      font-size: 11px;
      padding: 5px 8px;
      background: var(--dark);
      color: var(--text);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .clip-tool-select:hover {
      border-color: var(--primary);
    }
    .clip-captions-toggle {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: var(--dark);
      transition: all 0.2s;
    }
    .clip-captions-toggle:hover {
      border-color: var(--primary);
      color: var(--text);
    }
    /* Caption-style live preview pill, sits inline next to the
       Caption Style dropdown in the per-moment toolbar. Updated via
       window.__paintCaptionPreview, called from the select's onchange. */
    .caption-preview {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 56px;
      height: 28px;
      padding: 0 10px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.10);
      background: linear-gradient(135deg, #16131f, #0c0a14);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.06em;
      line-height: 1;
      color: #fff;
      text-transform: uppercase;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      user-select: none;
      pointer-events: none;
    }
    body.light .caption-preview {
      background: linear-gradient(135deg, #f4f0fb, #e8e1f3);
      border-color: rgba(108,58,237,0.16);
    }

    .clip-toolbar-divider {
      width: 1px;
      height: 24px;
      background: rgba(255,255,255,0.08);
      margin: 0 2px;
    }

    body.light .clip-tool-btn {
      background: rgba(108,58,237,0.06);
      border-color: rgba(108,58,237,0.12);
      color: var(--text);
    }
    body.light .clip-tool-btn:hover {
      background: rgba(108,58,237,0.12);
      border-color: var(--primary);
    }
    body.light .clip-tool-select {
      background: rgba(108,58,237,0.06);
      border-color: rgba(108,58,237,0.12);
    }
    body.light .clip-captions-toggle {
      background: rgba(108,58,237,0.06);
      border-color: rgba(108,58,237,0.12);
    }
    body.light .moment-card {
      border-color: rgba(108,58,237,0.1);
    }
    body.light .moment-card:hover {
      border-color: rgba(108,58,237,0.25);
      box-shadow: 0 4px 20px rgba(108, 58, 237, 0.06);
    }
    body.light .clip-toolbar {
      border-top-color: rgba(108,58,237,0.08);
    }
    body.light .virality-bar-track {
      background: rgba(108,58,237,0.08);
    }

    /* Calendar theme-aware styles */
    .cal-cell {
      padding: 6px; min-height: 80px; cursor: pointer; transition: background 0.2s;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
    }
    .cal-cell.cal-today {
      background: rgba(108,92,231,0.15); border: 1px solid rgba(108,92,231,0.4);
    }
    .cal-cell:hover { background: rgba(108,92,231,0.12) !important; }
    .cal-day { font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; }
    .cal-today .cal-day { font-weight: 700; color: #6c5ce7; }
    .cal-entry { font-size: 10px; padding: 3px 5px; margin-bottom: 2px; border-radius: 3px; color: var(--text-muted); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; }

    body.light .cal-cell { background: #f8f9fc; border-color: rgba(0,0,0,0.08); }
    body.light .cal-cell.cal-today { background: rgba(108,92,231,0.1); border-color: rgba(108,92,231,0.35); }
    body.light .cal-cell:hover { background: rgba(108,92,231,0.08) !important; }
    body.light .cal-day { color: #2d3748; }
    body.light .cal-today .cal-day { color: #5B21B6; }
    body.light .cal-entry { color: #4a5568; }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform 0.3s ease;
      }

      .sidebar.open {
        transform: translateX(0);
      }

      .main-content {
        margin-left: 0;
        padding: 16px;
      }

      .cards-grid {
        grid-template-columns: 1fr;
      }

      .header-title {
        font-size: 22px;
      }

      .header-subtitle {
        font-size: 13px;
      }

      .upload-input-group {
        flex-direction: column;
      }

      .upload-input {
        font-size: 14px !important;
      }

      /* Modal mobile */
      .modal-content {
        width: 100%;
        max-width: 100%;
        max-height: 100vh;
        border-radius: 0;
        padding: 16px;
      }

      .modal-title {
        font-size: 18px;
      }

      .modal-close {
        top: 10px;
        right: 10px;
        width: 30px;
        height: 30px;
        font-size: 18px;
      }

      /* Moment cards mobile */
      .moment-card {
        padding: 12px !important;
      }

      .moment-card-header {
        flex-direction: column;
        gap: 8px;
      }

      .moment-card-title {
        font-size: 15px !important;
      }

      .moment-score {
        font-size: 20px !important;
      }

      /* Upload section */
      .upload-section {
        padding: 16px !important;
      }

      /* Calendar mobile */
      #calendarGrid {
        font-size: 11px;
      }

      #calendarGrid > div {
        min-height: 60px !important;
        padding: 4px !important;
      }

      /* Brand kit grid */
      #brandKitPanel > div:nth-child(3) {
        grid-template-columns: 1fr !important;
      }

      /* Workflow grid */
      #workflowPanel .card {
        padding: 12px !important;
      }

      /* Buttons wrap on mobile */
      .moment-card div[style*="display: flex"][style*="gap: 8px"] {
        flex-direction: column;
      }

      /* Calendar entry modal */
      #calendarEntryModal > div {
        margin-top: 5vh !important;
        width: 95% !important;
        padding: 16px !important;
      }

      #calendarEntryModal div[style*="grid-template-columns: 1fr 1fr"] {
        grid-template-columns: 1fr !important;
      }

      /* Calendar header */
      div[style*="Content Calendar"] {
        flex-direction: column;
        gap: 12px;
      }
    }

    @media (max-width: 480px) {
      .main-content {
        padding: 12px;
      }

      .header-title {
        font-size: 20px;
      }

      .modal-content {
        padding: 12px;
      }

      .btn {
        font-size: 12px !important;
        padding: 8px 12px !important;
      }

      .btn-small {
        font-size: 10px !important;
        padding: 4px 8px !important;
      }

      select {
        font-size: 12px !important;
      }
    }
    /* Smart Shorts publishModal — Schedule for Later picker.
       Force the native calendar/clock indicator to PURE WHITE so the
       Date / Time picker buttons are clearly visible against the dark
       input fill (same treatment as the Video Editor modal). */
    #publishModal input[type="date"]::-webkit-calendar-picker-indicator,
    #publishModal input[type="time"]::-webkit-calendar-picker-indicator,
    #publishModal input[type="datetime-local"]::-webkit-calendar-picker-indicator{filter:brightness(0) invert(1);cursor:pointer;opacity:1;padding:4px;border-radius:4px;transition:background .15s}
    #publishModal input[type="date"]::-webkit-calendar-picker-indicator:hover,
    #publishModal input[type="time"]::-webkit-calendar-picker-indicator:hover,
    #publishModal input[type="datetime-local"]::-webkit-calendar-picker-indicator:hover{background:rgba(108,58,237,.25)}
    #publishModal input[type="date"]::-moz-calendar-picker-indicator,
    #publishModal input[type="time"]::-moz-calendar-picker-indicator,
    #publishModal input[type="datetime-local"]::-moz-calendar-picker-indicator{filter:brightness(0) invert(1);cursor:pointer;opacity:1}
    /* Match the scrollbar to the sidebar-nav design from theme.js — thin
       6px track with a soft white thumb that brightens on hover. Light
       mode follows the dashboard's inverted palette for visual parity. */
    #publishModal > div{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    #publishModal > div::-webkit-scrollbar{width:6px}
    #publishModal > div::-webkit-scrollbar-track{background:transparent}
    #publishModal > div::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    #publishModal > div::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    body.light #publishModal > div{scrollbar-color:rgba(0,0,0,0.15) transparent}
    body.light #publishModal > div::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15)}
    body.light #publishModal > div::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.25)}
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
</head>
<body class="dashboard">
  ${getThemeToggle()}
  ${getBrandKitModal()}
  ${getSidebar('shorts', user, teamPermissions)}

  <!-- Main content -->
  <main class="main-content">
      <div class="header">
        <h1 class="header-title"><img src="/images/section-icons/A-1.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Smart Shorts</h1>
        <p class="header-subtitle">Transform any YouTube video into viral short-form content</p>
      </div>

      <!-- Upload section -->
      <div class="upload-section">
        <div style="margin-bottom: 16px;">
          <h3 style="margin-bottom: 8px;">Analyze a YouTube Video</h3>
          <p style="color: #888; font-size: 14px;">Paste a YouTube URL to extract viral moments</p>
        </div>
        <div class="upload-input-group">
          <input
            type="url"
            class="upload-input"
            id="videoUrl"
            name="yt_video_search_url_field"
            autocomplete="one-time-code"
            autocorrect="off"
            spellcheck="false"
            data-form-type="other"
            data-lpignore="true"
            placeholder="https://youtube.com/watch?v=..."
          >
          <button class="btn btn-primary" onclick="analyzeVideo()">
            <span id="analyzeBtn">Analyze</span>
          </button>
        </div>
      </div>

      <!-- Premium Tools Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
        <div onclick="toggleToolPanel('quickNarratePanel', this)" style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:14px;padding:20px 16px;cursor:pointer;transition:all 0.25s ease;text-align:center;position:relative;overflow:hidden;" onmouseenter="this.style.borderColor='#00b894';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,184,148,0.15)'" onmouseleave="if(!this.classList.contains('tool-active')){this.style.borderColor='var(--border-subtle)';this.style.transform='none';this.style.boxShadow='none'}">
          <div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;overflow:hidden;"><img src="/images/section-icons/A-73.png" alt="Quick Narrate" style="width:48px;height:48px;object-fit:cover;border-radius:12px;"></div>
          <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;">Quick Narrate</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.4;">Add AI voiceover to any video</div>
        </div>
        <div onclick="toggleToolPanel('workflowPanel', this); toggleWorkflows(true)" style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:14px;padding:20px 16px;cursor:pointer;transition:all 0.25s ease;text-align:center;position:relative;overflow:hidden;" onmouseenter="this.style.borderColor='#f39c12';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(243,156,18,0.15)'" onmouseleave="if(!this.classList.contains('tool-active')){this.style.borderColor='var(--border-subtle)';this.style.transform='none';this.style.boxShadow='none'}">
          <div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;overflow:hidden;"><img src="/images/section-icons/A-45.png" alt="Workflow Templates" style="width:48px;height:48px;object-fit:cover;border-radius:12px;"></div>
          <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;">Workflow Templates</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.4;">Pre-built automation flows</div>
        </div>
        <div onclick="toggleToolPanel('batchPanel', this); toggleBatchInput(true)" style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:14px;padding:20px 16px;cursor:pointer;transition:all 0.25s ease;text-align:center;position:relative;overflow:hidden;" onmouseenter="this.style.borderColor='#FF0050';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(255,0,80,0.15)'" onmouseleave="if(!this.classList.contains('tool-active')){this.style.borderColor='var(--border-subtle)';this.style.transform='none';this.style.boxShadow='none'}">
          <div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;overflow:hidden;"><img src="/images/section-icons/A-12.png" alt="Batch Analyze" style="width:48px;height:48px;object-fit:cover;border-radius:12px;"></div>
          <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;">Batch Analyze</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.4;">Process multiple videos at once</div>
        </div>
        <div onclick="openBrandKitModal()" style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:14px;padding:20px 16px;cursor:pointer;transition:all 0.25s ease;text-align:center;position:relative;overflow:hidden;" onmouseenter="this.style.borderColor='#a29bfe';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(108,92,231,0.15)'" onmouseleave="if(!this.classList.contains('tool-active')){this.style.borderColor='var(--border-subtle)';this.style.transform='none';this.style.boxShadow='none'}">
          <div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;overflow:hidden;"><img src="/images/section-icons/A-32.png" alt="Brand Kit" style="width:48px;height:48px;object-fit:cover;border-radius:12px;"></div>
          <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;">Brand Kit</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.4;">Customize with your brand identity</div>
        </div>
        <div onclick="toggleToolPanel('autoGenPanel', this)" style="background:var(--surface);border:1px solid var(--border-subtle);border-radius:14px;padding:20px 16px;cursor:pointer;transition:all 0.25s ease;text-align:center;position:relative;overflow:hidden;" onmouseenter="this.style.borderColor='#e056fd';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(224,86,253,0.15)'" onmouseleave="if(!this.classList.contains('tool-active')){this.style.borderColor='var(--border-subtle)';this.style.transform='none';this.style.boxShadow='none'}">
          <div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;overflow:hidden;"><img src="/images/section-icons/A-46.png" alt="Auto-Generate" style="width:48px;height:48px;object-fit:cover;border-radius:12px;"></div>
          <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;">Auto-Generate</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.4;">Create multiple shorts instantly</div>
        </div>
      </div>

      <!-- Auto-Generate Shorts Panel -->
      <div style="margin-bottom: 16px;">
        <div id="autoGenPanel" style="display:none; margin-top:0px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:700; display:flex; align-items:center; gap:8px;"><img src="/images/section-icons/A-46.png" alt="" style="height:22px;width:22px;border-radius:5px"> Auto-Generate Shorts</h3>
              <p style="color:#888; font-size:12px; margin-top:4px;">Paste a YouTube URL and we'll automatically create multiple ready-to-post shorts</p>
            </div>
            <button class="btn btn-small" onclick="document.getElementById('autoGenPanel').style.display='none'" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:16px;border:none;cursor:pointer;">&times;</button>
          </div>

          <div style="display:flex;gap:8px;margin-bottom:16px;">
            <input type="url" id="ag-videoUrl" name="auto_gen_url" autocomplete="off" placeholder="https://youtube.com/watch?v=..."
              style="flex:1;padding:12px 14px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:var(--text);font-size:14px;">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px;">Number of Shorts</label>
              <div style="display:flex;align-items:center;gap:10px;">
                <input type="range" id="ag-count" min="1" max="20" value="10" style="flex:1;accent-color:#e056fd;"
                  oninput="document.getElementById('ag-count-val').textContent=this.value">
                <span id="ag-count-val" style="font-size:18px;font-weight:700;color:#e056fd;min-width:28px;text-align:center;">10</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-top:2px;">
                <span>1</span><span>20</span>
              </div>
            </div>
            <div>
              <label style="display:block;font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px;">Duration per Short</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="ag-dur-btn ag-dur-active" data-dur="30" onclick="selectAgDuration(this)" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(224,86,253,0.15);color:#e056fd;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">30s</button>
                <button class="ag-dur-btn" data-dur="45" onclick="selectAgDuration(this)" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark);color:var(--text-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">45s</button>
                <button class="ag-dur-btn" data-dur="60" onclick="selectAgDuration(this)" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark);color:var(--text-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">60s</button>
                <button class="ag-dur-btn" data-dur="90" onclick="selectAgDuration(this)" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark);color:var(--text-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">90s</button>
                <button class="ag-dur-btn" data-dur="custom" onclick="selectAgDuration(this);document.getElementById('ag-custom-dur').style.display='inline-block'" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark);color:var(--text-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">Custom</button>
                <input type="number" id="ag-custom-dur" min="10" max="180" value="60" placeholder="sec" style="display:none;width:60px;padding:6px 8px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;text-align:center;">
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;">Clip Style</label>
              <select id="ag-clipStyle" style="width:100%;padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
                <option value="crop">Center Crop</option>
                <option value="blur">Blur Background</option>
                <option value="fit">Fit (Black BG)</option>
                <option value="pip">Picture-in-Picture</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;">Captions</label>
              <select id="ag-captionStyle" style="width:100%;padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
                <option value="trending">Trending</option>
                <option value="bold">Bold</option>
                <option value="karaoke">Word Pop</option>
                <option value="classic">Classic</option>
                <option value="minimal">Minimal</option>
                <option value="neon">Neon Glow</option>
                <option value="bold-pop">Bold Pop</option>
                <option value="gradient-wave">Gradient Wave</option>
                <option value="typewriter">Typewriter</option>
                <option value="cinematic">Cinematic</option>
                <option value="street">Street</option>
                <option value="hormozi">Hormozi</option>
                <option value="mrbeast">MrBeast</option>
                <option value="classic-sub">Classic Subtitle</option>
                <option value="outline-style">Outline</option>
                <option value="soft-glow">Soft Glow</option>
                <option value="retro-vhs">Retro VHS</option>
                <option value="comic">Comic</option>
                <option value="fire">Fire</option>
                <option value="clean-modern">Clean Modern</option>
                <option value="podcast">Podcast</option>
                <option value="tiktok-trend">TikTok Trending</option>
                <option value="shadow-drop">Shadow Drop</option>
                <option value="none">No Captions</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;">Language</label>
              <select id="ag-lang" style="width:100%;padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="pt">Portuguese</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="hi">Hindi</option>
                <option value="ar">Arabic</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
          </div>

          <div style="display:flex;gap:10px;align-items:center;">
            <button class="btn btn-primary" id="ag-btn" onclick="autoGenerateShorts()" style="background:linear-gradient(135deg,#e056fd,#a29bfe);padding:12px 28px;font-size:14px;font-weight:700;border-radius:10px;border:none;color:#fff;cursor:pointer;transition:all 0.3s;box-shadow:0 4px 20px rgba(224,86,253,0.3);">
              <img src="/images/section-icons/A-89.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Shorts
            </button>
            <span id="ag-status" style="font-size:13px;color:var(--text-muted);"></span>
          </div>

          <!-- Progress section -->
          <div id="ag-progress" style="display:none;margin-top:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:13px;font-weight:600;color:var(--text);" id="ag-progress-label">Generating...</span>
              <span style="font-size:13px;font-weight:700;color:#e056fd;" id="ag-progress-count">0/0</span>
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
              <div id="ag-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#e056fd,#a29bfe);border-radius:3px;transition:width 0.5s;"></div>
            </div>
          </div>

          <!-- Results grid -->
          <div id="ag-results" style="display:none;margin-top:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h4 style="font-size:15px;font-weight:700;color:var(--text);">Generated Shorts</h4>
              <button class="btn btn-primary" id="ag-download-all" onclick="downloadAllAutoGenClips()" style="background:linear-gradient(135deg,#e056fd,#a29bfe);padding:8px 20px;font-size:12px;font-weight:600;border-radius:8px;border:none;color:#fff;cursor:pointer;">
                <img src="/images/section-icons/A-94.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Download All (ZIP)
              </button>
            </div>
            <div id="ag-results-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;"></div>
          </div>
        </div>
      </div>

      <!-- Quick Narrate Tool -->
      <div style="margin-bottom: 16px;">
        <div id="quickNarratePanel" style="display:none; margin-top:0px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <h3 style="font-size:16px; font-weight:600;"><img src="/images/section-icons/A-73.png" alt="" style="height:22px;width:22px;border-radius:5px;vertical-align:middle;margin-right:4px"> Quick Narrate</h3>
              <p style="color:#888; font-size:12px; margin-top:2px;">Paste any video URL (YouTube, Instagram, TikTok, Facebook, Twitter/X, LinkedIn, Snapchat) and add AI narration over it</p>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <a href="/settings?section=apikeys" title="Open API Keys settings" aria-label="API Keys settings"
                style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:var(--text-muted);text-decoration:none;font-size:14px;transition:background 0.15s ease,color 0.15s ease,border-color 0.15s ease;"
                onmouseenter="this.style.background='rgba(255,255,255,0.12)';this.style.color='var(--text)';this.style.borderColor='rgba(255,255,255,0.2)';"
                onmouseleave="this.style.background='rgba(255,255,255,0.06)';this.style.color='var(--text-muted)';this.style.borderColor='rgba(255,255,255,0.10)';"
                >&#x2699;</a>
              <button class="btn btn-small" onclick="document.getElementById('quickNarratePanel').style.display='none'" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times;</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <input type="url" id="qn-videoUrl" name="quick_narrate_url" autocomplete="off" placeholder="Paste video URL — YouTube, Instagram, TikTok, Facebook, Twitter/X..."
              style="flex:1;padding:10px 12px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:14px;">
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            <select id="qn-style" style="padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
              <option value="funny">😂 Funny</option>
              <option value="documentary"><img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Documentary</option>
              <option value="dramatic"><img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Dramatic</option>
              <option value="hype">🔥 Hype</option>
              <option value="sarcastic">😏 Sarcastic</option>
              <option value="storytime">📖 Storytime</option>
              <option value="news">📺 News</option>
              <option value="poetic"><img src="/images/section-icons/A-93.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Poetic</option>
            </select>
            <select id="qn-mix" style="padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
              <option value="mix"><img src="/images/section-icons/A-6.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Mix Audio (30% original)</option>
              <option value="replace">🔇 Replace Audio</option>
            </select>
            <select id="qn-provider" style="padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;" onchange="if(this.value==='elevenlabs'){document.getElementById('qn-el-voices').style.display='inline-block';loadQNElevenLabsVoices();}else{document.getElementById('qn-el-voices').style.display='none';}">
              <option value="openai">OpenAI TTS</option>
              <option value="elevenlabs">ElevenLabs</option>
            </select>
            <select id="qn-el-voices" style="display:none;padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
              <option value="">Select voice...</option>
            </select>
          </div>
          <div style="margin-bottom:12px;">
            <textarea id="qn-customScript" placeholder="(Optional) Write your own narration script here, or leave blank for AI to generate one..."
              style="width:100%;padding:10px 12px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:13px;resize:vertical;min-height:60px;font-family:inherit;"></textarea>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="btn btn-primary" id="qn-btn" onclick="quickNarrate()" style="background:linear-gradient(135deg,#00b894,#00cec9);padding:10px 24px;">
              <img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Narrated Video
            </button>
            <button class="btn" onclick="downloadQuickNarrateScript()" style="background:transparent;border:1px solid var(--text-muted);color:var(--text-muted);padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;">📄 Download Script</button> <span id="qn-status" style="font-size:13px;color:var(--text-muted);"></span>
          </div>
        </div>
      </div>

      <!-- Workflow Templates -->
      <div style="margin-bottom: 16px;">
        <div id="workflowPanel" style="display:none; margin-top:0px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <p style="color:#888;font-size:13px;">Select a workflow to auto-configure clip settings</p>
            <button class="btn btn-small" onclick="toggleWorkflows()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-tiktok')">
              <div style="margin-bottom:8px;"><img src="/images/section-icons/A-47.png" alt="" style="height:32px;width:32px;border-radius:6px"></div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to TikTok</div>
              <div style="font-size:12px;color:var(--text-muted);">Blur background, auto-captions, TikTok-optimized content with trending hashtags</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">Blur BG</span>
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">Captions ON</span>
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">TikTok + IG</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-shorts')">
              <div style="margin-bottom:8px;"><img src="/images/section-icons/A-48.png" alt="" style="height:32px;width:32px;border-radius:6px"></div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to YT Shorts</div>
              <div style="font-size:12px;color:var(--text-muted);">Center crop for full-frame, captions, Shorts-optimized with SEO description</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Center Crop</span>
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Captions ON</span>
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Shorts Only</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-linkedin')">
              <div style="margin-bottom:8px;"><img src="/images/section-icons/A-49.png" alt="" style="height:32px;width:32px;border-radius:6px"></div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to LinkedIn</div>
              <div style="font-size:12px;color:var(--text-muted);">Fit style with clean background, professional content + blog post</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">Fit Style</span>
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">No Captions</span>
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">LinkedIn + Blog</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-all')">
              <div style="margin-bottom:8px;"><img src="/images/section-icons/A-59.png" alt="" style="height:32px;width:32px;border-radius:6px"></div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to Everything</div>
              <div style="font-size:12px;color:var(--text-muted);">Maximum reach: blur BG clip, captions, content for all 8 platforms, thumbnail</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">Blur BG</span>
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">All Platforms</span>
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">+ Thumbnail</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('podcast')">
              <div style="margin-bottom:8px;"><img src="/images/section-icons/A-60.png" alt="" style="height:32px;width:32px;border-radius:6px"></div>
              <div style="font-weight:600;margin-bottom:4px;">Podcast to Clips</div>
              <div style="font-size:12px;color:var(--text-muted);">PiP style for talking heads, bold captions, Twitter thread + newsletter</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(243,156,18,0.2);color:#f39c12;padding:2px 6px;border-radius:4px;">PiP Style</span>
                <span style="font-size:10px;background:rgba(243,156,18,0.2);color:#f39c12;padding:2px 6px;border-radius:4px;">Thread + Newsletter</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('education')">
              <div style="margin-bottom:8px;"><img src="/images/section-icons/A-63.png" alt="" style="height:32px;width:32px;border-radius:6px"></div>
              <div style="font-weight:600;margin-bottom:4px;">Education to Blog</div>
              <div style="font-size:12px;color:var(--text-muted);">Fit style, captions for accessibility, long-form blog + LinkedIn article</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(16,185,129,0.2);color:#10b981;padding:2px 6px;border-radius:4px;">Fit Style</span>
                <span style="font-size:10px;background:rgba(16,185,129,0.2);color:#10b981;padding:2px 6px;border-radius:4px;">Blog + LinkedIn</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Batch Analysis -->
      <div style="margin-bottom: 16px;">
        <div id="batchPanel" style="display:none; margin-top:0px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <h3 style="font-size:16px; font-weight:600;">Batch Video Analysis</h3>
            <button class="btn btn-small" onclick="toggleBatchInput()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <p style="color:#888; font-size:13px; margin-bottom:16px;">Paste up to 10 YouTube URLs (one per line) to analyze them all at once.</p>
          <textarea id="batchUrls" rows="6" autocomplete="off" placeholder="https://youtube.com/watch?v=...&#10;https://youtube.com/watch?v=...&#10;https://youtube.com/watch?v=..."
            style="width:100%; padding:12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:13px; resize:vertical; font-family:monospace;"></textarea>
          <div style="margin-top:12px; display:flex; gap:10px; align-items:center;">
            <button class="btn btn-primary" onclick="startBatchAnalysis()" id="batchBtn">Analyze All</button>
            <span id="batchStatus" style="font-size:13px; color:#888;"></span>
          </div>
          <div id="batchResults" style="display:none; margin-top:16px;"></div>
        </div>
      </div>

      <!-- Brand Kit Settings -->
      <div style="margin-bottom: 24px;">
        <div id="brandKitPanel" style="display:none; margin-top:0px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:16px; font-weight:600;">Brand Kit</h3>
            <button class="btn btn-small" onclick="toggleBrandKit()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <p style="color:#888; font-size:13px; margin-bottom:20px;">Customize your clips with your brand identity. Watermark text appears on all generated clips.</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Brand Name</label>
              <input type="text" id="bk-brandName" placeholder="My Brand"
                style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Watermark Text</label>
              <input type="text" id="bk-watermarkText" placeholder="@mybrand"
                style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Primary Color</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="color" id="bk-primaryColor" value="#FF0050"
                  style="width:40px; height:40px; border:none; border-radius:8px; cursor:pointer; background:none;">
                <input type="text" id="bk-primaryColorText" value="#FF0050"
                  style="flex:1; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px; font-family:monospace;"
                  oninput="document.getElementById('bk-primaryColor').value=this.value">
              </div>
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Secondary Color</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="color" id="bk-secondaryColor" value="#6c5ce7"
                  style="width:40px; height:40px; border:none; border-radius:8px; cursor:pointer; background:none;">
                <input type="text" id="bk-secondaryColorText" value="#6c5ce7"
                  style="flex:1; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px; font-family:monospace;"
                  oninput="document.getElementById('bk-secondaryColor').value=this.value">
              </div>
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Font Style</label>
              <select id="bk-fontStyle"
                style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px; cursor:pointer;">
                <option value="modern">Modern (Sans-serif)</option>
                <option value="bold">Bold Impact</option>
                <option value="elegant">Elegant (Serif)</option>
                <option value="handwritten">Handwritten</option>
              </select>
            </div>
          </div>
          <div style="margin-top:20px; display:flex; gap:10px; align-items:center;">
            <button class="btn btn-primary" onclick="saveBrandKit()" id="bk-saveBtn"
              style="padding:10px 24px;">Save Brand Kit</button>
            <span id="bk-status" style="font-size:13px; color:#888;"></span>
          </div>
          <div id="bk-preview" style="display:none; margin-top:16px; padding:16px; background:#000; border-radius:8px;">
            <p style="font-size:12px; color:#666; margin-bottom:8px;">Preview:</p>
            <div style="position:relative; width:200px; height:356px; background:#1a1a2e; border-radius:8px; overflow:hidden;">
              <div id="bk-preview-watermark" style="position:absolute; bottom:10px; right:10px; font-size:14px; opacity:0.6;"></div>
            </div>
          </div>
        </div>
      </div>

            <!-- Settings Panel -->
            <div style="margin-bottom: 24px;">
            <div id="settingsPanel" style="display:none; margin-top:0px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-size:16px; font-weight:600;"><img src="/images/section-icons/A-100.png" alt="" style="height:22px;width:22px;border-radius:5px;vertical-align:middle;margin-right:4px"> Settings</h3>
                <button class="btn btn-small" onclick="toggleSettings()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
              </div>
              <p style="color:#888; font-size:13px; margin-bottom:20px;">Configure your API keys and integrations.</p>
              <div style="max-width:500px;">
                <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;"><img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> ElevenLabs API Key <span style="color:#888;font-weight:400;">(optional — for premium AI voices in narration)</span></label>
                <input type="password" id="settings-elevenlabsApiKey" placeholder="Enter your ElevenLabs API key..."
                  style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px;">
                <p style="font-size:11px; color:#666; margin-top:4px;">Get your key at <a href="https://elevenlabs.io" target="_blank" style="color:#a29bfe;">elevenlabs.io</a> — enables custom AI voices for narrated clips</p>
              </div>
              <div style="margin-top:20px; display:flex; gap:10px; align-items:center;">
                <button class="btn btn-primary" onclick="saveSettings()" id="settings-saveBtn"
                  style="padding:10px 24px;">Save Settings</button>
                <span id="settings-status" style="font-size:13px; color:#888;"></span>
              </div>
            </div>
            </div>

      <!-- Analyses grid -->
      <div id="analysesContainer">
        ${analyses.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon"><img src="/images/section-icons/A-1.png" alt="" style="height:48px;width:48px;border-radius:10px"></div>
            <h3 class="empty-state-title">No analyses yet</h3>
            <p class="empty-state-text">Paste a YouTube URL above to get started</p>
          </div>
        ` : `
          <div class="cards-grid">
            ${analyses.map(analysis => {
              // Extract video ID for thumbnail
              const ytRegex = new RegExp('(?:youtube\\.com/watch\\?v=|youtu\\.be/|youtube\\.com/embed/|youtube\\.com/shorts/)([a-zA-Z0-9_-]{11})');
              const vidMatch = (analysis.video_url || '').match(ytRegex);
              const vidId = vidMatch ? vidMatch[1] : null;
              return `
              <div class="card" onclick="viewAnalysis('${analysis.id}')" style="position:relative;">
                <button onclick="event.stopPropagation(); event.preventDefault(); deleteAnalysis('${analysis.id}', this); return false;" title="Delete"
                  style="position:absolute; top:10px; right:10px; background:rgba(239,68,68,0.9); border:2px solid rgba(255,255,255,0.3); color:#fff;
                  width:30px; height:30px; border-radius:50%; cursor:pointer; font-size:14px; display:flex;
                  align-items:center; justify-content:center; z-index:10; transition:all 0.2s; font-weight:bold;"
                  onmouseover="this.style.background='#ef4444'; this.style.transform='scale(1.15)'"
                  onmouseout="this.style.background='rgba(239,68,68,0.9)'; this.style.transform='scale(1)'"
                >&times;</button>
                ${vidId ? `<img src="https://img.youtube.com/vi/${vidId}/mqdefault.jpg" alt="Video thumbnail" style="width:100%;border-radius:8px;margin-bottom:12px;aspect-ratio:16/9;object-fit:cover;">` : ''}
                <div class="card-header">
                  <div class="card-title">${analysis.video_title || 'YouTube Video'}</div>
                  <div class="card-meta">${new Date(analysis.created_at).toLocaleDateString()}</div>
                </div>
                <div class="card-meta" style="margin-bottom: 12px;">${analysis.status === 'completed' ? analysis.moments?.length || 0 : 0} moments</div>
                <div class="moments-list">
                  ${(analysis.moments || []).slice(0, 3).map((moment, idx) => `
                    <div class="moment-item">
                      <div class="moment-item-title">${moment.title || 'Moment'}</div>
                      <div class="virality-score">${moment.viralityScore || 0}% viral</div>
                    </div>
                  `).join('')}
                  ${(analysis.moments?.length || 0) > 3 ? '<div style="padding: 8px 0; color: #666; font-size: 12px;">+' + ((analysis.moments?.length || 0) - 3) + ' more</div>' : ''}
                </div>
              </div>
            `}).join('')}
          </div>
        `}
      </div>

${paginationHtml}
          <!-- Floating Calendar Button -->
    <button id="calendarFloatBtn" onclick="openShortsCalendar()" style="position:fixed;top:18px;right:24px;z-index:100000;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:50px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(108,58,237,0.4);display:flex;align-items:center;gap:8px;transition:transform 0.2s;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Calendar
    </button>

    <!-- Calendar Modal — read-only schedule preview with platform logos per day -->
    <div id="calendarModal" style="display:none;position:fixed;inset:0;background:rgba(8,6,18,0.78);backdrop-filter:blur(6px);z-index:100001;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)this.style.display='none';">
      <div style="background:linear-gradient(180deg,#1a1a2e,rgba(108,58,237,0.06));border:1px solid rgba(108,58,237,0.40);border-radius:16px;padding:24px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;margin:auto;box-shadow:0 0 0 1px rgba(108,58,237,0.20),0 20px 60px rgba(108,58,237,0.20),0 30px 80px rgba(0,0,0,0.5);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <h2 style="font-size:1.2rem;font-weight:800;margin:0;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;">Content Calendar</h2>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button onclick="changeCalendarMonth(-1)" title="Previous month" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:#e2e0f0;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;">&larr;</button>
            <span id="calendarMonthLabel" style="font-size:13px;font-weight:700;min-width:140px;text-align:center;color:#e2e0f0;letter-spacing:.02em;"></span>
            <button onclick="changeCalendarMonth(1)" title="Next month" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:#e2e0f0;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;">&rarr;</button>
            <button onclick="goToCalendarToday()" title="Today" style="background:rgba(108,58,237,0.12);border:1px solid rgba(108,58,237,0.30);color:#a78bfa;height:32px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">Today</button>
            <button onclick="document.getElementById('calendarModal').style.display='none';" title="Close" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:4px 10px;line-height:1;">&times;</button>
          </div>
        </div>
        <div style="font-size:0.75rem;color:#8886a0;margin-bottom:14px;">Read-only preview. Manage entries on the <a href="/dashboard/calendar" style="color:#a78bfa;text-decoration:none;font-weight:600;">Calendar page</a>.</div>
        <style>#calendarGrid svg{width:100%;height:100%;display:block}</style><div id="calendarGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"></div>
      </div>
    </div>
    <!-- Add-to-Calendar Modal (opened from a moment card via addToCalendar()) -->
    <div id="atcModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:9998;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closeAtcModal()">
      <div style="background:var(--surface);border:1px solid rgba(108,58,237,0.25);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;gap:8px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Schedule This Moment</h3>
        <div style="color:var(--text-muted);font-size:0.82rem;margin-bottom:18px;" id="atcSubtitle">—</div>
        <input type="hidden" id="atcMomentRef">
        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Title</label>
        <input type="text" id="atcTitle" maxlength="120" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Platform</label>
            <select id="atcPlatform" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="shorts">YouTube Shorts</option>
              <option value="youtube">YouTube</option>
              <option value="twitter">Twitter / X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="facebook">Facebook</option>
              <option value="blog">Blog Post</option>
              <option value="newsletter">Newsletter</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Status</label>
            <select id="atcStatus" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
              <option value="planned">Planned</option>
              <option value="drafted">Drafted</option>
              <option value="ready">Ready</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Date</label>
            <input type="date" id="atcDate" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          </div>
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Time</label>
            <input type="time" id="atcTime" value="12:00" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          </div>
        </div>
        <button type="button" id="atcPeakBtn" onclick="atcSuggestPeakTime()" style="display:flex;align-items:center;gap:8px;width:100%;background:linear-gradient(135deg,rgba(108,58,237,0.10),rgba(236,72,153,0.06));border:1px solid rgba(108,58,237,0.30);border-radius:8px;padding:10px 12px;color:#a78bfa;cursor:pointer;font-family:inherit;font-size:0.82rem;font-weight:600;margin-bottom:14px;transition:all .15s">
          <img src="/images/section-icons/A-93.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Suggest peak time for this platform
          <span id="atcPeakHint" style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:auto;text-align:right;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </button>
        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Notification</label>
        <select id="atcReminder" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          <option value="0">None</option>
          <option value="15">15 minutes before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
          <option value="2880">2 days before</option>
        </select>
        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Notes</label>
        <textarea id="atcNotes" class="atc-themed-scroll" rows="5" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;resize:vertical;min-height:90px;"></textarea>
        <!-- Auto-publish toggle: when ON, the server cron will pick up this
             entry at scheduled time and post it to the selected platform.
             When OFF, we just keep it as a planned calendar item + reminder.
             Hidden for blog/newsletter (no third-party publish path). -->
        <label id="atcAutoPubRow" style="display:flex;align-items:center;gap:10px;background:rgba(108,58,237,0.06);border:1px solid rgba(108,58,237,0.18);border-radius:8px;padding:10px 12px;margin-bottom:14px;cursor:pointer;">
          <input type="checkbox" id="atcAutoPublish" style="accent-color:#a78bfa;width:14px;height:14px;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;font-weight:600;color:var(--text);">Auto-publish at scheduled time</div>
            <div id="atcAutoPubHint" style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">When the date and time arrive, this clip will be posted to the selected platform automatically.</div>
          </div>
        </label>
        <!-- Connection-gate banner: shown when the selected platform isn't
             connected yet. updateAtcConnectionState() toggles this. -->
        <div id="atcConnectBanner" style="display:none;background:rgba(255,180,0,0.08);border:1px solid rgba(255,180,0,0.35);color:#ffd591;border-radius:8px;padding:10px 12px;margin-top:8px;font-size:0.8rem;line-height:1.4;">
          <div id="atcConnectMsg" style="margin-bottom:8px;"></div>
          <a id="atcConnectLink" href="#" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:0.4rem 0.9rem;border-radius:6px;font-weight:600;font-size:0.78rem;">
            <span id="atcConnectLinkLabel">Connect</span>
            <span style="font-size:0.9em;">&rarr;</span>
          </a>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button onclick="closeAtcModal()" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button>
          <button id="atcSaveBtn" onclick="saveAtcEntry()" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Save to Calendar</button>
        </div>
      </div>
    </div>

    <!-- Phase 2b — Publish Modal. Opened from each moment card's
         "Publish to..." button. Reads /api/connections to populate the
         account picker. Post Now hits the unified
         /shorts/api/publish-moment endpoint; Schedule for Later creates
         a calendar_entries row carrying the connection_id, which the
         existing schedulePublisher cron picks up. -->
    <div id="publishModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closePublishModal()">
      <div style="background:var(--surface);border:1px solid rgba(108,58,237,0.25);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
          Publish This Moment
        </h3>
        <div id="publishSubtitle" style="color:var(--text-muted);font-size:0.82rem;margin-bottom:18px;">Pick a connected account.</div>
        <input type="hidden" id="publishMomentRef">

        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Account</label>
        <select id="publishAccount" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          <option value="">Loading your connected accounts...</option>
        </select>
        <div id="publishNoAccounts" style="display:none;background:rgba(255,180,0,0.08);border:1px solid rgba(255,180,0,0.35);color:#ffd591;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;">
          You don\'t have any social accounts connected yet.
          <a href="/distribute/connections" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:0.4rem 0.9rem;border-radius:6px;font-weight:600;font-size:0.78rem;margin-top:8px;">
            Connect an account <span style="font-size:0.9em;">&rarr;</span>
          </a>
        </div>

        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Title</label>
        <input type="text" id="publishTitle" maxlength="120" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">

        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Caption / Description</label>
        <textarea id="publishCaption" rows="4" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;resize:vertical;min-height:80px;"></textarea>

        <div style="display:flex;gap:8px;margin-bottom:14px;background:var(--dark);border-radius:10px;padding:4px;border:1px solid rgba(255,255,255,0.06);">
          <button id="publishTabNow" type="button" onclick="setPublishMode(\'now\')" style="flex:1;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Post now</button>
          <button id="publishTabLater" type="button" onclick="setPublishMode(\'later\')" style="flex:1;background:transparent;color:var(--text-muted);border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Schedule for later</button>
        </div>

        <div id="publishLaterFields" style="display:none;margin-bottom:14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div>
              <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Date</label>
              <input type="date" id="publishDate" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;">
            </div>
            <div>
              <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Time</label>
              <input type="time" id="publishTime" value="12:00" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;">
            </div>
          </div>

          <!-- Suggest peak time for the picked account's platform -->
          <button type="button" id="publishPeakBtn" onclick="publishSuggestPeakTime()" style="display:flex;align-items:center;gap:8px;width:100%;background:linear-gradient(135deg,rgba(108,58,237,0.10),rgba(236,72,153,0.06));border:1px solid rgba(108,58,237,0.30);border-radius:8px;padding:10px 12px;color:#a78bfa;cursor:pointer;font-family:inherit;font-size:0.82rem;font-weight:600;margin-bottom:14px;transition:all .15s">
            <span style="font-size:1em;">&#x2728;</span> Suggest peak time for this platform
            <span id="publishPeakHint" style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:auto;text-align:right;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          </button>

          <!-- Notification reminder -->
          <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Notification</label>
          <select id="publishReminder" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:10px;" onchange="publishToggleReminderEmail()">
            <option value="0">None</option>
            <option value="15">15 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="1440">1 day before</option>
            <option value="2880">2 days before</option>
          </select>
          <input type="email" id="publishReminderEmail" placeholder="Email for reminder" style="display:none;width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          <div id="publishReminderSpacer" style="margin-bottom:14px;"></div>

          <!-- Notes -->
          <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Notes</label>
          <textarea id="publishNotes" rows="4" placeholder="Any notes for this scheduled post" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;resize:vertical;min-height:80px;"></textarea>
        </div>

        <div id="publishStatus" style="display:none;background:rgba(108,58,237,0.10);border:1px solid rgba(108,58,237,0.30);color:#c4b5fd;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;"></div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button onclick="closePublishModal()" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button>
          <button id="publishSubmitBtn" onclick="submitPublish()" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Publish</button>
        </div>
      </div>
    </div>

    <!-- Copyright disclaimer modal (Analyze gate) — shown after the user
         clicks "Analyze" on the import panel. Confirm proceeds with the
         actual analysis; Cancel aborts. -->
    <div id="analyzeConfirmModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:10001;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closeAnalyzeConfirm()">
      <div style="background:var(--surface);border:1px solid rgba(108,58,237,0.25);border-radius:16px;width:100%;max-width:480px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 14px;font-size:1.05rem;display:flex;align-items:center;gap:8px;color:var(--text);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f39c12" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Confirm rights to use this content
        </h3>
        <p style="color:var(--text-muted);font-size:0.88rem;line-height:1.55;margin:0 0 18px;">
          Please ensure you have the right to use this content. Uploading copyrighted material without permission may violate legal guidelines. By proceeding, you confirm that you own this video or have the authorization to use it.
        </p>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="analyzeConfirmCancel" type="button" onclick="closeAnalyzeConfirm()" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:0.55rem 1.1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button>
          <button id="analyzeConfirmOk" type="button" onclick="confirmAnalyze()" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.55rem 1.4rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Yes, proceed</button>
        </div>
      </div>
    </div>

</main>

  <!-- Calendar Entry Modal -->
  <!-- Day entries list modal (shows when clicking a day with entries) -->
  <div id="calendarDayModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;align-items:center;justify-content:center;">
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;max-width:400px;width:90%;margin:auto;margin-top:15vh;">
      <h3 style="margin-bottom:16px;" id="dayModalTitle">Entries</h3>
      <div id="dayModalEntries"></div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-primary" id="dayModalAddBtn" style="flex:1;">+ Add New Entry</button>
        <button class="btn" onclick="document.getElementById('calendarDayModal').style.display='none'" style="background:rgba(255,255,255,0.1);flex:1;">Close</button>
      </div>
    </div>
  </div>

  <div id="calendarEntryModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;align-items:center;justify-content:center;">
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;max-width:400px;width:90%;margin:auto;margin-top:15vh;">
      <h3 style="margin-bottom:16px;" id="calEntryTitle">Add Calendar Entry</h3>
      <input type="hidden" id="cal-entry-id">
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Title</label>
        <input type="text" id="cal-title" placeholder="Post title"
          style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Date</label>
              <div style="position:relative;">
                <input type="text" id="cal-date-display" readonly
                  style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;"
                  onclick="toggleDatePicker()">
                <input type="hidden" id="cal-date">
                <div id="cal-date-picker" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:10000;background:#1a1a2e;border:1px solid #444;border-radius:8px;padding:12px;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <button type="button" onclick="changeMonth(-1)" style="background:none;border:1px solid #444;color:#fff;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:14px;">&lt;</button>
                    <span id="cal-picker-month" style="color:#fff;font-size:14px;font-weight:600;"></span>
                    <button type="button" onclick="changeMonth(1)" style="background:none;border:1px solid #444;color:#fff;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:14px;">&gt;</button>
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;margin-bottom:6px;">
                    <span style="font-size:10px;color:#888;padding:4px;">Su</span><span style="font-size:10px;color:#888;padding:4px;">Mo</span><span style="font-size:10px;color:#888;padding:4px;">Tu</span><span style="font-size:10px;color:#888;padding:4px;">We</span><span style="font-size:10px;color:#888;padding:4px;">Th</span><span style="font-size:10px;color:#888;padding:4px;">Fr</span><span style="font-size:10px;color:#888;padding:4px;">Sa</span>
                  </div>
                  <div id="cal-picker-days" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;"></div>
                </div>
              </div>
            </div>
        <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Time</label>
              <div style="position:relative;">
                <input type="text" id="cal-time-display" readonly
                  style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;"
                  onclick="toggleTimePicker()">
                <input type="hidden" id="cal-time" value="12:00">
                <div id="cal-time-picker" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:10000;background:#1a1a2e;border:1px solid #444;border-radius:8px;padding:12px;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
                  <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                    <div style="text-align:center;">
                      <button type="button" onclick="adjustTime('hour',1)" style="background:none;border:1px solid #444;color:#fff;border-radius:6px;width:36px;height:28px;cursor:pointer;font-size:16px;">&#9650;</button>
                      <div id="cal-time-hour" style="font-size:24px;color:#fff;font-weight:600;padding:6px 0;">12</div>
                      <button type="button" onclick="adjustTime('hour',-1)" style="background:none;border:1px solid #444;color:#fff;border-radius:6px;width:36px;height:28px;cursor:pointer;font-size:16px;">&#9660;</button>
                    </div>
                    <span style="font-size:24px;color:#fff;font-weight:600;">:</span>
                    <div style="text-align:center;">
                      <button type="button" onclick="adjustTime('min',1)" style="background:none;border:1px solid #444;color:#fff;border-radius:6px;width:36px;height:28px;cursor:pointer;font-size:16px;">&#9650;</button>
                      <div id="cal-time-min" style="font-size:24px;color:#fff;font-weight:600;padding:6px 0;">00</div>
                      <button type="button" onclick="adjustTime('min',-1)" style="background:none;border:1px solid #444;color:#fff;border-radius:6px;width:36px;height:28px;cursor:pointer;font-size:16px;">&#9660;</button>
                    </div>
                    <div style="text-align:center;margin-left:8px;">
                      <button type="button" onclick="adjustTime('ampm',0)" id="cal-time-ampm" style="background:#6c5ce7;border:none;color:#fff;border-radius:6px;padding:8px 12px;cursor:pointer;font-size:14px;font-weight:600;">PM</button>
                    </div>
                  </div>
                  <button type="button" onclick="confirmTime()" style="width:100%;margin-top:10px;padding:8px;background:#6c5ce7;border:none;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Done</button>
                </div>
              </div>
            </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Platform</label>
          <select id="cal-platform"
            style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="shorts">YouTube Shorts</option>
            <option value="twitter">Twitter/X</option>
            <option value="linkedin">LinkedIn</option>
            <option value="blog">Blog</option>
            <option value="newsletter">Newsletter</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Status</label>
          <select id="cal-status"
            style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
            <option value="planned">Planned</option>
            <option value="drafted">Drafted</option>
            <option value="ready">Ready</option>
            <option value="published">Published</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Notes</label>
        <textarea id="cal-notes" rows="3" placeholder="Any notes..."
          style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:13px;resize:vertical;"></textarea>
      </div>
      <div style="margin-bottom:12px;padding:12px;background:rgba(108,92,231,0.08);border:1px solid rgba(108,92,231,0.2);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <input type="checkbox" id="cal-reminder" style="width:16px;height:16px;accent-color:#a29bfe;cursor:pointer;">
          <label for="cal-reminder" style="font-size:13px;color:#e0e0e0;cursor:pointer;">📧 Email me a posting reminder</label>
        </div>
        <div id="cal-reminder-fields" style="display:none;">
          <input type="email" id="cal-reminder-email" placeholder="your@email.com"
            style="width:100%;padding:8px 10px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:13px;margin-bottom:6px;">
          <select id="cal-reminder-time" style="width:100%;padding:8px 10px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:13px;">
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="120">2 hours before</option>
            <option value="1440">1 day before</option>
          </select>
          <p style="font-size:10px;color:#888;margin:6px 0 0 0;">We will send you a reminder email before your scheduled post time.</p>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="saveCalendarEntry()" style="flex:1;">Save</button>
        <button class="btn" onclick="closeCalendarModal()" style="background:rgba(255,255,255,0.15);color:#fff;flex:1;border:1px solid rgba(255,255,255,0.2);">Cancel</button>
      </div>
      <button class="btn" id="cal-delete-btn" onclick="deleteCalendarEntry()" style="background:rgba(255,0,0,0.15);color:#ff6b6b;border:1px solid rgba(255,0,0,0.3);display:none;width:100%;margin-top:10px;padding:10px;">🗑️ Delete This Entry</button>
    </div>
  </div>

  <!-- Modal for viewing analysis -->
  <div class="modal" id="analysisModal">
    <div class="modal-content">
      <button class="modal-close" onclick="dismissModal()" title="Close">&times;</button>
      <div id="modalBody"></div>
    </div>
  </div>

  <!-- Narration Modal -->
  <div id="narrationModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(4px);">
    <div style="background:var(--surface);border-radius:16px;padding:28px;max-width:520px;width:90%;margin:auto;position:relative;max-height:90vh;overflow-y:auto;">
      <button onclick="closeNarrationModal()" style="position:absolute;top:12px;right:16px;background:none;border:none;color:var(--text-muted);font-size:24px;cursor:pointer;">&times;</button>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:4px;"><img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> AI Narration</h2>
      <p style="font-size:13px;color:var(--text-dim);margin-bottom:20px;">Add a voiceover or text narration to your clip</p>

      <div style="margin-bottom:16px;">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Narration Style</label>
        <div id="narration-styles" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
          <button class="narr-style-btn" data-style="funny" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">😂<br>Funny</button>
          <button class="narr-style-btn" data-style="documentary" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;"><img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"><br>Documentary</button>
          <button class="narr-style-btn" data-style="dramatic" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;"><img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"><br>Dramatic</button>
          <button class="narr-style-btn" data-style="hype" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">🔥<br>Hype</button>
          <button class="narr-style-btn" data-style="sarcastic" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">😏<br>Sarcastic</button>
          <button class="narr-style-btn" data-style="storytime" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">📖<br>Storytime</button>
          <button class="narr-style-btn" data-style="news" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">📺<br>News</button>
          <button class="narr-style-btn" data-style="poetic" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;"><img src="/images/section-icons/A-93.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"><br>Poetic</button>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Voice Type</label>
        <div style="display:flex;gap:8px;">
          <button id="voice-type-ai" class="voice-type-btn active" onclick="setVoiceType('ai')" style="flex:1;padding:10px;border-radius:10px;border:2px solid #00b894;background:rgba(0,184,148,0.1);color:var(--text);font-size:12px;cursor:pointer;font-weight:600;"><img src="/images/section-icons/A-81.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> AI Voice</button>
          <button id="voice-type-text" class="voice-type-btn" onclick="setVoiceType('text')" style="flex:1;padding:10px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:12px;cursor:pointer;font-weight:600;"><img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Text Only</button>
        </div>
      </div>

      <div id="voice-options" style="margin-bottom:16px;">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Voice Provider</label>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button id="provider-openai" class="provider-btn active" onclick="setProvider('openai')" style="flex:1;padding:8px;border-radius:8px;border:2px solid #6c5ce7;background:rgba(108,92,231,0.1);color:var(--text);font-size:11px;cursor:pointer;font-weight:600;">OpenAI TTS</button>
          <button id="provider-elevenlabs" class="provider-btn" onclick="setProvider('elevenlabs')" style="flex:1;padding:8px;border-radius:8px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;font-weight:600;">ElevenLabs</button>
        </div>
        <div id="elevenlabs-voice-picker" style="display:none;">
          <select id="elevenlabs-voice-select" style="width:100%;padding:8px 10px;background:var(--surface-light);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:12px;">
            <option value="">Loading voices...</option>
          </select>
          <p style="font-size:10px;color:var(--text-dim);margin-top:4px;">Add your ElevenLabs API key in Settings to use custom voices</p>
        </div>
      </div>

      <div id="audio-mix-options" style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Audio Mix</label>
        <div style="display:flex;gap:8px;">
          <button id="mix-type-mix" class="mix-type-btn active" onclick="setMixType('mix')" style="flex:1;padding:8px;border-radius:8px;border:2px solid #00b894;background:rgba(0,184,148,0.1);color:var(--text);font-size:11px;cursor:pointer;"><img src="/images/section-icons/A-6.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Mix (30% original)</button>
          <button id="mix-type-replace" class="mix-type-btn" onclick="setMixType('replace')" style="flex:1;padding:8px;border-radius:8px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;">🔇 Replace Audio</button>
        </div>
      </div>

      <p style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">⚠️ Click Generate to create a narrated version of this clip. The clip will be processed automatically.</p>

      <button id="narrate-generate-btn" onclick="generateNarration()" style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#00b894 0%,#00cec9 100%);color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;">
        <img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Narration
      </button>
      <div id="narration-progress" style="display:none;margin-top:12px;text-align:center;color:var(--text-muted);font-size:13px;"></div>
    </div>
  </div>

  <script>
    window.onerror = function(msg, src, line, col) { var d = document.createElement('div'); d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:10px;z-index:99999;font-size:14px;'; d.textContent = 'JS Error: ' + msg + ' at line ' + line + ':' + col; document.body.appendChild(d); console.error('JS ERROR:', msg, 'line:', line, 'col:', col); };

    // Clear autofilled email from URL input (Chrome ignores autocomplete=off)
    (function() {
      var urlInput = document.getElementById('videoUrl');
      if (urlInput) {
        // Force clear on load — browser autofill puts email here
        setTimeout(function() {
          var val = urlInput.value;
          if (val && (val.includes('@') || !val.includes('http'))) {
            urlInput.value = '';
          }
        }, 100);
        // Also clear on focus if it has an email
        urlInput.addEventListener('focus', function() {
          if (this.value && this.value.includes('@')) this.value = '';
        });
        urlInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            analyzeVideo();
          }
        });
        urlInput.addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            analyzeVideo();
          }
        });
      }
    })();

    // Entry point wired to the import panel's Analyze button.
    // We DON'T start the analysis here anymore — first we open the
    // copyright disclaimer modal. confirmAnalyze() resumes the flow
    // via _runAnalyze(url) only after the user accepts.
    function analyzeVideo() {
      const url = document.getElementById('videoUrl').value.trim();
      if (!url) {
        showToast('Please enter a YouTube URL');
        return;
      }
      openAnalyzeConfirm(url);
    }

    async function _runAnalyze(url) {
      const btn = document.querySelector('.btn-primary');
      const btnText = document.getElementById('analyzeBtn');
      btn.disabled = true;
      btnText.innerHTML = '<span class="loading"></span> Analyzing...';

      try {
        const response = await fetch('/shorts/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: url })
        });

        // If response is JSON (error before SSE started), handle it
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          throw new Error(data.error || 'Analysis failed');
        }

        if (!response.ok) {
          throw new Error('Analysis failed. Please try again.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\\n');
          // Keep the last (potentially incomplete) line in the buffer
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              let data;
              try {
                data = JSON.parse(trimmed.slice(6));
              } catch (parseErr) {
                console.log('SSE parse skip:', trimmed.slice(0, 100));
                continue;
              }
              if (data.status === 'completed') {
                showToast('Analysis complete!');
                setTimeout(() => location.reload(), 1500);
              } else if (data.status === 'error') {
                throw new Error(data.message || 'Analysis failed');
              } else if (data.message) {
                btnText.textContent = data.message;
              }
            }
          }
        }

        // If we get here without completing, reset the button
        btn.disabled = false;
        btnText.textContent = 'Analyze';
      } catch (error) {
        showToast(error.message || 'Analysis failed');
        btn.disabled = false;
        btnText.textContent = 'Analyze';
      }
    }

    // === Add to Calendar (from a moment card) ===
    function addToCalendar(analysisId, momentIdx) {
      var analysis = window.__currentAnalysis;
      if (!analysis || !analysis.moments || !analysis.moments[momentIdx]) {
        showToast('Could not find that moment to schedule.');
        return;
      }
      var moment = analysis.moments[momentIdx];
      var videoTitle = analysis.video_title || 'Untitled video';
      var title = (moment.title || 'Viral moment').slice(0, 120);
      // Build a notes summary so the entry has full context
      var noteParts = [];
      if (moment.description) noteParts.push(moment.description);
      var meta = [];
      if (moment.timeRange) meta.push('Source: ' + moment.timeRange);
      if (typeof moment.viralityScore === 'number') meta.push('Virality: ' + moment.viralityScore + '%');
      if (Array.isArray(moment.keyThemes) && moment.keyThemes.length) meta.push('Themes: ' + moment.keyThemes.slice(0, 5).join(', '));
      meta.push('From: ' + videoTitle);
      if (analysis.video_url) meta.push(analysis.video_url);
      noteParts.push(meta.join(' \u00B7 '));

      var today = new Date();
      var dateStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

      document.getElementById('atcMomentRef').value = analysisId + '|' + momentIdx;
      document.getElementById('atcSubtitle').textContent = videoTitle + ' — ' + (moment.timeRange || '');
      document.getElementById('atcTitle').value = title;
      document.getElementById('atcPlatform').value = 'tiktok';
      document.getElementById('atcStatus').value = 'planned';
      document.getElementById('atcDate').value = dateStr;
      document.getElementById('atcTime').value = '12:00';
      document.getElementById('atcReminder').value = '0';
      document.getElementById('atcNotes').value = noteParts.join('\\n\\n');
      document.getElementById('atcModal').style.display = 'flex';
      setTimeout(function(){ document.getElementById('atcTitle').focus(); document.getElementById('atcTitle').select(); }, 80);
      // Connection-gate: load status (once) + bind change listener (once),
      // then run the gate against the currently-selected platform.
      ensureAtcConnectionStatus().then(updateAtcConnectionState);
    }
    function closeAtcModal() {
      document.getElementById('atcModal').style.display = 'none';
    }
    async function atcSuggestPeakTime(){
      var btn = document.getElementById('atcPeakBtn');
      var hint = document.getElementById('atcPeakHint');
      var platform = document.getElementById('atcPlatform').value;
      var orig = hint.textContent;
      hint.textContent = 'Thinking…';
      btn.disabled = true;
      try {
        var resp = await fetch('/dashboard/calendar/api/peak-time?platform=' + encodeURIComponent(platform));
        if (!resp.ok) throw new Error('Failed');
        var d = await resp.json();
        if (d.date) document.getElementById('atcDate').value = d.date;
        if (d.time) document.getElementById('atcTime').value = d.time;
        hint.textContent = d.date && d.time ? (d.date + ' \u00B7 ' + d.time) : '';
        if (typeof showToast === 'function') showToast(d.reasoning || ('Peak time set: ' + d.date + ' ' + d.time));
      } catch (e) {
        hint.textContent = orig;
        if (typeof showToast === 'function') showToast('Peak time unavailable');
      } finally {
        btn.disabled = false;
      }
    }

    // Cache + load /shorts/connection-status once per page load.
    var __atcConnStatus = null;
    var __atcConnLoading = null;
    async function ensureAtcConnectionStatus() {
      if (__atcConnStatus) return __atcConnStatus;
      if (__atcConnLoading) return __atcConnLoading;
      __atcConnLoading = (async function(){
        try {
          var r = await fetch('/shorts/connection-status', { credentials: 'same-origin' });
          var d = await r.json();
          __atcConnStatus = (d && d.connections) || {};
        } catch (e) {
          __atcConnStatus = {};
        }
        return __atcConnStatus;
      })();
      return __atcConnLoading;
    }
    // Friendly display name + connect URL per platform option.
    var __atcPlatformMeta = {
      tiktok:    { label: 'TikTok',          connectUrl: '/tiktok/connect',    requiresAuth: true  },
      instagram: { label: 'Instagram',       connectUrl: '/instagram/connect', requiresAuth: true  },
      shorts:    { label: 'YouTube Shorts',  connectUrl: '/youtube/connect',   requiresAuth: true, statusKey: 'youtube' },
      youtube:   { label: 'YouTube',         connectUrl: '/youtube/connect',   requiresAuth: true  },
      twitter:   { label: 'Twitter / X',     connectUrl: '/twitter/connect',   requiresAuth: true  },
      linkedin:  { label: 'LinkedIn',        connectUrl: '/linkedin/connect',  requiresAuth: true  },
      facebook:  { label: 'Facebook',        connectUrl: '/facebook/connect',  requiresAuth: true  },
      blog:      { label: 'Blog Post',       requiresAuth: false },
      newsletter:{ label: 'Newsletter',      requiresAuth: false },
    };
    function updateAtcConnectionState() {
      var sel = document.getElementById('atcPlatform');
      if (!sel) return;
      var v = sel.value;
      var meta = __atcPlatformMeta[v] || { label: v, requiresAuth: false };
      var banner = document.getElementById('atcConnectBanner');
      var saveBtn = document.getElementById('atcSaveBtn');
      var autoPubRow = document.getElementById('atcAutoPubRow');
      var autoPubChk = document.getElementById('atcAutoPublish');
      if (!meta.requiresAuth) {
        if (banner) banner.style.display = 'none';
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; saveBtn.style.cursor = 'pointer'; }
        // No auth = no auto-publish path. Hide the option for blog/newsletter.
        if (autoPubRow) autoPubRow.style.display = 'none';
        if (autoPubChk) autoPubChk.checked = false;
        return;
      }
      if (autoPubRow) autoPubRow.style.display = 'flex';
      var statusKey = meta.statusKey || v;
      var connected = !!(__atcConnStatus && __atcConnStatus[statusKey]);
      if (connected) {
        if (banner) banner.style.display = 'none';
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; saveBtn.style.cursor = 'pointer'; }
      } else {
        var msg = document.getElementById('atcConnectMsg');
        var link = document.getElementById('atcConnectLink');
        var lbl  = document.getElementById('atcConnectLinkLabel');
        if (msg)  msg.textContent  = meta.label + " isn't connected yet. To auto-publish at the scheduled time, connect your " + meta.label + ' account first.';
        if (link) link.href        = meta.connectUrl;
        if (lbl)  lbl.textContent  = 'Connect ' + meta.label;
        if (banner) banner.style.display = 'block';
        if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; saveBtn.style.cursor = 'not-allowed'; }
      }
    }
    // Re-check whenever the platform dropdown changes.
    document.addEventListener('change', function(e){
      if (e.target && e.target.id === 'atcPlatform') {
        ensureAtcConnectionStatus().then(updateAtcConnectionState);
      }
    });

    async function saveAtcEntry() {
      var btn = document.getElementById('atcSaveBtn');
      var ref = (document.getElementById('atcMomentRef').value || '').split('|');
      var payload = {
        title: document.getElementById('atcTitle').value.trim(),
        platform: document.getElementById('atcPlatform').value,
        status: document.getElementById('atcStatus').value,
        scheduledDate: document.getElementById('atcDate').value,
        scheduledTime: document.getElementById('atcTime').value || '12:00',
        reminderMinutes: parseInt(document.getElementById('atcReminder').value || '0', 10) || 0,
        notes: document.getElementById('atcNotes').value,
        analysisId: ref[0] || null,
        momentIndex: ref[1] != null && ref[1] !== '' ? Number(ref[1]) : null
      };
      if (!payload.title) { showToast('Title is required'); return; }
      if (!payload.scheduledDate) { showToast('Date is required'); return; }
      payload.autoPublish = !!document.getElementById('atcAutoPublish').checked;
      // Defense-in-depth: re-check connection status server-side-driven.
      try {
        var pm = __atcPlatformMeta[payload.platform];
        if (pm && pm.requiresAuth) {
          await ensureAtcConnectionStatus();
          var statusKey = pm.statusKey || payload.platform;
          if (!__atcConnStatus || !__atcConnStatus[statusKey]) {
            showToast('Connect your ' + pm.label + ' account before scheduling.');
            updateAtcConnectionState();
            return;
          }
        }
        // If auto-publish is on, refuse it for export-only platforms.
        if (payload.autoPublish && pm && !pm.requiresAuth) {
          showToast('Auto-publish is only available for connected social platforms.');
          return;
        }
      } catch (e) {}

      // Auto-publish: render the clip now so the cron can pick up the file
      // at scheduled time. We POST /shorts/clip with the analysis + moment,
      // then poll status until ready. The user sees a clear "Rendering clip..."
      // state on the Save button while this is in flight.
      if (payload.autoPublish && payload.analysisId != null && payload.momentIndex != null) {
        btn.disabled = true; btn.textContent = 'Rendering clip…';
        try {
          var selectedBrandTemplateId = null;
          try { selectedBrandTemplateId = localStorage.getItem('brandKitSelectedTemplateId') || null; } catch (e) {}
          var clipPost = await fetch('/shorts/clip', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              analysisId: payload.analysisId,
              momentIndex: payload.momentIndex,
              includeCaptions: true,
              clipStyle: 'crop',
              captionLanguage: 'en',
              captionStyle: '',
              applyBrandKit: true,
              selectedBrandTemplateId
            })
          }).then(function(r){ return r.json(); });
          if (!clipPost || !clipPost.filename) throw new Error(clipPost && clipPost.error || 'Failed to start clip render');

          var deadline = Date.now() + 360000;  // 6 min cap
          var ready = null;
          while (Date.now() < deadline) {
            await new Promise(function(r){ setTimeout(r, 2000); });
            var s = await fetch('/shorts/clip/status/' + clipPost.filename).then(function(r){ return r.json(); });
            if (s && (s.failed || s.error)) throw new Error('Clip render failed: ' + (s.message || 'unknown'));
            if (s && s.ready) { ready = s; break; }
          }
          if (!ready) throw new Error('Clip render timed out — try again or save without auto-publish.');
          payload.clipFilename = clipPost.filename;
        } catch (clipErr) {
          showToast('Could not auto-publish: ' + clipErr.message);
          btn.disabled = false; btn.textContent = 'Save to Calendar';
          return;
        }
      }
      var orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        var resp = await fetch('/dashboard/calendar/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function(){ return {}; });
          throw new Error(err.error || 'Save failed');
        }
        closeAtcModal();
        showToast('Added to calendar — ' + payload.scheduledDate);
        // Refresh the floating Calendar modal so the new entry shows up
        // without a page reload. Jump to the saved entry's month first so
        // the user can verify it on the visible grid.
        try {
          var d = new Date(payload.scheduledDate + 'T00:00:00');
          if (!isNaN(d.getTime())) {
            calendarMonth = d.getMonth();
            calendarYear = d.getFullYear();
          }
          if (typeof renderCalendar === 'function') await renderCalendar();
        } catch (refreshErr) { /* best-effort */ }
      } catch (e) {
        showToast('Could not save: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Phase 2b — Publish modal. Lets the user publish a viral moment to
    // any connected social account (loaded from /api/connections) without
    // leaving the Smart Shorts page. Supports Post Now and Schedule for
    // Later. Schedule reuses the existing calendar_entries auto-publish
    // machinery so the schedulePublisher cron picks it up.
    // ─────────────────────────────────────────────────────────────────────
    var _publishConnections = [];
    var _publishMode = 'now';

    async function openPublishModal(analysisId, momentIdx) {
      var analysis = window.lastAnalysisData || window.currentAnalysis;
      if (analysis && (analysis.id !== analysisId && analysis._id !== analysisId)) analysis = null;
      var moment = analysis && analysis.moments ? analysis.moments[momentIdx] : null;
      var defaultTitle = moment ? (moment.title || ('Viral moment ' + (momentIdx + 1))) : ('Viral moment ' + (momentIdx + 1));
      var defaultCaption = moment ? (moment.description || moment.reason || '') : '';

      document.getElementById('publishMomentRef').value = analysisId + '|' + momentIdx;
      document.getElementById('publishTitle').value = defaultTitle.slice(0, 120);
      document.getElementById('publishCaption').value = defaultCaption;
      var now = new Date(); now.setMinutes(now.getMinutes() + 60);
      document.getElementById('publishDate').value = now.toISOString().slice(0, 10);
      document.getElementById('publishTime').value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      setPublishMode('now');
      document.getElementById('publishStatus').style.display = 'none';
      document.getElementById('publishModal').style.display = 'flex';

      // Pull live connections.
      var sel = document.getElementById('publishAccount');
      var noAcct = document.getElementById('publishNoAccounts');
      sel.innerHTML = '<option value="">Loading...</option>';
      try {
        var resp = await fetch('/api/connections', { credentials: 'same-origin' });
        var data = await resp.json();
        _publishConnections = (data && data.accounts) || [];
        // Filter to platforms where we can actually publish video.
        var supported = ['tiktok','instagram','youtube','facebook','twitter','linkedin','pinterest'];
        _publishConnections = _publishConnections.filter(function(c){ return supported.indexOf(c.platform) !== -1; });
        if (_publishConnections.length === 0) {
          sel.style.display = 'none';
          noAcct.style.display = 'block';
        } else {
          sel.style.display = '';
          noAcct.style.display = 'none';
          sel.innerHTML = _publishConnections.map(function(c) {
            var label = (c.platform.charAt(0).toUpperCase() + c.platform.slice(1)) +
              ' \u2014 ' + (c.accountName || c.platformUsername || c.id);
            return '<option value="' + c.id + '" data-platform="' + c.platform + '">' + label + '</option>';
          }).join('');
        }
      } catch (e) {
        sel.innerHTML = '<option value="">Failed to load accounts</option>';
      }
    }
    // ── Analyze confirmation gate ────────────────────────────────────
    // The Analyze button on the import panel routes through this gate so
    // the user has to acknowledge the copyright disclaimer before the
    // POST /shorts/analyze SSE actually fires. We stash the URL and the
    // button refs in a closure so confirmAnalyze() can resume the flow
    // exactly where analyzeVideo() would have, but only on confirmation.
    var __pendingAnalyzeUrl = null;
    function openAnalyzeConfirm(url) {
      __pendingAnalyzeUrl = url;
      var m = document.getElementById('analyzeConfirmModal');
      if (m) m.style.display = 'flex';
    }
    function closeAnalyzeConfirm() {
      var m = document.getElementById('analyzeConfirmModal');
      if (m) m.style.display = 'none';
      __pendingAnalyzeUrl = null;
    }
    function confirmAnalyze() {
      var url = __pendingAnalyzeUrl;
      closeAnalyzeConfirm();
      if (!url) return;
      _runAnalyze(url);
    }

    // ── Native 9:16 moment preview ───────────────────────────────────
    // Each moment card embeds a <video src="/shorts/moment-preview/.../...">
    // that autoplays muted in a loop. The server side trims to the
    // exact start/end window and center-crops to 9:16, so the only
    // browser-side responsibilities are:
    //   1) Lazy-pause when the video scrolls out of viewport (saves CPU
    //      when 8 moments are on screen simultaneously).
    //   2) A small mute toggle so the user can unmute the one preview
    //      they care about. We auto-mute any others to keep the audio
    //      experience sane.
    function _getMomentPreviewObserver() {
      if (window.__momentPreviewObserver) return window.__momentPreviewObserver;
      if (!('IntersectionObserver' in window)) return null;
      window.__momentPreviewObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          var vid = entry.target;
          if (!(vid instanceof HTMLVideoElement)) return;
          if (entry.isIntersecting) {
            // play() returns a Promise that rejects if autoplay is blocked.
            // Swallow — the poster image is a fine fallback.
            var p = vid.play();
            if (p && typeof p.catch === 'function') p.catch(function(){});
          } else {
            try { vid.pause(); } catch (_) {}
          }
        });
      }, { threshold: 0.2 });
      return window.__momentPreviewObserver;
    }
    function registerMomentPreview(vid) {
      var obs = _getMomentPreviewObserver();
      if (obs && vid) obs.observe(vid);
    }
    function toggleMomentMute(btn) {
      if (!btn) return;
      var shell = btn.closest('.moment-preview-shell');
      if (!shell) return;
      var vid = shell.querySelector('video');
      if (!vid) return;
      var willUnmute = !!vid.muted;
      // If the user is unmuting THIS preview, mute every other one so
      // they don't compete. Honors basic audio etiquette across the
      // moments grid.
      if (willUnmute) {
        document.querySelectorAll('.moment-preview-shell video').forEach(function(other) {
          if (other !== vid) other.muted = true;
        });
      }
      vid.muted = !vid.muted;
      var mutedIcon = btn.querySelector('.mute-on');
      var unmutedIcon = btn.querySelector('.mute-off');
      if (mutedIcon && unmutedIcon) {
        mutedIcon.style.display = vid.muted ? '' : 'none';
        unmutedIcon.style.display = vid.muted ? 'none' : '';
      }
      btn.setAttribute('aria-label', vid.muted ? 'Unmute preview' : 'Mute preview');
    }

    function closePublishModal() {
      document.getElementById('publishModal').style.display = 'none';
    }
    function setPublishMode(mode) {
      _publishMode = mode;
      var nowBtn = document.getElementById('publishTabNow');
      var laterBtn = document.getElementById('publishTabLater');
      var laterFields = document.getElementById('publishLaterFields');
      var submitBtn = document.getElementById('publishSubmitBtn');
      if (mode === 'now') {
        nowBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; nowBtn.style.color = '#fff';
        laterBtn.style.background = 'transparent'; laterBtn.style.color = 'var(--text-muted)';
        laterFields.style.display = 'none';
        submitBtn.textContent = 'Publish now';
      } else {
        laterBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; laterBtn.style.color = '#fff';
        nowBtn.style.background = 'transparent'; nowBtn.style.color = 'var(--text-muted)';
        laterFields.style.display = 'block';
        submitBtn.textContent = 'Schedule';
      }
    }
    async function submitPublish() {
      var btn = document.getElementById('publishSubmitBtn');
      var statusEl = document.getElementById('publishStatus');
      var connectionId = document.getElementById('publishAccount').value;
      if (!connectionId) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick an account first.'; return; }
      var ref = (document.getElementById('publishMomentRef').value || '').split('|');
      var payload = {
        analysisId: ref[0] || null,
        momentIndex: ref[1] != null && ref[1] !== '' ? Number(ref[1]) : null,
        connectionId: connectionId,
        title: document.getElementById('publishTitle').value.trim(),
        caption: document.getElementById('publishCaption').value.trim(),
        description: document.getElementById('publishCaption').value.trim()
      };
      if (_publishMode === 'later') {
        var d = document.getElementById('publishDate').value;
        var t = document.getElementById('publishTime').value || '12:00';
        if (!d) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick a date and time.'; return; }
        payload.scheduledAt = d + 'T' + t + ':00';
        // Extra fields merged from the legacy 'Schedule This Moment' modal
        // so both flows now collect the same scheduling metadata.
        var remVal = parseInt(document.getElementById('publishReminder').value || '0', 10) || 0;
        var remEmail = document.getElementById('publishReminderEmail').value.trim();
        if (remVal > 0 && !remEmail) {
          statusEl.style.display = 'block';
          statusEl.textContent = 'Enter an email to receive the reminder.';
          return;
        }
        payload.reminderMinutes = remVal;
        payload.reminderEmail = remVal > 0 ? remEmail : '';
        payload.notes = document.getElementById('publishNotes').value;
      }
      btn.disabled = true; var orig = btn.textContent; btn.textContent = _publishMode === 'now' ? 'Publishing\u2026' : 'Scheduling\u2026';
      statusEl.style.display = 'block';
      statusEl.textContent = _publishMode === 'now' ? 'Rendering clip and posting\u2026 this can take a moment.' : 'Scheduling the post\u2026';
      try {
        var resp = await fetch('/shorts/api/publish-moment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || 'Failed');
        if (_publishMode === 'now') {
          statusEl.textContent = 'Posted! ' + (data.platform ? '\u2014 ' + data.platform : '');
          showToast('Published to ' + (data.platform || 'platform'));
        } else {
          statusEl.textContent = 'Scheduled for ' + (data.scheduledFor || payload.scheduledAt);
          showToast('Scheduled');
        }
        setTimeout(closePublishModal, 1500);
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    }

    // Peak-time suggestion for the publishModal — reads the picked
    // account's platform from the publishAccount select's data attribute
    // and fills in publishDate/publishTime.
    async function publishSuggestPeakTime() {
      var btn = document.getElementById('publishPeakBtn');
      var hint = document.getElementById('publishPeakHint');
      var sel = document.getElementById('publishAccount');
      var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      var platform = opt ? (opt.getAttribute('data-platform') || '') : '';
      if (!platform) {
        if (typeof showToast === 'function') showToast('Pick an account first.');
        return;
      }
      var orig = hint.textContent;
      hint.textContent = 'Thinking…';
      btn.disabled = true;
      try {
        var resp = await fetch('/dashboard/calendar/api/peak-time?platform=' + encodeURIComponent(platform));
        if (!resp.ok) throw new Error('Failed');
        var d = await resp.json();
        if (d.date) document.getElementById('publishDate').value = d.date;
        if (d.time) document.getElementById('publishTime').value = d.time;
        hint.textContent = d.date && d.time ? (d.date + ' · ' + d.time) : '';
        if (typeof showToast === 'function') showToast(d.reasoning || ('Peak time set: ' + d.date + ' ' + d.time));
      } catch (e) {
        hint.textContent = orig;
        if (typeof showToast === 'function') showToast('Peak time unavailable');
      } finally {
        btn.disabled = false;
      }
    }

    // Show/hide the reminder-email input depending on whether a non-zero
    // reminder window is picked.
    function publishToggleReminderEmail() {
      var v = parseInt(document.getElementById('publishReminder').value || '0', 10);
      var email = document.getElementById('publishReminderEmail');
      var spacer = document.getElementById('publishReminderSpacer');
      if (v > 0) {
        email.style.display = 'block';
        if (spacer) spacer.style.display = 'none';
      } else {
        email.style.display = 'none';
        email.value = '';
        if (spacer) spacer.style.display = 'block';
      }
    }

    // ESC closes the add-to-calendar modal
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') {
        var m = document.getElementById('atcModal');
        if (m && m.style.display === 'flex') closeAtcModal();
      }
    });

    function getVideoId(url) {
      if (!url) return null;
      const patterns = [
        /(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/|youtube\\.com\\/embed\\/|youtube\\.com\\/shorts\\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
      }
      return null;
    }

    function timeToSeconds(timeStr) {
      if (!timeStr) return 0;
      const parts = timeStr.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    }

    async function viewAnalysis(id) {
      try {
        const response = await fetch('/shorts/api/' + id);
        const data = await response.json();
        if (!data.analysis) {
          throw new Error(data.error || 'Analysis data not found');
        }
        const analysis = data.analysis;
        window.__currentAnalysis = analysis;
        const videoId = getVideoId(analysis.video_url || '');

        // Build transcript viewer with keyword highlights
        // Ensure moments is an array
        if (typeof analysis.moments === 'string') {
          try { analysis.moments = JSON.parse(analysis.moments); } catch(e) { analysis.moments = []; }
        }
        if (!Array.isArray(analysis.moments)) analysis.moments = [];

        const transcriptHtml = buildTranscriptViewer(analysis.transcript || '', analysis.moments, videoId);

        const html = \`
          <div class="modal-header">
            <h2 class="modal-title">\${analysis.video_title || 'Analysis'}</h2>
            <div class="modal-header-actions">
              <span class="moment-count-badge">\${analysis.moments?.length || 0} viral moments found</span>
              \${videoId ? \`<a href="https://youtube.com/watch?v=\${videoId}" target="_blank"
                class="modal-header-btn" style="text-decoration:none;">
                ▶ YouTube
              </a>\` : ''}
              <button class="modal-header-btn"
                onclick="document.getElementById('transcriptPanel').style.display = document.getElementById('transcriptPanel').style.display === 'none' ? 'block' : 'none'">
                📄 View Transcript
              </button>
              <button class="modal-header-btn export"
                onclick="exportAllClips('\${id}')">
                <img src="/images/section-icons/A-94.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Export All
              </button>
            </div>
          </div>
          <div id="transcriptPanel" style="display:none; padding:0 16px 16px; max-height:300px; overflow-y:auto;
            background:rgba(0,0,0,0.3); margin:0 16px 16px; border-radius:8px;">
            <div style="position:sticky;top:0;background:rgba(0,0,0,0.9);padding:10px 0 8px;z-index:1;">
              <input type="text" id="transcriptSearch" placeholder="Search transcript..."
                style="width:100%;padding:8px 12px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:13px;"
                oninput="filterTranscript(this.value)">
            </div>
            <div id="transcriptContent">\${transcriptHtml}</div>
          </div>
          <div id="momentsContainer"></div>
        \`;

        document.getElementById('modalBody').innerHTML = html;

        const container = document.getElementById('momentsContainer');
        (analysis.moments).forEach((moment, idx) => {
          const card = document.createElement('div');
          card.className = 'moment-card';

          // Parse time range for video embed
          const rangeParts = (moment.timeRange || '').split('-');
          const startSec = timeToSeconds(rangeParts[0]);
          const endSec = rangeParts[1] ? timeToSeconds(rangeParts[1]) : startSec + 60;

          // Native 9:16 vertical preview. The server returns an MP4 that
          // is already trimmed to the moment's [start, end] window and
          // center-cropped to 9:16, so the browser just autoplays it in
          // a loop. The container is locked to aspect-ratio:9/16 with a
          // capped width so the moment card stays a sensible height even
          // when 8 cards stack.
          //   - <video> autoplay+muted+playsinline+loop so it kicks off
          //     as soon as the moment renders.
          //   - poster falls back to YouTube's mqdefault frame while the
          //     trimmed MP4 is still being generated server-side.
          //   - registerMomentPreview() wires IntersectionObserver so the
          //     video pauses when it scrolls out of view.
          //   - mute toggle in the top-right; bottom-left badge keeps
          //     showing the original timeRange.
          const videoEmbed = videoId ? \`
            <div class="moment-preview-shell" id="moment-preview-\${idx}"
              style="position:relative; width:100%; max-width:220px; aspect-ratio:9/16; margin:0 auto 14px; background:#0a0612; border:1px solid rgba(108,58,237,0.20); border-radius:14px; overflow:hidden; box-shadow:0 6px 22px rgba(0,0,0,0.35);">
              <video
                src="/shorts/moment-preview/\${id}/\${idx}"
                poster="https://img.youtube.com/vi/\${videoId}/mqdefault.jpg"
                autoplay loop muted playsinline preload="metadata"
                style="width:100%; height:100%; object-fit:cover; display:block; background:#000;"
                onloadeddata="registerMomentPreview(this)"
                onerror="this.style.display='none'; var f=this.parentElement.querySelector('.moment-preview-fallback'); if(f) f.style.display='flex';"></video>
              <div class="moment-preview-fallback" aria-hidden="true"
                style="display:none; position:absolute; inset:0; align-items:center; justify-content:center; flex-direction:column; gap:6px; padding:14px; text-align:center; color:#aaa; font-size:11px; line-height:1.4; background:linear-gradient(180deg,#1a1430,#0a0612);">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>Preview unavailable</div>
              </div>
              <div style="position:absolute; bottom:8px; left:8px; background:rgba(0,0,0,0.78); padding:3px 8px; border-radius:6px; color:#fff; font-size:11px; font-weight:600; letter-spacing:0.02em; z-index:2;">
                \${moment.timeRange}
              </div>
              <button type="button" onclick="toggleMomentMute(this)" title="Unmute preview" aria-label="Unmute preview"
                style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.65); border:1px solid rgba(255,255,255,0.18); color:#fff; width:30px; height:30px; border-radius:50%; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; z-index:3;">
                <svg class="mute-on" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                </svg>
                <svg class="mute-off" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:none">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              </button>
            </div>
          \` : '';

          var viralColor = moment.viralityScore >= 80 ? '#10b981' : moment.viralityScore >= 60 ? '#f39c12' : '#ff6b6b';
          var viralColorEnd = moment.viralityScore >= 80 ? '#00b894' : moment.viralityScore >= 60 ? '#e67e22' : '#ff4757';
          var viralLabel = moment.viralityScore >= 80 ? 'High Viral Potential' : moment.viralityScore >= 60 ? 'Good Potential' : 'Moderate Potential';

          card.innerHTML = \`
            <div class="moment-card-header">
              <div style="flex: 1; min-width: 0;">
                <div class="moment-card-title">\${moment.title}</div>
                <div class="moment-card-time">
                  <span class="time-badge">\${moment.timeRange}</span>
                  <span>\${endSec - startSec}s clip</span>
                </div>
              </div>
              <div class="moment-score" style="cursor:pointer;" onclick="event.stopPropagation();showViralityBreakdown('\${id}', \${idx})" title="Click for virality breakdown">\${moment.viralityScore}%</div>
            </div>
            \${videoEmbed}
            <div class="moment-card-desc">\${moment.description}</div>
            <div class="virality-bar-wrap">
              <div class="virality-bar-track">
                <div class="virality-bar-fill" style="width:\${moment.viralityScore}%;background:linear-gradient(90deg,\${viralColor},\${viralColorEnd});"></div>
              </div>
              <div class="virality-bar-labels">
                <span class="virality-label" style="color:\${viralColor};">\${viralLabel}</span>
                <span class="virality-themes">\${(moment.keyThemes || []).slice(0,3).join(', ')}</span>
              </div>
            </div>
            <div class="clip-toolbar">

              <!-- Row 1 — Source / Generate
                   YouTube link lives in the modal header now (next to
                   View Transcript), so it's not duplicated on every card. -->
              <div class="clip-toolbar-row">
                <button class="clip-tool-btn primary" onclick="generateContent('\${id}', '\${moment.timeRange}')">
                  <img src="/images/section-icons/A-93.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Content
                </button>
              </div>

              <!-- Row 2 — Settings (captions/brand/clip style controls
                   that shape how the rendered clip looks). The wrapper
                   has a subtle background so the grouping reads visually.
                   Label sits on its own line above the controls per
                   Albert's UX request. -->
              <div class="clip-toolbar-row settings" style="flex-direction:column;align-items:stretch;">
                <span class="clip-toolbar-row-label" style="margin-bottom:6px;">Settings</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  <select id="clip-style-\${idx}" class="clip-tool-select" title="Clip style">
                    <option value="crop">Center Crop</option>
                    <option value="blur">Blur BG</option>
                    <option value="fit">Fit (Black BG)</option>
                    <option value="pip">Picture-in-Picture</option>
                  </select>
                  <label class="clip-captions-toggle" title="Burn animated captions into the clip">
                    <input type="checkbox" id="captions-\${idx}" checked
                      onchange="(function(el){ var box = document.getElementById('caption-fields-' + '\${idx}'); if (box) box.style.display = el.checked ? 'inline-flex' : 'none'; })(this);"
                      style="accent-color:#a78bfa; width:14px; height:14px;">
                    <span>Captions</span>
                  </label>
                  <!-- Caption-related controls live in this wrapper so we can
                       hide all three with one display toggle. Visible by
                       default because the Captions checkbox starts checked. -->
                  <span id="caption-fields-\${idx}" style="display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center;">
                    <select id="caption-style-\${idx}" class="clip-tool-select" title="Caption style"
                      onchange="if (typeof window.__paintCaptionPreview === 'function') window.__paintCaptionPreview('\${idx}', this.value);">
                <option value="classic">Classic</option>
                <option value="trending">Trending</option>
                <option value="karaoke">Word Pop</option>
                <option value="minimal">Minimal</option>
                <option value="bold">Bold</option>
                <option value="neon">Neon Glow</option>
                <option value="bold-pop">Bold Pop</option>
                <option value="gradient-wave">Gradient Wave</option>
                <option value="typewriter">Typewriter</option>
                <option value="cinematic">Cinematic</option>
                <option value="street">Street</option>
                <option value="hormozi">Hormozi</option>
                <option value="mrbeast">MrBeast</option>
                <option value="classic-sub">Classic Subtitle</option>
                <option value="outline-style">Outline</option>
                <option value="soft-glow">Soft Glow</option>
                <option value="retro-vhs">Retro VHS</option>
                <option value="comic">Comic</option>
                <option value="fire">Fire</option>
                <option value="clean-modern">Clean Modern</option>
                <option value="podcast">Podcast</option>
                <option value="tiktok-trend">TikTok Trending</option>
                <option value="shadow-drop">Shadow Drop</option>
              </select>
              <span id="caption-preview-\${idx}" class="caption-preview" title="Live caption style preview">Aa</span>
                <select id="caption-lang-\${idx}" class="clip-tool-select" title="Language">
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="pt">Portuguese</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="hi">Hindi</option>
                <option value="ar">Arabic</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
                <option value="ru">Russian</option>
                <option value="tr">Turkish</option>
                <option value="nl">Dutch</option>
                <option value="pl">Polish</option>
                <option value="id">Indonesian</option>
                <option value="th">Thai</option>
                <option value="vi">Vietnamese</option>
                <option value="fil">Filipino</option>
                <option value="sv">Swedish</option>
              </select>
                  </span>
                  <label class="clip-captions-toggle" title="Apply your saved Brand Kit (logo/watermark) to this clip">
                    <input type="checkbox" id="brandkit-\${idx}"
                      style="accent-color:#a78bfa; width:14px; height:14px;">
                    <span>Brand Template</span>
                  </label>
                </div>
              </div>

              <!-- Row 3 — Actions / Download.
                   Three 'Download X' siblings share the accent style so
                   they read as a coherent set of save-to-disk actions;
                   Publish-to lives at the end and keeps its purple/pink
                   gradient so it's visually distinct as a network action. -->
              <div class="clip-toolbar-row">
                <button class="clip-tool-btn accent" id="clip-btn-\${idx}"
                  onclick="downloadClip('\${id}', \${idx}, this)">
                  ⬇ Download Clip
                </button>
                <button class="clip-tool-btn accent" id="narrate-btn-\${idx}"
                  onclick="openNarrationModal('\${id}', \${idx})">
                  <img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Download with AI Narration
                </button>
                <button class="clip-tool-btn accent" id="broll-btn-\${idx}"
                  onclick="findBRoll('\${id}', \${idx}, this)">
                  <img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Download with AI B-Roll
                </button>
                <button class="clip-tool-btn" onclick="openPublishModal('\${id}', \${idx})" title="Publish this moment to a connected social account"
                  style="background:linear-gradient(135deg,rgba(108,58,237,0.18),rgba(236,72,153,0.16));color:#fff;border:1px solid rgba(108,58,237,0.45);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg> Publish to&hellip;
                </button>
              </div>

            </div>
          \`;
          card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'IFRAME') {
              card.classList.toggle('selected');
            }
          };
          // Apply user's preferred caption style (set via /caption-presets > Use Style)
          if (window.__preferredCaptionStyle) {
            const sel = card.querySelector('select[id^="caption-style-"]');
            if (sel) {
              const wanted = window.__preferredCaptionStyle;
              const exact = Array.from(sel.options).find(o => o.value === wanted);
              if (exact) sel.value = wanted;
              else {
                // Map a few aliases that don't match 1:1 with the dropdown values
                const aliasMap = { 'neon-glow': 'neon', 'classic-subtitle': 'classic-sub' };
                const aliased = aliasMap[wanted];
                if (aliased && Array.from(sel.options).some(o => o.value === aliased)) sel.value = aliased;
              }
            }
          }
          container.appendChild(card);
        });

        document.getElementById('analysisModal').classList.add('active');
      } catch (error) {
        showToast('Error loading analysis: ' + error.message);
      }
    }

    async function generateContent(analysisId, momentId) {
      // Show content type selector
      const html = \`
        <div class="modal-header">
          <h2 class="modal-title">Generate Content</h2>
        </div>
        <div style="padding: 16px;">
          <p style="color: var(--text-muted); margin-bottom: 16px;">Choose what to generate:</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px;">
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="tiktok" checked style="accent-color:#FF0050;"> TikTok
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="instagram" checked style="accent-color:#FF0050;"> Instagram
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="shorts" checked style="accent-color:#FF0050;"> YT Shorts
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="twitter" checked style="accent-color:#FF0050;"> Twitter/X
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="linkedin" checked style="accent-color:#FF0050;"> LinkedIn
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="thread" style="accent-color:#FF0050;"> X Thread
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="blog" style="accent-color:#FF0050;"> Blog Post
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="newsletter" style="accent-color:#FF0050;"> Newsletter
            </label>
          </div>
          <button class="btn btn-primary" id="gen-content-btn" onclick="doGenerateContent('\${analysisId}', '\${momentId}')"
            style="width:100%;">
            Generate Selected Content
          </button>
        </div>
      \`;
      // Snapshot the moments-view HTML so closing this Generate Content view
      // returns to the moments list instead of dismissing the whole modal.
      try { window.__modalPrevHTML = document.getElementById('modalBody').innerHTML; } catch (_) {}
      document.getElementById('modalBody').innerHTML = html;
      document.getElementById('analysisModal').classList.add('active');
    }

    async function doGenerateContent(analysisId, momentId) {
      const checkboxes = document.querySelectorAll('.content-type-cb:checked');
      const platforms = Array.from(checkboxes).map(cb => cb.value);
      if (platforms.length === 0) { showToast('Select at least one content type'); return; }

      const btn = document.getElementById('gen-content-btn');
      btn.disabled = true;
      btn.textContent = 'Generating ' + platforms.length + ' pieces...';

      try {
        const response = await fetch('/shorts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ momentId, analysisId, platforms })
        });

        const data = await response.json();
        if (data.success) {
          showGeneratedContent(data.content);
        } else {
          throw new Error(data.error || 'Generation failed');
        }
      } catch (error) {
        showToast('Error: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Generate Selected Content';
      }
    }

    let _generatedContent = [];

    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
      });
    }

    function copyField(panelIdx, field) {
      const item = _generatedContent[panelIdx];
      if (!item) return;
      let text = '';
      if (field === 'hook') text = item.hook || '';
      else if (field === 'script') text = item.script || '';
      else if (field === 'caption') text = item.caption || '';
      else if (field === 'all') {
        text = [item.hook, item.script, (item.hashtags||[]).map(h => h.startsWith('#') ? h : '#'+h).join(' ')].filter(Boolean).join('\\n\\n');
      }
      const btn = event.target;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
      });
    }

    function showGeneratedContent(content) {
      _generatedContent = content;
      const platformLabels = {
        tiktok: 'TikTok', instagram: 'Instagram', shorts: 'YT Shorts',
        twitter: 'Twitter/X', linkedin: 'LinkedIn', blog: 'Blog Post',
        newsletter: 'Newsletter', thread: 'X Thread'
      };
      const platformColors = {
        tiktok: '#ff0050', instagram: '#E1306C', shorts: '#FF0000',
        twitter: '#000', linkedin: '#0077B5', blog: '#6c5ce7',
        newsletter: '#f39c12', thread: '#1DA1F2'
      };

      // Build tabs
      const tabs = content.map((item, i) => \`
        <button class="content-tab" data-idx="\${i}"
          style="padding:8px 14px; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;
            background:\${i === 0 ? platformColors[item.platform] || '#6c5ce7' : 'var(--surface-light)'};
            color:\${i === 0 ? '#fff' : 'var(--text-muted)'};"
          onclick="switchContentTab(\${i})">
          \${platformLabels[item.platform] || item.platform}
        </button>
      \`).join('');

      // Build content panels
      const panels = content.map((item, i) => {
        const isLong = ['blog', 'newsletter', 'thread'].includes(item.platform);
        const escHtml = (s) => (s||'N/A').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        return \`
          <div class="content-panel" id="content-panel-\${i}" style="display:\${i === 0 ? 'block' : 'none'};">
            \${item.title ? '<h3 style="margin-bottom:12px;color:var(--text);">' + escHtml(item.title) + '</h3>' : ''}

            <div style="background:var(--surface-light);padding:14px;border-radius:8px;margin-bottom:10px;border:var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#888;text-transform:uppercase;">Hook</span>
                <button class="btn btn-small" style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.1);"
                  onclick="copyField(\${i},'hook')">Copy</button>
              </div>
              <div style="font-size:14px;font-weight:600;color:var(--text);">\${escHtml(item.hook)}</div>
            </div>

            <div style="background:var(--surface-light);padding:14px;border-radius:8px;margin-bottom:10px;border:var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#888;text-transform:uppercase;">\${isLong ? 'Full Content' : 'Script'}</span>
                <button class="btn btn-small" style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.1);"
                  onclick="copyField(\${i},'script')">Copy</button>
              </div>
              <div style="font-size:13px;line-height:1.7;white-space:pre-wrap;color:var(--text);\${isLong ? 'max-height:300px;overflow-y:auto;' : ''}">\${escHtml(item.script)}</div>
            </div>

            <div style="background:var(--surface-light);padding:14px;border-radius:8px;margin-bottom:10px;border:var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#888;text-transform:uppercase;">Caption / Description</span>
                <button class="btn btn-small" style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.1);"
                  onclick="copyField(\${i},'caption')">Copy</button>
              </div>
              <div style="font-size:13px;color:var(--text);">\${escHtml(item.caption)}</div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
              \${(item.hashtags || []).map(h => '<span style="background:rgba(108,92,231,0.2);color:#a29bfe;padding:3px 8px;border-radius:4px;font-size:12px;">' + (h.startsWith('#') ? h : '#' + h) + '</span>').join('')}
            </div>

            \${item.postingTips ? '<div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;font-size:12px;color:var(--text-muted);margin-bottom:10px;"><strong>Tips:</strong> ' + escHtml(item.postingTips) + '</div>' : ''}

            <div style="display:flex;gap:8px;margin-top:4px;">
              <button class="btn btn-primary" style="flex:1;"
                onclick="copyField(\${i},'all')">
                Copy All Content
              </button>
              <button class="btn" style="background:rgba(108,92,231,0.2);color:#a29bfe;"
                onclick="showPlatformPreview(\${i})">
                Preview
              </button>
            </div>
          </div>
        \`;
      }).join('');

      const html = \`
        <div class="modal-header">
          <h2 class="modal-title">Generated Content</h2>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 12px;border-bottom:var(--border-subtle);">
          \${tabs}
        </div>
        <div style="padding:16px;max-height:500px;overflow-y:auto;">
          \${panels}
        </div>
      \`;
      // Don't overwrite __modalPrevHTML — we want dismissing this view to
      // return all the way back to the moments list, not to the Generate
      // Content type-picker that the user is no longer interested in.
      document.getElementById('modalBody').innerHTML = html;
    }

    function showPlatformPreview(contentIdx) {
      const item = _generatedContent[contentIdx];
      if (!item) return;
      const p = item.platform;
      const escHtml = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const caption = escHtml(item.caption || '').substring(0, 200);
      const hook = escHtml(item.hook || '');
      const hashtags = (item.hashtags || []).map(h => '<span style="color:#6c5ce7;">' + (h.startsWith('#') ? h : '#'+h) + '</span>').join(' ');
      const truncScript = escHtml((item.script || '').substring(0, 140));

      let mockup = '';
      if (p === 'tiktok' || p === 'shorts') {
        // Vertical phone mockup
        mockup = '<div style="width:270px;height:480px;background:#000;border-radius:24px;border:3px solid #333;margin:auto;position:relative;overflow:hidden;padding:16px;">' +
          '<div style="position:absolute;top:0;left:0;right:0;height:40px;background:linear-gradient(180deg,rgba(0,0,0,0.8),transparent);z-index:2;display:flex;align-items:center;justify-content:center;padding-top:8px;">' +
            '<span style="font-size:10px;color:#fff;opacity:0.6;">' + (p==='tiktok'?'For You':'Shorts') + '</span>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);width:100%;height:100%;border-radius:16px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;">' +
            '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:6px;">@yourbrand</div>' +
            '<div style="font-size:11px;color:#eee;line-height:1.4;margin-bottom:8px;">' + caption + '</div>' +
            '<div style="font-size:10px;line-height:1.4;">' + hashtags + '</div>' +
          '</div>' +
          '<div style="position:absolute;right:8px;bottom:80px;display:flex;flex-direction:column;align-items:center;gap:16px;">' +
            '<div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;">&#x2764;</div>' +
            '<div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;">&#x1F4AC;</div>' +
            '<div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;">&#x27A1;</div>' +
          '</div>' +
        '</div>';
      } else if (p === 'instagram') {
        mockup = '<div style="width:320px;background:#000;border-radius:16px;border:3px solid #333;margin:auto;overflow:hidden;">' +
          '<div style="padding:10px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #222;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#f09433,#dc2743,#bc1888);"></div>' +
            '<span style="font-size:12px;font-weight:600;color:#fff;">yourbrand</span>' +
          '</div>' +
          '<div style="width:100%;aspect-ratio:1;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;padding:20px;">' +
            '<p style="font-size:16px;font-weight:700;color:#fff;text-align:center;line-height:1.4;">' + hook + '</p>' +
          '</div>' +
          '<div style="padding:10px 12px;">' +
            '<div style="display:flex;gap:12px;margin-bottom:8px;">' +
              '<span style="font-size:18px;">&#x2764;</span><span style="font-size:18px;">&#x1F4AC;</span><span style="font-size:18px;">&#x27A1;</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#ccc;line-height:1.4;">' +
              '<strong style="color:#fff;">yourbrand</strong> ' + caption.substring(0,120) + '...' +
            '</div>' +
            '<div style="font-size:10px;margin-top:4px;">' + hashtags + '</div>' +
          '</div>' +
        '</div>';
      } else if (p === 'twitter' || p === 'thread') {
        const tweetText = p === 'thread' ? escHtml((item.script||'').split('\\n')[0] || hook) : caption;
        mockup = '<div style="width:360px;background:#000;border-radius:16px;border:1px solid #333;margin:auto;padding:16px;">' +
          '<div style="display:flex;gap:10px;">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:#333;flex-shrink:0;"></div>' +
            '<div style="flex:1;">' +
              '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">' +
                '<span style="font-size:13px;font-weight:700;color:#fff;">Your Brand</span>' +
                '<span style="font-size:12px;color:#666;">@yourbrand</span>' +
              '</div>' +
              '<div style="font-size:14px;color:#e7e9ea;line-height:1.5;margin-bottom:10px;">' + tweetText.substring(0,280) + '</div>' +
              (p==='thread' ? '<div style="font-size:11px;color:#6c5ce7;margin-bottom:8px;">Show this thread</div>' : '') +
              '<div style="display:flex;gap:40px;margin-top:8px;">' +
                '<span style="font-size:12px;color:#666;">&#x1F4AC; 24</span>' +
                '<span style="font-size:12px;color:#666;">&#x1F504; 142</span>' +
                '<span style="font-size:12px;color:#666;">&#x2764; 1.2K</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      } else if (p === 'linkedin') {
        mockup = '<div style="width:360px;background:#1b1f23;border-radius:12px;border:1px solid #333;margin:auto;overflow:hidden;">' +
          '<div style="padding:12px 16px;display:flex;align-items:center;gap:10px;">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:#0077b5;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;font-weight:700;">Y</div>' +
            '<div><div style="font-size:13px;font-weight:600;color:#fff;">Your Brand</div><div style="font-size:11px;color:#888;">Content Creator</div></div>' +
          '</div>' +
          '<div style="padding:0 16px 12px;font-size:13px;color:#ccc;line-height:1.6;">' + caption.substring(0,250) + '</div>' +
          '<div style="padding:0 16px 8px;font-size:10px;">' + hashtags + '</div>' +
          '<div style="border-top:1px solid #333;padding:8px 16px;display:flex;justify-content:space-around;">' +
            '<span style="font-size:12px;color:#888;">Like</span><span style="font-size:12px;color:#888;">Comment</span><span style="font-size:12px;color:#888;">Share</span>' +
          '</div>' +
        '</div>';
      } else {
        // Blog / Newsletter - card preview
        mockup = '<div style="width:380px;background:#fff;border-radius:12px;margin:auto;overflow:hidden;color:#111;">' +
          '<div style="height:120px;background:linear-gradient(135deg,#6c5ce7,#a29bfe);display:flex;align-items:center;justify-content:center;">' +
            '<span style="font-size:20px;font-weight:800;color:#fff;text-align:center;padding:0 20px;">' + hook + '</span>' +
          '</div>' +
          '<div style="padding:16px;">' +
            '<p style="font-size:13px;color:#444;line-height:1.6;">' + truncScript + '...</p>' +
            '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#888;">' +
              (p==='newsletter' ? 'Email Newsletter Preview' : 'Blog Post Preview') +
            '</div>' +
          '</div>' +
        '</div>';
      }

      const previewModal = '<div id="platformPreviewOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;" onclick="this.remove()">' +
        '<div style="margin-bottom:16px;text-align:center;">' +
          '<h3 style="color:#fff;font-size:16px;margin-bottom:4px;">' +
            ({'tiktok':'TikTok','instagram':'Instagram','shorts':'YouTube Shorts','twitter':'Twitter/X','linkedin':'LinkedIn','thread':'X Thread','blog':'Blog Post','newsletter':'Newsletter'}[p] || p) + ' Preview</h3>' +
          '<p style="color:#888;font-size:12px;">Click anywhere to close</p>' +
        '</div>' +
        mockup +
      '</div>';

      // Remove existing overlay if any
      const existing = document.getElementById('platformPreviewOverlay');
      if (existing) existing.remove();
      document.body.insertAdjacentHTML('beforeend', previewModal);
    }

    function switchContentTab(idx) {
      document.querySelectorAll('.content-panel').forEach((p, i) => {
        p.style.display = i === idx ? 'block' : 'none';
      });
      document.querySelectorAll('.content-tab').forEach((t, i) => {
        t.style.background = i === idx ? t.dataset.color || '#6c5ce7' : 'rgba(255,255,255,0.08)';
        t.style.color = i === idx ? '#fff' : 'var(--text-muted)';
      });
    }

    async function downloadClip(analysisId, momentIndex, btn) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Starting...';

      // Check options
      const captionsCheckbox = document.getElementById('captions-' + momentIndex);
      const includeCaptions = captionsCheckbox ? captionsCheckbox.checked : false;
      const styleSelect = document.getElementById('clip-style-' + momentIndex);
      const clipStyle = styleSelect ? styleSelect.value : 'blur';
      const langSelect = document.getElementById('caption-lang-' + momentIndex);
      const captionLanguage = langSelect ? langSelect.value : 'en';
                const captionStyleSelect = document.getElementById('caption-style-' + momentIndex);
                const captionStyle = captionStyleSelect ? captionStyleSelect.value : 'classic';

      try {
        // Per-clip Brand Template toggle
        const brandKitCheckbox = document.getElementById('brandkit-' + momentIndex);
        const applyBrandKit = brandKitCheckbox ? brandKitCheckbox.checked : true;

        // Pull the user's currently-selected brand template (set via the
        // shared Brand Kit modal's Select button on /shorts). Server applies
        // it when applyBrandKit is true.
        let selectedBrandTemplateId = null;
        try { selectedBrandTemplateId = localStorage.getItem('brandKitSelectedTemplateId') || null; } catch (e) {}

        // Request clip generation
        const response = await fetch('/shorts/clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisId, momentIndex, includeCaptions, clipStyle,
            captionLanguage, captionStyle, applyBrandKit,
            selectedBrandTemplateId
          })
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to start clip generation');
        }

        const filename = data.filename;
        btn.textContent = 'Processing...';
        btn.style.background = 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)';
        btn.style.color = '#fff';

        // Poll for clip readiness
        let attempts = 0;
        const maxAttempts = 150; // 5 minutes max
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const statusResp = await fetch('/shorts/clip/status/' + filename);
            const statusData = await statusResp.json();

            if (statusData.failed) {
              clearInterval(pollInterval);
              showToast(statusData.message || 'Clip generation failed'); btn.disabled = false; btn.textContent = originalText; btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)'; return;
            } else if (statusData.ready) {
              clearInterval(pollInterval);
              btn.textContent = 'Downloading...';

              // Trigger download
              const link = document.createElement('a');
              link.href = '/shorts/clip/download/' + filename;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);

              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = 'Download Clip';
                btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)';
              }, 2000);

              showToast('Clip downloaded!');
              // Store filename for narration
              btn.dataset.lastFilename = filename;
            } else if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              showToast('Clip generation timed out. Please try again.'); btn.disabled = false; btn.textContent = originalText; btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)'; return;
            } else {
              // Update progress with server message
              const msg = statusData.message || '';
              if (msg.startsWith('Encoding:')) {
                btn.textContent = msg;
              } else if (msg !== 'Still processing...') {
                btn.textContent = msg.substring(0, 30);
              } else {
                const dots = '.'.repeat((attempts % 3) + 1);
                btn.textContent = 'Processing' + dots;
              }
            }
          } catch (pollError) {
            clearInterval(pollInterval);
            showToast(pollError.message || 'Failed to check clip status'); btn.disabled = false; btn.textContent = originalText; btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)';
          }
        }, 2000);

      } catch (error) {
        showToast(error.message || 'Failed to generate clip');
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)';
      }
    }

    // Preferred caption style — set by user on /caption-presets > Use Style.
    // Loaded on page open; applied as the default value on every moment-card's
    // caption-style picker so the user's choice actually takes effect.
    window.__preferredCaptionStyle = null;
    (async () => {
      try {
        const r = await fetch('/caption-presets/get-preference', { credentials: 'same-origin' });
        if (!r.ok) return;
        const data = await r.json();
        if (data && data.style) window.__preferredCaptionStyle = data.style;
      } catch (e) {}
    })();

    // Deep link handlers:
    //   /shorts?dlAnalysis=ID&dlMoment=N → open analysis + auto-click Download Clip
    //   /shorts?openAnalysis=ID          → open analysis modal only (used by /dashboard
    //                                       redirect after AI completes the analysis)
    (async () => {
      try {
        var params = new URLSearchParams(location.search);
        var dlAnalysis = params.get('dlAnalysis');
        var dlMoment = params.get('dlMoment');
        var openAnalysis = params.get('openAnalysis');
        var targetId = dlAnalysis || openAnalysis;
        if (!targetId) return;
        // Wait for viewAnalysis to be defined (script may still be parsing)
        var tries = 0;
        while (typeof viewAnalysis !== 'function' && tries < 20) {
          await new Promise(r => setTimeout(r, 100));
          tries++;
        }
        if (typeof viewAnalysis !== 'function') return;
        await viewAnalysis(targetId);
        if (dlAnalysis && dlMoment != null) {
          setTimeout(function(){
            var btn = document.getElementById('clip-btn-' + dlMoment);
            if (btn) btn.click();
          }, 400);
        }
      } catch (e) { console.warn('Deep-link handler failed:', e); }
    })();

    // === Workflow Templates ===
    let activeWorkflow = null;
    const workflows = {
      'yt-tiktok': { clipStyle: 'blur', captions: true, platforms: ['tiktok', 'instagram'], name: 'YouTube to TikTok' },
      'yt-shorts': { clipStyle: 'crop', captions: true, platforms: ['shorts'], name: 'YouTube to YT Shorts' },
      'yt-linkedin': { clipStyle: 'fit', captions: false, platforms: ['linkedin', 'blog'], name: 'YouTube to LinkedIn' },
      'yt-all': { clipStyle: 'blur', captions: true, platforms: ['tiktok','instagram','shorts','twitter','linkedin','thread','blog','newsletter'], name: 'YouTube to Everything' },
      'podcast': { clipStyle: 'pip', captions: true, platforms: ['twitter', 'thread', 'newsletter'], name: 'Podcast to Clips' },
      'education': { clipStyle: 'fit', captions: true, platforms: ['blog', 'linkedin'], name: 'Education to Blog' }
    };

    function toggleToolPanel(panelId, cardEl) {
      var allPanels = ['quickNarratePanel','workflowPanel','batchPanel','brandKitPanel','autoGenPanel'];
      var panel = document.getElementById(panelId);
      var isVisible = panel.style.display !== 'none';
      // Close all panels first + drop the open marker
      allPanels.forEach(function(id) {
        var p = document.getElementById(id);
        if (p) { p.style.display = 'none'; p.classList.remove('tool-panel-open'); p.classList.remove('tool-panel'); }
      });
      // Remove active state from all cards (clear inline styles so the .tool-active CSS wins)
      var cards = document.querySelectorAll('[onclick*="toggleToolPanel"]');
      cards.forEach(function(c) {
        c.classList.remove('tool-active');
        c.style.borderColor = '';
        c.style.transform = '';
        c.style.boxShadow = '';
      });
      // Toggle the clicked panel
      if (!isVisible) {
        panel.style.display = 'block';
        panel.classList.add('tool-panel');
        panel.classList.add('tool-panel-open');
        if (cardEl) {
          cardEl.classList.add('tool-active');
          // Clear inline styles so the .tool-active rules apply cleanly
          cardEl.style.borderColor = '';
          cardEl.style.transform = '';
          cardEl.style.boxShadow = '';
        }
      }
    }

    function toggleWorkflows(forceShow) {
      const panel = document.getElementById('workflowPanel');
      if (forceShow === true) return; // handled by toggleToolPanel
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function applyWorkflow(workflowId) {
      activeWorkflow = workflows[workflowId];
      if (!activeWorkflow) return;

      showToast('Workflow "' + activeWorkflow.name + '" active! Analyze a video to use it.');
      document.getElementById('workflowPanel').style.display = 'none';

      showToast('Workflow "' + activeWorkflow.name + '" applied! Analyze a video to use it.', 'success');
    }

    function clearWorkflow() {
      activeWorkflow = null;
      showToast('Workflow cleared');
    }

    // Override viewAnalysis to apply workflow settings
    const _origViewAnalysis = viewAnalysis;
    viewAnalysis = async function(id) {
      await _origViewAnalysis(id);
      if (activeWorkflow) {
        // Apply workflow settings to all moment cards
        setTimeout(() => {
          const moments = document.querySelectorAll('.moment-card');
          moments.forEach((card, idx) => {
            const styleSelect = document.getElementById('clip-style-' + idx);
            if (styleSelect) styleSelect.value = activeWorkflow.clipStyle;
            const captionsCheck = document.getElementById('captions-' + idx);
            if (captionsCheck) captionsCheck.checked = activeWorkflow.captions;
          });
        }, 100);
      }
    };

    // === Content Calendar ===
    let calendarMonth = new Date().getMonth();
    let calendarYear = new Date().getFullYear();
    let calendarEntries = [];

    const platformEmojis = {
      tiktok: '&#9834;', instagram: '&#x1F4F7;', shorts: '&#x25B6;',
      twitter: '&#x1F426;', linkedin: 'in', blog: '&#x270F;', newsletter: '&#x2709;'
    };
    const statusColors = {
      planned: '#6c5ce7', drafted: '#f39c12', ready: '#10b981', published: '#00b894'
    };

    function changeCalendarMonth(delta) {
      calendarMonth += delta;
      if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
      if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
      renderCalendar();
    }

    // Per-platform brand color + official SVG logo for the small circular badges
    // shown inside each day cell. SVGs adapted from the platform-icons set in
    // routes/distribute.js so they match the rest of the app's branding.
    const PLATFORM_LOGO = {
      tiktok:    { color: '#25F4EE', label: 'TikTok',    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .56.04.81.1v-3.5a6.37 6.37 0 0 0-.81-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.82a4.83 4.83 0 0 1-1-.13z"/></svg>' },
      instagram: { color: '#E4405F', label: 'Instagram', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
      shorts:    { color: '#FF0000', label: 'YT Shorts', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-1 2.53-3.37 1.53-5.36C18.78 2.22 17.39 1.4 15.92 1.4c-.61 0-1.23.14-1.81.45L4 7.4c-1.84 1-2.53 3.37-1.53 5.36.7 1.39 2.07 2.22 3.55 2.22h.04l-.65.36c-1.84 1.03-2.53 3.4-1.5 5.36.7 1.39 2.07 2.22 3.54 2.22.61 0 1.23-.14 1.81-.45l11-6c1.84-1 2.53-3.37 1.53-5.36-.5-1.04-1.31-1.69-2.32-1.99zM10 15.04V8.82l5.5 3.13L10 15.04z"/></svg>' },
      youtube:   { color: '#FF0000', label: 'YouTube',   svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
      twitter:   { color: '#000000', label: 'X',         svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
      linkedin:  { color: '#0A66C2', label: 'LinkedIn',  svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
      facebook:  { color: '#1877F2', label: 'Facebook',  svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
      blog:      { color: '#10B981', label: 'Blog',      svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>' },
      newsletter:{ color: '#F59E0B', label: 'Newsletter',svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>' }
    };

    function goToCalendarToday(){
      const t = new Date();
      calendarMonth = t.getMonth();
      calendarYear = t.getFullYear();
      renderCalendar();
    }

    function openShortsCalendar(){
      // Show the modal first (instant feedback), then refresh data so the
      // grid reflects the latest entries. Subsequent renders update in place.
      var m = document.getElementById('calendarModal');
      if (m) m.style.display = 'flex';
      if (typeof renderCalendar === 'function') renderCalendar();
    }

    async function renderCalendar() {
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      document.getElementById('calendarMonthLabel').textContent = months[calendarMonth] + ' ' + calendarYear;

      const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
      const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
      const startDate = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-01';
      const endDate = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-' + String(daysInMonth).padStart(2,'0');

      try {
        const resp = await fetch('/shorts/calendar?start=' + startDate + '&end=' + endDate);
        const data = await resp.json();
        calendarEntries = data.entries || [];
      } catch (e) { calendarEntries = []; }

      const grid = document.getElementById('calendarGrid');
      let html = '';

      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
        html += '<div style="padding:9px 0;text-align:center;font-size:10px;color:#8886a0;font-weight:700;background:rgba(255,255,255,0.03);text-transform:uppercase;letter-spacing:.06em;">' + d + '</div>';
      });

      for (let i = 0; i < firstDay; i++) {
        html += '<div style="padding:8px;min-height:78px;background:rgba(255,255,255,0.02);"></div>';
      }

      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
        const isToday = dateStr === todayStr;
        const dayEntries = calendarEntries.filter(e => (e.scheduled_date || '').substring(0,10) === dateStr);

        const cellStyle = 'padding:8px;min-height:78px;background:' + (isToday ? 'rgba(108,58,237,0.10)' : 'rgba(8,6,18,0.50)') + ';display:flex;flex-direction:column;gap:6px;cursor:default;border-top:' + (isToday ? '2px solid #6C3AED' : '1px solid transparent') + ';';
        html += '<div style="' + cellStyle + '">';
        html += '<div style="font-size:11px;font-weight:600;color:' + (isToday ? '#a78bfa' : '#8886a0') + ';">' + day + '</div>';

        if (dayEntries.length > 0) {
          // Circular platform logos — overlap when multiple platforms scheduled
          html += '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0;">';
          // Build set of unique platforms (a single date can have multiple posts on same platform; collapse to one badge per platform)
          const uniquePlatforms = [];
          const seen = new Set();
          for (const e of dayEntries) {
            if (!seen.has(e.platform)) { seen.add(e.platform); uniquePlatforms.push(e.platform); }
          }
          const visible = uniquePlatforms.slice(0, 4);
          visible.forEach((p, i) => {
            const meta = PLATFORM_LOGO[p] || { color: '#6c5ce7', emoji: '•', label: p };
            const overlap = i > 0 ? 'margin-left:-6px;' : '';
            html += '<span title="' + meta.label + '" style="' + overlap + 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:' + meta.color + ';border:2px solid #1a1a2e;color:#fff;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.4);z-index:' + (10 - i) + ';position:relative;"><span style="width:13px;height:13px;display:inline-flex;align-items:center;justify-content:center;">' + (meta.svg || '') + '</span></span>';
          });
          if (uniquePlatforms.length > 4) {
            html += '<span title="+' + (uniquePlatforms.length - 4) + ' more" style="margin-left:-6px;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#3a3850;border:2px solid #1a1a2e;color:#e2e0f0;font-size:9px;font-weight:700;flex-shrink:0;position:relative;">+' + (uniquePlatforms.length - 4) + '</span>';
          }
          html += '</div>';
        }

        html += '</div>';
      }

      // Always render 6 weeks (42 day-cells) so the modal height is constant
      // regardless of which month is shown — no jumping between 4/5/6 rows.
      const trailingBlanks = 42 - firstDay - daysInMonth;
      for (let i = 0; i < trailingBlanks; i++) {
        html += '<div style="padding:8px;min-height:78px;background:rgba(255,255,255,0.02);"></div>';
      }

      grid.innerHTML = html;
    }

    function openAddEntry(dateStr) {
      // Default to today if no date provided (e.g. from header + Add Entry button)
      if (!dateStr) {
        var now = new Date();
        dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      }
      // Check if this day has existing entries
      var dayEntries = calendarEntries.filter(function(e) {
        return (e.scheduled_date || '').substring(0,10) === dateStr;
      });

      if (dayEntries.length > 0) {
        // Show the day modal with existing entries + option to add
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var d = new Date(dateStr + 'T12:00:00');
        document.getElementById('dayModalTitle').textContent = months[d.getMonth()] + ' ' + d.getDate() + ' — ' + dayEntries.length + ' entr' + (dayEntries.length === 1 ? 'y' : 'ies');

        var statusColors2 = { planned: '#6c5ce7', drafted: '#fdcb6e', ready: '#00b894', published: '#0984e3' };
        var platformEmojis2 = { tiktok: '🎵', instagram: '📸', shorts: '🎬', twitter: '🐦', linkedin: '💼', blog: '📝', newsletter: '📧' };

        var listHtml = '';
        dayEntries.forEach(function(entry) {
          var sc = statusColors2[entry.status] || '#6c5ce7';
          listHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ' + sc + ';border-radius:8px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:14px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (platformEmojis2[entry.platform] || '') + ' ' + (entry.title || 'Untitled') + '</div>' +
              '<div style="font-size:11px;color:#888;margin-top:2px;">' + (entry.status || 'planned') + (entry.scheduled_time ? ' at ' + entry.scheduled_time : '') + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px;">' +
              '<button class="btn btn-small" style="font-size:11px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:6px 10px;" onclick="document.getElementById(' + "'" + 'calendarDayModal' + "'" + ').style.display=' + "'" + 'none' + "'" + ';editCalendarEntry(' + "'" + entry.id + "'" + ')">Edit</button>' +
              '<button class="btn btn-small" style="font-size:11px;background:rgba(255,0,0,0.15);color:#ff6b6b;padding:6px 10px;" onclick="quickDeleteEntry(' + "'" + entry.id + "'" + ')">Delete</button>' +
            '</div>' +
          '</div>';
        });

        document.getElementById('dayModalEntries').innerHTML = listHtml;
        document.getElementById('dayModalAddBtn').onclick = function() {
          document.getElementById('calendarDayModal').style.display = 'none';
          openNewEntry(dateStr);
        };
        document.getElementById('calendarDayModal').style.display = 'flex';
      } else {
        // No entries — go straight to add form
        openNewEntry(dateStr);
      }
    }

    

        var calPickerDate = new Date();
        
        function toggleDatePicker() {
          var picker = document.getElementById('cal-date-picker');
          var timePicker = document.getElementById('cal-time-picker');
          if (timePicker) timePicker.style.display = 'none';
          if (picker.style.display === 'none') {
            var val = document.getElementById('cal-date').value;
            if (val) { var parts = val.split('-'); calPickerDate = new Date(parts[0], parts[1]-1, parts[2]); }
            renderCalendarPicker();
            picker.style.display = 'block';
          } else {
            picker.style.display = 'none';
          }
        }
        
        function changeMonth(dir) {
          calPickerDate.setMonth(calPickerDate.getMonth() + dir);
          renderCalendarPicker();
        }
        
        function renderCalendarPicker() {
          var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          var y = calPickerDate.getFullYear();
          var m = calPickerDate.getMonth();
          document.getElementById('cal-picker-month').textContent = months[m] + ' ' + y;
          var first = new Date(y, m, 1).getDay();
          var days = new Date(y, m+1, 0).getDate();
          var sel = document.getElementById('cal-date').value;
          var html = '';
          for (var i = 0; i < first; i++) html += '<span></span>';
          for (var d = 1; d <= days; d++) {
            var ds = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
            var isToday = ds === new Date().toISOString().split('T')[0];
            var isSel = ds === sel;
            var bg = isSel ? '#6c5ce7' : isToday ? 'rgba(108,92,231,0.3)' : 'transparent';
            var border = isToday && !isSel ? '1px solid #6c5ce7' : '1px solid transparent';
            html += '<button type="button" onclick="selectDate(\\'' + ds + '\\')" style="background:' + bg + ';border:' + border + ';color:#fff;border-radius:6px;padding:6px;cursor:pointer;font-size:13px;">' + d + '</button>';
          }
          document.getElementById('cal-picker-days').innerHTML = html;
        }
        
        function selectDate(ds) {
          document.getElementById('cal-date').value = ds;
          var parts = ds.split('-');
          var d = new Date(parts[0], parts[1]-1, parts[2]);
          var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          document.getElementById('cal-date-display').value = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
          document.getElementById('cal-date-picker').style.display = 'none';
        }
        
        function toggleTimePicker() {
          var picker = document.getElementById('cal-time-picker');
          var datePicker = document.getElementById('cal-date-picker');
          if (datePicker) datePicker.style.display = 'none';
          if (picker.style.display === 'none') {
            var val = document.getElementById('cal-time').value || '12:00';
            var parts = val.split(':');
            var h = parseInt(parts[0]); var m = parseInt(parts[1]);
            var ampm = h >= 12 ? 'PM' : 'AM';
            var h12 = h % 12; if (h12 === 0) h12 = 12;
            document.getElementById('cal-time-hour').textContent = String(h12).padStart(2,'0');
            document.getElementById('cal-time-min').textContent = String(m).padStart(2,'0');
            document.getElementById('cal-time-ampm').textContent = ampm;
            picker.style.display = 'block';
          } else {
            picker.style.display = 'none';
          }
        }
        
        function adjustTime(part, dir) {
          var hEl = document.getElementById('cal-time-hour');
          var mEl = document.getElementById('cal-time-min');
          var apEl = document.getElementById('cal-time-ampm');
          var h = parseInt(hEl.textContent);
          var m = parseInt(mEl.textContent);
          if (part === 'hour') { h += dir; if (h > 12) h = 1; if (h < 1) h = 12; hEl.textContent = String(h).padStart(2,'0'); }
          if (part === 'min') { m += dir * 5; if (m >= 60) m = 0; if (m < 0) m = 55; mEl.textContent = String(m).padStart(2,'0'); }
          if (part === 'ampm') { apEl.textContent = apEl.textContent === 'AM' ? 'PM' : 'AM'; }
          updateTimeHidden();
        }
        
        function updateTimeHidden() {
          var h = parseInt(document.getElementById('cal-time-hour').textContent);
          var m = parseInt(document.getElementById('cal-time-min').textContent);
          var ap = document.getElementById('cal-time-ampm').textContent;
          if (ap === 'PM' && h !== 12) h += 12;
          if (ap === 'AM' && h === 12) h = 0;
          document.getElementById('cal-time').value = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
        }
        
        function confirmTime() {
          updateTimeHidden();
          var h = document.getElementById('cal-time-hour').textContent;
          var m = document.getElementById('cal-time-min').textContent;
          var ap = document.getElementById('cal-time-ampm').textContent;
          document.getElementById('cal-time-display').value = h + ':' + m + ' ' + ap;
          document.getElementById('cal-time-picker').style.display = 'none';
        }
        
        function setDateDisplay(dateStr) {
          if (!dateStr) { document.getElementById('cal-date-display').value = ''; return; }
          var parts = dateStr.split('-');
          var d = new Date(parts[0], parts[1]-1, parts[2]);
          var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          document.getElementById('cal-date-display').value = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
        }
        
        function setTimeDisplay(timeStr) {
          if (!timeStr) { document.getElementById('cal-time-display').value = ''; return; }
          var parts = timeStr.split(':');
          var h = parseInt(parts[0]); var m = parseInt(parts[1]);
          var ap = h >= 12 ? 'PM' : 'AM';
          var h12 = h % 12; if (h12 === 0) h12 = 12;
          document.getElementById('cal-time-display').value = String(h12).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ' ' + ap;
        }
        
        // Close pickers when clicking outside
        document.addEventListener('click', function(e) {
          var dp = document.getElementById('cal-date-picker');
          var tp = document.getElementById('cal-time-picker');
          if (dp && dp.style.display !== 'none' && !e.target.closest('#cal-date-picker') && e.target.id !== 'cal-date-display') dp.style.display = 'none';
          if (tp && tp.style.display !== 'none' && !e.target.closest('#cal-time-picker') && e.target.id !== 'cal-time-display') tp.style.display = 'none';
        });

        function openNewEntry(dateStr) {
      document.getElementById('cal-entry-id').value = '';
      document.getElementById('cal-title').value = '';
      document.getElementById('cal-date').value = dateStr || new Date().toISOString().split('T')[0];
        setDateDisplay(document.getElementById('cal-date').value);
      document.getElementById('cal-time').value = '12:00';
        setTimeDisplay('12:00');
      document.getElementById('cal-platform').value = 'tiktok';
      document.getElementById('cal-status').value = 'planned';
      document.getElementById('cal-notes').value = '';
      document.getElementById('cal-reminder').checked = false;
      document.getElementById('cal-reminder-fields').style.display = 'none';
      document.getElementById('cal-reminder-email').value = '';
      document.getElementById('cal-reminder-time').value = '30';
      document.getElementById('cal-delete-btn').style.display = 'none';
      document.getElementById('calEntryTitle').textContent = 'Add Calendar Entry';
      document.getElementById('calendarEntryModal').style.display = 'flex';
    }

    async function quickDeleteEntry(entryId) {
      if (!confirm('Delete this entry?')) return;
      try {
        await fetch('/shorts/calendar/' + entryId, { method: 'DELETE' });
        document.getElementById('calendarDayModal').style.display = 'none';
        renderCalendar();
        showToast('Entry deleted');
      } catch (e) { showToast('Error: ' + e.message); }
    }

    function editCalendarEntry(entryId) {
      const entry = calendarEntries.find(e => String(e.id) === String(entryId));
      if (!entry) return;
      document.getElementById('cal-entry-id').value = entry.id;
      document.getElementById('cal-title').value = entry.title || '';
      document.getElementById('cal-date').value = (entry.scheduled_date || '').substring(0,10);
        setDateDisplay(document.getElementById('cal-date').value);
      document.getElementById('cal-time').value = entry.scheduled_time || '12:00';
        setTimeDisplay(entry.scheduled_time || '12:00');
      document.getElementById('cal-platform').value = entry.platform || 'tiktok';
      document.getElementById('cal-status').value = entry.status || 'planned';
      document.getElementById('cal-notes').value = entry.notes || '';
      // Load reminder settings
      var hasReminder = entry.reminder_email && entry.reminder_email.trim();
      document.getElementById('cal-reminder').checked = !!hasReminder;
      document.getElementById('cal-reminder-fields').style.display = hasReminder ? 'block' : 'none';
      document.getElementById('cal-reminder-email').value = entry.reminder_email || '';
      document.getElementById('cal-reminder-time').value = entry.reminder_minutes || '30';
      document.getElementById('cal-delete-btn').style.display = 'block';
      document.getElementById('calEntryTitle').textContent = 'Edit Calendar Entry';
      document.getElementById('calendarEntryModal').style.display = 'flex';
    }

    function closeCalendarModal() {
      document.getElementById('calendarEntryModal').style.display = 'none';
    }

    async function saveCalendarEntry() {
      const entryId = document.getElementById('cal-entry-id').value;
      const reminderChecked = document.getElementById('cal-reminder').checked;
      const data = {
        title: document.getElementById('cal-title').value,
        scheduledDate: document.getElementById('cal-date').value,
        scheduledTime: document.getElementById('cal-time').value,
        platform: document.getElementById('cal-platform').value,
        status: document.getElementById('cal-status').value,
        notes: document.getElementById('cal-notes').value,
        reminderEmail: reminderChecked ? document.getElementById('cal-reminder-email').value : '',
        reminderMinutes: reminderChecked ? parseInt(document.getElementById('cal-reminder-time').value) : 0
      };
      if (!data.title || !data.scheduledDate) { showToast('Title and date required'); return; }
      if (reminderChecked && !data.reminderEmail) { showToast('Please enter your email for the reminder'); return; }

      try {
        const url = entryId ? '/shorts/calendar/' + entryId : '/shorts/calendar';
        const method = entryId ? 'PUT' : 'POST';
        const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await resp.json();
        if (result.success) {
          closeCalendarModal();
          renderCalendar();
          showToast(entryId ? 'Entry updated' : 'Entry added');
        } else {
          throw new Error(result.error);
        }
      } catch (e) { showToast('Error: ' + e.message); }
    }

    async function deleteCalendarEntry() {
      const entryId = document.getElementById('cal-entry-id').value;
      if (!entryId || !confirm('Delete this entry?')) return;
      try {
        await fetch('/shorts/calendar/' + entryId, { method: 'DELETE' });
        closeCalendarModal();
        renderCalendar();
        showToast('Entry deleted');
      } catch (e) { showToast('Error: ' + e.message); }
    }

    // Reminder checkbox toggle
    (function() {
      var cb = document.getElementById('cal-reminder');
      if (cb) {
        cb.addEventListener('change', function() {
          document.getElementById('cal-reminder-fields').style.display = this.checked ? 'block' : 'none';
          if (this.checked) {
            var emailField = document.getElementById('cal-reminder-email');
            if (!emailField.value) emailField.value = '${user.email || ''}';
          }
        });
      }
    })();

    // Initialize calendar
    renderCalendar();

    // === Batch Analysis & Export ===
    function toggleBatchInput(forceShow) {
      if (forceShow === true) return; // handled by toggleToolPanel
      const panel = document.getElementById('batchPanel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    async function startBatchAnalysis() {
      const textarea = document.getElementById('batchUrls');
      const urls = textarea.value.split('\\n').map(u => u.trim()).filter(u => u.length > 0);
      if (urls.length === 0) { showToast('Enter at least one URL'); return; }

      const btn = document.getElementById('batchBtn');
      const status = document.getElementById('batchStatus');
      btn.disabled = true;
      btn.textContent = 'Processing...';
      status.textContent = 'Sending ' + urls.length + ' videos for analysis...';

      try {
        const resp = await fetch('/shorts/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrls: urls })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error);

        status.textContent = 'Processing ' + data.totalVideos + ' videos... This may take a few minutes.';

        // Poll for completion
        const batchId = data.batchId;
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const sResp = await fetch('/shorts/batch-status/' + batchId);
            const sData = await sResp.json();
            if (sData.complete) {
              clearInterval(poll);
              const results = sData.results;
              const completed = results.filter(r => r.status === 'completed').length;
              const failed = results.filter(r => r.status === 'failed').length;

              status.textContent = completed + ' completed, ' + failed + ' failed';
              status.style.color = '#10b981';

              // Show results
              const resultsDiv = document.getElementById('batchResults');
              resultsDiv.style.display = 'block';
              resultsDiv.innerHTML = results.map(r =>
                '<div style="padding:8px 12px;background:' + (r.status === 'completed' ? 'rgba(16,185,129,0.1)' : 'rgba(255,107,107,0.1)') +
                ';border-radius:6px;margin-bottom:6px;font-size:13px;display:flex;justify-content:space-between;align-items:center;">' +
                  '<span>' + (r.title || r.videoId) + '</span>' +
                  (r.status === 'completed'
                    ? '<span style="color:#10b981;">' + r.momentCount + ' moments</span>'
                    : '<span style="color:#ff6b6b;">Failed</span>') +
                '</div>'
              ).join('');

              btn.disabled = false;
              btn.textContent = 'Analyze All';
              showToast('Batch analysis complete! Refresh to see all analyses.');
              setTimeout(() => location.reload(), 2000);
            } else if (attempts >= 180) {
              clearInterval(poll);
              status.textContent = 'Timed out. Some videos may still be processing.';
              btn.disabled = false;
              btn.textContent = 'Analyze All';
            } else {
              const dots = '.'.repeat((attempts % 3) + 1);
              status.textContent = 'Processing' + dots + ' (' + Math.round(attempts * 2/60) + ' min)';
            }
          } catch (e) {
            clearInterval(poll);
            status.textContent = 'Error checking status';
            btn.disabled = false;
            btn.textContent = 'Analyze All';
          }
        }, 2000);

      } catch (error) {
        showToast(error.message);
        btn.disabled = false;
        btn.textContent = 'Analyze All';
        status.textContent = '';
      }
    }

    async function exportAllClips(analysisId) {
      // Client-side ZIP: generates each clip, downloads it, and bundles into ZIP
      // This works reliably even after server restarts since clips are generated fresh
      const exportBtn = document.querySelector('[onclick*="exportAllClips"]');
      if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = 'Generating clips...'; }

      try {
        // Get analysis data to find all moments
        const analysisResp = await fetch('/shorts/analysis/' + analysisId);
        if (!analysisResp.ok) throw new Error('Could not load analysis');
        const analysis = await analysisResp.json();
        const moments = analysis.moments || [];
        if (moments.length === 0) { showToast('No moments found to export', true); return; }

        // Get current settings
        const styleSelect = document.querySelector('select[onchange*="clipStyle"]') || {};
        const captionsCheckbox = document.querySelector('input[type="checkbox"][onchange*="captions"]');
        const clipStyle = styleSelect.value || 'blur';
        const includeCaptions = captionsCheckbox ? captionsCheckbox.checked : true;

        const zip = new JSZip();
        let completed = 0;

        for (let i = 0; i < moments.length; i++) {
          const moment = moments[i];
          if (exportBtn) exportBtn.textContent = 'Clip ' + (i+1) + '/' + moments.length + '...';
          showToast('Generating clip ' + (i+1) + ' of ' + moments.length + ': ' + (moment.title || 'Clip'));

          // Request clip generation
          const genResp = await fetch('/shorts/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisId, momentIndex: i, includeCaptions, clipStyle })
          });
          if (!genResp.ok) { console.error('Clip ' + i + ' generation failed'); continue; }
          const genData = await genResp.json();
          if (!genData.success) { console.error('Clip ' + i + ':', genData.error); continue; }

          // Poll until ready (max 5 min per clip)
          const filename = genData.filename;
          let ready = false;
          for (let attempt = 0; attempt < 150; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            const statusResp = await fetch('/shorts/clip/status/' + filename);
            const status = await statusResp.json();
            if (status.failed) { console.error('Clip ' + i + ' failed:', status.message); break; }
            if (status.ready) { ready = true; break; }
            if (status.message && exportBtn) exportBtn.textContent = 'Clip ' + (i+1) + '/' + moments.length + ': ' + status.message;
          }

          if (!ready) continue;

          // Download clip blob and add to ZIP
          const clipResp = await fetch('/shorts/clip/download/' + filename);
          if (clipResp.ok) {
            const blob = await clipResp.blob();
            const safeName = (moment.title || 'clip_' + (i+1)).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0,40);
            zip.file(safeName + '.mp4', blob);
            completed++;
          }
        }

        if (completed === 0) {
          showToast('No clips were generated successfully', true);
          return;
        }

        // Generate and download ZIP
        if (exportBtn) exportBtn.textContent = 'Creating ZIP...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        const safeTitle = (analysis.video_title || 'export').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0,30);
        a.download = safeTitle + '_clips.zip';
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(completed + ' clips exported as ZIP!');
      } catch (err) {
        showToast('Export failed: ' + err.message, true);
      } finally {
        if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = 'Export All (ZIP)'; }
      }
    }

    // === Auto-Generate Shorts ===
    var agSelectedDuration = 30;
    var agGeneratedClips = [];

    function selectAgDuration(btn) {
      document.querySelectorAll('.ag-dur-btn').forEach(function(b) {
        b.style.background = 'var(--dark)';
        b.style.color = 'var(--text-muted)';
      });
      btn.style.background = 'rgba(224,86,253,0.15)';
      btn.style.color = '#e056fd';
      var dur = btn.getAttribute('data-dur');
      if (dur === 'custom') {
        document.getElementById('ag-custom-dur').style.display = 'inline-block';
      } else {
        document.getElementById('ag-custom-dur').style.display = 'none';
        agSelectedDuration = parseInt(dur);
      }
    }

    async function autoGenerateShorts() {
      var urlInput = document.getElementById('ag-videoUrl');
      var videoUrl = urlInput.value.trim();
      if (!videoUrl) { showToast('Please paste a YouTube URL'); return; }

      var numClips = parseInt(document.getElementById('ag-count').value);
      var durBtn = document.querySelector('.ag-dur-btn[style*="rgba(224,86,253"]');
      var duration = agSelectedDuration;
      if (durBtn && durBtn.getAttribute('data-dur') === 'custom') {
        duration = parseInt(document.getElementById('ag-custom-dur').value) || 60;
      }
      var clipStyle = document.getElementById('ag-clipStyle').value;
      var captionStyle = document.getElementById('ag-captionStyle').value;
      var language = document.getElementById('ag-lang').value;
      var includeCaptions = captionStyle !== 'none';

      var btn = document.getElementById('ag-btn');
      btn.disabled = true;
      btn.textContent = 'Starting...';

      var progress = document.getElementById('ag-progress');
      var progressBar = document.getElementById('ag-progress-bar');
      var progressLabel = document.getElementById('ag-progress-label');
      var progressCount = document.getElementById('ag-progress-count');
      progress.style.display = 'block';
      progressBar.style.width = '0%';
      progressLabel.textContent = 'Analyzing video...';
      progressCount.textContent = '0/' + numClips;

      var results = document.getElementById('ag-results');
      var resultsGrid = document.getElementById('ag-results-grid');
      results.style.display = 'none';
      resultsGrid.innerHTML = '';
      agGeneratedClips = [];

      try {
        // Step 1: Call auto-generate endpoint
        var resp = await fetch('/shorts/auto-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl, numClips, duration, clipStyle, captionStyle, language, includeCaptions })
        });

        if (!resp.ok) {
          var errData = await resp.json().catch(function() { return { error: 'Server error' }; });
          throw new Error(errData.error || 'Failed to start auto-generation');
        }

        // SSE stream for progress
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        while (true) {
          var result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });

          var lines = buffer.split('\\n');
          buffer = lines.pop() || '';

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.startsWith('data: ')) {
              try {
                var data = JSON.parse(line.substring(6));

                if (data.status === 'analyzing') {
                  progressLabel.textContent = data.message || 'Analyzing...';
                  btn.textContent = 'Analyzing...';
                } else if (data.status === 'generating') {
                  progressLabel.textContent = data.message || 'Generating clips...';
                  btn.textContent = 'Generating...';
                  if (data.current && data.total) {
                    var pct = Math.round((data.current / data.total) * 100);
                    progressBar.style.width = pct + '%';
                    progressCount.textContent = data.current + '/' + data.total;
                  }
                } else if (data.status === 'clip_ready') {
                  // A clip is done — add it to the results
                  agGeneratedClips.push(data);
                  addAutoGenClipCard(data);
                  results.style.display = 'block';
                } else if (data.status === 'complete') {
                  progressBar.style.width = '100%';
                  progressLabel.textContent = 'All done!';
                  progressCount.textContent = (data.totalGenerated || agGeneratedClips.length) + '/' + numClips;
                  btn.innerHTML = '<img src="/images/section-icons/A-89.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Shorts';
                  btn.disabled = false;
                  showToast((data.totalGenerated || agGeneratedClips.length) + ' shorts generated!');
                } else if (data.status === 'error') {
                  throw new Error(data.message || 'Generation failed');
                }
              } catch (parseErr) {
                if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
              }
            }
          }
        }
      } catch (err) {
        showToast('Auto-generate failed: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<img src="/images/section-icons/A-89.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Shorts';
      }
    }

    function addAutoGenClipCard(data) {
      var grid = document.getElementById('ag-results-grid');
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--dark);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;transition:all 0.3s;';
      card.onmouseenter = function() { this.style.borderColor = 'rgba(224,86,253,0.3)'; this.style.transform = 'translateY(-2px)'; };
      card.onmouseleave = function() { this.style.borderColor = 'rgba(255,255,255,0.08)'; this.style.transform = 'none'; };

      var timeDisplay = data.timeRange || ('Clip ' + (data.index + 1));
      var durDisplay = data.duration ? (data.duration + 's') : '';

      card.innerHTML = '<div style="padding:14px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<div style="font-weight:700;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + (data.title || 'Short ' + (data.index + 1)) + '</div>' +
          (data.viralityScore ? '<div style="background:linear-gradient(135deg,#e056fd,#a29bfe);color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-left:8px;">' + data.viralityScore + '%</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
          '<span style="font-size:11px;background:rgba(224,86,253,0.12);color:#e056fd;padding:2px 8px;border-radius:6px;font-weight:600;">' + timeDisplay + '</span>' +
          (durDisplay ? '<span style="font-size:11px;color:var(--text-dim);">' + durDisplay + '</span>' : '') +
        '</div>' +
        (data.description ? '<p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:10px;">' + data.description.substring(0, 100) + '</p>' : '') +
        '<a href="/shorts/clip/download/' + data.filename + '" download ' +
          'style="display:block;text-align:center;padding:8px;background:linear-gradient(135deg,#e056fd,#a29bfe);color:#fff;text-decoration:none;border-radius:8px;font-size:12px;font-weight:600;transition:all 0.2s;"' +
          'onmouseenter="this.style.opacity=0.9" onmouseleave="this.style.opacity=1">' +
          'Download' +
        '</a>' +
      '</div>';

      grid.appendChild(card);
    }

    async function downloadAllAutoGenClips() {
      if (agGeneratedClips.length === 0) { showToast('No clips to download'); return; }

      var dlBtn = document.getElementById('ag-download-all');
      dlBtn.disabled = true;
      dlBtn.textContent = 'Creating ZIP...';

      try {
        var zip = new JSZip();
        for (var i = 0; i < agGeneratedClips.length; i++) {
          var clip = agGeneratedClips[i];
          dlBtn.textContent = 'Downloading ' + (i+1) + '/' + agGeneratedClips.length + '...';
          var resp = await fetch('/shorts/clip/download/' + clip.filename);
          if (resp.ok) {
            var blob = await resp.blob();
            var safeName = (clip.title || 'short_' + (i+1)).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
            zip.file(safeName + '.mp4', blob);
          }
        }

        dlBtn.textContent = 'Zipping...';
        var zipBlob = await zip.generateAsync({ type: 'blob' });
        var url = URL.createObjectURL(zipBlob);
        var a = document.createElement('a');
        a.download = 'auto_generated_shorts.zip';
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(agGeneratedClips.length + ' shorts downloaded as ZIP!');
      } catch (err) {
        showToast('ZIP download failed: ' + err.message, true);
      } finally {
        dlBtn.disabled = false;
        dlBtn.innerHTML = '<img src="/images/section-icons/A-94.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Download All (ZIP)';
      }
    }

    // === Virality Score Breakdown ===
    async function showViralityBreakdown(analysisId, momentIndex) {
      // Show loading overlay
      const overlayId = 'virality-overlay';
      const existing = document.getElementById(overlayId);
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = '<div style="background:#1a1a2e;border-radius:16px;padding:24px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;">' +
        '<div style="text-align:center;padding:20px;"><div style="font-size:24px;margin-bottom:8px;">Analyzing virality...</div><p style="color:#888;">Getting AI insights</p></div></div>';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);

      try {
        const resp = await fetch('/shorts/virality-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, momentIndex })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error);

        const b = data.breakdown;
        const scoreBar = (label, value, color) =>
          '<div style="margin-bottom:10px;">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">' +
              '<span style="color:#ccc;">' + label + '</span><span style="color:' + color + ';font-weight:600;">' + value + '%</span>' +
            '</div>' +
            '<div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;">' +
              '<div style="height:100%;width:' + value + '%;background:' + color + ';border-radius:3px;transition:width 0.8s;"></div>' +
            '</div>' +
          '</div>';

        const getColor = (v) => v >= 80 ? '#10b981' : v >= 60 ? '#f39c12' : '#ff6b6b';

        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">' +
          '<h3 style="font-size:18px;">Virality Breakdown</h3>' +
          '<button class="btn btn-small" style="background:rgba(255,255,255,0.1);" onclick="document.getElementById(' + "'" + overlayId + "'" + ').remove()">Close</button>' +
        '</div>';

        // Score bars
        html += scoreBar('Hook Strength', b.hookStrength || 0, getColor(b.hookStrength || 0));
        html += scoreBar('Emotional Impact', b.emotionalImpact || 0, getColor(b.emotionalImpact || 0));
        html += scoreBar('Shareability', b.shareability || 0, getColor(b.shareability || 0));
        html += scoreBar('Trend Alignment', b.trendAlignment || 0, getColor(b.trendAlignment || 0));
        html += scoreBar('Audience Reach', b.audienceReach || 0, getColor(b.audienceReach || 0));

        // Meta info
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;">' +
          '<div><div style="font-size:10px;color:#888;text-transform:uppercase;">Best Time</div><div style="font-size:13px;color:#fff;">' + (b.bestTimeToPost || 'N/A') + '</div></div>' +
          '<div><div style="font-size:10px;color:#888;text-transform:uppercase;">Predicted Views</div><div style="font-size:13px;color:#10b981;font-weight:600;">' + (b.predictedViews || 'N/A') + '</div></div>' +
          '<div style="grid-column:span 2;"><div style="font-size:10px;color:#888;text-transform:uppercase;">Target Audience</div><div style="font-size:13px;color:#ccc;">' + (b.targetAudience || 'N/A') + '</div></div>' +
        '</div>';

        // Boost tips
        if (b.boostTips && b.boostTips.length > 0) {
          html += '<h4 style="font-size:14px;margin-bottom:10px;color:#f39c12;">Boost Tips</h4>';
          b.boostTips.forEach((tip, i) => {
            html += '<div style="display:flex;gap:8px;margin-bottom:8px;padding:8px;background:rgba(243,156,18,0.08);border-radius:6px;">' +
              '<span style="color:#f39c12;font-weight:700;font-size:14px;">' + (i+1) + '.</span>' +
              '<span style="font-size:13px;color:#ccc;line-height:1.4;">' + tip + '</span>' +
            '</div>';
          });
        }

        overlay.querySelector('div > div').innerHTML = html;

      } catch (error) {
        overlay.querySelector('div > div').innerHTML =
          '<p style="color:#ff6b6b;text-align:center;">Error: ' + (error.message || 'Failed') + '</p>' +
          '<button class="btn" style="width:100%;margin-top:12px;background:rgba(255,255,255,0.1);" onclick="document.getElementById(' + "'" + overlayId + "'" + ').remove()">Close</button>';
      }
    }

    // === B-Roll Finder (Auto Scene Selector) ===
    // Store B-Roll data per moment for the download function
    var brollDataStore = {};

    async function findBRoll(analysisId, momentIndex, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'AI Picking Scenes...';

      try {
        var resp = await fetch('/shorts/broll-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId: analysisId, momentIndex: momentIndex })
        });
        var data = await resp.json();
        if (!data.success) throw new Error(data.error);

        // Store scene data for later use
        brollDataStore[momentIndex] = { analysisId: analysisId, scenes: data.scenes || [] };

        var panelId = 'broll-panel-' + momentIndex;
        var hasPexels = !data.message;
        var html = '<div style="margin-top:12px;background:rgba(243,156,18,0.04);border:1px solid rgba(243,156,18,0.2);border-radius:10px;padding:16px;" id="' + panelId + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px">' +
              '<h4 style="font-size:14px;color:#f39c12;margin:0;">AI-Selected B-Roll Scenes</h4>' +
            '</div>' +
            '<button class="btn btn-small" style="font-size:10px;background:rgba(255,255,255,0.1);" onclick="document.getElementById(' + "'" + panelId + "'" + ').remove()">Close</button>' +
          '</div>';

        if (data.message) {
          html += '<div style="margin-bottom:14px;padding:12px;background:rgba(243,156,18,0.08);border:1px solid rgba(243,156,18,0.2);border-radius:8px;">' +
            '<p style="font-size:13px;color:#f39c12;margin:0 0 8px 0;font-weight:600;">Setup Required for Auto B-Roll:</p>' +
            '<div style="font-size:12px;color:#ccc;line-height:1.6;">' +
              '<p style="margin:0 0 4px 0;">To auto-add B-Roll to your clips, add a free <strong>PEXELS_API_KEY</strong> to your Railway environment variables.</p>' +
              '<p style="margin:0 0 4px 0;">1. Go to <a href="https://www.pexels.com/api/" target="_blank" style="color:#a29bfe;font-weight:600;">pexels.com/api</a> (free signup)</p>' +
              '<p style="margin:0 0 4px 0;">2. Copy your API key</p>' +
              '<p style="margin:0 0 4px 0;">3. Add <strong>PEXELS_API_KEY</strong> in Railway env vars</p>' +
              '<p style="margin:8px 0 0 0;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;color:#888;">Meanwhile, you can browse Pexels manually for each scene below.</p>' +
            '</div>' +
          '</div>';
        }

        if (data.scenes && data.scenes.length > 0) {
          // Instructions when Pexels is connected
          if (hasPexels) {
            html += '<div style="margin-bottom:14px;padding:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;">' +
              '<p style="font-size:12px;color:#10b981;margin:0;line-height:1.5;">Select the scenes you want, choose where to place them, then click <strong>"Download Clip with B-Roll"</strong> — the B-Roll will be automatically spliced into your video!</p>' +
            '</div>';
          }

          data.scenes.forEach(function(scene, sIdx) {
            var timeBadgeColor = scene.timestamp_hint === 'beginning' ? '#00b894' : scene.timestamp_hint === 'middle' ? '#0984e3' : scene.timestamp_hint === 'end' ? '#e17055' : '#a29bfe';
            var cbId = 'broll-cb-' + momentIndex + '-' + sIdx;
            var posId = 'broll-pos-' + momentIndex + '-' + sIdx;
            var durId = 'broll-dur-' + momentIndex + '-' + sIdx;
            var hasVideo = scene.video && scene.video.videoFiles && scene.video.videoFiles.length > 0;

            html += '<div style="margin-bottom:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">';

            // Checkbox + scene info header
            html += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">';
            if (hasVideo) {
              html += '<input type="checkbox" id="' + cbId + '" checked style="margin-top:3px;width:18px;height:18px;accent-color:#f39c12;cursor:pointer;flex-shrink:0;">';
            }
            html += '<div style="flex:1;">' +
                '<span style="display:inline-block;font-size:10px;color:#fff;background:' + timeBadgeColor + ';padding:2px 8px;border-radius:10px;margin-bottom:4px;">' + (scene.timestamp_hint || 'scene') + '</span>' +
                '<p style="font-size:13px;color:#e0e0e0;margin:4px 0 0 0;">' + (scene.scene_description || '') + '</p>' +
                '<p style="font-size:11px;color:#888;margin:3px 0 0 0;font-style:italic;">' + (scene.why || '') + '</p>' +
              '</div>' +
            '</div>';

            if (hasVideo) {
              var v = scene.video;
              html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
                '<div style="position:relative;flex-shrink:0;">' +
                  '<video src="' + v.videoFiles[0].link + '" poster="' + v.thumbnail + '" style="width:160px;height:90px;object-fit:cover;border-radius:6px;display:block;border:2px solid #f39c12;cursor:pointer;" muted playsinline onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0;" onclick="this.paused?this.play():this.pause()"></video>' +
                  '<span style="position:absolute;top:4px;left:4px;background:#f39c12;color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;">AUTO-PICK</span>' +
                  '<span style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;">' + v.duration + 's</span>' +
                '</div>' +
                '<div style="flex:1;min-width:120px;">' +
                  '<div style="font-size:11px;color:#aaa;margin-bottom:6px;">By ' + v.user + '</div>';

              // Position selector
              html += '<div style="margin-bottom:6px;">' +
                '<label style="font-size:10px;color:#888;display:block;margin-bottom:3px;">Position in clip:</label>' +
                '<select id="' + posId + '" style="font-size:12px;padding:5px 8px;background:#111;color:#fff;border:1px solid #333;border-radius:5px;width:100%;cursor:pointer;">' +
                  '<option value="beginning"' + (scene.timestamp_hint === 'beginning' ? ' selected' : '') + '>Beginning (first 3s)</option>' +
                  '<option value="middle"' + (scene.timestamp_hint === 'middle' || (!scene.timestamp_hint || scene.timestamp_hint === 'scene') ? ' selected' : '') + '>Middle (halfway)</option>' +
                  '<option value="end"' + (scene.timestamp_hint === 'end' ? ' selected' : '') + '>End (last 8s)</option>' +
                  '<option value="quarter">25% in</option>' +
                  '<option value="three-quarter">75% in</option>' +
                '</select>' +
              '</div>';

              // Duration selector
              html += '<div style="margin-bottom:6px;">' +
                '<label style="font-size:10px;color:#888;display:block;margin-bottom:3px;">B-Roll duration:</label>' +
                '<select id="' + durId + '" style="font-size:12px;padding:5px 8px;background:#111;color:#fff;border:1px solid #333;border-radius:5px;width:100%;cursor:pointer;">' +
                  '<option value="3">3 seconds</option>' +
                  '<option value="5" selected>5 seconds</option>' +
                  '<option value="8">8 seconds</option>' +
                '</select>' +
              '</div>';

              // Swap button
              if (scene.alternatives && scene.alternatives.length > 0) {
                var altId = 'broll-alts-' + momentIndex + '-' + sIdx;
                html += '<button class="btn btn-small" style="font-size:10px;background:rgba(255,255,255,0.08);color:#ccc;width:100%;" onclick="var el=document.getElementById(' + "'" + altId + "'" + ');el.style.display=el.style.display===' + "'none'" + '?' + "'flex'" + ':' + "'none'" + ';">Swap Scene (' + scene.alternatives.length + ' more)</button>';
              }

              html += '</div></div>';

              // Alternatives
              if (scene.alternatives && scene.alternatives.length > 0) {
                var altId2 = 'broll-alts-' + momentIndex + '-' + sIdx;
                html += '<div id="' + altId2 + '" style="display:none;gap:8px;margin-top:6px;overflow-x:auto;padding-bottom:4px;">';
                scene.alternatives.forEach(function(alt, aIdx) {
                  var selectAltFn = 'selectAltBroll(' + momentIndex + ',' + sIdx + ',' + aIdx + ')';
                  html += '<div style="flex-shrink:0;width:120px;cursor:pointer;text-align:center;" onclick="' + selectAltFn + '">' +
                    '<img src="' + alt.thumbnail + '" style="width:120px;height:68px;object-fit:cover;border-radius:5px;display:block;border:1px solid #333;" alt="Alt B-Roll">' +
                    '<div style="font-size:9px;color:#888;margin-top:2px;">' + alt.duration + 's - ' + alt.user + '</div>' +
                    '<div style="font-size:9px;color:#f39c12;margin-top:1px;">Click to use this</div>' +
                  '</div>';
                });
                html += '</div>';
              }

            } else {
              // No Pexels key — manual browse
              html += '<div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;">' +
                '<a href="' + scene.searchUrl + '" target="_blank" class="btn btn-small" style="font-size:12px;background:linear-gradient(135deg,#f39c12,#e67e22);color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;flex-shrink:0;">Browse on Pexels</a>' +
                '<div style="flex:1;">' +
                  '<p style="font-size:12px;color:#e0e0e0;margin:0;">Search: <strong style="color:#f39c12;">' + scene.search_query + '</strong></p>' +
                '</div>' +
              '</div>';
            }

            html += '</div>';
          });

          // Download button (only when Pexels is connected)
          if (hasPexels) {
            html += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.1);">' +
              '<button class="btn btn-primary" id="broll-download-btn-' + momentIndex + '" onclick="downloadClipWithBRoll(' + "'" + analysisId + "'" + ',' + momentIndex + ',this)" ' +
                'style="width:100%;padding:12px;font-size:14px;background:linear-gradient(135deg,#f39c12 0%,#e67e22 50%,#d35400 100%);border:none;font-weight:600;">' +
                '<img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Download Clip with B-Roll' +
              '</button>' +
              '<p style="font-size:11px;color:#888;text-align:center;margin:6px 0 0 0;">Uncheck scenes you don' + "'" + 't want. Change position and duration above.</p>' +
            '</div>';
          }
        }

        html += '</div>';

        var old = document.getElementById(panelId);
        if (old) old.remove();

        btn.closest('.moment-card').insertAdjacentHTML('beforeend', html);
        btn.disabled = false;
        btn.textContent = originalText;
        showToast('AI selected ' + (data.scenes ? data.scenes.length : 0) + ' B-Roll scenes!');

      } catch (error) {
        showToast(error.message || 'Failed to find B-Roll');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // Swap to alternative B-Roll
    function selectAltBroll(momentIndex, sceneIdx, altIdx) {
      var store = brollDataStore[momentIndex];
      if (!store) return;
      var scene = store.scenes[sceneIdx];
      if (!scene || !scene.alternatives || !scene.alternatives[altIdx]) return;

      // Swap: move current video to alternatives, put selected alt as main
      var oldVideo = scene.video;
      scene.video = scene.alternatives[altIdx];
      scene.alternatives[altIdx] = oldVideo;

      // Re-render by clicking the button again
      var btn = document.getElementById('broll-btn-' + momentIndex);
      var panel = document.getElementById('broll-panel-' + momentIndex);
      if (panel) panel.remove();

      // Rebuild panel with updated data (re-use stored data)
      rebuildBrollPanel(momentIndex);
      showToast('Scene swapped!');
    }

    function rebuildBrollPanel(momentIndex) {
      var store = brollDataStore[momentIndex];
      if (!store) return;
      // Simulate the response and rebuild
      var fakeBtn = document.getElementById('broll-btn-' + momentIndex);
      if (fakeBtn) {
        var card = fakeBtn.closest('.moment-card');
        // Remove old panel
        var old = document.getElementById('broll-panel-' + momentIndex);
        if (old) old.remove();
        // Trigger findBRoll which will use the API again - instead, just call with cached data
        fakeBtn.click();
      }
    }

    // Download clip with selected B-Roll spliced in
    async function downloadClipWithBRoll(analysisId, momentIndex, btn) {
      var store = brollDataStore[momentIndex];
      if (!store) { showToast('No B-Roll data found. Click Auto B-Roll first.'); return; }

      // Gather selected scenes
      var selectedScenes = [];
      store.scenes.forEach(function(scene, sIdx) {
        var cb = document.getElementById('broll-cb-' + momentIndex + '-' + sIdx);
        if (!cb || !cb.checked) return;
        if (!scene.video || !scene.video.videoFiles || !scene.video.videoFiles.length) return;

        var posSelect = document.getElementById('broll-pos-' + momentIndex + '-' + sIdx);
        var durSelect = document.getElementById('broll-dur-' + momentIndex + '-' + sIdx);

        selectedScenes.push({
          videoUrl: scene.video.videoFiles[0].link,
          position: posSelect ? posSelect.value : (scene.timestamp_hint || 'middle'),
          duration: durSelect ? parseInt(durSelect.value) : 5,
          description: scene.scene_description || ''
        });
      });

      if (selectedScenes.length === 0) {
        showToast('No B-Roll scenes selected. Check at least one scene.');
        return;
      }

      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Generating...';

      // Get clip style from moment card
      var styleSelect = document.getElementById('clip-style-' + momentIndex);
      var clipStyle = styleSelect ? styleSelect.value : 'blur';
      var captionsCheckbox = document.getElementById('captions-' + momentIndex);
      var includeCaptions = captionsCheckbox ? captionsCheckbox.checked : false;

      try {
        var response = await fetch('/shorts/clip-with-broll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisId: analysisId,
            momentIndex: momentIndex,
            includeCaptions: includeCaptions,
            clipStyle: clipStyle,
            brollScenes: selectedScenes
          })
        });

        var data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to start');

        var filename = data.filename;
        btn.textContent = 'Processing...';

        // Poll for readiness (same status endpoint as regular clips)
        var attempts = 0;
        var maxAttempts = 200;
        var pollInterval = setInterval(async function() {
          attempts++;
          try {
            var statusResp = await fetch('/shorts/clip/status/' + filename);
            var statusData = await statusResp.json();

            if (statusData.failed) {
              clearInterval(pollInterval);
              throw new Error(statusData.message || 'Generation failed');
            } else if (statusData.ready) {
              clearInterval(pollInterval);
              btn.textContent = 'Downloading...';
              var link = document.createElement('a');
              link.href = '/shorts/clip/download/' + filename;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              btn.disabled = false;
              btn.textContent = originalText;
              showToast('B-Roll clip downloaded!');
            } else if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              btn.disabled = false;
              btn.textContent = originalText;
              showToast('Timed out. Please try again.');
            } else {
              btn.textContent = statusData.progress || ('Processing' + '.'.repeat((attempts % 3) + 1));
            }
          } catch (e) {
            clearInterval(pollInterval);
            showToast('Error: ' + e.message);
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }, 2000);

      } catch (error) {
        showToast(error.message || 'Failed to generate B-Roll clip');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // === Thumbnail Generation ===
    async function generateThumbnail(analysisId, momentIndex, btn) {
      const originalText = btn.textContent;
      btn.disabled = true;

      const styleSelect = document.getElementById('thumb-style-' + momentIndex);
      const thumbStyle = styleSelect ? styleSelect.value : 'gradient';
      const isAI = thumbStyle === 'ai';
      const isAB = thumbStyle === 'ab';

      btn.textContent = isAB ? 'A/B Generating...' : isAI ? 'AI Generating...' : 'Generating...';

      try {
        // A/B Test mode — generate 3 variants
        if (isAB) {
          const response = await fetch('/shorts/thumbnail-ab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisId, momentIndex })
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.error || 'Failed');

          const batchId = data.batchId;
          const filenames = data.filenames;
          btn.textContent = 'Creating 3 variants...';

          let attempts = 0;
          const poll = setInterval(async () => {
            attempts++;
            try {
              const statusResp = await fetch('/shorts/thumbnail-ab/status/' + batchId);
              const statusData = await statusResp.json();

              btn.textContent = 'Variants: ' + statusData.readyCount + '/3' + '.'.repeat((attempts % 3) + 1);

              if (statusData.allDone || statusData.readyCount === 3) {
                clearInterval(poll);

                const readyVariants = statusData.variants.filter(v => v.ready);
                if (readyVariants.length === 0) throw new Error('All variants failed');

                // Build A/B comparison grid
                const variantLabels = ['Bold & Dramatic', 'Clean & Modern', 'Energetic & Fun'];
                let gridHtml = '<div style="margin-top:12px;background:var(--surface-light);border:1px solid var(--border-subtle);border-radius:12px;padding:16px;" id="thumb-preview-' + momentIndex + '">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
                    '<div style="font-weight:700;font-size:14px;color:var(--text);">A/B Thumbnail Test</div>' +
                    '<div style="background:linear-gradient(135deg,#f39c12,#e67e22);color:#fff;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;">3 VARIANTS</div>' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">';

                for (let i = 0; i < 3; i++) {
                  const v = statusData.variants[i];
                  if (v && v.ready) {
                    gridHtml += '<div style="border:2px solid var(--border-subtle);border-radius:8px;overflow:hidden;cursor:pointer;transition:all 0.2s;" ' +
                      'onmouseover="this.style.borderColor=\\'#6c5ce7\\';this.style.transform=\\'scale(1.02)\\'" ' +
                      'onmouseout="this.style.borderColor=\\'var(--border-subtle)\\';this.style.transform=\\'scale(1)\\'">' +
                        '<img src="/shorts/thumbnail/download/' + v.filename + '" style="width:100%;display:block;" alt="Variant ' + (i+1) + '">' +
                        '<div style="padding:8px;text-align:center;">' +
                          '<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:6px;">' + variantLabels[i] + '</div>' +
                          '<a href="/shorts/thumbnail/download/' + v.filename + '" download="' + v.filename + '" class="btn btn-small" ' +
                            'style="background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;text-decoration:none;font-size:10px;padding:4px 12px;">Download</a>' +
                        '</div>' +
                      '</div>';
                  } else {
                    gridHtml += '<div style="border:2px solid var(--border-subtle);border-radius:8px;padding:40px;text-align:center;">' +
                      '<div style="color:var(--text-muted);font-size:12px;">' + (v && v.failed ? 'Failed' : 'Generating...') + '</div></div>';
                  }
                }

                gridHtml += '</div>' +
                  '<div style="margin-top:10px;display:flex;gap:8px;">' +
                    '<button class="btn btn-small" style="background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;font-size:11px;" ' +
                      'onclick="generateThumbnail(\\'' + analysisId + '\\', ' + momentIndex + ', document.getElementById(\\'thumb-btn-' + momentIndex + '\\'))">Regenerate All</button>' +
                    '<button class="btn btn-small" style="background:rgba(255,255,255,0.1);colorvar(--text-muted);font-size:11px;" ' +
                      'onclick="document.getElementById(\\'thumb-preview-' + momentIndex + '\\').remove()">Close</button>' +
                  '</div>' +
                '</div>';

                const old = document.getElementById('thumb-preview-' + momentIndex);
                if (old) old.remove();
                btn.closest('.moment-card').insertAdjacentHTML('beforeend', gridHtml);
                btn.disabled = false;
                btn.textContent = originalText;
                showToast('A/B Thumbnails ready! Pick your favorite.');
              } else if (attempts >= 120) {
                clearInterval(poll);
                throw new Error('Timed out');
              }
            } catch (pollError) {
              clearInterval(poll);
              showToast('Error: ' + pollError.message);
              btn.disabled = false;
              btn.textContent = originalText;
            }
          }, 3000);

          return;
        }

        // Single thumbnail (regular or AI)
        const endpoint = isAI ? '/shorts/thumbnail-ai' : '/shorts/thumbnail';
        const payload = isAI
          ? { analysisId, momentIndex, aspectRatio: 'landscape' }
          : { analysisId, momentIndex, style: thumbStyle };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        const filename = data.filename;
        btn.textContent = isAI ? 'AI Creating...' : 'Processing...';

        let attempts = 0;
        const maxAttempts = isAI ? 90 : 60;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const statusResp = await fetch('/shorts/thumbnail/status/' + filename);
            const statusData = await statusResp.json();

            if (statusData.failed) {
              clearInterval(poll);
              throw new Error(statusData.message || 'Failed');
            } else if (statusData.ready) {
              clearInterval(poll);

              const aiLabel = isAI ? '<div style="position:absolute;top:20px;right:20px;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;padding:4px 10px;border-radius:12px;font-size:10px;font-weight:700;">AI GENERATED</div>' : '';
              const regenBtn = isAI ? '<button class="btn btn-small" style="background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;font-size:11px;" onclick="generateThumbnail(\\'' + analysisId + '\\', ' + momentIndex + ', document.getElementById(\\'thumb-btn-' + momentIndex + '\\'))">Regenerate</button>' : '';

              const previewHtml = '<div style="margin-top:12px;background:var(--surface-light);border:1px solid var(--border-subtle);border-radius:8px;padding:12px;position:relative;" id="thumb-preview-' + momentIndex + '">' +
                aiLabel +
                '<img src="/shorts/thumbnail/download/' + filename + '" style="width:100%;border-radius:6px;display:block;" alt="Thumbnail">' +
                '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<a href="/shorts/thumbnail/download/' + filename + '" download="' + filename + '" class="btn btn-small" ' +
                    'style="background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;text-decoration:none;font-size:11px;">Download</a>' +
                  regenBtn +
                  '<button class="btn btn-small" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:11px;" ' +
                    'onclick="document.getElementById(\\'' + 'thumb-preview-' + momentIndex + '\\').remove()">Close</button>' +
                '</div>' +
              '</div>';

              const old = document.getElementById('thumb-preview-' + momentIndex);
              if (old) old.remove();
              btn.closest('.moment-card').insertAdjacentHTML('beforeend', previewHtml);
              btn.disabled = false;
              btn.textContent = originalText;
              showToast(isAI ? 'AI Thumbnail generated!' : 'Thumbnail generated!');
            } else if (attempts >= maxAttempts) {
              clearInterval(poll);
              throw new Error('Timed out');
            } else {
              btn.textContent = isAI ? ('AI Creating' + '.'.repeat((attempts % 3) + 1)) : ('Processing' + '.'.repeat((attempts % 3) + 1));
            }
          } catch (pollError) {
            clearInterval(poll);
            showToast('Error: ' + pollError.message);
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }, 2000);

      } catch (error) {
        showToast(error.message || 'Failed to generate thumbnail');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // Caption-style live preview painter. Called by the inline onchange
    // on the per-moment Caption Style select. Defensively guarded so an
    // unknown style key falls back to the Classic look instead of throwing.
    window.__paintCaptionPreview = function(idx, styleKey) {
      try {
        var prev = document.getElementById('caption-preview-' + idx);
        if (!prev) return;
        var P = {
          classic:       { c:'#FFFFFF', o:'#000000', up:true,  b:true  },
          trending:      { c:'#FFFF00', o:'#000000', up:true,  b:true  },
          karaoke:       { c:'#FFFFFF', o:'#FF5000', up:true,  b:true  },
          minimal:       { c:'#FFFFFF', o:'#000000', up:false, b:false },
          bold:          { c:'#00FF00', o:'#000000', up:true,  b:true  },
          neon:          { c:'#FF50FF', o:'#8000FF', up:true,  b:true  },
          'bold-pop':    { c:'#FFBF00', o:'#000000', up:true,  b:true  },
          'gradient-wave':{c:'#B469FF', o:'#CC3299', up:true,  b:true  },
          typewriter:    { c:'#FFFFFF', o:'#000000', up:false, b:false, mono:true },
          cinematic:     { c:'#D4D474', o:'#000000', up:false, b:false },
          street:        { c:'#FFFF00', o:'#000000', up:true,  b:true  },
          hormozi:       { c:'#FFFF00', o:'#000000', up:true,  b:true  },
          mrbeast:       { c:'#FFFFFF', o:'#FF0000', up:true,  b:true  },
          'classic-sub': { c:'#FFFFFF', o:'#000000', up:false, b:false },
          'outline-style':{c:'#000000', o:'#FFFFFF', up:true,  b:true  },
          'soft-glow':   { c:'#FFFFFF', o:'#E0B0FF', up:false, b:false },
          'retro-vhs':   { c:'#FFFF00', o:'#FF0000', up:true,  b:true,  mono:true },
          comic:         { c:'#FFFF00', o:'#000000', up:true,  b:true  },
          fire:          { c:'#FF5500', o:'#FF0000', up:true,  b:true  },
          'clean-modern':{ c:'#FFFFFF', o:'#000000', up:false, b:false },
          podcast:       { c:'#FFFFFF', o:'#000000', up:false, b:false },
          'tiktok-trend':{ c:'#FFFF00', o:'#000000', up:true,  b:true  },
          'shadow-drop': { c:'#FFFFFF', o:'#000000', up:true,  b:true  }
        };
        var p = P[styleKey] || P.classic;
        prev.style.color = p.c;
        prev.style.fontWeight = p.b ? '900' : '500';
        prev.style.textTransform = p.up ? 'uppercase' : 'none';
        prev.style.letterSpacing = p.up ? '0.06em' : '0.02em';
        prev.style.fontFamily = p.mono
          ? '"SF Mono", "JetBrains Mono", Consolas, "Liberation Mono", monospace'
          : '';
        prev.style.textShadow =
          '-1px -1px 0 ' + p.o + ', 1px -1px 0 ' + p.o + ', ' +
          '-1px 1px 0 ' + p.o + ', 1px 1px 0 ' + p.o;
      } catch (_) { /* defensive: never let preview rendering break the page */ }
    };

    // === Brand Kit Functions ===

    // /shorts uses the shared Brand Kit modal in "select" mode: button reads
    // "Select", only one template can be chosen at a time, and that choice
    // persists in localStorage so it can be applied to every viral clip the
    // user generates (when the per-moment Brand Template checkbox is on).
    // /video-editor does NOT set this flag, so its Apply behavior is unchanged.
    window.brandKitModalMode = 'select';
    try {
      window.brandKitSelectedTemplateId = localStorage.getItem('brandKitSelectedTemplateId') || null;
    } catch (_e) { window.brandKitSelectedTemplateId = null; }

    // Hook called by the shared modal when the user clicks Select on a card.
    window.applyBrandTemplateChoice = function(tmpl){
      if (!tmpl || !tmpl.id) return;
      window.brandKitSelectedTemplateId = tmpl.id;
      try { localStorage.setItem('brandKitSelectedTemplateId', tmpl.id); } catch (_e) {}
      try {
        var name = (tmpl.name || (tmpl.captionStyle || 'template'));
        if (typeof showToast === 'function') {
          showToast('Selected "' + name + '" — applied to viral clips when Brand Template is on');
        }
      } catch (_e) {}
      // Re-render the open modal so the picked card shows the SELECTED state
      // immediately. Re-opening would also work but in-place feels snappier.
      try {
        var listEl = document.querySelector('#v10BrandKitModal #bkList');
        if (listEl && typeof window.openBrandKitModal === 'function') {
          window.openBrandKitModal();
        }
      } catch (_e) {}
    };

    function toggleBrandKit(forceShow) {
      if (forceShow === true) { loadBrandKit(); return; } // handled by toggleToolPanel
      const panel = document.getElementById('brandKitPanel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') loadBrandKit();
    }

    async function loadBrandKit() {
      try {
        const resp = await fetch('/shorts/brand-kit');
        const data = await resp.json();
        if (data.success && data.brandKit) {
          const kit = data.brandKit;
          document.getElementById('bk-brandName').value = kit.brand_name || '';
          document.getElementById('bk-watermarkText').value = kit.watermark_text || '';
          document.getElementById('bk-primaryColor').value = kit.primary_color || '#FF0050';
          document.getElementById('bk-primaryColorText').value = kit.primary_color || '#FF0050';
          document.getElementById('bk-secondaryColor').value = kit.secondary_color || '#6c5ce7';
          document.getElementById('bk-secondaryColorText').value = kit.secondary_color || '#6c5ce7';
          document.getElementById('bk-fontStyle').value = kit.font_style || 'modern';
          if (kit.elevenlabs_api_key) document.getElementById('settings-elevenlabsApiKey').value = kit.elevenlabs_api_key;
          updateBrandPreview();
        }
      } catch (e) { console.log('Brand kit load error:', e); }
    }

    async function saveBrandKit() {
      const btn = document.getElementById('bk-saveBtn');
      const status = document.getElementById('bk-status');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const resp = await fetch('/shorts/brand-kit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brandName: document.getElementById('bk-brandName').value,
            watermarkText: document.getElementById('bk-watermarkText').value,
            primaryColor: document.getElementById('bk-primaryColor').value,
            secondaryColor: document.getElementById('bk-secondaryColor').value,
            fontStyle: document.getElementById('bk-fontStyle').value,
          })
        });
        const data = await resp.json();
        if (data.success) {
          status.textContent = 'Saved!';
          status.style.color = '#10b981';
          var wmVal = document.getElementById('bk-watermarkText').value.trim(); showToast(wmVal ? 'Brand Kit saved! Watermark will appear on future clips.' : 'Brand Kit saved!');
          updateBrandPreview();
        } else {
          throw new Error(data.error);
        }
      } catch (e) {
        status.textContent = 'Error saving';
        status.style.color = '#ff6b6b';
        showToast('Error: ' + e.message);
      }
      btn.disabled = false;
      btn.textContent = 'Save Brand Kit';
      setTimeout(() => { status.textContent = ''; }, 3000);
    }

            function toggleSettings(forceShow) {
              if (forceShow === true) { loadSettings(); return; } // handled by toggleToolPanel
              var panel = document.getElementById('settingsPanel');
              panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
              if (panel.style.display === 'block') loadSettings();
            }

            async function loadSettings() {
              try {
                const resp = await fetch('/shorts/brand-kit');
                const data = await resp.json();
                if (data.success && data.brandKit) {
                  if (data.brandKit.elevenlabs_api_key) document.getElementById('settings-elevenlabsApiKey').value = data.brandKit.elevenlabs_api_key;
                }
              } catch (e) { console.log('Settings load error:', e); }
            }

            async function saveSettings() {
              const btn = document.getElementById('settings-saveBtn');
              const status = document.getElementById('settings-status');
              btn.disabled = true;
              btn.textContent = 'Saving...';
              try {
                const resp = await fetch('/shorts/save-settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    elevenlabsApiKey: document.getElementById('settings-elevenlabsApiKey').value
                  })
                });
                const data = await resp.json();
                if (data.success) {
                  status.textContent = 'Saved!';
                  status.style.color = '#10b981';
                  showToast('Settings saved!');
                } else {
                  throw new Error(data.error);
                }
              } catch (e) {
                status.textContent = 'Error saving';
                status.style.color = '#ff6b6b';
                showToast('Error: ' + e.message);
              }
              btn.disabled = false;
              btn.textContent = 'Save Settings';
              setTimeout(() => { status.textContent = ''; }, 3000);
            }

    function updateBrandPreview() {
      const watermark = document.getElementById('bk-watermarkText').value;
      const color = document.getElementById('bk-primaryColor').value;
      const preview = document.getElementById('bk-preview');
      const wmEl = document.getElementById('bk-preview-watermark');
      if (watermark) {
        preview.style.display = 'block';
        wmEl.textContent = watermark;
        wmEl.style.color = color;
      } else {
        preview.style.display = 'none';
      }
    }

    // Sync color picker with text input
    document.getElementById('bk-primaryColor').addEventListener('input', function() {
      document.getElementById('bk-primaryColorText').value = this.value;
      updateBrandPreview();
    });
    document.getElementById('bk-secondaryColor').addEventListener('input', function() {
      document.getElementById('bk-secondaryColorText').value = this.value;
    });

    function buildTranscriptViewer(transcript, moments, videoId) {
      if (!transcript) return '<p style="color:#888;padding:10px;">No transcript available.</p>';

      // Extract keywords from moments for highlighting
      const keywords = new Set();
      (moments || []).forEach(m => {
        (m.keyThemes || []).forEach(t => { if (t.length > 3) keywords.add(t.toLowerCase()); });
      });

      // Parse transcript "[HH:MM:SS] text" format
      const lines = [];
      const regex = /\[(\d{2}:\d{2}:\d{2})\]\s*(.*?)(?=\s*\[\d{2}:\d{2}:\d{2}\]|$)/g;
      let match;
      while ((match = regex.exec(transcript)) !== null) {
        lines.push({ time: match[1], text: (match[2] || '').trim() });
      }

      if (lines.length === 0) return '<p style="color:#888;padding:10px;">Transcript format not recognized.</p>';

      return lines.map(line => {
        let text = line.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // Highlight keywords (simple word boundary match)
        keywords.forEach(kw => {
          const escaped = kw.replace(/[.*+?^$|()]/g, String.fromCharCode(92) + '$&');
          const re = new RegExp('(' + escaped + ')', 'gi');
          text = text.replace(re, '<mark style="background:#6c5ce740;color:#a29bfe;padding:1px 3px;border-radius:2px;">$1</mark>');
        });

        const secs = line.time.split(':').reduce((a,b) => a*60 + parseInt(b), 0);
        const sq = String.fromCharCode(39);
        const ytLink = videoId ? ' onclick="window.open(' + sq + 'https://youtube.com/watch?v=' + videoId + '&t=' + secs + sq + ', ' + sq + '_blank' + sq + ')"' : '';

        return '<div class="transcript-line" style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;"' + ytLink + '>' +
          '<span style="color:#6c5ce7;font-size:12px;font-family:monospace;white-space:nowrap;min-width:65px;">' + line.time + '</span>' +
          '<span style="font-size:13px;line-height:1.5;color:#ccc;">' + text + '</span>' +
        '</div>';
      }).join('');
    }

    function filterTranscript(query) {
      const lines = document.querySelectorAll('.transcript-line');
      const q = query.toLowerCase();
      lines.forEach(line => {
        line.style.display = !q || line.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
    }

    function closeModal() {
      document.getElementById('analysisModal').classList.remove('active');
      // Clear any pending back-snapshot too — we're fully out.
      try { window.__modalPrevHTML = null; } catch (_) {}
    }

    // Soft close: if we snapshotted a previous modal view (e.g. the moments
    // list before the user clicked Generate Content), restore it instead of
    // dismissing the whole modal. Otherwise behave like closeModal().
    function dismissModal() {
      try {
        if (window.__modalPrevHTML) {
          var body = document.getElementById('modalBody');
          if (body) body.innerHTML = window.__modalPrevHTML;
          window.__modalPrevHTML = null;
          return;
        }
      } catch (_) {}
      closeModal();
    }

    // Close modal when clicking the backdrop (outside the content). Use the
    // soft path so backdrop clicks from inside the Generated Content view
    // also pop back to moments first.
    document.getElementById('analysisModal').addEventListener('click', function(e) {
      if (e.target === this) dismissModal();
    });

    async function deleteAnalysis(id, btn) {
      // First check whether any calendar entries are linked to this analysis.
      // If so, show the spec'd "Delete Everywhere" confirmation. Otherwise,
      // fall back to the simple native confirm.
      let cascadeCount = 0;
      try {
        const r = await fetch('/shorts/api/' + id + '/calendar-links');
        if (r.ok) {
          const d = await r.json();
          cascadeCount = d.count || 0;
        }
      } catch (e) { /* ignore — fall through to native confirm */ }

      const proceed = await new Promise((resolve) => {
        if (cascadeCount > 0) {
          showCascadeDeleteModal(cascadeCount, resolve);
        } else {
          resolve(window.confirm('Delete this analysis? This cannot be undone.'));
        }
      });
      if (!proceed) return;

      try {
        const url = '/shorts/api/' + id + (cascadeCount > 0 ? '?cascade=1' : '');
        const resp = await fetch(url, { method: 'DELETE' });
        const data = await resp.json();
        if (data.success) {
          // Remove the card from the DOM
          const card = btn.closest('.card');
          if (card) {
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => card.remove(), 300);
          }
          if (data.cascadedCount > 0) {
            showToast('Deleted analysis + ' + data.cascadedCount + ' scheduled post' + (data.cascadedCount === 1 ? '' : 's'));
          } else {
            showToast('Analysis deleted');
          }
        } else {
          showToast(data.error || 'Failed to delete');
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    }

    function showCascadeDeleteModal(count, onChoice){
      // Lazy-create the modal once
      let m = document.getElementById('cascadeDeleteModal');
      if (!m) {
        m = document.createElement('div');
        m.id = 'cascadeDeleteModal';
        m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:99999;align-items:center;justify-content:center;padding:20px';
        m.innerHTML =
          '<div style="background:var(--surface);border:1px solid rgba(239,68,68,0.40);border-radius:14px;width:100%;max-width:460px;padding:24px;box-shadow:0 0 0 1px rgba(239,68,68,0.20),0 18px 60px rgba(239,68,68,0.18)">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
              '<span style="font-size:1.4rem">⚠️</span>' +
              '<h3 id="cascadeHeadline" style="margin:0;font-size:1.05rem;font-weight:800;color:var(--text)">Delete scheduled content?</h3>' +
            '</div>' +
            '<p id="cascadeBody" style="color:var(--text-muted);font-size:0.88rem;line-height:1.5;margin:0 0 20px">This clip is currently scheduled in your Calendar. Deleting it will also remove the scheduled post. Are you sure you want to proceed?</p>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px">' +
              '<button id="cascadeCancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer">Cancel</button>' +
              '<button id="cascadeConfirm" style="background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:700;font-size:0.85rem;cursor:pointer;box-shadow:0 4px 14px rgba(239,68,68,0.30)">Delete Everywhere</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', (e) => { if (e.target === m) closeCascade(false); });
      }
      // Adjust copy if multiple entries
      const body = m.querySelector('#cascadeBody');
      if (count > 1) {
        body.textContent = 'This clip has ' + count + ' scheduled posts in your Calendar. Deleting it will also remove those scheduled posts. Are you sure you want to proceed?';
      } else {
        body.textContent = 'This clip is currently scheduled in your Calendar. Deleting it will also remove the scheduled post. Are you sure you want to proceed?';
      }
      m.style.display = 'flex';

      function closeCascade(result) {
        m.style.display = 'none';
        document.removeEventListener('keydown', onKey);
        onChoice(result);
      }
      function onKey(e){ if (e.key === 'Escape') closeCascade(false); }
      m.querySelector('#cascadeCancel').onclick = () => closeCascade(false);
      m.querySelector('#cascadeConfirm').onclick = () => closeCascade(true);
      document.addEventListener('keydown', onKey);
    }

    function showToast(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { dismissModal(); closeNarrationModal(); }
    });

    // === Narration Feature ===
    var narrationState = {
      analysisId: null,
      momentIndex: null,
      style: 'funny',
      voiceEnabled: true,
      provider: 'openai',
      elevenlabsVoiceId: null,
      audioMix: 'mix',
      clipFilename: null
    };

    function openNarrationModal(analysisId, momentIndex) {
      narrationState.analysisId = analysisId;
      narrationState.momentIndex = momentIndex;
      // Try to find the most recent clip filename for this moment
      var clipBtn = document.getElementById('clip-btn-' + momentIndex);
      if (clipBtn && clipBtn.dataset.lastFilename) {
        narrationState.clipFilename = clipBtn.dataset.lastFilename;
      }
      document.getElementById('narrationModal').style.display = 'flex';
      // Select first style by default
      document.querySelectorAll('.narr-style-btn').forEach(function(btn, i) {
        btn.style.borderColor = i === 0 ? '#00b894' : 'transparent';
      });
    }

    function closeNarrationModal() {
      document.getElementById('narrationModal').style.display = 'none';
    }

    // Style selection
    document.querySelectorAll('.narr-style-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        narrationState.style = this.dataset.style;
        document.querySelectorAll('.narr-style-btn').forEach(function(b) { b.style.borderColor = 'transparent'; });
        this.style.borderColor = '#00b894';
      });
    });

    function setVoiceType(type) {
      narrationState.voiceEnabled = type === 'ai';
      document.getElementById('voice-type-ai').style.borderColor = type === 'ai' ? '#00b894' : 'transparent';
      document.getElementById('voice-type-ai').style.background = type === 'ai' ? 'rgba(0,184,148,0.1)' : 'var(--surface-light)';
      document.getElementById('voice-type-text').style.borderColor = type === 'text' ? '#00b894' : 'transparent';
      document.getElementById('voice-type-text').style.background = type === 'text' ? 'rgba(0,184,148,0.1)' : 'var(--surface-light)';
      document.getElementById('voice-options').style.display = type === 'ai' ? 'block' : 'none';
      document.getElementById('audio-mix-options').style.display = type === 'ai' ? 'block' : 'none';
    }

    function setProvider(provider) {
      narrationState.provider = provider;
      document.getElementById('provider-openai').style.borderColor = provider === 'openai' ? '#6c5ce7' : 'transparent';
      document.getElementById('provider-openai').style.background = provider === 'openai' ? 'rgba(108,92,231,0.1)' : 'var(--surface-light)';
      document.getElementById('provider-elevenlabs').style.borderColor = provider === 'elevenlabs' ? '#6c5ce7' : 'transparent';
      document.getElementById('provider-elevenlabs').style.background = provider === 'elevenlabs' ? 'rgba(108,92,231,0.1)' : 'var(--surface-light)';
      document.getElementById('elevenlabs-voice-picker').style.display = provider === 'elevenlabs' ? 'block' : 'none';
      if (provider === 'elevenlabs') loadElevenLabsVoices();
    }

    function setMixType(type) {
      narrationState.audioMix = type;
      document.getElementById('mix-type-mix').style.borderColor = type === 'mix' ? '#00b894' : 'transparent';
      document.getElementById('mix-type-mix').style.background = type === 'mix' ? 'rgba(0,184,148,0.1)' : 'var(--surface-light)';
      document.getElementById('mix-type-replace').style.borderColor = type === 'replace' ? '#00b894' : 'transparent';
      document.getElementById('mix-type-replace').style.background = type === 'replace' ? 'rgba(0,184,148,0.1)' : 'var(--surface-light)';
    }

    async function loadElevenLabsVoices() {
      var select = document.getElementById('elevenlabs-voice-select');
      select.innerHTML = '<option value="">Loading voices...</option>';
      try {
        var resp = await fetch('/shorts/elevenlabs-voices');
        var data = await resp.json();
        if (data.voices && data.voices.length > 0) {
          select.innerHTML = data.voices.map(function(v) {
            return '<option value="' + v.voice_id + '">' + v.name + ' (' + v.category + ')</option>';
          }).join('');
          narrationState.elevenlabsVoiceId = data.voices[0].voice_id;
          select.onchange = function() { narrationState.elevenlabsVoiceId = this.value; };
        } else {
          select.innerHTML = '<option value="">No voices found — add ElevenLabs API key in Settings</option>';
        }
      } catch (err) {
        select.innerHTML = '<option value="">Error loading voices</option>';
      }
    }

    async function generateNarration() {
      var btn = document.getElementById('narrate-generate-btn');
      var progress = document.getElementById('narration-progress');

      // First check if we need to generate the clip first
      if (!narrationState.clipFilename) {
        // Generate clip first
        progress.style.display = 'block';
        progress.textContent = 'Generating clip first...';
        btn.disabled = true;
        btn.textContent = 'Generating clip...';

        try {
          var clipStyle = 'blur';
          var styleSelect = document.getElementById('clip-style-' + narrationState.momentIndex);
          if (styleSelect) clipStyle = styleSelect.value;
          var captionsCheck = document.getElementById('captions-' + narrationState.momentIndex);
          var includeCaptions = captionsCheck ? captionsCheck.checked : true;

          var genResp = await fetch('/shorts/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              analysisId: narrationState.analysisId,
              momentIndex: narrationState.momentIndex,
              includeCaptions: includeCaptions,
              clipStyle: clipStyle
            })
          });
          var genData = await genResp.json();
          if (!genData.success) throw new Error(genData.error || 'Failed to generate clip');

          narrationState.clipFilename = genData.filename;
          // Poll for clip to be ready
          for (var i = 0; i < 150; i++) {
            await new Promise(function(r) { setTimeout(r, 2000); });
            var statusResp = await fetch('/shorts/clip/status/' + genData.filename);
            var statusData = await statusResp.json();
            if (statusData.failed) throw new Error(statusData.message);
            if (statusData.ready) break;
            progress.textContent = 'Generating clip: ' + (statusData.message || 'Processing...');
          }
        } catch (err) {
          progress.textContent = 'Error: ' + err.message;
          btn.disabled = false;
          btn.innerHTML = '<img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Narration';
          return;
        }
      }

      // Now generate narration
      btn.disabled = true;
      btn.textContent = 'Generating narration...';
      progress.style.display = 'block';
      progress.textContent = 'Writing narration script...';

      try {
        var body = {
          analysisId: narrationState.analysisId,
          momentIndex: narrationState.momentIndex,
          narrationStyle: narrationState.style,
          voiceEnabled: narrationState.voiceEnabled,
          audioMix: narrationState.audioMix,
          clipFilename: narrationState.clipFilename,
          ttsProvider: narrationState.provider,
          elevenlabsVoiceId: narrationState.elevenlabsVoiceId
        };

        var resp = await fetch('/shorts/narrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = await resp.json();
        if (!data.success) { if (data.needsRegeneration) { narrationState.clipFilename = null; progress.textContent = 'Clip expired, regenerating...'; return generateNarration(); } throw new Error(data.error || 'Narration failed'); }

        var filename = data.filename;
        // Poll for narration to be ready
        for (var attempts = 0; attempts < 150; attempts++) {
          await new Promise(function(r) { setTimeout(r, 2000); });
          var sResp = await fetch('/shorts/narrate/status/' + filename);
          var sData = await sResp.json();
          if (sData.failed) throw new Error(sData.message || 'Narration failed');
          if (sData.ready) {
            if (sData.textOnly) {
              // Display narration script in the modal
              progress.innerHTML = '';
              var scriptBox = document.createElement('div');
              scriptBox.style.cssText = 'background:var(--card-bg,#f8f9fa);border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:16px;margin-top:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;max-height:200px;overflow-y:auto;';
              scriptBox.textContent = sData.script;
              var copyBtn = document.createElement('button');
              copyBtn.textContent = '\ud83d\udccb Copy Script';
              copyBtn.style.cssText = 'margin-top:8px;padding:8px 16px;background:var(--accent,#6c5ce7);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;';
              copyBtn.onclick = function() { navigator.clipboard.writeText(sData.script).then(function() { showToast('Narration script copied to clipboard!'); }); };
              progress.appendChild(scriptBox);
              progress.appendChild(copyBtn);
              showToast('Narration script generated!');
            } else {
              // Download narrated clip
              progress.textContent = 'Downloading narrated clip...';
              var link = document.createElement('a');
              link.href = '/shorts/narrate/download/' + filename;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              showToast('Narrated clip downloaded!');
              closeNarrationModal();
            }
            break;
          }
          progress.textContent = sData.message || 'Processing...';
        }
      } catch (err) {
        progress.textContent = 'Error: ' + err.message;
        showToast('Narration failed: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Narration';
      }
    }

    // === Quick Narrate ===
    async function loadQNElevenLabsVoices() {
      var sel = document.getElementById('qn-el-voices');
      sel.innerHTML = '<option value="">Loading...</option>';
      try {
        var resp = await fetch('/shorts/elevenlabs-voices');
        var data = await resp.json();
        if (data.voices && data.voices.length > 0) {
          sel.innerHTML = data.voices.map(function(v) { return '<option value="' + v.voice_id + '">' + v.name + '</option>'; }).join('');
        } else {
          sel.innerHTML = '<option value="">No voices found — add ElevenLabs API key in Settings</option>';
        }
      } catch(e) { sel.innerHTML = '<option value="">Error</option>'; }
    }

    function downloadQuickNarrateScript() { var script = document.getElementById('qn-customScript').value; if (!script) { showToast('No script to download. Write or generate a script first.'); return; } var blob = new Blob([script], {type: 'text/plain'}); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'narration-script.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href); showToast('Script downloaded!'); } async function quickNarrate() {
      var btn = document.getElementById('qn-btn');
      var status = document.getElementById('qn-status');
      var url = document.getElementById('qn-videoUrl').value.trim();
      if (!url) { showToast('Please enter a video URL', true); return; }

      btn.disabled = true; btn.textContent = 'Processing...';
      status.textContent = 'Starting...';

      try {
        var body = {
          videoUrl: url,
          narrationStyle: document.getElementById('qn-style').value,
          voiceEnabled: true,
          audioMix: document.getElementById('qn-mix').value,
          ttsProvider: document.getElementById('qn-provider').value,
          elevenlabsVoiceId: document.getElementById('qn-el-voices').value || null,
          customScript: document.getElementById('qn-customScript').value.trim() || null
        };

        var resp = await fetch('/shorts/quick-narrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        // Poll for completion
        for (var i = 0; i < 240; i++) {
          await new Promise(function(r) { setTimeout(r, 2000); });
          var sResp = await fetch('/shorts/narrate/status/' + data.filename);
          var sData = await sResp.json();
          if (sData.failed) throw new Error(sData.message || 'Failed');
          if (sData.ready) {
              status.textContent = 'Downloading...';
              var link = document.createElement('a');
              link.href = '/shorts/narrate/download/' + data.filename;
              link.download = data.filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              showToast('Narrated video downloaded!');
              status.textContent = 'Done!';
              if (sData.narrationScript) {
                var sc = document.getElementById('qn-script-output');
                if (!sc) {
                  sc = document.createElement('div');
                  sc.id = 'qn-script-output';
                  sc.style.cssText = 'margin-top:16px;';
                  var hdr = document.createElement('div');
                  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
                  var lbl = document.createElement('span');
                  lbl.style.cssText = 'font-weight:600;color:var(--text-primary,#fff);font-size:14px;';
                  lbl.textContent = 'Narration Script';
                  var cpBtn = document.createElement('button');
                  cpBtn.textContent = 'Copy Script';
                  cpBtn.style.cssText = 'background:var(--accent-color,#6C3AED);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;';
                  cpBtn.onclick = function() { navigator.clipboard.writeText(document.getElementById('qn-script-text').textContent).then(function(){ showToast('Script copied to clipboard!'); }); };
                  hdr.appendChild(lbl);
                  hdr.appendChild(cpBtn);
                  sc.appendChild(hdr);
                  var txt = document.createElement('div');
                  txt.id = 'qn-script-text';
                  txt.style.cssText = 'background:var(--card-bg,#1a1a1a);border:1px solid var(--border-color,#333);border-radius:8px;padding:14px;font-size:14px;line-height:1.6;white-space:pre-wrap;color:var(--text-primary,#fff);max-height:200px;overflow-y:auto;';
                  sc.appendChild(txt);
                  document.getElementById('quickNarratePanel').appendChild(sc);
                }
                document.getElementById('qn-script-text').textContent = sData.narrationScript;
                sc.style.display = 'block';
              }
              break;
          }
          status.textContent = sData.message || 'Processing...';
        }
      } catch (err) {
        showToast('Quick narrate failed: ' + err.message, true);
        status.textContent = 'Error: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<img src="/images/section-icons/A-78.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Generate Narrated Video';
      }
    }

    ${getThemeScript()}
  </script>
</body>
</html>`;
}

module.exports = router;
