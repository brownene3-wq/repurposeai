const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
// Replicate is not guaranteed to be in package.json (its entry was reverted
// during a Flux→GPT-image rollback and then the Flux code got re-added
// separately). Require it defensively so a missing module doesn't crash
// the whole server at startup — only the AI-Thumbnail Flux path fails.
let Replicate = null;
try { Replicate = require('replicate'); } catch(e){
  console.warn('[ai-thumbnail] replicate SDK not installed — Flux image gen disabled:', e.message);
}
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// OpenAI client for Whisper transcription + GPT-4o-mini concept synthesis.
// Boot guard — the OpenAI SDK throws at construction if apiKey is empty,
// which would crash the entire server. Pass a placeholder when the env
// var is missing; real auth check happens at request time.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key' });

// Replicate client for Flux Schnell image generation. Lazy-constructed
// only if the SDK loaded AND the auth token exists, so the server boots
// cleanly even when the module / env var is absent.
const replicate = (Replicate && process.env.REPLICATE_API_TOKEN)
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

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
          // Prefer a standalone high-res video stream (no audio merge needed — faster
          // and avoids dropping to 720p when the audio merger fails). Fall back to
          // progressive formats only if every video-only option is unavailable.
          '-f', 'bestvideo[ext=mp4][height<=1080]/bestvideo[height<=1080]/bestvideo[ext=mp4]/bestvideo/best[height<=1080]/best',
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
  // Only high-res sources. The numbered (0.jpg/1.jpg/2.jpg/3.jpg) variants
  // are 120x90 tiny previews and would cause terrible output if a user
  // picked them as a "frame", so they're excluded. WebP encodes the same
  // resolution at noticeably higher quality than JPG.
  const candidates = [
    { url: `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`, ext: 'webp' },
    { url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, ext: 'jpg' },
    { url: `https://i.ytimg.com/vi_webp/${videoId}/sddefault.webp`, ext: 'webp' },
    { url: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`, ext: 'jpg' },
    { url: `https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp`, ext: 'webp' },
    { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, ext: 'jpg' },
  ];

  const frames = [];
  const seenSizes = new Set();
  for (let i = 0; i < candidates.length; i++) {
    try {
      const { url, ext } = candidates[i];
      const filename = `yt-frame-${videoId}-${i}.${ext === 'webp' ? 'jpg' : 'jpg'}`;
      const rawPath = path.join(outputDir, `yt-raw-${videoId}-${i}.${ext}`);
      const filePath = path.join(outputDir, filename);

      const downloaded = await new Promise((resolve) => {
        const request = https.get(url, (response) => {
          if (response.statusCode === 200 && response.headers['content-type'] && response.headers['content-type'].includes('image')) {
            const writeStream = fs.createWriteStream(rawPath);
            response.pipe(writeStream);
            writeStream.on('finish', () => {
              const stat = fs.statSync(rawPath);
              // 4000 bytes is a reasonable floor for a real thumbnail vs a 1x1 placeholder
              if (stat.size > 4000) {
                resolve(true);
              } else {
                try { fs.unlinkSync(rawPath); } catch (e) {}
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
      });

      if (!downloaded) continue;

      // Convert to a consistent JPG so downstream style filters are predictable,
      // and dedupe by file size so we don't show the user the same image twice
      // (maxresdefault.webp and .jpg often resolve to identical content).
      const fileSize = fs.statSync(rawPath).size;
      const sizeBucket = Math.round(fileSize / 2048); // rough dedupe bucket
      if (seenSizes.has(sizeBucket)) {
        try { fs.unlinkSync(rawPath); } catch (e) {}
        continue;
      }
      seenSizes.add(sizeBucket);

      if (ext === 'webp') {
        // Re-encode webp to high-quality jpg so the style pipeline (ffmpeg) handles it uniformly
        await new Promise((resolve) => {
          const proc = spawn(ffmpegPath || 'ffmpeg', ['-i', rawPath, '-q:v', '2', '-y', filePath]);
          proc.on('close', () => resolve());
          proc.on('error', () => resolve());
        });
        try { fs.unlinkSync(rawPath); } catch (e) {}
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 2000) continue;
      } else {
        fs.renameSync(rawPath, filePath);
      }

      frames.push({ filename, url: '/ai-thumbnail/serve/' + filename });
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

// Get width/height of a frame using ffprobe — used to preserve the video's
// original aspect ratio in the generated thumbnail (fixes stretch bug on 9:16 inputs).
function getFrameDimensions(framePath) {
  return new Promise((resolve) => {
    const ffprobePath = ffmpegPath === 'ffmpeg' ? 'ffprobe' : ffmpegPath.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      framePath
    ]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      const parts = out.trim().split(',').map((s) => parseInt(s, 10));
      if (parts[0] > 0 && parts[1] > 0) {
        resolve({ width: parts[0], height: parts[1] });
      } else {
        // Fallback — default to landscape YouTube-ish size
        resolve({ width: 1200, height: 630 });
      }
    });
    proc.on('error', () => resolve({ width: 1200, height: 630 }));
  });
}

// Compute target output size preserving the input aspect ratio.
// Longest side is clamped to maxSide so we don't upscale small videos too far.
// Dimensions are forced to even numbers (required by many codecs/filters).
function computeOutputSize(width, height, maxSide = 1280) {
  if (!width || !height) return { width: 1200, height: 630 };
  const aspect = width / height;
  let outW, outH;
  if (width >= height) {
    outW = Math.min(width, maxSide);
    outH = Math.round(outW / aspect);
  } else {
    outH = Math.min(height, maxSide);
    outW = Math.round(outH * aspect);
  }
  outW = Math.max(2, Math.round(outW / 2) * 2);
  outH = Math.max(2, Math.round(outH / 2) * 2);
  return { width: outW, height: outH };
}

// Thumbnail style presets with FFmpeg filter configurations
const thumbnailStylePresets = {
  'gradient-overlay': {
    name: 'Gradient Overlay',
    description: 'Vibrant purple-to-pink gradient',
    apply: (inputFrame, outputPath, dims) => {
      return applyGradientOverlay(inputFrame, outputPath, dims);
    }
  },
  'dark-cinematic': {
    name: 'Dark Cinematic',
    description: 'Dark vignette with high contrast',
    apply: (inputFrame, outputPath, dims) => {
      return applyDarkCinematic(inputFrame, outputPath, dims);
    }
  },
  'bold-border': {
    name: 'Bold Border',
    description: 'Thick colored border with accent',
    apply: (inputFrame, outputPath, dims) => {
      return applyBoldBorder(inputFrame, outputPath, dims);
    }
  },
  'split-design': {
    name: 'Split Design',
    description: 'Two-tone split background design',
    apply: (inputFrame, outputPath, dims) => {
      return applySplitDesign(inputFrame, outputPath, dims);
    }
  },
  'text-focus': {
    name: 'Text Focus',
    description: 'Dark overlay for text legibility',
    apply: (inputFrame, outputPath, dims) => {
      return applyTextFocus(inputFrame, outputPath, dims);
    }
  },
  'clean-minimal': {
    name: 'Clean Minimal',
    description: 'Subtle brightness and contrast boost',
    apply: (inputFrame, outputPath, dims) => {
      return applyCleanMinimal(inputFrame, outputPath, dims);
    }
  }
};

// Apply gradient overlay style
function applyGradientOverlay(inputFrame, outputPath, dims) {
  return new Promise((resolve, reject) => {
    const W = dims.width, H = dims.height;
    const args = [
      '-i', inputFrame,
      // Note: colorbalance midtone options are rm/gm/bm (not ms/mh/mb) —
      // the old param names were invalid and caused every Gradient Overlay
      // render to fail with "Option 'ms' not found".
      '-vf', `scale=${W}:${H}:flags=lanczos,colorbalance=rs=0.35:gs=-0.1:bs=0.3:rm=0.25:gm=-0.05:bm=0.2,eq=contrast=1.1:saturation=1.2`,
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
function applyDarkCinematic(inputFrame, outputPath, dims) {
  return new Promise((resolve, reject) => {
    const W = dims.width, H = dims.height;
    const args = [
      '-i', inputFrame,
      '-vf', `scale=${W}:${H}:flags=lanczos,vignette=PI/4,eq=brightness=-0.05:contrast=1.3:saturation=0.9`,
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
function applyBoldBorder(inputFrame, outputPath, dims) {
  return new Promise((resolve, reject) => {
    const W = dims.width, H = dims.height;
    // 5% outer padding, 2.5% inner stroke offset — proportional so portrait and landscape both look balanced
    const marginX = Math.max(2, Math.round(W * 0.05 / 2) * 2);
    const marginY = Math.max(2, Math.round(H * 0.05 / 2) * 2);
    const innerW = Math.max(2, W - marginX * 2);
    const innerH = Math.max(2, H - marginY * 2);
    const boxX = Math.round(marginX / 2);
    const boxY = Math.round(marginY / 2);
    const boxW = W - boxX * 2;
    const boxH = H - boxY * 2;
    const borderT = Math.max(3, Math.round(Math.min(W, H) * 0.006));
    const args = [
      '-i', inputFrame,
      '-vf', `scale=${innerW}:${innerH}:flags=lanczos,pad=${W}:${H}:${marginX}:${marginY}:EC4899,drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=6C3AED:t=${borderT}`,
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
function applySplitDesign(inputFrame, outputPath, dims) {
  return new Promise((resolve, reject) => {
    const W = dims.width, H = dims.height;
    // Two-tone background halves + centered image overlay at ~90% of the frame
    const halfW = Math.max(2, Math.round(W / 2 / 2) * 2);
    const halfW2 = Math.max(2, W - halfW);
    const innerW = Math.max(2, Math.round(W * 0.9 / 2) * 2);
    const innerH = Math.max(2, Math.round(H * 0.9 / 2) * 2);
    const overlayX = Math.round((W - innerW) / 2);
    const overlayY = Math.round((H - innerH) / 2);
    const args = [
      '-i', inputFrame,
      '-filter_complex', `[0:v]scale=${innerW}:${innerH}:flags=lanczos[img];color=c=0x1a1a2e:s=${halfW}x${H}:d=1[left];color=c=0x6C3AED:s=${halfW2}x${H}:d=1[right];[left][right]hstack[bg];[bg][img]overlay=${overlayX}:${overlayY}[out]`,
      '-map', '[out]',
      '-frames:v', '1',
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
function applyTextFocus(inputFrame, outputPath, dims) {
  return new Promise((resolve, reject) => {
    const W = dims.width, H = dims.height;
    // Dark banner at bottom occupying ~28% of frame height (same proportion as original 180/630)
    const bannerH = Math.max(2, Math.round(H * 0.285 / 2) * 2);
    const bannerY = Math.max(0, H - bannerH);
    const args = [
      '-i', inputFrame,
      '-vf', `scale=${W}:${H}:flags=lanczos,drawbox=x=0:y=${bannerY}:w=${W}:h=${bannerH}:color=0x000000:t=fill,eq=brightness=0.05:contrast=1.1`,
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
function applyCleanMinimal(inputFrame, outputPath, dims) {
  return new Promise((resolve, reject) => {
    const W = dims.width, H = dims.height;
    const args = [
      '-i', inputFrame,
      '-vf', `scale=${W}:${H}:flags=lanczos,eq=brightness=0.08:contrast=1.1:saturation=1.05`,
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

// ============================================================================
// AI-Generated Thumbnails pipeline
// ----------------------------------------------------------------------------
// 1. Ingest video (upload or YouTube download — reuses existing helpers).
// 2. Extract a short audio clip with ffmpeg and transcribe it with Whisper.
// 3. Ask GPT-4o-mini to pick out the most interesting moments and produce
//    N thumbnail concepts (title, caption, image prompt, referenced moment).
// 4. Generate one image per concept in parallel via GPT-image-1.
// 5. Save PNGs to outputDir and return filenames + metadata to the client.
// ============================================================================

// Extract a Whisper-friendly MP3 from a video. Mono, 16kHz, 64kbps stays well
// under Whisper's 25MB limit. We also cap to the first 10 minutes — enough to
// understand what a video is about without blowing up cost/latency for long clips.
function extractAudioForAIThumbnail(videoPath) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(uploadDir, `ai-thumb-audio-${uuidv4().slice(0, 8)}.mp3`);
    const proc = spawn(ffmpegPath, [
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      '-t', '600',
      '-y',
      outputPath
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error('Audio extraction failed: ' + stderr.slice(-200)));
      }
    });
    proc.on('error', reject);
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} }, 120000);
  });
}

// Transcribe audio with Whisper. Returns the flat text transcript.
async function transcribeForAIThumbnail(audioPath) {
  const audioBuffer = fs.readFileSync(audioPath);
  // eslint-disable-next-line no-undef
  const file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' });
  const transcript = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: file,
    response_format: 'text'
  });
  // When response_format is 'text', SDK returns the raw string.
  if (typeof transcript === 'string') return transcript.trim();
  if (transcript && transcript.text) return String(transcript.text).trim();
  return '';
}

// Ask GPT-4o-mini to propose N distinct thumbnail concepts based on the
// transcript + optional user hint. Returns an array of concept objects.
async function generateThumbnailConcepts({ transcript, hint, videoTitle, aspectLabel, count }) {
  const safeTranscript = (transcript || '').slice(0, 12000);

  // The three fixed creative angles. For count N, we take the first N of these.
  // Each angle produces a visually distinct concept so outputs are not just
  // variations of the same image.
  const angleRotation = [
    { key: 'character', label: 'CHARACTER FOCUS (High Emotion)', guide: 'A hyper-idealized human face or body expressing strong emotion tied to the topic — awe, shock, determination, triumph, grief. The subject embodies the topic. Close or medium shot, eye contact or strong gaze, dramatic rim lighting.' },
    { key: 'action', label: 'ACTION/EVENT FOCUS (High Energy)', guide: 'A high-energy moment — the peak instant of the topic in motion. Motion blur, sparks, impact, crowds, kinetic composition. Camera angle: low, dutch, or wide dramatic perspective.' },
    { key: 'object', label: 'OBJECT/RESULT FOCUS (The Outcome)', guide: 'The singular object, result, or artifact that represents the topic. Hero-shot lighting, glossy surfaces, dramatic shadow, clean background. The "what it looks like when it works" image.' }
  ];
  const anglesToUse = angleRotation.slice(0, Math.max(1, Math.min(count, 3)));
  const anglesBlock = anglesToUse.map((a, i) => `  Concept ${i + 1} — ${a.label}: ${a.guide}`).join('\n');

  const systemPrompt = `You are a senior YouTube thumbnail art director. You design thumbnails for maximum click-through on mobile.

STEP 1 — Extract the HOOK TOPIC.
Identify the single abstract idea the video is about (e.g., "AI replacing jobs", "beating procrastination", "the future of electric cars", "how to bake the perfect sourdough"). Ignore incidental visuals like the host's outfit or the studio — the topic is the IDEA, not the physical evidence.

STEP 2 — Generate exactly ${count} concept${count > 1 ? 's' : ''}, each using a DIFFERENT creative angle (no overlap):
${anglesBlock}

STEP 3 — For each concept, write:
• title: a 1-4 word punchy hook in ALL CAPS. Examples: "AI WILL REPLACE YOU", "IT ACTUALLY WORKS", "THE FUTURE IS HERE", "NEVER BAKE AGAIN". This gets rendered as a large text overlay on top of the image.
• moment: one sentence describing what part of the video (or what claim from the transcript) this concept draws on.
• imagePrompt: a detailed text-to-image prompt. Every prompt MUST include: hyper-idealized subject, cinematic/dramatic composition, high-impact lighting (rim, golden hour, neon, chiaroscuro — pick what fits), vibrant color palette, shallow depth of field when relevant, and clear negative space in the TOP-LEFT 25% of the frame for a text overlay. Do NOT instruct the image model to render any text, logos, watermarks, real celebrities, or copyrighted characters.`;

  const userPrompt = `Video title: ${videoTitle || '(unknown)'}
Target aspect ratio: ${aspectLabel}
User style hint: ${hint || '(none — choose what best fits the topic)'}

Transcript (may be truncated):
"""
${safeTranscript || '(no transcript available)'}
"""

Return JSON shaped as:
{
  "hookTopic": "One short phrase naming the abstract topic.",
  "concepts": [
    {
      "angle": "character" | "action" | "object",
      "title": "1-4 WORD PUNCHY HOOK IN CAPS",
      "moment": "One sentence tying this to the video.",
      "imagePrompt": "Detailed visual prompt following the rules above."
    }
  ]
}`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  const raw = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  if (!raw) throw new Error('Concept generation returned empty response');

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('Concept JSON parse failed: ' + e.message); }

  const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  if (concepts.length === 0) throw new Error('Model returned no concepts');

  const validAngles = new Set(['character', 'action', 'object']);
  return concepts.slice(0, count).map((c, i) => ({
    angle: validAngles.has(String(c.angle)) ? String(c.angle) : (anglesToUse[i] && anglesToUse[i].key) || 'character',
    title: String(c.title || `Concept ${i + 1}`).slice(0, 60),
    moment: String(c.moment || '').slice(0, 200),
    imagePrompt: String(c.imagePrompt || c.prompt || '').slice(0, 1800),
    hookTopic: String(parsed.hookTopic || '').slice(0, 160)
  }));
}

// ============================================================================
// ROLLBACK: Previous GPT-image-1 implementation (commented out for one-touch
// rollback if Flux Schnell turns out to not meet the bar). To revert: delete
// the Flux implementation below and uncomment this block.
// ============================================================================
/*
// Map aspect ratio string to the GPT-image-1 size parameter.
function aspectToImageSize(aspect) {
  if (aspect === '9:16') return '1024x1536';
  if (aspect === '1:1') return '1024x1024';
  return '1536x1024'; // default 16:9
}

// Call GPT-image-1 via raw REST (bypasses any SDK version gaps for this model).
async function generateAIImage({ prompt, aspect, jobId, index }) {
  const size = aspectToImageSize(aspect);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt,
      size: size,
      n: 1,
      quality: 'medium'
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('gpt-image-1 HTTP ' + resp.status + ': ' + errText.slice(0, 300));
  }

  const data = await resp.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('gpt-image-1 returned no image data');

  const filename = 'ai-thumb-' + jobId + '-' + index + '.png';
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
  return { filename };
}
*/

// Normalize aspect ratio to a value Flux Schnell accepts directly as input.
function aspectForFlux(aspect) {
  if (aspect === '9:16') return '9:16';
  if (aspect === '1:1') return '1:1';
  return '16:9'; // default
}

// Locate a bold TrueType font on the host for the text overlay. Checked in
// preference order — first match wins. Returns null if none are present, in
// which case the overlay step is skipped (raw image is served instead).
let _cachedFontPath;
function findSystemFont() {
  if (_cachedFontPath !== undefined) return _cachedFontPath;
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
  ];
  for (const f of candidates) {
    try { if (fs.existsSync(f)) { _cachedFontPath = f; return f; } } catch (e) {}
  }
  _cachedFontPath = null;
  return null;
}

// Burn the 1-4 word hook title onto the image using ffmpeg drawtext.
// Text goes in the TOP-LEFT safe zone (out of the way of YouTube's bottom
// scrubber and right-side share/close buttons). Font scales with image height.
// High-contrast dark box + shadow keeps it legible on any background.
// Uses the textfile= form of drawtext so apostrophes/colons/etc in titles
// don't require ffmpeg-filter escaping gymnastics.
async function compositeHookTitle(inputPath, titleText, outputPath) {
  const cleanTitle = String(titleText || '').trim().slice(0, 60);
  if (!cleanTitle) {
    // No title — just copy input to output
    fs.copyFileSync(inputPath, outputPath);
    return;
  }
  const font = findSystemFont();
  if (!font) {
    console.warn('[AI Thumbnail] No bold font found on host — skipping title overlay.');
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const textfilePath = path.join(outputDir, `title-${uuidv4().slice(0, 8)}.txt`);
  fs.writeFileSync(textfilePath, cleanTitle);

  // Filter breakdown:
  //   fontfile=...            explicit font path
  //   textfile=...            read text from file (avoids escape issues)
  //   fontsize=h*0.075        ~7.5% of image height — big and bold
  //   fontcolor=white
  //   x=w*0.05 y=h*0.05       top-left safe zone with 5% padding
  //   box=1 boxcolor=black@0.45 boxborderw=22    dark rounded-ish backdrop
  //   shadowcolor=black@0.9 shadowx=3 shadowy=3  extra legibility
  const filter = [
    'drawtext=',
    `fontfile='${font}'`,
    `:textfile='${textfilePath}'`,
    ':fontsize=h*0.075',
    ':fontcolor=white',
    ':x=w*0.05:y=h*0.05',
    ':box=1:boxcolor=black@0.45:boxborderw=22',
    ':shadowcolor=black@0.9:shadowx=3:shadowy=3'
  ].join('');

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath || 'ffmpeg', [
      '-i', inputPath,
      '-vf', filter,
      '-y',
      outputPath
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      try { fs.unlinkSync(textfilePath); } catch (e) {}
      if (code === 0) resolve();
      else reject(new Error('compositeHookTitle ffmpeg exit ' + code + ': ' + stderr.slice(-220)));
    });
    proc.on('error', (err) => {
      try { fs.unlinkSync(textfilePath); } catch (e) {}
      reject(err);
    });
  });
}

// Generate a thumbnail image via Replicate's Flux Schnell model.
// Uses predictions.create + wait so we get a stable URL output shape across
// replicate SDK versions (unlike replicate.run() which started returning
// ReadableStream instances in v1.x). Schnell typically completes in 2-4s.
// After the image comes back, the hook title is burned into the top-left
// safe zone via compositeHookTitle().
async function generateAIImage({ prompt, aspect, jobId, index, title }) {
  if (!replicate){
    throw new Error('Replicate SDK is not installed on this server. Run `npm install replicate` or set REPLICATE_API_TOKEN.');
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN not configured');
  }

  const prediction = await replicate.predictions.create({
    model: 'black-forest-labs/flux-schnell',
    input: {
      prompt: prompt,
      aspect_ratio: aspectForFlux(aspect),
      num_outputs: 1,
      output_format: 'png',
      output_quality: 90,
      megapixels: '1',
      num_inference_steps: 4,
      go_fast: true
    }
  });

  const finalPrediction = await replicate.wait(prediction, { interval: 1500 });

  if (finalPrediction.status !== 'succeeded') {
    const err = finalPrediction.error ? String(finalPrediction.error).slice(0, 300) : 'no error detail';
    throw new Error(`Replicate prediction ${finalPrediction.status}: ${err}`);
  }

  const out = finalPrediction.output;
  const imageUrl = Array.isArray(out) ? out[0] : out;
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Replicate returned no image URL');
  }

  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    throw new Error(`Failed to download generated image: HTTP ${imgResp.status}`);
  }
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());

  const rawFilename = `ai-thumb-${jobId}-${index}-raw.png`;
  const rawPath = path.join(outputDir, rawFilename);
  fs.writeFileSync(rawPath, imgBuffer);

  const finalFilename = `ai-thumb-${jobId}-${index}.png`;
  const finalPath = path.join(outputDir, finalFilename);

  try {
    await compositeHookTitle(rawPath, title, finalPath);
    try { fs.unlinkSync(rawPath); } catch (e) {}
  } catch (overlayErr) {
    // Fall back to the raw image if overlay fails (font missing, ffmpeg
    // weirdness, etc.). User still gets a thumbnail.
    console.warn('[AI Thumbnail] title overlay failed, serving raw Flux image:', overlayErr.message);
    try { fs.renameSync(rawPath, finalPath); } catch (e) {
      throw new Error('Both overlay and raw fallback failed: ' + overlayErr.message);
    }
  }

  return { filename: finalFilename };
}

// Pull the best-effort YouTube title when we have a URL. Falls back to empty
// string if yt-dlp/ytdl-core aren't available or the call fails.
async function getYouTubeTitle(videoUrl) {
  if (ytdlpPath) {
    try {
      const title = await new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, [
          '--get-title', '--no-playlist', '--no-warnings',
          ...YTDLP_COMMON_ARGS,
          videoUrl
        ]);
        let out = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error('yt-dlp title exit ' + code)));
        proc.on('error', reject);
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} reject(new Error('title timeout')); }, 15000);
      });
      if (title) return title;
    } catch (e) { /* fall through */ }
  }
  if (ytdl) {
    try {
      const info = await ytdl.getBasicInfo(videoUrl);
      return (info && info.videoDetails && info.videoDetails.title) || '';
    } catch (e) { /* fall through */ }
  }
  return '';
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
        height: auto;
        max-height: 360px;
        object-fit: contain;
        background: #000;
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
        height: auto;
        max-height: 480px;
        object-fit: contain;
        background: #000;
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

      /* ===== AI Generated tab ===== */
      .ai-intro {
        color: var(--text-muted);
        margin-bottom: 1.5rem;
        line-height: 1.55;
      }

      .ai-source-tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.25rem;
        padding: 0.3rem;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 10px;
        width: fit-content;
      }

      .ai-source-tab {
        padding: 0.55rem 1.1rem;
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-weight: 600;
        font-size: 0.9rem;
        border-radius: 7px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .ai-source-tab.active {
        background: var(--primary);
        color: #fff;
      }

      .ai-controls {
        margin-top: 1.5rem;
      }

      .ai-aspect-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }

      .ai-aspect-btn {
        padding: 0.65rem 1.2rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: var(--text-muted);
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.9rem;
        transition: all 0.2s;
      }

      .ai-aspect-btn.active {
        background: var(--primary);
        border-color: var(--primary);
        color: #fff;
      }

      .ai-aspect-btn:hover:not(.active) {
        color: var(--text);
        border-color: rgba(255, 255, 255, 0.2);
      }

      .ai-progress {
        margin-top: 1.25rem;
        padding: 1rem 1.25rem;
        background: rgba(108, 58, 237, 0.1);
        border: 1px solid rgba(108, 58, 237, 0.25);
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: var(--text);
      }

      .ai-results-section {
        margin-top: 2rem;
      }

      .ai-results-caption {
        color: var(--text-muted);
        margin-bottom: 1.25rem;
        font-size: 0.9rem;
        line-height: 1.5;
      }

      .ai-results-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .ai-thumb-card {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.3s;
        display: flex;
        flex-direction: column;
      }

      .ai-thumb-card:hover {
        border-color: var(--primary);
        transform: translateY(-4px);
        box-shadow: 0 8px 20px rgba(108, 58, 237, 0.2);
      }

      .ai-thumb-image {
        width: 100%;
        height: auto;
        display: block;
        background: #000;
      }

      .ai-thumb-body {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }

      .ai-thumb-kicker {
        color: var(--text-muted);
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-weight: 600;
      }

      .ai-thumb-title {
        color: var(--text);
        font-weight: 600;
        font-size: 0.95rem;
      }

      .ai-thumb-caption {
        color: var(--primary);
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      .ai-thumb-moment {
        color: var(--text-muted);
        font-size: 0.8rem;
        line-height: 1.45;
      }

      .ai-thumb-download {
        margin-top: auto;
        display: block;
        padding: 0.6rem;
        text-align: center;
        background: var(--primary);
        color: #fff;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.88rem;
        transition: all 0.2s;
      }

      .ai-thumb-download:hover {
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
          <button class="input-tab" data-tab="ai">AI Generated</button>
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

          <div id="aiTab" class="tab-content">
            <div class="ai-intro">
              Let AI watch your video, pick the most interesting moments, and design 4 custom thumbnails for you.
            </div>

            <div class="ai-source-tabs" role="tablist">
              <button type="button" class="ai-source-tab active" data-aisource="url">YouTube URL</button>
              <button type="button" class="ai-source-tab" data-aisource="upload">Upload Video</button>
            </div>

            <div class="ai-source-content" data-aisource-content="url">
              <div class="url-input-group">
                <label class="url-input-label">YouTube URL</label>
                <input type="text" id="aiYoutubeUrl" class="url-input" placeholder="https://youtube.com/watch?v=..." />
              </div>
            </div>

            <div class="ai-source-content" data-aisource-content="upload" style="display:none">
              <div class="upload-area" id="aiUploadArea" onclick="document.getElementById('aiFileInput').click()">
                <div class="upload-icon">🎬</div>
                <div class="upload-text">Drop your video file here</div>
                <div class="upload-subtext">Or click to select • MP4, MOV, WebM supported</div>
                <input type="file" id="aiFileInput" class="file-input" accept="video/*">
                <div id="aiFileName" class="file-name" style="display: none;"></div>
              </div>
            </div>

            <div class="ai-controls">
              <label class="url-input-label">Aspect ratio</label>
              <div class="ai-aspect-row">
                <button type="button" class="ai-aspect-btn active" data-aspect="16:9">16:9 &bull; YouTube</button>
                <button type="button" class="ai-aspect-btn" data-aspect="9:16">9:16 &bull; Shorts / TikTok</button>
                <button type="button" class="ai-aspect-btn" data-aspect="1:1">1:1 &bull; Square</button>
              </div>

              <label class="url-input-label" style="margin-top: 1.25rem;">Number of thumbnails</label>
              <div class="ai-aspect-row">
                <button type="button" class="ai-aspect-btn ai-count-btn" data-count="1">1 &bull; Character</button>
                <button type="button" class="ai-aspect-btn ai-count-btn" data-count="2">2 &bull; + Action</button>
                <button type="button" class="ai-aspect-btn ai-count-btn active" data-count="3">3 &bull; + Object</button>
              </div>

              <label class="url-input-label" style="margin-top: 1.25rem;">Style hint (optional)</label>
              <input type="text" id="aiStyleHint" class="url-input" placeholder="e.g. bright and energetic, dark cinematic, bold minimal" maxlength="300" />
            </div>

            <button type="button" class="action-button" id="aiGenerateBtn" disabled>
              Generate 3 AI Thumbnails
            </button>

            <div id="aiProgress" class="ai-progress" style="display: none;">
              <span class="spinner"></span>
              <span id="aiProgressMsg">Starting&hellip;</span>
            </div>
          </div>

          <button type="submit" class="action-button" id="extractBtn" disabled>
            Extract Frames from Video
          </button>
          <div id="errorMessage" style="display: none;"></div>
        </form>
      </div>

      <div class="ai-results-section" id="aiResultsSection" style="display: none;">
        <h2 style="margin-bottom: 0.5rem; color: var(--text);">Your AI-Generated Thumbnails</h2>
        <div class="ai-results-caption" id="aiResultsCaption"></div>
        <div class="ai-results-grid" id="aiResultsGrid"></div>
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

    // Tab switching — also toggles visibility of the classic extract button
    // and AI-generated section depending on which top-level tab is active.
    document.querySelectorAll('.input-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        const targetTab = document.getElementById(tabName + 'Tab');
        if (targetTab) targetTab.classList.add('active');

        const isAiMode = (tabName === 'ai');
        const extractBtnEl = document.getElementById('extractBtn');
        const framesSection = document.getElementById('framesSection');
        const previewSection = document.getElementById('previewSection');
        const aiResultsSection = document.getElementById('aiResultsSection');

        if (extractBtnEl) extractBtnEl.style.display = isAiMode ? 'none' : '';
        if (framesSection) framesSection.style.display = isAiMode ? 'none' : (framesSection.dataset.hadFrames ? 'block' : 'none');
        if (previewSection) previewSection.style.display = isAiMode ? 'none' : (previewSection.classList.contains('show') ? 'block' : '');
        if (aiResultsSection) aiResultsSection.style.display = isAiMode ? (aiResultsSection.dataset.hasResults ? 'block' : 'none') : 'none';

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

        const fs_ = document.getElementById('framesSection');
        fs_.style.display = 'block';
        fs_.dataset.hadFrames = '1';
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

    // ===========================================================
    // AI Generated tab — separate flow (no frame extraction)
    // ===========================================================
    var aiActiveSource = 'url';
    var aiActiveAspect = '16:9';
    var aiActiveCount = 3;

    document.querySelectorAll('.ai-source-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        aiActiveSource = btn.dataset.aisource;
        document.querySelectorAll('.ai-source-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('[data-aisource-content]').forEach(el => {
          el.style.display = (el.dataset.aisourceContent === aiActiveSource) ? '' : 'none';
        });
        checkAIInputs();
      });
    });

    // Aspect-ratio buttons (only the ones with data-aspect, not count buttons)
    document.querySelectorAll('.ai-aspect-btn[data-aspect]').forEach(btn => {
      btn.addEventListener('click', () => {
        aiActiveAspect = btn.dataset.aspect;
        document.querySelectorAll('.ai-aspect-btn[data-aspect]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Count buttons — keep the generate button label in sync with selection
    function updateGenerateBtnLabel() {
      const btn = document.getElementById('aiGenerateBtn');
      if (!btn || btn.classList.contains('loading')) return;
      btn.innerHTML = 'Generate ' + aiActiveCount + ' AI Thumbnail' + (aiActiveCount === 1 ? '' : 's');
    }
    document.querySelectorAll('.ai-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        aiActiveCount = parseInt(btn.dataset.count, 10) || 3;
        document.querySelectorAll('.ai-count-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateGenerateBtnLabel();
      });
    });

    const aiYoutubeUrlEl = document.getElementById('aiYoutubeUrl');
    const aiFileInputEl = document.getElementById('aiFileInput');
    const aiUploadAreaEl = document.getElementById('aiUploadArea');
    const aiFileNameEl = document.getElementById('aiFileName');
    const aiGenerateBtn = document.getElementById('aiGenerateBtn');
    const aiProgressEl = document.getElementById('aiProgress');
    const aiProgressMsgEl = document.getElementById('aiProgressMsg');

    if (aiYoutubeUrlEl) aiYoutubeUrlEl.addEventListener('input', checkAIInputs);
    if (aiFileInputEl) {
      aiFileInputEl.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          aiFileNameEl.textContent = '🎬 ' + e.target.files[0].name;
          aiFileNameEl.style.display = 'block';
        }
        checkAIInputs();
      });
    }
    if (aiUploadAreaEl) {
      aiUploadAreaEl.addEventListener('dragover', (e) => { e.preventDefault(); aiUploadAreaEl.classList.add('dragover'); });
      aiUploadAreaEl.addEventListener('dragleave', () => aiUploadAreaEl.classList.remove('dragover'));
      aiUploadAreaEl.addEventListener('drop', (e) => {
        e.preventDefault();
        aiUploadAreaEl.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
          aiFileInputEl.files = e.dataTransfer.files;
          aiFileNameEl.textContent = '🎬 ' + e.dataTransfer.files[0].name;
          aiFileNameEl.style.display = 'block';
          checkAIInputs();
        }
      });
    }

    function checkAIInputs() {
      const hasUrl = aiActiveSource === 'url' && aiYoutubeUrlEl && aiYoutubeUrlEl.value.trim().length > 0;
      const hasFile = aiActiveSource === 'upload' && aiFileInputEl && aiFileInputEl.files.length > 0;
      if (aiGenerateBtn) aiGenerateBtn.disabled = !(hasUrl || hasFile);
    }

    // Cycle progress messages while the backend is working.
    let aiProgressTimer = null;
    function startAIProgress() {
      const stages = [
        'Downloading video…',
        'Extracting audio…',
        'Transcribing with Whisper (this usually takes the longest)…',
        'Identifying the most interesting moments…',
        'Designing thumbnail concepts…',
        'Generating images with GPT-image-1 (this can take 20-40 seconds)…',
        'Rendering final thumbnails…'
      ];
      let idx = 0;
      aiProgressMsgEl.textContent = stages[0];
      aiProgressEl.style.display = 'flex';
      clearInterval(aiProgressTimer);
      aiProgressTimer = setInterval(() => {
        idx = Math.min(idx + 1, stages.length - 1);
        aiProgressMsgEl.textContent = stages[idx];
      }, 7000);
    }
    function stopAIProgress() {
      clearInterval(aiProgressTimer);
      aiProgressTimer = null;
      aiProgressEl.style.display = 'none';
    }

    if (aiGenerateBtn) {
      aiGenerateBtn.addEventListener('click', async () => {
        clearError();
        const hasUrl = aiActiveSource === 'url' && aiYoutubeUrlEl.value.trim().length > 0;
        const hasFile = aiActiveSource === 'upload' && aiFileInputEl.files.length > 0;
        if (!hasUrl && !hasFile) {
          showError(aiActiveSource === 'url' ? 'Please paste a YouTube URL' : 'Please upload a video file');
          return;
        }

        const formData = new FormData();
        formData.set('inputMode', aiActiveSource);
        formData.set('aspect', aiActiveAspect);
        formData.set('styleHint', document.getElementById('aiStyleHint').value.trim());
        formData.set('count', String(aiActiveCount));
        if (hasUrl) formData.set('youtubeUrl', aiYoutubeUrlEl.value.trim());
        if (hasFile) formData.set('videoFile', aiFileInputEl.files[0]);

        aiGenerateBtn.disabled = true;
        aiGenerateBtn.classList.add('loading');
        aiGenerateBtn.innerHTML = '<span class="spinner"></span> Working&hellip;';
        startAIProgress();

        try {
          const response = await fetch('/ai-thumbnail/ai-generate', {
            method: 'POST',
            body: formData
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.message || 'AI thumbnail generation failed');
          }
          renderAIResults(data);
          showToast('AI thumbnails generated', 4000);
        } catch (err) {
          showError('Error: ' + err.message);
        } finally {
          stopAIProgress();
          aiGenerateBtn.classList.remove('loading');
          aiGenerateBtn.innerHTML = 'Generate ' + aiActiveCount + ' AI Thumbnail' + (aiActiveCount === 1 ? '' : 's');
          checkAIInputs();
        }
      });
    }

    function renderAIResults(data) {
      const section = document.getElementById('aiResultsSection');
      const grid = document.getElementById('aiResultsGrid');
      const caption = document.getElementById('aiResultsCaption');
      if (!section || !grid) return;
      grid.innerHTML = '';

      const bits = [];
      if (data.hookTopic) bits.push('Hook topic: ' + data.hookTopic);
      if (data.videoTitle) bits.push('Source: "' + data.videoTitle + '"');
      if (data.aspect) bits.push('Aspect: ' + data.aspect);
      if (data.partialFailures && data.partialFailures.length) {
        bits.push(data.partialFailures.length + ' of ' + (data.thumbnails.length + data.partialFailures.length) + ' image(s) failed to render — showing the ones that succeeded');
      }
      caption.textContent = bits.join(' · ');

      const angleLabel = { character: 'Character Focus', action: 'Action Focus', object: 'Object Focus' };
      data.thumbnails.forEach(thumb => {
        const card = document.createElement('div');
        card.className = 'ai-thumb-card';
        const typeLabel = thumb.outputType || 'Generated Thumbnail';
        const angleText = thumb.angle && angleLabel[thumb.angle] ? angleLabel[thumb.angle] : '';
        card.innerHTML = \`
          <img src="/ai-thumbnail/serve/\${thumb.filename}" class="ai-thumb-image" alt="\${(thumb.title || 'AI Thumbnail').replace(/"/g, '&quot;')}">
          <div class="ai-thumb-body">
            <div class="ai-thumb-kicker">\${escapeHtml(typeLabel)}\${angleText ? ' &middot; ' + escapeHtml(angleText) : ''}</div>
            <div class="ai-thumb-title">\${escapeHtml(thumb.title || 'AI Thumbnail')}</div>
            \${thumb.moment ? '<div class="ai-thumb-moment">' + escapeHtml(thumb.moment) + '</div>' : ''}
            <a href="/ai-thumbnail/download/\${thumb.filename}" class="ai-thumb-download" download>Download</a>
          </div>
        \`;
        grid.appendChild(card);
      });
      section.dataset.hasResults = '1';
      section.style.display = 'block';
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

    // Detect the frame's real dimensions so the generated thumbnail matches
    // the video's aspect ratio (9:16, 1:1, 16:9, etc.) instead of being stretched.
    const frameDims = await getFrameDimensions(framePath);
    const outputSize = computeOutputSize(frameDims.width, frameDims.height);

    for (const styleKey of styleKeys) {
      const preset = thumbnailStylePresets[styleKey];
      if (!preset) continue;

      const outputFilename = `thumb-${jobId}-${styleKey}.png`;
      const outputPath = path.join(outputDir, outputFilename);

      try {
        await preset.apply(framePath, outputPath, outputSize);
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

// POST - AI-Generated Thumbnails
// Accepts a video (uploaded file OR YouTube URL), transcribes the audio,
// asks GPT-4o-mini to propose N thumbnail concepts rooted in the video's
// most interesting moments, then renders each concept into an image via
// GPT-image-1 in parallel. Returns the array of generated thumbnails.
router.post('/ai-generate', requireAuth, upload.single('videoFile'), async (req, res) => {
  let videoPath = null;
  let downloadedYoutubeFile = null;
  let audioPath = null;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, message: 'OpenAI API key not configured on the server' });
    }

    const inputMode = (req.body.inputMode || 'upload').toString();
    const youtubeUrl = (req.body.youtubeUrl || '').toString().trim();
    const aspect = ['16:9', '9:16', '1:1'].includes(req.body.aspect) ? req.body.aspect : '16:9';
    const styleHint = (req.body.styleHint || '').toString().slice(0, 300);
    const requestedCount = Math.min(Math.max(parseInt(req.body.count, 10) || 3, 1), 3);
    const videoFile = req.file;

    // Resolve the source video path
    let videoTitle = '';
    if (inputMode === 'url' && youtubeUrl) {
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid YouTube URL' });
      }
      try {
        videoPath = await downloadYouTubeVideo(youtubeUrl);
        downloadedYoutubeFile = videoPath;
      } catch (dlErr) {
        console.error('[AI Thumbnail AI-Gen] YouTube download failed:', dlErr.message);
        return res.status(400).json({ success: false, message: 'Could not download that YouTube video. It may be private, age-restricted, or blocked from this server.' });
      }
      videoTitle = await getYouTubeTitle(youtubeUrl).catch(() => '');
    } else if (videoFile) {
      videoPath = videoFile.path;
    } else {
      return res.status(400).json({ success: false, message: 'Please provide a YouTube URL or upload a video' });
    }

    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ success: false, message: 'Video file not found on server' });
    }

    // Extract audio + transcribe
    let transcript = '';
    try {
      audioPath = await extractAudioForAIThumbnail(videoPath);
      transcript = await transcribeForAIThumbnail(audioPath);
    } catch (err) {
      console.warn('[AI Thumbnail AI-Gen] Transcription step failed, continuing with empty transcript:', err.message);
      transcript = '';
    }

    // If transcription yielded nothing AND we have no title, the model has
    // nothing to work with — ask the user to add a hint.
    if (!transcript && !videoTitle && !styleHint) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract any audio or title from the video. Add a style hint describing the video and try again.'
      });
    }

    // Generate concepts via GPT-4o-mini
    const aspectLabel = aspect === '16:9' ? 'Horizontal 16:9 (YouTube)'
      : aspect === '9:16' ? 'Vertical 9:16 (Shorts / TikTok / Reels)'
      : 'Square 1:1 (Instagram)';

    let concepts;
    try {
      concepts = await generateThumbnailConcepts({
        transcript,
        hint: styleHint,
        videoTitle,
        aspectLabel,
        count: requestedCount
      });
    } catch (err) {
      console.error('[AI Thumbnail AI-Gen] Concept generation failed:', err.message);
      return res.status(500).json({ success: false, message: 'Could not generate thumbnail concepts: ' + err.message });
    }

    // Generate images in parallel
    const jobId = uuidv4().slice(0, 10);
    const results = await Promise.allSettled(concepts.map((concept, index) =>
      generateAIImage({ prompt: concept.imagePrompt, aspect, jobId, index, title: concept.title })
        .then((img) => ({ ...img, concept }))
    ));

    const thumbnails = [];
    const failures = [];
    let hookTopic = '';
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        thumbnails.push({
          filename: r.value.filename,
          outputType: 'Generated Thumbnail',
          title: r.value.concept.title,
          angle: r.value.concept.angle,
          moment: r.value.concept.moment,
          prompt: r.value.concept.imagePrompt
        });
        if (!hookTopic && r.value.concept.hookTopic) hookTopic = r.value.concept.hookTopic;
      } else {
        failures.push({ index: i, error: r.reason && r.reason.message ? r.reason.message : String(r.reason) });
      }
    });

    if (thumbnails.length === 0) {
      const msg = failures.length
        ? 'All image generations failed. First error: ' + failures[0].error
        : 'No thumbnails produced';
      return res.status(500).json({ success: false, message: msg });
    }

    featureUsageOps.log(req.user.id, 'ai_thumbnails_ai').catch(() => {});
    res.json({
      success: true,
      thumbnails,
      partialFailures: failures,
      aspect,
      hookTopic,
      transcriptPreview: transcript ? transcript.slice(0, 400) : '',
      videoTitle
    });
  } catch (error) {
    console.error('[AI Thumbnail AI-Gen] Unhandled error:', error);
    res.status(500).json({ success: false, message: error.message || 'AI thumbnail generation failed' });
  } finally {
    // Cleanup temp files
    if (audioPath) { try { fs.unlinkSync(audioPath); } catch (e) {} }
    if (downloadedYoutubeFile) { try { fs.unlinkSync(downloadedYoutubeFile); } catch (e) {} }
    if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
  }
});

module.exports = router;
