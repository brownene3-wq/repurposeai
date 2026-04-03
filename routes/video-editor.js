const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

// FFmpeg detection and setup
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

// Upload and output directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer configuration
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

// Helper: Get video metadata using ffmpeg (not ffprobe)
function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg not found'));
    }

    // First try ffprobe if available
    let ffprobePath = null;
    try {
      execSync('which ffprobe', { stdio: 'pipe' });
      ffprobePath = 'ffprobe';
    } catch (e) {
      // Try ffprobe next to ffmpeg
      const ffprobeLocal = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
      if (fs.existsSync(ffprobeLocal)) {
        ffprobePath = ffprobeLocal;
      }
    }

    if (ffprobePath) {
      const proc = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && parseFloat(output) > 0) {
          resolve({ duration: parseFloat(output) });
        } else {
          resolve({ duration: 0 });
        }
      });
      proc.on('error', () => resolve({ duration: 0 }));
    } else {
      // Fallback: use ffmpeg stderr output to parse duration
      const proc = spawn(ffmpegPath, ['-i', filePath, '-f', 'null', '-t', '0', '-']);
      let stderrOutput = '';
      proc.stderr.on('data', (data) => { stderrOutput += data.toString(); });
      proc.on('close', () => {
        const match = stderrOutput.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          const hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const seconds = parseInt(match[3]);
          const centiseconds = parseInt(match[4]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
          resolve({ duration: totalSeconds });
        } else {
          resolve({ duration: 0 });
        }
      });
      proc.on('error', () => resolve({ duration: 0 }));
    }
  });
}

// Helper: Run FFmpeg command
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg not found'));
    }

    const ffmpeg = spawn(ffmpegPath, args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

// GET: Render video editor page
router.get('/', requireAuth, async (req, res) => {
  const html = `${getHeadHTML('Video Editor')}
  <style>
    ${getBaseCSS()}
    .editor-container{display:flex;height:calc(100vh - 80px);gap:1.5rem;padding:1.5rem}
    .editor-main{flex:1;display:flex;flex-direction:column}
    .editor-header{margin-bottom:1rem}
    .editor-header h1{font-size:2rem;font-weight:800;margin-bottom:.25rem}
    .editor-header p{color:var(--text-muted);font-size:.95rem}
    .video-container{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1rem;flex:1;display:flex;flex-direction:column;min-height:0}
    .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border:2px dashed var(--primary);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:all 0.2s}
    .upload-zone.dragover{background:linear-gradient(135deg,rgba(108,58,237,0.2),rgba(236,72,153,0.2));border-color:var(--primary)}
    .upload-zone.has-video{display:none}
    .upload-zone h3{font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:.5rem}
    .upload-zone p{color:var(--text-muted);font-size:.9rem;margin-bottom:1rem}
    .upload-button{padding:.6rem 1.2rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s}
    .upload-button:hover{box-shadow:0 8px 24px rgba(108,58,237,0.3);transform:translateY(-2px)}
    .video-preview-area{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border-radius:12px;flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:300px}
    .video-preview-area.has-video{background:transparent;padding:0}
    .video-player{width:100%;height:100%;border-radius:12px}
    .timeline-strip{margin-top:1rem;background:var(--dark);border-radius:10px;border:1px solid rgba(255,255,255,0.08);padding:12px;height:80px;display:flex;align-items:center;position:relative;overflow-x:auto}
    .timeline-content{display:flex;gap:8px;width:100%;min-width:100%;height:100%}
    .timeline-segment{flex:0 0 80px;height:100%;border-radius:6px;background:linear-gradient(135deg,#6366F1,#3B82F6);position:relative;cursor:pointer;transition:opacity 0.2s}
    .timeline-segment:nth-child(1){background:linear-gradient(135deg,#6C3AED,#EC4899)}
    .timeline-segment:nth-child(2){background:linear-gradient(135deg,#0EA5E9,#6366F1)}
    .timeline-segment:nth-child(3){background:linear-gradient(135deg,#F59E0B,#EF4444)}
    .timeline-segment:nth-child(4){background:linear-gradient(135deg,#10B981,#06B6D4)}
    .timeline-segment:nth-child(5){background:linear-gradient(135deg,#8B5CF6,#A78BFA)}
    .timeline-segment:hover{opacity:0.85;transform:scaleY(1.05)}
    .timeline-segment.selected{outline:2px solid #fff;outline-offset:2px;opacity:1;transform:scaleY(1.08)}
    .timeline-segment .seg-label{position:absolute;bottom:4px;left:50%;transform:translateX(-50%);font-size:.6rem;color:rgba(255,255,255,0.7);font-weight:600;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s}
    .timeline-segment:hover .seg-label,.timeline-segment.selected .seg-label{opacity:1}
    .trim-handle{position:absolute;top:0;bottom:0;width:8px;background:rgba(255,255,255,0.3);cursor:ew-resize;border-radius:2px}
    .trim-handle.left{left:0}
    .trim-handle.right{right:0}
    .tools-section{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
    .tool-button{padding:.6rem 1.2rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;display:flex;align-items:center;gap:.4rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .tool-button:hover{background:var(--surface);border-color:var(--primary);color:var(--primary)}
    .tool-button.active{background:var(--primary);color:white;border-color:var(--primary)}
    .editor-sidebar{width:320px;display:flex;flex-direction:column;gap:1rem;overflow-y:auto;max-height:calc(100vh - 120px)}
    .properties-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem;flex-shrink:0}
    .tool-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem;display:none;flex-shrink:0}
    .tool-panel.active{display:block}
    .panel-title{font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
    .slider-group{margin-bottom:1.5rem}
    .slider-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:flex;justify-content:space-between}
    .slider-value{color:var(--primary);font-weight:600}
    .slider{width:100%;height:6px;border-radius:3px;background:var(--dark);outline:none;-webkit-appearance:none;appearance:none}
    .slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer;transition:box-shadow 0.2s}
    .slider::-webkit-slider-thumb:hover{box-shadow:0 0 0 8px rgba(108,58,237,0.2)}
    .slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer;border:none;transition:box-shadow 0.2s}
    .slider::-moz-range-thumb:hover{box-shadow:0 0 0 8px rgba(108,58,237,0.2)}
    .trim-section{margin-bottom:1.5rem}
    .time-inputs{display:flex;gap:.5rem}
    .time-input{flex:1;padding:.5rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);font-size:.8rem}
    .time-input:focus{outline:none;border-color:var(--primary)}
    .input-field{padding:.6rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);font-size:.8rem;width:100%;margin-bottom:1rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .input-field:focus{outline:none;border-color:var(--primary)}
    .text-input{padding:.6rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);font-size:.8rem;width:100%;margin-bottom:1rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .text-input:focus{outline:none;border-color:var(--primary)}
    .trim-button,.tool-action-button{width:100%;padding:.6rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:.5rem;transition:all 0.2s}
    .trim-button:hover,.tool-action-button:hover{box-shadow:0 8px 16px rgba(108,58,237,0.3)}
    .trim-button:disabled,.tool-action-button:disabled{opacity:0.5;cursor:not-allowed}
    .filter-buttons{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem}
    .filter-btn{padding:.5rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);cursor:pointer;font-size:.75rem;font-weight:600;transition:all 0.2s}
    .filter-btn:hover{border-color:var(--primary);color:var(--primary)}
    .filter-btn.selected{background:var(--primary);color:white;border-color:var(--primary)}
    .dropdown-group{margin-bottom:1.5rem}
    .dropdown-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:block}
    .dropdown{width:100%;padding:.6rem .8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:8px;color:var(--text);font-size:.85rem;outline:none;transition:border-color 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;cursor:pointer}
    .dropdown:hover{border-color:var(--primary)}
    .dropdown:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(108,58,237,0.15)}
    .export-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem;flex-shrink:0;margin-top:auto}
    .export-button{width:100%;padding:.8rem;background:var(--primary);color:white;border:1px solid var(--primary);border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem;transition:all 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .export-button:hover{box-shadow:0 8px 24px rgba(108,58,237,0.3)}
    .export-button:disabled{opacity:0.5;cursor:not-allowed}
    .spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .toast{position:fixed;bottom:20px;right:20px;background:#1a1a2e;border:1px solid var(--border-subtle);border-radius:8px;padding:1rem 1.5rem;font-size:.9rem;z-index:1000;animation:slideIn 0.3s ease-out;display:block!important;color:white;max-width:400px;box-shadow:0 8px 24px rgba(0,0,0,0.4)}
    .toast.success{border-color:#10B981;background:#064e3b;color:#6ee7b7}
    .toast.error{border-color:#EF4444;background:#7f1d1d;color:#fca5a5}
    @keyframes slideIn{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}
    .hidden{display:none}
    body.light .video-container{border-color:rgba(108,58,237,0.2);background:rgba(108,58,237,0.02)}
    body.light .timeline-strip{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .properties-panel,body.light .export-panel,body.light .tool-panel{background:rgba(108,58,237,0.05);border-color:rgba(108,58,237,0.15)}
    body.light .tool-button{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15);color:var(--text)}
    body.light .tool-button:hover{background:rgba(108,58,237,0.15);border-color:var(--primary)}
    body.light .dropdown{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .slider{background:rgba(108,58,237,0.15)}
    body.light .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.05),rgba(236,72,153,0.05));border-color:rgba(108,58,237,0.3)}
    body.light .input-field,body.light .text-input{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .filter-btn{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    @media(max-width:1200px){.editor-sidebar{width:280px}}
    @media(max-width:768px){.editor-container{flex-direction:column;height:auto;gap:1rem}.editor-main{min-height:600px}.editor-sidebar{width:100%;max-height:none}.video-preview-area{min-height:250px}.timeline-strip{height:70px}.tools-section{flex-direction:column}.tool-button{width:100%;justify-content:center}}
  </style>
</head>
<body>
 <div class="dashboard">
    ${getSidebar('video-editor', req.user, req.teamPermissions)}

    <main class="main-content">
      ${getThemeToggle()}

      <div class="editor-container">
        <div class="editor-main">
          <div class="editor-header">
            <h1>Video Editor</h1>
            <p>Trim, cut, and enhance your videos with powerful editing tools</p>
          </div>

          <div class="video-container">
            <div class="upload-zone" id="uploadZone">
              <h3>📹 Upload Your Video</h3>
              <p>Drop your video here or click to browse</p>
              <button type="button" class="upload-button">Select Video</button>
              <input type="file" id="fileInput" style="display:none" accept="video/*">
            </div>

            <div class="video-preview-area" id="videoPreviewArea">
              <video class="video-player" id="videoPlayer" controls></video>
            </div>

            <div class="timeline-strip">
              <div class="timeline-content" id="timelineBar">
                <div class="timeline-segment" data-index="0">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                  <span class="seg-label">Clip 1</span>
                </div>
                <div class="timeline-segment" data-index="1">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                  <span class="seg-label">Clip 2</span>
                </div>
                <div class="timeline-segment" data-index="2">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                  <span class="seg-label">Clip 3</span>
                </div>
                <div class="timeline-segment" data-index="3">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                  <span class="seg-label">Clip 4</span>
                </div>
                <div class="timeline-segment" data-index="4">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                  <span class="seg-label">Clip 5</span>
                </div>
              </div>
            </div>

            <div class="tools-section">
              <button class="tool-button active" data-tool="trim">✂️ Trim</button>
              <button class="tool-button" data-tool="split">🔀 Split</button>
              <button class="tool-button" data-tool="filters">🎨 Filters</button>
              <button class="tool-button" data-tool="speed">⚡ Speed</button>
              <button class="tool-button" data-tool="audio">🔊 Audio</button>
              <button class="tool-button" data-tool="voiceover">🎙️ AI Voice</button>
              <button class="tool-button" data-tool="text">📝 Text Overlay</button>
              <button class="tool-button" data-tool="transitions">✨ Transitions</button>
            </div>
          </div>
        </div>

        <div class="editor-sidebar">
          <div class="properties-panel">
            <div class="panel-title">⚙️ Properties</div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Brightness</span>
                <span class="slider-value">100%</span>
              </div>
              <input type="range" class="slider" id="brightness" min="0" max="200" value="100">
            </div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Contrast</span>
                <span class="slider-value">100%</span>
              </div>
              <input type="range" class="slider" id="contrast" min="0" max="200" value="100">
            </div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Saturation</span>
                <span class="slider-value">100%</span>
              </div>
              <input type="range" class="slider" id="saturation" min="0" max="200" value="100">
            </div>
          </div>

          <div class="tool-panel active" id="trimPanel">
            <div class="panel-title">✂️ Trim Video</div>
            <div class="time-inputs">
              <input type="number" class="time-input" id="startTime" placeholder="Start (sec)" min="0" step="0.1">
              <input type="number" class="time-input" id="endTime" placeholder="End (sec)" min="0" step="0.1">
            </div>
            <button class="trim-button" id="trimButton" disabled>Trim</button>
          </div>

          <div class="tool-panel" id="splitPanel">
            <div class="panel-title">🔀 Split Video</div>
            <input type="number" class="input-field" id="splitTime" placeholder="Split at (seconds)" min="0" step="0.1">
            <button class="tool-action-button" id="splitButton" disabled>Split</button>
          </div>

          <div class="tool-panel" id="filtersPanel">
            <div class="panel-title">🎨 Apply Filter</div>
            <div class="filter-buttons">
              <button class="filter-btn" data-filter="grayscale">Grayscale</button>
              <button class="filter-btn" data-filter="sepia">Sepia</button>
              <button class="filter-btn" data-filter="warm">Warm</button>
              <button class="filter-btn" data-filter="cool">Cool</button>
              <button class="filter-btn" data-filter="vintage">Vintage</button>
              <button class="filter-btn" data-filter="highcontrast">High Contrast</button>
            </div>
            <button class="tool-action-button" id="filterButton" disabled>Apply Filter</button>
          </div>

          <div class="tool-panel" id="speedPanel">
            <div class="panel-title">⚡ Video Speed</div>
            <label class="dropdown-label">Select Speed</label>
            <select class="dropdown" id="speedSelect" disabled>
              <option value="0.25">0.25x (Slowest)</option>
              <option value="0.5">0.5x (Slower)</option>
              <option value="0.75">0.75x</option>
              <option value="1" selected>1x (Normal)</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x (Faster)</option>
              <option value="3">3x (Very Fast)</option>
              <option value="4">4x (Fastest)</option>
            </select>
            <button class="tool-action-button" id="speedButton" disabled>Apply Speed</button>
          </div>

          <div class="tool-panel" id="audioPanel">
            <div class="panel-title">🔊 Audio Controls</div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Volume</span>
                <span class="slider-value" id="volumeValue">100%</span>
              </div>
              <input type="range" class="slider" id="volumeSlider" min="0" max="200" value="100">
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Fade In</span>
                <span class="slider-value" id="fadeInValue">0s</span>
              </div>
              <input type="range" class="slider" id="fadeInSlider" min="0" max="10" value="0" step="0.5">
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Fade Out</span>
                <span class="slider-value" id="fadeOutValue">0s</span>
              </div>
              <input type="range" class="slider" id="fadeOutSlider" min="0" max="10" value="0" step="0.5">
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Bass Boost</span>
                <span class="slider-value" id="bassValue">0dB</span>
              </div>
              <input type="range" class="slider" id="bassSlider" min="-10" max="10" value="0" step="1">
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Treble</span>
                <span class="slider-value" id="trebleValue">0dB</span>
              </div>
              <input type="range" class="slider" id="trebleSlider" min="-10" max="10" value="0" step="1">
            </div>
            <div style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:1rem">
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.82rem;color:var(--text)">
                <input type="checkbox" id="noiseReduction" style="accent-color:#6C3AED"> Noise Reduction
              </label>
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.82rem;color:var(--text)">
                <input type="checkbox" id="audioDucking" style="accent-color:#6C3AED"> Audio Ducking <span style="font-size:.7rem;color:var(--text-muted)">(lower music during speech)</span>
              </label>
            </div>
            <button class="tool-action-button" id="audioButton" disabled>🔊 Apply Audio</button>
          </div>

          <div class="tool-panel" id="voiceoverPanel">
            <div class="panel-title">🎙️ AI Voiceover</div>
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:1rem">Generate AI voiceover and overlay it on your video</p>
            <div class="form-group-ve" style="margin-bottom:.8rem">
              <label style="display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.3rem">Voice</label>
              <select id="voiceSelect" style="width:100%;padding:.5rem .7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:.82rem;outline:none">
                <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Female, Calm)</option>
                <option value="EXAVITQu4vr4xnSDxMaL">Bella (Female, Warm)</option>
                <option value="ErXwobaYiN019PkySvjV">Antoni (Male, Calm)</option>
                <option value="VR6AewLTigWG4xSOukaG">Arnold (Male, Deep)</option>
                <option value="pNInz6obpgDQGcFmaJgB">Adam (Male, Clear)</option>
                <option value="yoZ06aMxZJJ28mfd3POQ">Sam (Male, Raspy)</option>
                <option value="jBpfuIE2acCO8z3wKNLl">Gigi (Female, Animated)</option>
                <option value="ThT5KcBeYPX3keUQqHPh">Dorothy (Female, British)</option>
              </select>
            </div>
            <div class="form-group-ve" style="margin-bottom:.8rem">
              <label style="display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.3rem">Script</label>
              <textarea id="voiceoverScript" placeholder="Type your voiceover script here..." style="width:100%;height:100px;padding:.6rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:.82rem;resize:vertical;outline:none;font-family:inherit"></textarea>
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Voice Volume</span>
                <span class="slider-value" id="voiceVolumeValue">100%</span>
              </div>
              <input type="range" class="slider" id="voiceVolumeSlider" min="0" max="200" value="100">
            </div>
            <div style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:1rem">
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.82rem;color:var(--text)">
                <input type="checkbox" id="duckOriginal" checked style="accent-color:#6C3AED"> Duck original audio during voiceover
              </label>
            </div>
            <div style="display:flex;gap:.5rem">
              <button class="tool-action-button" id="previewVoiceButton" disabled style="flex:1;background:var(--dark-2);color:var(--text);border:1px solid rgba(255,255,255,0.1)">🔈 Preview</button>
              <button class="tool-action-button" id="voiceoverButton" disabled style="flex:1">🎙️ Apply to Video</button>
            </div>
            <div id="voiceoverApiNote" style="margin-top:.8rem;padding:.6rem;background:rgba(108,58,237,0.08);border-radius:8px;font-size:.75rem;color:var(--text-muted)">
              Uses your ElevenLabs API key from <a href="/brand-voice" style="color:#6C3AED;text-decoration:none;font-weight:600">Brand Voice</a> settings.
            </div>
          </div>

          <div class="tool-panel" id="textPanel">
            <div class="panel-title">📝 Text Overlay</div>
            <input type="text" class="text-input" id="overlayText" placeholder="Enter text">
            <label class="dropdown-label">Position</label>
            <select class="dropdown" id="textPosition">
              <option value="top">Top</option>
              <option value="center" selected>Center</option>
              <option value="bottom">Bottom</option>
            </select>
            <div class="slider-group">
              <div class="slider-label">
                <span>Font Size</span>
                <span class="slider-value" id="fontSizeValue">24px</span>
              </div>
              <input type="range" class="slider" id="fontSize" min="12" max="100" value="24">
            </div>
            <button class="tool-action-button" id="textButton" disabled>Apply Text</button>
          </div>

          <div class="tool-panel" id="transitionsPanel">
            <div class="panel-title">✨ Transitions</div>
            <p style="color:var(--text-muted);font-size:.85rem">Coming Soon - Requires multiple clips</p>
          </div>

          <div class="export-panel">
            <div class="panel-title">📤 Export Settings</div>

            <div class="dropdown-group">
              <label class="dropdown-label">Resolution</label>
              <select class="dropdown" id="resolution">
                <option value="1080p">1080p (1920x1080)</option>
                <option value="720p" selected>720p (1280x720)</option>
                <option value="4k">4K (3840x2160)</option>
                <option value="480p">480p (854x480)</option>
              </select>
            </div>

            <div class="dropdown-group">
              <label class="dropdown-label">Format</label>
              <select class="dropdown" id="format">
                <option value="mp4" selected>MP4 (H.264)</option>
                <option value="mov">MOV (Apple)</option>
                <option value="webm">WebM (VP9)</option>
                <option value="gif">GIF (Animated)</option>
              </select>
            </div>

            <button class="export-button" id="exportButton" disabled>📥 Export Video</button>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script>
    ${getThemeScript()}

    let currentVideoFile = null;
    let videoDuration = 0;
    let selectedFilter = null;

    // Toast notifications
    function showToast(message, type = 'success') {
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.style.display = 'block';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    // Upload handlers
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoPreviewArea = document.getElementById('videoPreviewArea');

    document.querySelector('.upload-button').addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    uploadZone.addEventListener('click', (e) => {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await uploadVideo(file);
    });

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        await uploadVideo(file);
      }
    });

    async function uploadVideo(file) {
      var uploadBtn = document.querySelector('.upload-button');
      var originalText = uploadBtn.textContent;
      uploadBtn.textContent = 'Uploading...';
      uploadBtn.disabled = true;
      uploadZone.style.opacity = '0.6';
      uploadZone.style.pointerEvents = 'none';

      const formData = new FormData();
      formData.append('video', file);

      try {
        const response = await fetch('/video-editor/upload', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          var errData = {};
          try { errData = await response.json(); } catch(e) {}
          throw new Error(errData.error || 'Upload failed (status ' + response.status + ')');
        }

        const data = await response.json();
        currentVideoFile = data;
        videoDuration = data.duration || 0;

        videoPlayer.src = data.serveUrl;
        uploadZone.classList.add('has-video');
        videoPreviewArea.classList.add('has-video');
        document.getElementById('trimButton').disabled = false;
        document.getElementById('exportButton').disabled = false;
        document.getElementById('splitButton').disabled = false;
        document.getElementById('filterButton').disabled = false;
        document.getElementById('speedButton').disabled = false;
        document.getElementById('audioButton').disabled = false;
        document.getElementById('previewVoiceButton').disabled = false;
        document.getElementById('voiceoverButton').disabled = false;
        document.getElementById('textButton').disabled = false;
        document.getElementById('speedSelect').disabled = false;

        // Set end time to video duration
        document.getElementById('endTime').value = Math.round(videoDuration);

        showToast('Video uploaded successfully!', 'success');
      } catch (error) {
        uploadBtn.textContent = originalText;
        uploadBtn.disabled = false;
        uploadZone.style.opacity = '1';
        uploadZone.style.pointerEvents = 'auto';
        showToast('Failed to upload video: ' + error.message, 'error');
      }
    }

    // Slider updates
    document.querySelectorAll('.slider').forEach(slider => {
      if (slider.id === 'volumeSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('volumeValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'fadeInSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('fadeInValue').textContent = this.value + 's';
        });
      } else if (slider.id === 'fadeOutSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('fadeOutValue').textContent = this.value + 's';
        });
      } else if (slider.id === 'bassSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('bassValue').textContent = this.value + 'dB';
        });
      } else if (slider.id === 'trebleSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('trebleValue').textContent = this.value + 'dB';
        });
      } else if (slider.id === 'voiceVolumeSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('voiceVolumeValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'fontSize') {
        slider.addEventListener('input', function() {
          document.getElementById('fontSizeValue').textContent = this.value + 'px';
        });
      } else {
        slider.addEventListener('input', function() {
          const valueSpan = this.parentElement.querySelector('.slider-value');
          if (valueSpan) {
            valueSpan.textContent = this.value + '%';
          }
        });
      }
    });

    // Tool panel switching
    document.querySelectorAll('.tool-button').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        var tool = this.dataset.tool;

        document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));
        var panelId = tool + 'Panel';
        var panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.add('active');
        }
      });
    });

    // Timeline segment selection
    var selectedSegment = null;
    document.querySelectorAll('.timeline-segment').forEach(seg => {
      seg.addEventListener('click', function(e) {
        // Skip if clicking a trim handle
        if (e.target.classList.contains('trim-handle')) return;

        // Toggle selection
        if (selectedSegment === this) {
          this.classList.remove('selected');
          selectedSegment = null;
          showToast('Segment deselected', 'success');
        } else {
          document.querySelectorAll('.timeline-segment').forEach(s => s.classList.remove('selected'));
          this.classList.add('selected');
          selectedSegment = this;

          var idx = parseInt(this.dataset.index);
          if (currentVideoFile && videoDuration > 0) {
            // Jump video to the corresponding time position
            var segCount = document.querySelectorAll('.timeline-segment').length;
            var segDuration = videoDuration / segCount;
            var seekTime = idx * segDuration;
            videoPlayer.currentTime = seekTime;

            // Update trim start/end to this segment's range
            var startField = document.getElementById('startTime');
            var endField = document.getElementById('endTime');
            if (startField) startField.value = Math.round(seekTime);
            if (endField) endField.value = Math.round(Math.min(seekTime + segDuration, videoDuration));

            showToast('Selected Clip ' + (idx + 1) + ' (' + Math.round(seekTime) + 's - ' + Math.round(seekTime + segDuration) + 's)', 'success');
          } else {
            showToast('Selected Clip ' + (idx + 1) + ' — upload a video to edit this segment', 'success');
          }
        }
      });
    });

    // Filter button selection
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        selectedFilter = this.dataset.filter;
      });
    });

    // Trim handler
    document.getElementById('trimButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const startTime = parseFloat(document.getElementById('startTime').value) || 0;
      const endTime = parseFloat(document.getElementById('endTime').value) || videoDuration;

      if (startTime >= endTime) {
        showToast('Start time must be less than end time', 'error');
        return;
      }

      const button = document.getElementById('trimButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Trimming...';

      try {
        const response = await fetch('/video-editor/trim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            startTime,
            endTime
          })
        });

        if (!response.ok) throw new Error('Trim failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;
        document.getElementById('endTime').value = Math.round(videoDuration);

        showToast('Video trimmed successfully!', 'success');
      } catch (error) {
        showToast('Trim failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '✂️ Trim';
      }
    });

    // Split handler
    document.getElementById('splitButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const splitTime = parseFloat(document.getElementById('splitTime').value);
      if (isNaN(splitTime) || splitTime <= 0 || splitTime >= videoDuration) {
        showToast('Split time must be between 0 and ' + Math.round(videoDuration) + ' seconds', 'error');
        return;
      }

      const button = document.getElementById('splitButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Splitting...';

      try {
        const response = await fetch('/video-editor/split', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            splitTime: splitTime
          })
        });

        if (!response.ok) throw new Error('Split failed');

        const data = await response.json();
        showToast('Video split successfully! ' + data.files.length + ' files created', 'success');
      } catch (error) {
        showToast('Split failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🔀 Split';
      }
    });

    // Filter handler
    document.getElementById('filterButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      if (!selectedFilter) {
        showToast('Please select a filter', 'error');
        return;
      }

      const button = document.getElementById('filterButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Applying...';

      try {
        const response = await fetch('/video-editor/filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            filter: selectedFilter
          })
        });

        if (!response.ok) throw new Error('Filter failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Filter applied successfully!', 'success');
      } catch (error) {
        showToast('Filter failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🎨 Apply Filter';
      }
    });

    // Speed handler
    document.getElementById('speedButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const speed = parseFloat(document.getElementById('speedSelect').value);

      const button = document.getElementById('speedButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/video-editor/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            speed: speed
          })
        });

        if (!response.ok) throw new Error('Speed adjustment failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Speed adjusted successfully!', 'success');
      } catch (error) {
        showToast('Speed adjustment failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '⚡ Apply Speed';
      }
    });

    // Audio handler
    document.getElementById('audioButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const volume = parseFloat(document.getElementById('volumeSlider').value);
      const fadeIn = parseFloat(document.getElementById('fadeInSlider').value);
      const fadeOut = parseFloat(document.getElementById('fadeOutSlider').value);
      const bass = parseInt(document.getElementById('bassSlider').value);
      const treble = parseInt(document.getElementById('trebleSlider').value);
      const noiseReduction = document.getElementById('noiseReduction').checked;
      const audioDucking = document.getElementById('audioDucking').checked;

      const button = document.getElementById('audioButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/video-editor/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            volume,
            fadeIn,
            fadeOut,
            bass,
            treble,
            noiseReduction,
            audioDucking
          })
        });

        if (!response.ok) throw new Error('Audio adjustment failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Audio enhanced successfully!', 'success');
      } catch (error) {
        showToast('Audio processing failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🔊 Apply Audio';
      }
    });

    // Voiceover preview handler
    document.getElementById('previewVoiceButton').addEventListener('click', async () => {
      var script = document.getElementById('voiceoverScript').value.trim();
      if (!script) { showToast('Please enter a voiceover script', 'error'); return; }

      var voice = document.getElementById('voiceSelect').value;
      var btn = document.getElementById('previewVoiceButton');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating...';

      try {
        var response = await fetch('/video-editor/voiceover-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: script, voiceId: voice })
        });
        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Preview failed');
        }
        var blob = await response.blob();
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        audio.play();
        showToast('Playing voiceover preview', 'success');
      } catch (error) {
        showToast('Preview failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔈 Preview';
      }
    });

    // Voiceover apply handler
    document.getElementById('voiceoverButton').addEventListener('click', async () => {
      if (!currentVideoFile) { showToast('Please upload a video first', 'error'); return; }
      var script = document.getElementById('voiceoverScript').value.trim();
      if (!script) { showToast('Please enter a voiceover script', 'error'); return; }

      var voice = document.getElementById('voiceSelect').value;
      var voiceVolume = parseFloat(document.getElementById('voiceVolumeSlider').value);
      var duckOriginal = document.getElementById('duckOriginal').checked;

      var btn = document.getElementById('voiceoverButton');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating & Mixing...';

      try {
        var response = await fetch('/video-editor/voiceover-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            text: script,
            voiceId: voice,
            voiceVolume: voiceVolume,
            duckOriginal: duckOriginal
          })
        });
        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Voiceover failed');
        }
        var data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        showToast('Voiceover applied successfully!', 'success');
      } catch (error) {
        showToast('Voiceover failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🎙️ Apply to Video';
      }
    });

    // Text overlay handler
    document.getElementById('textButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const text = document.getElementById('overlayText').value.trim();
      if (!text) {
        showToast('Please enter text', 'error');
        return;
      }

      const position = document.getElementById('textPosition').value;
      const fontSize = parseInt(document.getElementById('fontSize').value);

      const button = document.getElementById('textButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/video-editor/text-overlay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            text: text,
            position: position,
            fontSize: fontSize
          })
        });

        if (!response.ok) throw new Error('Text overlay failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Text overlay applied successfully!', 'success');
      } catch (error) {
        showToast('Text overlay failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '📝 Apply Text';
      }
    });

    // Export handler
    document.getElementById('exportButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('exportButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Exporting...';

      try {
        const brightness = parseFloat(document.getElementById('brightness').value);
        const contrast = parseFloat(document.getElementById('contrast').value);
        const saturation = parseFloat(document.getElementById('saturation').value);
        const resolution = document.getElementById('resolution').value;
        const format = document.getElementById('format').value;

        const response = await fetch('/video-editor/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            brightness,
            contrast,
            saturation,
            resolution,
            format
          })
        });

        if (!response.ok) throw new Error('Export failed');

        const data = await response.json();

        // Trigger download
        const downloadLink = document.createElement('a');
        downloadLink.href = data.downloadUrl;
        downloadLink.download = data.filename;
        downloadLink.click();

        showToast('Video exported successfully!', 'success');
      } catch (error) {
        showToast('Export failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '📥 Export Video';
      }
    });
  </script>
</body>
</html>`;
  res.send(html);
});

// POST: Upload video
router.post('/upload', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = req.file.originalname;
    const ext = path.extname(originalName);
    const newFilename = `${Date.now()}_${req.user.id}${ext}`;
    const newPath = path.join(uploadDir, newFilename);

    fs.renameSync(req.file.path, newPath);

    // Get video metadata
    const metadata = await getVideoMetadata(newPath);

    res.json({
      filename: newFilename,
      originalName: originalName,
      duration: metadata.duration,
      size: fs.statSync(newPath).size,
      serveUrl: `/video-editor/download/${newFilename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Trim video
router.post('/trim', requireAuth, async (req, res) => {
  try {
    const { filename, startTime, endTime } = req.body;

    if (!filename || startTime === undefined || endTime === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Check both output and upload directories (file may be from a previous operation)
    let inputPath = path.join(outputDir, filename);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = `trimmed_${Date.now()}_${req.user.id}${path.extname(filename)}`;
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', inputPath,
      '-ss', startTime.toString(),
      '-to', endTime.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      size: fs.statSync(outputPath).size,
      serveUrl: `/video-editor/download/${outputFilename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Export video with filters
router.post('/export', requireAuth, async (req, res) => {
  try {
    const { filename, brightness, contrast, saturation, resolution, format } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Missing filename' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Resolution mapping
    const resolutionMap = {
      '1080p': '1920x1080',
      '720p': '1280x720',
      '4k': '3840x2160',
      '480p': '854x480'
    };

    const resolutionValue = resolutionMap[resolution] || '1280x720';
    const [width, height] = resolutionValue.split('x').map(Number);

    // Normalize brightness/contrast/saturation for ffmpeg eq filter
    // brightness: slider 0-200 → ffmpeg -1.0 to 1.0 (default 0 = no change)
    // contrast: slider 0-200 → ffmpeg 0.0 to 2.0 (default 1.0 = no change)
    // saturation: slider 0-200 → ffmpeg 0.0 to 2.0 (default 1.0 = no change)
    const b = ((brightness - 100) / 100).toFixed(2);
    const c = (contrast / 100).toFixed(2);
    const s = (saturation / 100).toFixed(2);

    // Use scale with aspect ratio preservation + padding to avoid stretching
    const filterComplex = 'eq=brightness=' + b + ':contrast=' + c + ':saturation=' + s + ',scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease,pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:color=black';

    const ext = format === 'gif' ? '.gif' : ('.' + format);
    const outputFilename = 'exported_' + Date.now() + '_' + req.user.id + ext;
    const outputPath = path.join(outputDir, outputFilename);

    let ffmpegArgs = [
      '-i', source,
      '-vf', filterComplex,
      '-y',
      outputPath
    ];

    // Format-specific settings
    if (format === 'mp4') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', outputPath];
    } else if (format === 'mov') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', outputPath];
    } else if (format === 'webm') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-y', outputPath];
    } else if (format === 'gif') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex + ',fps=10', '-y', outputPath];
    }

    await runFFmpeg(ffmpegArgs);

    res.json({
      filename: outputFilename,
      downloadUrl: `/video-editor/download/${outputFilename}`,
      size: fs.statSync(outputPath).size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Download file
router.get('/download/:filename', requireAuth, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);

    // Check in output directory first, then upload directory
    let filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(uploadDir, filename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Serve file for video playback (not just download)
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.gif': 'image/gif' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = (end - start) + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Split video
router.post('/split', requireAuth, async (req, res) => {
  try {
    const { filename, splitTime } = req.body;

    if (!filename || splitTime === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Check both output and upload directories
    let inputPath = path.join(outputDir, filename);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const ext = path.extname(filename);
    const part1Filename = 'split_part1_' + Date.now() + '_' + req.user.id + ext;
    const part2Filename = 'split_part2_' + Date.now() + '_' + req.user.id + ext;
    const part1Path = path.join(outputDir, part1Filename);
    const part2Path = path.join(outputDir, part2Filename);

    // Split into two parts
    await runFFmpeg([
      '-i', inputPath,
      '-to', splitTime.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      part1Path
    ]);

    await runFFmpeg([
      '-i', inputPath,
      '-ss', splitTime.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      part2Path
    ]);

    const metadata1 = await getVideoMetadata(part1Path);
    const metadata2 = await getVideoMetadata(part2Path);

    res.json({
      files: [
        {
          filename: part1Filename,
          downloadUrl: '/video-editor/download/' + part1Filename,
          duration: metadata1.duration
        },
        {
          filename: part2Filename,
          downloadUrl: '/video-editor/download/' + part2Filename,
          duration: metadata2.duration
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Apply filter
router.post('/filter', requireAuth, async (req, res) => {
  try {
    const { filename, filter } = req.body;

    if (!filename || !filter) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const filterMap = {
      'grayscale': 'hue=s=0',
      'sepia': 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
      'warm': 'curves=r=\'0/0 0.5/0.6 1/1\':b=\'0/0 0.5/0.4 1/1\'',
      'cool': 'curves=b=\'0/0 0.5/0.6 1/1\':r=\'0/0 0.5/0.4 1/1\'',
      'vintage': 'curves=preset=vintage',
      'highcontrast': 'eq=contrast=1.5:brightness=0.05'
    };

    const filterStr = filterMap[filter] || 'hue=s=0';
    const outputFilename = 'filtered_' + Date.now() + '_' + req.user.id + path.extname(filename);
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', source,
      '-vf', filterStr,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Adjust video speed
router.post('/speed', requireAuth, async (req, res) => {
  try {
    const { filename, speed } = req.body;

    if (!filename || speed === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = 'speed_' + Date.now() + '_' + req.user.id + path.extname(filename);
    const outputPath = path.join(outputDir, outputFilename);

    const speedValue = parseFloat(speed);
    const videoPts = 'PTS/' + speedValue;

    let audioFilters = '';
    if (speedValue < 0.5) {
      audioFilters = 'atempo=0.5,atempo=' + (speedValue / 0.5);
    } else if (speedValue > 2) {
      audioFilters = 'atempo=2,atempo=' + (speedValue / 2);
    } else {
      audioFilters = 'atempo=' + speedValue;
    }

    await runFFmpeg([
      '-i', source,
      '-vf', 'setpts=' + videoPts,
      '-af', audioFilters,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Adjust audio volume
router.post('/audio', requireAuth, async (req, res) => {
  try {
    const { filename, volume, fadeIn, fadeOut, bass, treble, noiseReduction, audioDucking } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Missing filename' });
    }

    // Check both output and upload directories
    let source = path.join(outputDir, filename);
    if (!fs.existsSync(source)) {
      source = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = 'audio_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Build audio filter chain
    const audioFilters = [];

    // Volume adjustment
    const volumeValue = (parseFloat(volume || 100) / 100).toFixed(2);
    audioFilters.push('volume=' + volumeValue);

    // Fade in
    const fadeInDur = parseFloat(fadeIn || 0);
    if (fadeInDur > 0) {
      audioFilters.push('afade=t=in:d=' + fadeInDur);
    }

    // Fade out (needs video duration — we get it from metadata)
    const fadeOutDur = parseFloat(fadeOut || 0);
    if (fadeOutDur > 0) {
      try {
        const meta = await getVideoMetadata(source);
        const startTime = Math.max(0, (meta.duration || 30) - fadeOutDur);
        audioFilters.push('afade=t=out:st=' + startTime.toFixed(2) + ':d=' + fadeOutDur);
      } catch (e) {
        // If we can't get duration, apply fade out starting at 0 (won't be ideal but won't break)
        audioFilters.push('afade=t=out:st=0:d=' + fadeOutDur);
      }
    }

    // Bass boost / cut using equalizer
    const bassVal = parseInt(bass || 0);
    if (bassVal !== 0) {
      audioFilters.push('equalizer=f=100:width_type=o:width=2:g=' + bassVal);
    }

    // Treble boost / cut using equalizer
    const trebleVal = parseInt(treble || 0);
    if (trebleVal !== 0) {
      audioFilters.push('equalizer=f=8000:width_type=o:width=2:g=' + trebleVal);
    }

    // Noise reduction using highpass + lowpass to remove extreme frequencies
    if (noiseReduction) {
      audioFilters.push('highpass=f=80');
      audioFilters.push('lowpass=f=12000');
      audioFilters.push('afftdn=nf=-25');
    }

    // Audio ducking: compress dynamics so loud parts (music) get quieter relative to speech
    if (audioDucking) {
      audioFilters.push('acompressor=threshold=0.05:ratio=4:attack=5:release=50:makeup=2');
    }

    const filterString = audioFilters.join(',');

    await runFFmpeg([
      '-i', source,
      '-af', filterString,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Add text overlay
router.post('/text-overlay', requireAuth, async (req, res) => {
  try {
    const { filename, text, position, fontSize } = req.body;

    if (!filename || !text || !position || !fontSize) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = 'text_' + Date.now() + '_' + req.user.id + path.extname(filename);
    const outputPath = path.join(outputDir, outputFilename);

    const positionMap = {
      'top': '50',
      'center': '(h-text_h)/2',
      'bottom': 'h-text_h-50'
    };

    const yPos = positionMap[position] || '(h-text_h)/2';
    const escapedText = text.replace(/'/g, '\'\\\'\'');
    const drawFilter = 'drawtext=text=\'' + escapedText + '\':fontsize=' + fontSize + ':fontcolor=white:x=(w-text_w)/2:y=' + yPos + ':borderw=2:bordercolor=black';

    await runFFmpeg([
      '-i', source,
      '-vf', drawFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== AI VOICEOVER ENDPOINTS =====

// Helper: Get user's ElevenLabs API key from brand_kits
async function getElevenLabsKey(userId) {
  try {
    const { getDb } = require('../db/database');
    const db = getDb();
    const result = await db.query('SELECT elevenlabs_api_key FROM brand_kits WHERE user_id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].elevenlabs_api_key) {
      return result.rows[0].elevenlabs_api_key;
    }
  } catch (e) {}
  return null;
}

// Helper: Generate speech via ElevenLabs API
async function generateSpeech(apiKey, text, voiceId) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: '/v1/text-to-speech/' + voiceId,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        'Accept': 'audio/mpeg'
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          reject(new Error('ElevenLabs API error (' + res.statusCode + '): ' + body.slice(0, 200)));
        });
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('ElevenLabs API timeout')); });
    req.write(postData);
    req.end();
  });
}

// POST - Preview voiceover (returns audio only)
router.post('/voiceover-preview', requireAuth, async (req, res) => {
  try {
    const { text, voiceId } = req.body;
    if (!text) return res.status(400).json({ error: 'Please enter a script' });

    const apiKey = await getElevenLabsKey(req.user.id);
    if (!apiKey) {
      return res.status(400).json({ error: 'No ElevenLabs API key found. Add one in Brand Voice settings.' });
    }

    const audioBuffer = await generateSpeech(apiKey, text, voiceId || '21m00Tcm4TlvDq8ikWAM');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (error) {
    console.error('Voiceover preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST - Apply voiceover to video
router.post('/voiceover-apply', requireAuth, async (req, res) => {
  try {
    const { filename, text, voiceId, voiceVolume, duckOriginal } = req.body;
    if (!filename || !text) return res.status(400).json({ error: 'Missing filename or script' });

    const apiKey = await getElevenLabsKey(req.user.id);
    if (!apiKey) {
      return res.status(400).json({ error: 'No ElevenLabs API key found. Add one in Brand Voice settings.' });
    }

    // Check both directories for source video
    let source = path.join(outputDir, filename);
    if (!fs.existsSync(source)) {
      source = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Generate speech audio
    const audioBuffer = await generateSpeech(apiKey, text, voiceId || '21m00Tcm4TlvDq8ikWAM');

    // Save speech audio to temp file
    const voiceAudioPath = path.join(outputDir, 'voice_' + Date.now() + '.mp3');
    fs.writeFileSync(voiceAudioPath, audioBuffer);

    const outputFilename = 'voiceover_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Mix voice audio with video
    const voiceVol = ((voiceVolume || 100) / 100).toFixed(2);
    const originalVol = duckOriginal ? '0.3' : '1.0';

    await runFFmpeg([
      '-i', source,
      '-i', voiceAudioPath,
      '-filter_complex',
      '[0:a]volume=' + originalVol + '[a0];[1:a]volume=' + voiceVol + '[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]',
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath
    ]);

    // Clean up temp voice file
    try { fs.unlinkSync(voiceAudioPath); } catch (e) {}

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Voiceover apply error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
