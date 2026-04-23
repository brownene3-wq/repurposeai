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

// Common yt-dlp args (same as shorts.js)
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
  const outputPath = path.join(uploadDir, `yt-reframe-${videoId}.mp4`);

  // Clean up any existing file
  try { fs.unlinkSync(outputPath); } catch (e) {}

  // Strategy 1: yt-dlp
  if (ytdlpPath) {
    try {
      console.log(`[AI Reframe] Downloading ${videoUrl} via yt-dlp...`);
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
        // Timeout after 3 minutes
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} reject(new Error('Download timed out')); }, 180000);
      });

      // yt-dlp may change extension
      if (!fs.existsSync(outputPath)) {
        const base = path.join(uploadDir, `yt-reframe-${videoId}`);
        for (const ext of ['.mp4', '.mkv', '.webm']) {
          if (fs.existsSync(base + ext)) {
            fs.renameSync(base + ext, outputPath);
            break;
          }
        }
      }

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
        console.log(`[AI Reframe] yt-dlp download success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return outputPath;
      }
    } catch (err) {
      console.log(`[AI Reframe] yt-dlp failed: ${err.message.slice(0, 200)}`);
    }
  }

  // Strategy 2: @distube/ytdl-core fallback
  if (ytdl) {
    try {
      console.log(`[AI Reframe] Trying ytdl-core fallback for ${videoUrl}...`);
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
        console.log(`[AI Reframe] ytdl-core download success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return outputPath;
      }
    } catch (err) {
      console.log(`[AI Reframe] ytdl-core fallback failed: ${err.message.slice(0, 200)}`);
    }
  }

  throw new Error('Failed to download YouTube video. The video may be private, age-restricted, or unavailable.');
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

// Aspect ratio configurations: [width, height, name]
const aspectRatios = {
  '9:16': { width: 1080, height: 1920, name: '9-16-vertical' },
  '1:1': { width: 1080, height: 1080, name: '1-1-square' },
  '4:5': { width: 1080, height: 1350, name: '4-5-portrait' },
  '16:9': { width: 1920, height: 1080, name: '16-9-landscape' }
};

// Get video dimensions
function getVideoDimensions(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', filePath];
    const ffprobe = spawn(ffmpegPath === 'ffmpeg' ? 'ffprobe' : ffmpegPath.replace('ffmpeg', 'ffprobe'), args);
    let output = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const [width, height] = output.trim().split('x').map(Number);
        resolve({ width, height });
      } else {
        reject(new Error('Failed to get video dimensions'));
      }
    });

    ffprobe.on('error', reject);
  });
}

// Calculate center crop dimensions
function calculateCropDimensions(inputWidth, inputHeight, targetWidth, targetHeight) {
  const inputAspect = inputWidth / inputHeight;
  const targetAspect = targetWidth / targetHeight;

  let cropWidth, cropHeight;

  if (inputAspect > targetAspect) {
    cropHeight = inputHeight;
    cropWidth = Math.floor(inputHeight * targetAspect);
  } else {
    cropWidth = inputWidth;
    cropHeight = Math.floor(inputWidth / targetAspect);
  }

  const x = Math.floor((inputWidth - cropWidth) / 2);
  const y = Math.floor((inputHeight - cropHeight) / 2);

  return { cropWidth, cropHeight, x, y };
}

// Run Python face detection script
function detectFaces(videoPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'face-detect.py');
    // 0.25s sample interval: dense enough that a face moving a face-width
    // (~100px) between samples is well under the centroid-distance match
    // radius, keeping tracks attached through fast shifts.
    const proc = spawn('python3', [scriptPath, videoPath, '0.25']);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code === 0 && stdout.trim()) {
        try {
          const data = JSON.parse(stdout.trim());
          if (data.error) return reject(new Error(data.error));
          resolve(data);
        } catch (e) {
          reject(new Error('Failed to parse face detection output'));
        }
      } else {
        reject(new Error('Face detection failed: ' + (stderr || 'unknown error').slice(0, 300)));
      }
    });

    proc.on('error', reject);
    // Timeout after 2 minutes
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} reject(new Error('Face detection timed out')); }, 120000);
  });
}

// Calculate smoothed face-tracking crop positions
function calculateFaceTrackingCrop(faceData, inputWidth, inputHeight, targetWidth, targetHeight) {
  const inputAspect = inputWidth / inputHeight;
  const targetAspect = targetWidth / targetHeight;

  // Calculate crop dimensions (same as center crop)
  let cropWidth, cropHeight;
  if (inputAspect > targetAspect) {
    cropHeight = inputHeight;
    cropWidth = Math.floor(inputHeight * targetAspect);
  } else {
    cropWidth = inputWidth;
    cropHeight = Math.floor(inputWidth / targetAspect);
  }

  const samples = faceData.samples;

  // Calculate face center for each sample (average of all faces, or center if no faces)
  const positions = samples.map(sample => {
    if (sample.faces.length > 0) {
      // Average center of all detected faces
      const avgCx = sample.faces.reduce((sum, f) => sum + f.cx, 0) / sample.faces.length;
      const avgCy = sample.faces.reduce((sum, f) => sum + f.cy, 0) / sample.faces.length;
      return { time: sample.time, cx: avgCx, cy: avgCy, hasFace: true };
    } else {
      return { time: sample.time, cx: 0.5, cy: 0.5, hasFace: false };
    }
  });

  // Fill in gaps: if no face detected, use last known face position
  let lastKnownCx = 0.5, lastKnownCy = 0.5;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i].hasFace) {
      lastKnownCx = positions[i].cx;
      lastKnownCy = positions[i].cy;
    } else {
      positions[i].cx = lastKnownCx;
      positions[i].cy = lastKnownCy;
    }
  }

  // Smooth positions with moving average (window of 5) to prevent jitter
  const smoothed = positions.map((pos, i) => {
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    let sumCx = 0, sumCy = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(positions.length - 1, i + half); j++) {
      sumCx += positions[j].cx;
      sumCy += positions[j].cy;
      count++;
    }
    return { time: pos.time, cx: sumCx / count, cy: sumCy / count };
  });

  // Convert to pixel crop positions, clamped to frame bounds
  const cropPositions = smoothed.map(pos => {
    let x = Math.round(pos.cx * inputWidth - cropWidth / 2);
    let y = Math.round(pos.cy * inputHeight - cropHeight / 2);
    // Clamp to frame bounds
    x = Math.max(0, Math.min(inputWidth - cropWidth, x));
    y = Math.max(0, Math.min(inputHeight - cropHeight, y));
    return { time: pos.time, x, y };
  });

  return { cropWidth, cropHeight, positions: cropPositions };
}

// Process video with center crop (original method)
function processVideoCenterCrop(inputPath, outputPath, aspectRatio) {
  return new Promise(async (resolve, reject) => {
    try {
      const dimensions = await getVideoDimensions(inputPath);
      const { width: targetWidth, height: targetHeight } = aspectRatios[aspectRatio];
      const { cropWidth, cropHeight, x, y } = calculateCropDimensions(dimensions.width, dimensions.height, targetWidth, targetHeight);

      const filterComplex = `crop=${cropWidth}:${cropHeight}:${x}:${y},scale=${targetWidth}:${targetHeight}`;

      const args = [
        '-i', inputPath,
        '-vf', filterComplex,
        '-c:v', 'libx264',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
      ];

      const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg failed with code ${code}: ${errorOutput}`));
      });
      ffmpeg.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

// Process video with face tracking (smart crop)
function processVideoFaceTracking(inputPath, outputPath, aspectRatio, faceData) {
  return new Promise(async (resolve, reject) => {
    try {
      const dimensions = await getVideoDimensions(inputPath);
      const { width: targetWidth, height: targetHeight } = aspectRatios[aspectRatio];
      const { cropWidth, cropHeight, positions } = calculateFaceTrackingCrop(
        faceData, dimensions.width, dimensions.height, targetWidth, targetHeight
      );

      // If all positions are the same (no face movement), use simple crop
      const allSameX = positions.every(p => p.x === positions[0].x);
      const allSameY = positions.every(p => p.y === positions[0].y);
      if (allSameX && allSameY) {
        const filterComplex = `crop=${cropWidth}:${cropHeight}:${positions[0].x}:${positions[0].y},scale=${targetWidth}:${targetHeight}`;
        const args = [
          '-i', inputPath, '-vf', filterComplex,
          '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart', outputPath
        ];
        const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
        let errorOutput = '';
        ffmpeg.stderr.on('data', d => { errorOutput += d.toString(); });
        ffmpeg.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg failed: ${errorOutput}`));
        });
        ffmpeg.on('error', reject);
        return;
      }

      // Build dynamic crop expression using keyframe interpolation
      // FFmpeg crop filter supports expressions with t (time in seconds)
      // We build a piecewise linear interpolation using if/between expressions
      let xExpr = String(positions[0].x);
      let yExpr = String(positions[0].y);

      // Build piecewise linear x expression
      // For each segment between two keyframes, linearly interpolate
      const xParts = [];
      const yParts = [];
      for (let i = 0; i < positions.length - 1; i++) {
        const t0 = positions[i].time;
        const t1 = positions[i + 1].time;
        const x0 = positions[i].x;
        const x1 = positions[i + 1].x;
        const y0 = positions[i].y;
        const y1 = positions[i + 1].y;
        const dt = t1 - t0 || 0.001;
        // Linear interpolation: x0 + (x1-x0) * (t-t0) / (t1-t0)
        xParts.push(`if(between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})\\,${x0}+(${x1}-${x0})*(t-${t0.toFixed(3)})/${dt.toFixed(3)}`);
        yParts.push(`if(between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})\\,${y0}+(${y1}-${y0})*(t-${t0.toFixed(3)})/${dt.toFixed(3)}`);
      }

      // Chain with nested if/else, fallback to last position
      const lastX = positions[positions.length - 1].x;
      const lastY = positions[positions.length - 1].y;

      if (xParts.length > 0) {
        // Nest the if expressions: if(cond1, val1, if(cond2, val2, ..., default))
        xExpr = xParts.reduceRight((acc, part) => `${part}\\,${acc})`, String(lastX));
        yExpr = yParts.reduceRight((acc, part) => `${part}\\,${acc})`, String(lastY));
      }

      const filterComplex = `crop=${cropWidth}:${cropHeight}:${xExpr}:${yExpr},scale=${targetWidth}:${targetHeight}`;

      const args = [
        '-i', inputPath,
        '-vf', filterComplex,
        '-c:v', 'libx264',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', d => { errorOutput += d.toString(); });
      ffmpeg.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg face-tracking failed: ${errorOutput.slice(-500)}`));
      });
      ffmpeg.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

// Main processVideo function - routes to center crop or face tracking
function processVideo(inputPath, outputPath, aspectRatio, cropMode, faceData) {
  if (cropMode === 'face-tracking' && faceData) {
    return processVideoFaceTracking(inputPath, outputPath, aspectRatio, faceData);
  }
  return processVideoCenterCrop(inputPath, outputPath, aspectRatio);
}

// =====================================================================
// MULTI-SUBJECT GRID RENDERER  (Deploy 2)
// =====================================================================

// Output dimensions for the grid (always 9:16 "short-form" canvas)
const GRID_OUT_W = 1080;
const GRID_OUT_H = 1920;

// Defaults
const BRAND_PURPLE_HEX = '0x6c3aed';
const DEFAULT_BG_SOLID_HEX = '0x181426';

// In-memory job cache: jobId -> { videoPath, detection, createdAt }
// Keeps the already-downloaded/detected video around so /render-grid doesn't
// need to re-download or re-detect. Jobs expire after 20 minutes.
const gridJobs = new Map();
const GRID_JOB_TTL_MS = 20 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of gridJobs.entries()) {
    if (now - job.createdAt > GRID_JOB_TTL_MS) {
      try { if (job.videoPath && fs.existsSync(job.videoPath)) fs.unlinkSync(job.videoPath); } catch (e) {}
      gridJobs.delete(id);
    }
  }
}, 60 * 1000).unref();

// Normalize a "#rrggbb" / "rrggbb" / "0xrrggbb" color to "0xrrggbb" for FFmpeg.
function normalizeHexColor(c, fallback) {
  if (!c) return fallback;
  const s = String(c).trim().toLowerCase();
  const m1 = s.match(/^#?([0-9a-f]{6})$/);
  if (m1) return '0x' + m1[1];
  const m2 = s.match(/^0x([0-9a-f]{6})$/);
  if (m2) return s;
  return fallback;
}

// Compute grid cell rectangles (pixel coords in a 1080x1920 viewport).
// Layouts match the spec:
//   1: single centered cell (for symmetry / solo mode)
//   2: vertical stack of 1:1 squares
//   3: wide top + two squares bottom
//   4: 2x2 matrix
function computeGridCells(n, padding) {
  const p = Math.max(0, Math.min(80, Math.round(padding)));
  const W = GRID_OUT_W, H = GRID_OUT_H;

  if (n === 1) {
    return [{ x: p, y: p, w: W - 2 * p, h: H - 2 * p }];
  }
  if (n === 2) {
    // Two 1:1 squares stacked vertically. Size to whichever dimension limits.
    const cell = Math.min(W - 2 * p, Math.floor((H - 3 * p) / 2));
    const totalH = 2 * cell + p;
    const top = Math.max(p, Math.floor((H - totalH) / 2));
    const left = Math.floor((W - cell) / 2);
    return [
      { x: left, y: top,              w: cell, h: cell },
      { x: left, y: top + cell + p,   w: cell, h: cell },
    ];
  }
  if (n === 3) {
    const bottom = Math.floor((W - 3 * p) / 2);    // square side length
    const topW = W - 2 * p;
    const topH = Math.max(200, H - 3 * p - bottom); // guard against tiny top on huge padding
    return [
      { x: p,               y: p,                w: topW,   h: topH },
      { x: p,               y: p + topH + p,     w: bottom, h: bottom },
      { x: p + bottom + p,  y: p + topH + p,     w: bottom, h: bottom },
    ];
  }
  // n >= 4: 2x2
  const cellW = Math.floor((W - 3 * p) / 2);
  const cellH = Math.floor((H - 3 * p) / 2);
  return [
    { x: p,             y: p,             w: cellW, h: cellH },
    { x: p * 2 + cellW, y: p,             w: cellW, h: cellH },
    { x: p,             y: p * 2 + cellH, w: cellW, h: cellH },
    { x: p * 2 + cellW, y: p * 2 + cellH, w: cellW, h: cellH },
  ];
}

// Compute a per-subject time-varying crop expression.
// Uses a fixed crop size based on the subject's max face width so the crop
// dimensions stay constant (FFmpeg's crop filter requires constant w/h); only
// the x/y positions interpolate. Aspect-matches the target cell.
function computeSubjectCropExpr(subject, inputW, inputH, cellW, cellH, options) {
  // Back-compat: old callers passed a numeric tightness as the 6th arg.
  // It's now interpreted as heightMult (the equivalent sizing knob).
  if (typeof options === 'number') options = { heightMult: options };
  options = options || {};
  // Ratio of crop height to face height. ~3.0 = shoulder-up composition
  // (face fills ~1/3 of crop height, shoulders + some breathing room).
  const heightMult = typeof options.heightMult === 'number' ? options.heightMult : 3.0;

  const samples = (subject.samples || []).slice();
  let maxFaceW = 0, maxFaceH = 0, sumCx = 0, sumCy = 0;
  for (const s of samples) {
    if (s.w > maxFaceW) maxFaceW = s.w;
    if (s.h > maxFaceH) maxFaceH = s.h;
    sumCx += s.cx; sumCy += s.cy;
  }
  if (maxFaceW <= 0) maxFaceW = 0.18;
  if (maxFaceH <= 0) maxFaceH = 0.22;
  const avgCx = samples.length ? sumCx / samples.length : 0.5;
  const avgCy = samples.length ? sumCy / samples.length : 0.5;

  const cellAspect = cellW / cellH;

  // Height-driven sizing: compose for shoulder-up by making crop height a
  // multiple of face height. Width is then derived from the cell aspect.
  let cropH = Math.round(maxFaceH * inputH * heightMult);
  let cropW = Math.round(cropH * cellAspect);

  // Multi-subject overlap guard: cropW must be STRICTLY less than the gap
  // to the nearest neighbor's center, or both cells will bleed into each
  // other and end up showing the same middle-of-frame content.
  if (typeof options.neighborCx === 'number') {
    const gapPx = Math.abs(options.neighborCx - avgCx) * inputW;
    if (gapPx > 0) {
      // Leave 60px buffer so each subject's crop ends well before the
      // neighbor's center. Min 240 to avoid absurdly tiny crops when
      // subjects are unavoidably close.
      const maxByNeighbor = Math.max(240, Math.round(gapPx - 60));
      if (cropW > maxByNeighbor) {
        cropW = maxByNeighbor;
        cropH = Math.round(cropW / cellAspect);
      }
    }
  }

  // Don't let the crop be so tiny that we'd have to scale it up >2.5x
  // (visibly pixelated). This also rescues small-face wide-shot cases.
  const minCropW = Math.round(cellW / 2.5);
  const minCropH = Math.round(cellH / 2.5);
  if (cropW < minCropW) { cropW = minCropW; cropH = Math.round(cropW / cellAspect); }
  if (cropH < minCropH) { cropH = minCropH; cropW = Math.round(cropH * cellAspect); }

  // Bound by source dims, then re-enforce aspect
  cropW = Math.min(inputW, cropW);
  cropH = Math.min(inputH, cropH);
  if (cropW / cropH > cellAspect) cropW = Math.round(cropH * cellAspect);
  else                            cropH = Math.round(cropW / cellAspect);

  // Ensure even dimensions for yuv420p
  if (cropW % 2 === 1) cropW -= 1;
  if (cropH % 2 === 1) cropH -= 1;

  // Shoulder-up composition: place the face center at ~30% from the top of
  // the crop. (Before: sign was inverted and face sat at ~62% from top,
  // giving headroom-heavy framing that cut off shoulders.)
  const FACE_TOP_FRACTION = 0.30;
  const positions = samples.map(s => {
    const fx = s.cx * inputW;
    // We want: face_center_y (in source) = y + FACE_TOP_FRACTION * cropH
    //     so: y = s.cy * inputH - FACE_TOP_FRACTION * cropH
    let x = Math.round(fx - cropW / 2);
    let y = Math.round(s.cy * inputH - FACE_TOP_FRACTION * cropH);
    x = Math.max(0, Math.min(inputW - cropW, x));
    y = Math.max(0, Math.min(inputH - cropH, y));
    return { time: s.time, x, y };
  });

  if (positions.length === 0) {
    const cx = Math.floor((inputW - cropW) / 2);
    const cy = Math.floor((inputH - cropH) / 2);
    return { cropW, cropH, xExpr: String(cx), yExpr: String(cy), avgCx, avgCy };
  }

  // Moving average smoothing (window=5) to prevent jitter.
  const smoothed = positions.map((pos, i) => {
    const half = 2;
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(positions.length - 1, i + half); j++) {
      sx += positions[j].x; sy += positions[j].y; c++;
    }
    return { time: pos.time, x: Math.round(sx / c), y: Math.round(sy / c) };
  });

  // Decimate the keyframes used for the piecewise expression. FFmpeg's
  // expression evaluator chokes on very deep `if(between(...), a, if(...))`
  // chains: the user's 48s clip with 0.25s sampling produced 192 nested
  // if() calls per subject (~12KB expression), which triggered
  // "Failed to configure input pad ... Error reinitializing filters!"
  // at runtime. 60 keyframes is plenty — the moving average above already
  // dampens sub-second jitter, and face tracking doesn't need finer
  // interpolation than ~1Hz.
  const MAX_KEYFRAMES = 60;
  let keyframes = smoothed;
  if (smoothed.length > MAX_KEYFRAMES) {
    keyframes = [];
    const step = smoothed.length / MAX_KEYFRAMES;
    for (let i = 0; i < smoothed.length; i += step) {
      keyframes.push(smoothed[Math.floor(i)]);
    }
    const last = smoothed[smoothed.length - 1];
    if (keyframes[keyframes.length - 1] !== last) keyframes.push(last);
  }

  // Piecewise-linear FFmpeg expression (same technique as single-subject tracking).
  const xParts = [], yParts = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const t0 = keyframes[i].time, t1 = keyframes[i + 1].time;
    const x0 = keyframes[i].x,    x1 = keyframes[i + 1].x;
    const y0 = keyframes[i].y,    y1 = keyframes[i + 1].y;
    const dt = (t1 - t0) || 0.001;
    xParts.push(`if(between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})\\,${x0}+(${x1}-${x0})*(t-${t0.toFixed(3)})/${dt.toFixed(3)}`);
    yParts.push(`if(between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})\\,${y0}+(${y1}-${y0})*(t-${t0.toFixed(3)})/${dt.toFixed(3)}`);
  }
  const lastX = keyframes[keyframes.length - 1].x;
  const lastY = keyframes[keyframes.length - 1].y;
  let xExpr = String(lastX), yExpr = String(lastY);
  if (xParts.length > 0) {
    xExpr = xParts.reduceRight((acc, part) => `${part}\\,${acc})`, String(lastX));
    yExpr = yParts.reduceRight((acc, part) => `${part}\\,${acc})`, String(lastY));
  }
  return { cropW, cropH, xExpr, yExpr, avgCx, avgCy };
}

// Build the FFmpeg filter_complex graph for an N-subject grid.
// Per-subject pipeline: split source -> crop (following face) -> scale to cell
// inner size -> pad for colored border -> overlay onto background layer.
function buildGridFilterGraph(subjects, cells, inputDims, config) {
  const { width: inputW, height: inputH } = inputDims;
  const n = subjects.length;
  const borderEnabled = !!(config.border && config.border.enabled);
  const borderThickness = borderEnabled ? Math.max(1, Math.min(12, config.border.width || 3)) : 0;
  const borderColor = normalizeHexColor(config.border && config.border.color, BRAND_PURPLE_HEX);
  const bgMode = (config.background && config.background.mode) || 'solid';
  const bgColor = normalizeHexColor(config.background && config.background.color, DEFAULT_BG_SOLID_HEX);

  const parts = [];
  const splitLabels = ['bg_src'];
  for (let i = 0; i < n; i++) splitLabels.push(`s${i}`);
  parts.push(`[0:v]split=${n + 1}[${splitLabels.join('][')}]`);

  // Background layer
  if (bgMode === 'blur') {
    parts.push(
      `[bg_src]scale=${GRID_OUT_W}:${GRID_OUT_H}:force_original_aspect_ratio=increase,` +
      `crop=${GRID_OUT_W}:${GRID_OUT_H},boxblur=30:3,eq=brightness=-0.15:saturation=1.05[bg]`
    );
  } else {
    parts.push(
      `[bg_src]scale=${GRID_OUT_W}:${GRID_OUT_H}:force_original_aspect_ratio=increase,` +
      `crop=${GRID_OUT_W}:${GRID_OUT_H},drawbox=x=0:y=0:w=iw:h=ih:color=${bgColor}@1:t=fill[bg]`
    );
  }

  // Pre-compute each subject's average (cx, cy) so we can clamp crop widths
  // by nearest-neighbor distance (prevents adjacent subjects from bleeding
  // into each other's crops).
  const subjAvg = subjects.map(s => {
    const sam = s.samples || [];
    if (!sam.length) return { cx: 0.5, cy: 0.5 };
    let sx = 0, sy = 0;
    for (const x of sam) { sx += x.cx; sy += x.cy; }
    return { cx: sx / sam.length, cy: sy / sam.length };
  });

  // Per-subject cells
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    const innerW = Math.max(20, cell.w - 2 * borderThickness);
    const innerH = Math.max(20, cell.h - 2 * borderThickness);
    // Ensure even
    const innerWE = innerW - (innerW % 2);
    const innerHE = innerH - (innerH % 2);

    // Nearest-neighbor cx across other selected subjects
    let neighborCx;
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.abs(subjAvg[j].cx - subjAvg[i].cx);
      if (d < minDist) { minDist = d; neighborCx = subjAvg[j].cx; }
    }

    const { cropW, cropH, xExpr, yExpr } = computeSubjectCropExpr(
      subjects[i], inputW, inputH, cell.w, cell.h, { neighborCx }
    );

    let chain = `[s${i}]crop=${cropW}:${cropH}:${xExpr}:${yExpr},scale=${innerWE}:${innerHE}`;
    if (borderThickness > 0) {
      chain += `,pad=${cell.w}:${cell.h}:${borderThickness}:${borderThickness}:color=${borderColor}`;
    }
    chain += `[cell${i}]`;
    parts.push(chain);
  }

  // Overlay cells onto background
  let lastLabel = 'bg';
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    const outLabel = (i === n - 1) ? 'vout' : `v${i}`;
    parts.push(`[${lastLabel}][cell${i}]overlay=x=${cell.x}:y=${cell.y}[${outLabel}]`);
    lastLabel = outLabel;
  }

  return parts.join(';');
}

// Render an N-subject grid MP4 from a source video + detection data + config.
function processVideoMultiGrid(inputPath, outputPath, detection, selectedSubjects, config) {
  return new Promise(async (resolve, reject) => {
    try {
      const dims = await getVideoDimensions(inputPath);
      const n = selectedSubjects.length;
      if (n < 1 || n > 4) return reject(new Error('Grid requires 1-4 subjects'));

      const padding = (typeof config.padding === 'number') ? config.padding : 16;
      const cells = computeGridCells(n, padding);
      const filterComplex = buildGridFilterGraph(selectedSubjects, cells, dims, config);

      // Diagnostic: per-subject avg position + sample count, helps debug
      // "both cells show the same person" style regressions.
      try {
        const diag = selectedSubjects.map(s => {
          const sam = s.samples || [];
          let sx = 0, sy = 0, mw = 0;
          for (const x of sam) { sx += x.cx; sy += x.cy; if (x.w > mw) mw = x.w; }
          return {
            id: s.id,
            samples: sam.length,
            avg_cx: sam.length ? +(sx/sam.length).toFixed(3) : null,
            avg_cy: sam.length ? +(sy/sam.length).toFixed(3) : null,
            max_w: +mw.toFixed(3),
            first: s.first_seen, last: s.last_seen,
          };
        });
        console.log('[AI Reframe Grid] input', dims, 'cells', cells);
        console.log('[AI Reframe Grid] subjects', JSON.stringify(diag));
        console.log('[AI Reframe Grid] graph\n' + filterComplex);
      } catch (_) {}

      // Long crop expressions can exceed shell argv limits; write the graph
      // to a temp script and use -/filter_complex_script for safety.
      const scriptPath = outputPath + '.filtergraph.txt';
      fs.writeFileSync(scriptPath, filterComplex, 'utf8');

      const args = [
        '-i', inputPath,
        '-filter_complex_script', scriptPath,
        '-map', '[vout]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ];

      const ffmpeg = spawn(ffmpegPath || 'ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', d => { errorOutput += d.toString(); });
      ffmpeg.on('close', code => {
        try { fs.unlinkSync(scriptPath); } catch (e) {}
        if (code === 0) return resolve();
        // Log the full ffmpeg output server-side for debugging, but send a
        // clean user-facing message so we never leak filter graphs into
        // status text / alerts on the frontend.
        console.error(`[AI Reframe Grid] ffmpeg exit ${code}\n${errorOutput.slice(-2000)}`);
        reject(new Error('Grid render failed. Please try a different style or a shorter clip.'));
      });
      ffmpeg.on('error', (err) => {
        try { fs.unlinkSync(scriptPath); } catch (e) {}
        reject(err);
      });
      // 8-minute safety timeout
      setTimeout(() => {
        try { ffmpeg.kill('SIGKILL'); } catch (e) {}
        reject(new Error('Grid render timed out'));
      }, 8 * 60 * 1000);
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- GRID ENDPOINTS ----------

// GET /ai-reframe/subject-thumb/:jobId/:subjectId.jpg
// Extracts a head-and-shoulders thumbnail JPEG at the subject's strongest
// detection moment. Cached for the life of the job so repeated requests
// are instant.
router.get('/subject-thumb/:jobId/:subjectId.jpg', requireAuth, async (req, res) => {
  try {
    const job = gridJobs.get(req.params.jobId);
    if (!job) return res.status(404).send('job not found');
    const subjId = parseInt(req.params.subjectId, 10);
    const subject = (job.detection.subjects || []).find(s => s.id === subjId);
    if (!subject) return res.status(404).send('subject not found');

    if (!job.thumbCache) job.thumbCache = new Map();
    if (job.thumbCache.has(subjId)) {
      res.set('Content-Type', 'image/jpeg');
      return res.send(job.thumbCache.get(subjId));
    }

    const dims = await getVideoDimensions(job.videoPath);
    // Find sample closest to thumbnail_time for accurate crop position
    const samples = subject.samples || [];
    let bestSample = samples[0];
    let bestDelta = Infinity;
    for (const s of samples) {
      const d = Math.abs(s.time - subject.thumbnail_time);
      if (d < bestDelta) { bestDelta = d; bestSample = s; }
    }
    if (!bestSample) return res.status(404).send('no samples');

    // Tight head-and-shoulders thumb: ~2.5 * face_h
    const side = Math.round(Math.max(bestSample.h * dims.height, bestSample.w * dims.width) * 2.5);
    const cx = bestSample.cx * dims.width;
    const cy = bestSample.cy * dims.height;
    let x = Math.round(cx - side / 2);
    let y = Math.round(cy - side * 0.35); // face in upper portion
    x = Math.max(0, Math.min(dims.width - side, x));
    y = Math.max(0, Math.min(dims.height - side, y));
    const evenSide = side - (side % 2);

    const ff = spawn(ffmpegPath || 'ffmpeg', [
      '-ss', String(subject.thumbnail_time),
      '-i', job.videoPath,
      '-vf', `crop=${evenSide}:${evenSide}:${x}:${y},scale=180:180`,
      '-frames:v', '1', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-',
    ]);
    const chunks = [];
    ff.stdout.on('data', d => chunks.push(d));
    let err = '';
    ff.stderr.on('data', d => { err += d.toString(); });
    ff.on('close', code => {
      if (code !== 0 || !chunks.length) {
        console.error('thumb extract failed:', err.slice(-300));
        return res.status(500).send('thumb failed');
      }
      const buf = Buffer.concat(chunks);
      job.thumbCache.set(subjId, buf);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=1200');
      res.send(buf);
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// POST /ai-reframe/detect-subjects
// Accepts multipart (videoFile) OR form data with youtubeUrl+inputMode.
// Runs detection, caches the video path + detection under a new jobId,
// and responds with the trimmed subjects array for the UI to render.
router.post('/detect-subjects', requireAuth, upload.single('videoFile'), async (req, res) => {
  let downloadedPath = null;
  try {
    const youtubeUrl = req.body.youtubeUrl || '';
    const inputMode  = req.body.inputMode  || 'upload';
    let inputPath = null;

    if (inputMode === 'url' && youtubeUrl) {
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
      }
      try {
        inputPath = await downloadYouTubeVideo(youtubeUrl);
        downloadedPath = inputPath;
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    } else if (req.file) {
      inputPath = req.file.path;
    }

    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(400).json({ success: false, message: 'No video input provided' });
    }

    console.log('[AI Reframe Grid] Running detection on', inputPath);
    const detection = await detectFaces(inputPath);
    const jobId = uuidv4();
    gridJobs.set(jobId, { videoPath: inputPath, detection, createdAt: Date.now() });

    const trimmed = {
      width: detection.width,
      height: detection.height,
      fps: detection.fps,
      duration: detection.duration,
      detector: detection.detector,
      subjects: detection.subjects || [],
    };
    res.json({ success: true, jobId, detection: trimmed });
  } catch (e) {
    if (downloadedPath) { try { fs.unlinkSync(downloadedPath); } catch (_) {} }
    console.error('detect-subjects error:', e);
    res.status(500).json({ success: false, message: e.message || 'Detection failed' });
  }
});

// Named style presets for the simplified UI. Users pick a style name;
// the server translates to the underlying padding/border/background knobs.
const GRID_STYLE_PRESETS = {
  clean: {
    label: 'Clean',
    padding: 16,
    border: { enabled: true, color: '#ffffff', width: 3 },
    background: { mode: 'blur' },
  },
  bold: {
    label: 'Bold',
    padding: 16,
    border: { enabled: true, color: '#6c3aed', width: 4 },
    background: { mode: 'blur' },
  },
  minimal: {
    label: 'Minimal',
    padding: 12,
    border: { enabled: false },
    background: { mode: 'solid', color: '#181426' },
  },
};

// POST /ai-reframe/render-grid
// Body: { jobId, selectedSubjectIds, style? | padding?, border?, background? }
router.post('/render-grid', requireAuth, async (req, res) => {
  try {
    const { jobId, selectedSubjectIds, style, padding, border, background } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });
    const job = gridJobs.get(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or expired' });
    if (!Array.isArray(selectedSubjectIds) || selectedSubjectIds.length < 1 || selectedSubjectIds.length > 4) {
      return res.status(400).json({ success: false, message: 'Select 1-4 people' });
    }

    const allSubjects = job.detection.subjects || [];
    const selected = selectedSubjectIds
      .map(id => allSubjects.find(s => s.id === id))
      .filter(Boolean);
    if (selected.length !== selectedSubjectIds.length) {
      return res.status(400).json({ success: false, message: 'One or more selections not found' });
    }

    // Prefer the style preset for simplified clients; fall back to explicit
    // padding/border/background for back-compat with the internal QA page.
    let config;
    if (typeof style === 'string' && GRID_STYLE_PRESETS[style]) {
      config = GRID_STYLE_PRESETS[style];
    } else {
      config = {
        padding: (typeof padding === 'number') ? padding : 16,
        border: border && typeof border === 'object' ? border : { enabled: false },
        background: background && typeof background === 'object' ? background : { mode: 'solid' },
      };
    }

    const filename = `${jobId}-grid-${selected.length}up-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, filename);
    console.log(`[AI Reframe Grid] Rendering ${selected.length}-up grid -> ${filename}`);
    await processVideoMultiGrid(job.videoPath, outputPath, job.detection, selected, config);

    res.json({
      success: true,
      filename,
      dimensions: `${GRID_OUT_W}x${GRID_OUT_H}`,
      subjects: selected.length,
    });
    featureUsageOps.log(req.user.id, 'ai_reframe_grid').catch(() => {});
  } catch (e) {
    console.error('render-grid error:', e);
    res.status(500).json({ success: false, message: e.message || 'Grid render failed' });
  }
});

// GET /ai-reframe/grid-test  — minimal internal QA page for Deploy 2.
// Not linked from the main UI. Lets us verify detect + render end-to-end
// without the full Multi-Subject mode UI (which lands in Deploy 3).
router.get('/grid-test', requireAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AI Reframe Grid Test</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background:#0f0b1a; color:#e8e6f0; padding:2rem; max-width:900px; margin:0 auto; }
  h1 { color:#c4a9ff; }
  button, input, select, textarea { font:inherit; }
  input[type=text], input[type=number] { background:#1c1630; border:1px solid #3b2d5f; color:#e8e6f0; padding:.5rem; border-radius:6px; width:100%; box-sizing:border-box; }
  button { background:#6c3aed; color:#fff; border:none; padding:.6rem 1rem; border-radius:6px; cursor:pointer; margin-top:.5rem; font-weight:600; transition: background .15s; }
  button:hover:not(:disabled) { background:#7d4af5; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .row { margin-bottom:1rem; }
  .subjects { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:.75rem; margin-top:.5rem; }
  .subject { background:#1c1630; border:2px solid #3b2d5f; border-radius:8px; padding:.75rem; cursor:pointer; text-align:center; }
  .subject.sel { border-color:#6c3aed; background:#2a1f4e; }
  label { display:block; font-weight:600; margin-bottom:.25rem; color:#b2a6d4; }

  /* Themed file picker (replaces the browser-default "Choose File" look) */
  .file-picker { display:flex; align-items:center; gap:.75rem; }
  .file-picker input[type=file] { position:absolute; left:-9999px; opacity:0; pointer-events:none; }
  .file-picker .file-btn {
    display:inline-flex; align-items:center; gap:.5rem;
    background:#1c1630; color:#e8e6f0;
    border:1px solid #3b2d5f; border-radius:6px;
    padding:.55rem 1rem; font-weight:600; cursor:pointer;
    transition: border-color .15s, background .15s;
  }
  .file-picker .file-btn:hover { border-color:#6c3aed; background:#231940; }
  .file-picker .file-name { color:#b2a6d4; font-size:.9rem; flex:1; word-break:break-all; }

  /* Themed select (replaces the browser-default dropdown chrome) */
  select {
    -webkit-appearance:none; -moz-appearance:none; appearance:none;
    background:#1c1630; color:#e8e6f0;
    border:1px solid #3b2d5f; border-radius:6px;
    padding:.55rem 2.25rem .55rem .75rem;
    width:100%; box-sizing:border-box; font-weight:500; cursor:pointer;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'><path d='M1 1.5L6 6.5L11 1.5' stroke='%23c4a9ff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    background-repeat:no-repeat; background-position:right .85rem center;
    transition: border-color .15s;
  }
  select:hover, select:focus { border-color:#6c3aed; outline:none; }
  select option { background:#1c1630; color:#e8e6f0; }
</style></head><body>
<h1>AI Reframe — Grid Renderer Test (Deploy 2 QA)</h1>
<p>Internal test page. Upload a clip with multiple faces, run detection, pick subjects, render the grid.</p>

<div class="row">
  <label>Input</label>
  <div class="file-picker">
    <label class="file-btn" for="file">📁 Choose file</label>
    <input type="file" id="file" accept="video/*">
    <span class="file-name" id="fileLabel">No file chosen</span>
  </div>
  <div style="margin-top:.5rem">or YouTube URL:</div>
  <input type="text" id="url" placeholder="https://youtube.com/...">
  <button id="detectBtn">Run Detection</button>
</div>

<div id="status"></div>
<div id="subjectsWrap" style="display:none" class="row">
  <label>Detected subjects (click to toggle, up to 4)</label>
  <div class="subjects" id="subjects"></div>
</div>

<div id="renderWrap" style="display:none">
  <div class="row"><label>Style</label>
    <select id="stylePreset">
      <option value="clean">Clean — white border, blurred background</option>
      <option value="bold">Bold — purple border, blurred background</option>
      <option value="minimal">Minimal — no border, solid background</option>
    </select>
  </div>
  <button id="renderBtn">Render Grid</button>
  <div id="renderStatus"></div>
</div>

<script>
let jobId = null; let subjects = []; let selected = new Set();
const $ = (id) => document.getElementById(id);

// Simple HTML escaper + error sanitizer. Backend errors sometimes contain
// multi-kilobyte ffmpeg filter graphs — we must never dump those into the
// DOM verbatim. Trim to a short, user-friendly message.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function friendlyError(msg) {
  let s = String(msg || 'Something went wrong');
  // Drop ffmpeg filter-graph spew: strip anything after the first "(code ...)"
  s = s.replace(/\\(code \\d+\\):.*$/s, '(render failed)');
  // Drop expressions/filter chains that sneak through
  s = s.replace(/if\\(between[^]*$/, '...');
  if (s.length > 180) s = s.slice(0, 180) + '…';
  return s;
}
function setStatus(msg, color) { $('status').innerHTML = '<div style="margin:.5rem 0;color:'+(color||'#c4a9ff')+'">'+escapeHtml(msg)+'</div>'; }
function rsStatus(html, color) { $('renderStatus').innerHTML = '<div style="margin:.5rem 0;color:'+(color||'#c4a9ff')+'">'+html+'</div>'; }

// Keep the filename label in sync with the chosen file
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  $('fileLabel').textContent = f ? f.name : 'No file chosen';
});

$('detectBtn').addEventListener('click', async () => {
  $('detectBtn').disabled = true;
  setStatus('Detecting subjects…');
  const f = $('file').files[0]; const url = $('url').value.trim();
  const fd = new FormData();
  if (f) { fd.set('inputMode','upload'); fd.set('videoFile', f); }
  else if (url) { fd.set('inputMode','url'); fd.set('youtubeUrl', url); }
  else { setStatus('Provide a file or URL', '#ff7a7a'); $('detectBtn').disabled = false; return; }
  try {
    const r = await fetch('/ai-reframe/detect-subjects', { method:'POST', body: fd });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.message || 'Detection failed');
    jobId = data.jobId; subjects = data.detection.subjects || [];
    renderSubjects();
    setStatus('Detected '+subjects.length+' subject(s). Pick up to 4 and choose a style.', '#7bd88f');
    $('subjectsWrap').style.display='block'; $('renderWrap').style.display='block';
  } catch (e) { setStatus(friendlyError(e.message), '#ff7a7a'); }
  finally { $('detectBtn').disabled = false; }
});

function renderSubjects() {
  const wrap = $('subjects'); wrap.innerHTML = '';
  subjects.forEach((s, idx) => {
    const d = document.createElement('div');
    d.className = 'subject' + (selected.has(s.id) ? ' sel' : '');
    d.innerHTML = '<img src="/ai-reframe/subject-thumb/'+jobId+'/'+s.id+'.jpg" ' +
                  'style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;margin-bottom:.5rem;background:#1c1630" ' +
                  'onerror="this.style.display=\\'none\\'">' +
                  '<strong>Person '+(idx+1)+'</strong>';
    d.addEventListener('click', () => {
      if (selected.has(s.id)) selected.delete(s.id);
      else if (selected.size < 4) selected.add(s.id);
      renderSubjects();
    });
    wrap.appendChild(d);
  });
}

$('renderBtn').addEventListener('click', async () => {
  if (!jobId || selected.size < 1) { rsStatus('Select at least 1 subject', '#ff7a7a'); return; }
  $('renderBtn').disabled = true;
  rsStatus('Rendering… (may take 30s–2min)');
  const body = {
    jobId,
    selectedSubjectIds: [...selected],
    style: $('stylePreset').value,
  };
  try {
    const r = await fetch('/ai-reframe/render-grid', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.message || 'Render failed');
    const safeName = encodeURIComponent(data.filename);
    rsStatus('Rendered: <a href="/ai-reframe/download/' + safeName + '" style="color:#c4a9ff">Download</a> · ' + escapeHtml(data.dimensions), '#7bd88f');
  } catch (e) { rsStatus(escapeHtml(friendlyError(e.message)), '#ff7a7a'); }
  finally { $('renderBtn').disabled = false; }
});
</script></body></html>`;
  res.send(html);
});

// GET - Main page
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('AI Reframe');
  const sidebar = getSidebar('ai-reframe', req.user, req.teamPermissions);
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
      .url-input {
        width: 100%;
        padding: 0.75rem;
        background: var(--dark-2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        font-size: 0.9rem;
        transition: border-color 0.3s;
      }
      .url-input:focus {
        outline: none;
        border-color: var(--primary);
      }
      .upload-area {
        border: 2px dashed rgba(108, 58, 237, 0.3);
        border-radius: 8px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
      }
      .upload-area:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.05);
      }
      .upload-area.dragover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
      }
      .upload-icon {
        font-size: 2.5rem;
        margin-bottom: 0.5rem;
      }
      .upload-text {
        color: var(--text);
        margin-bottom: 0.25rem;
        font-weight: 600;
      }
      .upload-subtext {
        color: var(--text-muted);
        font-size: 0.85rem;
      }
      .file-input {
        display: none;
      }
      .file-name {
        margin-top: 1rem;
        padding: 1rem;
        background: var(--dark-2);
        border-radius: 8px;
        color: var(--text);
        font-size: 0.9rem;
        word-break: break-all;
      }
      .aspect-ratio-section {
        margin-top: 2rem;
      }
      .aspect-ratio-label {
        display: block;
        margin-bottom: 1rem;
        font-weight: 600;
        color: var(--text);
        font-size: 0.95rem;
      }
      .aspect-ratio-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
      }
      .aspect-ratio-card {
        position: relative;
        cursor: pointer;
        transition: all 0.3s;
      }
      .aspect-ratio-preview {
        background: var(--dark-2);
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s;
      }
      .aspect-ratio-card input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
        pointer-events: none;
      }
      .aspect-ratio-card input[type="checkbox"]:checked ~ .aspect-ratio-preview {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
        box-shadow: 0 0 15px rgba(108, 58, 237, 0.3);
      }
      .aspect-ratio-card input[type="checkbox"]:checked ~ .aspect-ratio-info::after {
        content: '✓';
        position: absolute;
        top: 8px;
        right: 8px;
        background: var(--primary);
        color: #fff;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.75rem;
      }
      .aspect-box {
        width: 100%;
        padding-bottom: 100%;
        position: relative;
      }
      .aspect-9-16 {
        padding-bottom: 177.78%;
      }
      .aspect-1-1 {
        padding-bottom: 100%;
      }
      .aspect-4-5 {
        padding-bottom: 125%;
      }
      .aspect-16-9 {
        padding-bottom: 56.25%;
      }
      .aspect-ratio-info {
        position: relative;
        margin-top: 0.5rem;
        text-align: center;
      }
      .aspect-ratio-title {
        color: var(--text);
        font-size: 0.85rem;
        font-weight: 600;
      }
      .aspect-ratio-platforms {
        color: var(--text-muted);
        font-size: 0.75rem;
        margin-top: 0.25rem;
      }
      .action-button {
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
        margin-top: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      .action-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .action-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      .action-button.loading {
        pointer-events: none;
      }
      .spinner {
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
      .preview-section {
        margin-top: 2rem;
        display: none;
      }
      .preview-section.show {
        display: block;
      }
      .preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 2rem;
      }
      .preview-container {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
      }
      .preview-label {
        color: var(--text-muted);
        font-size: 0.9rem;
        margin-bottom: 1rem;
        font-weight: 600;
      }
      .download-link {
        display: inline-block;
        margin-top: 1rem;
        padding: 0.75rem 1.5rem;
        background: var(--primary);
        color: #fff;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
        font-size: 0.9rem;
        transition: all 0.3s;
      }
      .download-link:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(108, 58, 237, 0.4);
      }
      .empty-state {
        text-align: center;
        padding: 2rem;
        color: var(--text-muted);
      }
      .error-message {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #ef4444;
        padding: 1rem;
        border-radius: 8px;
        margin-top: 1rem;
        font-size: 0.9rem;
      }
      @media (max-width: 1024px) {
        .aspect-ratio-grid {
          grid-template-columns: repeat(2, 1fr);
        }
        .preview-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 768px) {
        .input-section {
          padding: 1.5rem;
        }
        .input-tabs {
          flex-wrap: wrap;
        }
        .aspect-ratio-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  `;

  const html = `${headHTML}
<style>${css}</style>
${pageStyles}
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    ${themeToggle}
    <main class="main-content">
      <div class="page-header">
        <h1>AI Reframe</h1>
        <p>Resize any video for every platform in 1 click</p>
      </div>

      <div class="input-section">
        <form id="reframeForm" enctype="multipart/form-data">
          <div class="input-tabs">
            <button type="button" class="input-tab active" data-tab="url">YouTube URL</button>
            <button type="button" class="input-tab" data-tab="upload">Upload File</button>
          </div>

          <div id="urlTab" class="tab-content active">
            <input type="text" class="url-input" id="youtubeUrl" name="youtubeUrl" placeholder="Paste YouTube video URL here...">
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

          <div class="aspect-ratio-section" style="margin-top:1.5rem">
            <label class="aspect-ratio-label">Crop Mode</label>
            <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1.25rem;background:var(--dark-2);border:2px solid var(--primary);border-radius:8px;cursor:pointer;color:var(--text);font-weight:600;font-size:0.9rem;transition:all 0.3s" id="modeCenterLabel">
                <input type="radio" name="cropMode" value="center" checked style="accent-color:var(--primary)"> 🎯 Center Crop
              </label>
              <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1.25rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;color:var(--text);font-weight:600;font-size:0.9rem;transition:all 0.3s" id="modeFaceLabel">
                <input type="radio" name="cropMode" value="face-tracking" style="accent-color:var(--primary)"> 🧠 AI Face Tracking
              </label>
              <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1.25rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;color:var(--text);font-weight:600;font-size:0.9rem;transition:all 0.3s" id="modeGridLabel">
                <input type="radio" name="cropMode" value="grid" style="accent-color:var(--primary)"> 🎬 Multi-Person Grid
              </label>
            </div>
            <div id="faceTrackingInfo" style="display:none;background:rgba(108,58,237,0.1);border:1px solid rgba(108,58,237,0.3);border-radius:8px;padding:1rem;margin-bottom:1.5rem;font-size:0.85rem;color:var(--text)">
              <strong>🧠 AI Face Tracking</strong> — The AI will detect faces in your video and dynamically adjust the crop window to keep people centered in every frame. Perfect for interviews, podcasts, and talking-head videos where subjects aren't always in the center.
            </div>
            <div id="gridModeInfo" style="display:none;background:rgba(108,58,237,0.1);border:1px solid rgba(108,58,237,0.3);border-radius:8px;padding:1rem;margin-bottom:1.5rem;font-size:0.85rem;color:var(--text)">
              <strong>🎬 Multi-Person Grid</strong> — Detect everyone in your clip, pick up to 4, and get a vertical video with each person in their own tile. Great for podcast highlights and panel reactions.
            </div>
          </div>

          <!-- Multi-Person Grid flow (replaces the aspect-ratio grid when that mode is picked) -->
          <div id="gridFlow" style="display:none">
            <div class="aspect-ratio-section">
              <label class="aspect-ratio-label">Step 1 — Find people in your video</label>
              <button type="button" id="detectBtn" class="action-button" style="margin-top:0">Detect People</button>
              <div id="detectStatus" style="margin-top:.75rem;font-size:.9rem;color:var(--text-muted);min-height:1.2em"></div>
            </div>

            <div id="subjectPickSection" class="aspect-ratio-section" style="display:none">
              <label class="aspect-ratio-label">Step 2 — Pick who to include (up to 4)</label>
              <div id="subjectGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem"></div>
            </div>

            <div id="styleSection" class="aspect-ratio-section" style="display:none">
              <label class="aspect-ratio-label">Step 3 — Style</label>
              <div style="display:flex;gap:.75rem;flex-wrap:wrap">
                <label class="grid-style" data-style="clean"   style="flex:1;min-width:140px;cursor:pointer;padding:1rem;background:var(--dark-2);border:2px solid var(--primary);border-radius:8px;color:var(--text);text-align:center">
                  <input type="radio" name="gridStyle" value="clean" checked style="display:none">
                  <div style="font-weight:700;margin-bottom:.25rem">Clean</div>
                  <div style="font-size:.8rem;color:var(--text-muted)">White border · blurred bg</div>
                </label>
                <label class="grid-style" data-style="bold"    style="flex:1;min-width:140px;cursor:pointer;padding:1rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);text-align:center">
                  <input type="radio" name="gridStyle" value="bold" style="display:none">
                  <div style="font-weight:700;margin-bottom:.25rem">Bold</div>
                  <div style="font-size:.8rem;color:var(--text-muted)">Purple border · blurred bg</div>
                </label>
                <label class="grid-style" data-style="minimal" style="flex:1;min-width:140px;cursor:pointer;padding:1rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);text-align:center">
                  <input type="radio" name="gridStyle" value="minimal" style="display:none">
                  <div style="font-weight:700;margin-bottom:.25rem">Minimal</div>
                  <div style="font-size:.8rem;color:var(--text-muted)">No border · solid bg</div>
                </label>
              </div>
            </div>
          </div>

          <div class="aspect-ratio-section" id="aspectRatioSection">
            <label class="aspect-ratio-label">Select Aspect Ratios to Generate</label>
            <div class="aspect-ratio-grid">
              <div class="aspect-ratio-card">
                <input type="checkbox" id="ratio-9-16" name="aspect" value="9:16">
                <div class="aspect-ratio-preview">
                  <div style="width: 60px; height: 106px; background: var(--primary); border-radius: 4px;"></div>
                </div>
                <div class="aspect-ratio-info">
                  <div class="aspect-ratio-title">9:16 Vertical</div>
                  <div class="aspect-ratio-platforms">TikTok, Reels, Shorts</div>
                </div>
              </div>

              <div class="aspect-ratio-card">
                <input type="checkbox" id="ratio-1-1" name="aspect" value="1:1">
                <div class="aspect-ratio-preview">
                  <div style="width: 80px; height: 80px; background: var(--primary); border-radius: 4px;"></div>
                </div>
                <div class="aspect-ratio-info">
                  <div class="aspect-ratio-title">1:1 Square</div>
                  <div class="aspect-ratio-platforms">Instagram Feed, Facebook</div>
                </div>
              </div>

              <div class="aspect-ratio-card">
                <input type="checkbox" id="ratio-4-5" name="aspect" value="4:5">
                <div class="aspect-ratio-preview">
                  <div style="width: 64px; height: 80px; background: var(--primary); border-radius: 4px;"></div>
                </div>
                <div class="aspect-ratio-info">
                  <div class="aspect-ratio-title">4:5 Portrait</div>
                  <div class="aspect-ratio-platforms">Instagram, Facebook</div>
                </div>
              </div>

              <div class="aspect-ratio-card">
                <input type="checkbox" id="ratio-16-9" name="aspect" value="16:9">
                <div class="aspect-ratio-preview">
                  <div style="width: 106px; height: 60px; background: var(--primary); border-radius: 4px;"></div>
                </div>
                <div class="aspect-ratio-info">
                  <div class="aspect-ratio-title">16:9 Landscape</div>
                  <div class="aspect-ratio-platforms">YouTube, LinkedIn</div>
                </div>
              </div>
            </div>
          </div>

          <button type="submit" class="action-button" id="reframeBtn" disabled>
            Reframe Video
          </button>
          <div id="errorMessage" style="display: none;"></div>
        </form>
      </div>

      <div class="preview-section" id="previewSection">
        <h2 style="margin-bottom: 1.5rem; color: var(--text);">Your Reframed Videos</h2>
        <div class="preview-grid" id="previewGrid">
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
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
      });
    });

    // File upload
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const fileName = document.getElementById('fileName');
    const reframeBtn = document.getElementById('reframeBtn');
    const youtubeUrl = document.getElementById('youtubeUrl');
    const form = document.getElementById('reframeForm');

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

    // Aspect ratio selection - clicking the card toggles the hidden checkbox
    document.querySelectorAll('.aspect-ratio-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't double-toggle if they somehow clicked the checkbox itself
        if (e.target.type === 'checkbox') return;
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      });
    });

    // Track which input tab is active
    var activeInputTab = 'url';
    document.querySelectorAll('.input-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        activeInputTab = e.target.dataset.tab;
        checkInputs(); // Re-evaluate button state when tab changes
      });
    });

    document.querySelectorAll('input[name="aspect"]').forEach(checkbox => {
      checkbox.addEventListener('change', checkInputs);
    });

    function checkInputs() {
      const hasUrl = activeInputTab === 'url' && youtubeUrl.value.trim().length > 0;
      const hasFile = activeInputTab === 'upload' && fileInput.files.length > 0;
      const hasAspectRatio = document.querySelectorAll('input[name="aspect"]:checked').length > 0;

      reframeBtn.disabled = !(hasUrl || hasFile) || !hasAspectRatio;
    }

    // Crop mode toggle styling + show/hide mode-specific sections
    document.querySelectorAll('input[name="cropMode"]').forEach(radio => {
      radio.addEventListener('change', function() {
        document.getElementById('modeCenterLabel').style.borderColor = this.value === 'center' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('modeFaceLabel').style.borderColor = this.value === 'face-tracking' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('modeGridLabel').style.borderColor = this.value === 'grid' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('faceTrackingInfo').style.display = this.value === 'face-tracking' ? 'block' : 'none';
        document.getElementById('gridModeInfo').style.display = this.value === 'grid' ? 'block' : 'none';

        const inGrid = this.value === 'grid';
        document.getElementById('aspectRatioSection').style.display = inGrid ? 'none' : 'block';
        document.getElementById('gridFlow').style.display = inGrid ? 'block' : 'none';
        // Main submit button disabled in grid mode — the grid flow has its own
        // "Create Grid Video" action that fires after subjects are picked.
        reframeBtn.style.display = inGrid ? 'none' : 'flex';
        if (inGrid) resetGridFlow();
        checkInputs();
      });
    });

    // ---- Multi-Person Grid flow (simplified 3-step UX) ----
    let gridJobId = null;
    let gridSubjects = [];
    const gridSelected = new Set();
    let gridRenderBtn = null; // lazily created when the user picks subjects

    // Protect the UI from raw ffmpeg error spew. Server errors sometimes
    // contain multi-KB filter graphs ("if(between(t,...))..." chains); we
    // must never render those verbatim — escape HTML and trim aggressively.
    function escapeHtmlGrid(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function friendlyGridError(msg) {
      let s = String(msg || 'Something went wrong');
      s = s.replace(/\\(code \\d+\\):.*$/s, '(render failed)');
      s = s.replace(/if\\(between[^]*$/, '...');
      if (s.length > 180) s = s.slice(0, 180) + '…';
      return s;
    }

    function setDetectStatus(msg, color) {
      const col = color || 'var(--text-muted)';
      document.getElementById('detectStatus').innerHTML =
        msg ? '<span style="color:'+col+'">' + escapeHtmlGrid(msg) + '</span>' : '';
    }

    function resetGridFlow() {
      gridJobId = null; gridSubjects = []; gridSelected.clear();
      document.getElementById('subjectPickSection').style.display = 'none';
      document.getElementById('styleSection').style.display = 'none';
      document.getElementById('subjectGrid').innerHTML = '';
      const old = document.getElementById('gridRenderBtnContainer');
      if (old) old.remove();
      setDetectStatus('');
    }

    function getCurrentInput() {
      // Returns { kind: 'url'|'file', value, valid }
      if (activeInputTab === 'url') {
        const v = youtubeUrl.value.trim();
        return { kind: 'url', value: v, valid: v.length > 0 };
      }
      return { kind: 'file', value: fileInput.files[0], valid: fileInput.files.length > 0 };
    }

    // Style preset cards
    document.querySelectorAll('.grid-style').forEach(label => {
      label.addEventListener('click', () => {
        document.querySelectorAll('.grid-style').forEach(l => l.style.borderColor = 'rgba(255,255,255,0.1)');
        label.style.borderColor = 'var(--primary)';
        label.querySelector('input').checked = true;
      });
    });

    function ensureRenderBtn() {
      if (document.getElementById('gridRenderBtnContainer')) return;
      const wrap = document.createElement('div');
      wrap.id = 'gridRenderBtnContainer';
      wrap.innerHTML = '<button type="button" id="gridRenderBtn" class="action-button" style="margin-top:1.5rem">Create Grid Video</button>' +
                       '<div id="gridRenderStatus" style="margin-top:.75rem;font-size:.9rem;color:var(--text-muted);min-height:1.2em"></div>';
      document.getElementById('gridFlow').appendChild(wrap);
      gridRenderBtn = document.getElementById('gridRenderBtn');
      gridRenderBtn.addEventListener('click', renderGridNow);
    }

    function updateRenderBtnState() {
      if (!gridRenderBtn) return;
      gridRenderBtn.disabled = gridSelected.size < 1;
      gridRenderBtn.textContent = gridSelected.size
        ? 'Create Grid Video (' + gridSelected.size + ' ' + (gridSelected.size === 1 ? 'person' : 'people') + ')'
        : 'Pick at least 1 person';
    }

    function renderSubjectCards() {
      const wrap = document.getElementById('subjectGrid');
      wrap.innerHTML = '';
      gridSubjects.forEach((s, idx) => {
        const card = document.createElement('div');
        const isSel = gridSelected.has(s.id);
        card.style.cssText = 'position:relative;padding:.75rem;background:var(--dark-2);border:2px solid ' +
          (isSel ? 'var(--primary)' : 'rgba(255,255,255,0.1)') +
          ';border-radius:10px;cursor:pointer;text-align:center;transition:all .2s;' +
          (isSel ? 'box-shadow:0 0 20px rgba(108,58,237,0.25)' : '');
        card.innerHTML =
          '<div style="width:120px;height:120px;margin:0 auto .5rem;border-radius:50%;overflow:hidden;background:#1c1630;position:relative;border:2px solid rgba(255,255,255,0.05)">' +
            '<img src="/ai-reframe/subject-thumb/' + gridJobId + '/' + s.id + '.jpg" ' +
                 'alt="Person ' + (idx+1) + '" style="width:100%;height:100%;object-fit:cover" ' +
                 'onerror="this.style.display=\\'none\\';this.nextElementSibling.style.display=\\'flex\\'">' +
            '<div style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:2.5rem;font-weight:700;color:var(--primary);background:#1c1630">' + (idx+1) + '</div>' +
          '</div>' +
          '<div style="font-weight:700;color:var(--text)">Person ' + (idx+1) + '</div>' +
          (isSel ? '<div style="position:absolute;top:8px;right:8px;background:var(--primary);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem">✓</div>' : '');
        card.addEventListener('click', () => {
          if (gridSelected.has(s.id)) gridSelected.delete(s.id);
          else if (gridSelected.size < 4) gridSelected.add(s.id);
          renderSubjectCards();
          updateRenderBtnState();
        });
        wrap.appendChild(card);
      });
    }

    document.getElementById('detectBtn').addEventListener('click', async () => {
      clearError();
      const input = getCurrentInput();
      if (!input.valid) { setDetectStatus(input.kind === 'url' ? 'Paste a YouTube URL first.' : 'Upload a video first.', '#ff7a7a'); return; }
      const btn = document.getElementById('detectBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Detecting people…';
      setDetectStatus('Analyzing video — this may take a minute.');
      try {
        const fd = new FormData();
        if (input.kind === 'url') { fd.set('inputMode', 'url'); fd.set('youtubeUrl', input.value); }
        else                      { fd.set('inputMode', 'upload'); fd.set('videoFile', input.value); }
        const r = await fetch('/ai-reframe/detect-subjects', { method: 'POST', body: fd });
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.message || 'Detection failed');
        gridJobId = data.jobId;
        gridSubjects = (data.detection.subjects || []).slice(0, 4);
        gridSelected.clear();
        // Auto-select up to the top 2 subjects as a sensible default.
        gridSubjects.slice(0, Math.min(2, gridSubjects.length)).forEach(s => gridSelected.add(s.id));
        if (!gridSubjects.length) {
          setDetectStatus('No people detected. Try a clip with clearly visible faces.', '#ff7a7a');
          return;
        }
        setDetectStatus('Found ' + gridSubjects.length + ' ' + (gridSubjects.length === 1 ? 'person' : 'people') + '. Pick who to include below.', '#7bd88f');
        document.getElementById('subjectPickSection').style.display = 'block';
        document.getElementById('styleSection').style.display = 'block';
        renderSubjectCards();
        ensureRenderBtn();
        updateRenderBtnState();
      } catch (e) {
        setDetectStatus(friendlyGridError(e.message), '#ff7a7a');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Detect People';
      }
    });

    async function renderGridNow() {
      if (!gridJobId || gridSelected.size < 1) return;
      const btn = gridRenderBtn;
      const status = document.getElementById('gridRenderStatus');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Creating your grid video…';
      status.textContent = 'Rendering — 30s to 2min for most clips.';
      const style = document.querySelector('input[name="gridStyle"]:checked').value;
      try {
        const r = await fetch('/ai-reframe/render-grid', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: gridJobId,
            selectedSubjectIds: [...gridSelected],
            style,
          }),
        });
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.message || 'Render failed');
        status.innerHTML = '<span style="color:#7bd88f">Done.</span>';
        displayResults([{
          ratio: 'Multi-Person Grid (' + gridSelected.size + '-up)',
          dimensions: data.dimensions,
          filename: data.filename,
        }]);
        showToast('Grid video ready!', 4000);
      } catch (e) {
        status.innerHTML = '<span style="color:#ff7a7a">' + escapeHtmlGrid(friendlyGridError(e.message)) + '</span>';
      } finally {
        updateRenderBtnState();
      }
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

      const selectedRatios = Array.from(document.querySelectorAll('input[name="aspect"]:checked')).map(c => c.value);
      if (selectedRatios.length === 0) {
        showError('Please select at least one aspect ratio');
        return;
      }

      const cropMode = document.querySelector('input[name="cropMode"]:checked').value;

      const formData = new FormData();
      formData.set('aspects', JSON.stringify(selectedRatios));
      formData.set('inputMode', activeInputTab);
      formData.set('cropMode', cropMode);

      if (useUrl) {
        formData.set('youtubeUrl', youtubeUrl.value.trim());
      } else if (useFile) {
        formData.set('videoFile', fileInput.files[0]);
      }

      reframeBtn.disabled = true;
      reframeBtn.classList.add('loading');
      var modeLabel = cropMode === 'face-tracking' ? 'Detecting faces & ' : '';
      reframeBtn.innerHTML = '<span class="spinner"></span> ' + modeLabel + (useUrl ? 'Downloading & Processing...' : 'Processing...');

      try {
        const response = await fetch('/ai-reframe/process', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Processing failed');
        }

        displayResults(data.files);
        showToast('Video reframing complete!', 4000);
      } catch (error) {
        showError('Error: ' + error.message);
      } finally {
        reframeBtn.disabled = false;
        reframeBtn.classList.remove('loading');
        reframeBtn.innerHTML = 'Reframe Video';
      }
    });

    function displayResults(files) {
      const previewSection = document.getElementById('previewSection');
      const previewGrid = document.getElementById('previewGrid');
      previewGrid.innerHTML = '';

      files.forEach(file => {
        const container = document.createElement('div');
        container.className = 'preview-container';
        container.innerHTML = \`
          <div class="preview-label">\${file.ratio}</div>
          <div style="text-align: center;">
            <div style="color: var(--text); font-size: 0.9rem; margin-bottom: 1rem;">\${file.dimensions}</div>
            <a href="/ai-reframe/download/\${file.filename}" class="download-link" download>
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

// POST - Process video
router.post('/process', requireAuth, upload.single('videoFile'), async (req, res) => {
  let downloadedPath = null; // Track YouTube downloads for cleanup
  try {
    const youtubeUrl = req.body.youtubeUrl || '';
    const inputMode = req.body.inputMode || 'upload';
    const aspects = JSON.parse(req.body.aspects || '[]');
    const cropMode = req.body.cropMode || 'center';
    const videoFile = req.file;

    if (!youtubeUrl && !videoFile) {
      return res.status(400).json({ success: false, message: 'Please provide a YouTube URL or upload a video' });
    }

    if (!aspects || aspects.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one aspect ratio' });
    }

    let inputPath = null;

    if (inputMode === 'url' && youtubeUrl) {
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid YouTube URL (e.g., https://youtube.com/watch?v=...)' });
      }
      try {
        inputPath = await downloadYouTubeVideo(youtubeUrl);
        downloadedPath = inputPath;
      } catch (dlError) {
        return res.status(400).json({ success: false, message: dlError.message });
      }
    } else if (videoFile) {
      inputPath = videoFile.path;
    }

    if (!inputPath) {
      return res.status(400).json({ success: false, message: 'No video input provided' });
    }

    if (!fs.existsSync(inputPath)) {
      return res.status(400).json({ success: false, message: 'Video file not found' });
    }

    // Run face detection if face-tracking mode selected
    let faceData = null;
    if (cropMode === 'face-tracking') {
      try {
        console.log('[AI Reframe] Running face detection...');
        faceData = await detectFaces(inputPath);
        const totalFaces = faceData.samples.filter(s => s.faces.length > 0).length;
        console.log(`[AI Reframe] Face detection complete: ${totalFaces}/${faceData.total_samples} samples have faces`);
      } catch (faceErr) {
        console.log('[AI Reframe] Face detection failed, falling back to center crop:', faceErr.message);
        // Fall back to center crop gracefully
        faceData = null;
      }
    }

    const jobId = uuidv4();
    const results = [];

    for (const aspectRatio of aspects) {
      if (!aspectRatios[aspectRatio]) {
        continue;
      }

      const config = aspectRatios[aspectRatio];
      const filename = `${jobId}-${config.name}.mp4`;
      const outputPath = path.join(outputDir, filename);

      try {
        await processVideo(inputPath, outputPath, aspectRatio, cropMode, faceData);
        results.push({
          ratio: aspectRatio,
          dimensions: `${config.width}x${config.height}`,
          filename: filename,
          mode: faceData ? 'face-tracking' : 'center'
        });
      } catch (error) {
        console.error(`Failed to process ${aspectRatio}:`, error.message);
        // If face tracking fails for this ratio, try center crop fallback
        if (cropMode === 'face-tracking') {
          try {
            console.log(`[AI Reframe] Face tracking failed for ${aspectRatio}, trying center crop...`);
            await processVideo(inputPath, outputPath, aspectRatio, 'center', null);
            results.push({
              ratio: aspectRatio,
              dimensions: `${config.width}x${config.height}`,
              filename: filename,
              mode: 'center (fallback)'
            });
          } catch (fallbackErr) {
            console.error(`Center crop fallback also failed for ${aspectRatio}:`, fallbackErr.message);
          }
        }
      }
    }

    // Clean up uploaded/downloaded file
    try {
      if (inputPath) fs.unlinkSync(inputPath);
    } catch (e) {}

    if (results.length === 0) {
      return res.status(500).json({ success: false, message: 'Video processing failed' });
    }

    res.json({ success: true, files: results });
    featureUsageOps.log(req.user.id, 'ai_reframe').catch(() => {});
  } catch (error) {
    console.error('Processing error:', error);
    // Clean up downloaded file on error
    if (downloadedPath) { try { fs.unlinkSync(downloadedPath); } catch (e) {} }
    res.status(500).json({ success: false, message: error.message || 'Processing failed' });
  }
});

// GET - Download processed file
router.get('/download/:filename', requireAuth, (req, res) => {
  try {
    const filename = req.params.filename;
    // Validate filename to prevent directory traversal
    if (!filename.match(/^[\w\-]+\.mp4$/)) {
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
