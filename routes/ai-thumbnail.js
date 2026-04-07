const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// Lazy-load ytdl-core
let ytdl, ytdlError;
try { ytdl = require('@distube/ytdl-core'); } catch (e) { ytdlError = e.message; }

// Find ffmpeg
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) {
  ffmpegPath = localFfmpeg;
}
if (!ffmpegPath) {
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (e) {}
}
if (!ffmpegPath) {
  try {
    execSync('which ffmpeg', { stdio: 'pipe' });
    ffmpegPath = 'ffmpeg';
  } catch (e) {}
}

// Find yt-dlp
let ytdlpPath = null;
try { execSync('which yt-dlp', { stdio: 'pipe' }); ytdlpPath = 'yt-dlp'; } catch (e) {}

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

// Validate YouTube URL
function isValidYouTubeUrl(url) {
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
    /^(https?:\/\/)?youtu\.be\/[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/,
  ];
  return patterns.some(p => p.test(url.trim()));
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([\w-]+)/);
  return match ? match[1] : null;
}

// Download YouTube video using yt-dlp with ytdl-core fallback
async function downloadYouTubeVideo(videoUrl) {
  const videoId = extractVideoId(videoUrl) || uuidv4().slice(0, 8);
  const outputPath = path.join(uploadDir, `yt-thumb-${videoId}.mp4`);

  // Clean up any existing file
  try { fs.unlinkSync(outputPath); } catch (e) {}

  // Strategy 1: yt-dlp
  if (ytdlpPath) {
    try {
      console.log(`[AI Thumbnail] Downloading ${videoUrl} via yt-dlp...`);
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
          else reject(new Error('yt-dlp exit ' + code + ': ' + stderr.slice(-300)));
        });
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} reject(new Error('Download timed out')); }, 180000);
      });

      if (!fs.existsSync(outputPath)) {
        const base = path.join(uploadDir, `yt-thumb-${videoId}`);
        for (const ext of ['.mp4', '.mkv', '.webm']) {
          if (fs.existsSync(base + ext)) {
            fs.renameSync(base + ext, outputPath);
            break;
          }
        }
      }

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
        console.log(`[AI Thumbnail] yt-dlp download success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return outputPath;
      }
    } catch (err) {
      console.log(`[AI Thumbnail] yt-dlp failed: ${err.message.slice(0, 200)}`);
    }
  }

  // Strategy 2: @distube/ytdl-core fallback
  if (ytdl) {
    try {
      console.log(`[AI Thumbnail] Trying ytdl-core fallback for ${videoUrl}...`);
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
        console.log(`[AI Thumbnail] ytdl-core download success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return outputPath;
      }
    } catch (err) {
      console.log(`[AI Thumbnail] ytdl-core fallback failed: ${err.message.slice(0, 200)}`);
    }
  }

  throw new Error('YOUTUBE_DOWNLOAD_FAILED');
}

// Fallback: Fetch YouTube thumbnail directly (no video download needed)
async function fetchYouTubeThumbnails(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Could not extract video ID');

  const https = require('https');
  const thumbnailUrls = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/0.jpg`,
    `https://img.youtube.com/vi/${videoId}/1.jpg`,
    `https://img.youtube.com/vi/${videoId}/2.jpg`,
    `https://img.youtube.com/vi/${videoId}/3.jpg`,
  ];

  const frames = [];
  for (let i = 0; i < thumbnailUrls.length; i++) {
    try {
      const filename = `yt-frame-${videoId}-${i}.jpg`;
      const filePath = path.join(outputDir, filename);

      await new Promise((resolve, reject) => {
        const request = https.get(thumbnailUrls[i], (response) => {
          if (response.statusCode === 200 && response.headers['content-type'] && response.headers['content-type'].includes('image')) {
            const writeStream = fs.createWriteStream(filePath);
            response.pipe(writeStream);
            writeStream.on('finish', () => {
              const stat = fs.statSync(filePath);
              if (stat.size > 1000) {
                resolve(true);
              } else {
                try { fs.unlinkSync(filePath); } catch(e) {}
                resolve(false);
              }
            });
            writeStream.on('error', () => resolve(false));
          } else {
            resolve(false);
          }
        });
        request.on('error', () => resolve(false));
        request.setTimeout(10000, () => { request.destroy(); resolve(false); });
      }).then(ok => {
        if (ok && fs.existsSync(filePath)) {
          frames.push({ filename, url: '/ai-thumbnail/serve/' + filename });
        }
      });
    } catch (e) { /* skip this thumbnail */ }
  }

  if (frames.length === 0) {
    throw new Error('Could not fetch any YouTube thumbnails');
  }

  return frames;
}

// Setup directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Multer configuration
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Thumbnail style presets with FFmpeg filter configurations
const thumbnailStylePresets = {
  'gradient-overlay': {
    name: 'Gradient Overlay',
    description: 'Vibrant purple-to-pink gradient',
    apply: (inputFrame, outputPath) => {
      return applyGradientOverlay(inputFrame, outputPath, 'gradient');
    }
  },
  'dark-cinematic': {
    name: 'Dark Cinematic',
    description: 'Dark vignette with high contrast',
    apply: (inputFrame, outputPath) => {
      return applyDarkCinematic(inputFrame, outputPath);
    }
  },
  'bold-border': {
    name: 'Bold Border',
    description: 'Thick colored border with accent',
    apply: (inputFrame, outputPath) => {
      return applyBoldBorder(inputFrame, outputPath);
    }
  },
  'split-design': {
    name: 'Split Design',
    description: 'Two-tone split background design',
    apply: (inputFrame, outputPath) => {
      return applySplitDesign(inputFrame, outputPath);
    }
  },
  'text-focus': {
    name: 'Text Focus',
    description: 'Dark overlay for text legibility',
    apply: (inputFrame, outputPath) => {
      return applyTextFocus(inputFrame, outputPath);
    }
  },
  'clean-minimal': {
    name: 'Clean Minimal',
    description: 'Subtle brightness and contrast boost',
    apply: (inputFrame, outputPath) => {
      return applyCleanMinimal(inputFrame, outputPath);
    }
  }
};

// Apply gradient overlay style
function applyGradientOverlay(inputFrame, outputPath) {
  return new Promise((resolve, reject) => {
    const filterComplex = `
      format=yuv420p,
      scale=1200:630,
      [0]split[a][b];
      [a]colorize=h=280:s=0.8:l=0.5[grad];
      [b]colorchannelmixer=0.3:0.59:0.11:0:0.3:0.59:0.11:0:0.3:0.59:0.11:0[luma];
      [grad]alphaextract[alpha];
      [luma][alpha]alphamerge[dimmed];
      [dimmed]colorlevels=rh=0.8:gh=0.4:bh=0.8[styled]
    `;

    const args = [
      '-i', inputFrame,
      '-vf', `scale=1200:630,drawbox=x=0:y=0:w=1200:h=630:color=6C3AED@0.4:t=fill,colorlevels=rh=0.95:gh=0.8:bh=1.0`,
      '-y', outputPath
    ];

    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput.slice(-200)}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Apply dark cinematic style
function applyDarkCinematic(inputFrame, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputFrame,
      '-vf', `scale=1200:630,
        drawbox=x=0:y=0:w=1200:h=200:color=000000@0.6:t=fill,
        drawbox=x=0:y=430:w=1200:h=200:color=000000@0.6:t=fill,
        colorlevels=rh=0.9:gh=0.85:bh=0.95,
        eq=brightness=0.05:contrast=1.2`,
      '-y', outputPath
    ];

    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput.slice(-200)}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Apply bold border style
function applyBoldBorder(inputFrame, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputFrame,
      '-vf', `scale=1140:570,
        pad=1200:630:(1200-1140)/2:(630-570)/2:EC4899,
        drawbox=x=15:y=15:w=1170:h=600:color=6C3AED:t=3`,
      '-y', outputPath
    ];

    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput.slice(-200)}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Apply split design style
function applySplitDesign(inputFrame, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputFrame,
      '-vf', `scale=1200:630,
        drawbox=x=0:y=0:w=600:h=630:color=1a1a2e:t=fill,
        drawbox=x=600:y=0:w=600:h=630:color=6C3AED:t=fill,
        overlay=0:0`,
      '-y', outputPath
    ];

    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput.slice(-200)}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Apply text focus style
function applyTextFocus(inputFrame, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputFrame,
      '-vf', `scale=1200:630,
        drawbox=x=0:y=450:w=1200:h=180:color=000000@0.7:t=fill,
        colorlevels=rh=0.95:gh=0.9:bh=1.0`,
      '-y', outputPath
    ];

    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput.slice(-200)}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Apply clean minimal style
function applyCleanMinimal(inputFrame, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputFrame,
      '-vf', `scale=1200:630,
        eq=brightness=0.08:contrast=1.1:saturation=1.05`,
      '-y', outputPath
    ];

    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput.slice(-200)}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Extract key frames from video using evenly-spaced snapshots
function extractKeyFrames(videoPath, maxFrames = 12) {
  return new Promise((resolve, reject) => {
    const jobId = uuidv4();

    // Get video duration first
    const ffprobePath = ffmpegPath === 'ffmpeg' ? 'ffprobe' : ffmpegPath.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
    const getInfoProc = spawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ]);

    let durationOutput = '';
    let probeError = '';
    getInfoProc.stdout.on('data', (data) => { durationOutput += data.toString(); });
    getInfoProc.stderr.on('data', (data) => { probeError += data.toString(); });

    getInfoProc.on('close', async (code) => {
      let duration = parseFloat(durationOutput.trim());

      // If ffprobe failed or returned bad duration, try a different approach
      if (!duration || duration <= 0 || isNaN(duration)) {
        // Fallback: try format duration
        try {
          const probe2 = spawn(ffprobePath, ['-v', 'error', '-show_format', '-of', 'json', videoPath]);
          let jsonOut = '';
          probe2.stdout.on('data', (d) => { jsonOut += d.toString(); });
          await new Promise((res2) => probe2.on('close', res2));
          const info = JSON.parse(jsonOut);
          duration = parseFloat(info.format?.duration || 0);
        } catch (e) {}
      }

      if (!duration || duration <= 0) {
        // Last resort: assume 60 seconds and try anyway
        duration = 60;
      }

      // Extract evenly-spaced frames using -ss seeking (most reliable method)
      const frameCount = Math.min(maxFrames, Math.max(3, Math.floor(duration / 5)));
      const interval = duration / (frameCount + 1);
      const frames = [];
      let completed = 0;

      const extractSingleFrame = (index, timestamp) => {
        return new Promise((res2, rej2) => {
          const frameName = `frame-${jobId}-${String(index + 1).padStart(3, '0')}.jpg`;
          const framePath = path.join(outputDir, frameName);

          const args = [
            '-ss', String(Math.floor(timestamp)),
            '-i', videoPath,
            '-vframes', '1',
            '-q:v', '2',
            '-y',
            framePath
          ];

          const proc = spawn(ffmpegPath || 'ffmpeg', args);
          let err = '';
          proc.stderr.on('data', (d) => { err += d.toString(); });

          proc.on('close', (c) => {
            if (c === 0 && fs.existsSync(framePath)) {
              const stat = fs.statSync(framePath);
              if (stat.size > 500) {
                frames.push({ filename: frameName, path: framePath, timestamp: Math.floor(timestamp) });
              }
            }
            res2();
          });
          proc.on('error', () => res2());
        });
      };

      // Extract frames sequentially (avoids overwhelming FFmpeg)
      for (let i = 0; i < frameCount; i++) {
        const timestamp = interval * (i + 1);
        if (timestamp < duration) {
          await extractSingleFrame(i, timestamp);
        }
      }

      if (frames.length === 0) {
        // Try one more time at the 1-second mark
        await extractSingleFrame(0, 1);
      }

      if (frames.length === 0) {
        return reject(new Error('No frames could be extracted. The video file may be corrupted or in an unsupported format.'));
      }

      resolve(frames);
    });

    getInfoProc.on('error', (err) => {
      reject(new Error('ffprobe not available: ' + err.message));
    });
  });
}

// GET - Main page
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('AI Thumbnails');
  const sidebar = getSidebar('ai-thumbnail', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const pageStyles = `
    <style>
      ${css}

      .input-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
      }

      .input-tabs {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .input-tab {
        padding: 0.75rem 1.5rem;
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-weight: 600;
        font-size: 0.95rem;
        border-bottom: 2px solid transparent;
        transition: all 0.3s;
      }

      .input-tab.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }

      .input-tab:hover {
        color: var(--text);
      }

      .tab-content {
        display: none;
      }

      .tab-content.active {
        display: block;
      }

      .url-input-group {
        margin-bottom: 1.5rem;
      }

      .url-input-label {
        display: block;
        color: var(--text);
        font-weight: 500;
        margin-bottom: 0.5rem;
      }

      .url-input {
        width: 100%;
        padding: 0.75rem 1rem;
        background: var(--surface-light);
        border: var(--border-subtle);
        border-radius: 8px;
        color: var(--text);
        font-size: 0.9rem;
        transition: all 0.3s;
      }

      .url-input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(108, 58, 237, 0.1);
      }

      .upload-area {
        border: 2px dashed rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 3rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        background: rgba(108, 58, 237, 0.05);
      }

      .upload-area:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
      }

      .upload-area.dragover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.15);
      }

      .upload-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }

      .upload-text {
        color: var(--text);
        font-weight: 600;
        font-size: 1.1rem;
        margin-bottom: 0.5rem;
      }

      .upload-subtext {
        color: var(--text-muted);
        font-size: 0.9rem;
      }

      .file-input {
        display: none;
      }

      .file-name {
        color: var(--primary);
        font-weight: 500;
        margin-top: 1rem;
        font-size: 0.9rem;
      }

      .action-button {
        background: var(--gradient-1);
        color: #fff;
        padding: 0.9rem 2rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.3s;
        width: 100%;
        margin-top: 2rem;
        box-shadow: 0 4px 20px rgba(108, 58, 237, 0.3);
      }

      .action-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.4);
      }

      .action-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .action-button.loading {
        opacity: 0.8;
      }

      .spinner {
        display: inline-block;
        width: 1em;
        height: 1em;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error-message {
        background: var(--error);
        color: #fff;
        padding: 1rem;
        border-radius: 8px;
        margin-top: 1rem;
        font-size: 0.9rem;
      }

      .frames-section {
        margin-top: 3rem;
      }

      .frames-header {
        color: var(--text);
        font-size: 1.2rem;
        font-weight: 600;
        margin-bottom: 1.5rem;
      }

      .frames-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 2rem;
      }

      .frame-card {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.3s;
        position: relative;
      }

      .frame-card:hover {
        border-color: var(--primary);
        transform: translateY(-4px);
        box-shadow: 0 8px 20px rgba(108, 58, 237, 0.2);
      }

      .frame-card.selected {
        border-color: var(--primary);
        box-shadow: 0 0 0 2px var(--primary);
      }

      .frame-image {
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        display: block;
      }

      .frame-select-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 24px;
        height: 24px;
        background: var(--primary);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 700;
        opacity: 0;
        transition: opacity 0.3s;
      }

      .frame-card.selected .frame-select-badge {
        opacity: 1;
      }

      .styles-section {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .styles-header {
        color: var(--text);
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 1rem;
      }

      .styles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .style-button {
        padding: 1rem;
        background: var(--surface-light);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s;
        text-align: center;
        font-size: 0.9rem;
      }

      .style-button:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
        transform: translateY(-2px);
      }

      .style-button.selected {
        background: var(--primary);
        border-color: var(--primary);
        box-shadow: 0 4px 12px rgba(108, 58, 237, 0.3);
      }

      .generate-controls {
        display: flex;
        gap: 1rem;
        margin-top: 1.5rem;
      }

      .generate-btn {
        flex: 1;
        padding: 0.9rem 1.5rem;
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 20px rgba(108, 58, 237, 0.3);
      }

      .generate-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.4);
      }

      .generate-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .generate-btn.secondary {
        background: var(--surface-light);
        color: var(--text);
        box-shadow: none;
      }

      .generate-btn.secondary:hover:not(:disabled) {
        background: rgba(108, 58, 237, 0.2);
      }

      .preview-section {
        display: none;
        margin-top: 3rem;
      }

      .preview-section.show {
        display: block;
      }

      .preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .thumbnail-preview {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.3s;
      }

      .thumbnail-preview:hover {
        border-color: var(--primary);
        transform: translateY(-4px);
        box-shadow: 0 8px 20px rgba(108, 58, 237, 0.2);
      }

      .thumbnail-image {
        width: 100%;
        aspect-ratio: 1200 / 630;
        object-fit: cover;
        display: block;
      }

      .thumbnail-info {
        padding: 1rem;
      }

      .thumbnail-style-name {
        color: var(--text);
        font-weight: 600;
        margin-bottom: 0.5rem;
      }

      .thumbnail-style-desc {
        color: var(--text-muted);
        font-size: 0.85rem;
        margin-bottom: 1rem;
      }

      .thumbnail-download {
        display: block;
        width: 100%;
        padding: 0.7rem;
        text-align: center;
        background: var(--primary);
        color: #fff;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.9rem;
        transition: all 0.3s;
      }

      .thumbnail-download:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(108, 58, 237, 0.3);
      }

      .toast {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: var(--success);
        color: #fff;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 500;
        display: none;
        z-index: 9999;
        animation: slideUp 0.3s ease;
      }

      .toast.error {
        background: var(--error);
      }

      @keyframes slideUp {
        from {
          transform: translateY(20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      [data-theme="light"] .input-section,
      body.light .input-section,
      html.light .input-section {
        background: var(--surface);
      }

      [data-theme="light"] .url-input,
      body.light .url-input,
      html.light .url-input {
        background: var(--surface-light);
        border-color: rgba(0, 0, 0, 0.1);
        color: var(--text);
      }

      [data-theme="light"] .upload-area,
      body.light .upload-area,
      html.light .upload-area {
        background: rgba(108, 58, 237, 0.05);
        border-color: rgba(0, 0, 0, 0.1);
      }

      [data-theme="light"] .style-button,
      body.light .style-button,
      html.light .style-button {
        background: var(--surface-light);
        border-color: rgba(0, 0, 0, 0.1);
      }
    </style>
  `;

  const html = `${headHTML}
${pageStyles}
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    ${themeToggle}

    <main class="main-content">
      <div class="page-header">
        <h1>AI Thumbnails</h1>
        <p>Generate professional YouTube thumbnails with AI styling</p>
      </div>

      <div class="input-section">
        <div class="input-tabs">
          <button class="input-tab active" data-tab="url">YouTube URL</button>
          <button class="input-tab" data-tab="upload">Upload Video</button>
        </div>

        <form id="thumbnailForm">
          <div id="urlTab" class="tab-content active">
            <div class="url-input-group">
              <label class="url-input-label">YouTube URL</label>
              <input type="text" id="youtubeUrl" class="url-input" placeholder="https://youtube.com/watch?v=..." />
            </div>
          </div>

          <div id="uploadTab" class="tab-content">
            <div class="upload-area" id="uploadArea" onclick="document.getElementById('fileInput').click()">
              <div class="upload-icon">🎬</div>
              <div class="upload-text">Drop your video file here</div>
              <div class="upload-subtext">Or click to select • MP4, MOV, WebM supported</div>
              <input type="file" id="fileInput" name="videoFile" class="file-input" accept="video/*">
              <div id="fileName" class="file-name" style="display: none;"></div>
            </div>
          </div>

          <button type="submit" class="action-button" id="extractBtn" disabled>
            Extract Frames from Video
          </button>
          <div id="errorMessage" style="display: none;"></div>
        </form>
      </div>

      <div class="frames-section" id="framesSection" style="display: none;">
        <div class="frames-header">Select a Frame to Style</div>
        <div class="frames-grid" id="framesGrid"></div>

        <div class="styles-section">
          <div class="styles-header">Thumbnail Styles</div>
          <div class="styles-grid" id="stylesGrid"></div>

          <div class="generate-controls">
            <button class="generate-btn" id="generateSingleBtn" disabled>
              Generate Selected Style
            </button>
            <button class="generate-btn secondary" id="generateAllBtn" disabled>
              Generate All 6 Styles
            </button>
          </div>
        </div>
      </div>

      <div class="preview-section" id="previewSection">
        <h2 style="margin-bottom: 1.5rem; color: var(--text);">Your Generated Thumbnails</h2>
        <div class="preview-grid" id="previewGrid"></div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function showToast(message, duration = 3000, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.remove('error');
      if (isError) toast.classList.add('error');
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }

    function showError(message) {
      const errorDiv = document.getElementById('errorMessage');
      errorDiv.innerHTML = '<div class="error-message">' + message + '</div>';
      errorDiv.style.display = 'block';
    }

    function clearError() {
      const errorDiv = document.getElementById('errorMessage');
      errorDiv.style.display = 'none';
    }

    // Tab switching
    document.querySelectorAll('.input-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(tabName + 'Tab').classList.add('active');
        checkInputs();
      });
    });

    // File upload
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const fileName = document.getElementById('fileName');
    const youtubeUrl = document.getElementById('youtubeUrl');
    const form = document.getElementById('thumbnailForm');
    const extractBtn = document.getElementById('extractBtn');

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const name = e.target.files[0].name;
        fileName.textContent = '🎬 ' + name;
        fileName.style.display = 'block';
        checkInputs();
      }
    });

    youtubeUrl.addEventListener('input', checkInputs);

    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        const name = files[0].name;
        fileName.textContent = '🎬 ' + name;
        fileName.style.display = 'block';
        checkInputs();
      }
    });

    var activeInputTab = 'url';
    document.querySelectorAll('.input-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        activeInputTab = e.target.dataset.tab;
        checkInputs();
      });
    });

    function checkInputs() {
      const hasUrl = activeInputTab === 'url' && youtubeUrl.value.trim().length > 0;
      const hasFile = activeInputTab === 'upload' && fileInput.files.length > 0;
      extractBtn.disabled = !(hasUrl || hasFile);
    }

    let currentFrames = [];
    let selectedFrameIndex = null;
    let selectedStyleKey = null;

    // Render frames grid
    function renderFrames(frames) {
      const grid = document.getElementById('framesGrid');
      grid.innerHTML = '';
      currentFrames = frames;

      frames.forEach((frame, idx) => {
        const card = document.createElement('div');
        card.className = 'frame-card';
        card.innerHTML = \`
          <img src="/ai-thumbnail/serve/\${frame.filename}" class="frame-image" alt="Frame \${idx + 1}">
          <div class="frame-select-badge">\${idx + 1}</div>
        \`;
        card.addEventListener('click', () => selectFrame(idx, card));
        grid.appendChild(card);
      });
    }

    // Render styles grid
    function renderStyles() {
      const grid = document.getElementById('stylesGrid');
      grid.innerHTML = '';

      const styles = [
        { key: 'gradient-overlay', name: 'Gradient Overlay', desc: 'Vibrant colors' },
        { key: 'dark-cinematic', name: 'Dark Cinematic', desc: 'High contrast' },
        { key: 'bold-border', name: 'Bold Border', desc: 'Thick accent' },
        { key: 'split-design', name: 'Split Design', desc: 'Two-tone' },
        { key: 'text-focus', name: 'Text Focus', desc: 'Dark overlay' },
        { key: 'clean-minimal', name: 'Clean Minimal', desc: 'Subtle boost' }
      ];

      styles.forEach(style => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'style-button';
        btn.innerHTML = \`<div style="font-weight: 600;">\${style.name}</div><div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem;">\${style.desc}</div>\`;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          selectStyle(style.key, btn);
        });
        grid.appendChild(btn);
      });
    }

    function selectFrame(idx, cardElement) {
      document.querySelectorAll('.frame-card').forEach(c => c.classList.remove('selected'));
      cardElement.classList.add('selected');
      selectedFrameIndex = idx;
      document.getElementById('generateSingleBtn').disabled = selectedStyleKey === null;
      document.getElementById('generateAllBtn').disabled = false;
    }

    function selectStyle(styleKey, btnElement) {
      document.querySelectorAll('.style-button').forEach(b => b.classList.remove('selected'));
      btnElement.classList.add('selected');
      selectedStyleKey = styleKey;
      document.getElementById('generateSingleBtn').disabled = selectedFrameIndex === null;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      var useUrl = activeInputTab === 'url' && youtubeUrl.value.trim().length > 0;
      var useFile = activeInputTab === 'upload' && fileInput.files.length > 0;

      if (!useUrl && !useFile) {
        showError(activeInputTab === 'url' ? 'Please paste a YouTube URL' : 'Please upload a video file');
        return;
      }

      const formData = new FormData();
      formData.set('inputMode', activeInputTab);

      if (useUrl) {
        formData.set('youtubeUrl', youtubeUrl.value.trim());
      } else if (useFile) {
        formData.set('videoFile', fileInput.files[0]);
      }

      extractBtn.disabled = true;
      extractBtn.classList.add('loading');
      extractBtn.innerHTML = '<span class="spinner"></span> Extracting Frames...';

      try {
        const response = await fetch('/ai-thumbnail/extract', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Extraction failed');
        }

        document.getElementById('framesSection').style.display = 'block';
        renderFrames(data.frames);
        renderStyles();
        showToast('Frames extracted successfully!', 4000);
      } catch (error) {
        showError('Error: ' + error.message);
      } finally {
        extractBtn.disabled = false;
        extractBtn.classList.remove('loading');
        extractBtn.innerHTML = 'Extract Frames from Video';
      }
    });

    document.getElementById('generateSingleBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      if (selectedFrameIndex === null || selectedStyleKey === null) {
        showError('Please select a frame and style');
        return;
      }

      await generateThumbnails([selectedStyleKey]);
    });

    document.getElementById('generateAllBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      if (selectedFrameIndex === null) {
        showError('Please select a frame');
        return;
      }

      await generateThumbnails(['gradient-overlay', 'dark-cinematic', 'bold-border', 'split-design', 'text-focus', 'clean-minimal']);
    });

    async function generateThumbnails(styleKeys) {
      const generateSingleBtn = document.getElementById('generateSingleBtn');
      const generateAllBtn = document.getElementById('generateAllBtn');
      generateSingleBtn.disabled = true;
      generateAllBtn.disabled = true;
      generateSingleBtn.classList.add('loading');
      generateAllBtn.classList.add('loading');

      try {
        const response = await fetch('/ai-thumbnail/style', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frameFilename: currentFrames[selectedFrameIndex].filename,
            styles: JSON.stringify(styleKeys)
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Generation failed');
        }

        displayResults(data.thumbnails);
        showToast('Thumbnails generated successfully!', 4000);
      } catch (error) {
        showError('Error: ' + error.message);
      } finally {
        generateSingleBtn.disabled = selectedFrameIndex === null || selectedStyleKey === null;
        generateAllBtn.disabled = selectedFrameIndex === null;
        generateSingleBtn.classList.remove('loading');
        generateAllBtn.classList.remove('loading');
      }
    }

    function displayResults(thumbnails) {
      const previewSection = document.getElementById('previewSection');
      const previewGrid = document.getElementById('previewGrid');
      previewGrid.innerHTML = '';

      thumbnails.forEach(thumb => {
        const container = document.createElement('div');
        container.className = 'thumbnail-preview';
        container.innerHTML = \`
          <img src="/ai-thumbnail/serve/\${thumb.filename}" class="thumbnail-image" alt="\${thumb.style}">
          <div class="thumbnail-info">
            <div class="thumbnail-style-name">\${thumb.styleName}</div>
            <div class="thumbnail-style-desc">\${thumb.description}</div>
            <a href="/ai-thumbnail/download/\${thumb.filename}" class="thumbnail-download" download>
              Download
            </a>
          </div>
        \`;
        previewGrid.appendChild(container);
      });

      previewSection.classList.add('show');
    }

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// POST - Extract frames from video
router.post('/extract', requireAuth, upload.single('videoFile'), async (req, res) => {
  let downloadedPath = null;
  try {
    const youtubeUrl = req.body.youtubeUrl || '';
    const inputMode = req.body.inputMode || 'upload';
    const videoFile = req.file;

    if (!youtubeUrl && !videoFile) {
      return res.status(400).json({ success: false, message: 'Please provide a YouTube URL or upload a video' });
    }

    let inputPath = null;

    if (inputMode === 'url' && youtubeUrl) {
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid YouTube URL' });
      }
      try {
        inputPath = await downloadYouTubeVideo(youtubeUrl);
        downloadedPath = inputPath;
      } catch (dlError) {
        // Fallback: fetch YouTube thumbnail images directly instead of downloading video
        console.log('[AI Thumbnail] Video download failed, trying YouTube thumbnail fallback...');
        try {
          const ytFrames = await fetchYouTubeThumbnails(youtubeUrl);
          return res.json({ success: true, frames: ytFrames });
        } catch (thumbErr) {
          return res.status(400).json({ success: false, message: 'Failed to download YouTube video. The video may be private, age-restricted, or unavailable.' });
        }
      }
    } else if (videoFile) {
      inputPath = videoFile.path;
    }

    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(400).json({ success: false, message: 'Video file not found' });
    }

    try {
      const frames = await extractKeyFrames(inputPath, 12);
      res.json({ success: true, frames: frames });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    } finally {
      if (downloadedPath) { try { fs.unlinkSync(downloadedPath); } catch (e) {} }
      if (videoFile && inputPath) { try { fs.unlinkSync(inputPath); } catch (e) {} }
    }
  } catch (error) {
    console.error('Extraction error:', error);
    if (downloadedPath) { try { fs.unlinkSync(downloadedPath); } catch (e) {} }
    res.status(500).json({ success: false, message: error.message || 'Extraction failed' });
  }
});

// POST - Apply style to frame
router.post('/style', requireAuth, async (req, res) => {
  try {
    const frameFilename = req.body.frameFilename || '';
    const styleKeysStr = req.body.styles || '[]';
    const styleKeys = JSON.parse(styleKeysStr);

    if (!frameFilename || !styleKeys || styleKeys.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing frame or styles' });
    }

    const framePath = path.join(outputDir, frameFilename);
    if (!fs.existsSync(framePath)) {
      return res.status(404).json({ success: false, message: 'Frame not found' });
    }

    const thumbnails = [];
    const jobId = uuidv4();

    for (const styleKey of styleKeys) {
      const preset = thumbnailStylePresets[styleKey];
      if (!preset) continue;

      const outputFilename = `thumb-${jobId}-${styleKey}.png`;
      const outputPath = path.join(outputDir, outputFilename);

      try {
        await preset.apply(framePath, outputPath);
        thumbnails.push({
          filename: outputFilename,
          style: styleKey,
          styleName: preset.name,
          description: preset.description
        });
      } catch (error) {
        console.error(`Failed to apply ${styleKey}:`, error.message);
      }
    }

    if (thumbnails.length === 0) {
      return res.status(500).json({ success: false, message: 'Thumbnail generation failed' });
    }

    res.json({ success: true, thumbnails: thumbnails });
    featureUsageOps.log(req.user.id, 'ai_thumbnails').catch(() => {});
  } catch (error) {
    console.error('Style error:', error);
    res.status(500).json({ success: false, message: error.message || 'Style application failed' });
  }
});

// GET - Serve generated image
router.get('/serve/:filename', requireAuth, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename.match(/^[\w\-\.]+\.(png|jpg|jpeg)$/i)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Serve failed' });
  }
});

// GET - Download generated thumbnail
router.get('/download/:filename', requireAuth, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename.match(/^[\w\-\.]+\.(png|jpg|jpeg)$/i)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.download(filePath);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

module.exports = router;
