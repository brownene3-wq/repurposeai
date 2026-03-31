const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const OpenAI = require('openai');
const archiver = require('archiver');
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
const { shortsOps, brandKitOps, calendarOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  try {
    writeProgress('Downloading video...');
    await runDl(ytdlpPath, [
      '--no-playlist',
      '-f', 'bestvideo[height<=1920]+bestaudio/best[height<=1920]/best',
      '--merge-output-format', 'mkv',
      '-o', cachedVideoPath,
      '--no-warnings',
      '--no-check-certificates',
      '--no-part',
      '--force-overwrites',
      '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr',
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
    try { fs.unlinkSync(lockPath); } catch (e) {}
    try { fs.unlinkSync(cachedVideoPath); } catch (e) {}
    throw err;
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
    neon: { fontName:'Liberation Sans', fontSize:80, primaryColor:'&H00FF50FF', outlineColor:'&H00FF0080', backColor:'&H00000000', bold:-1, outline:4, shadow:4, alignment:2, marginV:190, wordsPerLine:4, uppercase:true }
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

  const baseArgs = ['--skip-download', '--no-warnings', '--no-check-certificates', '-o', outTemplate, videoUrl];

  // Use extractor-args to try different YouTube player clients for better compatibility
  const extraArgs = ['--extractor-args', 'youtube:player_client=web_creator,ios,android_vr'];

  // Strategy 1: English auto-generated + manual subs in json3 (wildcard for en variants)
  console.log('  Trying: English json3 subtitles (wildcard)');
  let subFile = await tryYtdlpSubtitles(videoId, [
    '--skip-download', '--no-warnings', '--no-check-certificates',
    ...extraArgs,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);

  // Strategy 2: English subs in vtt format (wildcard)
  if (!subFile) {
    console.log('  Trying: English vtt subtitles (wildcard)');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', '--no-warnings', '--no-check-certificates',
      ...extraArgs,
      '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 3: Any language auto-generated subs (all languages)
  if (!subFile) {
    console.log('  Trying: Any language auto-generated subtitles');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', '--no-warnings', '--no-check-certificates',
      ...extraArgs,
      '--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 4: Any manual subs at all
  if (!subFile) {
    console.log('  Trying: Any manual subtitles');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', '--no-warnings', '--no-check-certificates',
      ...extraArgs,
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
      '--skip-download', '--dump-json', '--no-warnings', '--no-check-certificates', '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr',
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
      '--skip-download', '--print', 'title', '--no-warnings', '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr',
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

    const html = renderShortsPage(req.user, analyses, page, hasMore);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error loading Smart Shorts page:', error);
    res.status(500).json({ error: 'Failed to load Smart Shorts' });
  }
});

// POST /analyze - Analyze YouTube video
router.post('/analyze', requireAuth, async (req, res) => {
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

// DELETE /api/:id - Delete analysis
router.delete('/api/:id', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await shortsOps.delete(req.params.id);
    res.json({ success: true });
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
            '--no-warnings', '--no-check-certificates', '--no-part', '--force-overwrites',
            '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr',
            '--download-sections', `*${frameSec}-${frameSec + 5}`,
            videoUrl
          ], { timeout: 120000 });
        } catch (dlErr) {
          // download-sections might not be supported, download full and seek
          try {
            await runCmd(ytdlpPath, [
              '--no-playlist', '-f', 'bestvideo[height<=1920]/best[height<=1920]/best',
              '--merge-output-format', 'mkv', '-o', tempVideo,
              '--no-warnings', '--no-check-certificates', '--no-part', '--force-overwrites',
              '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr',
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

    const { analysisId, momentIndex, includeCaptions, clipStyle, captionLanguage, captionStyle } = req.body;

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

    // Fetch user's brand kit for watermark
    let brandKit = null;
    try {
      brandKit = await brandKitOps.getByUserId(req.user.id);
    } catch (e) { console.log('Brand kit fetch skipped:', e.message); }

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
    const filename = `${safeTitle}_${analysisTag}_${Date.now()}.mp4`;
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
          console.error('  Video download failed:', dlErr.message);
          writeError('Video download failed. Please try again.');
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
        const ffmpegArgs = [
          '-y',
          '-ss', String(startSec),
          '-i', actualDownload,
          ...(isPip ? ['-ss', String(startSec), '-i', actualDownload] : []),
          '-t', String(duration),
          ...(videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter]),
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
            '-ss', String(startSec),
            '-t', String(duration),
            ...(videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter]),
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

        const systemPrompt = `You are a creative narration writer for short-form video content. Write engaging, authentic voiceover scripts that match the specified style.`;
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

    const videoId = extractVideoId(videoUrl);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

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
      const timeout = setTimeout(() => writeError('Timed out after 8 minutes'), 480000);
      try {
        // Step 1: Download video
        writeProgress('Downloading video...');
        const downloadPath = outputPath + '.download.mkv';
        await runCommand('yt-dlp', [
          '--no-playlist', '-f', 'bestvideo[height<=1920]+bestaudio/best[height<=1920]/best',
          '--merge-output-format', 'mkv', '-o', downloadPath, '--no-warnings', '--no-check-certificates',
          '--no-part', '--force-overwrites', '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr', videoUrl
        ], { timeout: 240000 });

        // Step 2: Get transcript for context (optional, best-effort)
        let transcriptText = '';
        try {
          const titleProc = require('child_process').execSync(
            'yt-dlp --get-title --no-warnings --extractor-args youtube:player_client=web_creator,ios,android_vr "' + videoUrl.replace(/"/g, '') + '"', { encoding: 'utf8', timeout: 15000 }
          ).trim();
          transcriptText = titleProc || 'Short video';
        } catch(e) { transcriptText = 'Short video'; }

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
          const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a creative narration writer for short-form video content.' },
              { role: 'user', content: (stylePrompts[narrationStyle] || stylePrompts.funny) + '\\nVideo title/context: ' + transcriptText }
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
          if (audioMix === 'replace') {
            await runCommand(ffmpegPath, [
              '-i', downloadPath, '-i', audioPath,
              '-map', '0:v', '-map', '1:a',
              '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', tempOut
            ], { timeout: 120000 });
          } else {
            await runCommand(ffmpegPath, [
              '-i', downloadPath, '-i', audioPath, '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
              '-filter_complex', '[0:a]volume=0.3[orig];[1:a]volume=1.0[narr];[orig][narr]amix=inputs=2:duration=longest',
              '-c:a', 'aac', '-shortest', '-y', tempOut
            ], { timeout: 120000 });
          }
        } else {
          // Text-only narration overlay
          const escaped = narrationScript.replace(/'/g, "'\\''").replace(/:/g, '\\:');
          await runCommand(ffmpegPath, [
            '-i', downloadPath,
            '-vf', "drawtext=text='" + escaped.substring(0, 200) + "':fontsize=36:fontcolor=white:bordercolor=black:borderw=2:x=(w-text_w)/2:y=h-80",
            '-c:a', 'copy', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-y', tempOut
          ], { timeout: 120000 });
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
            '--no-warnings', '--no-check-certificates', '--no-part', '--force-overwrites',
            '--extractor-args', 'youtube:player_client=web_creator,ios,android_vr',
            videoUrl
          ], { timeout: 240000 });
        } catch (e) {
          clearTimeout(timeout);
          writeError('Video download failed.');
          return;
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
function renderShortsPage(user, analyses, currentPage = 1, hasMore = false) {
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
    }

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
    }

    .modal-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .modal-close {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0,0,0,0.6);
      border: 2px solid rgba(255,255,255,0.3);
      color: #fff;
      font-size: 28px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1002;
      transition: background 0.2s;
    }
    .modal-close:hover {
      background: rgba(255,0,0,0.6);
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
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .moment-card:hover {
      border-color: var(--primary);
      background: rgba(108, 58, 237, 0.05);
    }

    .moment-card.selected {
      border-color: var(--primary-light);
      background: rgba(108, 58, 237, 0.15);
    }

    .moment-card-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 8px;
    }

    .moment-card-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--text);
    }

    .moment-score {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--gradient-1);
      font-weight: 700;
      font-size: 12px;
      color: #fff;
    }

    .moment-card-time {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .moment-card-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
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
        width: 36px;
        height: 36px;
        font-size: 22px;
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
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
</head>
<body class="dashboard">
  ${getThemeToggle()}
  ${getSidebar('shorts', req.user)}

  <!-- Main content -->
  <main class="main-content">
      <div class="header">
        <h1 class="header-title">Smart Shorts</h1>
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

      <!-- Quick Narrate Tool -->
      <div style="margin-bottom: 16px;">
        <button class="btn" onclick="document.getElementById('quickNarratePanel').style.display = document.getElementById('quickNarratePanel').style.display === 'none' ? 'block' : 'none';"
          style="background: rgba(0,184,148,0.12); color: #00b894; border: 1px solid rgba(0,184,148,0.3); font-size: 13px; padding: 8px 16px;">
          🎙️ Quick Narrate a Video
        </button>
        <div id="quickNarratePanel" style="display:none; margin-top:12px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <h3 style="font-size:16px; font-weight:600;">🎙️ Quick Narrate</h3>
              <p style="color:#888; font-size:12px; margin-top:2px;">Paste any YouTube video URL and add AI narration over it — perfect for narration-style content</p>
            </div>
            <button class="btn btn-small" onclick="document.getElementById('quickNarratePanel').style.display='none'" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times;</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <input type="url" id="qn-videoUrl" name="quick_narrate_url" autocomplete="off" placeholder="https://youtube.com/watch?v=... or YouTube Shorts URL"
              style="flex:1;padding:10px 12px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:14px;">
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            <select id="qn-style" style="padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
              <option value="funny">😂 Funny</option>
              <option value="documentary">🎬 Documentary</option>
              <option value="dramatic">🎭 Dramatic</option>
              <option value="hype">🔥 Hype</option>
              <option value="sarcastic">😏 Sarcastic</option>
              <option value="storytime">📖 Storytime</option>
              <option value="news">📺 News</option>
              <option value="poetic">✨ Poetic</option>
            </select>
            <select id="qn-mix" style="padding:8px 10px;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:12px;">
              <option value="mix">🔀 Mix Audio (30% original)</option>
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
              🎙️ Generate Narrated Video
            </button>
            <button class="btn" onclick="downloadQuickNarrateScript()" style="background:transparent;border:1px solid var(--text-muted);color:var(--text-muted);padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;">📄 Download Script</button> <span id="qn-status" style="font-size:13px;color:var(--text-muted);"></span>
          </div>
        </div>
      </div>

      <!-- Workflow Templates -->
      <div style="margin-bottom: 16px;">
        <button class="btn" onclick="toggleWorkflows()" id="workflowToggle"
          style="background: rgba(243,156,18,0.12); color: #f39c12; border: 1px solid rgba(243,156,18,0.3); font-size: 13px; padding: 8px 16px;">
          Workflow Templates
        </button>
        <div id="workflowPanel" style="display:none; margin-top:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <p style="color:#888;font-size:13px;">Select a workflow to auto-configure clip settings</p>
            <button class="btn btn-small" onclick="toggleWorkflows()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-tiktok')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x266C;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to TikTok</div>
              <div style="font-size:12px;color:var(--text-muted);">Blur background, auto-captions, TikTok-optimized content with trending hashtags</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">Blur BG</span>
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">Captions ON</span>
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">TikTok + IG</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-shorts')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x25B6;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to YT Shorts</div>
              <div style="font-size:12px;color:var(--text-muted);">Center crop for full-frame, captions, Shorts-optimized with SEO description</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Center Crop</span>
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Captions ON</span>
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Shorts Only</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-linkedin')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x1F4BC;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to LinkedIn</div>
              <div style="font-size:12px;color:var(--text-muted);">Fit style with clean background, professional content + blog post</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">Fit Style</span>
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">No Captions</span>
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">LinkedIn + Blog</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-all')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x1F30D;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to Everything</div>
              <div style="font-size:12px;color:var(--text-muted);">Maximum reach: blur BG clip, captions, content for all 8 platforms, thumbnail</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">Blur BG</span>
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">All Platforms</span>
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">+ Thumbnail</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('podcast')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F399; &#x2192; &#x1F4F1;</div>
              <div style="font-weight:600;margin-bottom:4px;">Podcast to Clips</div>
              <div style="font-size:12px;color:var(--text-muted);">PiP style for talking heads, bold captions, Twitter thread + newsletter</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(243,156,18,0.2);color:#f39c12;padding:2px 6px;border-radius:4px;">PiP Style</span>
                <span style="font-size:10px;background:rgba(243,156,18,0.2);color:#f39c12;padding:2px 6px;border-radius:4px;">Thread + Newsletter</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('education')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F393; &#x2192; &#x1F4DD;</div>
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
        <button class="btn" onclick="toggleBatchInput()" id="batchToggle"
          style="background: rgba(255,0,80,0.12); color: #FF0050; border: 1px solid rgba(255,0,80,0.3); font-size: 13px; padding: 8px 16px;">
          Batch Analyze (Multiple Videos)
        </button>
        <div id="batchPanel" style="display:none; margin-top:12px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
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
        <button class="btn" onclick="toggleBrandKit()" id="brandKitToggle"
          style="background: rgba(108,92,231,0.15); color: #a29bfe; border: 1px solid rgba(108,92,231,0.3); font-size: 13px; padding: 8px 16px;">
          Brand Kit Settings
        </button>
            <button class="btn" onclick="toggleSettings()" id="settingsToggle"
              style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 13px; padding: 8px 16px; margin-left: 8px;">
              ⚙️ Settings
            </button>
        <div id="brandKitPanel" style="display:none; margin-top:12px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
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
            <div id="settingsPanel" style="display:none; margin-top:12px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-size:16px; font-weight:600;">⚙️ Settings</h3>
                <button class="btn btn-small" onclick="toggleSettings()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
              </div>
              <p style="color:#888; font-size:13px; margin-bottom:20px;">Configure your API keys and integrations.</p>
              <div style="max-width:500px;">
                <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">🎙️ ElevenLabs API Key <span style="color:#888;font-weight:400;">(optional — for premium AI voices in narration)</span></label>
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
            <div class="empty-state-icon">&#x2702;&#xFE0F;</div>
            <h3 class="empty-state-title">No analyses yet</h3>
            <p class="empty-state-text">Paste a YouTube URL above to get started</p>
          </div>
        ` : `
          <div class="cards-grid">
            ${analyses.map(analysis => {
              // Extract video ID for thumbnail
              const ytRegex = new RegExp('(?:youtube\\.com/watch\\\\?v=|youtu\\.be/|youtube\\.com/embed/)([a-zA-Z0-9_-]{11})');
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
    <button id="calendarFloatBtn" onclick="document.getElementById('calendarModal').style.display='flex';" style="position:fixed;bottom:90px;right:30px;z-index:9990;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:50px;padding:14px 22px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(108,58,237,0.4);display:flex;align-items:center;gap:8px;transition:transform 0.2s;">
      <span style="font-size:18px;">&#128197;</span> Calendar
    </button>

    <!-- Calendar Modal -->
    <div id="calendarModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9995;align-items:center;justify-content:center;" onclick="if(event.target===this)this.style.display='none';">
      <div style="background:#1a1a2e;border-radius:16px;padding:28px;max-width:900px;width:95%;max-height:90vh;overflow-y:auto;margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h2 style="font-size:22px;font-weight:700;">Content Calendar</h2>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-small" onclick="changeCalendarMonth(-1)" style="background:rgba(255,255,255,0.08);">&larr;</button>
            <span id="calendarMonthLabel" style="font-size:14px;font-weight:600;min-width:140px;text-align:center;"></span>
            <button class="btn btn-small" onclick="changeCalendarMonth(1)" style="background:rgba(255,255,255,0.08);">&rarr;</button>
            <button class="btn btn-small" onclick="openAddEntry()" style="background:rgba(108,92,231,0.2);color:#a29bfe;border:1px solid rgba(108,92,231,0.3);">+ Add Entry</button>
            <button onclick="document.getElementById('calendarModal').style.display='none';" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:4px 8px;">&times;</button>
          </div>
        </div>
        <div id="calendarGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:rgba(255,255,255,0.05);border-radius:8px;overflow:hidden;"></div>
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
      <button class="modal-close" onclick="closeModal()" title="Close">&times;</button>
      <div id="modalBody"></div>
    </div>
  </div>

  <!-- Narration Modal -->
  <div id="narrationModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(4px);">
    <div style="background:var(--surface);border-radius:16px;padding:28px;max-width:520px;width:90%;margin:auto;position:relative;max-height:90vh;overflow-y:auto;">
      <button onclick="closeNarrationModal()" style="position:absolute;top:12px;right:16px;background:none;border:none;color:var(--text-muted);font-size:24px;cursor:pointer;">&times;</button>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:4px;">🎙️ AI Narration</h2>
      <p style="font-size:13px;color:var(--text-dim);margin-bottom:20px;">Add a voiceover or text narration to your clip</p>

      <div style="margin-bottom:16px;">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Narration Style</label>
        <div id="narration-styles" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
          <button class="narr-style-btn" data-style="funny" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">😂<br>Funny</button>
          <button class="narr-style-btn" data-style="documentary" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">🎬<br>Documentary</button>
          <button class="narr-style-btn" data-style="dramatic" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">🎭<br>Dramatic</button>
          <button class="narr-style-btn" data-style="hype" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">🔥<br>Hype</button>
          <button class="narr-style-btn" data-style="sarcastic" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">😏<br>Sarcastic</button>
          <button class="narr-style-btn" data-style="storytime" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">📖<br>Storytime</button>
          <button class="narr-style-btn" data-style="news" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">📺<br>News</button>
          <button class="narr-style-btn" data-style="poetic" style="padding:10px 6px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;text-align:center;transition:all .2s;">✨<br>Poetic</button>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Voice Type</label>
        <div style="display:flex;gap:8px;">
          <button id="voice-type-ai" class="voice-type-btn active" onclick="setVoiceType('ai')" style="flex:1;padding:10px;border-radius:10px;border:2px solid #00b894;background:rgba(0,184,148,0.1);color:var(--text);font-size:12px;cursor:pointer;font-weight:600;">🔊 AI Voice</button>
          <button id="voice-type-text" class="voice-type-btn" onclick="setVoiceType('text')" style="flex:1;padding:10px;border-radius:10px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:12px;cursor:pointer;font-weight:600;">📝 Text Only</button>
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
          <button id="mix-type-mix" class="mix-type-btn active" onclick="setMixType('mix')" style="flex:1;padding:8px;border-radius:8px;border:2px solid #00b894;background:rgba(0,184,148,0.1);color:var(--text);font-size:11px;cursor:pointer;">🔀 Mix (30% original)</button>
          <button id="mix-type-replace" class="mix-type-btn" onclick="setMixType('replace')" style="flex:1;padding:8px;border-radius:8px;border:2px solid transparent;background:var(--surface-light);color:var(--text);font-size:11px;cursor:pointer;">🔇 Replace Audio</button>
        </div>
      </div>

      <p style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">⚠️ Click Generate to create a narrated version of this clip. The clip will be processed automatically.</p>

      <button id="narrate-generate-btn" onclick="generateNarration()" style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#00b894 0%,#00cec9 100%);color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;">
        🎙️ Generate Narration
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

    async function analyzeVideo() {
      const url = document.getElementById('videoUrl').value.trim();
      if (!url) {
        showToast('Please enter a YouTube URL');
        return;
      }

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
            <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
              <p style="color: #888; flex:1;">\${analysis.moments?.length || 0} viral moments found</p>
              <button class="btn btn-small" style="background:rgba(108,92,231,0.2);color:#a29bfe;font-size:12px;"
                onclick="document.getElementById('transcriptPanel').style.display = document.getElementById('transcriptPanel').style.display === 'none' ? 'block' : 'none'">
                View Transcript
              </button>
              <button class="btn btn-small" style="background:rgba(16,185,129,0.2);color:#10b981;font-size:12px;"
                onclick="exportAllClips('\${id}')">
                Export All (ZIP)
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

          // Build clickable thumbnail preview (iframes fail when embedding is disabled)
          const videoEmbed = videoId ? \`
            <a href="https://youtube.com/watch?v=\${videoId}&t=\${startSec}" target="_blank" style="display:block; position:relative; text-decoration:none; height:120px; overflow:hidden; border-radius:8px; margin-bottom:12px; background:#000;">
              <img src="https://img.youtube.com/vi/\${videoId}/mqdefault.jpg" alt="Video thumbnail"
                style="width:100%; height:120px; object-fit:cover; display:block;" loading="lazy" />
              <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
                width:44px; height:44px; background:rgba(0,0,0,0.7); border-radius:50%;
                display:flex; align-items:center; justify-content:center;">
                <div style="width:0; height:0; border-left:16px solid #fff; border-top:10px solid transparent;
                  border-bottom:10px solid transparent; margin-left:3px;"></div>
              </div>
              <div style="position:absolute; bottom:6px; left:6px; background:rgba(0,0,0,0.8);
                padding:2px 6px; border-radius:4px; color:#fff; font-size:11px;">
                \${moment.timeRange}
              </div>
            </a>
          \` : '';

          card.innerHTML = \`
            <div class="moment-card-header">
              <div style="flex: 1;">
                <div class="moment-card-title">\${moment.title}</div>
                <div class="moment-card-time">\${moment.timeRange} (\${endSec - startSec}s clip)</div>
              </div>
              <div class="moment-score" style="cursor:pointer;" onclick="event.stopPropagation();showViralityBreakdown('\${id}', \${idx})" title="Click for virality breakdown">\${moment.viralityScore}%</div>
            </div>
            \${videoEmbed}
            <div class="moment-card-desc">\${moment.description}</div>
            <div style="margin-top:8px;">
              <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
                <div style="height:100%;width:\${moment.viralityScore}%;background:linear-gradient(90deg,\${moment.viralityScore >= 80 ? '#10b981' : moment.viralityScore >= 60 ? '#f39c12' : '#ff6b6b'},\${moment.viralityScore >= 80 ? '#00b894' : moment.viralityScore >= 60 ? '#e67e22' : '#ff4757'});border-radius:2px;transition:width 0.5s;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span style="font-size:10px;color:\${moment.viralityScore >= 80 ? '#10b981' : moment.viralityScore >= 60 ? '#f39c12' : '#ff6b6b'};">\${moment.viralityScore >= 80 ? 'High Viral Potential' : moment.viralityScore >= 60 ? 'Good Potential' : 'Moderate Potential'}</span>
                <span style="font-size:10px;color:var(--text-muted);">\${(moment.keyThemes || []).slice(0,3).join(', ')}</span>
              </div>
            </div>
            <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-small btn-primary" onclick="generateContent('\${id}', '\${moment.timeRange}')">
                Generate Content
              </button>
              <button class="btn btn-small" id="clip-btn-\${idx}"
                style="background: linear-gradient(135deg, #FF0050 0%, #FF4500 100%); color: #fff;"
                onclick="downloadClip('\${id}', \${idx}, this)">
                Download Clip
              </button>
              <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; color:var(--text-muted);"
                title="Burn animated captions into the clip">
                <input type="checkbox" id="captions-\${idx}" checked
                  style="accent-color:#FF0050; width:14px; height:14px;">
                <span>Captions</span>
                <select id="caption-style-\${idx}" style="font-size:11px; padding:4px 6px; background:var(--surface-light); color:var(--text);
                  border:1px solid var(--border-subtle); border-radius:4px; cursor:pointer;" title="Caption style">
                  <option value="classic">Classic</option>
                  <option value="trending">Trending</option>
                  <option value="karaoke">Word Pop</option>
                  <option value="minimal">Minimal</option>
                  <option value="bold">Bold</option>
                  <option value="neon">Neon Glow</option>
                </select>
              </label>
              <select id="caption-lang-\${idx}" style="font-size:11px; padding:4px 6px; background:var(--surface-light); color:var(--text);
                border:1px solid var(--border-subtle); border-radius:4px; cursor:pointer;" title="Caption language">
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
              <select id="clip-style-\${idx}" style="font-size:11px; padding:4px 6px; background:var(--surface-light); color:var(--text);
                border:1px solid var(--border-subtle); border-radius:4px; cursor:pointer;" title="Clip style">
                <option value="blur">Blur BG</option>
                <option value="crop">Center Crop</option>
                <option value="fit">Fit (Black BG)</option>
                <option value="pip">Picture-in-Picture</option>
              </select>
              <select id="thumb-style-\${idx}" style="font-size:11px; padding:4px 6px; background:var(--surface-light); color:var(--text);
                border:1px solid var(--border-subtle); border-radius:4px; cursor:pointer;" title="Thumbnail style">
                <option value="gradient">Gradient</option>
                <option value="dark">Dark Overlay</option>
                <option value="border">Color Border</option>
                <option value="split">Split Design</option>
                <option value="ai">AI Generated</option>
                <option value="ab">A/B Test (3 AI)</option>
              </select>
              <button class="btn btn-small" id="thumb-btn-\${idx}"
                style="background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%); color: #fff; font-size: 11px;"
                onclick="generateThumbnail('\${id}', \${idx}, this)">
                Thumbnail
              </button>
              <button class="btn btn-small" id="broll-btn-\${idx}"
                style="background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: #fff; font-size: 11px;"
                onclick="findBRoll('\${id}', \${idx}, this)">
                🎬 Auto B-Roll
              </button>
              <button class="btn btn-small" id="narrate-btn-\${idx}"
                style="background: linear-gradient(135deg, #00b894 0%, #00cec9 100%); color: #fff; font-size: 11px;"
                onclick="openNarrationModal('\${id}', \${idx})">
                🎙️ Narrate
              </button>
              \${videoId ? \`<a href="https://youtube.com/watch?v=\${videoId}&t=\${startSec}" target="_blank"
                class="btn btn-small" style="background: rgba(255,255,255,0.1); color: var(--text-muted); text-decoration: none;">
                Open on YouTube
              </a>\` : ''}
            </div>
          \`;
          card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'IFRAME') {
              card.classList.toggle('selected');
            }
          };
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
        // Request clip generation
        const response = await fetch('/shorts/clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, momentIndex, includeCaptions, clipStyle, captionLanguage, captionStyle })
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

    function toggleWorkflows() {
      const panel = document.getElementById('workflowPanel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function applyWorkflow(workflowId) {
      activeWorkflow = workflows[workflowId];
      if (!activeWorkflow) return;

      showToast('Workflow "' + activeWorkflow.name + '" active! Analyze a video to use it.');
      document.getElementById('workflowPanel').style.display = 'none';

      // Show active workflow badge
      const toggle = document.getElementById('workflowToggle');
      toggle.innerHTML = 'Workflow: <strong>' + activeWorkflow.name + '</strong> <span style="font-size:10px;cursor:pointer;" onclick="event.stopPropagation();clearWorkflow();">&times;</span>';
      toggle.style.background = 'rgba(243,156,18,0.3)';
    }

    function clearWorkflow() {
      activeWorkflow = null;
      const toggle = document.getElementById('workflowToggle');
      toggle.textContent = 'Workflow Templates';
      toggle.style.background = 'rgba(243,156,18,0.12)';
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

      // Day headers
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
        html += '<div style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;background:rgba(255,255,255,0.03);">' + d + '</div>';
      });

      // Empty cells before first day
      for (let i = 0; i < firstDay; i++) {
        html += '<div style="padding:8px;min-height:80px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.03);"></div>';
      }

      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

      // Day cells
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
        const isToday = dateStr === todayStr;
        const dayEntries = calendarEntries.filter(e => {
          const ed = (e.scheduled_date || '').substring(0,10);
          return ed === dateStr;
        });

        html += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + '" onclick="openAddEntry(' + "'" + dateStr + "'" + ')">' +
          '<div class="cal-day">' + day + '</div>';

        dayEntries.forEach(entry => {
          const sc = statusColors[entry.status] || '#6c5ce7';
          html += '<div class="cal-entry" style="background:' + sc + '22;border-left:2px solid ' + sc +
            ';" onclick="event.stopPropagation();editCalendarEntry(' + "'" + entry.id + "'" + ')" title="Click to edit or delete: ' + (entry.title || '').replace(/"/g,'&amp;quot;') + '">' +
            (platformEmojis[entry.platform] || '') + ' ' + (entry.title || '').substring(0,15) +
            '<span style="position:absolute;right:2px;top:50%;transform:translateY(-50%);font-size:8px;opacity:0.5;">&#9998;</span>' +
          '</div>';
        });

        html += '</div>';
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
    function toggleBatchInput() {
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
              '<span style="font-size:18px;">🎬</span>' +
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
                '🎬 Download Clip with B-Roll' +
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

    // === Brand Kit Functions ===
    function toggleBrandKit() {
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

            function toggleSettings() {
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
    }

    // Close modal when clicking the backdrop (outside the content)
    document.getElementById('analysisModal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    async function deleteAnalysis(id, btn) {
      if (!confirm('Delete this analysis? This cannot be undone.')) return;
      try {
        const resp = await fetch('/shorts/api/' + id, { method: 'DELETE' });
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
          showToast('Analysis deleted');
        } else {
          showToast(data.error || 'Failed to delete');
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    }

    function showToast(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModal(); closeNarrationModal(); }
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
          select.innerHTML = '<option value="">No voices found — add ElevenLabs API key in Brand Kit</option>';
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
          btn.textContent = '🎙️ Generate Narration';
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
        btn.textContent = '🎙️ Generate Narration';
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
          sel.innerHTML = '<option value="">No voices — add API key in Brand Kit</option>';
        }
      } catch(e) { sel.innerHTML = '<option value="">Error</option>'; }
    }

    function downloadQuickNarrateScript() { var script = document.getElementById('qn-customScript').value; if (!script) { showToast('No script to download. Write or generate a script first.'); return; } var blob = new Blob([script], {type: 'text/plain'}); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'narration-script.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href); showToast('Script downloaded!'); } async function quickNarrate() {
      var btn = document.getElementById('qn-btn');
      var status = document.getElementById('qn-status');
      var url = document.getElementById('qn-videoUrl').value.trim();
      if (!url) { showToast('Please enter a YouTube URL', true); return; }

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
        btn.textContent = '🎙️ Generate Narrated Video';
      }
    }

    ${getThemeScript()}
  </script>
</body>
</html>`;
}

module.exports = router;
