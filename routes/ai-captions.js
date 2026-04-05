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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    animation: 'highlight'
  }
};

// Helper: Validate YouTube URL
function isValidYouTubeUrl(url) {
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
    /^(https?:\/\/)?youtu\.be\/[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/,
  ];
  return patterns.some(p => p.test(url.trim()));
}

// Helper: Extract YouTube video ID
function extractVideoId(url) {
  const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([\w-]+)/);
  return match ? match[1] : null;
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
          '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
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

// Helper: Convert color to ASS hex format (BGR)
function colorToASS(hexColor) {
  // Input: RRGGBB, Output: &HBBGGRR&
  if (!hexColor || hexColor.length !== 6) return '&H000000&';
  const r = hexColor.slice(0, 2);
  const g = hexColor.slice(2, 4);
  const b = hexColor.slice(4, 6);
  return `&H${b}${g}${r}&`;
}

// Helper: Generate ASS subtitles file with captions
function generateASSFile(transcript, preset, customSettings = {}) {
  const style = captionPresets[preset] || captionPresets.karaoke;

  // Apply custom overrides
  const fontSize = customSettings.fontSize || style.fontSize;
  const fontColor = customSettings.fontColor || style.fontColor;
  const outlineColor = customSettings.outlineColor || style.outlineColor;
  const position = customSettings.position || 'bottom';
  const fontFamily = customSettings.fontFamily || style.fontName;

  // Map position to ASS alignment (numpad style: 1-9)
  const alignmentMap = {
    top: 8,
    center: 5,
    bottom: 2
  };
  const alignment = alignmentMap[position] || 2;

  let assContent = `[Script Info]
Title: AI Captions
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${colorToASS(fontColor)},&H00FFFFFF&,${colorToASS(outlineColor)},&H00000000&,-1,0,0,0,100,100,0,0,1,${style.outlineWidth},${style.shadowDepth},${alignment},10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Build subtitle lines with word-by-word timing
  let currentTime = 0;
  const lines = [];

  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    const word = item.word || '';
    const startTime = item.start || currentTime;
    const endTime = item.end || (currentTime + 1);
    currentTime = endTime;

    // Convert seconds to ASS time format (h:mm:ss.cc)
    const formatTime = (seconds) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const cents = Math.floor((seconds % 1) * 100);
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
    };

    const startASS = formatTime(startTime);
    const endASS = formatTime(endTime);

    // Build text with effects based on preset
    let textLine = word;

    if (preset === 'karaoke') {
      // Karaoke: highlight current word with gradient
      const duration = Math.round((endTime - startTime) * 100);
      textLine = `{\\k${duration}}${word}`;
    } else if (preset === 'bold-pop') {
      // Bold pop: scale effect
      textLine = `{\\fscx110\\fscy110\\t(${Math.round((startTime + 0.1) * 100)},${Math.round(endTime * 100)},\\fscx100\\fscy100)}${word}`;
    } else if (preset === 'mrbeast') {
      // MrBeast: all caps with pop
      textLine = `{\\fscx115\\fscy115\\t(${Math.round((startTime + 0.1) * 100)},${Math.round(endTime * 100)},\\fscx100\\fscy100)}${word.toUpperCase()}`;
    }

    lines.push(`Dialogue: 0,${startASS},${endASS},Default,,0,0,0,,${textLine}`);
  }

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

    .video-preview {
      background: #000000;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 1rem;
      max-width: 100%;
      height: auto;
    }

    .video-preview video {
      width: 100%;
      height: auto;
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
      padding: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .preset-card:hover {
      border-color: var(--primary);
    }

    .preset-card.selected {
      border-color: var(--primary);
      background: rgba(108, 58, 237, 0.1);
    }

    .preset-preview {
      width: 100%;
      height: 50px;
      background: #000000;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.5rem;
      color: white;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .preset-name {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-align: center;
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
                <input type="text" class="input-field" id="youtubeUrl" placeholder="https://youtube.com/watch?v=...">
                <button class="btn-primary" style="width: 100%; margin-top: 0.5rem;" onclick="downloadFromYouTube()">Load Video</button>
              </div>

              <div id="videoPreview" class="hidden">
                <video class="video-preview" id="videoPlayer" controls></video>
                <div class="progress-bar hidden" id="progressBar">
                  <div class="progress-fill" id="progressFill"></div>
                </div>
                <div class="progress-text" id="progressText"></div>
              </div>
            </div>

            <!-- Right: Caption Styling -->
            <div class="section">
              <div class="section-title">✨ Caption Styling</div>

              <div class="tabs">
                <button class="tab-button active" onclick="switchTab('presets')">Presets</button>
                <button class="tab-button" onclick="switchTab('font')">Font</button>
                <button class="tab-button" onclick="switchTab('effects')">Effects</button>
              </div>

              <!-- Presets Tab -->
              <div id="presetsTab" class="tab-content active">
                <div class="presets-grid" id="presetsGrid"></div>
              </div>

              <!-- Font Tab -->
              <div id="fontTab" class="tab-content">
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
              </div>

              <!-- Effects Tab -->
              <div id="effectsTab" class="tab-content">
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
            <button class="btn-primary" style="width: 100%; margin-bottom: 0.5rem;" id="exportBtn" onclick="exportVideo()" disabled>
              Apply & Export
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

    // Initialize presets grid
    function initPresets() {
      const presetsData = [
        { id: 'karaoke', name: 'Karaoke', preview: 'HELLO' },
        { id: 'bold-pop', name: 'Bold Pop', preview: 'HELLO' },
        { id: 'minimal', name: 'Minimal', preview: 'hello' },
        { id: 'neon-glow', name: 'Neon Glow', preview: 'HELLO' },
        { id: 'mrbeast', name: 'MrBeast', preview: 'HELLO' },
        { id: 'hormozi', name: 'Hormozi', preview: 'HELLO' }
      ];

      const grid = document.getElementById('presetsGrid');
      grid.innerHTML = presetsData.map(p => \`
        <div class="preset-card \${p.id === 'karaoke' ? 'selected' : ''}" onclick="selectPreset('\${p.id}')">
          <div class="preset-preview">\${p.preview}</div>
          <div class="preset-name">\${p.name}</div>
        </div>
      \`).join('');
    }

    function selectPreset(presetId) {
      currentPreset = presetId;
      document.querySelectorAll('.preset-card').forEach(card => {
        card.classList.remove('selected');
      });
      event.currentTarget.classList.add('selected');
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
    }

    function updateTextColor() {
      const color = document.getElementById('textColor').value.slice(1);
      document.getElementById('textColorHex').value = color.toUpperCase();
    }

    function updateOutlineColor() {
      const color = document.getElementById('outlineColor').value.slice(1);
      document.getElementById('outlineColorHex').value = color.toUpperCase();
    }

    function updateOutlineWidth() {
      const value = document.getElementById('outlineWidth').value;
      document.getElementById('outlineWidthValue').textContent = value;
    }

    function updateHighlightColor() {
      const color = document.getElementById('highlightColor').value.slice(1);
      document.getElementById('highlightColorHex').value = color.toUpperCase();
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
        showToast('Captions generated! Now click Apply & Export.', 'success');
        document.getElementById('exportBtn').disabled = false;
        document.getElementById('downloadBtn').disabled = false;
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
        const customSettings = {
          fontSize: parseInt(document.getElementById('fontSize').value),
          fontColor: document.getElementById('textColorHex').value,
          outlineColor: document.getElementById('outlineColorHex').value,
          position: document.getElementById('position').value,
          fontFamily: document.getElementById('fontFamily').value
        };

        const res = await fetch('/ai-captions/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: uploadedVideoPath,
            transcript: transcript,
            preset: currentPreset,
            customSettings: customSettings
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Export failed');

        generatedVideoPath = data.outputPath;
        updateProgress(100, 'Complete!');
        showToast('Captions applied!', 'success');
        document.getElementById('downloadBtn').disabled = false;
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        setTimeout(() => document.getElementById('progressBar').classList.add('hidden'), 1000);
      }
    }

    // Download video
    async function downloadVideo() {
      if (!generatedVideoPath) {
        showToast('Please apply & export captions first', 'error');
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

    // Initialize
    initPresets();
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
