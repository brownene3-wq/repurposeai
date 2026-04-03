const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

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
    // Input is wider, crop width
    cropHeight = inputHeight;
    cropWidth = Math.floor(inputHeight * targetAspect);
  } else {
    // Input is taller, crop height
    cropWidth = inputWidth;
    cropHeight = Math.floor(inputWidth / targetAspect);
  }

  const x = Math.floor((inputWidth - cropWidth) / 2);
  const y = Math.floor((inputHeight - cropHeight) / 2);

  return { cropWidth, cropHeight, x, y };
}

// Process video with ffmpeg
function processVideo(inputPath, outputPath, aspectRatio) {
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

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${errorOutput}`));
        }
      });

      ffmpeg.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

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

          <div class="aspect-ratio-section">
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      // Only use the active tab's input
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

      // Build FormData with ONLY the active tab's input
      const formData = new FormData();
      formData.set('aspects', JSON.stringify(selectedRatios));
      formData.set('inputMode', activeInputTab);

      if (useUrl) {
        formData.set('youtubeUrl', youtubeUrl.value.trim());
        // Do NOT include the file even if one was previously selected
      } else if (useFile) {
        formData.set('videoFile', fileInput.files[0]);
        // Do NOT include the URL
      }

      reframeBtn.disabled = true;
      reframeBtn.classList.add('loading');
      reframeBtn.innerHTML = '<span class="spinner"></span> ' + (useUrl ? 'Downloading & Processing...' : 'Processing...');

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
    const videoFile = req.file;

    if (!youtubeUrl && !videoFile) {
      return res.status(400).json({ success: false, message: 'Please provide a YouTube URL or upload a video' });
    }

    if (!aspects || aspects.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one aspect ratio' });
    }

    let inputPath = null;

    // If YouTube URL mode, download the video first
    if (inputMode === 'url' && youtubeUrl) {
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid YouTube URL (e.g., https://youtube.com/watch?v=...)' });
      }
      try {
        inputPath = await downloadYouTubeVideo(youtubeUrl);
        downloadedPath = inputPath; // Mark for cleanup
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
        await processVideo(inputPath, outputPath, aspectRatio);
        results.push({
          ratio: aspectRatio,
          dimensions: `${config.width}x${config.height}`,
          filename: filename
        });
      } catch (error) {
        console.error(`Failed to process ${aspectRatio}:`, error.message);
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
