const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// Try to load ytdl-core
let ytdl;
try { ytdl = require('@distube/ytdl-core'); } catch (e) {}

// FFmpeg detection
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) { ffmpegPath = localFfmpeg; }
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (e) {} }
if (!ffmpegPath) { try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {} }

// yt-dlp detection
let ytdlpPath = null;
try { execSync('which yt-dlp', { stdio: 'pipe' }); ytdlpPath = 'yt-dlp'; } catch (e) {}

// Boot guard — see shorts.js explanation
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key' });

// Common yt-dlp args
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

// Directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer config
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload a video file.'));
    }
  }
});

// Caption style presets mapping to ASS format
const captionPresets = {
  karaoke: {
    name: 'Karaoke',
    fontName: 'Arial',
    fontSize: 48,
    fontColor: 'FFFFFF',
    outlineColor: '000000',
    outlineWidth: 2,
    shadowDepth: 1,
    bold: true,
    alignment: 2, // bottom center
    wordHighlightColor: 'FF00FF', // magenta for current word
    animation: 'karaoke'
  },
  'bold-pop': {
    name: 'Bold Pop',
    fontName: 'Arial Black',
    fontSize: 56,
    fontColor: 'FFFFFF',
    outlineColor: '000000',
    outlineWidth: 4,
    shadowDepth: 2,
    bold: true,
    alignment: 2,
    wordHighlightColor: 'FFD700', // gold pop on the active word
    animation: 'pop'
  },
  minimal: {
    name: 'Minimal',
    fontName: 'Helvetica Neue',
    fontSize: 40,
    fontColor: 'FFFFFF',
    outlineColor: '000000',
    outlineWidth: 0,
    shadowDepth: 0,
    bold: false,
    alignment: 2,
    wordHighlightColor: 'FFFFFF', // minimal stays flat — keep the same colour
    animation: 'fade'
  },
  'neon-glow': {
    name: 'Neon Glow',
    fontName: 'Arial',
    fontSize: 48,
    fontColor: '39FF14', // neon green
    outlineColor: '00FF00',
    outlineWidth: 3,
    shadowDepth: 3,
    bold: true,
    alignment: 2,
    wordHighlightColor: '39FF14',
    animation: 'glow'
  },
  mrbeast: {
    name: 'MrBeast',
    fontName: 'Arial Black',
    fontSize: 54,
    fontColor: 'D4A574', // golden
    outlineColor: '000000',
    outlineWidth: 5,
    shadowDepth: 2,
    bold: true,
    alignment: 2,
    wordHighlightColor: 'FFD700',
    animation: 'pop'
  },
  hormozi: {
    name: 'Hormozi',
    fontName: 'Arial',
    fontSize: 50,
    fontColor: 'FFFFFF',
    outlineColor: 'FF0000', // red outline
    outlineWidth: 3,
    shadowDepth: 2,
    bold: true,
    alignment: 2,
    wordHighlightColor: 'FFFF00', // yellow box-style highlight on active word
    animation: 'highlight'
  }
};

// Helper: Validate YouTube URL
//
// Accepts every shape of YouTube link a user is likely to paste, with
// particular care taken for Shorts, which are most commonly shared from the
// mobile app as `https://m.youtube.com/shorts/<id>?...`. Earlier versions
// of this validator only allowed `(www.)?youtube.com`, so mobile Shorts
// links plus music.youtube.com Shorts and youtube-nocookie embeds all
// failed silently with "Invalid YouTube URL" before yt-dlp ever ran.
//
// Patterns covered:
//   <subdomain>.youtube.com/watch?v=ID
//   <subdomain>.youtube.com/shorts/ID
//   <subdomain>.youtube.com/embed/ID
//   <subdomain>.youtube.com/live/ID
//   <subdomain>.youtube.com/v/ID
//   <subdomain>.youtu.be/ID
//   <subdomain>.youtube-nocookie.com/(embed|v)/ID
// where <subdomain> can be www, m, music, gaming, kids, etc. (any host
// label) or absent.
function isValidYouTubeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  const patterns = [
    /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?youtube\.com\/(?:watch\?[^#]*\bv=|shorts\/|embed\/|live\/|v\/|e\/)[A-Za-z0-9_-]{6,}/i,
    /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?youtu\.be\/[A-Za-z0-9_-]{6,}/i,
    /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?youtube-nocookie\.com\/(?:embed\/|v\/)[A-Za-z0-9_-]{6,}/i
  ];
  return patterns.some(p => p.test(s));
}

// Helper: Extract YouTube video ID
//
// Pulls the 11-ish character video ID from any of the link shapes the
// validator accepts. Tries the more specific Shorts/live/embed/v patterns
// first so a URL like `youtube.com/shorts/ABC?v=XYZ` returns ABC (the
// actual Shorts video) instead of the unrelated `v=` query value.
function extractVideoId(url) {
  if (!url) return null;
  const s = String(url).trim();
  const patterns = [
    /\/shorts\/([A-Za-z0-9_-]{6,})/i,
    /\/live\/([A-Za-z0-9_-]{6,})/i,
    /\/embed\/([A-Za-z0-9_-]{6,})/i,
    /\/v\/([A-Za-z0-9_-]{6,})/i,
    /\/e\/([A-Za-z0-9_-]{6,})/i,
    /[?&]v=([A-Za-z0-9_-]{6,})/i,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/i
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

// Helper: Get video duration
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe' in ffmpegPath ? ffmpegPath.replace('ffmpeg', 'ffprobe') : 'ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && parseFloat(output) > 0) {
        resolve(parseFloat(output));
      } else {
        resolve(0);
      }
    });
    proc.on('error', () => resolve(0));
  });
}

// Helper: Extract audio from video
function extractAudio(videoPath, audioPath) {
  // Use MP3 format to stay under Whisper's 25MB limit (WAV is too large for longer videos)
  const mp3Path = audioPath.replace(/\.wav$/, '.mp3');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', videoPath,
      '-vn',              // no video
      '-ac', '1',         // mono
      '-ar', '16000',     // 16kHz for Whisper
      '-b:a', '64k',      // 64kbps MP3 — plenty for speech, keeps file small
      '-y',
      mp3Path
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(mp3Path);
      } else {
        reject(new Error('Audio extraction failed: ' + stderr.slice(-200)));
      }
    });
    proc.on('error', reject);
  });
}

// Helper: Transcribe audio with OpenAI Whisper
async function transcribeAudio(audioPath) {
  try {
    const audioBuffer = fs.readFileSync(audioPath);
    const ext = path.extname(audioPath);
    const mimeType = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    const fileName = ext === '.mp3' ? 'audio.mp3' : 'audio.wav';
    const file = new File([audioBuffer], fileName, { type: mimeType });

    const transcript = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: file,
      response_format: 'verbose_json',
      timestamp_granularities: ['word']
    });

    // Parse response with word-level timing
    const words = [];
    if (transcript.words && Array.isArray(transcript.words)) {
      for (const item of transcript.words) {
        words.push({
          word: item.word,
          start: item.start,
          end: item.end
        });
      }
    } else {
      // Fallback: split text into words with equal timing
      const text = transcript.text || '';
      const wordList = text.split(/\s+/).filter(w => w);
      const duration = transcript.duration || 60;
      const timePerWord = duration / wordList.length;
      for (let i = 0; i < wordList.length; i++) {
        words.push({
          word: wordList[i],
          start: i * timePerWord,
          end: (i + 1) * timePerWord
        });
      }
    }

    return words;
  } catch (err) {
    throw new Error('Transcription failed: ' + (err.message || 'Unknown error'));
  }
}

// Helper: Download YouTube video
async function downloadYouTubeVideo(videoUrl) {
  const videoId = extractVideoId(videoUrl) || uuidv4().slice(0, 8);
  const outputPath = path.join(uploadDir, `yt-captions-${videoId}.mp4`);

  try { fs.unlinkSync(outputPath); } catch (e) {}

  if (ytdlpPath) {
    try {
      console.log(`[AI Captions] Downloading ${videoUrl} via yt-dlp...`);
      await new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, [
          '--no-playlist',
          // Cap the longer dimension at 1920 instead of capping height alone.
          // YouTube Shorts are vertical 1080x1920 — `height<=1080` was
          // silently downgrading them to a lower-resolution fallback (or
          // failing on Shorts that have no <=1080 ladder). The 1920 cap
          // works for both landscape 1080p (1920x1080) and portrait
          // Shorts (1080x1920).
          '-f', 'bestvideo[height<=1920][width<=1920]+bestaudio/best[height<=1920][width<=1920]/best',
          '--merge-output-format', 'mp4',
          '-o', outputPath,
          '--no-part',
          '--force-overwrites',
          ...YTDLP_COMMON_ARGS,
          videoUrl
        ]);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('yt-dlp exit ' + code));
        });
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} reject(new Error('Download timed out')); }, 180000);
      });

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
        console.log(`[AI Captions] yt-dlp download success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return outputPath;
      }
    } catch (err) {
      console.log(`[AI Captions] yt-dlp failed: ${err.message.slice(0, 200)}`);
    }
  }

  if (ytdl) {
    try {
      console.log(`[AI Captions] Trying ytdl-core fallback...`);
      await new Promise((resolve, reject) => {
        const stream = ytdl(videoUrl, { quality: 'highest', filter: 'audioandvideo' });
        const writeStream = fs.createWriteStream(outputPath);
        stream.pipe(writeStream);
        stream.on('error', reject);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        setTimeout(() => { stream.destroy(); reject(new Error('ytdl-core download timed out')); }, 180000);
      });

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
        console.log(`[AI Captions] ytdl-core download success`);
        return outputPath;
      }
    } catch (err) {
      console.log(`[AI Captions] ytdl-core fallback failed: ${err.message.slice(0, 200)}`);
    }
  }

  throw new Error('Failed to download YouTube video');
}

// Helper: Sanitize hex color input. Accepts "RRGGBB", "#RRGGBB", or "0xRRGGBB" (any case).
// Returns a canonical 6-char uppercase RRGGBB string, or null if invalid.
function sanitizeHex(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let s = hex.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (s.length === 3) s = s.split('').map(c => c + c).join(''); // expand shorthand
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toUpperCase();
}

// Helper: Convert color to ASS hex format (BGR)
function colorToASS(hexColor, fallback = '000000') {
  // Input: RRGGBB (any case, with or without #), Output: &HBBGGRR&
  const sanitized = sanitizeHex(hexColor) || sanitizeHex(fallback) || '000000';
  const r = sanitized.slice(0, 2);
  const g = sanitized.slice(2, 4);
  const b = sanitized.slice(4, 6);
  return `&H${b}${g}${r}&`;
}

// Map UI font names to fonts we know are available on the render server.
// libass uses fontconfig under the hood — if it can't find the requested family
// it silently falls back to a default sans, which is exactly the bug Albert hit.
// Server has fonts-liberation + fonts-dejavu + fonts-noto-core + fonts-freefont-ttf
// installed (see Dockerfile). We alias the user-facing names to those families.
const FONT_ALIAS = {
  'Arial':           'Liberation Sans',
  'Arial Black':     'Liberation Sans',
  'Helvetica':       'Liberation Sans',
  'Helvetica Neue':  'Liberation Sans',
  'Verdana':         'DejaVu Sans',
  'Times New Roman': 'Liberation Serif',
  'Georgia':         'Liberation Serif',
  'Courier New':     'Liberation Mono',
  // Anton is the standard Google Fonts pick for an Impact-equivalent condensed
  // sans. The Dockerfile downloads Anton-Regular.ttf and runs fc-cache so libass
  // can resolve this name. Browsers load the same font from Google Fonts via
  // the @import in routes/ai-captions.js, so preview and export render Impact
  // as the same condensed sans on both sides.
  'Impact':          'Anton'
};
function resolveFontName(uiFont) {
  if (!uiFont) return 'Liberation Sans';
  const aliased = FONT_ALIAS[uiFont];
  if (aliased) return aliased;
  // Unknown font name — pass through but append a safe fallback so libass
  // has somewhere to land.
  return `${uiFont},Liberation Sans`;
}

// Helper: Generate ASS subtitles file with captions.
// Reads the FULL StyleConfig from customSettings — every field the UI exposes
// (fontFamily, fontSize, fontColor, outlineColor, outlineWidth, highlightColor,
// animation, position) gets honored. Falls back to preset defaults only when
// a field is missing.
function generateASSFile(transcript, preset, customSettings = {}) {
  const style = captionPresets[preset] || captionPresets.karaoke;
  const cs = customSettings || {};

  // ----- Resolve every style field with explicit user-override -> preset fallback -----
  const fontSizeRaw   = parseInt(cs.fontSize, 10);
  const fontSize      = Number.isFinite(fontSizeRaw) ? fontSizeRaw : style.fontSize;

  const fontColor     = sanitizeHex(cs.fontColor)     || style.fontColor;
  const outlineColor  = sanitizeHex(cs.outlineColor)  || style.outlineColor;
  const highlightColor = sanitizeHex(cs.highlightColor) || style.wordHighlightColor || style.fontColor;

  // outlineWidth: explicit 0 must NOT be replaced by preset default (this was
  // one of the Style "Hardening" issues — `|| style.outlineWidth` ate the 0).
  const outlineWidth  = (cs.outlineWidth !== undefined && cs.outlineWidth !== null && !isNaN(parseInt(cs.outlineWidth, 10)))
    ? parseInt(cs.outlineWidth, 10)
    : style.outlineWidth;

  const position      = cs.position || 'bottom';
  const fontFamily    = resolveFontName(cs.fontFamily || style.fontName);

  // animation: if user explicitly picked one, that overrides the preset's
  // built-in animation. "none" means strip the per-preset effect too.
  const animation     = cs.animation || null; // null = use preset's built-in behavior

  // shadow + bold still come from preset (no UI control yet).
  const shadowDepth   = style.shadowDepth;
  const boldFlag      = style.bold ? -1 : 0;

  // Map position to ASS alignment (numpad style: 1-9)
  const alignmentMap = { top: 8, center: 5, bottom: 2 };
  const alignment = alignmentMap[position] || 2;

  // MarginV — pull caption away from edges, especially for bottom-anchored
  // overlays so they sit clear of the player's controls bar.
  const marginV = position === 'bottom' ? 60 : 30;

  // Horizontal margins inside the 1920-wide canvas. Slim margins let phrases
  // span almost the full video width, which is what stops single-word lines
  // and gives libass enough horizontal room before WrapStyle=0 has to wrap.
  const marginH = 80;

  let assContent = `[Script Info]
Title: AI Captions
ScriptType: v4.00+
; WrapStyle 0 = smart line break — libass will break at the last whitespace
; that fits, so a phrase wider than the video automatically wraps to a new
; line instead of overflowing past the edge.
WrapStyle: 0
ScaledBorderAndShadow: yes
; Pin a known PlayRes so font-size and outline-width scale predictably no
; matter what dimensions the source video is. The live preview formula uses
; the same 1080 reference, which keeps preview and export visually in sync.
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${colorToASS(fontColor)},${colorToASS(highlightColor)},${colorToASS(outlineColor)},&H00000000&,${boldFlag},0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},${alignment},${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Convert seconds to ASS time format (h:mm:ss.cc)
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const cents = Math.floor((seconds % 1) * 100);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
  };

  // ----- Phrase grouping --------------------------------------------------
  // Albert's spec: captions should span the full video width — no
  // single-word-per-line displays. Group consecutive transcript words into
  // phrases, then emit each phrase as ONE Dialogue event spanning the first
  // word's start to the last word's end. WrapStyle=0 in the header takes
  // care of wrapping a phrase that's wider than the video.
  //
  // Break rules:
  //   - Phrase exceeds the target character budget for one line
  //   - Pause between consecutive words is too long (caption should clear)
  //   - Previous word ended with sentence-ending punctuation
  //
  // Target line width is computed from font size so big fonts get fewer
  // words per line and small fonts get more. The constant divisor is tuned
  // for Liberation Sans / DejaVu Sans on the 1920-wide canvas; libass's own
  // line wrapping picks up the slack on the rare miscount.
  const charBudget = Math.max(14, Math.round(38 * (48 / fontSize)));
  const gapThreshold = 0.55;          // seconds; longer pause -> new phrase
  const maxPhraseDuration = 4.5;       // seconds; never hold a phrase longer
  const sentenceEnd = /[.!?]["')\]]?$/;

  function groupPhrases(items) {
    const phrases = [];
    let current = [];
    let currentChars = 0;
    for (let i = 0; i < items.length; i++) {
      const w = items[i];
      const wordText = String(w.word || '').trim();
      if (!wordText) continue;
      const len = wordText.length + 1; // +1 for trailing space

      const prev = current[current.length - 1];
      const gap = prev ? ((w.start || 0) - (prev.end || 0)) : 0;
      const phraseDur = current.length ? ((w.end || w.start || 0) - current[0].start) : 0;
      const lastEndsSentence = prev && sentenceEnd.test(String(prev.word || '').trim());

      const shouldBreak = current.length > 0 && (
        currentChars + len > charBudget ||
        gap > gapThreshold ||
        lastEndsSentence ||
        phraseDur > maxPhraseDuration
      );
      if (shouldBreak) {
        phrases.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(w);
      currentChars += len;
    }
    if (current.length) phrases.push(current);
    return phrases;
  }

  // ----- Per-word effect tags inside a phrase -----------------------------
  // The `\t(start,end,tags)` ASS tag animates style mods between the two
  // millisecond marks (relative to the dialogue line start). We use it to
  // briefly swap each word's primary colour to the highlight colour while
  // it's the active word, then revert. This produces a clean active-word
  // highlight that travels across the multi-word phrase.
  const textC = colorToASS(fontColor);
  const hiC = colorToASS(highlightColor);

  // Each user animation has both a per-word ACTIVE state delta and an
  // INACTIVE resting state. The deltas are layered ON TOP of the preset's
  // own active-word tags (bold-pop scale, hormozi outline bump, etc.) by
  // appending — later ASS tags override earlier ones, so a per-word \\t()
  // that includes the animation delta wins over the preset's own value.
  //
  // Mapping (export tag --> matching preview CSS in the page <style>):
  //   pop    -> \\fscx118\\fscy118   --> .word.active { transform: scale(1.18) }
  //   glow   -> \\3c<hi>\\bord<w+2>  --> .word.active { filter: drop-shadow(...) }
  //   slide  -> \\fscy100 + initial \\fscy70 --> translateY(0) / translateY(6px)
  //   fade   -> \\alpha&H00& + initial \\alpha&H99& --> opacity 1 / opacity 0.4
  //
  // Transition durations are picked so libass's \\t(start, start+200, ...)
  // arc matches the 0.2s CSS transition on .caption-text .word in the
  // preview, keeping easing perceptually identical.
  const ANIM_TRANSITION_MS = 200;

  function animActiveDelta() {
    switch (animation) {
      case 'pop':   return `\\fscx118\\fscy118`;
      case 'glow':  return `\\3c${hiC}\\bord${outlineWidth + 2}`;
      case 'slide': return `\\fscy100`;
      case 'fade':  return `\\alpha&H00&`;
      default:      return '';
    }
  }
  function animInactiveDelta() {
    switch (animation) {
      case 'slide': return `\\fscy70`;          // word sits "shorter" until it slides up
      case 'fade':  return `\\alpha&H99&`;       // ~60% transparent until it fades in
      // pop/glow: inactive == nothing extra (the base tags already reset scale/border)
      default:      return '';
    }
  }
  function animInitialTags() {
    // Initial state of every word at phrase start, before any \\t() fires.
    // For slide and fade this means starting words "off" so the first word
    // can animate "on" at its activation time.
    return animInactiveDelta();
  }

  function activeWordTags(preset) {
    // Preset-specific active-word style mods. Animation mods are appended
    // by the caller so later tags can override earlier ones.
    switch (preset) {
      case 'bold-pop':
      case 'mrbeast':
        return `\\1c${hiC}\\fscx112\\fscy112`;
      case 'hormozi':
        return `\\1c${hiC}\\bord${outlineWidth + 1}`;
      case 'neon-glow':
        return `\\1c${hiC}\\3c${hiC}`;
      case 'minimal':
        return ``;                          // minimal stays flat
      case 'karaoke':
      default:
        return `\\1c${hiC}`;
    }
  }
  function inactiveWordTags() {
    // Reset all the things active state can change (color, scale, border,
    // outline color) so the word visually returns to its baseline.
    return `\\1c${textC}\\fscx100\\fscy100\\bord${outlineWidth}\\3c${colorToASS(outlineColor)}`;
  }

  // Build the text for one phrase, applying per-word highlight + animation
  // transitions. The model is symmetric with the preview's CSS:
  //   - Words start in the INITIAL state (animInitialTags)
  //   - When a word activates: \\t() animates to ACTIVE state
  //     (preset tags + animActiveDelta)
  //   - When a word deactivates: \\t() animates back to INACTIVE state
  //     (inactiveWordTags + animInactiveDelta)
  function renderPhrase(words) {
    const phraseStart = words[0].start || 0;
    const isMrBeast = preset === 'mrbeast';
    const userOverride = !!animation && animation !== 'none';

    // For "minimal" preset with no animation override, keep the existing
    // flat phrase render (no per-word transitions at all).
    if (preset === 'minimal' && !userOverride) {
      const flat = words.map(w => isMrBeast ? String(w.word).toUpperCase() : w.word).join(' ');
      return `{\\fad(120,80)}${flat}`;
    }

    const initial = animInitialTags();
    const activeDelta = animActiveDelta();
    const inactiveDelta = animInactiveDelta();
    const presetActive = activeWordTags(preset);
    const baseInactive = inactiveWordTags();

    const wordParts = words.map(w => {
      const wText = isMrBeast ? String(w.word).toUpperCase() : String(w.word).trim();
      const relStart = Math.max(0, Math.round(((w.start || 0) - phraseStart) * 1000));
      const relEnd = Math.max(relStart + 30, Math.round(((w.end || (w.start || 0) + 0.3) - phraseStart) * 1000));

      // Compose ON state = preset active tags + animation active delta
      const onTags = presetActive + activeDelta;
      const offTags = baseInactive + inactiveDelta;

      // If neither preset nor animation contribute anything, render flat.
      if (!onTags && !initial) return wText;

      // Per-word initial tags (e.g. start invisible/short for fade/slide)
      // are emitted at relStart-1 so they apply right before the activation
      // transition kicks in — this guarantees clean state for the first
      // word of every phrase.
      const initialBlock = initial ? initial : '';

      const transIn = onTags ? `\\t(${relStart},${relStart + ANIM_TRANSITION_MS},${onTags})` : '';
      const transOut = offTags ? `\\t(${relEnd},${relEnd + ANIM_TRANSITION_MS},${offTags})` : '';

      return `{${initialBlock}${transIn}${transOut}}${wText}`;
    });

    return wordParts.join(' ');
  }

  const phrases = groupPhrases(transcript);
  const lines = phrases.map(words => {
    const start = formatTime(words[0].start || 0);
    const end = formatTime(words[words.length - 1].end || (words[0].start || 0) + 1);
    const text = renderPhrase(words);
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  assContent += lines.join('\n');
  return assContent;
}

// Helper: Burn subtitles into video using FFmpeg
function burnSubtitles(videoPath, assPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Escape path for FFmpeg filter_complex
    const assFilter = assPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

    const args = [
      '-i', videoPath,
      '-vf', `ass=${assFilter}`,
      '-c:a', 'aac',
      '-q:a', '5',
      // Move moov atom to the front so the file is streamable / scrub-friendly.
      // Without this the browser's <video> element can't render the file from
      // a blob URL until the entire payload is downloaded, and downstream
      // tools that probe headers (cloud storage, social uploaders) see a
      // zero-duration file.
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
        resolve();
      } else {
        reject(new Error('FFmpeg burn failed: ' + stderr.slice(-300)));
      }
    });
    proc.on('error', reject);
    // Timeout after 30 minutes
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} reject(new Error('Subtitle burn timed out')); }, 1800000);
  });
}

// GET: Main AI Captions page
router.get('/', requireAuth, (req, res) => {
  const headHTML = getHeadHTML('AI Captions');
  const sidebar = getSidebar('ai-captions', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();
  const baseCSS = getBaseCSS();

  const html = `${headHTML}
  <style>
    /* Anton is the closest free equivalent to Microsofts Impact and is also
       installed on the render server (see Dockerfile), so the live preview
       and the burned-in export render Impact as the same condensed sans on
       both Mac and Linux. */
    @import url('https://fonts.googleapis.com/css2?family=Anton&display=swap');

    ${baseCSS}

    :root {
      --primary: #6C3AED;
      --surface: #1a1a2e;
      --dark: #0f0f1e;
      --text: #ffffff;
      --text-muted: #a0aec0;
      --border-subtle: #2d2d4a;
    }

    .container {
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 80px);
      padding: 1.5rem;
      width: 100%;
      box-sizing: border-box;
    }

    .header {
      margin-bottom: 1.5rem;
    }

    .header h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #6C3AED, #ec4899);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .editor-area {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      flex: 1;
      overflow: visible;
      min-height: 400px;
    }

    .section {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .section-title {
      font-size: 0.95rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .upload-zone {
      background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
      border: 2px dashed var(--primary);
      border-radius: 12px;
      padding: 2rem;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 1rem;
    }

    .upload-zone:hover,
    .upload-zone.dragover {
      background: linear-gradient(135deg, rgba(108, 58, 237, 0.2), rgba(236, 72, 153, 0.2));
      border-color: var(--primary);
    }

    .upload-zone h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .upload-zone p {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }

    .btn-primary {
      padding: 0.6rem 1.2rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .btn-primary:hover {
      box-shadow: 0 8px 24px rgba(108, 58, 237, 0.3);
      transform: translateY(-2px);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .input-group {
      margin-bottom: 1rem;
    }

    .input-label {
      display: block;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      font-weight: 600;
    }

    .input-field,
    .select-field {
      width: 100%;
      padding: 0.6rem;
      background: var(--dark);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.85rem;
      font-family: inherit;
    }

    .input-field:focus,
    .select-field:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(108, 58, 237, 0.1);
    }

    .video-wrapper {
      position: relative;
      background: #000000;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 1rem;
      max-width: 100%;
      line-height: 0;
    }

    .video-wrapper video {
      width: 100%;
      height: auto;
      display: block;
    }

    /* ===== Live caption preview overlay ===== */
    .caption-overlay {
      position: absolute;
      left: 0;
      right: 0;
      padding: 0 4%;
      pointer-events: none;
      text-align: center;
      z-index: 2;
      line-height: 1.2;
      transition: top 0.25s ease, bottom 0.25s ease, transform 0.25s ease;
    }

    .caption-overlay.position-top    { top: 8%;  bottom: auto; transform: none; }
    .caption-overlay.position-center { top: 50%; bottom: auto; transform: translateY(-50%); }
    .caption-overlay.position-bottom { bottom: 10%; top: auto; transform: none; }

    .caption-text {
      display: inline-block;
      font-weight: 800;
      letter-spacing: 0.01em;
      max-width: 94%;
      word-wrap: break-word;
    }

    .caption-text .word {
      display: inline-block;
      margin: 0 0.08em;
      transition: color 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
    }

    /* User animations — these MUST match the per-word \\t() transitions
       that generateASSFile emits server-side. The export model is:
         inactive_state -> .word becomes active -> animate to active_state
         active_state   -> .word becomes inactive -> animate back
       and the .word base rule below provides the 0.2s easing that mirrors
       libass's \\t(start, start+200, ...) animation duration. The previous
       infinite-loop keyframe approach diverged from the export, which only
       fires once on entry, so the preview lied about the final look. */

    /* Animation: pop — active word scales up on activation */
    .caption-overlay[data-animation="pop"] .caption-text .word.active {
      transform: scale(1.18);
    }

    /* Animation: glow — active word gets a coloured halo */
    .caption-overlay[data-animation="glow"] .caption-text .word.active {
      filter: drop-shadow(0 0 6px var(--cap-highlight, #39FF14))
              drop-shadow(0 0 12px var(--cap-highlight, #39FF14));
    }

    /* Animation: slide — non-active words sit 6px lower; the active word
       slides up into position via the .word transition. Mirrors the
       per-word ASS transition that animates \\fscy (vertical scale) on the
       active word. */
    .caption-overlay[data-animation="slide"] .caption-text .word {
      transform: translateY(6px);
    }
    .caption-overlay[data-animation="slide"] .caption-text .word.active {
      transform: translateY(0);
    }

    /* Animation: fade — non-active words sit at 40% alpha, the active word
       fades up to fully opaque. Mirrors per-word \\alpha&H99&/&H00& tags. */
    .caption-overlay[data-animation="fade"] .caption-text .word {
      opacity: 0.4;
    }
    .caption-overlay[data-animation="fade"] .caption-text .word.active {
      opacity: 1;
    }

    /* Per-preset active-word treatments — these MUST mirror the per-word
       \\t() transitions emitted by generateASSFile() server-side, otherwise
       the user sees one effect in the preview and a different one in the
       exported video.

       Mapping (preview rule -> export tag):
         karaoke   -> color flip                      (\\1c<hi>)
         bold-pop  -> color flip + 1.12x scale        (\\1c<hi>\\fscx112\\fscy112)
         mrbeast   -> color flip + 1.12x scale        (same as bold-pop, plus uppercase)
         hormozi   -> color flip + thicker outline    (\\1c<hi>\\bord+1)
         neon-glow -> color flip on both fill+stroke  (\\1c<hi>\\3c<hi>)
         minimal   -> no per-word change              (no \\t())
    */
    .caption-overlay[data-preset="karaoke"]   .caption-text .word.active,
    .caption-overlay[data-preset="bold-pop"]  .caption-text .word.active,
    .caption-overlay[data-preset="mrbeast"]   .caption-text .word.active,
    .caption-overlay[data-preset="hormozi"]   .caption-text .word.active,
    .caption-overlay[data-preset="neon-glow"] .caption-text .word.active {
      color: var(--cap-highlight, #FF00FF);
    }
    .caption-overlay[data-preset="bold-pop"] .caption-text .word.active,
    .caption-overlay[data-preset="mrbeast"]  .caption-text .word.active {
      transform: scale(1.12);
    }
    .caption-overlay[data-preset="hormozi"] .caption-text .word.active {
      /* Match the export: bumps -webkit-text-stroke-width by ~1px instead of
         drawing a CSS background box (which the burn-in cant produce). */
      -webkit-text-stroke-width: calc(var(--cap-stroke, 0px) + 1.5px);
    }
    .caption-overlay[data-preset="neon-glow"] .caption-text .word.active {
      -webkit-text-stroke-color: var(--cap-highlight, #39FF14);
    }

    /* MrBeast preset uppercases every word — same as the export's
       word.toUpperCase() transformation. */
    .caption-overlay[data-preset="mrbeast"] .caption-text {
      text-transform: uppercase;
    }

    .preview-note {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-align: center;
      margin-top: -0.25rem;
      margin-bottom: 0.75rem;
      opacity: 0.8;
      letter-spacing: 0.02em;
    }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--border-subtle);
    }

    .tab-button {
      padding: 0.7rem 1rem;
      background: transparent;
      color: var(--text-muted);
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .tab-button:hover {
      color: var(--text);
    }

    .tab-button.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    /* Custom-state pill — shown above the presets grid the moment the user
       deviates from the active preset's defaults via the Customize tab.
       Selecting any preset card clears it. */
    .custom-state-pill {
      display: none;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      background: rgba(108, 58, 237, 0.12);
      border: 1px solid var(--primary);
      border-radius: 999px;
      font-size: 0.75rem;
      color: var(--primary);
      margin-bottom: 0.75rem;
      width: fit-content;
    }
    .custom-state-pill.show { display: inline-flex; }
    .custom-state-pill::before { content: '●'; font-size: 0.6rem; line-height: 1; }

    .presets-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .preset-card {
      background: var(--dark);
      border: 2px solid var(--border-subtle);
      border-radius: 10px;
      padding: 0;
      cursor: pointer;
      transition: all 0.2s;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .preset-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
    }

    .preset-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(108, 58, 237, 0.3);
    }

    .preset-preview {
      width: 100%;
      height: 64px;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem;
      overflow: hidden;
    }

    .preset-preview .preview-text {
      font-size: 0.95rem;
      text-align: center;
      white-space: nowrap;
      max-width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      line-height: 1.1;
    }

    .preset-name {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
      padding: 0.45rem 0.4rem;
      background: var(--dark);
    }
    .preset-card.selected .preset-name {
      color: var(--text);
    }

    /* ----- Per-preset WYSIWYG preview styles -----
       These mirror the styles on /caption-presets so every preset card shows
       what the burned-in caption will actually look like (font, color, stroke,
       glow). Keep size scales aware of the 64px preview container. */

    .preset-card.karaoke .preview-text {
      font-weight: 700; letter-spacing: 0.04em; color: #fff;
    }
    .preset-card.karaoke .word-current {
      background: linear-gradient(90deg, #6C3AED, #FF00FF);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .preset-card.karaoke .word-next { color: #fff; opacity: 0.7; }

    .preset-card.bold-pop .preview-text {
      font-family: 'Impact','Anton','DejaVu Sans',sans-serif;
      font-weight: 900; font-size: 1.25rem; color: #fff;
      -webkit-text-stroke: 2px #000; paint-order: stroke fill;
    }

    .preset-card.minimal .preview-text {
      font-family: 'Helvetica','Liberation Sans','Arial',sans-serif;
      font-weight: 300; font-size: 0.95rem; letter-spacing: 0.1em;
      color: #fff; text-transform: lowercase; opacity: 0.9;
    }

    .preset-card.neon-glow .preview-text {
      font-weight: 600; font-size: 1.05rem;
      color: #39FF14;
      text-shadow:
        0 0 6px #39FF14, 0 0 12px #39FF14,
        0 0 18px #39FF14, 0 0 12px #25F4EE;
      filter: brightness(1.1);
    }

    .preset-card.gradient-wave .preview-text {
      background: linear-gradient(90deg, #FF6B6B, #FF00FF, #25F4EE);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 800; font-size: 1.2rem; letter-spacing: 0.02em;
    }

    .preset-card.typewriter .preview-text {
      font-family: 'Courier New','Liberation Mono',monospace;
      color: #00ff00; font-weight: 600; font-size: 1.05rem;
      letter-spacing: 0.04em;
      text-shadow: 0 0 6px rgba(0,255,0,0.5);
    }

    .preset-card.cinematic .preview-text {
      font-family: 'Georgia','Liberation Serif',serif;
      color: #D4A574; font-weight: 600; font-size: 1.15rem;
      letter-spacing: 0.12em; font-style: italic;
    }

    .preset-card.street .preview-text {
      font-weight: 900; color: #FFFF00;
      font-size: 1.2rem; font-style: italic;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 2px 2px 0 #FF6600, 4px 4px 0 #FF0000, -2px 2px 0 #FF0000;
    }

    .preset-card.hormozi .preview-text {
      font-weight: 900; font-size: 1.2rem; color: #fff;
      text-transform: uppercase; letter-spacing: 0.02em;
    }
    .preset-card.hormozi .word-highlight {
      color: #FACC15; background: rgba(250,204,21,0.15);
      padding: 0 4px; border-radius: 3px;
    }

    .preset-card.mrbeast .preview-text {
      font-family: 'Impact','Anton','DejaVu Sans',sans-serif;
      font-weight: 900; font-size: 1.3rem; color: #FFD700;
      text-transform: uppercase; letter-spacing: 0.025em;
      -webkit-text-stroke: 1.5px #000; paint-order: stroke fill;
      text-shadow: 0 2px 0 #1a1a1a;
    }

    .preset-card.classic-sub .preview-preview { background: #111; }
    .preset-card.classic-sub .preview-text {
      background: rgba(0,0,0,0.78);
      color: #fff; font-weight: 500; font-size: 0.95rem;
      padding: 4px 12px; border-radius: 3px; letter-spacing: 0.02em;
    }

    .preset-card.outline-style .preview-text {
      font-weight: 900; font-size: 1.25rem;
      color: transparent;
      -webkit-text-stroke: 1.5px #fff; paint-order: stroke fill;
      letter-spacing: 0.05em; text-transform: uppercase;
    }

    .preset-card.soft-glow .preview-text {
      color: #fff; font-weight: 600; font-size: 1.1rem;
      text-shadow:
        0 0 8px rgba(255,255,255,0.85),
        0 0 16px rgba(255,255,255,0.4),
        0 0 28px rgba(168,85,247,0.4);
      letter-spacing: 0.04em;
    }

    .preset-card.retro-vhs .preview-text {
      font-family: 'Courier New','Liberation Mono',monospace;
      color: #FF3366; font-weight: 700; font-size: 1.1rem;
      text-transform: uppercase; letter-spacing: 0.12em;
      text-shadow:
        2px 0 #00FFFF, -2px 0 #FF0066,
        0 0 6px rgba(255,51,102,0.45);
    }

    .preset-card.comic .preview-text {
      font-family: 'Comic Sans MS','Chalkboard SE',cursive;
      font-weight: 700; font-size: 1.1rem;
      background: linear-gradient(135deg, #FF6B6B, #FFE66D);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(2px 2px 0 #000);
    }

    .preset-card.fire .preview-text {
      font-family: 'Impact','Anton','DejaVu Sans',sans-serif;
      font-weight: 900; font-size: 1.2rem;
      background: linear-gradient(180deg, #FFD700 0%, #FF6B00 45%, #FF0000 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase; letter-spacing: 0.03em;
      filter: drop-shadow(0 0 6px rgba(255,107,0,0.55));
    }

    .preset-card.clean-modern .preview-text {
      font-weight: 500; font-size: 1.05rem;
      color: #fff; letter-spacing: 0.07em;
      border-bottom: 2px solid #6C3AED;
      padding-bottom: 3px;
    }

    .preset-card.podcast .preview-text {
      font-family: 'Georgia','Liberation Serif',serif;
      color: #e2e8f0; font-weight: 400;
      font-size: 1.05rem; font-style: italic;
      letter-spacing: 0.02em;
      border-left: 3px solid #6C3AED; padding-left: 10px;
    }

    .preset-card.tiktok-trend .preview-text {
      font-weight: 800; font-size: 1.2rem;
      background: linear-gradient(90deg, #25F4EE, #FE2C55);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase; letter-spacing: 0.035em;
    }

    .preset-card.shadow-drop .preview-text {
      font-weight: 800; font-size: 1.2rem; color: #fff;
      text-shadow:
        4px 4px 0 rgba(108,58,237,0.7),
        7px 7px 0 rgba(108,58,237,0.3);
      text-transform: uppercase; letter-spacing: 0.025em;
    }

    .color-picker-group {
      margin-bottom: 1rem;
    }

    .color-picker-group label {
      display: block;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      font-weight: 600;
    }

    .color-input-wrapper {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .color-input {
      width: 50px;
      height: 40px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .color-hex {
      flex: 1;
      padding: 0.6rem;
      background: var(--dark);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.8rem;
      font-family: monospace;
    }

    .slider-group {
      margin-bottom: 1rem;
    }

    .slider-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      font-weight: 600;
    }

    .slider {
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: var(--dark);
      outline: none;
      -webkit-appearance: none;
      appearance: none;
    }

    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--primary);
      cursor: pointer;
    }

    .slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--primary);
      cursor: pointer;
      border: none;
    }

    .progress-bar {
      width: 100%;
      height: 4px;
      background: var(--dark);
      border-radius: 2px;
      overflow: hidden;
      margin: 1rem 0;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6C3AED, #ec4899);
      width: 0%;
      transition: width 0.3s ease;
    }

    .progress-text {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
      margin-top: 0.5rem;
    }

    .actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .btn-secondary {
      flex: 1;
      padding: 0.6rem;
      background: var(--dark);
      color: var(--text);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .btn-secondary:hover {
      border-color: var(--primary);
      color: var(--primary);
    }

    /* State C — the rendered video is ready and the user's eye should go to
       Download. Apply is fully disabled (not just visually) until a new
       Generate Captions cycle reopens the loop, so it can't trigger a
       duplicate export. */
    .btn-state-c {
      padding: 0.6rem 1.2rem;
      background: rgba(40, 40, 56, 0.6);
      color: var(--text-muted);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: not-allowed;
      pointer-events: none;
      opacity: 0.6;
      transition: all 0.2s;
    }

    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1a1a2e;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem 1.5rem;
      font-size: 0.9rem;
      z-index: 1000;
      display: none;
      color: white;
      max-width: 400px;
      animation: slideIn 0.3s ease-out;
    }

    .toast.show {
      display: block;
    }

    .toast.success {
      border-color: #10B981;
      background: #064e3b;
      color: #6ee7b7;
    }

    .toast.error {
      border-color: #EF4444;
      background: #7f1d1d;
      color: #fca5a5;
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .hidden {
      display: none !important;
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 0.5rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 1200px) {
      .editor-area {
        grid-template-columns: 1fr;
      }
      .container {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    <main class="main-content">
      ${themeToggle}

      <div class="container">
          <div class="header">
            <h1>AI Captions</h1>
            <p>Generate beautiful animated captions for your videos</p>
          </div>

          <div class="editor-area">
            <!-- Left: Upload & Preview -->
            <div class="section">
              <div class="section-title">📹 Video</div>

              <div class="upload-zone" id="uploadZone">
                <h3>Upload Video</h3>
                <p>or paste YouTube URL below</p>
                <button type="button" class="btn-primary" onclick="document.getElementById('fileInput').click()">Choose File</button>
                <input type="file" id="fileInput" style="display:none" accept="video/*">
              </div>

              <div class="input-group">
                <label class="input-label">YouTube URL</label>
                <input type="text" class="input-field" id="youtubeUrl" placeholder="youtube.com/watch?v=… or youtube.com/shorts/…">
                <button class="btn-primary" style="width: 100%; margin-top: 0.5rem;" onclick="downloadFromYouTube()">Load Video</button>
              </div>

              <div id="videoPreview" class="hidden">
                <div class="video-wrapper">
                  <video id="videoPlayer" controls playsinline></video>
                  <div class="caption-overlay position-bottom" id="captionOverlay" data-animation="none" data-preset="karaoke" aria-hidden="true">
                    <span class="caption-text" id="captionText"></span>
                  </div>
                </div>
                <div class="preview-note">Live style preview · placeholder text</div>
                <div class="progress-bar hidden" id="progressBar">
                  <div class="progress-fill" id="progressFill"></div>
                </div>
                <div class="progress-text" id="progressText"></div>
              </div>
            </div>

            <!-- Right: Caption Styling -->
            <div class="section">
              <div class="section-title">✨ Caption Styling</div>

              <!-- Presets first, Customize second (single consolidated tab
                   that holds everything from the old Font + Effects tabs). -->
              <div class="tabs">
                <button class="tab-button active" onclick="switchTab('presets')">Presets</button>
                <button class="tab-button" onclick="switchTab('customize')">Customize</button>
              </div>

              <!-- Presets Tab -->
              <div id="presetsTab" class="tab-content active">
                <div class="custom-state-pill" id="customStatePill">
                  Custom — based on <span id="customStateBaseName">Karaoke</span>
                </div>
                <div class="presets-grid" id="presetsGrid"></div>
              </div>

              <!-- Customize Tab — vertical scrolling pane combining Font +
                   Effects controls. Manual changes here flip the Presets tab
                   into a 'Custom' state (deselects the active card). -->
              <div id="customizeTab" class="tab-content">
                <div class="input-group">
                  <label class="input-label">Font Family</label>
                  <select class="select-field" id="fontFamily">
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Impact">Impact</option>
                  </select>
                </div>

                <div class="slider-group">
                  <div class="slider-label">
                    <span>Font Size</span>
                    <span id="fontSizeValue">48</span>
                  </div>
                  <input type="range" class="slider" id="fontSize" min="24" max="80" value="48" onchange="updateFontSize()">
                </div>

                <div class="color-picker-group">
                  <label>Text Color</label>
                  <div class="color-input-wrapper">
                    <input type="color" class="color-input" id="textColor" value="#ffffff" onchange="updateTextColor()">
                    <input type="text" class="color-hex" id="textColorHex" value="FFFFFF" maxlength="6">
                  </div>
                </div>

                <div class="color-picker-group">
                  <label>Outline Color</label>
                  <div class="color-input-wrapper">
                    <input type="color" class="color-input" id="outlineColor" value="#000000" onchange="updateOutlineColor()">
                    <input type="text" class="color-hex" id="outlineColorHex" value="000000" maxlength="6">
                  </div>
                </div>

                <div class="slider-group">
                  <div class="slider-label">
                    <span>Outline Width</span>
                    <span id="outlineWidthValue">2</span>
                  </div>
                  <input type="range" class="slider" id="outlineWidth" min="0" max="8" value="2" onchange="updateOutlineWidth()">
                </div>

                <div class="input-group">
                  <label class="input-label">Animation</label>
                  <select class="select-field" id="animation">
                    <option value="none">None</option>
                    <option value="fade">Fade</option>
                    <option value="slide">Slide</option>
                    <option value="pop">Pop</option>
                    <option value="glow">Glow</option>
                  </select>
                </div>

                <div class="input-group">
                  <label class="input-label">Position</label>
                  <select class="select-field" id="position">
                    <option value="top">Top</option>
                    <option value="center">Center</option>
                    <option value="bottom" selected>Bottom</option>
                  </select>
                </div>

                <div class="color-picker-group">
                  <label>Highlight Color</label>
                  <div class="color-input-wrapper">
                    <input type="color" class="color-input" id="highlightColor" value="#ff00ff" onchange="updateHighlightColor()">
                    <input type="text" class="color-hex" id="highlightColorHex" value="FF00FF" maxlength="6">
                  </div>
                </div>
              </div>

              <div class="actions">
                <button class="btn-primary" style="flex: 1;" id="generateBtn" onclick="generateCaptions()" disabled>
                  <span class="spinner hidden" id="spinner"></span>
                  Generate Captions
                </button>
              </div>
            </div>
          </div>

          <div class="section" style="margin-top: 1rem;">
            <div class="section-title">📥 Export</div>
            <!-- The class on these two buttons is set dynamically by setExportButtonState(). -->
            <button class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem;" id="exportBtn" onclick="exportVideo()" disabled>
              Apply
            </button>
            <button class="btn-secondary" style="width: 100%;" id="downloadBtn" onclick="downloadVideo()" disabled>
              Download Video
            </button>
          </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    ${themeScript}
  </script>

  <script>
    let uploadedVideoPath = null;
    let transcript = null;
    let currentPreset = 'karaoke';
    let generatedVideoPath = null;

    // ===== Live caption preview =====
    const SAMPLE_CAPTION_WORDS = ['This', 'is', 'how', 'your', 'captions', 'will', 'look'];

    // 20-preset library — every entry has:
    //   id        unique key
    //   name      human-readable display name
    //   behavior  which backend bucket drives the per-word \\t() animation
    //             (one of: karaoke, bold-pop, minimal, neon-glow, mrbeast,
    //             hormozi). The export pipeline reads the 'behavior' field
    //             and emits the matching active-word transitions.
    //   cs        full StyleConfig (fontFamily, fontSize, textColor,
    //             outlineColor, outlineWidth, highlightColor, animation,
    //             position) — same shape readCurrentStyle() returns.
    //   sampleWords  optional override for the SAMPLE_CAPTION_WORDS shown
    //             in the live preview (e.g. lowercase variants).
    const PRESET_LIBRARY = [
      { id: 'karaoke',       name: 'Karaoke',       behavior: 'karaoke',
        cs: { fontFamily: 'Arial',           fontSize: 48, textColor: 'FFFFFF', outlineColor: '000000', outlineWidth: 2, highlightColor: 'FF00FF', animation: 'none',  position: 'bottom' } },
      { id: 'bold-pop',      name: 'Bold Pop',      behavior: 'bold-pop',
        cs: { fontFamily: 'Impact',          fontSize: 56, textColor: 'FFFFFF', outlineColor: '000000', outlineWidth: 4, highlightColor: 'FFD700', animation: 'pop',   position: 'bottom' } },
      { id: 'minimal',       name: 'Minimal',       behavior: 'minimal',
        cs: { fontFamily: 'Helvetica',       fontSize: 40, textColor: 'FFFFFF', outlineColor: '000000', outlineWidth: 0, highlightColor: 'FFFFFF', animation: 'fade',  position: 'bottom' } },
      { id: 'neon-glow',     name: 'Neon Glow',     behavior: 'neon-glow',
        cs: { fontFamily: 'Arial',           fontSize: 48, textColor: '39FF14', outlineColor: '00FF00', outlineWidth: 3, highlightColor: '39FF14', animation: 'glow',  position: 'bottom' } },
      { id: 'gradient-wave', name: 'Gradient Wave', behavior: 'karaoke',
        cs: { fontFamily: 'Arial',           fontSize: 50, textColor: 'FF6B6B', outlineColor: '6C3AED', outlineWidth: 2, highlightColor: '25F4EE', animation: 'glow',  position: 'bottom' } },
      { id: 'typewriter',    name: 'Typewriter',    behavior: 'minimal',
        cs: { fontFamily: 'Courier New',     fontSize: 42, textColor: '00FF00', outlineColor: '003300', outlineWidth: 1, highlightColor: '00FF00', animation: 'none',  position: 'bottom' } },
      { id: 'cinematic',     name: 'Cinematic',     behavior: 'minimal',
        cs: { fontFamily: 'Georgia',         fontSize: 44, textColor: 'D4A574', outlineColor: '000000', outlineWidth: 1, highlightColor: 'F0E0C0', animation: 'fade',  position: 'bottom' } },
      { id: 'street',        name: 'Street',        behavior: 'bold-pop',
        cs: { fontFamily: 'Impact',          fontSize: 50, textColor: 'FFFF00', outlineColor: 'FF0000', outlineWidth: 3, highlightColor: 'FF6600', animation: 'pop',   position: 'bottom' } },
      { id: 'hormozi',       name: 'Hormozi',       behavior: 'hormozi',
        cs: { fontFamily: 'Arial',           fontSize: 50, textColor: 'FFFFFF', outlineColor: 'FF0000', outlineWidth: 3, highlightColor: 'FFFF00', animation: 'none',  position: 'bottom' } },
      { id: 'mrbeast',       name: 'MrBeast',       behavior: 'mrbeast',
        cs: { fontFamily: 'Impact',          fontSize: 54, textColor: 'FFD700', outlineColor: '000000', outlineWidth: 5, highlightColor: 'FFFFFF', animation: 'pop',   position: 'bottom' } },
      { id: 'classic-sub',   name: 'Classic',       behavior: 'minimal',
        cs: { fontFamily: 'Arial',           fontSize: 38, textColor: 'FFFFFF', outlineColor: '000000', outlineWidth: 2, highlightColor: 'FFFFFF', animation: 'none',  position: 'bottom' } },
      { id: 'outline-style', name: 'Outline',       behavior: 'minimal',
        cs: { fontFamily: 'Impact',          fontSize: 52, textColor: '000000', outlineColor: 'FFFFFF', outlineWidth: 4, highlightColor: 'FFFFFF', animation: 'none',  position: 'bottom' } },
      { id: 'soft-glow',     name: 'Soft Glow',     behavior: 'karaoke',
        cs: { fontFamily: 'Arial',           fontSize: 46, textColor: 'FFFFFF', outlineColor: 'A855F7', outlineWidth: 2, highlightColor: 'A855F7', animation: 'glow',  position: 'bottom' } },
      { id: 'retro-vhs',     name: 'Retro VHS',     behavior: 'karaoke',
        cs: { fontFamily: 'Courier New',     fontSize: 44, textColor: 'FF3366', outlineColor: '00FFFF', outlineWidth: 2, highlightColor: 'FF0066', animation: 'none',  position: 'bottom' } },
      { id: 'comic',         name: 'Comic',         behavior: 'bold-pop',
        cs: { fontFamily: 'Verdana',         fontSize: 46, textColor: 'FFE66D', outlineColor: '000000', outlineWidth: 4, highlightColor: 'FF6B6B', animation: 'pop',   position: 'bottom' } },
      { id: 'fire',          name: 'Fire',          behavior: 'bold-pop',
        cs: { fontFamily: 'Impact',          fontSize: 52, textColor: 'FF6B00', outlineColor: '000000', outlineWidth: 4, highlightColor: 'FFD700', animation: 'glow',  position: 'bottom' } },
      { id: 'clean-modern',  name: 'Clean Modern',  behavior: 'karaoke',
        cs: { fontFamily: 'Helvetica',       fontSize: 44, textColor: 'FFFFFF', outlineColor: '000000', outlineWidth: 1, highlightColor: '6C3AED', animation: 'none',  position: 'bottom' } },
      { id: 'podcast',       name: 'Podcast',       behavior: 'minimal',
        cs: { fontFamily: 'Georgia',         fontSize: 40, textColor: 'E2E8F0', outlineColor: '000000', outlineWidth: 1, highlightColor: '6C3AED', animation: 'fade',  position: 'bottom' } },
      { id: 'tiktok-trend',  name: 'TikTok Trend',  behavior: 'mrbeast',
        cs: { fontFamily: 'Impact',          fontSize: 52, textColor: '25F4EE', outlineColor: '000000', outlineWidth: 4, highlightColor: 'FE2C55', animation: 'pop',   position: 'bottom' } },
      { id: 'shadow-drop',   name: 'Shadow Drop',   behavior: 'bold-pop',
        cs: { fontFamily: 'Impact',          fontSize: 50, textColor: 'FFFFFF', outlineColor: '6C3AED', outlineWidth: 4, highlightColor: 'A855F7', animation: 'pop',   position: 'bottom' } }
    ];

    // Build a quick lookup so selectPreset and exportVideo can grab by id.
    const PRESET_BY_ID = Object.fromEntries(PRESET_LIBRARY.map(p => [p.id, p]));

    // PRESET_DEFAULTS retained as a thin compatibility shim — anything that
    // still reads PRESET_DEFAULTS[id] gets the cs object directly.
    const PRESET_DEFAULTS = Object.fromEntries(PRESET_LIBRARY.map(p => [p.id, p.cs]));

    let previewCycleInterval = null;
    let previewActiveIdx = 0;
    // True the moment the user changes anything in Customize after picking
    // a preset. Clears whenever a preset card is clicked. Drives the Custom
    // pill in the Presets tab and signals exportVideo() to send raw
    // customSettings without claiming a preset.
    let isCustomized = false;

    // Initialize presets grid — every card is a true WYSIWYG preview that
    // uses the actual preset CSS class so the user sees how the captions
    // will render before clicking. The card's preview text is the standard
    // sample sentence styled per-preset.
    function initPresets() {
      const grid = document.getElementById('presetsGrid');
      const sample = 'CAPTIONS';
      const sampleLower = 'captions';

      grid.innerHTML = PRESET_LIBRARY.map(p => {
        const isStartSelected = p.id === 'karaoke';
        // Each preset gets its own preview text variant matching what its
        // burned output would look like (uppercase for shouty presets,
        // lowercase for minimal / podcast).
        const previewText = (() => {
          switch (p.id) {
            case 'minimal':
            case 'typewriter':
            case 'podcast':
            case 'cinematic':
              return sampleLower;
            case 'karaoke':
              // Two-word karaoke effect to show the gradient/highlight rolling
              return '<span class="word-current">CAPTIONS</span>';
            case 'hormozi':
              return 'YOU <span class="word-highlight">WIN</span>';
            default:
              return sample;
          }
        })();
        return '<div class="preset-card ' + p.id + (isStartSelected ? ' selected' : '') + '" data-preset-id="' + p.id + '" title="' + p.name + '">'
          + '<div class="preset-preview"><div class="preview-text">' + previewText + '</div></div>'
          + '<div class="preset-name">' + p.name + '</div>'
          + '</div>';
      }).join('');

      // Click handlers
      grid.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => selectPreset(card.dataset.presetId, card));
      });
    }

    function selectPreset(presetId, clickedCard) {
      const p = PRESET_BY_ID[presetId];
      if (!p) return;
      currentPreset = presetId;
      isCustomized = false;
      hideCustomPill();

      // Visually mark the selected card
      document.querySelectorAll('.preset-card').forEach(card => card.classList.remove('selected'));
      const card = clickedCard || document.querySelector('.preset-card[data-preset-id="' + presetId + '"]');
      if (card) card.classList.add('selected');

      // Sync the Customize controls to this preset's StyleConfig — the
      // suppressCustomFlag flag stops the change events from immediately
      // re-marking the state as 'Custom'.
      window.__suppressCustomFlag = true;
      try {
        const cs = p.cs;
        setSelectValue('fontFamily', cs.fontFamily);
        setRangeValue('fontSize', cs.fontSize, 'fontSizeValue');
        setColorValue('textColor', 'textColorHex', cs.textColor);
        setColorValue('outlineColor', 'outlineColorHex', cs.outlineColor);
        setRangeValue('outlineWidth', cs.outlineWidth, 'outlineWidthValue');
        setColorValue('highlightColor', 'highlightColorHex', cs.highlightColor);
        setSelectValue('animation', cs.animation);
        setSelectValue('position', cs.position);
      } finally {
        window.__suppressCustomFlag = false;
      }
      updateCaptionPreview();
    }

    // Called whenever a Customize control changes. Marks the current state
    // as 'Custom' (deselects the active preset card, shows the pill).
    function markCustomIfManual() {
      if (window.__suppressCustomFlag) return;
      if (isCustomized) return;
      isCustomized = true;
      const baseName = (PRESET_BY_ID[currentPreset] || {}).name || 'Karaoke';
      document.querySelectorAll('.preset-card').forEach(card => card.classList.remove('selected'));
      const pill = document.getElementById('customStatePill');
      const baseSpan = document.getElementById('customStateBaseName');
      if (baseSpan) baseSpan.textContent = baseName;
      if (pill) pill.classList.add('show');
    }
    function hideCustomPill() {
      const pill = document.getElementById('customStatePill');
      if (pill) pill.classList.remove('show');
    }

    function setSelectValue(id, value) {
      const el = document.getElementById(id);
      if (!el) return;
      // Try exact match; fall back to lower-case; leave alone if not found
      const opts = Array.from(el.options).map(o => o.value);
      if (opts.includes(value)) el.value = value;
      else if (opts.includes(String(value).toLowerCase())) el.value = String(value).toLowerCase();
    }

    function setRangeValue(id, value, labelId) {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      if (labelId) document.getElementById(labelId).textContent = value;
    }

    function setColorValue(colorId, hexId, hex) {
      const colorEl = document.getElementById(colorId);
      const hexEl = document.getElementById(hexId);
      if (hexEl) hexEl.value = String(hex).toUpperCase();
      if (colorEl) colorEl.value = '#' + String(hex).toLowerCase();
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      document.getElementById(tabName + 'Tab').classList.add('active');
      event.currentTarget.classList.add('active');
    }

    function updateFontSize() {
      const value = document.getElementById('fontSize').value;
      document.getElementById('fontSizeValue').textContent = value;
      updateCaptionPreview();
    }

    function updateTextColor() {
      const color = document.getElementById('textColor').value.slice(1);
      document.getElementById('textColorHex').value = color.toUpperCase();
      updateCaptionPreview();
    }

    function updateOutlineColor() {
      const color = document.getElementById('outlineColor').value.slice(1);
      document.getElementById('outlineColorHex').value = color.toUpperCase();
      updateCaptionPreview();
    }

    function updateOutlineWidth() {
      const value = document.getElementById('outlineWidth').value;
      document.getElementById('outlineWidthValue').textContent = value;
      updateCaptionPreview();
    }

    function updateHighlightColor() {
      const color = document.getElementById('highlightColor').value.slice(1);
      document.getElementById('highlightColorHex').value = color.toUpperCase();
      updateCaptionPreview();
    }

    // ===== Live preview renderer =====
    // Browser font stacks that mirror what libass actually picks up server-side
    // (see FONT_ALIAS in routes/ai-captions.js). Without this, the user sees
    // their OS's local font in the preview but the export uses Liberation Sans
    // / DejaVu Sans, and the two diverge — especially for 'Impact' on Mac and
    // 'Helvetica' on Linux.
    const PREVIEW_FONT_STACK_MAP = {
      'Arial':           "'Arial','Liberation Sans',sans-serif",
      'Helvetica':       "'Helvetica','Liberation Sans','Arial',sans-serif",
      'Times New Roman': "'Times New Roman','Liberation Serif',serif",
      'Courier New':     "'Courier New','Liberation Mono',monospace",
      'Georgia':         "'Georgia','Liberation Serif',serif",
      'Verdana':         "'Verdana','DejaVu Sans',sans-serif",
      // Impact -> Anton (Google Fonts) is the closest free condensed sans we
      // can get the server to install. Keep Impact first so Windows users
      // (who actually have Impact) still see it; everyone else falls through
      // to Anton, which the server also uses for libass output.
      'Impact':          "'Impact','Anton','Liberation Sans Condensed','DejaVu Sans',sans-serif"
    };
    function previewFontStack(uiFont) {
      return PREVIEW_FONT_STACK_MAP[uiFont] || "'" + uiFont + "',sans-serif";
    }

    // Convert the user's outline-width slider value into pixels for
    // -webkit-text-stroke. The slider value 0..8 corresponds to libass Outline
    // units; libass scales them with the rendered font size, so the preview
    // does the same: stroke is a fraction of the live font pixel size.
    function previewStrokeWidth(outlineUnits, fontPx) {
      const w = Math.max(0, Math.min(8, parseInt(outlineUnits, 10) || 0));
      if (!w) return 0;
      // Tuned so 1 ASS unit ~= 0.04 * fontSize, which matches libass output
      // visually within ±1 px across the slider range we offer.
      return +(fontPx * 0.04 * w).toFixed(2);
    }

    // Legacy text-shadow outline kept for any other caller; the live preview
    // now uses previewStrokeWidth() above.
    function buildTextShadow(colorHex, width) {
      const w = Math.max(0, Math.min(8, parseInt(width, 10) || 0));
      if (!w) return 'none';
      const color = '#' + colorHex;
      const parts = [];
      // 8-direction outline at each pixel from 1..w
      for (let r = 1; r <= w; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            parts.push(dx + 'px ' + dy + 'px 0 ' + color);
          }
        }
      }
      return parts.join(', ');
    }

    function readCurrentStyle() {
      return {
        preset: currentPreset,
        fontFamily: document.getElementById('fontFamily').value,
        fontSize: parseInt(document.getElementById('fontSize').value, 10) || 48,
        textColor: (document.getElementById('textColorHex').value || 'FFFFFF').replace('#',''),
        outlineColor: (document.getElementById('outlineColorHex').value || '000000').replace('#',''),
        outlineWidth: parseInt(document.getElementById('outlineWidth').value, 10) || 0,
        highlightColor: (document.getElementById('highlightColorHex').value || 'FF00FF').replace('#',''),
        animation: document.getElementById('animation').value,
        position: document.getElementById('position').value
      };
    }

    function renderSampleWords(textEl) {
      if (textEl.dataset.rendered === '1') return;
      textEl.innerHTML = SAMPLE_CAPTION_WORDS
        .map(w => '<span class="word">' + w + '</span>')
        .join(' ');
      textEl.dataset.rendered = '1';
      previewActiveIdx = 0;
      highlightWord(0);
    }

    function highlightWord(idx) {
      const textEl = document.getElementById('captionText');
      if (!textEl) return;
      const words = textEl.querySelectorAll('.word');
      if (!words.length) return;
      words.forEach((w, i) => w.classList.toggle('active', i === (idx % words.length)));
    }

    function startPreviewCycle() {
      if (previewCycleInterval) return;
      previewCycleInterval = setInterval(() => {
        previewActiveIdx = (previewActiveIdx + 1) % SAMPLE_CAPTION_WORDS.length;
        highlightWord(previewActiveIdx);
      }, 520);
    }

    function stopPreviewCycle() {
      if (previewCycleInterval) {
        clearInterval(previewCycleInterval);
        previewCycleInterval = null;
      }
    }

    function updateCaptionPreview() {
      const overlay = document.getElementById('captionOverlay');
      const textEl = document.getElementById('captionText');
      const videoPlayer = document.getElementById('videoPlayer');
      if (!overlay || !textEl || !videoPlayer) return;

      renderSampleWords(textEl);

      const style = readCurrentStyle();

      // Match the export's ASS PlayResY=1080 reference so the preview text
      // height tracks the burn-in size at the same proportion. ASS scales
      // Fontsize relative to PlayResY when ScaledBorderAndShadow=yes, so
      // previewPx = fontSize * (videoH / 1080) is the right mapping.
      const videoH = videoPlayer.clientHeight || videoPlayer.offsetHeight || 360;
      const previewPx = Math.max(10, Math.min(96, style.fontSize * (videoH / 1080)));

      textEl.style.fontFamily = previewFontStack(style.fontFamily);
      textEl.style.fontSize = previewPx.toFixed(1) + 'px';
      textEl.style.color = '#' + style.textColor;
      // libass renders Outline as a true vector stroke around each glyph. Stacked
      // text-shadows give a chunky pixelated approximation that drifts further
      // from the real export the wider the outline gets, so we lean on
      // -webkit-text-stroke + paint-order:stroke-fill, which is the closest
      // browser primitive to libass's behaviour.
      const strokePx = previewStrokeWidth(style.outlineWidth, previewPx);
      textEl.style.webkitTextStroke = strokePx + 'px #' + style.outlineColor;
      textEl.style.paintOrder = 'stroke fill';
      // Wipe the legacy text-shadow path so a re-render that sets stroke=0 looks
      // genuinely strokeless instead of inheriting an old shadow.
      textEl.style.textShadow = 'none';
      // Expose stroke width as a CSS var so per-preset active rules (hormozi)
      // can use calc(var(--cap-stroke) + 1.5px) for the +1 outline bump on
      // the active word, matching the exports bord+1 behaviour.
      overlay.style.setProperty('--cap-stroke', strokePx + 'px');

      overlay.style.setProperty('--cap-highlight', '#' + style.highlightColor);
      overlay.setAttribute('data-animation', style.animation || 'none');
      overlay.setAttribute('data-preset', style.preset || 'karaoke');

      overlay.classList.remove('position-top', 'position-center', 'position-bottom');
      overlay.classList.add('position-' + (style.position || 'bottom'));

      startPreviewCycle();
    }

    function showCaptionPreview() {
      const overlay = document.getElementById('captionOverlay');
      if (overlay) overlay.style.display = '';
      // Defer so the video element has laid out and clientHeight is non-zero
      requestAnimationFrame(() => updateCaptionPreview());
    }

    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function updateProgress(percent, text) {
      const bar = document.getElementById('progressBar');
      const fill = document.getElementById('progressFill');
      const textEl = document.getElementById('progressText');
      bar.classList.remove('hidden');
      fill.style.width = percent + '%';
      textEl.textContent = text;
    }

    // File upload handler
    document.getElementById('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('video', file);

      updateProgress(10, 'Uploading video...');
      try {
        const res = await fetch('/ai-captions/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        uploadedVideoPath = data.videoPath;
        updateProgress(80, 'Loading video...');

        const videoPlayer = document.getElementById('videoPlayer');
        videoPlayer.src = data.serveUrl;
        document.getElementById('videoPreview').classList.remove('hidden');
        document.getElementById('uploadZone').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
        showCaptionPreview();

        showToast('Video uploaded successfully!', 'success');
        updateProgress(100, 'Ready');
        setTimeout(() => document.getElementById('progressBar').classList.add('hidden'), 1000);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // YouTube download handler
    async function downloadFromYouTube() {
      const url = document.getElementById('youtubeUrl').value.trim();
      if (!url) {
        showToast('Please enter a YouTube URL', 'error');
        return;
      }

      updateProgress(10, 'Downloading video...');
      try {
        const res = await fetch('/ai-captions/download-yt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Download failed');

        uploadedVideoPath = data.videoPath;
        updateProgress(80, 'Loading video...');

        const videoPlayer = document.getElementById('videoPlayer');
        videoPlayer.src = data.serveUrl;
        document.getElementById('videoPreview').classList.remove('hidden');
        document.getElementById('uploadZone').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
        showCaptionPreview();

        showToast('Video downloaded successfully!', 'success');
        updateProgress(100, 'Ready');
        setTimeout(() => document.getElementById('progressBar').classList.add('hidden'), 1000);
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    // Generate captions
    async function generateCaptions() {
      if (!uploadedVideoPath) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const btn = document.getElementById('generateBtn');
      const spinner = document.getElementById('spinner');
      const originalText = btn.innerHTML;
      btn.disabled = true;
      spinner.classList.remove('hidden');
      btn.querySelector('span:not(.spinner)') || (btn.childNodes.forEach(function(n) { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = ' Generating...'; }));

      updateProgress(20, 'Extracting transcript...');
      try {
        const res = await fetch('/ai-captions/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: uploadedVideoPath })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Generation failed');

        transcript = data.transcript;
        updateProgress(100, 'Transcript ready!');
        showToast('Captions generated! Now click Apply.', 'success');
        // State B — captions are now ready, the next thing the user should do
        // is hit Apply, so it should be the prominent purple action.
        setExportButtonState('B');
      } catch (err) {
        showToast('Caption generation failed: ' + err.message, 'error');
        updateProgress(0, '');
      } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
        btn.innerHTML = originalText;
        setTimeout(() => document.getElementById('progressBar').classList.add('hidden'), 1500);
      }
    }

    // Export video with captions
    async function exportVideo() {
      if (!uploadedVideoPath || !transcript) {
        showToast('Please generate captions first', 'error');
        return;
      }

      const btn = document.getElementById('exportBtn');
      btn.disabled = true;

      updateProgress(30, 'Applying captions...');
      try {
        // SHARED StyleConfig — same values the live preview is currently rendering.
        // This is the only place we should be sourcing export style from; never
        // re-read individual DOM fields here or preview/export will drift.
        const live = readCurrentStyle();
        const customSettings = {
          fontFamily: live.fontFamily,
          fontSize: live.fontSize,
          fontColor: live.textColor,        // backend uses "fontColor"; UI calls it "textColor"
          outlineColor: live.outlineColor,
          outlineWidth: live.outlineWidth,
          highlightColor: live.highlightColor,
          animation: live.animation,
          position: live.position
        };

        // The backend understands a fixed set of "behavior buckets" that
        // drive per-word \\t() animation patterns (karaoke / bold-pop /
        // minimal / neon-glow / mrbeast / hormozi). New presets in the
        // 20-preset library map to one of those via PRESET_BY_ID[id].behavior;
        // we send THAT, not the raw preset id, so a card like 'gradient-wave'
        // still gets a real per-word transition. Custom state defaults to
        // karaoke since the active-word color flip is the safest baseline.
        const presetMeta = PRESET_BY_ID[currentPreset];
        const backendBehavior = (presetMeta && presetMeta.behavior) || 'karaoke';
        console.log('[AI Captions] export StyleConfig =>', { presetId: currentPreset, backendBehavior, isCustomized, customSettings });

        const res = await fetch('/ai-captions/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: uploadedVideoPath,
            transcript: transcript,
            preset: backendBehavior,
            customSettings: customSettings
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Export failed');

        generatedVideoPath = data.outputPath;
        updateProgress(100, 'Complete!');
        showToast('Captions applied!', 'success');
        // State C — the rendered video is now ready. Pull the user's eye to
        // Download (purple) and step the Apply button back to a dark/disabled
        // look. The user can still re-apply with new settings if they want.
        setExportButtonState('C');
      } catch (err) {
        showToast(err.message, 'error');
        // Apply failed — return to State B so the user can retry.
        setExportButtonState('B');
      } finally {
        setTimeout(() => document.getElementById('progressBar').classList.add('hidden'), 1000);
      }
    }

    // Download video
    async function downloadVideo() {
      if (!generatedVideoPath) {
        showToast('Please click Apply first to render your captions.', 'error');
        return;
      }

      try {
        showToast('Starting download...', 'success');
        const response = await fetch(generatedVideoPath);
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'captions-video.mp4';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast('Download failed: ' + err.message, 'error');
      }
    }

    // ===== Wire live-preview listeners =====
    function bindPreviewListeners() {
      // Selects — every change in Customize also flips the Custom indicator
      // unless suppressed (which selectPreset does while it syncs values).
      ['fontFamily', 'animation', 'position'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { markCustomIfManual(); updateCaptionPreview(); });
      });

      // Color pickers — fire on 'input' for smooth live dragging
      [['textColor','textColorHex'], ['outlineColor','outlineColorHex'], ['highlightColor','highlightColorHex']].forEach(([colorId, hexId]) => {
        const c = document.getElementById(colorId);
        const h = document.getElementById(hexId);
        if (c) c.addEventListener('input', () => {
          document.getElementById(hexId).value = c.value.slice(1).toUpperCase();
          markCustomIfManual();
          updateCaptionPreview();
        });
        if (h) h.addEventListener('input', () => {
          const v = h.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
          if (v.length === 6 && c) c.value = '#' + v.toLowerCase();
          markCustomIfManual();
          updateCaptionPreview();
        });
      });

      // Sliders — live updates as the user drags
      ['fontSize', 'outlineWidth'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
          const labelId = id + 'Value';
          const label = document.getElementById(labelId);
          if (label) label.textContent = el.value;
          markCustomIfManual();
          updateCaptionPreview();
        });
      });

      // Recompute when the video lays out or window resizes
      const videoPlayer = document.getElementById('videoPlayer');
      if (videoPlayer) {
        videoPlayer.addEventListener('loadedmetadata', () => requestAnimationFrame(updateCaptionPreview));
        videoPlayer.addEventListener('resize', () => requestAnimationFrame(updateCaptionPreview));
      }
      window.addEventListener('resize', () => requestAnimationFrame(updateCaptionPreview));
    }

    // ===== Export-section button state machine =====
    // Three states drive the Apply / Download Video pair so the user always
    // knows what the next click should be:
    //   A = pre-generation     -> both look like neutral secondary buttons
    //   B = captions ready     -> Apply becomes the primary purple CTA
    //   C = post-processing    -> Apply steps back (locked), Download becomes purple
    function setExportButtonState(state) {
      const exportBtn = document.getElementById('exportBtn');
      const downloadBtn = document.getElementById('downloadBtn');
      if (!exportBtn || !downloadBtn) return;

      // Strip any state classes so the new state's class wins regardless of
      // whatever was set previously.
      ['btn-primary', 'btn-secondary', 'btn-state-c'].forEach(c => {
        exportBtn.classList.remove(c);
        downloadBtn.classList.remove(c);
      });

      switch (state) {
        case 'A': // pre-generation
          exportBtn.classList.add('btn-secondary');
          downloadBtn.classList.add('btn-secondary');
          exportBtn.disabled = true;
          downloadBtn.disabled = true;
          break;
        case 'B': // captions ready, Apply is the next action
          exportBtn.classList.add('btn-primary');
          downloadBtn.classList.add('btn-secondary');
          exportBtn.disabled = false;
          downloadBtn.disabled = true;
          break;
        case 'C': // export complete, Download is the next action
          exportBtn.classList.add('btn-state-c');
          downloadBtn.classList.add('btn-primary');
          // Apply is fully locked until a new Generate Captions cycle reopens
          // it (going back to State B). Both the disabled attribute and
          // pointer-events (set in .btn-state-c CSS) are used so a stray
          // click cant fire it.
          exportBtn.disabled = true;
          downloadBtn.disabled = false;
          break;
      }
    }

    // Initialize
    initPresets();
    bindPreviewListeners();
    setExportButtonState('A');
  </script>
</body>
</html>`;

  res.send(html);
});

// POST: Upload video file
// Serve uploaded/processed video files
router.get('/serve/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;
  // Check both upload and output directories
  let filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) filePath = path.join(outputDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(filePath).pipe(res);
});

// QA-only: extract a single JPEG frame from a /tmp/repurpose-* file at ?t=<seconds>
// Used by Live QA tooling to verify burned-in captions are rendering as expected.
// Confined to uploadDir/outputDir + .mp4 only — no path traversal possible.
router.get('/qa-frame/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!/^[A-Za-z0-9._-]+\.mp4$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    let filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const t = Math.max(0, parseFloat(req.query.t) || 1.0);
    const outJpg = path.join(outputDir, `qa-frame-${uuidv4()}.jpg`);

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-ss', String(t),
        '-i', filePath,
        '-frames:v', '1',
        '-q:v', '3',
        '-y', outJpg
      ]);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code + ': ' + stderr.slice(-300))));
      proc.on('error', reject);
    });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(outJpg);
    stream.pipe(res);
    stream.on('close', () => { try { fs.unlinkSync(outJpg); } catch (e) {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Rename to a predictable filename so we can serve it
    const ext = path.extname(req.file.originalname) || '.mp4';
    const newFilename = 'caption-upload-' + Date.now() + ext;
    const newPath = path.join(uploadDir, newFilename);
    fs.renameSync(req.file.path, newPath);

    res.json({
      videoPath: newPath,
      serveUrl: '/ai-captions/serve/' + newFilename
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Download YouTube video
router.post('/download-yt', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const videoPath = await downloadYouTubeVideo(url);
    const filename = path.basename(videoPath);

    res.json({
      videoPath,
      serveUrl: '/ai-captions/serve/' + filename
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Generate transcript from video
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { videoPath } = req.body;
    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video not found' });
    }

    // Extract audio as MP3 (stays under Whisper's 25MB limit)
    const audioBasePath = path.join(uploadDir, `audio-${uuidv4()}.wav`);
    const actualAudioPath = await extractAudio(videoPath, audioBasePath);

    // Transcribe with Whisper
    const transcript = await transcribeAudio(actualAudioPath);

    // Clean up
    try { fs.unlinkSync(actualAudioPath); } catch (e) {}

    res.json({ transcript });
    featureUsageOps.log(req.user.id, 'ai_captions').catch(() => {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Apply captions to video and burn subtitles
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { videoPath, transcript, preset, customSettings } = req.body;

    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video not found' });
    }

    if (!transcript || !Array.isArray(transcript)) {
      return res.status(400).json({ error: 'Invalid transcript' });
    }

    const presetKey = preset || 'karaoke';
    const assPath = path.join(uploadDir, `captions-${uuidv4()}.ass`);
    const assContent = generateASSFile(transcript, presetKey, customSettings);
    fs.writeFileSync(assPath, assContent, 'utf8');

    // Burn subtitles into video
    const outputPath = path.join(outputDir, `captions-${uuidv4()}.mp4`);
    await burnSubtitles(videoPath, assPath, outputPath);

    // Clean up ASS file
    try { fs.unlinkSync(assPath); } catch (e) {}

    // Generate serve URL using our serve endpoint
    const filename = path.basename(outputPath);

    res.json({
      outputPath: '/ai-captions/serve/' + filename,
      videoPath: outputPath
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
