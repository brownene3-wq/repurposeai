const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
let __ytdl = null;
try { __ytdl = require('@distube/ytdl-core'); } catch (e) { console.warn('[ai-broll] ytdl-core not available:', e.message); }
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { requireCredits, costFor } = require('../middleware/credits');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// Boot guard — see shorts.js explanation
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key' });

// FFmpeg setup
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) ffmpegPath = localFfmpeg;
if (!ffmpegPath) {
  try { ffmpegPath = require('ffmpeg-static'); } catch (e) {}
}
if (!ffmpegPath) {
  try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {}
}

// Directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/webm'];
    cb(allowedMimes.includes(file.mimetype) ? null : new Error('Invalid file type'), allowedMimes.includes(file.mimetype));
  }
});


// ═══ Smart B-Roll context extraction (transcript-driven) ═══
function runFFmpegBroll(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg unavailable'));
    const p = spawn(ffmpegPath, args);
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + ': ' + err.slice(0, 400))));
    p.on('error', reject);
  });
}

async function extractFirstNSecondsAudio(srcPath, seconds, destPath) {
  await runFFmpegBroll([
    '-i', srcPath,
    '-vn', '-acodec', 'mp3', '-ar', '16000', '-ac', '1',
    '-t', String(seconds),
    '-y', destPath
  ]);
}

async function transcribeAudioFile(audioPath) {
  if (!process.env.OPENAI_API_KEY) return '';
  try {
    const r = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'text'
    });
    return (typeof r === 'string' ? r : (r && r.text) || '').trim();
  } catch (err) {
    console.error('[ai-broll] Whisper failed:', err.message);
    return '';
  }
}

// Railway-compatible yt-dlp args (mirrors ai-hook.js / ai-captions.js / shorts.js).
// Without bgutil-pot + js-runtimes + a real UA, YouTube returns empty captions.
const BROLL_YTDLP_ARGS = [
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

function ensureYtdlp() {
  let ytdlpBin = 'yt-dlp';
  try { execSync('which yt-dlp', { stdio: 'pipe' }); return ytdlpBin; }
  catch (_) {
    try { execSync('pip install --break-system-packages yt-dlp', { stdio: 'pipe' }); return ytdlpBin; }
    catch (_) {
      try { execSync('pip install yt-dlp', { stdio: 'pipe' }); return ytdlpBin; }
      catch (_) { return null; }
    }
  }
}

function getYoutubeProxyArgs() {
  const p = process.env.YT_PROXY_URL;
  if (p) return ['--proxy', p];
  return [];
}

function extractYoutubeVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/v\/|youtube-nocookie\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

// Run yt-dlp with given args and a 20s timeout, return whichever subtitle file
// landed in tmpDir (vtt/json3/srt) or null.
function tryYtdlpSubsBroll(videoId, args, tmpDir) {
  return new Promise((resolve) => {
    const ytdlpBin = ensureYtdlp();
    if (!ytdlpBin) return resolve(null);
    let stderrTail = '';
    const proc = spawn(ytdlpBin, args);
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-400); });
    proc.on('close', (code) => {
      try {
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId) && /\.(vtt|json3|srt)$/.test(f));
        if (files.length > 0) resolve(path.join(tmpDir, files[0]));
        else { if (code !== 0) console.warn('[ai-broll] yt-dlp exit ' + code + ', stderr: ' + stderrTail); resolve(null); }
      } catch (_) { resolve(null); }
    });
    proc.on('error', (err) => { console.warn('[ai-broll] yt-dlp spawn error: ' + err.message); resolve(null); });
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve(null); }, 20000);
  });
}

// Parse a VTT/JSON3/SRT subtitle file into plain text. Mirrors ai-hook.js.
function parseSubsToTextBroll(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let lines = [];
    if (filePath.endsWith('.json3')) {
      const json = JSON.parse(content);
      const events = json.events || [];
      for (const ev of events) {
        if (ev.segs) {
          const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
          if (text) lines.push(text);
        }
      }
    } else {
      const raw = content.split('\n');
      for (const line of raw) {
        if (!line.trim()) continue;
        if (line.includes('-->')) continue;
        if (/^\d+$/.test(line.trim())) continue;
        if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
        const clean = line.replace(/<[^>]*>/g, '').trim();
        if (clean) lines.push(clean);
      }
    }
    const deduped = [];
    for (const l of lines) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== l) deduped.push(l);
    }
    return deduped.join(' ').replace(/\s+/g, ' ').trim();
  } finally {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

// Fetch title (via --dump-single-json) AND transcript (via 4-strategy subtitle
// fallback chain). Hard 30s wall-clock cap so we never block the request long.
async function fetchYoutubeMeta(url) {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return { title: '', description: '', transcript: '' };
  const ytdlpBin = ensureYtdlp();
  if (!ytdlpBin) return { title: '', description: '', transcript: '' };

  const tmpDir = path.join('/tmp', 'ai-broll-subs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outTemplate = path.join(tmpDir, videoId);
  // Clean previous artifacts
  try {
    fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId)).forEach(f => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {}
    });
  } catch (_) {}

  const videoUrl = 'https://www.youtube.com/watch?v=' + videoId;

  // Title + description via dump-single-json (5s budget)
  let title = '', description = '';
  await new Promise((resolve) => {
    let buf = '';
    const p = spawn(ytdlpBin, [
      '--skip-download', '--dump-single-json',
      ...BROLL_YTDLP_ARGS,
      ...getYoutubeProxyArgs(),
      videoUrl
    ]);
    p.stdout.on('data', d => { buf += d.toString(); });
    p.on('close', () => {
      try {
        const meta = JSON.parse(buf);
        title = meta.title || '';
        description = (meta.description || '').slice(0, 1500);
      } catch (_) {}
      resolve();
    });
    p.on('error', () => resolve());
    setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} resolve(); }, 8000);
  });

  // 4-strategy subtitle fallback chain (mirrors ai-hook.js)
  let subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS, ...getYoutubeProxyArgs(),
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
    '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);
  if (!subFile) subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS, ...getYoutubeProxyArgs(),
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
    '--sub-format', 'vtt',
    '-o', outTemplate, videoUrl
  ], tmpDir);
  if (!subFile) subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS, ...getYoutubeProxyArgs(),
    '--write-auto-subs', '--sub-langs', 'all',
    '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);
  if (!subFile) subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS, ...getYoutubeProxyArgs(),
    '--write-subs', '--sub-langs', 'all',
    '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);

  let transcript = '';
  if (subFile) {
    transcript = parseSubsToTextBroll(subFile).slice(0, 4000);
  }
  if (!transcript && description) transcript = description;

  return { title, description, transcript };
}

// Resolve a "file already on disk" reference (from new ingestion flow) to an absolute path.
function resolveStagedFile(filename) {
  if (!filename) return null;
  const safe = String(filename).replace(/[^\w.\-]/g, '_').slice(0, 200);
  const candidates = [
    path.join(uploadDir, safe),
    path.join(uploadDir, filename),
    path.join(outputDir, filename)
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

async function buildBrollContext({ filePath, youtubeUrl, originalName }) {
  // Returns { title, transcript } fed into the smart prompt.
  if (youtubeUrl) {
    try {
      const meta = await fetchYoutubeMeta(youtubeUrl);
      const transcript = meta.transcript || meta.description || '';
      return {
        title: meta.title || originalName || '',
        transcript,
        source: 'youtube'
      };
    } catch (_) {
      return { title: originalName || '', transcript: '', source: 'youtube' };
    }
  }
  if (filePath && fs.existsSync(filePath)) {
    const tmpAudio = path.join('/tmp', 'broll-ctx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp3');
    try {
      await extractFirstNSecondsAudio(filePath, 90, tmpAudio);
      if (fs.existsSync(tmpAudio) && fs.statSync(tmpAudio).size > 1000) {
        const transcript = await transcribeAudioFile(tmpAudio);
        return { title: originalName || path.basename(filePath), transcript, source: 'whisper' };
      }
    } catch (err) {
      console.error('[ai-broll] context extract failed:', err.message);
    } finally {
      try { fs.unlinkSync(tmpAudio); } catch (_) {}
    }
    return { title: originalName || path.basename(filePath), transcript: '', source: 'whisper-failed' };
  }
  return { title: originalName || '', transcript: '', source: 'none' };
}

// Build smart Pixabay queries from {title, transcript} via GPT-4o-mini.
// Mirrors Smart Shorts' prompt rules (concrete nouns, no abstract terms).
async function generateSmartBrollQueries({ title, transcript }) {
  if (!process.env.OPENAI_API_KEY) return [];
  const text = (transcript || '').slice(0, 3000);
  const SYSTEM_PROMPT = [
    'You are a professional video editor selecting B-roll for an existing video.',
    'Given the video TITLE and a partial TRANSCRIPT (first ~90 seconds), suggest exactly 5',
    'specific B-roll scenes that would visually enhance the content.',
    '',
    'For EACH scene return:',
    '- "moment": short label of which part of the video this fits (e.g. "intro", "discussing X", "call to action")',
    '- "scene_description": what the viewer should see (1 short sentence)',
    '- "search_query": the BEST 2-4 word Pixabay search query to find this exact footage. Be VERY specific',
    '   \u2014 use concrete nouns and actions, NOT abstract concepts. For example: "person typing laptop"',
    '   not "productivity", "cash register payment" not "business", "doctor stethoscope" not "health".',
    '   Pixabay works best with literal visual descriptions.',
    '- "duration": integer seconds (3-8 typical)',
    '',
    'IMPORTANT RULES:',
    '- Pick visuals that DIRECTLY relate to topics actually discussed in the transcript.',
    '- Use CONCRETE, LITERAL search terms \u2014 describe what the camera would see.',
    '- AVOID abstract / generic terms like "success", "motivation", "growth", "business", "innovation", "technology" alone.',
    '- Prefer close-up and medium shots over wide/aerial.',
    '- Think about what a human video editor would actually cut to.',
    '- If the transcript is empty or too generic, infer from the title but stay literal.',
    '',
    'Return ONLY a JSON array with the 5 scenes. No prose.'
  ].join('\n');

  const USER = 'TITLE: ' + (title || '(unknown)') + '\n\nTRANSCRIPT (first 90s):\n' + (text || '(transcript not available)');
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER }
      ],
      temperature: 0.6,
      max_tokens: 700
    });
    const out = completion.choices[0].message.content || '';
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter(x => x && x.search_query) : [];
  } catch (err) {
    console.error('[ai-broll] smart-queries GPT failed:', err.message);
    return [];
  }
}

// GET - Render AI B-Roll page
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('AI B-Roll Generator');
  const sidebar = getSidebar('ai-broll', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const pageStyles = `
    <style>
      ${css}
      .broll-container {
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
        width: 100%;
        box-sizing: border-box;
      }
      .input-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
      }
      .form-group {
        margin-bottom: 1.5rem;
      }
      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: var(--text);
        font-size: 0.95rem;
      }
      .form-group input, .form-group select {
        width: 100%;
        padding: 0.75rem;
        background: var(--dark-2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        font-family: inherit;
        font-size: 0.9rem;
        transition: border-color 0.3s;
      }
      .form-group input:focus, .form-group select:focus {
        outline: none;
        border-color: var(--primary);
      }
      .upload-zone {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
        border: 2px dashed var(--primary);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        margin-bottom: 1.5rem;
      }
      .upload-zone.dragover {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.2), rgba(236, 72, 153, 0.2));
        border-color: var(--primary-light);
      }
      .upload-zone h3 {
        margin-bottom: 0.5rem;
        color: var(--text);
      }
      .upload-zone p {
        color: var(--text-muted);
        font-size: 0.9rem;
        margin-bottom: 1rem;
      }
      .upload-button {
        padding: 0.6rem 1.2rem;
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s;
      }
      .upload-button:hover {
        box-shadow: 0 8px 24px rgba(108, 58, 237, 0.3);
        transform: translateY(-2px);
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
      }
      .tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .tab-btn {
        padding: 1rem 1.5rem;
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-weight: 600;
        border-bottom: 2px solid transparent;
        transition: all 0.3s;
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      .tab-content {
        display: none;
      }
      .tab-content.active {
        display: block;
      }
      .btn-generate {
        background: var(--gradient-1);
        color: #fff;
        padding: 0.9rem 2rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 20px rgba(108, 58, 237, 0.4);
        width: 100%;
      }
      .btn-generate:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .btn-generate:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      .broll-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 1rem;
        margin-top: 1.5rem;
      }
      .broll-item {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.3s;
        cursor: pointer;
      }
      .broll-item:hover {
        border-color: var(--primary);
        transform: scale(1.05);
        box-shadow: 0 4px 15px rgba(108, 58, 237, 0.2);
      }
      .broll-thumbnail {
        width: 100%;
        height: 100px;
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
      }
      .broll-info {
        padding: 0.75rem;
        font-size: 0.8rem;
        color: var(--text-muted);
      }
      .broll-name {
        color: var(--text);
        font-weight: 600;
        margin-bottom: 0.25rem;
      }
      .results-section {
        margin-top: 2rem;
      }
      .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        color: var(--text-muted);
      }
      .progress-bar {
        width: 100%;
        height: 6px;
        background: var(--dark-2);
        border-radius: 3px;
        overflow: hidden;
        margin-top: 1rem;
        display: none;
      }
      .progress-bar.active {
        display: block;
      }
      .progress-fill {
        height: 100%;
        background: var(--gradient-1);
        width: 0%;
        transition: width 0.3s ease;
      }
      .loading-spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @media (max-width: 768px) {
        .form-row {
          grid-template-columns: 1fr;
        }
        .input-section {
          padding: 1.5rem;
        }
        .tabs {
          flex-wrap: wrap;
        }
      }
    </style>
  `;

  const html = `${headHTML}
<style>${css}</style>
${pageStyles}
<style>
  .video-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 1000;
    align-items: center;
    justify-content: center;
  }
  .video-modal.active {
    display: flex;
  }
  .video-modal-content {
    background: var(--surface);
    border-radius: 16px;
    padding: 2rem;
    max-width: 700px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
  }
  .video-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  .video-modal-header h3 {
    color: var(--text);
    margin: 0;
  }
  .video-modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--text-muted);
    cursor: pointer;
  }
  .video-modal-close:hover {
    color: var(--text);
  }
  .video-player {
    width: 100%;
    border-radius: 12px;
    margin-bottom: 1.5rem;
    background: #000;
  }
  .video-details {
    margin-bottom: 1.5rem;
  }
  .video-details p {
    color: var(--text-muted);
    margin: 0.5rem 0;
    font-size: 0.9rem;
  }
  .video-details strong {
    color: var(--text);
  }
  .video-modal-actions {
    display: flex;
    gap: 1rem;
  }
  .btn-use-clip {
    flex: 1;
    background: var(--gradient-1);
    color: #fff;
    padding: 0.9rem 2rem;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
  }
  .btn-use-clip:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
  }
  .btn-cancel {
    flex: 1;
    background: var(--dark-2);
    color: var(--text);
    padding: 0.9rem 2rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
  }
  .btn-cancel:hover {
    border-color: var(--text-muted);
  }
  .broll-thumbnail {
    position: relative;
    width: 100%;
    height: 100px;
    background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    background-size: cover;
    background-position: center;
  }
  .broll-item.selected {
    border-color: var(--primary);
    box-shadow: 0 8px 24px rgba(108, 58, 237, 0.3);
  }
  .play-button {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 50px;
    height: 50px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    opacity: 0;
    transition: all 0.3s;
  }
  .broll-item:hover .play-button {
    opacity: 1;
  }
  .duration-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .api-warning {
    background: rgba(236, 72, 153, 0.1);
    border-left: 4px solid rgba(236, 72, 153, 0.5);
    padding: 1rem;
    border-radius: 8px;
    margin-top: 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
</style>
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    ${themeToggle}
    <main class="main-content">
      <div class="page-header">
        <h1><img src="/images/section-icons/A-7.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">AI B-Roll</h1>
        <p>Automatically add relevant B-roll to enhance your videos</p>
      </div>

      <!-- Hero Visual Section -->
      <div style="background:linear-gradient(135deg,rgba(6,182,212,0.15),rgba(139,92,246,0.1));border-radius:20px;padding:2.5rem;margin-bottom:2rem;position:relative;overflow:hidden;border:1px solid rgba(6,182,212,0.2)">
        <div style="display:flex;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap">
          <div style="background:linear-gradient(135deg,#06B6D4,#8B5CF6);border-radius:16px;padding:2rem 2.5rem;position:relative;min-width:200px;text-align:center">
            <img src="/images/section-icons/A-54.png" alt="" style="height:64px;width:64px;border-radius:12px;margin-bottom:0.5rem">
            <div style="font-size:1rem;color:rgba(255,255,255,0.8)">Your Video</div>
          </div>
          <div style="font-size:2rem;color:var(--text-muted)">→</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:linear-gradient(135deg,#F59E0B,#F97316);border-radius:12px;padding:1.2rem;text-align:center"><img src="/images/section-icons/A-55.png" alt="" style="height:40px;width:40px;border-radius:8px"></div>
            <div style="background:linear-gradient(135deg,#8B5CF6,#A78BFA);border-radius:12px;padding:1.2rem;text-align:center"><img src="/images/section-icons/A-56.png" alt="" style="height:40px;width:40px;border-radius:8px"></div>
            <div style="background:linear-gradient(135deg,#10B981,#34D399);border-radius:12px;padding:1.2rem;text-align:center"><img src="/images/section-icons/A-57.png" alt="" style="height:40px;width:40px;border-radius:8px"></div>
            <div style="background:linear-gradient(135deg,#EC4899,#F472B6);border-radius:12px;padding:1.2rem;text-align:center"><img src="/images/section-icons/A-58.png" alt="" style="height:40px;width:40px;border-radius:8px"></div>
          </div>
        </div>
      </div>

      <!-- Quick Import Bar (mirrors /ai-hook layout: input mode selector + active panel) -->
      <div id="quickImportBar" class="input-section broll-container">
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:1.25rem">
          <button type="button" id="modeUrlBtn" onclick="setBrollInputMode('youtube')" style="padding:10px 20px;background:var(--primary);color:#fff;border:1px solid var(--primary);border-radius:10px;cursor:pointer;font-weight:600;font-size:0.8rem;transition:all 0.2s"><img src="/images/section-icons/A-73.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> URL Input</button>
          <button type="button" id="modeUploadBtn" onclick="setBrollInputMode('upload')" style="padding:10px 20px;background:var(--dark-2);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-weight:600;font-size:0.8rem;transition:all 0.2s"><img src="/images/section-icons/A-74.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Upload</button>
          <button type="button" id="modeTextBtn" onclick="setBrollInputMode('text')" style="padding:10px 20px;background:var(--dark-2);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-weight:600;font-size:0.8rem;transition:all 0.2s"><img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Text/Transcript</button>
        </div>

        <!-- URL Input panel (default visible) -->
        <div id="qibUrlPanel" style="display:block">
          <div style="display:flex;gap:8px;width:100%;max-width:600px;margin:0 auto">
            <div style="position:relative;flex:1">
              <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><img src="/images/section-icons/A-73.png" alt="" style="height:16px;width:16px"></span>
              <input type="text" id="heroLinkInput" placeholder="Paste a YouTube, Zoom, Twitch, or Rumble link" style="width:100%;padding:12px 12px 12px 36px;background:var(--dark-2);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:0.95rem">
            </div>
<button type="button" id="heroImportBtn" style="display:none">Import</button>
          </div>
        </div>

        <!-- Upload panel -->
        <div id="qibUploadPanel" style="display:none">
          <div class="upload-zone" id="uploadContainer" ondrop="handleBrollDrop(event)" ondragover="handleBrollDragOver(event)" ondragleave="handleBrollDragLeave(event)">
            <h3><img src="/images/section-icons/A-59.png" alt="" style="height:24px;width:24px;border-radius:5px;vertical-align:middle;margin-right:4px"> Drop your video here</h3>
            <p>Or click to browse</p>
            <button type="button" class="upload-button" onclick="document.getElementById('primaryFileInput').click()">Select Video</button>
            <p id="fileName" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;"></p>
          </div>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:1rem">
            <button type="button" id="gdrivePrimaryBtn" style="padding:10px 20px;background:linear-gradient(135deg,#4285F4,#34A853);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem"><img src="/images/section-icons/A-75.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Google Drive</button>
            <button type="button" id="dropboxPrimaryBtn" style="padding:10px 20px;background:linear-gradient(135deg,#0061FF,#0041B3);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem"><img src="/images/section-icons/A-76.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Dropbox</button>
          </div>
          <p style="text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:0.8rem;margin-bottom:0">You can upload videos up to 120 minutes long.</p>
          <input type="file" id="primaryFileInput" accept="video/*" style="display:none">
          <button type="button" id="uploadPrimaryBtn" style="display:none"></button>
        </div>

        <!-- Text/Transcript panel -->
        <div id="qibTextPanel" style="display:none">
          <div class="form-group" style="margin-bottom:0;max-width:800px;margin-left:auto;margin-right:auto">
            <label for="brollTranscript" style="display:block;margin-bottom:0.5rem;font-weight:600;color:var(--text);font-size:0.95rem">Paste a transcript or describe your video</label>
            <textarea id="brollTranscript" rows="5" placeholder="e.g. This video is about preparing carbonara pasta from scratch — cracking eggs, chopping pancetta, boiling spaghetti, plating with pepper." style="width:100%;padding:0.75rem;background:var(--dark-2);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem">Use this if you don’t want to upload anything — we’ll find B-roll that matches the topics in your text.</p>
          </div>
        </div>
      </div>

            <!-- Primary video status + B-roll selections + Create Project -->
      <div id="projectStagingCard" style="background:var(--surface);border-radius:16px;padding:1.2rem 1.5rem;margin-bottom:2rem;border:1px solid var(--border-subtle);display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div id="primaryStatusText" style="color:var(--text);font-size:0.95rem"></div>
          <button type="button" id="createProjectBtn" style="padding:10px 22px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.95rem" disabled><img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Open in Video Editor</button>
        </div>
        <div id="selectedBrollList" style="margin-top:0.8rem;display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>




      <div class="input-section broll-container">
        <form id="brollForm">
          <div class="tabs">
            <button type="button" class="tab-btn active" data-tab="ai-generated" onclick="switchTab('ai-generated', event)">AI Generated B-Roll</button>
            <button type="button" class="tab-btn" data-tab="stock" onclick="switchTab('stock', event)">Stock B-Roll (Copyright Free)</button>
          </div>

          <div class="tab-content active" id="ai-generated">
            <div class="form-group">
              <label for="aiPrompt">Theme hint (optional)</label>
              <input type="text" id="aiPrompt" placeholder="e.g., 'nature scenes, flowing water, mountains'">
            </div>
          </div>

          <div class="tab-content" id="stock">
            <div class="form-group">
              <label for="searchTerms">Search terms</label>
              <input type="text" id="searchTerms" placeholder="e.g., 'office, technology, business'">
            </div>
          </div>

          <button type="submit" class="btn-generate" id="generateBrollBtn">Analyze and Generate B-Roll</button>
          <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"></div></div>
        </form>
      </div>

      <div class="results-section">
        <div id="brollResultsContainer">
          <div class="empty-state">
            <p>Paste a YouTube link, upload a video, or describe the topic — then click "Add B-Roll in 1 Click". A selection modal will open with the AI\'s B-Roll suggestions.</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <!-- Video Preview Modal -->
  <div class="video-modal" id="videoModal">
    <div class="video-modal-content">
      <div class="video-modal-header">
        <h3 id="modalTitle">Video Preview</h3>
        <button class="video-modal-close" onclick="closeVideoModal()">&times;</button>
      </div>
      <video class="video-player" id="modalVideo" controls></video>
      <div class="video-details" id="videoDetails"></div>
      <div class="video-modal-actions">
        <button class="btn-use-clip" onclick="useSelectedClip()">Use This Clip</button>
        <button class="btn-cancel" onclick="closeVideoModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Credit Confirmation Modal — shown before /ai-broll/generate runs -->
  <div class="video-modal" id="creditConfirmModal" style="display:none">
    <div class="video-modal-content" style="max-width:520px">
      <div class="video-modal-header">
        <h3 style="margin:0">Heads up — this will use credits</h3>
        <button class="video-modal-close" onclick="closeCreditConfirmModal()">&times;</button>
      </div>
      <div style="padding:0 4px 8px 4px;color:var(--text);font-size:0.95rem;line-height:1.5">
        <p style="margin:0 0 1rem 0">
          Generating B-roll runs a transcript analysis (Whisper + GPT) and queries the stock library.
          This will deduct <strong id="creditCostNum" style="color:var(--text)">2</strong>
          <span id="creditCostUnit">credits</span> from your monthly allowance.
        </p>
        <div style="background:var(--dark-2);border:var(--border-subtle);border-radius:10px;padding:1rem;margin:1rem 0">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-muted);margin-bottom:6px">
            <span>This action</span>
            <span id="creditCostBig" style="color:var(--text);font-weight:600">2 credits</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-muted);margin-bottom:6px">
            <span>Used this month</span>
            <span id="creditUsedTxt" style="color:var(--text)">—</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-muted);margin-bottom:8px">
            <span>Remaining after</span>
            <span id="creditRemainAfter" style="color:var(--text);font-weight:600">—</span>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
            <div id="creditProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#6C3AED,#EC4899);transition:width 0.3s"></div>
          </div>
        </div>
        <p id="creditWarningRow" style="margin:0;font-size:0.8rem;color:var(--text-muted)">Charge happens only after the job completes successfully — if anything errors, nothing is deducted.</p>
      </div>
      <div class="video-modal-actions" style="margin-top:1rem">
        <button type="button" class="btn-cancel" onclick="closeCreditConfirmModal()">Cancel</button>
        <button type="button" class="btn-use-clip" id="creditConfirmBtn" onclick="confirmAndProceed()">Yes, use credits & generate</button>
      </div>
    </div>
  </div>

  <!-- B-Roll Selection Modal (multi-select via checkboxes) -->
  <div class="video-modal" id="brollSelectionModal" style="display:none">
    <div class="video-modal-content" style="max-width:1100px">
      <div class="video-modal-header">
        <h3 id="brollSelectionTitle">B-Roll Suggestions — pick the clips you want</h3>
        <button class="video-modal-close" onclick="closeBrollSelectionModal()">&times;</button>
      </div>
      <p id="brollSelectionSubtitle" style="color:var(--text-muted);font-size:0.9rem;margin:-8px 0 16px 0"></p>
      <div id="brollSelectionGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;max-height:60vh;overflow-y:auto;padding:4px"></div>
      <div class="video-modal-actions" style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap">
        <span id="brollSelectionCount" style="color:var(--text-muted);font-size:0.85rem;margin-right:auto"></span>
        <button type="button" class="btn-cancel" onclick="closeBrollSelectionModal()">Cancel</button>
        <button type="button" class="btn-use-clip" id="brollConfirmBtn" onclick="confirmBrollSelection()">Render Final Video</button>
      </div>
    </div>
  </div>

  <script>
    let currentBrollVideo = null;
    let currentSelectedItem = null;
    window.brollItemsData = []; // Store full item data for modal access

    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }

    // ─── Input mode selector (mirrors /ai-hook) ───────────────────────────
    function setBrollInputMode(mode) {
      var panels = {
        youtube: document.getElementById('qibUrlPanel'),
        upload:  document.getElementById('qibUploadPanel'),
        text:    document.getElementById('qibTextPanel')
      };
      var btns = {
        youtube: document.getElementById('modeUrlBtn'),
        upload:  document.getElementById('modeUploadBtn'),
        text:    document.getElementById('modeTextBtn')
      };
      Object.keys(panels).forEach(function(k){ if (panels[k]) panels[k].style.display = (k === mode) ? 'block' : 'none'; });
      Object.keys(btns).forEach(function(k){
        var b = btns[k]; if (!b) return;
        if (k === mode) {
          b.style.background = 'var(--primary)';
          b.style.color = '#fff';
          b.style.borderColor = 'var(--primary)';
        } else {
          b.style.background = 'var(--dark-2)';
          b.style.color = 'var(--text-muted)';
          b.style.borderColor = 'rgba(255,255,255,0.1)';
        }
      });
      window.__aiBrollInputMode = mode;
    }
    window.__aiBrollInputMode = 'youtube';
    window.setBrollInputMode = setBrollInputMode;

    // Drop-zone handlers (Upload mode). Bridge into the IIFE upload pipeline
    // by populating primaryFileInput with the dropped file and dispatching
    // the change event the IIFE already listens for.
    function handleBrollDragOver(e) {
      e.preventDefault();
      var c = document.getElementById('uploadContainer');
      if (c) c.classList.add('dragover');
    }
    function handleBrollDragLeave(e) {
      e.preventDefault();
      var c = document.getElementById('uploadContainer');
      if (c) c.classList.remove('dragover');
    }
    function handleBrollDrop(e) {
      e.preventDefault();
      var c = document.getElementById('uploadContainer');
      if (c) c.classList.remove('dragover');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        var input = document.getElementById('primaryFileInput');
        if (input) {
          try {
            var dt = new DataTransfer();
            dt.items.add(files[0]);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (_) {
            var fn = document.getElementById('fileName');
            if (fn) fn.textContent = 'Selected: ' + files[0].name;
          }
        }
      }
    }

    function switchTab(tabName, e) {
      e.preventDefault();
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabName).classList.add('active');
      e.target.classList.add('active');
    }

    // ─── Credit confirmation step (shown before /ai-broll/generate runs) ───
    var AI_BROLL_COST = 2; // mirrors middleware/credits.js
    async function showCreditConfirmModal() {
      var modal = document.getElementById('creditConfirmModal');
      if (!modal) return;
      document.getElementById('creditCostNum').textContent = AI_BROLL_COST;
      document.getElementById('creditCostBig').textContent = AI_BROLL_COST + ' credits';
      document.getElementById('creditCostUnit').textContent = AI_BROLL_COST === 1 ? 'credit' : 'credits';
      document.getElementById('creditUsedTxt').textContent = '—';
      document.getElementById('creditRemainAfter').textContent = '—';
      document.getElementById('creditProgressBar').style.width = '0%';
      var warn = document.getElementById('creditWarningRow');
      warn.textContent = 'Charge happens only after the job completes successfully — if anything errors, nothing is deducted.';
      warn.style.color = 'var(--text-muted)';
      var btn = document.getElementById('creditConfirmBtn');
      btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
      btn.textContent = 'Yes, use credits & generate';
      modal.style.display = 'flex';
      try {
        var r = await fetch('/dashboard/api/credits-breakdown', { headers: { 'Accept':'application/json' } });
        if (r.ok) {
          var d = await r.json();
          var used = d.used || 0;
          var cap = d.cap || 0;
          var afterUsed = used + AI_BROLL_COST;
          var pct = cap > 0 ? Math.min(100, Math.round((afterUsed / cap) * 100)) : 0;
          document.getElementById('creditUsedTxt').textContent = used + ' / ' + cap;
          document.getElementById('creditRemainAfter').textContent = Math.max(0, cap - afterUsed) + ' / ' + cap;
          document.getElementById('creditProgressBar').style.width = pct + '%';
          if (afterUsed > cap) {
            warn.textContent = 'Heads up: this would exceed your monthly cap. Upgrade your plan to continue.';
            warn.style.color = '#EC4899';
            btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed';
            btn.textContent = 'Out of credits';
          }
        }
      } catch (_) { /* soft-fail */ }
    }
    function closeCreditConfirmModal() {
      var modal = document.getElementById('creditConfirmModal');
      if (modal) modal.style.display = 'none';
    }
    async function confirmAndProceed() {
      var modal = document.getElementById('creditConfirmModal');
      if (modal) modal.style.display = 'none';
      window.__brollConfirmedCredits = true;
      var form = document.getElementById('brollForm');
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    window.showCreditConfirmModal = showCreditConfirmModal;
    window.closeCreditConfirmModal = closeCreditConfirmModal;
    window.confirmAndProceed = confirmAndProceed;

    document.getElementById('brollForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      // ─── Credit confirmation step: show themed modal first, then re-fire submit ───
      if (!window.__brollConfirmedCredits) {
        showCreditConfirmModal();
        return;
      }
      window.__brollConfirmedCredits = false;

      // Source of truth: the staged primary from the new ingestion flow,
      // OR the active input mode if no primary has been staged yet.
      const stagedPrimary = (window.__aiBrollState && window.__aiBrollState.primary) || null;
      const inputMode = window.__aiBrollInputMode || 'youtube';
      const mode = document.querySelector('.tab-btn.active').dataset.tab;

      let content = null;
      if (stagedPrimary && stagedPrimary.filename) {
        content = { type: stagedPrimary.source === 'youtube' ? 'youtube' : 'upload' };
      } else if (inputMode === 'text') {
        const txt = (document.getElementById('brollTranscript') || {}).value || '';
        if (!txt.trim()) {
          showToast('Paste a transcript or describe your video first');
          return;
        }
        content = { type: 'text', text: txt.trim() };
      } else if (inputMode === 'upload') {
        showToast('Click \u2018Upload\u2019 to pick a file first');
        return;
      } else {
        const url = ((document.getElementById('heroLinkInput') || {}).value || '').trim();
        if (!url) {
          showToast('Paste a YouTube link first');
          return;
        }
        content = { type: 'youtube', url };
      }

      const btn = document.getElementById('generateBrollBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Analyzing & generating B-Roll...';
      const progressBar = document.getElementById('progressBar');
      progressBar.classList.add('active');

      try {
        let response;

        // Build a single JSON request body. The new ingestion flow stages files
        // server-side via /upload-primary, /import-url, /googledrive-import,
        // /dropbox-import — so /generate now ALWAYS receives JSON, never multipart.
        const aiPromptVal = (document.getElementById('aiPrompt') || {}).value || '';
        const searchTermsVal = (document.getElementById('searchTerms') || {}).value || '';
        const transcriptVal = (document.getElementById('brollTranscript') || {}).value || '';

        // Combine free-text inputs as the GPT 'prompt' hint.
        const promptHint = (mode === 'stock' ? searchTermsVal : aiPromptVal) ||
                           transcriptVal ||
                           '';

        const reqBody = { mode, prompt: promptHint };

        if (stagedPrimary && stagedPrimary.filename) {
          reqBody.inputType = stagedPrimary.source === 'youtube' ? 'youtube' : 'upload';
          reqBody.url = stagedPrimary.sourceUrl || undefined;
          reqBody.primary = {
            filename: stagedPrimary.filename,
            originalName: stagedPrimary.originalName,
            source: stagedPrimary.source
          };
        } else if (content && content.type === 'youtube') {
          reqBody.inputType = 'youtube';
          reqBody.url = content.url;
        } else if (content && content.type === 'text') {
          reqBody.inputType = 'text';
          reqBody.prompt = content.text;
        } else {
          reqBody.inputType = 'upload';
        }

        response = await fetch('/ai-broll/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        });

        const data = await response.json();

        if (response.ok && data.brollItems && data.brollItems.length > 0) {
          // Store items data globally for both selection modal + the single-preview modal
          window.brollItemsData = data.brollItems;

          // Update the inline status pane with a short summary
          const container = document.getElementById('brollResultsContainer');
          let summary = '<h2 style="margin-bottom: 0.5rem; color: var(--text);">B-Roll suggestions ready</h2>';
          if (data.pixabayWarning) summary += '<div class="api-warning">' + data.pixabayWarning + '</div>';
          summary += '<p style="color:var(--text-muted);font-size:0.9rem">' + data.brollItems.length + ' clips suggested. The selection modal opened so you can pick which ones to use.</p>';
          container.innerHTML = summary;

          // Open the multi-select modal so the user can choose clips before they are staged.
          openBrollSelectionModal(data.brollItems);
        } else {
          showToast(data.error || 'Failed to generate B-roll');
        }
      } catch (error) {
        showToast('Error generating B-roll');
        console.error(error);
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Add B-Roll in 1 Click';
        progressBar.classList.remove('active');
      }
    });

    function selectBroll(id) {
      // Highlight selected card
      const items = document.querySelectorAll('.broll-item');
      items.forEach(item => item.classList.remove('selected'));

      const selectedElement = document.getElementById('broll-' + id);
      if (selectedElement) {
        selectedElement.classList.add('selected');
      }

      // Open video modal for preview
      openVideoModal(id);
    }

    function openVideoModal(id) {
      const modal = document.getElementById('videoModal');
      const modalTitle = document.getElementById('modalTitle');
      const modalVideo = document.getElementById('modalVideo');
      const videoDetails = document.getElementById('videoDetails');

      // Find the item's full data - this will be set from the backend response
      const itemData = window.brollItemsData && window.brollItemsData.find(item => item.id === id);

      if (!itemData) {
        showToast('Item data not found');
        return;
      }

      currentSelectedItem = itemData;

      modalTitle.textContent = itemData.name;
      modalVideo.src = itemData.videoPreviewUrl;

      videoDetails.innerHTML = \`
        <p><strong>Keywords:</strong> \${itemData.keywords.join(', ')}</p>
        <p><strong>Duration:</strong> \${itemData.duration} seconds</p>
        <p><strong>Artist:</strong> \${itemData.artist}</p>
        <p><strong>Source:</strong> Pixabay</p>
      \`;

      modal.classList.add('active');
    }

    function closeVideoModal() {
      const modal = document.getElementById('videoModal');
      const modalVideo = document.getElementById('modalVideo');
      modalVideo.pause();
      modal.classList.remove('active');
    }

    async function useSelectedClip() {
      if (!currentSelectedItem) {
        showToast('No clip selected');
        return;
      }
      var btn = document.querySelector('.btn-use-clip');
      var origText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Staging…'; }
      try {
        var downloadUrl = currentSelectedItem.videoDownloadUrl || currentSelectedItem.videoPreviewUrl;
        if (!downloadUrl || !/^https:\\/\\//i.test(downloadUrl)) {
          showToast('This clip has no downloadable URL');
          return;
        }
        var r = await fetch('/ai-broll/download-inline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: downloadUrl, name: currentSelectedItem.name })
        });
        var data = await r.json();
        if (!r.ok || !data.filename) throw new Error(data.error || 'Download failed');
        if (window.__aiBrollStageClip) {
          window.__aiBrollStageClip({
            filename: data.filename,
            name: currentSelectedItem.name,
            duration: data.duration || currentSelectedItem.duration || 0,
            serveUrl: data.mediaUrl
          });
        } else {
          showToast('Clip ready: ' + currentSelectedItem.name);
        }
        closeVideoModal();
      } catch (err) {
        showToast('Could not stage clip: ' + (err.message || err));
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText || 'Use This Clip'; }
      }
    }

    ${themeScript}
  
// ═══ B-Roll Selection Modal (v2: visual feedback + inline preview + selection order) ═══
window.__selectedClipIds = []; // tracks selection ORDER (push on select, splice on deselect)

function _brollSelected(id) { return window.__selectedClipIds.indexOf(id) >= 0; }

function _brollApplyCardStyle(card, selected) {
  if (!card) return;
  if (selected) {
    card.style.borderColor = 'var(--primary)';
    card.style.boxShadow = '0 0 0 2px var(--primary), 0 4px 18px rgba(108,58,237,0.35)';
    card.style.transform = 'translateY(-2px)';
  } else {
    card.style.borderColor = 'var(--border-subtle)';
    card.style.boxShadow = 'none';
    card.style.transform = 'none';
  }
  var indicator = card.querySelector('.broll-select-indicator');
  if (indicator) {
    if (selected) {
      indicator.style.background = 'var(--primary)';
      indicator.style.borderColor = 'var(--primary)';
      indicator.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8.5L6.5 12L13 4.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else {
      indicator.style.background = 'rgba(0,0,0,0.55)';
      indicator.style.borderColor = 'rgba(255,255,255,0.6)';
      indicator.innerHTML = '';
    }
  }
}

function _brollToggleSelect(id, card) {
  var idx = window.__selectedClipIds.indexOf(id);
  if (idx >= 0) {
    window.__selectedClipIds.splice(idx, 1);
  } else {
    window.__selectedClipIds.push(id);
  }
  _brollApplyCardStyle(card, _brollSelected(id));
  updateBrollSelectionCount();
}

function _brollTogglePreview(card, item) {
  var thumbDiv = card.querySelector('.broll-thumb-area');
  if (!thumbDiv) return;
  var existing = thumbDiv.querySelector('video');
  if (existing) {
    try { existing.pause(); } catch (_) {}
    existing.remove();
    var btn = thumbDiv.querySelector('.broll-preview-btn');
    if (btn) btn.textContent = '▶ Preview';
    return;
  }
  var v = document.createElement('video');
  v.controls = true;
  v.autoplay = true;
  v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:1';
  v.src = item.videoPreviewUrl || item.videoDownloadUrl || '';
  v.addEventListener('ended', function () { try { v.remove(); } catch (_) {} var b = thumbDiv.querySelector('.broll-preview-btn'); if (b) b.textContent = '▶ Preview'; });
  v.addEventListener('error', function () { showToast('Could not load preview'); try { v.remove(); } catch (_) {} });
  thumbDiv.appendChild(v);
  var btn = thumbDiv.querySelector('.broll-preview-btn');
  if (btn) btn.textContent = '⏹ Stop';
}

function openBrollSelectionModal(items) {
  var modal = document.getElementById('brollSelectionModal');
  var grid = document.getElementById('brollSelectionGrid');
  var subtitle = document.getElementById('brollSelectionSubtitle');
  if (!modal || !grid) return;
  window.__selectedClipIds = []; // reset selection order
  window.__brollItemsLive = items; // mutable copy for swap logic
  grid.innerHTML = '';
  grid.style.display = 'block'; // override grid → flow vertically for the Smart-Shorts-style scene list
  if (subtitle) subtitle.textContent = items.length + ' scenes selected for your video. Each preview is playing — uncheck scenes you don’t want, swap if the AI picked the wrong angle, then continue.';

  items.forEach(function (item, sIdx) {
    var card = document.createElement('div');
    card.style.cssText = 'margin-bottom:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px';
    card.dataset.itemId = item.id;
    card.dataset.sceneIdx = sIdx;

    var why = item.why || item.sceneDescription || item.searchQueryUsed || '';
    var sceneDesc = item.sceneDescription || '';
    var hintRaw = (item.timestamp_hint || item.moment || 'middle').toString().toLowerCase();
    var hintLabel = hintRaw.charAt(0).toUpperCase() + hintRaw.slice(1);
    var hintColor = hintRaw === 'beginning' || hintRaw === 'intro' ? '#10b981' :
                    hintRaw === 'end' || hintRaw === 'outro' || hintRaw === 'conclusion' ? '#f97316' :
                    hintRaw === 'middle' ? '#3b82f6' : '#a29bfe';

    // ─── Header row: checkbox + badge + description + why ───
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:flex-start;gap:10px;margin-bottom:10px';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'broll-card-checkbox';
    cb.dataset.itemId = item.id;
    cb.checked = true;
    cb.style.cssText = 'margin-top:4px;width:18px;height:18px;accent-color:var(--primary);cursor:pointer;flex-shrink:0';
    cb.addEventListener('change', function (e) {
      var id = item.id;
      var idx = window.__selectedClipIds.indexOf(id);
      if (cb.checked && idx < 0) window.__selectedClipIds.push(id);
      else if (!cb.checked && idx >= 0) window.__selectedClipIds.splice(idx, 1);
      updateBrollSelectionCount();
    });
    // Start everything selected (matches Smart Shorts default).
    window.__selectedClipIds.push(item.id);
    header.appendChild(cb);

    var info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML =
      '<span style="display:inline-block;font-size:10px;color:#fff;background:' + hintColor + ';padding:3px 10px;border-radius:10px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">' + hintLabel + '</span>' +
      (sceneDesc ? '<p style="font-size:13px;color:var(--text);margin:6px 0 0 0;line-height:1.4">' + sceneDesc + '</p>' : '') +
      (why ? '<p style="font-size:11px;color:var(--text-muted);margin:4px 0 0 0;font-style:italic">' + why + '</p>' : '');
    header.appendChild(info);
    card.appendChild(header);

    // ─── Auto-pick row: video + AUTO-PICK badge + position/duration selects + swap button ───
    var pickRow = document.createElement('div');
    pickRow.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    pickRow.dataset.role = 'pick-row';

    var vidWrap = document.createElement('div');
    vidWrap.style.cssText = 'position:relative;flex-shrink:0';
    vidWrap.dataset.role = 'vid-wrap';
    var v = document.createElement('video');
    v.src = item.videoPreviewUrl || item.videoDownloadUrl || '';
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline','');
    v.preload = 'auto';
    v.style.cssText = 'width:180px;height:101px;object-fit:cover;border-radius:8px;display:block;border:2px solid var(--primary);background:#000';
    v.addEventListener('loadeddata', function () { v.play().catch(function(){}); });
    vidWrap.appendChild(v);
    var badge = document.createElement('span');
    badge.style.cssText = 'position:absolute;top:6px;left:6px;background:var(--primary);color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:0.5px';
    badge.textContent = 'AUTO-PICK';
    vidWrap.appendChild(badge);
    var dur = document.createElement('span');
    dur.style.cssText = 'position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px';
    dur.textContent = (item.duration || 0) + 's';
    vidWrap.appendChild(dur);
    pickRow.appendChild(vidWrap);

    var controls = document.createElement('div');
    controls.style.cssText = 'flex:1;min-width:160px;display:flex;flex-direction:column;gap:6px';

    var artistDiv = document.createElement('div');
    artistDiv.style.cssText = 'font-size:11px;color:var(--text-muted)';
    artistDiv.textContent = 'By ' + (item.artist || 'Pixabay');
    controls.appendChild(artistDiv);

    // Position selector
    var posWrap = document.createElement('div');
    posWrap.innerHTML = '<label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:2px">Position in clip:</label>';
    var posSel = document.createElement('select');
    posSel.dataset.role = 'position';
    posSel.style.cssText = 'font-size:12px;padding:5px 8px;background:var(--dark-2);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:6px;width:100%;cursor:pointer';
    [['beginning','Beginning (first 3s)'],['middle','Middle (halfway)'],['end','End (last 8s)'],['quarter','25% in'],['three-quarter','75% in']].forEach(function (p) {
      var o = document.createElement('option');
      o.value = p[0]; o.textContent = p[1];
      if (hintRaw === p[0] || (!hintRaw && p[0] === 'middle')) o.selected = true;
      posSel.appendChild(o);
    });
    posSel.addEventListener('change', updateBrollSelectionCount);
    posWrap.appendChild(posSel);
    controls.appendChild(posWrap);

    // Duration selector
    var durWrap = document.createElement('div');
    durWrap.innerHTML = '<label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:2px">B-Roll duration:</label>';
    var durSel = document.createElement('select');
    durSel.dataset.role = 'duration';
    durSel.style.cssText = 'font-size:12px;padding:5px 8px;background:var(--dark-2);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:6px;width:100%;cursor:pointer';
    [3, 5, 8].forEach(function (d) {
      var o = document.createElement('option');
      o.value = String(d); o.textContent = d + ' seconds';
      if (d === 5) o.selected = true;
      durSel.appendChild(o);
    });
    durWrap.appendChild(durSel);
    controls.appendChild(durWrap);

    // Swap scene button — toggles the alternatives drawer
    if (item.alternatives && item.alternatives.length > 0) {
      var swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.style.cssText = 'font-size:11px;background:rgba(255,255,255,0.08);color:var(--text);border:none;padding:6px 10px;border-radius:6px;cursor:pointer;width:100%;margin-top:2px;transition:background 0.15s';
      swapBtn.textContent = 'Swap Scene (' + item.alternatives.length + ' more)';
      swapBtn.addEventListener('mouseenter', function () { swapBtn.style.background = 'rgba(255,255,255,0.15)'; });
      swapBtn.addEventListener('mouseleave', function () { swapBtn.style.background = 'rgba(255,255,255,0.08)'; });
      swapBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var drawer = card.querySelector('[data-role="alt-drawer"]');
        if (!drawer) return;
        var open = drawer.style.display !== 'none';
        drawer.style.display = open ? 'none' : 'flex';
        // When opening, ensure all alt videos start playing (some browsers pause hidden video)
        if (!open) drawer.querySelectorAll('video').forEach(function (vv) { vv.play().catch(function(){}); });
      });
      controls.appendChild(swapBtn);
    }

    pickRow.appendChild(controls);
    card.appendChild(pickRow);

    // ─── Alternatives drawer (hidden by default; auto-loops on open) ───
    if (item.alternatives && item.alternatives.length > 0) {
      var drawer = document.createElement('div');
      drawer.dataset.role = 'alt-drawer';
      drawer.style.cssText = 'display:none;gap:10px;margin-top:10px;overflow-x:auto;padding:4px 2px';
      item.alternatives.forEach(function (alt, aIdx) {
        var altCard = document.createElement('div');
        altCard.style.cssText = 'flex-shrink:0;width:140px;cursor:pointer;text-align:center;position:relative';
        altCard.title = 'Click to use this clip instead';
        var altVid = document.createElement('video');
        altVid.src = alt.videoPreviewUrl || alt.videoDownloadUrl || '';
        altVid.muted = true; altVid.loop = true; altVid.autoplay = true; altVid.playsInline = true;
        altVid.setAttribute('playsinline',''); altVid.setAttribute('webkit-playsinline','');
        altVid.preload = 'auto';
        altVid.style.cssText = 'width:140px;height:79px;object-fit:cover;border-radius:5px;display:block;border:1px solid rgba(255,255,255,0.15);background:#000';
        altVid.addEventListener('loadeddata', function () { altVid.play().catch(function(){}); });
        altCard.appendChild(altVid);
        var altDur = document.createElement('div');
        altDur.style.cssText = 'font-size:9px;color:var(--text-muted);margin-top:3px';
        altDur.textContent = (alt.duration || 0) + 's · ' + (alt.artist || 'Pixabay');
        altCard.appendChild(altDur);
        var useHint = document.createElement('div');
        useHint.style.cssText = 'font-size:9px;color:var(--primary);margin-top:1px;font-weight:600';
        useHint.textContent = 'Click to use';
        altCard.appendChild(useHint);
        // Swap the alt with the auto-pick when clicked
        altCard.addEventListener('click', function (e) {
          e.stopPropagation();
          var oldPrimary = {
            id: item.id, name: item.name, thumbnailUrl: item.thumbnailUrl,
            videoPreviewUrl: item.videoPreviewUrl, videoDownloadUrl: item.videoDownloadUrl,
            duration: item.duration, artist: item.artist
          };
          item.videoPreviewUrl = alt.videoPreviewUrl;
          item.videoDownloadUrl = alt.videoDownloadUrl;
          item.thumbnailUrl = alt.thumbnailUrl;
          item.duration = alt.duration;
          item.artist = alt.artist;
          // Replace the slot in alternatives with the old primary
          item.alternatives[aIdx] = oldPrimary;
          // Re-render this single card by re-opening the modal with the (mutated) items list.
          openBrollSelectionModal(window.__brollItemsLive);
        });
        drawer.appendChild(altCard);
      });
      card.appendChild(drawer);
    }

    grid.appendChild(card);
  });

  modal.style.display = 'flex';
  updateBrollSelectionCount();
}

function updateBrollSelectionCount() {
  var checked = window.__selectedClipIds.length;
  var total = document.querySelectorAll('#brollSelectionGrid > div').length;
  var countEl = document.getElementById('brollSelectionCount');
  var btn = document.getElementById('brollConfirmBtn');
  if (countEl) countEl.textContent = checked + ' of ' + total + ' selected';
  // Detect duplicate timeline positions among CHECKED scenes
  var positions = [];
  document.querySelectorAll('#brollSelectionGrid [data-item-id]').forEach(function (card) {
    var cb = card.querySelector('.broll-card-checkbox');
    var posSel = card.querySelector('[data-role="position"]');
    if (cb && cb.checked && posSel) positions.push(posSel.value);
  });
  var dupSet = {};
  var hasDup = positions.some(function (p) { if (dupSet[p]) return true; dupSet[p] = 1; return false; });
  var msg = document.getElementById('brollSelectionCount');
  if (btn) {
    if (checked === 0) {
      btn.textContent = 'Render Final Video';
      btn.disabled = true;
      btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed';
      if (msg) msg.style.color = 'var(--text-muted)';
    } else if (hasDup) {
      btn.textContent = 'Resolve duplicate positions';
      btn.disabled = true;
      btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed';
      if (msg) { msg.textContent = checked + ' of ' + total + ' selected - duplicate timeline positions, please change one'; msg.style.color = '#EC4899'; }
    } else {
      btn.textContent = 'Render Final Video (' + checked + ')';
      btn.disabled = false;
      btn.style.opacity = '1'; btn.style.cursor = 'pointer';
      if (msg) msg.style.color = 'var(--text-muted)';
    }
  }
}

function closeBrollSelectionModal() {
  var modal = document.getElementById('brollSelectionModal');
  if (modal) {
    // Stop any inline previews still playing.
    modal.querySelectorAll('video').forEach(function (v) { try { v.pause(); v.remove(); } catch (_) {} });
    modal.style.display = 'none';
  }
}

function showBrollUploadFallback(errMsg) {
  var sub = document.getElementById('brollSelectionSubtitle');
  if (sub) sub.textContent = 'We could not download the source video automatically. Upload a local copy to continue.';
  var grid = document.getElementById('brollSelectionGrid');
  if (!grid) return;
  Array.from(grid.children).forEach(function (el) { el.style.display = 'none'; });
  var panel = document.createElement('div');
  panel.id = 'brollUploadFallback';
  panel.style.cssText = 'background:rgba(236,72,153,0.06);border:1px solid rgba(236,72,153,0.25);border-radius:10px;padding:18px;margin:8px 4px';
  panel.innerHTML =
    '<div style="font-size:0.95rem;color:var(--text);font-weight:600;margin-bottom:8px">YouTube blocked the download.</div>' +
    '<div style="font-size:0.85rem;color:var(--text-muted);line-height:1.5;margin-bottom:14px">Your B-roll selection is still here. To finish the render, upload a local copy of the same video below. Splicing will resume immediately.</div>' +
    '<div style="margin-bottom:8px"><input type="file" id="brollFallbackFile" accept="video/*" style="display:none">' +
      '<button type="button" id="brollFallbackBtn" class="btn-use-clip" style="display:inline-block">Upload local copy</button>' +
    '</div>' +
    '<div id="brollFallbackStatus" style="font-size:0.78rem;color:var(--text-muted);margin-top:6px"></div>' +
    '<details style="margin-top:12px;font-size:0.78rem;color:var(--text-muted)">' +
      '<summary style="cursor:pointer">Server error detail</summary>' +
      '<pre style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.25);border-radius:6px;white-space:pre-wrap;font-size:0.72rem">' + (errMsg || 'unknown') + '</pre>' +
    '</details>';
  grid.appendChild(panel);
  var input = document.getElementById('brollFallbackFile');
  var trigger = document.getElementById('brollFallbackBtn');
  var status = document.getElementById('brollFallbackStatus');
  trigger.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', async function () {
    var file = input.files && input.files[0];
    if (!file) return;
    trigger.disabled = true; trigger.textContent = 'Uploading...';
    status.textContent = 'Uploading ' + file.name + '...';
    try {
      var fd = new FormData(); fd.append('video', file);
      var r = await fetch('/ai-broll/upload-primary', { method: 'POST', body: fd });
      if (!r.ok) { var e = await r.json().catch(function(){return{};}); throw new Error(e.error || ('Upload failed (' + r.status + ')')); }
      var data = await r.json();
      if (window.__aiBrollState) {
        window.__aiBrollState.primary = {
          filename: data.filename,
          originalName: file.name,
          duration: data.duration || 0,
          serveUrl: data.serveUrl || ('/video-editor/download/' + data.filename),
          source: 'upload'
        };
      }
      status.textContent = 'Uploaded. Continuing render...';
      panel.remove();
      Array.from(grid.children).forEach(function (el) { el.style.display = ''; });
      setTimeout(function () { confirmBrollSelection(); }, 200);
    } catch (err) {
      status.textContent = 'Upload failed: ' + (err.message || err);
      trigger.disabled = false; trigger.textContent = 'Upload local copy';
    }
  });
}

async function confirmBrollSelection() {
  var ids = (window.__selectedClipIds || []).slice();
  if (ids.length === 0) { showToast('Pick at least one scene first'); return; }

  // Need a primary video to splice into. If none is staged, try to import the
  // URL from heroLinkInput now.
  var hasPrimary = !!(window.__aiBrollHasPrimary && window.__aiBrollHasPrimary());
  var sourceUrl = !hasPrimary ? ((document.getElementById('heroLinkInput') || {}).value || '').trim() : '';
  var btn = document.getElementById('brollConfirmBtn');
  if (btn) { btn.disabled = true; }

  if (!hasPrimary && sourceUrl && /^https?:\\/\\//i.test(sourceUrl) && window.__aiBrollImportUrlAsPrimary) {
    try {
      if (btn) btn.textContent = 'Importing primary video...';
      await window.__aiBrollImportUrlAsPrimary(sourceUrl);
      hasPrimary = !!(window.__aiBrollHasPrimary && window.__aiBrollHasPrimary());
    } catch (err) {
      // Don't lose the user\'s selection — offer an Upload fallback inside the modal instead.
      showBrollUploadFallback(err.message || String(err));
      if (btn) { btn.disabled = false; btn.textContent = 'Download Clip with B-Roll'; }
      return;
    }
  }
  if (!hasPrimary) {
    showBrollUploadFallback('No primary video has been imported yet.');
    if (btn) { btn.disabled = false; btn.textContent = 'Download Clip with B-Roll'; }
    return;
  }

  // Collect selected scenes from the live items array using the position +
  // duration selects rendered into each card.
  var items = window.__brollItemsLive || [];
  var brollScenes = [];
  ids.forEach(function (id) {
    var item = items.find(function (x) { return x.id === id; });
    if (!item) return;
    var card = document.querySelector('#brollSelectionGrid [data-item-id="' + id + '"]');
    var posEl = card && card.querySelector('[data-role="position"]');
    var durEl = card && card.querySelector('[data-role="duration"]');
    brollScenes.push({
      videoUrl: item.videoDownloadUrl || item.videoPreviewUrl,
      position: posEl ? posEl.value : 'middle',
      duration: durEl ? parseInt(durEl.value, 10) : 5
    });
  });

  // Stop all the preview videos to free CPU + bandwidth during the render
  document.querySelectorAll('#brollSelectionGrid video').forEach(function (v) { try { v.pause(); } catch (_) {} });

  if (btn) btn.textContent = 'Rendering... (this can take a few minutes)';

  // Kick off the server-side render
  var rendering;
  try {
    var r = await fetch('/ai-broll/render-with-broll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary: window.__aiBrollState.primary, brollScenes: brollScenes })
    });
    rendering = await r.json();
    if (!r.ok) throw new Error(rendering.error || 'Render request failed');
  } catch (err) {
    showToast('Could not start render: ' + (err.message || err));
    if (btn) { btn.disabled = false; btn.textContent = 'Download Clip with B-Roll'; }
    return;
  }

  // Render the in-modal "rendering..." state
  var grid = document.getElementById('brollSelectionGrid');
  var sub = document.getElementById('brollSelectionSubtitle');
  if (sub) sub.textContent = 'Building your final clip with the B-roll spliced in. This usually takes 1-3 minutes depending on length.';
  if (grid) {
    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
    grid.style.alignItems = 'center';
    grid.style.justifyContent = 'center';
    grid.style.minHeight = '180px';
    grid.innerHTML =
      '<div style="text-align:center;padding:30px 20px;width:100%">' +
        '<div style="font-size:0.95rem;color:var(--text);margin-bottom:14px" id="aiBrollRenderStatus">Starting render...</div>' +
        '<div style="width:80%;max-width:480px;margin:0 auto;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">' +
          '<div id="aiBrollRenderPulse" style="height:100%;width:30%;background:linear-gradient(90deg,#6C3AED,#EC4899);border-radius:3px;animation:aiBrollPulse 1.8s ease-in-out infinite"></div>' +
        '</div>' +
        '<style>@keyframes aiBrollPulse { 0%,100%{margin-left:0%}50%{margin-left:70%} }</style>' +
      '</div>';
  }

  // Poll status until ready or error (max 12 minutes)
  var statusEl = document.getElementById('aiBrollRenderStatus');
  var deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(function (r) { setTimeout(r, 2500); });
    try {
      var sr = await fetch(rendering.statusUrl);
      var sd = await sr.json();
      if (sd.status === 'ready') {
        if (statusEl) statusEl.textContent = 'Done!';
        if (grid) {
          grid.innerHTML =
            '<div style="text-align:center;padding:30px 20px;width:100%">' +
              '<div style="font-size:1.05rem;color:var(--text);font-weight:600;margin-bottom:10px">Your clip is ready</div>' +
              '<div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:18px">' + (Math.round(sd.sizeBytes / 1024 / 1024 * 10) / 10) + ' MB</div>' +
              '<a href="' + sd.downloadUrl + '" download class="btn-use-clip" style="display:inline-block;text-decoration:none;padding:0.9rem 2rem;font-size:0.95rem">Download Final Video</a>' +
              '<div style="margin-top:14px;font-size:0.8rem;color:var(--text-muted)">You can also Cancel to close this modal and run another generation.</div>' +
            '</div>';
        }
        if (btn) { btn.style.display = 'none'; }
        return;
      }
      if (sd.status === 'error') {
        if (statusEl) statusEl.textContent = 'Render failed: ' + (sd.message || 'unknown');
        if (btn) { btn.disabled = false; btn.textContent = 'Download Clip with B-Roll'; }
        return;
      }
      if (statusEl) statusEl.textContent = sd.message || 'Working...';
    } catch (_) { /* keep polling */ }
  }
  if (statusEl) statusEl.textContent = 'Timed out. Try again with fewer or shorter B-roll scenes.';
  if (btn) { btn.disabled = false; btn.textContent = 'Download Clip with B-Roll'; }
}

// ═══ AI B-Roll media ingestion + project handoff (client) ═══
(function () {
  var state = { primary: null, broll: [] };
  window.__aiBrollState = state;

  function toastMsg(msg) {
    try { if (typeof showToast === 'function') return showToast(msg); } catch (_) {}
    alert(msg);
  }

  function updateStagingCard() {
    var card = document.getElementById('projectStagingCard');
    var txt = document.getElementById('primaryStatusText');
    var list = document.getElementById('selectedBrollList');
    var btn = document.getElementById('createProjectBtn');
    if (!card || !txt || !list || !btn) return;
    if (!state.primary) {
      card.style.display = 'none';
      btn.disabled = true;
      return;
    }
    card.style.display = 'block';
    btn.disabled = false;
    var dur = state.primary.duration ? (Math.round(state.primary.duration) + 's') : 'unknown duration';
    var label = (state.primary.originalName || state.primary.filename || 'Primary video');
    var srcTag = state.primary.source ? (' · ' + state.primary.source) : '';
    txt.innerHTML = '<strong>Primary:</strong> ' + label + ' <span style="color:var(--text-muted);font-size:.85rem">(' + dur + srcTag + ')</span>';
    list.innerHTML = '';
    if (state.broll.length === 0) {
      list.innerHTML = '<span style="color:var(--text-muted);font-size:.85rem">No B-roll selected yet. Generate + click "Use This Clip" to add clips.</span>';
    } else {
      state.broll.forEach(function (b, i) {
        var chip = document.createElement('span');
        chip.style.cssText = 'background:var(--dark-2);padding:6px 10px;border-radius:8px;font-size:.8rem;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border-subtle)';
        chip.innerHTML = '<img src="/images/section-icons/A-92.png" alt="" style="height:14px;width:14px;vertical-align:middle;margin-right:2px"> ' + (b.name || b.filename) + ' <button type="button" aria-label="Remove" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;line-height:1">×</button>';
        chip.querySelector('button').onclick = function () {
          state.broll.splice(i, 1);
          updateStagingCard();
        };
        list.appendChild(chip);
      });
    }
  }
  window.__aiBrollUpdateCard = updateStagingCard;

  function setPrimary(p) {
    state.primary = p;
    updateStagingCard();
    toastMsg('Primary video ready: ' + (p.originalName || p.filename));
  }

  // ---- Upload (local file) ----
  // Render a progress indicator inside the upload-zone (replaces drop-text temporarily)
  function _renderUploadProgress(state) {
    var zone = document.getElementById('uploadContainer');
    if (!zone) return;
    if (state === 'start') {
      zone.dataset.originalHtml = zone.dataset.originalHtml || zone.innerHTML;
      zone.innerHTML =
        '<div style="text-align:center;width:100%;padding:18px 8px">' +
          '<div style="font-size:0.95rem;color:var(--text);font-weight:600;margin-bottom:10px" id="upPrimaryLabel">Preparing upload...</div>' +
          '<div style="width:100%;max-width:480px;margin:0 auto;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">' +
            '<div id="upPrimaryBar" style="height:100%;width:0%;background:linear-gradient(90deg,#6C3AED,#EC4899);transition:width 0.15s ease-out;border-radius:4px"></div>' +
          '</div>' +
          '<div id="upPrimaryPct" style="font-size:0.75rem;color:var(--text-muted);margin-top:8px">0%</div>' +
        '</div>';
    } else if (state === 'done' || state === 'fail') {
      // Restore the original drop-zone HTML so the next upload still works
      if (zone.dataset.originalHtml) {
        zone.innerHTML = zone.dataset.originalHtml;
        delete zone.dataset.originalHtml;
      }
    }
  }
  function _setUploadProgress(loaded, total, phase) {
    var bar = document.getElementById('upPrimaryBar');
    var pct = document.getElementById('upPrimaryPct');
    var lbl = document.getElementById('upPrimaryLabel');
    if (!bar || !pct) return;
    if (total > 0) {
      var p = Math.min(100, Math.round((loaded / total) * 100));
      bar.style.width = p + '%';
      pct.textContent = p + '% (' + (loaded / 1024 / 1024).toFixed(1) + ' MB / ' + (total / 1024 / 1024).toFixed(1) + ' MB)';
    }
    if (lbl && phase) lbl.textContent = phase;
  }

  function wireUpload() {
    var btn = document.getElementById('uploadPrimaryBtn');
    var input = document.getElementById('primaryFileInput');
    if (!btn || !input) return;
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Uploading...';
      _renderUploadProgress('start');
      _setUploadProgress(0, file.size, 'Uploading ' + file.name);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/ai-broll/upload-primary', true);
      xhr.upload.addEventListener('progress', function (ev) {
        if (ev.lengthComputable) {
          _setUploadProgress(ev.loaded, ev.total, 'Uploading ' + file.name);
        }
      });
      xhr.upload.addEventListener('load', function () {
        // Bytes are fully sent — server is now probing duration etc.
        _setUploadProgress(file.size, file.size, 'Processing on server...');
      });
      xhr.onerror = function () {
        toastMsg('Upload failed: network error');
        _renderUploadProgress('fail');
        btn.disabled = false; btn.textContent = orig; input.value = '';
      };
      xhr.onload = function () {
        btn.disabled = false; btn.textContent = orig; input.value = '';
        if (xhr.status < 200 || xhr.status >= 300) {
          var msg = 'Upload failed (' + xhr.status + ')';
          try { var ej = JSON.parse(xhr.responseText); if (ej && ej.error) msg = ej.error; } catch (_) {}
          toastMsg(msg);
          _renderUploadProgress('fail');
          return;
        }
        try {
          var data = JSON.parse(xhr.responseText);
          _renderUploadProgress('done');
          setPrimary(data);
        } catch (err) {
          toastMsg('Upload succeeded but response was malformed');
          _renderUploadProgress('fail');
        }
      };
      var fd = new FormData(); fd.append('video', file);
      xhr.send(fd);
    });
  }

  // ---- URL Import ----
  function wireURLImport() {
    var btn = document.getElementById('heroImportBtn');
    var input = document.getElementById('heroLinkInput');
    if (!btn || !input) return;
    async function run() {
      var url = (input.value || '').trim();
      if (!url) { toastMsg('Paste a link first'); return; }
      if (!/^https?:\\/\\//i.test(url)) { toastMsg('URL must start with http(s)://'); return; }
      if (!/(youtube\\.com|youtu\\.be|zoom\\.us|twitch\\.tv|rumble\\.com)/i.test(url)) {
        toastMsg('Only YouTube, Zoom, Twitch, and Rumble links are supported.'); return;
      }
      btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Importing…';
      try {
        var r = await fetch('/ai-broll/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url })
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || ('Import failed (' + r.status + ')'));
        if (!data.source) data.source = 'youtube';
        if (!data.sourceUrl) data.sourceUrl = url;
        setPrimary(data);
      } catch (err) {
        toastMsg('URL import failed: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    }
    btn.addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  }

  // ---- Picker config (cached) ----
  var _pickerCfgPromise = null;
  function getPickerConfig() {
    if (_pickerCfgPromise) return _pickerCfgPromise;
    _pickerCfgPromise = fetch('/ai-broll/picker-config').then(function (r) { return r.json(); });
    return _pickerCfgPromise;
  }

  // ---- Google Drive (Google Picker API) ----
  var _gapiReady = false;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true; s.dataset.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function initGoogle() {
    if (_gapiReady) return;
    await loadScript('https://apis.google.com/js/api.js');
    await loadScript('https://accounts.google.com/gsi/client');
    await new Promise(function (resolve) { gapi.load('picker', { callback: resolve }); });
    _gapiReady = true;
  }
  function pickFromGoogleDrive() {
    return new Promise(async function (resolve, reject) {
      try {
        var cfg = await getPickerConfig();
        var gd = cfg.googleDrive || {};
        if (!gd.clientId) return reject(new Error('Google Drive client ID not configured (GOOGLE_DRIVE_CLIENT_ID)'));
        if (!gd.apiKey) return reject(new Error('Google Picker API key not configured (GOOGLE_PICKER_API_KEY)'));
        await initGoogle();
        var tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: gd.clientId,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: function (tokenResp) {
            if (tokenResp.error) return reject(new Error(tokenResp.error));
            var accessToken = tokenResp.access_token;
            var view = new google.picker.View(google.picker.ViewId.DOCS_VIDEOS);
            var picker = new google.picker.PickerBuilder()
              .enableFeature(google.picker.Feature.NAV_HIDDEN)
              .setOAuthToken(accessToken)
              .setDeveloperKey(gd.apiKey)
              .addView(view)
              .setAppId(gd.appId || '')
              .setCallback(function (data) {
                if (data.action === google.picker.Action.PICKED) {
                  var doc = data.docs && data.docs[0];
                  if (!doc) return reject(new Error('No file returned from Picker'));
                  resolve({ fileId: doc.id, name: doc.name, accessToken: accessToken, sizeBytes: doc.sizeBytes });
                } else if (data.action === google.picker.Action.CANCEL) {
                  reject(new Error('cancelled'));
                }
              })
              .build();
            picker.setVisible(true);
          }
        });
        tokenClient.requestAccessToken();
      } catch (err) { reject(err); }
    });
  }
  function wireGoogleDrive() {
    var btn = document.getElementById('gdrivePrimaryBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Opening Drive…';
      try {
        var pick = await pickFromGoogleDrive();
        btn.textContent = 'Importing…';
        var r = await fetch('/ai-broll/googledrive-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pick)
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || ('Drive import failed (' + r.status + ')'));
        setPrimary(data);
      } catch (err) {
        if (err && err.message === 'cancelled') { /* user cancelled */ }
        else toastMsg('Google Drive: ' + (err.message || err));
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });
  }

  // ---- Dropbox Chooser ----
  function loadDropboxChooser(appKey) {
    return new Promise(function (resolve, reject) {
      if (window.Dropbox && window.Dropbox.choose) return resolve();
      var s = document.createElement('script');
      s.src = 'https://www.dropbox.com/static/api/2/dropins.js';
      s.id = 'dropboxjs';
      s.setAttribute('data-app-key', appKey);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Dropbox Dropins failed to load')); };
      document.head.appendChild(s);
    });
  }
  function wireDropbox() {
    var btn = document.getElementById('dropboxPrimaryBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Opening Dropbox…';
      try {
        var cfg = await getPickerConfig();
        var key = cfg.dropbox && cfg.dropbox.appKey;
        if (!key) throw new Error('Dropbox app key not configured (DROPBOX_CLIENT_ID)');
        await loadDropboxChooser(key);
        await new Promise(function (resolve, reject) {
          window.Dropbox.choose({
            linkType: 'direct',
            multiselect: false,
            extensions: ['video'],
            success: async function (files) {
              var f = files && files[0];
              if (!f) return reject(new Error('No file picked'));
              btn.textContent = 'Importing…';
              try {
                var r = await fetch('/ai-broll/dropbox-import', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: f.link, name: f.name })
                });
                var data = await r.json();
                if (!r.ok) throw new Error(data.error || ('Dropbox import failed (' + r.status + ')'));
                setPrimary(data);
                resolve();
              } catch (err) { reject(err); }
            },
            cancel: function () { resolve(); }
          });
        });
      } catch (err) {
        toastMsg('Dropbox: ' + (err.message || err));
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });
  }

  // ---- Create Project + redirect ----
  // Programmatic create-project flow — usable by both the button click and the
  // selection modal\'s "Confirm Selection" auto-redirect.
  async function createProjectAndOpenEditor(triggerBtn, options) {
    options = options || {};
    var newTab = !!options.newTab;
    var hasPrimary = !!(state.primary && state.primary.filename);
    var hasBroll = (state.broll || []).length > 0;
    if (!hasPrimary && !hasBroll) { toastMsg('Pick a primary video or at least one B-roll clip first'); return false; }
    var orig = triggerBtn ? triggerBtn.textContent : '';
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Creating project…'; }
    try {
      var r = await fetch('/ai-broll/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: state.primary || null, broll: state.broll })
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || ('create-project failed (' + r.status + ')'));
      var url = data.redirectTo || ('/video-editor/' + data.projectId);
      if (newTab) {
        window.open(url, '_blank');
        // Restore the trigger button so the page stays usable for another run.
        if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = orig; }
      } else {
        window.location.href = url;
      }
      return true;
    } catch (err) {
      toastMsg('Could not create project: ' + err.message);
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = orig; }
      return false;
    }
  }

  // Programmatic helper: import a YouTube/Zoom/Twitch/Rumble URL as the primary.
  async function importUrlAsPrimary(url) {
    if (!url) return false;
    var r = await fetch('/ai-broll/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });
    var data = await r.json();
    if (!r.ok) throw new Error(data.error || ('Import failed (' + r.status + ')'));
    if (!data.source) data.source = 'youtube';
    if (!data.sourceUrl) data.sourceUrl = url;
    setPrimary(data);
    return true;
  }

  window.__aiBrollOpenInEditor = function (opts) { return createProjectAndOpenEditor(null, opts || {}); };
  window.__aiBrollHasPrimary = function () { return !!(state && state.primary && state.primary.filename); };
  window.__aiBrollImportUrlAsPrimary = function (url) { return importUrlAsPrimary(url); };

  function wireCreateProject() {
    var btn = document.getElementById('createProjectBtn');
    if (!btn) return;
    btn.addEventListener('click', function () { createProjectAndOpenEditor(btn); });
  }

  // ---- Hook: stage selected B-roll clips for the project ----
  // The existing "Use This Clip" modal already calls /ai-broll/download-inline
  // via other code paths. We expose a helper the existing code can call.
  window.__aiBrollStageClip = function (clip) {
    if (!clip || !clip.filename) return;
    // Dedup by filename.
    if (state.broll.some(function (b) { return b.filename === clip.filename; })) return;
    state.broll.push({
      filename: clip.filename,
      name: clip.name || clip.filename,
      duration: clip.duration || 0,
      serveUrl: clip.serveUrl || ('/video-editor/download/' + clip.filename)
    });
    updateStagingCard();
    toastMsg('Added B-roll: ' + (clip.name || clip.filename));
  };

  function init() {
    wireUpload();
    wireURLImport();
    wireGoogleDrive();
    wireDropbox();
    wireCreateProject();
    updateStagingCard();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

      // Rotating placeholder for hero link input
      (function(){
        var heroInput = document.getElementById('heroLinkInput');
        if(!heroInput) return;
        var placeholders = ['Drop a YouTube link','Drop a Rumble link','Drop a Zoom link','Drop a Twitch link'];
        var idx = 0;
        setInterval(function(){
          idx = (idx + 1) % placeholders.length;
          heroInput.placeholder = placeholders[idx];
        }, 2500);
      })();
</script>
</body>
</html>`;

  res.send(html);
});

// Helper function to fetch videos from Pixabay
async function fetchPixabayVideos(searchTerms) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    return null; // Will use fallback
  }

  try {
    const response = await fetch(
      `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(searchTerms)}&per_page=10&safesearch=true`
    );
    const data = await response.json();
    return data.hits || [];
  } catch (error) {
    console.error('Pixabay API error:', error);
    return null;
  }
}

// Helper function to generate fallback B-Roll items
function generateFallbackItems(keywords, count = 5) {
  return Array.from({ length: Math.min(count, 5) }).map((_, idx) => ({
    id: `broll-${uuidv4().slice(0, 8)}`,
    name: `B-Roll Suggestion ${idx + 1}`,
    keywords: keywords.slice(Math.max(0, idx), Math.min(keywords.length, idx + 2)),
    duration: 5 + (idx * 2),
    thumbnailUrl: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='100'%3E%3Crect fill='%236C3AED' width='150' height='100'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='24'%3E%F0%9F%8E%�%3C/text%3E%3C/svg%3E`,
    videoPreviewUrl: '',
    videoDownloadUrl: '',
    artist: 'Pixabay',
    source: 'generated'
  }));
}

// Helper function to convert Pixabay data to our format
function formatPixabayVideos(pixabayHits) {
  return pixabayHits.slice(0, 5).map((hit) => {
    const thumbnailUrl = `https://i.vimeocdn.com/video/${hit.picture_id}_295x166.jpg`;
    const previewUrl = hit.videos.tiny?.url || hit.videos.small?.url || '';
    const downloadUrl = hit.videos.medium?.url || hit.videos.small?.url || '';

    return {
      id: `broll-${hit.id}`,
      name: hit.tags ? hit.tags.split(',')[0].trim() : 'B-Roll Video',
      keywords: hit.tags ? hit.tags.split(',').map(t => t.trim()).slice(0, 3) : [],
      duration: Math.ceil(hit.duration),
      thumbnailUrl,
      videoPreviewUrl: previewUrl,
      videoDownloadUrl: downloadUrl,
      artist: hit.user || 'Pixabay User',
      source: 'pixabay'
    };
  });
}

// POST - Generate B-roll
router.post('/generate', requireAuth, requireCredits('ai-broll'), upload.single('video'), async (req, res) => {
  try {
    const { inputType, url, mode, prompt } = req.body;

    if (!mode) {
      return res.status(400).json({ error: 'Please select a B-roll mode' });
    }

    let contentDescription = '';
    // The new ingestion flow stages files server-side via /upload-primary,
    // /import-url, /googledrive-import, /dropbox-import — so /generate may
    // get JSON with body.primary.filename referring to an already-staged file.
    // Accept that as a valid content source.
    if (req.file) {
      contentDescription = `Video file: ${req.file.originalname}`;
    } else if (inputType === 'youtube' && url) {
      contentDescription = `YouTube video: ${url}`;
    } else if (req.body && req.body.primary && req.body.primary.filename) {
      contentDescription = `Staged video: ${req.body.primary.originalName || req.body.primary.filename}`;
    } else if (prompt) {
      contentDescription = prompt;
    } else {
      return res.status(400).json({ error: 'No content provided' });
    }

    let brollItems = [];
    let pixabayWarning = null;
    const pixabayApiKey = process.env.PIXABAY_API_KEY;

    if (mode === 'ai-generated') {
      // ─── Smart pipeline: build context (transcript or YouTube meta), then ask GPT-4o-mini
      //     for concrete Pixabay queries (Smart-Shorts-style prompt). ─────────────────────
      let stagedFilePath = null;
      if (req.file && req.file.path) {
        stagedFilePath = req.file.path;
      } else if (req.body && req.body.primary && req.body.primary.filename) {
        stagedFilePath = resolveStagedFile(req.body.primary.filename);
      }

      const youtubeUrl = (inputType === 'youtube' && url) ? url : null;
      const originalName = (req.file && req.file.originalname)
        || (req.body && req.body.primary && (req.body.primary.originalName || req.body.primary.filename))
        || '';

      const ctx = await buildBrollContext({
        filePath: stagedFilePath,
        youtubeUrl,
        originalName
      });

      // If user typed a hint in the prompt box, append it (helps when transcript is sparse).
      const ctxForPrompt = {
        title: ctx.title || (prompt || ''),
        transcript: (ctx.transcript || '') + (prompt ? ('\n\nUSER HINT: ' + prompt) : '')
      };
      const debugCtx = {
        contextSource: ctx.source,
        title: ctxForPrompt.title,
        transcriptChars: (ctx.transcript || '').length
      };

      const scenes = await generateSmartBrollQueries(ctxForPrompt);

      // Build response items: one Pixabay match per scene.
      const useScenes = scenes.length > 0
        ? scenes.slice(0, 5)
        : [{ moment: 'Video enhancement', search_query: prompt || ctxForPrompt.title || 'video', duration: 5 }];

      if (pixabayApiKey) {
        for (const scene of useScenes) {
          const q = (scene.search_query || scene.scene_description || scene.moment || 'video').toString();
          const videos = await fetchPixabayVideos(q);
          if (videos && videos.length > 0) {
            const formatted = formatPixabayVideos(videos);
            const item = formatted[0];
            // Decorate with the AI-generated context so the modal can show why.
            item.searchQueryUsed = q;
            item.sceneDescription = scene.scene_description || '';
            item.moment = scene.moment || scene.timestamp_hint || '';
            item.timestamp_hint = scene.timestamp_hint || scene.moment || 'middle';
            item.why = scene.why || '';
            // Expose up to 3 alternatives so the Swap Scene drawer has options.
            item.alternatives = formatted.slice(1, 4).map(function (a) { return {
              id: a.id, name: a.name, thumbnailUrl: a.thumbnailUrl,
              videoPreviewUrl: a.videoPreviewUrl, videoDownloadUrl: a.videoDownloadUrl,
              duration: a.duration, artist: a.artist
            }; });
            brollItems.push(item);
          } else {
            const fb = generateFallbackItems([q], 1)[0];
            fb.searchQueryUsed = q;
            fb.sceneDescription = scene.scene_description || '';
            fb.moment = scene.moment || scene.timestamp_hint || '';
            fb.timestamp_hint = scene.timestamp_hint || scene.moment || 'middle';
            fb.why = scene.why || '';
            fb.alternatives = [];
            brollItems.push(fb);
          }
        }
      } else {
        const all = useScenes.map(s => s.search_query || s.moment).filter(Boolean);
        brollItems = generateFallbackItems(all);
        pixabayWarning = 'Pixabay API key not configured. Showing placeholder suggestions. Set PIXABAY_API_KEY environment variable to fetch real videos.';
      }

      // Surface debug info so we can verify on dev that transcript actually came through.
      if (process.env.NODE_ENV !== 'production' || req.query.debug === '1') {
        res.locals = res.locals || {};
        res.locals.brollDebug = debugCtx;
      }
    } else if (mode === 'stock') {
      // Stock mode: use user's search terms directly
      const searchTerms = prompt || 'stock footage';

      if (pixabayApiKey) {
        const videos = await fetchPixabayVideos(searchTerms);

        if (videos && videos.length > 0) {
          brollItems = formatPixabayVideos(videos);
        } else {
          brollItems = generateFallbackItems([searchTerms], 5);
          pixabayWarning = 'No videos found for your search. Showing suggestions instead.';
        }
      } else {
        brollItems = generateFallbackItems([searchTerms], 5);
        pixabayWarning = 'Pixabay API key not configured. Showing placeholder suggestions. Set PIXABAY_API_KEY environment variable to fetch real videos.';
      }
    }

    const response = { brollItems };
    if (pixabayWarning) {
      response.pixabayWarning = pixabayWarning;
    }
    if (res.locals && res.locals.brollDebug) {
      response._debug = res.locals.brollDebug;
    }

    res.json(response);
    featureUsageOps.log(req.user.id, 'ai_broll').catch(() => {});
  } catch (error) {
    console.error('AI B-Roll error:', error);
    res.status(500).json({ error: 'Failed to generate B-roll' });
  }
});

// POST - Apply B-roll
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { videoPath, brollItems } = req.body;

    if (!videoPath || !brollItems || !Array.isArray(brollItems)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video file not found' });
    }

    const outputPath = path.join(outputDir, `broll-applied-${uuidv4()}.mp4`);

    // For now, just copy the file (in production, would overlay B-roll with FFmpeg)
    fs.copyFileSync(videoPath, outputPath);

    res.json({
      success: true,
      outputPath,
      downloadUrl: `/api/download/${path.basename(outputPath)}`
    });
  } catch (error) {
    console.error('Apply B-roll error:', error);
    res.status(500).json({ error: 'Failed to apply B-roll' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Task #37 — POST /ai-broll/search-inline
// Lightweight Pixabay search that returns a list of previewable clips.
// Used by the editor's in-place B-Roll modal (no new-window redirect).
// Body: { query: string, max?: int (default 12) }
// Returns: { success, results: [{id, name, thumbnailUrl, previewUrl,
//   downloadUrl, duration}] }
// ═════════════════════════════════════════════════════════════════════
router.post('/search-inline', requireAuth, async (req, res) => {
  try {
    const q = String((req.body || {}).query || '').trim().slice(0, 80);
    // The display cap (max) is what we hand back to the client. Pixabay's
    // own per_page param has a hard minimum of 3 — passing 1 or 2 returns
    // a 400 — so we always request at least 3 from the API and slice
    // down to `max` afterwards. This keeps the transcript-tooltip flow
    // (which asks for 2) working without a server-side error.
    const max = Math.max(1, Math.min(24, parseInt((req.body || {}).max, 10) || 12));
    const perPage = Math.max(3, Math.min(200, max));
    if (!q){
      return res.status(400).json({ error: 'query required' });
    }
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey){
      return res.status(500).json({
        error: 'Stock library not configured. Set PIXABAY_API_KEY.'
      });
    }
    const url = 'https://pixabay.com/api/videos/?key=' + apiKey +
                '&q=' + encodeURIComponent(q) +
                '&per_page=' + perPage +
                '&safesearch=true';
    const r = await fetch(url);
    if (!r.ok){
      // Surface a useful error body when Pixabay rejects (typically a
      // bad/expired key, malformed query, or per_page out of range).
      let body = '';
      try { body = await r.text(); } catch(_){}
      throw new Error('Pixabay error ' + r.status + (body ? (': ' + body.slice(0, 200)) : ''));
    }
    const data = await r.json();
    const results = (data.hits || []).slice(0, max).map(function(hit){
      const vids = hit.videos || {};
      return {
        id: 'pxb-' + hit.id,
        name: hit.tags ? hit.tags.split(',')[0].trim() : 'B-Roll',
        keywords: hit.tags ? hit.tags.split(',').slice(0, 3).map(s => s.trim()) : [],
        duration: hit.duration || 0,
        thumbnailUrl: hit.picture_id ? ('https://i.vimeocdn.com/video/' + hit.picture_id + '_295x166.jpg') : '',
        previewUrl:   (vids.tiny   && vids.tiny.url)   || (vids.small && vids.small.url) || '',
        downloadUrl:  (vids.medium && vids.medium.url) || (vids.small && vids.small.url) || (vids.tiny && vids.tiny.url) || '',
        width:  ((vids.medium && vids.medium.width)   || (vids.small && vids.small.width)  || 0),
        height: ((vids.medium && vids.medium.height)  || (vids.small && vids.small.height) || 0),
        artist: hit.user || 'Pixabay'
      };
    });
    res.json({ success: true, results: results });
  } catch (err){
    console.error('[ai-broll search-inline]', err);
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Task #74 — POST /ai-broll/analyze-segments
// Runs Whisper on the source video to get a word-level transcript, then
// asks GPT to identify 3-6 short transcript segments where a B-Roll
// cut-away would best enhance the video. Each suggestion carries the
// timeline-aligned start/end seconds, the highlighted text, and a
// Pixabay search query the editor uses to fetch two preview clips on
// demand when the user clicks the highlight.
//   Body: { mediaUrl }
//   Returns: { success, chunks, suggestions, duration }
// ═════════════════════════════════════════════════════════════════════
router.post('/analyze-segments', requireAuth, async (req, res) => {
  try {
    if (!ffmpegPath){
      return res.status(500).json({ error: 'FFmpeg is not available on this server' });
    }
    if (!process.env.OPENAI_API_KEY){
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    }

    var mediaUrl = String((req.body || {}).mediaUrl || '');
    var m = /\/video-editor\/download\/([^?#]+)/.exec(mediaUrl);
    var filename = m ? decodeURIComponent(m[1]) : null;
    if (!filename){
      return res.status(400).json({ error: 'mediaUrl must reference an uploaded video' });
    }
    var srcPath = path.join(uploadDir, path.basename(filename));
    if (!fs.existsSync(srcPath)){
      var alt = path.join(outputDir, path.basename(filename));
      if (fs.existsSync(alt)) srcPath = alt;
      else return res.status(404).json({ error: 'Source video not found on server. Upload via the sidebar first.' });
    }

    // 1. Extract mono 16kHz MP3 for Whisper (small + fast).
    var mp3Path = path.join(uploadDir, 'broll_seg_' + Date.now() + '_' + req.user.id + '.mp3');
    await new Promise(function(resolve, reject){
      var p = spawn(ffmpegPath, [
        '-fflags', '+genpts',
        '-i', srcPath,
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
        '-ss', '0',
        '-af', 'aresample=async=1:first_pts=0',
        '-avoid_negative_ts', 'make_zero',
        '-map_metadata', '-1',
        '-reset_timestamps', '1',
        '-y', mp3Path
      ]);
      var stderr = '';
      p.stderr.on('data', function(d){ stderr += d.toString(); });
      p.on('close', function(code){
        if (code === 0) resolve();
        else reject(new Error('Audio extract failed: ' + stderr.slice(-200)));
      });
      p.on('error', reject);
    });

    // 2. Whisper word-level transcription.
    var transcript;
    try {
      var audioBuffer = fs.readFileSync(mp3Path);
      var file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' });
      transcript = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: file,
        response_format: 'verbose_json',
        timestamp_granularities: ['word']
      });
    } finally {
      try { fs.unlinkSync(mp3Path); } catch(_){}
    }

    // 3. Group words into ~6-word phrase chunks (slightly larger than the
    //    caption flow's 4-word so each chunk reads as a sentence fragment
    //    — better signal for GPT picking B-Roll candidates).
    var words = (transcript && Array.isArray(transcript.words)) ? transcript.words : [];
    var CHUNK_SIZE = 6;
    var GAP_BREAK  = 0.6;
    var chunks = [];
    var buf = [];
    function flush(){
      if (!buf.length) return;
      chunks.push({
        text:  buf.map(function(w){ return w.word; }).join(' ').replace(/\s+/g, ' ').trim(),
        start: +buf[0].start.toFixed(3),
        end:   +buf[buf.length - 1].end.toFixed(3)
      });
      buf = [];
    }
    for (var k = 0; k < words.length; k++){
      var w = words[k];
      if (buf.length){
        var prev = buf[buf.length - 1];
        if ((w.start - prev.end) > GAP_BREAK) flush();
      }
      buf.push(w);
      if (buf.length >= CHUNK_SIZE) flush();
    }
    flush();

    // Fallback: if Whisper returned no word-level data, split the plain
    // text by sentence so the UI still has something to work with.
    if (chunks.length === 0 && transcript && transcript.text){
      var totalDur = transcript.duration || 30;
      var parts = String(transcript.text).split(/(?<=[.?!])\s+/).slice(0, 30);
      var perPart = totalDur / Math.max(1, parts.length);
      parts.forEach(function(p, i){
        chunks.push({ text: p.trim(), start: +(i * perPart).toFixed(3), end: +((i + 1) * perPart).toFixed(3) });
      });
    }

    // 4. Ask GPT-4o-mini to pick the 3-6 chunks where a B-Roll cut-away
    //    would visually enhance the video, plus a Pixabay search query
    //    for each. The chunk-index pointer keeps suggestions perfectly
    //    aligned with the rendered transcript on the client.
    var indexedChunks = chunks.map(function(c, i){
      return '[' + i + '] (' + c.start.toFixed(2) + 's-' + c.end.toFixed(2) + 's) ' + c.text;
    }).join('\n');
    var sysPrompt = [
      'You are a professional video editor selecting B-roll insert points for an existing talking-head video.',
      'You are given a numbered list of timestamped transcript chunks. Pick 3 to 6 chunks where a 3-6s',
      'B-roll cut-away would VISUALLY enhance the moment.',
      '',
      'For EACH pick, return:',
      '  "index":   the chunk number from the list',
      '  "query":   a 2-4 word concrete Pixabay search query that visually represents the moment.',
      '             Use literal nouns + actions (e.g. "person typing laptop", "city skyline drone"),',
      '             NEVER abstract terms like "success", "growth", "innovation", "technology".',
      '  "reason":  one short sentence explaining why this moment benefits from B-roll.',
      '',
      'Rules:',
      '- Pick chunks that contain CONCRETE visual concepts (objects, places, actions).',
      '- Skip filler chunks (greetings, "uh you know", repeated transitions).',
      '- Space picks across the timeline — avoid stacking 3 picks in the first 10 seconds.',
      '- Return ONLY valid JSON: { "suggestions": [ ... ] }. No prose.'
    ].join('\n');
    var userPrompt = 'TRANSCRIPT CHUNKS:\n' + indexedChunks;

    var suggestions = [];
    try {
      var completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user',   content: userPrompt }
        ],
        temperature: 0.4,
        max_tokens: 700,
        response_format: { type: 'json_object' }
      });
      var rawOut = (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '{}';
      var parsed = JSON.parse(rawOut);
      var arr = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      arr.forEach(function(s){
        var idx = parseInt(s && s.index, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunks.length) return;
        var c = chunks[idx];
        var q = String((s && s.query) || '').trim().slice(0, 60);
        if (!q) return;
        suggestions.push({
          chunkIndex: idx,
          startSec:   c.start,
          endSec:     c.end,
          text:       c.text,
          query:      q,
          reason:     String((s && s.reason) || '').slice(0, 200)
        });
      });
    } catch (gptErr){
      console.warn('[ai-broll analyze-segments] GPT pick failed; returning empty suggestions:', gptErr.message);
    }

    try { featureUsageOps.log(req.user.id, 'broll_analyze_segments').catch(function(){}); } catch(_){}

    res.json({
      success:     true,
      chunks:      chunks,
      suggestions: suggestions,
      duration:    transcript.duration || 0
    });
  } catch (err){
    console.error('[ai-broll analyze-segments] error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Task #37 — POST /ai-broll/download-inline
// Given a Pixabay video URL from search-inline, downloads it server-side
// to the video-editor uploads dir so the editor can insert it as a V1
// clip via its normal /video-editor/download/<name> path.
// Body: { videoUrl: string, name?: string }
// Returns: { success, mediaUrl, filename, duration }
// ═════════════════════════════════════════════════════════════════════
router.post('/download-inline', requireAuth, async (req, res) => {
  try {
    const videoUrl = String((req.body || {}).videoUrl || '');
    if (!videoUrl.startsWith('https://')){
      return res.status(400).json({ error: 'videoUrl must be https://' });
    }
    const veUploadDir = path.join('/tmp', 'repurpose-uploads');
    if (!fs.existsSync(veUploadDir)) fs.mkdirSync(veUploadDir, { recursive: true });
    const safeName = ((req.body || {}).name || 'broll').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    const outName = 'broll_' + safeName + '_' + Date.now() + '_' + uuidv4().slice(0, 8) + '.mp4';
    const outPath = path.join(veUploadDir, outName);

    // Download via node https
    await new Promise(function(resolve, reject){
      const fetchUrl = (u) => new Promise((innerResolve, innerReject) => {
        https.get(u, function(resp){
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location){
            resp.resume();
            innerResolve(fetchUrl(resp.headers.location));
            return;
          }
          if (resp.statusCode !== 200){
            innerReject(new Error('HTTP ' + resp.statusCode));
            return;
          }
          const ws = fs.createWriteStream(outPath);
          resp.pipe(ws);
          ws.on('finish', function(){ ws.close(); innerResolve(); });
          ws.on('error', innerReject);
        }).on('error', innerReject);
      });
      fetchUrl(videoUrl).then(resolve).catch(reject);
    });

    // Probe duration
    var duration = 0;
    if (ffmpegPath){
      try {
        const ffprobeLocal = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
        const probeOut = await new Promise(function(resolve){
          let out = '';
          const p = spawn(ffprobeLocal, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            outPath
          ]);
          p.stdout.on('data', d => out += d.toString());
          p.on('close', () => resolve(out));
          p.on('error', () => resolve(''));
        });
        duration = parseFloat(probeOut.trim()) || 0;
      } catch(_){}
    }

    res.json({
      success: true,
      mediaUrl: '/video-editor/download/' + outName,
      filename: outName,
      duration: duration
    });
  } catch (err){
    console.error('[ai-broll download-inline]', err);
    res.status(500).json({ error: err.message || 'Download failed' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Media Ingestion Endpoints — added for AI B-Roll → Video Editor handoff
// These accept a "primary video" from any of 4 sources (local upload, URL
// import, Google Drive picker, Dropbox chooser) and stage it in the shared
// upload dir so the video-editor can serve it via /video-editor/download/*.
// They also expose a picker-config endpoint and a create-project endpoint
// that writes to the projects table and returns a project_id.
// ═══════════════════════════════════════════════════════════════════════════

// Shared upload dir (same as video-editor) so the /video-editor/download/:filename
// handler can serve files regardless of which route ingested them.
const sharedUploadDir = path.join('/tmp', 'repurpose-uploads');
if (!fs.existsSync(sharedUploadDir)) fs.mkdirSync(sharedUploadDir, { recursive: true });

// Helper: get duration of a file on disk using ffprobe / ffmpeg stderr.
async function getMediaDuration(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  // Try ffprobe
  try {
    const probeOut = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 8000 }
    ).toString().trim();
    const d = parseFloat(probeOut);
    if (isFinite(d) && d > 0) return d;
  } catch (_) {}
  // Fallback: parse ffmpeg stderr
  if (!ffmpegPath) return 0;
  try {
    const out = await new Promise(resolve => {
      const p = spawn(ffmpegPath, ['-i', filePath, '-f', 'null', '-t', '0', '-']);
      let stderr = '';
      p.stderr.on('data', d => stderr += d.toString());
      p.on('close', () => resolve(stderr));
      p.on('error', () => resolve(''));
    });
    const m = out.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) {
      return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
    }
  } catch (_) {}
  return 0;
}

// Helper: download a remote URL to the shared upload dir.
// Follows a limited number of redirects. Returns the resolved file path.
function downloadToShared(urlStr, suggestedExt, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const outName = 'ing_' + Date.now() + '_' + uuidv4().slice(0, 8) + (suggestedExt || '.mp4');
    const outPath = path.join(sharedUploadDir, outName);
    const http = require('http');
    let redirectsLeft = 5;
    function hit(targetUrl) {
      let parsed;
      try { parsed = new URL(targetUrl); } catch (e) { return reject(new Error('Invalid URL')); }
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(targetUrl, { headers: extraHeaders }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          if (--redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          const next = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          return hit(next);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error('Upstream returned ' + res.statusCode));
        }
        const file = fs.createWriteStream(outPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve({ outPath, outName })));
        file.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error('Download timed out')));
    }
    hit(urlStr);
  });
}

// GET /ai-broll/picker-config — public-ish (requires auth) config for the
// Google Picker and Dropbox Chooser SDKs. Only returns the public-safe keys.
router.get('/picker-config', requireAuth, (req, res) => {
  res.json({
    googleDrive: {
      clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || '',
      apiKey: process.env.GOOGLE_PICKER_API_KEY || process.env.GOOGLE_DRIVE_API_KEY || '',
      appId: process.env.GOOGLE_PICKER_APP_ID || ''
    },
    dropbox: {
      appKey: process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID || ''
    }
  });
});

// POST /ai-broll/upload-primary — receives a local file upload and stages it
// in the shared upload dir. Returns { filename, duration, serveUrl }.
router.post('/upload-primary', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    // Move from multer's tmp dir to the shared dir with a clean name.
    const ext = path.extname(req.file.originalname || '.mp4') || '.mp4';
    const outName = 'prim_' + Date.now() + '_' + uuidv4().slice(0, 8) + ext;
    const outPath = path.join(sharedUploadDir, outName);
    fs.renameSync(req.file.path, outPath);
    const duration = await getMediaDuration(outPath);
    res.json({
      filename: outName,
      originalName: req.file.originalname,
      duration,
      serveUrl: '/video-editor/download/' + outName,
      source: 'upload'
    });
  } catch (err) {
    console.error('[ai-broll upload-primary]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// POST /ai-broll/import-url — validates a YouTube/Zoom/Twitch/Rumble URL and
// downloads it via yt-dlp to the shared upload dir. Mirrors video-editor's
// /youtube-import logic so the two ingestion paths share behaviour.
router.post('/import-url', requireAuth, async (req, res) => {
  try {
    const url = String((req.body || {}).url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const valid = [/youtube\.com/i, /youtu\.be/i, /zoom\.us/i, /twitch\.tv/i, /rumble\.com/i].some(p => p.test(url));
    if (!valid) return res.status(400).json({ error: 'Unsupported URL. Supported: YouTube, Zoom, Twitch, Rumble.' });

    let ytdlpPath = 'yt-dlp';
    try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (_) {
      try { execSync('pip install --break-system-packages yt-dlp', { stdio: 'pipe' }); } catch (_) {
        try { execSync('pip install yt-dlp', { stdio: 'pipe' }); } catch (_) {
          return res.status(500).json({ error: 'yt-dlp not available on this server' });
        }
      }
    }

    const outName = 'url_' + Date.now() + '_' + uuidv4().slice(0, 8) + '.mp4';
    const outPath = path.join(sharedUploadDir, outName);

    const isYoutube = /youtube\.com|youtu\.be/i.test(url);

    // ─── YouTube: use the same 10-client fallback chain that /video-editor/youtube-import
    //     uses, with bgutil-pot extractor args + browser UA. Without these YouTube
    //     bot-blocks Railway IPs and demands cookies. ─────────────────────────
    const COMMON_ARGS = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outPath,
      '--max-filesize', '500m',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--retries', '5',
      '--extractor-retries', '5',
      '--fragment-retries', '5',
      '--sleep-interval', '1',
      '--max-sleep-interval', '3'
    ];

    let cookiesArgs = [];
    const cookiesPath = process.env.YT_COOKIES_PATH;
    if (cookiesPath && fs.existsSync(cookiesPath)) cookiesArgs = ['--cookies', cookiesPath];

    function runYtdlpOnce(extraArgs) {
      const args = COMMON_ARGS.concat(extraArgs || []).concat(cookiesArgs).concat(getYoutubeProxyArgs()).concat([url]);
      return new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
          if (code === 0 && fs.existsSync(outPath)) resolve();
          else reject(new Error(stderr.slice(-1500) || 'yt-dlp exit code ' + code));
        });
        proc.on('error', reject);
      });
    }

    if (isYoutube) {
      // 10-client fallback chain (matches /video-editor/youtube-import).
      const CLIENT_ATTEMPTS = ['ios', 'ios_music', 'tv', 'tv_embedded', 'android', 'android_vr', 'mweb', 'web_safari', 'web_creator', 'web'];
      let lastErr = null;
      const tried = [];
      let success = false;
      for (const client of CLIENT_ATTEMPTS) {
        try {
          await runYtdlpOnce(['--extractor-args', 'youtube:player_client=' + client]);
          tried.push(client + ' OK');
          success = true;
          break;
        } catch (e) {
          lastErr = e;
          tried.push(client + ' fail');
          try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
        }
      }
      if (!success) {
        // ─── Fallback: try @distube/ytdl-core (different signing path, sometimes
        //     escapes YouTube's bot detection when yt-dlp is locked out).
        if (__ytdl) {
          try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
          try {
            console.log('[ai-broll] yt-dlp failed all clients, trying ytdl-core fallback for ' + url);
            await new Promise((resolve, reject) => {
              const ws = fs.createWriteStream(outPath);
              const stream = __ytdl(url, { quality: 'highest', filter: 'audioandvideo' });
              stream.on('error', (err) => { ws.destroy(); reject(err); });
              ws.on('finish', () => resolve());
              ws.on('error', (err) => reject(err));
              stream.pipe(ws);
              setTimeout(() => {
                try { stream.destroy(); } catch (_) {}
                try { ws.destroy(); } catch (_) {}
                reject(new Error('ytdl-core download timed out'));
              }, 180000);
            });
            if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
              success = true;
              tried.push('ytdl-core OK');
              console.log('[ai-broll] ytdl-core fallback succeeded');
            } else {
              tried.push('ytdl-core empty');
              try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
            }
          } catch (e2) {
            tried.push('ytdl-core fail');
            lastErr = e2;
            console.log('[ai-broll] ytdl-core fallback failed:', e2.message);
            try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
          }
        }
      }
      if (!success) {
        let msg = 'YouTube blocked this server (' + tried.join(', ') + ').';
        if (!cookiesPath) {
          msg += ' This Railway IP is bot-rate-limited by YouTube and our backup downloader also failed. ' +
                 'Quickest workaround: switch to Upload mode and pick the file from your computer. ' +
                 'Permanent fix: set the YT_COOKIES_PATH env var to a Netscape cookies.txt exported from a logged-in browser.';
        } else {
          msg += ' Even with cookies, every player client failed. The cookies file may be expired \u2014 re-export from a logged-in browser.';
        }
        if (lastErr && lastErr.message) msg += ' Last error: ' + lastErr.message.slice(0, 400);
        throw new Error(msg);
      }
    } else {
      // Zoom / Twitch / Rumble — these don't bot-block Railway, simple call works.
      await runYtdlpOnce([]);
    }

    const duration = await getMediaDuration(outPath);
    res.json({
      filename: outName,
      duration,
      serveUrl: '/video-editor/download/' + outName,
      source: 'url',
      sourceUrl: url
    });
  } catch (err) {
    console.error('[ai-broll import-url]', err);
    res.status(500).json({ error: err.message || 'URL import failed' });
  }
});

// POST /ai-broll/googledrive-import — downloads a file the user picked with
// Google Picker. Body: { fileId, name, accessToken }. We trust the token the
// Picker returned client-side rather than looking up stored OAuth, because
// Picker flows run with a just-minted token.
router.post('/googledrive-import', requireAuth, async (req, res) => {
  try {
    const { fileId, name, accessToken } = req.body || {};
    if (!fileId) return res.status(400).json({ error: 'fileId is required' });
    if (!accessToken) return res.status(400).json({ error: 'accessToken is required (Google Picker must return one)' });
    const safeName = String(name || 'gdrive').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
    const ext = path.extname(safeName) || '.mp4';
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const { outName, outPath } = await downloadToShared(url, ext, {
      Authorization: 'Bearer ' + accessToken
    });
    const duration = await getMediaDuration(outPath);
    res.json({
      filename: outName,
      originalName: safeName,
      duration,
      serveUrl: '/video-editor/download/' + outName,
      source: 'googledrive'
    });
  } catch (err) {
    console.error('[ai-broll googledrive-import]', err);
    res.status(500).json({ error: err.message || 'Google Drive import failed' });
  }
});

// POST /ai-broll/dropbox-import — accepts a Dropbox direct link (returned by
// Dropbox Chooser with linkType:"direct") and downloads it server-side.
router.post('/dropbox-import', requireAuth, async (req, res) => {
  try {
    const { url, name } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Dropbox URL is required' });
    const safeName = String(name || 'dropbox').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
    const ext = path.extname(safeName) || '.mp4';
    const { outName, outPath } = await downloadToShared(url, ext);
    const duration = await getMediaDuration(outPath);
    res.json({
      filename: outName,
      originalName: safeName,
      duration,
      serveUrl: '/video-editor/download/' + outName,
      source: 'dropbox'
    });
  } catch (err) {
    console.error('[ai-broll dropbox-import]', err);
    res.status(500).json({ error: err.message || 'Dropbox import failed' });
  }
});

// POST /ai-broll/create-project — persists primary + broll selections and
// returns the new project_id. Client redirects to /video-editor/<id>.
router.post('/create-project', requireAuth, async (req, res) => {
  try {
    const { projectOps } = require('../db/database');
    const body = req.body || {};
    const primary = body.primary || {};
    const broll = Array.isArray(body.broll) ? body.broll.filter(b => b && b.filename) : [];
    if (!primary.filename && broll.length === 0) {
      return res.status(400).json({ error: 'A primary video or at least one B-roll clip is required to create a project' });
    }
    const project = await projectOps.create(req.user.id, {
      name: body.name || 'AI B-Roll Project',
      primaryFilename: primary.filename,
      primaryDuration: primary.duration || 0,
      primaryServeUrl: primary.serveUrl || ('/video-editor/download/' + primary.filename),
      broll,
      sourceHint: primary.source || null,
      metadata: { createdFrom: 'ai-broll', primaryOriginalName: primary.originalName || null }
    });
    res.json({
      projectId: project.id,
      redirectTo: '/video-editor/' + project.id
    });
  } catch (err) {
    console.error('[ai-broll create-project]', err);
    res.status(500).json({ error: err.message || 'Failed to create project' });
  }
});


// ═════════════════════════════════════════════════════════════════════
// POST /ai-broll/render-with-broll
// Splice selected B-roll clips into the primary video and produce a single
// downloadable mp4. Returns immediately with a filename + statusUrl; the
// actual ffmpeg work runs in the background. Client polls /render-status.
// Body: { primary: {filename}, brollScenes: [{videoUrl, position, duration, insertSec?}] }
// ═════════════════════════════════════════════════════════════════════
router.post('/render-with-broll', requireAuth, async (req, res) => {
  try {
    if (!ffmpegPath) {
      return res.status(503).json({ error: 'ffmpeg not available on this server' });
    }
    var body = req.body || {};
    var primary = body.primary || {};
    var brollScenes = Array.isArray(body.brollScenes) ? body.brollScenes : [];
    if (!primary.filename) return res.status(400).json({ error: 'primary.filename is required' });
    if (brollScenes.length === 0) return res.status(400).json({ error: 'At least one B-roll scene is required' });

    var primaryPath = resolveStagedFile(primary.filename);
    if (!primaryPath || !fs.existsSync(primaryPath)) {
      return res.status(404).json({ error: 'Primary video not found on server. Re-import it and try again.' });
    }

    var safeName = String(primary.originalName || 'video').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30);
    var filename = safeName + '_broll_' + Date.now() + '.mp4';
    var outputPath = path.join(outputDir, filename);
    var progressPath = outputPath + '.progress';

    function writeProgress(msg) { try { fs.writeFileSync(progressPath, msg); } catch (_) {} }
    function writeError(msg) {
      try { fs.unlinkSync(progressPath); } catch (_) {}
      try { fs.unlinkSync(outputPath); } catch (_) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch (_) {}
    }

    // Respond immediately so the client can start polling.
    res.json({
      success: true,
      status: 'processing',
      filename: filename,
      statusUrl: '/ai-broll/render-status/' + encodeURIComponent(filename),
      downloadUrl: '/video-editor/download/' + filename
    });

    // ─── Background ffmpeg pipeline ───
    (async function () {
      var tempFiles = [];
      var timeoutHandle = setTimeout(function () { writeError('Timed out after 12 minutes'); }, 12 * 60 * 1000);

      function runFFmpeg(args, timeoutMs) {
        return new Promise(function (resolve, reject) {
          var proc = spawn(ffmpegPath, args);
          var stderr = '';
          proc.stderr.on('data', function (d) {
            stderr += d.toString();
            var m = d.toString().match(/time=(\d+:\d+:\d+)/);
            if (m) writeProgress('Encoding: ' + m[1]);
          });
          proc.on('error', reject);
          proc.on('close', function (code) {
            if (code === 0) resolve();
            else reject(new Error('ffmpeg exit ' + code + ': ' + stderr.slice(-400)));
          });
          if (timeoutMs) setTimeout(function () { try { proc.kill('SIGKILL'); } catch (_) {} reject(new Error('ffmpeg timed out')); }, timeoutMs);
        });
      }

      function ffprobe(filePath) {
        return new Promise(function (resolve) {
          var ffprobeBin = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
          var p = spawn(ffprobeBin, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height : format=duration',
            '-of', 'json', filePath
          ]);
          var out = '';
          p.stdout.on('data', function (d) { out += d.toString(); });
          p.on('close', function () {
            try {
              var j = JSON.parse(out);
              var s = (j.streams && j.streams[0]) || {};
              var f = j.format || {};
              resolve({
                width: parseInt(s.width, 10) || 1920,
                height: parseInt(s.height, 10) || 1080,
                duration: parseFloat(f.duration) || 0
              });
            } catch (_) { resolve({ width: 1920, height: 1080, duration: 0 }); }
          });
          p.on('error', function () { resolve({ width: 1920, height: 1080, duration: 0 }); });
        });
      }

      try {
        // STEP 1: probe primary to learn resolution + duration
        writeProgress('Reading primary video...');
        var meta = await ffprobe(primaryPath);
        var W = meta.width, H = meta.height, primaryDur = meta.duration;
        if (primaryDur < 1) throw new Error('Primary video has no readable duration');

        // STEP 2: download + reformat each B-roll clip
        writeProgress('Downloading B-roll clips...');
        var brollSegments = [];
        for (var i = 0; i < brollScenes.length; i++) {
          var scene = brollScenes[i];
          var url = scene.videoUrl || scene.videoDownloadUrl || scene.videoPreviewUrl;
          if (!url) continue;
          writeProgress('Downloading B-roll ' + (i + 1) + '/' + brollScenes.length + '...');
          var rawPath = outputPath + '.broll_raw_' + i + '.mp4';
          var fmtPath = outputPath + '.broll_fmt_' + i + '.mp4';
          tempFiles.push(rawPath, fmtPath);
          try {
            // Download via https (follow redirects)
            await new Promise(function (resolve, reject) {
              function fetchUrl(u, depth) {
                if (depth > 5) return reject(new Error('Too many redirects'));
                https.get(u, function (resp) {
                  if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                    resp.resume();
                    return fetchUrl(resp.headers.location, depth + 1);
                  }
                  if (resp.statusCode !== 200) return reject(new Error('HTTP ' + resp.statusCode));
                  var ws = fs.createWriteStream(rawPath);
                  resp.pipe(ws);
                  ws.on('finish', resolve);
                  ws.on('error', reject);
                }).on('error', reject);
              }
              fetchUrl(url, 0);
            });

            // Reformat: scale to primary resolution, trim to chosen duration
            var brollDur = Math.min(parseFloat(scene.duration) || 5, 12);
            await runFFmpeg([
              '-y', '-i', rawPath,
              '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-t', String(brollDur),
              '-vf', 'scale=' + W + ':' + H + ':force_original_aspect_ratio=increase:flags=lanczos,crop=' + W + ':' + H + ',setsar=1',
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
              '-c:a', 'aac', '-b:a', '128k', '-map', '0:v:0', '-map', '1:a:0', '-shortest',
              '-movflags', '+faststart',
              fmtPath
            ], 120000);

            brollSegments.push({
              path: fmtPath,
              position: scene.position || 'middle',
              insertSec: scene.insertSec != null ? parseFloat(scene.insertSec) : null,
              duration: brollDur
            });
          } catch (e) {
            console.error('[ai-broll render] B-roll ' + i + ' failed:', e.message);
          }
        }

        if (brollSegments.length === 0) throw new Error('All B-roll downloads failed');

        // STEP 3: compute insertion points
        var sorted = brollSegments.map(function (b) {
          var at;
          if (b.insertSec != null) at = b.insertSec;
          else if (b.position === 'beginning') at = Math.min(3, primaryDur * 0.05);
          else if (b.position === 'end') at = Math.max(primaryDur - 8, primaryDur * 0.85);
          else if (b.position === 'quarter') at = primaryDur * 0.25;
          else if (b.position === 'three-quarter') at = primaryDur * 0.75;
          else at = primaryDur * 0.5;
          return Object.assign({}, b, { insertAt: Math.max(0.5, Math.min(at, primaryDur - 0.5)) });
        }).sort(function (a, b) { return a.insertAt - b.insertAt; });

        // STEP 4: overlay each B-roll on top of the primary in a single ffmpeg pass.
        // The primary's audio stays continuous and the primary keeps playing
        // underneath — the B-roll just covers the visual frame during its window.
        writeProgress('Overlaying B-roll on top of source...');
        var ffArgs = ['-y', '-i', primaryPath];
        // Add each B-roll as a separate input, time-shifted to its insertAt point.
        sorted.forEach(function (b) {
          ffArgs.push('-itsoffset', String(b.insertAt), '-i', b.path);
        });
        // Build filter_complex: scale every B-roll to the primary resolution,
        // then chain overlay operations gated by the insert window.
        var filterParts = [];
        filterParts.push('[0:v]scale=' + W + ':' + H + ':flags=lanczos,setsar=1[v0]');
        sorted.forEach(function (b, idx) {
          var inputIdx = idx + 1; // 0 is primary
          filterParts.push('[' + inputIdx + ':v]scale=' + W + ':' + H + ':force_original_aspect_ratio=increase:flags=lanczos,crop=' + W + ':' + H + ',setsar=1[b' + idx + ']');
        });
        // Chain: [vN][b_idx]overlay=enable=between(t,start,end):eof_action=pass[v(N+1)]
        var prevLabel = '[v0]';
        sorted.forEach(function (b, idx) {
          var startT = b.insertAt;
          var endT = b.insertAt + b.duration;
          var nextLabel = (idx === sorted.length - 1) ? '[vout]' : '[v' + (idx + 1) + ']';
          filterParts.push(prevLabel + '[b' + idx + "]overlay=eof_action=pass:enable='between(t," + startT.toFixed(3) + ',' + endT.toFixed(3) + ")'" + nextLabel);
          prevLabel = nextLabel;
        });
        ffArgs.push('-filter_complex', filterParts.join(';'));
        ffArgs.push('-map', '[vout]');
        ffArgs.push('-map', '0:a?');           // keep primary's audio (continuous, unmuted)
        ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20');
        ffArgs.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2');
        ffArgs.push('-movflags', '+faststart', '-max_muxing_queue_size', '2048');
        // Bound output duration by the primary so trailing silence from any
        // B-roll past the primary's end doesn't extend it.
        ffArgs.push('-t', String(primaryDur));
        ffArgs.push(outputPath);
        await runFFmpeg(ffArgs, 360000);

        clearTimeout(timeoutHandle);
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 50000) {
          throw new Error('Final encoding produced empty/invalid file');
        }
        try { fs.unlinkSync(progressPath); } catch (_) {}
        tempFiles.forEach(function (f) { try { fs.unlinkSync(f); } catch (_) {} });
        console.log('[ai-broll render] ready:', filename);

        // Log usage for storage breakdown
        try { featureUsageOps.log(req.user.id, 'ai_broll_render').catch(function(){}); } catch(_) {}

        // Library — log this finished B-Roll assembly so it appears
        // under the 'B-Roll Renders' tab.
        try {
          const { recordRender } = require('../utils/renderRecorder');
          const recorded = await recordRender(req.user.id, {
            tool: 'ai-broll',
            absPath: outputPath,
            title: 'B-Roll: ' + filename.replace(/\.[a-z0-9]+$/i, '')
          });
          // Write a sidecar with the Library ID so the status endpoint can
          // hand the client a download URL that survives Railway redeploys
          // (Library download has R2 fallback; /video-editor/download does not).
          if (recorded && recorded.id) {
            try { fs.writeFileSync(outputPath + '.library-id', String(recorded.id)); } catch (_) {}
          }
        } catch (recErr) { console.warn('[ai-broll] recordRender failed:', recErr.message); }
      } catch (err) {
        clearTimeout(timeoutHandle);
        console.error('[ai-broll render]', err);
        writeError(err.message || 'Render failed');
        tempFiles.forEach(function (f) { try { fs.unlinkSync(f); } catch (_) {} });
      }
    })();
  } catch (err) {
    console.error('[ai-broll render outer]', err);
    res.status(500).json({ error: err.message || 'Render failed' });
  }
});

// GET /ai-broll/render-status/:filename — poll progress / completion
router.get('/render-status/:filename', requireAuth, function (req, res) {
  var filename = String(req.params.filename || '').replace(/[^A-Za-z0-9_.\-]/g, '');
  if (!filename) return res.status(400).json({ error: 'invalid filename' });
  var outputPath = path.join(outputDir, filename);
  var progressPath = outputPath + '.progress';
  var errorPath = outputPath + '.error';

  if (fs.existsSync(errorPath)) {
    var errMsg = 'Render failed';
    try { errMsg = fs.readFileSync(errorPath, 'utf8'); } catch (_) {}
    return res.json({ status: 'error', message: errMsg });
  }
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 50000) {
    var libDownloadUrl = null;
    try {
      var libIdPath = outputPath + '.library-id';
      if (fs.existsSync(libIdPath)) {
        var libId = String(fs.readFileSync(libIdPath, 'utf8')).trim();
        if (libId) libDownloadUrl = '/repurpose/api/library/' + encodeURIComponent(libId) + '/download';
      }
    } catch (_) {}
    return res.json({
      status: 'ready',
      // Prefer the Library download URL — it always serves with attachment
      // header AND has R2 fallback after Railway wipes /tmp.
      downloadUrl: libDownloadUrl || ('/video-editor/download/' + filename + '?download=1'),
      sizeBytes: fs.statSync(outputPath).size
    });
  }
  if (fs.existsSync(progressPath)) {
    var msg = 'Working...';
    try { msg = fs.readFileSync(progressPath, 'utf8'); } catch (_) {}
    return res.json({ status: 'processing', message: msg });
  }
  res.json({ status: 'unknown', message: 'No active render for this filename' });
});


module.exports = router;
