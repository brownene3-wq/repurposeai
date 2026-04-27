const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
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
    '--skip-download', ...BROLL_YTDLP_ARGS,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
    '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);
  if (!subFile) subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
    '--sub-format', 'vtt',
    '-o', outTemplate, videoUrl
  ], tmpDir);
  if (!subFile) subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS,
    '--write-auto-subs', '--sub-langs', 'all',
    '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);
  if (!subFile) subFile = await tryYtdlpSubsBroll(videoId, [
    '--skip-download', ...BROLL_YTDLP_ARGS,
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
        <h1>AI B-Roll Generator</h1>
        <p>Automatically add relevant B-roll to enhance your videos</p>
      </div>

      <!-- Hero Visual Section -->
      <div style="background:linear-gradient(135deg,rgba(6,182,212,0.15),rgba(139,92,246,0.1));border-radius:20px;padding:2.5rem;margin-bottom:2rem;position:relative;overflow:hidden;border:1px solid rgba(6,182,212,0.2)">
        <div style="display:flex;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap">
          <div style="background:linear-gradient(135deg,#06B6D4,#8B5CF6);border-radius:16px;padding:2rem 2.5rem;position:relative;min-width:200px;text-align:center">
            <div style="font-size:2.5rem;margin-bottom:0.5rem">🎬</div>
            <div style="font-size:1rem;color:rgba(255,255,255,0.8)">Your Video</div>
          </div>
          <div style="font-size:2rem;color:var(--text-muted)">→</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:linear-gradient(135deg,#F59E0B,#F97316);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🏞️</div>
            <div style="background:linear-gradient(135deg,#8B5CF6,#A78BFA);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🌌</div>
            <div style="background:linear-gradient(135deg,#10B981,#34D399);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🎨</div>
            <div style="background:linear-gradient(135deg,#EC4899,#F472B6);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🎭</div>
          </div>
        </div>
      </div>

      <!-- Media Ingestion (UploadButton row, then URLInputField row; centered) -->
      <div id="mediaIngestion" style="background:var(--surface);border-radius:16px;padding:1.5rem;margin-bottom:1rem;border:1px solid var(--border-subtle);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
        <!-- Row 1: Upload buttons (now above URL input) -->
        <div id="uploadButtonRow" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:1rem;width:100%">
          <button type="button" id="uploadPrimaryBtn" style="padding:10px 20px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem">⬆ Upload</button>
          <button type="button" id="gdrivePrimaryBtn" style="padding:10px 20px;background:linear-gradient(135deg,#4285F4,#34A853);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem">📁 Google Drive</button>
          <button type="button" id="dropboxPrimaryBtn" style="padding:10px 20px;background:linear-gradient(135deg,#0061FF,#0041B3);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem">📦 Dropbox</button>
          <input type="file" id="primaryFileInput" accept="video/*" style="display:none">
        </div>
        <!-- Row 2: URL input field -->
        <div id="urlInputRow" style="display:flex;gap:8px;width:100%;max-width:600px;margin-left:auto;margin-right:auto">
          <div style="position:relative;flex:1">
            <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:1rem">🔗</span>
            <input type="text" id="heroLinkInput" placeholder="Drop a YouTube link" style="width:100%;padding:12px 12px 12px 36px;background:var(--dark-2);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:0.95rem">
          </div>
          <button type="button" id="heroImportBtn" style="padding:10px 20px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem;white-space:nowrap">▶ Import</button>
        </div>
        <p style="text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:0.8rem;margin-bottom:0">You can upload videos up to 120 minutes long. YouTube, Zoom, Twitch and Rumble links are supported.</p>
      </div>

      <!-- Primary video status + B-roll selections + Create Project -->
      <div id="projectStagingCard" style="background:var(--surface);border-radius:16px;padding:1.2rem 1.5rem;margin-bottom:2rem;border:1px solid var(--border-subtle);display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div id="primaryStatusText" style="color:var(--text);font-size:0.95rem"></div>
          <button type="button" id="createProjectBtn" style="padding:10px 22px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.95rem" disabled>🎬 Open in Video Editor</button>
        </div>
        <div id="selectedBrollList" style="margin-top:0.8rem;display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>




      <div class="input-section broll-container">
        <form id="brollForm">
          <div class="form-group">
            <label for="inputType">Input Type</label>
            <select id="inputType" name="inputType" required onchange="toggleBrollInputType()">
              <option value="">Select input type</option>
              <option value="upload">Upload Video</option>
              <option value="youtube">YouTube URL</option>
            </select>
          </div>

          <div id="uploadContainer" style="display: none;" class="upload-zone" ondrop="handleBrollDrop(event)" ondragover="handleBrollDragOver(event)" ondragleave="handleBrollDragLeave(event)">
            <h3>📹 Drop your video here</h3>
            <p>Or click to browse</p>
            <button type="button" class="upload-button" onclick="document.getElementById('brollVideoFile').click()">Select Video</button>
            <input type="file" id="brollVideoFile" style="display:none" accept="video/*" onchange="handleBrollFileSelect(event)">
            <p id="brollFileName" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;"></p>
          </div>

          <div id="youtubeContainer" style="display: none;">
            <div class="form-group">
              <label for="youtubeUrl">YouTube URL</label>
              <input type="url" id="youtubeUrl" name="youtubeUrl" placeholder="https://www.youtube.com/watch?v=...">
            </div>
          </div>

          <div class="tabs">
            <button type="button" class="tab-btn active" data-tab="ai-generated" onclick="switchTab('ai-generated', event)">AI Generated B-Roll</button>
            <button type="button" class="tab-btn" data-tab="stock" onclick="switchTab('stock', event)">Stock B-Roll (Copyright Free)</button>
          </div>

          <div class="tab-content active" id="ai-generated">
            <div class="form-group">
              <label for="aiPrompt">Describe the B-Roll you want (optional)</label>
              <input type="text" id="aiPrompt" placeholder="e.g., 'nature scenes, flowing water, mountains'">
            </div>
          </div>

          <div class="tab-content" id="stock">
            <div class="form-group">
              <label for="searchTerms">Search Terms for Stock B-Roll</label>
              <input type="text" id="searchTerms" placeholder="e.g., 'office, technology, business'">
            </div>
          </div>

          <button type="submit" class="btn-generate" id="generateBrollBtn">Add B-Roll in 1 Click</button>
          <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"></div></div>
        </form>
      </div>

      <div class="results-section">
        <div id="brollResultsContainer">
          <div class="empty-state">
            <p>Select a video and click "Add B-Roll in 1 Click" to generate footage</p>
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

    function toggleBrollInputType() {
      const type = document.getElementById('inputType').value;
      document.getElementById('uploadContainer').style.display = type === 'upload' ? 'block' : 'none';
      document.getElementById('youtubeContainer').style.display = type === 'youtube' ? 'block' : 'none';
    }

    function handleBrollDragOver(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.add('dragover');
    }

    function handleBrollDragLeave(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.remove('dragover');
    }

    function handleBrollDrop(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        currentBrollVideo = files[0];
        document.getElementById('brollFileName').textContent = 'Selected: ' + files[0].name;
      }
    }

    function handleBrollFileSelect(e) {
      if (e.target.files.length > 0) {
        currentBrollVideo = e.target.files[0];
        document.getElementById('brollFileName').textContent = 'Selected: ' + e.target.files[0].name;
      }
    }

    function switchTab(tabName, e) {
      e.preventDefault();
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabName).classList.add('active');
      e.target.classList.add('active');
    }

    document.getElementById('brollForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const inputType = document.getElementById('inputType').value;
      const mode = document.querySelector('.tab-btn.active').dataset.tab;

      if (!inputType) {
        showToast('Please select an input type');
        return;
      }

      let content = null;
      if (inputType === 'upload') {
        if (!currentBrollVideo) {
          showToast('Please select a video file');
          return;
        }
        content = { type: 'upload', file: currentBrollVideo };
      } else if (inputType === 'youtube') {
        const url = document.getElementById('youtubeUrl').value.trim();
        if (!url) {
          showToast('Please enter a YouTube URL');
          return;
        }
        content = { type: 'youtube', url };
      }

      const btn = document.getElementById('generateBrollBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Analyzing video & finding B-Roll...';
      const progressBar = document.getElementById('progressBar');
      progressBar.classList.add('active');

      try {
        let response;
        // ── Prefer the staged primary from the new ingestion flow (Upload/URL/Drive/Dropbox).
        var stagedPrimary = (window.__aiBrollState && window.__aiBrollState.primary) || null;
        if (stagedPrimary && stagedPrimary.filename && mode === 'ai-generated') {
          response = await fetch('/ai-broll/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputType: stagedPrimary.source === 'youtube' ? 'youtube' : 'upload',
              url: stagedPrimary.source === 'youtube' ? stagedPrimary.sourceUrl : undefined,
              mode,
              prompt: (document.getElementById('aiPrompt') || {}).value || (document.getElementById('searchTerms') || {}).value || '',
              primary: { filename: stagedPrimary.filename, originalName: stagedPrimary.originalName, source: stagedPrimary.source }
            })
          });
        } else if (content.type === 'upload') {
          const formData = new FormData();
          formData.append('video', content.file);
          formData.append('inputType', 'upload');
          formData.append('mode', mode);
          formData.append('prompt', document.getElementById('aiPrompt').value || document.getElementById('searchTerms').value);
          response = await fetch('/ai-broll/generate', {
            method: 'POST',
            body: formData
          });
        } else {
          response = await fetch('/ai-broll/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputType: content.type,
              url: content.url,
              mode,
              prompt: document.getElementById('aiPrompt').value || document.getElementById('searchTerms').value
            })
          });
        }

        const data = await response.json();

        if (response.ok && data.brollItems && data.brollItems.length > 0) {
          // Store items data globally for modal access
          window.brollItemsData = data.brollItems;

          const container = document.getElementById('brollResultsContainer');
          let html = '<h2 style="margin-bottom: 1.5rem; color: var(--text);">Generated B-Roll</h2>';
          if (data.pixabayWarning) {
            html += '<div class="api-warning">' + data.pixabayWarning + '</div>';
          }
          html += '<div class="broll-grid">' +
            data.brollItems.map((item) => \`
              <div class="broll-item" id="broll-\${item.id}" onclick="selectBroll('\${item.id}')">
                <div class="broll-thumbnail" style="background-image: url('\${item.thumbnailUrl}');">
                  <div class="play-button">▶</div>
                  <div class="duration-badge">\${item.duration}s</div>
                </div>
                <div class="broll-info">
                  <div class="broll-name">\${item.name}</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">By \${item.artist}</div>
                </div>
              </div>
            \`).join('') + '</div>';
          container.innerHTML = html;
          showToast('B-roll generated successfully!');
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
        chip.innerHTML = '🎞️ ' + (b.name || b.filename) + ' <button type="button" aria-label="Remove" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;line-height:1">×</button>';
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
  function wireUpload() {
    var btn = document.getElementById('uploadPrimaryBtn');
    var input = document.getElementById('primaryFileInput');
    if (!btn || !input) return;
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Uploading…';
      try {
        var fd = new FormData(); fd.append('video', file);
        var r = await fetch('/ai-broll/upload-primary', { method: 'POST', body: fd });
        if (!r.ok) { var e2 = await r.json().catch(function(){return{};}); throw new Error(e2.error || ('Upload failed (' + r.status + ')')); }
        var data = await r.json();
        setPrimary(data);
      } catch (err) {
        toastMsg('Upload failed: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = orig;
        input.value = '';
      }
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
  function wireCreateProject() {
    var btn = document.getElementById('createProjectBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      if (!state.primary) { toastMsg('Pick a primary video first'); return; }
      var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Creating project…';
      try {
        var r = await fetch('/ai-broll/create-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primary: state.primary, broll: state.broll })
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || ('create-project failed (' + r.status + ')'));
        window.location.href = data.redirectTo || ('/video-editor/' + data.projectId);
      } catch (err) {
        toastMsg('Could not create project: ' + err.message);
        btn.disabled = false; btn.textContent = orig;
      }
    });
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
router.post('/generate', requireAuth, upload.single('video'), async (req, res) => {
  try {
    const { inputType, url, mode, prompt } = req.body;

    if (!mode) {
      return res.status(400).json({ error: 'Please select a B-roll mode' });
    }

    let contentDescription = '';
    if (req.file) {
      contentDescription = `Video file: ${req.file.originalname}`;
    } else if (inputType === 'youtube' && url) {
      contentDescription = `YouTube video: ${url}`;
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
            item.moment = scene.moment || '';
            brollItems.push(item);
          } else {
            const fb = generateFallbackItems([q], 1)[0];
            fb.searchQueryUsed = q;
            fb.sceneDescription = scene.scene_description || '';
            fb.moment = scene.moment || '';
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
    const max = Math.max(1, Math.min(24, parseInt((req.body || {}).max, 10) || 12));
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
                '&per_page=' + max +
                '&safesearch=true';
    const r = await fetch(url);
    if (!r.ok) throw new Error('Pixabay error ' + r.status);
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
      const args = COMMON_ARGS.concat(extraArgs || []).concat(cookiesArgs).concat([url]);
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
        let msg = 'YouTube blocked every player client (' + tried.join(', ') + ').';
        if (!cookiesPath) {
          msg += ' This server\'s IP appears to be bot-rate-limited by YouTube. ' +
                 'Set the YT_COOKIES_PATH env var to a Netscape-format cookies.txt exported from a logged-in browser to bypass.';
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
    if (!primary.filename) {
      return res.status(400).json({ error: 'A primary video is required to create a project' });
    }
    const broll = Array.isArray(body.broll) ? body.broll.filter(b => b && b.filename) : [];
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


module.exports = router;
