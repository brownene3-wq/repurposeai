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
    .editor-container{display:flex;height:calc(100vh - 48px);gap:.75rem;padding:.75rem}
    .editor-main{flex:1;display:flex;flex-direction:column;min-width:0}
    .video-container{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:.5rem;flex:1;display:flex;flex-direction:column;min-height:0}
    .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border:2px dashed var(--primary);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:all 0.2s}
    .upload-zone.dragover{background:linear-gradient(135deg,rgba(108,58,237,0.2),rgba(236,72,153,0.2));border-color:var(--primary)}
    .upload-zone.has-video{display:none}
    .upload-zone h3{font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:.5rem}
    .upload-zone p{color:var(--text-muted);font-size:.9rem;margin-bottom:1rem}
    .upload-button{padding:.6rem 1.2rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s}
    .upload-button:hover{box-shadow:0 8px 24px rgba(108,58,237,0.3);transform:translateY(-2px)}
    .video-preview-area{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border-radius:10px;flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:200px}
    .video-preview-area.has-video{background:transparent;padding:0}
    .video-player{width:100%;height:100%;border-radius:12px}
.timeline-container{background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-top:.5rem;overflow:hidden;flex-shrink:0;user-select:none}
    .timeline-ruler{height:24px;background:#12121f;display:flex;align-items:flex-end;position:relative;padding:0 40px;border-bottom:1px solid rgba(255,255,255,0.06)}
    .timeline-ruler-mark{position:absolute;bottom:0;font-size:.6rem;color:rgba(255,255,255,0.35);transform:translateX(-50%)}
    .timeline-ruler-mark::after{content:'';display:block;width:1px;height:6px;background:rgba(255,255,255,0.15);margin:2px auto 0}
    .timeline-tracks{position:relative;padding:6px 0;min-height:90px}
    .timeline-track{display:flex;align-items:center;margin:2px 0;padding:0 8px;position:relative}
    .timeline-track#timelineVideoTrack .timeline-track-content{height:64px}
    .timeline-track#timelineAudioTrack .timeline-track-content{height:44px}
    .timeline-track#timelineMusicTrack .timeline-track-content{height:38px}
    .timeline-track-label{width:32px;flex-shrink:0;font-size:.6rem;color:var(--text-muted);text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px}
    .timeline-track-content{flex:1;height:100%;position:relative;border-radius:6px;overflow:hidden;cursor:pointer}
    .timeline-video-bar{height:100%;background:linear-gradient(180deg,#0d9488,#0f766e);border-radius:6px;position:relative;overflow:hidden;border:1px solid rgba(13,148,136,0.3)}
    .thumb-strip{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;overflow:hidden;border-radius:6px}
    .thumb-strip img{display:block;pointer-events:none}
    .track-info-overlay{position:absolute;top:0;left:0;right:0;padding:4px 12px;display:flex;align-items:center;gap:8px;z-index:2;background:linear-gradient(180deg,rgba(0,0,0,0.6) 0%,rgba(0,0,0,0) 100%)}
    .track-info-overlay .track-info{font-size:.7rem;color:rgba(255,255,255,0.95);font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,0.8)}
    .track-info-overlay .track-duration{font-size:.65rem;color:rgba(255,255,255,0.7);text-shadow:0 1px 3px rgba(0,0,0,0.8)}
    .timeline-audio-bar{height:100%;background:linear-gradient(180deg,#1e293b,#0f172a);border-radius:6px;position:relative;overflow:hidden;border:1px solid rgba(56,189,248,0.15)}
    .timeline-music-bar{height:100%;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-radius:6px;display:flex;align-items:center;padding:0 12px;position:relative;overflow:hidden}
    .timeline-music-bar .track-info{font-size:.72rem;color:rgba(255,255,255,0.9);font-weight:500;white-space:nowrap;z-index:2}
    .timeline-music-bar .track-volume{font-size:.65rem;color:rgba(255,255,255,0.6);margin-left:8px;z-index:2}
    .timeline-music-bar .waveform-bg{position:absolute;top:0;left:0;right:0;bottom:0;opacity:0.25}
    .timeline-playhead{position:absolute;top:0;bottom:0;width:2px;background:#fff;z-index:10;cursor:col-resize;pointer-events:auto}
    .timeline-playhead::before{content:'';position:absolute;top:-2px;left:-9px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:14px solid #fff;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))}
    .timeline-playhead-hitbox{position:absolute;top:-6px;bottom:0;left:-12px;width:26px;cursor:col-resize;z-index:11}
    .timeline-trim-handle{position:absolute;top:0;bottom:0;width:14px;cursor:col-resize;z-index:5;display:flex;align-items:center;justify-content:center;transition:background .2s}
    .timeline-trim-handle.left{left:0;background:linear-gradient(90deg,rgba(255,255,255,0.25),rgba(255,255,255,0.05));border-radius:6px 0 0 6px;border-left:3px solid rgba(255,255,255,0.6)}
    .timeline-trim-handle.right{right:0;background:linear-gradient(270deg,rgba(255,255,255,0.25),rgba(255,255,255,0.05));border-radius:0 6px 6px 0;border-right:3px solid rgba(255,255,255,0.6)}
    .timeline-trim-handle:hover{background:rgba(255,255,255,0.3)}
    .timeline-trim-handle::after{content:'';width:2px;height:18px;background:rgba(255,255,255,0.5);border-radius:1px}
    .timeline-trim-overlay{position:absolute;top:0;bottom:0;background:rgba(0,0,0,0.5);pointer-events:none;z-index:3}
    .timeline-empty{text-align:center;color:var(--text-muted);font-size:.85rem;padding:1.5rem}
    body.light .timeline-container{background:#f0f0f5;border-color:rgba(108,58,237,0.12)}
    body.light .timeline-ruler{background:#e8e8f0}
    .tools-section{display:flex;gap:.4rem;margin-top:.6rem;flex-wrap:wrap}
    .tool-button{padding:.45rem .8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:8px;color:var(--text);cursor:pointer;font-size:.78rem;font-weight:500;transition:all .2s;display:flex;align-items:center;gap:.3rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .tool-button:hover{background:var(--surface);border-color:var(--primary);color:var(--primary)}
    .tool-button.active{background:var(--primary);color:white;border-color:var(--primary)}
    .editor-sidebar{width:270px;min-width:270px;display:flex;flex-direction:column;gap:.6rem;overflow-y:auto;max-height:calc(100vh - 60px);padding-right:2px}
    .editor-sidebar::-webkit-scrollbar{width:4px}
    .editor-sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
    .properties-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:1rem;flex-shrink:0}
    .tool-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:1rem;display:none;flex-shrink:0}
    .tool-panel.active{display:block}
    .panel-title{font-size:.85rem;font-weight:700;color:var(--text);margin-bottom:.75rem;display:flex;align-items:center;gap:.5rem}
    .slider-group{margin-bottom:1rem}
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
    .export-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:1rem;flex-shrink:0;margin-top:auto}
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
    body.light .properties-panel,body.light .export-panel,body.light .tool-panel{background:rgba(108,58,237,0.05);border-color:rgba(108,58,237,0.15)}
    body.light .tool-button{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15);color:var(--text)}
    body.light .tool-button:hover{background:rgba(108,58,237,0.15);border-color:var(--primary)}
    body.light .dropdown{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .slider{background:rgba(108,58,237,0.15)}
    body.light .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.05),rgba(236,72,153,0.05));border-color:rgba(108,58,237,0.3)}
    body.light .input-field,body.light .text-input{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .filter-btn{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    @media(max-width:1400px){.editor-sidebar{width:250px;min-width:250px}}
    @media(max-width:1200px){.editor-sidebar{width:230px;min-width:230px}}
    @media(max-width:768px){.editor-container{flex-direction:column;height:auto;gap:.5rem}.editor-main{min-height:600px}.editor-sidebar{width:100%;min-width:100%;max-height:none}.video-preview-area{min-height:250px}.timeline-container{margin-top:.5rem}.tools-section{flex-direction:column}.tool-button{width:100%;justify-content:center}}
    /* Override main-content padding for editor — maximize usable space */
    .main-content{padding:.5rem !important}
  </style>
</head>
<body>
 <div class="dashboard">
    ${getSidebar('video-editor', req.user, req.teamPermissions)}

    <main class="main-content">
      ${getThemeToggle()}

      <div class="editor-container">
        <div class="editor-main">
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

            <div class="timeline-container" id="timelineContainer">
              <div class="timeline-ruler" id="timelineRuler"></div>
              <div class="timeline-tracks" id="timelineTracks">
                <div class="timeline-playhead" id="timelinePlayhead" style="left:40px"><div class="timeline-playhead-hitbox" id="playheadHitbox"></div></div>
                <div class="timeline-empty" id="timelineEmpty">Upload a video to see the timeline</div>
              </div>
            </div>

            <div class="tools-section">
              <button class="tool-button active" data-tool="trim">✂️ Trim</button>
              <button class="tool-button" data-tool="split">🔀 Split</button>
              <button class="tool-button" data-tool="filters">🎨 Filters</button>
              <button class="tool-button" data-tool="speed">⚡ Speed</button>
              <button class="tool-button" data-tool="audio">🔊 Audio</button>
              <button class="tool-button" data-tool="music">🎵 Music</button>
              <button class="tool-button" data-tool="enhance">✨ AI Enhance</button>
              <button class="tool-button" data-tool="captions">💬 AI Captions</button>
              <button class="tool-button" data-tool="voiceover">🎙️ AI Voice</button>
              <button class="tool-button" data-tool="voicetransform">🔄 Voice Transform</button>
              <button class="tool-button" data-tool="text">📝 Text Overlay</button>
              <button class="tool-button" data-tool="transitions">✨ Transitions</button>
            </div>

            <div class="top-bar-selectors" style="display:flex;gap:1rem;margin-top:1.5rem;padding:1rem;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle)">
              <div style="flex:1">
                <label class="dropdown-label">Aspect Ratio</label>
                <select class="dropdown" id="aspectRatioSelect" style="padding:.5rem .6rem;font-size:.85rem">
                  <option value="16:9">16:9 (YouTube)</option>
                  <option value="9:16">9:16 (TikTok)</option>
                  <option value="1:1">1:1 (Instagram)</option>
                  <option value="4:5">4:5 (Reels)</option>
                </select>
              </div>
              <div style="flex:1">
                <label class="dropdown-label">Layout Mode</label>
                <select class="dropdown" id="layoutSelect" style="padding:.5rem .6rem;font-size:.85rem">
                  <option value="fill">Fill</option>
                  <option value="fit">Fit (Blur)</option>
                  <option value="split">Split Screen</option>
                  <option value="screenshare">Screen Share</option>
                  <option value="gameplay">Gameplay</option>
                </select>
              </div>
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

          <div class="tool-panel" id="voicetransformPanel">
            <div class="panel-title">🔄 Voice Transform</div>
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:1rem">Change the voice in your video to any AI voice using ElevenLabs Speech-to-Speech</p>
            <div class="form-group-ve" style="margin-bottom:.8rem">
              <label style="display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.3rem">Target Voice</label>
              <select id="vtVoiceSelect" style="width:100%;padding:.5rem .7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:.82rem;outline:none">
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
              <label style="display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.3rem">Source</label>
              <div style="display:flex;gap:.5rem;margin-bottom:.5rem">
                <label style="display:flex;align-items:center;gap:.4rem;padding:.4rem .8rem;background:var(--dark-2);border:2px solid var(--primary);border-radius:6px;cursor:pointer;font-size:.8rem;color:var(--text);font-weight:600" id="vtSourceVideoLabel">
                  <input type="radio" name="vtSource" value="video" checked style="accent-color:#6C3AED"> From Video
                </label>
                <label style="display:flex;align-items:center;gap:.4rem;padding:.4rem .8rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;font-size:.8rem;color:var(--text);font-weight:600" id="vtSourceUploadLabel">
                  <input type="radio" name="vtSource" value="upload" style="accent-color:#6C3AED"> Upload Audio
                </label>
              </div>
              <div id="vtUploadArea" style="display:none;margin-top:.5rem">
                <div style="border:2px dashed rgba(108,58,237,0.3);border-radius:8px;padding:1rem;text-align:center;cursor:pointer" onclick="document.getElementById('vtAudioFile').click()">
                  <div style="font-size:.85rem;color:var(--text)">Click to upload audio file</div>
                  <div style="font-size:.75rem;color:var(--text-muted)">MP3, WAV, M4A supported</div>
                  <input type="file" id="vtAudioFile" accept="audio/*" style="display:none">
                </div>
                <div id="vtAudioFileName" style="display:none;margin-top:.5rem;padding:.5rem;background:var(--dark-2);border-radius:6px;font-size:.8rem;color:var(--text)"></div>
              </div>
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Stability</span>
                <span class="slider-value" id="vtStabilityValue">50%</span>
              </div>
              <input type="range" class="slider" id="vtStability" min="0" max="100" value="50">
            </div>
            <div class="slider-group">
              <div class="slider-label">
                <span>Similarity</span>
                <span class="slider-value" id="vtSimilarityValue">75%</span>
              </div>
              <input type="range" class="slider" id="vtSimilarity" min="0" max="100" value="75">
            </div>
            <div style="display:flex;gap:.5rem;margin-top:.5rem">
              <button class="tool-action-button" id="vtPreviewBtn" disabled style="flex:1;background:var(--dark-2);color:var(--text);border:1px solid rgba(255,255,255,0.1)">🔈 Preview</button>
              <button class="tool-action-button" id="vtApplyBtn" disabled style="flex:1">🔄 Transform Voice</button>
            </div>
            <div id="vtProgress" style="display:none;margin-top:.8rem">
              <div style="background:rgba(255,255,255,0.1);border-radius:6px;height:6px;overflow:hidden">
                <div id="vtProgressBar" style="width:0%;height:100%;background:var(--gradient-1);transition:width 0.3s"></div>
              </div>
              <div id="vtProgressText" style="font-size:.75rem;color:var(--text-muted);margin-top:.3rem;text-align:center">Processing...</div>
            </div>
            <div id="vtApiNote" style="margin-top:.8rem;padding:.6rem;background:rgba(108,58,237,0.08);border-radius:8px;font-size:.75rem;color:var(--text-muted)">
              Requires ElevenLabs API key. Set it in <a href="/brand-voice" style="color:#6C3AED;text-decoration:none;font-weight:600">Brand Voice</a> settings or Smart Shorts → Settings.
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
            <div style="display:flex;flex-direction:column;gap:.8rem">
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.82rem;color:var(--text)">
                <input type="checkbox" id="autoTransitions" style="accent-color:#6C3AED"> Auto transitions between clips
              </label>
              <div>
                <div style="font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.6rem">Transition Type</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem">
                  <button class="transition-btn" data-transition="none" style="padding:.5rem;background:var(--dark-2);border:2px solid var(--primary);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">None</button>
                  <button class="transition-btn" data-transition="fade" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Fade</button>
                  <button class="transition-btn" data-transition="dissolve" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Dissolve</button>
                  <button class="transition-btn" data-transition="wipeleft" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Wipe Left</button>
                  <button class="transition-btn" data-transition="wiperight" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Wipe Right</button>
                  <button class="transition-btn" data-transition="slideright" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Slide Right</button>
                  <button class="transition-btn" data-transition="slideleft" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Slide Left</button>
                  <button class="transition-btn" data-transition="zoomin" style="padding:.5rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.75rem;cursor:pointer;transition:all 0.2s">Zoom In</button>
                </div>
              </div>
              <div class="slider-group">
                <div class="slider-label">
                  <span>Duration</span>
                  <span class="slider-value" id="transitionDurationValue">0.5s</span>
                </div>
                <input type="range" class="slider" id="transitionDuration" min="0.3" max="2.0" step="0.1" value="0.5">
              </div>
              <button class="tool-action-button" id="applyTransitionButton" disabled>Apply Transitions</button>
            </div>
          </div>

          <div class="tool-panel" id="musicPanel">
            <div class="panel-title">🎵 Music Library</div>
            <div style="margin-bottom:1rem">
              <input type="text" id="musicSearch" placeholder="Search copyright free music..." style="width:100%;padding:.6rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text);font-size:.85rem;margin-bottom:.5rem">
            </div>
            <div style="display:flex;gap:.4rem;margin-bottom:1rem;flex-wrap:wrap;font-size:.75rem">
              <button class="filter-btn selected" data-music-filter="all">All</button>
              <button class="filter-btn" data-music-filter="liked">Liked</button>
              <button class="filter-btn" data-music-filter="instrumental">Instrumental</button>
              <button class="filter-btn" data-music-filter="upbeat">Upbeat</button>
              <button class="filter-btn" data-music-filter="chill">Chill</button>
              <button class="filter-btn" data-music-filter="dramatic">Dramatic</button>
              <button class="filter-btn" data-music-filter="happy">Happy</button>
              <button class="filter-btn" data-music-filter="sad">Sad</button>
            </div>
            <button class="tool-action-button" style="background:var(--dark-2);color:var(--text);border:1px solid rgba(255,255,255,0.1)" onclick="document.getElementById('customMusicFile').click()">📁 Upload Custom Music</button>
            <input type="file" id="customMusicFile" accept="audio/*" style="display:none">
            <div id="musicList" style="margin-top:1rem;max-height:300px;overflow-y:auto">
              <div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:1rem">Loading music library...</div>
            </div>
            <div class="slider-group" style="margin-top:1rem">
              <div class="slider-label">
                <span>Music Volume</span>
                <span class="slider-value" id="musicVolumeValue">30%</span>
              </div>
              <input type="range" class="slider" id="musicVolume" min="0" max="100" value="30">
            </div>
            <button class="tool-action-button" id="addMusicButton" disabled>🎵 Add to Video</button>
          </div>

          <div class="tool-panel" id="enhancePanel">
            <div class="panel-title">✨ AI Enhance</div>
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:1rem">Enhance your speech with AI-powered tools</p>
            <div style="display:flex;flex-direction:column;gap:.6rem">
              <div style="display:flex;align-items:center;gap:.5rem;padding:.8rem;background:var(--dark-2);border-radius:8px;border:1px solid rgba(255,255,255,0.1)">
                <div style="flex:1">
                  <div style="font-size:.85rem;font-weight:600;color:var(--text)">Remove Filler Words</div>
                  <div style="font-size:.75rem;color:var(--text-muted);margin-top:.2rem">Remove um, uh, like, basically...</div>
                </div>
                <button class="tool-action-button" id="removeFillerWordsBtn" disabled style="width:auto;padding:.5rem 1rem;white-space:nowrap">Process</button>
              </div>
              <div id="fillerWordsProgress" style="display:none;margin-top:.5rem">
                <div style="background:rgba(255,255,255,0.1);border-radius:6px;height:4px;overflow:hidden">
                  <div id="fillerWordsProgressBar" style="width:0%;height:100%;background:var(--gradient-1);transition:width 0.3s"></div>
                </div>
                <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem;text-align:center">Processing audio...</div>
              </div>
              <div style="display:flex;align-items:center;gap:.5rem;padding:.8rem;background:var(--dark-2);border-radius:8px;border:1px solid rgba(255,255,255,0.1)">
                <div style="flex:1">
                  <div style="font-size:.85rem;font-weight:600;color:var(--text)">Remove Pauses</div>
                  <div style="font-size:.75rem;color:var(--text-muted);margin-top:.2rem">Remove silence gaps automatically</div>
                </div>
                <button class="tool-action-button" id="removePausesBtn" disabled style="width:auto;padding:.5rem 1rem;white-space:nowrap">Process</button>
              </div>
              <div id="pausesProgress" style="display:none;margin-top:.5rem">
                <div style="background:rgba(255,255,255,0.1);border-radius:6px;height:4px;overflow:hidden">
                  <div id="pausesProgressBar" style="width:0%;height:100%;background:var(--gradient-1);transition:width 0.3s"></div>
                </div>
                <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem;text-align:center">Processing audio...</div>
              </div>
            </div>
          </div>

          <div class="tool-panel" id="captionsPanel">
            <div class="panel-title">💬 AI Captions</div>
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.8rem">Generate animated captions from your video's audio</p>

            <div style="margin-bottom:.8rem">
              <label style="display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.4rem">Caption Style</label>
              <div id="captionStyleGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem;max-height:220px;overflow-y:auto">
                <div class="caption-style-option selected" data-caption-style="karaoke" onclick="selectCaptionStyle(this,'karaoke')" style="padding:.6rem;background:var(--dark-2);border:2px solid var(--primary);border-radius:8px;cursor:pointer;text-align:center;transition:all .2s">
                  <div style="font-weight:700;font-size:.9rem;color:#6C3AED">HELLO</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Karaoke</div>
                </div>
                <div class="caption-style-option" data-caption-style="bold-pop" onclick="selectCaptionStyle(this,'bold-pop')" style="padding:.6rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;text-align:center;transition:all .2s">
                  <div style="font-weight:800;font-size:1rem;color:#EC4899">BOLD</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Bold Pop</div>
                </div>
                <div class="caption-style-option" data-caption-style="minimal" onclick="selectCaptionStyle(this,'minimal')" style="padding:.6rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;text-align:center;transition:all .2s">
                  <div style="font-weight:400;font-size:.85rem;color:#fff">hello</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Minimal</div>
                </div>
                <div class="caption-style-option" data-caption-style="neon-glow" onclick="selectCaptionStyle(this,'neon-glow')" style="padding:.6rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;text-align:center;transition:all .2s">
                  <div style="font-weight:700;font-size:.9rem;color:#00FF41;text-shadow:0 0 8px #00FF41">NEON</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Neon Glow</div>
                </div>
                <div class="caption-style-option" data-caption-style="mrbeast" onclick="selectCaptionStyle(this,'mrbeast')" style="padding:.6rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;text-align:center;transition:all .2s">
                  <div style="font-weight:900;font-size:1rem;color:#FFD700;text-shadow:2px 2px 0 #000">WOW</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">MrBeast</div>
                </div>
                <div class="caption-style-option" data-caption-style="hormozi" onclick="selectCaptionStyle(this,'hormozi')" style="padding:.6rem;background:var(--dark-2);border:2px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;text-align:center;transition:all .2s">
                  <div style="font-weight:700;font-size:.9rem;color:#fff"><span style="background:#ef4444;padding:0 4px;border-radius:2px">KEY</span> word</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Hormozi</div>
                </div>
              </div>
            </div>

            <div style="margin-bottom:.8rem">
              <label style="display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.4rem">Position</label>
              <div style="display:flex;gap:.4rem">
                <button class="filter-btn" id="capPosTop" onclick="setCaptionPosition('top',this)" style="flex:1;font-size:.75rem">Top</button>
                <button class="filter-btn selected" id="capPosBottom" onclick="setCaptionPosition('bottom',this)" style="flex:1;font-size:.75rem">Bottom</button>
                <button class="filter-btn" id="capPosCenter" onclick="setCaptionPosition('center',this)" style="flex:1;font-size:.75rem">Center</button>
              </div>
            </div>

            <div id="captionProgress" style="display:none;margin-bottom:.8rem">
              <div style="background:rgba(255,255,255,0.1);border-radius:6px;height:4px;overflow:hidden">
                <div id="captionProgressBar" style="width:0%;height:100%;background:var(--gradient-1);transition:width 0.3s"></div>
              </div>
              <div id="captionProgressText" style="font-size:.7rem;color:var(--text-muted);margin-top:.3rem;text-align:center">Extracting speech...</div>
            </div>

            <button class="tool-action-button" id="applyCaptionsBtn" disabled>💬 Generate & Apply Captions</button>
            <p style="font-size:.7rem;color:var(--text-muted);margin-top:.5rem;text-align:center">Uses OpenAI Whisper to extract speech and burn animated captions</p>
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

    // Auto-collapse sidebar on Video Editor for maximum workspace
    (function() {
      var sb = document.querySelector('.sidebar');
      var mc = document.querySelector('.main-content');
      if (sb && !sb.classList.contains('collapsed')) {
        sb.classList.add('collapsed');
        if (mc) mc.style.marginLeft = '68px';
      }
    })();

    let currentVideoFile = null;
    let originalVideoFile = null; // Always keeps the original upload for speed resets
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
        originalVideoFile = { ...data }; // Save original for speed resets
        videoDuration = data.duration || 0;
        initTimeline();

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
        document.getElementById('vtPreviewBtn').disabled = false;
        document.getElementById('vtApplyBtn').disabled = false;
        document.getElementById('textButton').disabled = false;
        document.getElementById('speedSelect').disabled = false;
        document.getElementById('addMusicButton').disabled = false;
        document.getElementById('removeFillerWordsBtn').disabled = false;
        document.getElementById('removePausesBtn').disabled = false;
        document.getElementById('applyTransitionButton').disabled = false;

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
      } else if (slider.id === 'musicVolume') {
        slider.addEventListener('input', function() {
          document.getElementById('musicVolumeValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'vtStability') {
        slider.addEventListener('input', function() {
          document.getElementById('vtStabilityValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'vtSimilarity') {
        slider.addEventListener('input', function() {
          document.getElementById('vtSimilarityValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'brightness' || slider.id === 'contrast' || slider.id === 'saturation') {
        slider.addEventListener('input', function() {
          const valueSpan = this.parentElement.querySelector('.slider-value');
          if (valueSpan) {
            valueSpan.textContent = this.value + '%';
          }
          // Apply real-time CSS filter preview on the video
          applyVideoFilterPreview();
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

    function applyVideoFilterPreview() {
      var b = parseInt(document.getElementById('brightness').value) || 100;
      var c = parseInt(document.getElementById('contrast').value) || 100;
      var s = parseInt(document.getElementById('saturation').value) || 100;
      videoPlayer.style.filter = 'brightness(' + (b / 100) + ') contrast(' + (c / 100) + ') saturate(' + (s / 100) + ')';
    }

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

    // Music library filter buttons
    document.querySelectorAll('[data-music-filter]').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('[data-music-filter]').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        loadMusicLibrary(this.dataset.musicFilter);
      });
    });

    // Initialize music library
    let selectedMusicFile = null;
    let currentPreviewAudio = null;
    let currentCategory = 'all';

    async function loadMusicLibrary(category = 'all', searchQuery = '') {
      currentCategory = category;
      const listContainer = document.getElementById('musicList');
      listContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:1rem"><span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.2);border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite;margin-right:.5rem;vertical-align:middle"></span>Loading music...</div>';

      try {
        let url = '/video-editor/search-music?category=' + encodeURIComponent(category);
        if (searchQuery) url += '&q=' + encodeURIComponent(searchQuery);

        const response = await fetch(url);
        const data = await response.json();

        if (!data.tracks || data.tracks.length === 0) {
          listContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:1rem">No tracks found. Try a different search or category.</div>';
          return;
        }

        listContainer.innerHTML = data.tracks.map(track => {
          const hasPreview = track.previewUrl || track.downloadUrl;
          const previewBtn = hasPreview
            ? '<button style="padding:.4rem .8rem;background:rgba(108,58,237,0.2);border:1px solid var(--primary);color:var(--primary);border-radius:4px;font-size:.7rem;cursor:pointer;white-space:nowrap" onclick="event.stopPropagation();previewMusicTrack(this, \\'' + (track.previewUrl || track.downloadUrl || '').replace(/'/g, "\\\\'") + '\\')">\\u{1F50A} Preview</button>'
            : '<span style="font-size:.7rem;color:var(--text-muted)">Upload only</span>';
          const artistInfo = track.artist ? '<span style="margin-left:.5rem;font-size:.7rem;color:var(--text-muted)">by ' + track.artist + '</span>' : '';
          return '<div style="display:flex;align-items:center;gap:.5rem;padding:.6rem;background:var(--dark);border-radius:6px;margin-bottom:.4rem;border:1px solid rgba(255,255,255,0.1);cursor:pointer" data-track-id="' + track.id + '" onclick="selectMusicTrack(this, \\'' + track.name.replace(/'/g, "\\\\'") + '\\', \\'' + track.id + '\\', \\'' + (track.downloadUrl || track.previewUrl || '').replace(/'/g, "\\\\'") + '\\')">' +
            '<div style="flex:1">' +
              '<div style="font-size:.85rem;color:var(--text);font-weight:500">' + track.name + artistInfo + '</div>' +
              '<div style="font-size:.75rem;color:var(--text-muted)">' + track.duration + '</div>' +
            '</div>' +
            previewBtn +
          '</div>';
        }).join('');

        if (data.source === 'fallback') {
          listContainer.innerHTML += '<div style="text-align:center;color:var(--text-muted);font-size:.75rem;padding:.5rem;margin-top:.5rem;border-top:1px solid rgba(255,255,255,0.05)">Upload your own music or set PIXABAY_API_KEY for full library</div>';
        }
      } catch (error) {
        listContainer.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:.85rem;padding:1rem">Failed to load music. Try uploading your own.</div>';
      }
    }

    window.selectMusicTrack = function(element, trackName, trackId, downloadUrl) {
      document.querySelectorAll('[data-track-id]').forEach(function(el) { el.style.borderColor = 'rgba(255,255,255,0.1)'; });
      element.style.borderColor = 'var(--primary)';
      selectedMusicFile = { id: trackId, name: trackName, downloadUrl: downloadUrl || null };
      document.getElementById('addMusicButton').disabled = false;
      showToast('Selected: ' + trackName, 'success');
    };

    window.previewMusicTrack = function(btnElement, previewUrl) {
      if (!previewUrl) {
        showToast('No preview available for this track', 'error');
        return;
      }

      // Stop any currently playing preview
      if (currentPreviewAudio) {
        currentPreviewAudio.pause();
        currentPreviewAudio = null;
        // Reset all preview buttons
        document.querySelectorAll('[data-track-id] button').forEach(function(b) {
          if (b.textContent.includes('Stop')) b.innerHTML = '\\u{1F50A} Preview';
        });
      }

      if (btnElement.textContent.includes('Stop')) {
        btnElement.innerHTML = '\\u{1F50A} Preview';
        return;
      }

      currentPreviewAudio = new Audio(previewUrl);
      currentPreviewAudio.volume = 0.5;
      currentPreviewAudio.play().catch(function() {
        showToast('Could not play preview', 'error');
      });
      btnElement.innerHTML = '\\u{23F9} Stop';

      currentPreviewAudio.addEventListener('ended', function() {
        btnElement.innerHTML = '\\u{1F50A} Preview';
        currentPreviewAudio = null;
      });
    };

    // Custom music file upload
    document.getElementById('customMusicFile').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        selectedMusicFile = { name: file.name, file: file };
        document.getElementById('addMusicButton').disabled = false;
        showToast('Selected: ' + file.name, 'success');
      }
    });

    // Music search with debounce
    let musicSearchTimeout = null;
    document.getElementById('musicSearch').addEventListener('input', function() {
      const query = this.value.trim();
      clearTimeout(musicSearchTimeout);
      musicSearchTimeout = setTimeout(function() {
        loadMusicLibrary(currentCategory, query);
      }, 500);
    });

    // Load default music library on page load
    loadMusicLibrary('all');


    // Aspect Ratio handler
    document.getElementById('aspectRatioSelect').addEventListener('change', async function() {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }
      const ratio = this.value;
      const button = this;
      button.disabled = true;

      try {
        const response = await fetch('/video-editor/change-aspect-ratio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            aspectRatio: ratio
          })
        });

        if (!response.ok) throw new Error('Aspect ratio change failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        showToast('Aspect ratio changed to ' + ratio, 'success');
      } catch (error) {
        showToast('Failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    // Layout Mode handler
    document.getElementById('layoutSelect').addEventListener('change', async function() {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }
      const layout = this.value;
      const button = this;
      button.disabled = true;

      try {
        const response = await fetch('/video-editor/apply-layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            layout: layout
          })
        });

        if (!response.ok) throw new Error('Layout change failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        showToast('Layout changed to ' + layout, 'success');
      } catch (error) {
        showToast('Failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    // Transition buttons
    let selectedTransition = 'none';
    document.querySelectorAll('.transition-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.transition-btn').forEach(b => b.style.borderColor = 'rgba(255,255,255,0.1)');
        this.style.borderColor = 'var(--primary)';
        selectedTransition = this.dataset.transition;
      });
    });

    // Transition duration slider
    document.getElementById('transitionDuration').addEventListener('input', function() {
      document.getElementById('transitionDurationValue').textContent = this.value + 's';
    });

    // Apply transitions handler
    document.getElementById('applyTransitionButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const autoTransitions = document.getElementById('autoTransitions').checked;
      const duration = parseFloat(document.getElementById('transitionDuration').value) || 0.5;

      const button = document.getElementById('applyTransitionButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Applying...';

      try {
        const response = await fetch('/video-editor/apply-transition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            transitionType: selectedTransition,
            duration: duration,
            autoTransitions: autoTransitions
          })
        });

        if (!response.ok) throw new Error('Apply transition failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        showToast('Transitions applied successfully!', 'success');
      } catch (error) {
        showToast('Failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = 'Apply Transitions';
      }
    });

    // === AI Captions inline panel ===
    var selectedCaptionStyle = 'karaoke';
    var captionPosition = 'bottom';

    window.selectCaptionStyle = function(el, style) {
      document.querySelectorAll('.caption-style-option').forEach(function(opt) {
        opt.style.borderColor = 'rgba(255,255,255,0.1)';
      });
      el.style.borderColor = 'var(--primary)';
      selectedCaptionStyle = style;
    };

    window.setCaptionPosition = function(pos, el) {
      document.querySelectorAll('#captionsPanel .filter-btn').forEach(function(b) { b.classList.remove('selected'); });
      el.classList.add('selected');
      captionPosition = pos;
    };

    document.getElementById('applyCaptionsBtn').addEventListener('click', async function() {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      var btn = this;
      var progressDiv = document.getElementById('captionProgress');
      var progressBar = document.getElementById('captionProgressBar');
      var progressText = document.getElementById('captionProgressText');

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Processing...';
      progressDiv.style.display = 'block';
      progressBar.style.width = '10%';
      progressText.textContent = 'Extracting speech with Whisper AI...';

      try {
        // Step 1: Extract transcript
        setTimeout(function() { progressBar.style.width = '30%'; }, 1000);
        setTimeout(function() { progressBar.style.width = '50%'; progressText.textContent = 'Generating captions...'; }, 3000);
        setTimeout(function() { progressBar.style.width = '70%'; progressText.textContent = 'Burning captions into video...'; }, 6000);

        var response = await fetch('/video-editor/apply-captions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoFilename: currentVideoFile.filename,
            style: selectedCaptionStyle,
            position: captionPosition
          })
        });

        if (!response.ok) {
          var errData = await response.json().catch(function() { return {}; });
          throw new Error(errData.error || 'Caption generation failed');
        }

        progressBar.style.width = '100%';
        progressText.textContent = 'Done!';

        var data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        initTimeline();

        showToast('Captions applied successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '💬 Generate & Apply Captions';
        setTimeout(function() { progressDiv.style.display = 'none'; progressBar.style.width = '0%'; }, 2000);
      }
    });


        // === PROFESSIONAL TIMELINE ===
    var timelineState = {
      trimStart: 0,
      trimEnd: 0,
      isDragging: false,
      dragType: null, // 'playhead', 'trimLeft', 'trimRight'
      musicTrack: null
    };

    function initTimeline() {
      if (!videoDuration || videoDuration <= 0) return;
      timelineState.trimEnd = videoDuration;

      var tracksEl = document.getElementById('timelineTracks');
      var rulerEl = document.getElementById('timelineRuler');
      var emptyEl = document.getElementById('timelineEmpty');
      if (emptyEl) emptyEl.style.display = 'none';

      // Build ruler marks
      rulerEl.innerHTML = '';
      var interval = videoDuration <= 30 ? 5 : videoDuration <= 120 ? 10 : 30;
      for (var t = 0; t <= videoDuration; t += interval) {
        var pct = (t / videoDuration) * 100;
        var mark = document.createElement('div');
        mark.className = 'timeline-ruler-mark';
        mark.style.left = 'calc(40px + ' + pct + '% * (100% - 48px) / 100%)';
        mark.style.left = (40 + pct * (tracksEl.offsetWidth - 48) / 100) + 'px';
        var mins = Math.floor(t / 60);
        var secs = String(Math.floor(t % 60)).padStart(2, '0');
        mark.textContent = mins + ':' + secs;
        rulerEl.appendChild(mark);
      }

      // Build video track
      var existingVideo = document.getElementById('timelineVideoTrack');
      if (existingVideo) existingVideo.remove();

      var videoTrack = document.createElement('div');
      videoTrack.className = 'timeline-track';
      videoTrack.id = 'timelineVideoTrack';

      var durMins = Math.floor(videoDuration / 60);
      var durSecs = String(Math.floor(videoDuration % 60)).padStart(2, '0');
      var durStr = (durMins > 0 ? durMins + ':' : '0:') + durSecs;

      videoTrack.innerHTML = '<div class="timeline-track-label">' +
        '<span style="font-size:0.65rem;opacity:0.7;text-transform:uppercase;letter-spacing:0.5px">Video</span>' +
        '</div>' +
        '<div class="timeline-track-content" id="videoTrackContent">' +
          '<div class="timeline-trim-overlay" id="trimOverlayLeft" style="left:0;width:0"></div>' +
          '<div class="timeline-video-bar" id="videoBar">' +
            '<div class="thumb-strip" id="thumbStrip"></div>' +
            '<div class="track-info-overlay">' +
              '<span class="track-duration" style="font-size:.6rem;opacity:0.6">' + durStr + '</span>' +
            '</div>' +
            '<div class="timeline-trim-handle left" id="trimHandleLeft"></div>' +
            '<div class="timeline-trim-handle right" id="trimHandleRight"></div>' +
          '</div>' +
          '<div class="timeline-trim-overlay" id="trimOverlayRight" style="right:0;width:0"></div>' +
        '</div>';

      var playhead = document.getElementById('timelinePlayhead');
      tracksEl.insertBefore(videoTrack, playhead.nextSibling);

      // Build audio waveform track
      var existingAudio = document.getElementById('timelineAudioTrack');
      if (existingAudio) existingAudio.remove();

      var audioTrack = document.createElement('div');
      audioTrack.className = 'timeline-track';
      audioTrack.id = 'timelineAudioTrack';
      audioTrack.innerHTML = '<div class="timeline-track-label">' +
        '<span style="font-size:0.65rem;opacity:0.7;text-transform:uppercase;letter-spacing:0.5px">Audio</span>' +
        '</div>' +
        '<div class="timeline-track-content">' +
          '<div class="timeline-audio-bar" id="audioBar">' +
            '<canvas id="waveformCanvas" style="width:100%;height:100%"></canvas>' +
          '</div>' +
        '</div>';
      tracksEl.appendChild(audioTrack);

      // Click on track to seek
      document.getElementById('videoTrackContent').addEventListener('mousedown', function(e) {
        if (e.target.classList.contains('timeline-trim-handle')) return;
        var rect = this.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        videoPlayer.currentTime = pct * videoDuration;
      });

      setupTrimHandles();
      startPlayheadLoop();

      // Fetch and render timeline thumbnails
      fetchTimelineThumbs(currentVideoFile.filename);
      // Fetch and render audio waveform
      fetchAudioWaveform(currentVideoFile.filename);
    }

    function fetchTimelineThumbs(filename) {
      fetch('/video-editor/timeline-frames?filename=' + encodeURIComponent(filename))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.frames || !data.frames.length) return;
          var strip = document.getElementById('thumbStrip');
          if (!strip) return;
          strip.innerHTML = '';
          data.frames.forEach(function(src) {
            var img = document.createElement('img');
            img.src = src;
            img.style.height = '100%';
            img.style.width = 'auto';
            img.style.objectFit = 'cover';
            img.style.flexShrink = '0';
            img.style.minWidth = '0';
            strip.appendChild(img);
          });
          // Make images fill the bar evenly
          var barWidth = strip.parentElement.offsetWidth;
          var imgWidth = Math.ceil(barWidth / data.frames.length);
          strip.querySelectorAll('img').forEach(function(img) {
            img.style.width = imgWidth + 'px';
          });
        })
        .catch(function() {});
    }

    function fetchAudioWaveform(filename) {
      fetch('/video-editor/audio-waveform?filename=' + encodeURIComponent(filename))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.peaks || !data.peaks.length) return;
          drawWaveform('waveformCanvas', data.peaks);
        })
        .catch(function() {});
    }

    function drawWaveform(canvasId, peaks) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var container = canvas.parentElement;
      canvas.width = container.offsetWidth * (window.devicePixelRatio || 1);
      canvas.height = container.offsetHeight * (window.devicePixelRatio || 1);
      canvas.style.width = container.offsetWidth + 'px';
      canvas.style.height = container.offsetHeight + 'px';
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      var w = container.offsetWidth;
      var h = container.offsetHeight;
      var barW = Math.max(1.5, (w / peaks.length) - 0.5);
      var gap = 0.5;

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < peaks.length; i++) {
        var val = peaks[i];
        var peakH = Math.max(1, val * h * 0.9);
        var x = i * (barW + gap);
        var y = (h - peakH) / 2;

        // Color based on audio level: silence=dim, speech=blue, loud/music=bright cyan
        if (val < 0.05) {
          ctx.fillStyle = 'rgba(100,116,139,0.3)'; // Silence — dim gray
        } else if (val < 0.35) {
          // Low-moderate: speech range — blue gradient
          var t = (val - 0.05) / 0.3;
          var r = Math.round(59 + t * 10);
          var g = Math.round(130 + t * 40);
          var b = Math.round(200 + t * 46);
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.85)';
        } else {
          // Loud: music/emphasis — bright cyan-blue
          var t2 = Math.min(1, (val - 0.35) / 0.65);
          var r2 = Math.round(56 - t2 * 20);
          var g2 = Math.round(189 + t2 * 30);
          var b2 = Math.round(248);
          ctx.fillStyle = 'rgba(' + r2 + ',' + g2 + ',' + b2 + ',0.95)';
        }

        // Rounded bars for premium look
        var radius = Math.min(barW / 2, 1.5);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + barW - radius, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
        ctx.lineTo(x + barW, y + peakH - radius);
        ctx.quadraticCurveTo(x + barW, y + peakH, x + barW - radius, y + peakH);
        ctx.lineTo(x + radius, y + peakH);
        ctx.quadraticCurveTo(x, y + peakH, x, y + peakH - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
      }

      // Draw center line for visual reference (very subtle)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }

    // Smooth playhead using requestAnimationFrame (no stutter)
    var playheadRAF = null;
    var playheadDragging = false;

    function startPlayheadLoop() {
      function tick() {
        if (!videoDuration || videoDuration <= 0) { playheadRAF = requestAnimationFrame(tick); return; }
        var trackContent = document.getElementById('videoTrackContent');
        var playhead = document.getElementById('timelinePlayhead');
        if (!trackContent || !playhead) { playheadRAF = requestAnimationFrame(tick); return; }
        // SKIP position update while user is dragging — let the drag handler control position
        if (!playheadDragging) {
          var pct = videoPlayer.currentTime / videoDuration;
          var trackRect = trackContent.getBoundingClientRect();
          var containerRect = document.getElementById('timelineTracks').getBoundingClientRect();
          var left = (trackRect.left - containerRect.left) + pct * trackRect.width;
          playhead.style.left = left + 'px';
        }
        playheadRAF = requestAnimationFrame(tick);
      }
      if (playheadRAF) cancelAnimationFrame(playheadRAF);
      playheadRAF = requestAnimationFrame(tick);
    }

    function updatePlayhead() {
      // Kept for compatibility but playhead now uses RAF loop
    }

    // Helper: compute playhead left px from a mouse event
    function computePlayheadLeft(clientX) {
      var trackContent = document.getElementById('videoTrackContent');
      if (!trackContent) return null;
      var trackRect = trackContent.getBoundingClientRect();
      var containerRect = document.getElementById('timelineTracks').getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - trackRect.left) / trackRect.width));
      return {
        left: (trackRect.left - containerRect.left) + pct * trackRect.width,
        pct: pct
      };
    }

    // Draggable playhead for scrubbing — uses hitbox for easier grabbing
    var dragPct = 0; // Track position during drag

    document.addEventListener('mousedown', function(e) {
      var hitbox = document.getElementById('playheadHitbox');
      var playhead = document.getElementById('timelinePlayhead');
      if (!hitbox && !playhead) return;
      if (e.target === hitbox || e.target === playhead || (hitbox && hitbox.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        playheadDragging = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }
    }, true);

    document.addEventListener('mousemove', function(e) {
      if (!playheadDragging || !videoDuration) return;
      e.preventDefault();
      var result = computePlayheadLeft(e.clientX);
      if (!result) return;
      dragPct = result.pct;
      // Move playhead visually IMMEDIATELY — don't wait for video seek
      var playhead = document.getElementById('timelinePlayhead');
      if (playhead) playhead.style.left = result.left + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (playheadDragging) {
        // Now actually seek the video to the final position
        if (videoDuration) {
          videoPlayer.currentTime = dragPct * videoDuration;
        }
        playheadDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Also: click anywhere on the timeline tracks area to move playhead
    document.getElementById('timelineTracks').addEventListener('mousedown', function(e) {
      if (playheadDragging) return;
      if (e.target.classList.contains('timeline-trim-handle')) return;
      if (!videoDuration) return;
      var result = computePlayheadLeft(e.clientX);
      if (!result) return;
      var trackContent = document.getElementById('videoTrackContent');
      if (!trackContent) return;
      var rect = trackContent.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right) return;
      dragPct = result.pct;
      // Move playhead visually immediately
      var playhead = document.getElementById('timelinePlayhead');
      if (playhead) playhead.style.left = result.left + 'px';
      // Seek the video
      videoPlayer.currentTime = dragPct * videoDuration;
      // Start dragging so user can keep moving after click
      playheadDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    // Start playhead animation loop
    startPlayheadLoop();

    function setupTrimHandles() {
      var leftHandle = document.getElementById('trimHandleLeft');
      var rightHandle = document.getElementById('trimHandleRight');
      var trackContent = document.getElementById('videoTrackContent');

      function startDrag(type, e) {
        e.preventDefault();
        e.stopPropagation();
        timelineState.isDragging = true;
        timelineState.dragType = type;
        document.body.style.cursor = 'col-resize';

        function onMove(ev) {
          var rect = trackContent.getBoundingClientRect();
          var pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          var time = pct * videoDuration;

          if (type === 'trimLeft') {
            timelineState.trimStart = Math.min(time, timelineState.trimEnd - 0.5);
            document.getElementById('startTime').value = Math.round(timelineState.trimStart);
            var leftPct = (timelineState.trimStart / videoDuration) * 100;
            document.getElementById('trimOverlayLeft').style.width = leftPct + '%';
          } else {
            timelineState.trimEnd = Math.max(time, timelineState.trimStart + 0.5);
            document.getElementById('endTime').value = Math.round(timelineState.trimEnd);
            var rightPct = ((videoDuration - timelineState.trimEnd) / videoDuration) * 100;
            document.getElementById('trimOverlayRight').style.width = rightPct + '%';
          }
        }

        function onUp() {
          timelineState.isDragging = false;
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }

      if (leftHandle) leftHandle.addEventListener('mousedown', function(e) { startDrag('trimLeft', e); });
      if (rightHandle) rightHandle.addEventListener('mousedown', function(e) { startDrag('trimRight', e); });
    }

    function addMusicToTimeline(musicName, volume) {
      var existingMusic = document.getElementById('timelineMusicTrack');
      if (existingMusic) existingMusic.remove();

      var tracksEl = document.getElementById('timelineTracks');
      var musicTrack = document.createElement('div');
      musicTrack.className = 'timeline-track';
      musicTrack.id = 'timelineMusicTrack';

      musicTrack.innerHTML = '<div class="timeline-track-label">🎵</div>' +
        '<div class="timeline-track-content">' +
          '<div class="timeline-music-bar">' +
            '<span class="track-info">' + musicName + '</span>' +
            '<span class="track-volume">' + (volume || '30') + '%</span>' +
            '<canvas class="waveform-bg" id="musicWaveformCanvas"></canvas>' +
          '</div>' +
        '</div>';

      tracksEl.appendChild(musicTrack);
      drawFakeWaveform('musicWaveformCanvas');
      timelineState.musicTrack = musicName;
    }

    function drawFakeWaveform(canvasId) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
      ctx.fillStyle = 'rgba(147,197,253,0.5)';
      var barWidth = 3;
      var gap = 2;
      for (var x = 0; x < canvas.width; x += barWidth + gap) {
        var h = Math.random() * canvas.height * 0.8 + canvas.height * 0.1;
        var y = (canvas.height - h) / 2;
        ctx.fillRect(x, y, barWidth, h);
      }
    }

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

    // Speed handler — always applies speed relative to the ORIGINAL upload
    document.getElementById('speedButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const speed = parseFloat(document.getElementById('speedSelect').value);

      // If 1x selected, just revert to original video (no FFmpeg needed)
      if (speed === 1) {
        if (originalVideoFile) {
          currentVideoFile = { ...originalVideoFile };
          videoPlayer.src = originalVideoFile.serveUrl;
          videoDuration = originalVideoFile.duration || videoDuration;
          initTimeline();
          showToast('Speed reset to normal', 'success');
        }
        return;
      }

      const button = document.getElementById('speedButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        // Always use the original file so speed changes are absolute, not cumulative
        var sourceFilename = originalVideoFile ? originalVideoFile.filename : currentVideoFile.filename;

        const response = await fetch('/video-editor/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: sourceFilename,
            speed: speed
          })
        });

        if (!response.ok) throw new Error('Speed adjustment failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        initTimeline();

        showToast('Speed adjusted to ' + speed + 'x!', 'success');
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

    // Voice Transform: source toggle
    document.querySelectorAll('input[name="vtSource"]').forEach(radio => {
      radio.addEventListener('change', function() {
        document.getElementById('vtSourceVideoLabel').style.borderColor = this.value === 'video' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('vtSourceUploadLabel').style.borderColor = this.value === 'upload' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('vtUploadArea').style.display = this.value === 'upload' ? 'block' : 'none';
      });
    });
    document.getElementById('vtAudioFile').addEventListener('change', function(e) {
      if (e.target.files.length > 0) {
        document.getElementById('vtAudioFileName').textContent = '🎵 ' + e.target.files[0].name;
        document.getElementById('vtAudioFileName').style.display = 'block';
      }
    });
    document.getElementById('vtStability').addEventListener('input', function() {
      document.getElementById('vtStabilityValue').textContent = this.value + '%';
    });
    document.getElementById('vtSimilarity').addEventListener('input', function() {
      document.getElementById('vtSimilarityValue').textContent = this.value + '%';
    });

    // Voice Transform: apply handler
    document.getElementById('vtApplyBtn').addEventListener('click', async () => {
      if (!currentVideoFile) { showToast('Please upload a video first', 'error'); return; }

      var vtSource = document.querySelector('input[name="vtSource"]:checked').value;
      var voiceId = document.getElementById('vtVoiceSelect').value;
      var stability = parseInt(document.getElementById('vtStability').value) / 100;
      var similarity = parseInt(document.getElementById('vtSimilarity').value) / 100;

      var btn = document.getElementById('vtApplyBtn');
      var progress = document.getElementById('vtProgress');
      var progressBar = document.getElementById('vtProgressBar');
      var progressText = document.getElementById('vtProgressText');

      // Build form data
      var formData = new FormData();
      formData.append('filename', currentVideoFile.filename);
      formData.append('voiceId', voiceId);
      formData.append('stability', stability);
      formData.append('similarity', similarity);
      formData.append('source', vtSource);

      if (vtSource === 'upload') {
        var audioFile = document.getElementById('vtAudioFile').files[0];
        if (!audioFile) { showToast('Please upload an audio file', 'error'); return; }
        formData.append('audioFile', audioFile);
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Transforming...';
      progress.style.display = 'block';
      progressBar.style.width = '10%';
      progressText.textContent = 'Extracting audio...';

      try {
        // Simulate progress stages
        setTimeout(() => { progressBar.style.width = '30%'; progressText.textContent = 'Sending to ElevenLabs...'; }, 2000);
        setTimeout(() => { progressBar.style.width = '60%'; progressText.textContent = 'Transforming voice...'; }, 5000);
        setTimeout(() => { progressBar.style.width = '80%'; progressText.textContent = 'Mixing audio back...'; }, 8000);

        var response = await fetch('/video-editor/voice-transform', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Voice transform failed');
        }

        var data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        progressBar.style.width = '100%';
        progressText.textContent = 'Voice transformed successfully!';
        showToast('Voice transformed successfully!', 'success');
      } catch (error) {
        showToast('Voice transform failed: ' + error.message, 'error');
        progressText.textContent = 'Failed: ' + error.message;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔄 Transform Voice';
        setTimeout(() => { progress.style.display = 'none'; }, 3000);
      }
    });

    // Voice Transform: preview handler
    document.getElementById('vtPreviewBtn').addEventListener('click', async () => {
      if (!currentVideoFile) { showToast('Please upload a video first', 'error'); return; }
      var btn = document.getElementById('vtPreviewBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating preview...';

      try {
        var vtSource = document.querySelector('input[name="vtSource"]:checked').value;
        var voiceId = document.getElementById('vtVoiceSelect').value;
        var stability = parseInt(document.getElementById('vtStability').value) / 100;
        var similarity = parseInt(document.getElementById('vtSimilarity').value) / 100;

        var formData = new FormData();
        formData.append('filename', currentVideoFile.filename);
        formData.append('voiceId', voiceId);
        formData.append('stability', stability);
        formData.append('similarity', similarity);
        formData.append('source', vtSource);
        formData.append('previewOnly', 'true');

        if (vtSource === 'upload') {
          var audioFile = document.getElementById('vtAudioFile').files[0];
          if (!audioFile) { showToast('Please upload an audio file', 'error'); return; }
          formData.append('audioFile', audioFile);
        }

        var response = await fetch('/video-editor/voice-transform', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Preview failed');
        }

        var data = await response.json();
        // Play the preview audio
        var audio = new Audio(data.previewUrl);
        audio.play();
        showToast('Playing voice preview...', 'success');
      } catch (error) {
        showToast('Preview failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔈 Preview';
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

    // Add Music handler
    document.getElementById('addMusicButton').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      if (!selectedMusicFile) {
        showToast('Please select a music track', 'error');
        return;
      }

      const button = document.getElementById('addMusicButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Adding Music...';

      try {
        const formData = new FormData();
        formData.append('videoFilename', currentVideoFile.filename);
        formData.append('musicVolume', document.getElementById('musicVolume').value / 100);

        if (selectedMusicFile.file) {
          formData.append('musicFile', selectedMusicFile.file);
        } else {
          formData.append('musicTrackId', selectedMusicFile.id);
          if (selectedMusicFile.downloadUrl) {
            formData.append('musicTrackUrl', selectedMusicFile.downloadUrl);
          }
        }

        const response = await fetch('/video-editor/add-music', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) throw new Error('Failed to add music');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;

        addMusicToTimeline(selectedMusicFile.name || 'Music', document.getElementById('musicVolume').value);
        showToast('Music added successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🎵 Add to Video';
      }
    });

    // Remove Filler Words handler
    document.getElementById('removeFillerWordsBtn').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('removeFillerWordsBtn');
      const progressDiv = document.getElementById('fillerWordsProgress');
      const progressBar = document.getElementById('fillerWordsProgressBar');

      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing';
      progressDiv.style.display = 'block';
      progressBar.style.width = '0%';

      try {
        const response = await fetch('/video-editor/remove-filler-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoFilename: currentVideoFile.filename
          })
        });

        if (!response.ok) throw new Error('Processing failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;
        progressBar.style.width = '100%';

        showToast('Filler words removed successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = 'Process';
        setTimeout(() => {
          progressDiv.style.display = 'none';
        }, 2000);
      }
    });

    // Remove Pauses handler
    document.getElementById('removePausesBtn').addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('removePausesBtn');
      const progressDiv = document.getElementById('pausesProgress');
      const progressBar = document.getElementById('pausesProgressBar');

      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing';
      progressDiv.style.display = 'block';
      progressBar.style.width = '0%';

      try {
        const response = await fetch('/video-editor/remove-silences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoFilename: currentVideoFile.filename
          })
        });

        if (!response.ok) throw new Error('Processing failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;
        progressBar.style.width = '100%';

        showToast('Pauses removed successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = 'Process';
        setTimeout(() => {
          progressDiv.style.display = 'none';
        }, 2000);
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

// GET: Extract timeline thumbnail frames
router.get('/timeline-frames', requireAuth, async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, filename);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not found' });

    const frameCount = 30;
    const framesDir = path.join('/tmp', 'timeline-frames-' + Date.now());
    fs.mkdirSync(framesDir, { recursive: true });

    // Get video duration first
    const durationStr = await new Promise((resolve, reject) => {
      const probe = spawn(ffmpegPath || 'ffmpeg', ['-i', videoPath, '-f', 'null', '-']);
      let stderr = '';
      probe.stderr.on('data', d => stderr += d.toString());
      probe.on('close', () => {
        const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
        if (match) {
          const dur = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
          resolve(dur);
        } else { resolve(0); }
      });
      probe.on('error', () => resolve(0));
    });

    const dur = durationStr || 30;
    // Use select filter to get evenly spaced frames across the ENTIRE video
    const selectExpr = 'select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,' + (dur / frameCount).toFixed(3) + ')';

    // Extract frames using FFmpeg with even spacing
    await new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-vf', selectExpr + ',scale=120:68',
        '-vsync', 'vfr',
        '-frames:v', String(frameCount),
        '-q:v', '5',
        path.join(framesDir, 'frame_%03d.jpg')
      ];
      const proc = spawn(ffmpegPath || 'ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('Frame extraction failed: ' + stderr.slice(-200))));
      proc.on('error', reject);
    });

    // Read frames as base64
    const frames = [];
    for (let i = 1; i <= frameCount; i++) {
      const framePath = path.join(framesDir, 'frame_' + String(i).padStart(3, '0') + '.jpg');
      if (fs.existsSync(framePath)) {
        const data = fs.readFileSync(framePath);
        frames.push('data:image/jpeg;base64,' + data.toString('base64'));
        fs.unlinkSync(framePath);
      }
    }

    // Cleanup
    try { fs.rmdirSync(framesDir); } catch(e) {}

    res.json({ frames });
  } catch (error) {
    console.error('Timeline frames error:', error);
    res.status(500).json({ error: 'Failed to extract frames' });
  }
});

// GET: Extract audio waveform data with RMS energy (shows real speech/music/silence)
router.get('/audio-waveform', requireAuth, async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, filename);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not found' });

    const rawPath = path.join('/tmp', 'waveform-' + Date.now() + '.raw');

    // Extract raw audio at 8kHz mono — enough for accurate energy detection
    await new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-ac', '1',
        '-ar', '8000',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-y',
        rawPath
      ];
      const proc = spawn(ffmpegPath || 'ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Waveform extraction failed'));
      });
      proc.on('error', reject);
    });

    // Read raw audio and compute RMS energy per segment
    const buffer = fs.readFileSync(rawPath);
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    const peakCount = 300; // Higher resolution for better detail
    const samplesPerPeak = Math.max(1, Math.floor(samples.length / peakCount));
    const peaks = [];

    for (let i = 0; i < peakCount; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, samples.length);
      let sumSq = 0;
      let peak = 0;
      for (let j = start; j < end; j++) {
        const val = samples[j] / 32768;
        sumSq += val * val;
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
      }
      // RMS gives true energy level — silence is near 0, speech is moderate, music is high
      const rms = Math.sqrt(sumSq / (end - start));
      // Blend RMS with peak for visual appeal (70% RMS, 30% peak)
      peaks.push(Math.min(1, rms * 0.7 + peak * 0.3));
    }

    // Normalize to use full visual range while keeping silence truly flat
    const maxPeak = Math.max(...peaks, 0.001);
    const silenceThreshold = maxPeak * 0.03; // Below 3% of max = silence
    const normalized = peaks.map(p => {
      if (p < silenceThreshold) return 0.02; // Tiny flat line for silence
      return Math.min(1, (p / maxPeak) * 1.1); // Scale up for visual clarity
    });

    try { fs.unlinkSync(rawPath); } catch(e) {}

    res.json({ peaks: normalized });
  } catch (error) {
    console.error('Waveform error:', error);
    res.status(500).json({ error: 'Failed to extract waveform' });
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

// POST: Voice Transform (Speech-to-Speech via ElevenLabs)
const vtUpload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|ogg|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio file type'));
    }
  }
});

router.post('/voice-transform', requireAuth, vtUpload.single('audioFile'), async (req, res) => {
  let tempFiles = [];
  try {
    const { filename, voiceId, stability, similarity, source, previewOnly } = req.body;
    if (!filename) return res.status(400).json({ error: 'Missing video filename' });

    const apiKey = await getElevenLabsKey(req.user.id);
    if (!apiKey) {
      return res.status(400).json({ error: 'No ElevenLabs API key found. Add one in Smart Shorts → Settings or Brand Voice settings.' });
    }

    // Find source video
    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    let audioInputPath;

    if (source === 'upload' && req.file) {
      // User uploaded a separate audio file
      audioInputPath = req.file.path;
      tempFiles.push(audioInputPath);
    } else {
      // Extract audio from video using FFmpeg
      audioInputPath = path.join(outputDir, 'vt_extract_' + Date.now() + '.wav');
      tempFiles.push(audioInputPath);

      await runFFmpeg([
        '-i', videoPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '1',
        '-y',
        audioInputPath
      ]);

      if (!fs.existsSync(audioInputPath) || fs.statSync(audioInputPath).size < 1000) {
        return res.status(400).json({ error: 'Failed to extract audio from video. Make sure the video has an audio track.' });
      }
    }

    // For preview, only send first 15 seconds
    let audioToSend = audioInputPath;
    if (previewOnly === 'true') {
      const previewAudioPath = path.join(outputDir, 'vt_preview_in_' + Date.now() + '.wav');
      tempFiles.push(previewAudioPath);
      await runFFmpeg([
        '-i', audioInputPath,
        '-t', '15',
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '1',
        '-y',
        previewAudioPath
      ]);
      audioToSend = previewAudioPath;
    }

    // Read audio file
    const audioBuffer = fs.readFileSync(audioToSend);

    // Call ElevenLabs Speech-to-Speech API
    console.log('[Voice Transform] Sending to ElevenLabs STS, voice:', voiceId, 'audio size:', audioBuffer.length);
    const selectedVoiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
    const stabilityVal = parseFloat(stability) || 0.5;
    const similarityVal = parseFloat(similarity) || 0.75;

    const transformedAudio = await new Promise((resolve, reject) => {
      const https = require('https');
      const boundary = '----FormBoundary' + Date.now();

      // Build multipart form data manually
      let bodyParts = [];

      // Add audio file part
      bodyParts.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\n' +
        'Content-Type: audio/wav\r\n\r\n'
      ));
      bodyParts.push(audioBuffer);
      bodyParts.push(Buffer.from('\r\n'));

      // Add model_id part
      bodyParts.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="model_id"\r\n\r\n' +
        'eleven_english_sts_v2\r\n'
      ));

      // Add voice_settings part
      bodyParts.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="voice_settings"\r\n\r\n' +
        JSON.stringify({ stability: stabilityVal, similarity_boost: similarityVal }) + '\r\n'
      ));

      bodyParts.push(Buffer.from('--' + boundary + '--\r\n'));

      const body = Buffer.concat(bodyParts);

      const options = {
        hostname: 'api.elevenlabs.io',
        port: 443,
        path: '/v1/speech-to-speech/' + selectedVoiceId,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length,
          'Accept': 'audio/mpeg'
        }
      };

      const request = https.request(options, (response) => {
        if (response.statusCode !== 200) {
          let errData = '';
          response.on('data', d => { errData += d.toString(); });
          response.on('end', () => {
            try {
              const parsed = JSON.parse(errData);
              reject(new Error(parsed.detail?.message || parsed.detail || 'ElevenLabs STS API error: ' + response.statusCode));
            } catch(e) {
              reject(new Error('ElevenLabs STS API error: ' + response.statusCode + ' - ' + errData.slice(0, 200)));
            }
          });
          return;
        }
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      });

      request.on('error', reject);
      request.write(body);
      request.end();

      // Timeout
      setTimeout(() => {
        request.destroy();
        reject(new Error('ElevenLabs STS request timed out (120s)'));
      }, 120000);
    });

    console.log('[Voice Transform] ElevenLabs returned', transformedAudio.length, 'bytes of audio');

    // Save transformed audio
    const transformedAudioPath = path.join(outputDir, 'vt_transformed_' + Date.now() + '.mp3');
    tempFiles.push(transformedAudioPath);
    fs.writeFileSync(transformedAudioPath, transformedAudio);

    // For preview, just return the audio file URL
    if (previewOnly === 'true') {
      const previewFilename = 'vt_preview_' + Date.now() + '_' + req.user.id + '.mp3';
      const previewPath = path.join(outputDir, previewFilename);
      fs.copyFileSync(transformedAudioPath, previewPath);
      // Clean up temp files
      tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
      return res.json({ previewUrl: '/video-editor/download/' + previewFilename });
    }

    // Mix transformed audio back into video (replace original audio)
    const outputFilename = 'voicetransform_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', videoPath,
      '-i', transformedAudioPath,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath
    ]);

    // Clean up temp files
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Voice transform error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message });
  }
});

// GET: Search Pixabay music library
router.get('/search-music', requireAuth, async (req, res) => {
  try {
    const { q, category } = req.query;
    const apiKey = process.env.PIXABAY_API_KEY;

    if (!apiKey) {
      // Return curated fallback tracks when no API key
      const fallbackTracks = {
        all: [
          { id: 'f1', name: 'Ambient Breeze', duration: '3:45', category: 'instrumental', previewUrl: null, downloadUrl: null },
          { id: 'f2', name: 'Upbeat Morning', duration: '2:30', category: 'upbeat', previewUrl: null, downloadUrl: null },
          { id: 'f3', name: 'Chill Vibes', duration: '4:15', category: 'chill', previewUrl: null, downloadUrl: null },
          { id: 'f4', name: 'Epic Drama', duration: '3:20', category: 'dramatic', previewUrl: null, downloadUrl: null },
          { id: 'f5', name: 'Happy Times', duration: '2:50', category: 'happy', previewUrl: null, downloadUrl: null },
          { id: 'f6', name: 'Sad Melody', duration: '3:40', category: 'sad', previewUrl: null, downloadUrl: null }
        ]
      };
      const cat = category || 'all';
      const tracks = cat === 'all' ? fallbackTracks.all : fallbackTracks.all.filter(t => t.category === cat);
      return res.json({ tracks, source: 'fallback', message: 'Set PIXABAY_API_KEY for real music library' });
    }

    // Build Pixabay Music API URL
    const searchQuery = q || (category && category !== 'all' ? category : 'background music');
    const categoryMap = {
      'instrumental': 'backgrounds',
      'upbeat': 'beats',
      'chill': 'backgrounds',
      'dramatic': 'film',
      'happy': 'beats',
      'sad': 'solo'
    };
    const pixCategory = categoryMap[category] || '';

    let url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(searchQuery)}&media_type=music&per_page=20&safesearch=true`;
    if (pixCategory) url += `&category=${pixCategory}`;

    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });

    if (!data.hits || data.hits.length === 0) {
      return res.json({ tracks: [], source: 'pixabay' });
    }

    const tracks = data.hits.map(hit => {
      const mins = Math.floor(hit.duration / 60);
      const secs = String(hit.duration % 60).padStart(2, '0');
      return {
        id: 'px_' + hit.id,
        name: hit.tags ? hit.tags.split(',')[0].trim() : 'Untitled',
        duration: mins + ':' + secs,
        category: category || 'all',
        previewUrl: hit.previewURL || null,
        downloadUrl: hit.audio || hit.previewURL || null,
        artist: hit.user || 'Unknown',
        pixabayUrl: hit.pageURL
      };
    });

    res.json({ tracks, source: 'pixabay' });
  } catch (error) {
    console.error('Search music error:', error);
    res.status(500).json({ error: 'Failed to search music' });
  }
});

// POST: Add music to video
router.post('/add-music', requireAuth, upload.single('musicFile'), async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename, musicVolume, musicTrackId } = req.body;
    const musicVol = parseFloat(musicVolume) || 0.3;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Get video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, videoFilename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get music file
    let musicPath = null;
    if (req.file) {
      musicPath = req.file.path;
      tempFiles.push(musicPath);
    } else if (musicTrackId) {
      // Download music from Pixabay URL passed as musicTrackUrl
      const musicTrackUrl = req.body.musicTrackUrl;
      if (!musicTrackUrl) {
        return res.status(400).json({ error: 'Music track URL required' });
      }
      const https = require('https');
      const http = require('http');
      const tempMusicPath = path.join(uploadDir, 'pixabay_' + Date.now() + '.mp3');
      tempFiles.push(tempMusicPath);
      await new Promise((resolve, reject) => {
        const proto = musicTrackUrl.startsWith('https') ? https : http;
        const file = fs.createWriteStream(tempMusicPath);
        proto.get(musicTrackUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            proto.get(response.headers.location, (r2) => {
              r2.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
          } else {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }
        }).on('error', reject);
      });
      musicPath = tempMusicPath;
    } else {
      return res.status(400).json({ error: 'Music file required' });
    }

    // FFmpeg command to mix audio: [1:a]volume=0.3[music];[0:a][music]amix=inputs=2:duration=first[aout]
    const outputFilename = 'music_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', videoPath,
      '-i', musicPath,
      '-filter_complex', `[1:a]volume=${musicVol}[music];[0:a][music]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Add music error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to add music' });
  }
});

// POST: Remove filler words from video
router.post('/remove-filler-words', requireAuth, async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename } = req.body;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Get video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, videoFilename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // For now, we'll create a placeholder implementation
    // In production, this would use OpenAI Whisper to detect filler words
    // and FFmpeg to cut those segments

    const fillerWords = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'literally'];
    const outputFilename = 'no_filler_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // For demo purposes, we'll just copy the video (real implementation would process audio)
    fs.copyFileSync(videoPath, outputPath);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Remove filler words error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to remove filler words' });
  }
});

// POST: Remove silences from video
router.post('/remove-silences', requireAuth, async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename } = req.body;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Get video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, videoFilename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Use FFmpeg silencedetect filter to find silence segments
    const outputFilename = 'no_silence_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // For demo purposes, we'll just copy the video (real implementation would detect and cut silences)
    // Real FFmpeg command would use: silencedetect=noise=-30dB:d=0.5
    fs.copyFileSync(videoPath, outputPath);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Remove silences error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to remove silences' });
  }
});


// Change Aspect Ratio endpoint
router.post('/change-aspect-ratio', requireAuth, async (req, res) => {
  const { filename, aspectRatio } = req.body;
  if (!filename || !aspectRatio) return res.status(400).json({ error: 'Missing parameters' });

  let videoPath = path.join(outputDir, filename);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(uploadDir, filename);
  }
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const outputFilename = 'aspect_' + aspectRatio.replace(':', '_') + '_' + Date.now() + '_' + req.user.id + '.mp4';
  const outputPath = path.join(outputDir, outputFilename);
  let filterComplex = '';

  try {
    // Parse aspect ratio
    const [w, h] = aspectRatio.split(':').map(Number);
    const targetRatio = w / h;

    // FFmpeg filter for scaling and padding
    filterComplex = `[0:v]scale=iw*min(1\,ih*${targetRatio}/iw):ih*min(1\,iw/(ih*${targetRatio})),pad=max(iw\\,ih*${targetRatio}):max(ih\\,iw/${targetRatio}):(max(iw\\,ih*${targetRatio})-iw)/2:(max(ih\\,iw/${targetRatio})-ih)/2[out]`;

    await runFFmpeg([
      '-i', videoPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
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
    console.error('Aspect ratio error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply Layout endpoint
router.post('/apply-layout', requireAuth, async (req, res) => {
  const { filename, layout } = req.body;
  if (!filename || !layout) return res.status(400).json({ error: 'Missing parameters' });

  let videoPath = path.join(outputDir, filename);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(uploadDir, filename);
  }
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const outputFilename = 'layout_' + layout + '_' + Date.now() + '_' + req.user.id + '.mp4';
  const outputPath = path.join(outputDir, outputFilename);
  let filterComplex = '';

  try {
    switch (layout) {
      case 'fill':
        // Simple crop to 16:9
        filterComplex = '[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[out]';
        break;
      case 'fit':
        // Fit with blurred background
        filterComplex = '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(1920-iw)/2:(1080-ih)/2[fg];[0:v]scale=1920:1080,boxblur=40[bg];[bg][fg]overlay=(1920-w)/2:(1080-h)/2[out]';
        break;
      case 'split':
        // Split screen (top/bottom)
        filterComplex = '[0:v]scale=1920:540[top];[0:v]scale=1920:540[bot];[top][bot]vstack[out]';
        break;
      case 'screenshare':
        // Screen share with webcam in corner
        filterComplex = '[0:v]scale=1600:900[main];[0:v]scale=300:225[cam];[main][cam]overlay=1300:675[out]';
        break;
      case 'gameplay':
        // Gameplay layout (game top, facecam bottom)
        filterComplex = '[0:v]crop=iw:ih*0.6:0:0[game];[0:v]crop=iw:ih*0.4:0:ih*0.6[cam];[game][cam]vstack[out]';
        break;
      default:
        filterComplex = '[0:v]scale=1920:1080[out]';
    }

    await runFFmpeg([
      '-i', videoPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
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
    console.error('Layout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply Transitions endpoint
router.post('/apply-transition', requireAuth, async (req, res) => {
  const { filename, transitionType, duration, autoTransitions } = req.body;
  if (!filename) return res.status(400).json({ error: 'Missing video filename' });

  let videoPath = path.join(outputDir, filename);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(uploadDir, filename);
  }
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const outputFilename = 'transitions_' + (transitionType || 'fade') + '_' + Date.now() + '_' + req.user.id + '.mp4';
  const outputPath = path.join(outputDir, outputFilename);
  const dur = parseFloat(duration) || 0.5;

  try {
    // Map transition types to FFmpeg xfade transitions
    const transitionMap = {
      'fade': 'fade',
      'dissolve': 'dissolve',
      'wipeleft': 'wipeleft',
      'wiperight': 'wiperight',
      'slideright': 'slideright',
      'slideleft': 'slideleft',
      'zoomin': 'zoomin',
      'zoomout': 'zoomout'
    };

    const fxTransition = transitionMap[transitionType] || 'fade';

    // For now, apply simple fade transition at the midpoint
    // Full multi-segment support would require splitting video into segments first
    const videoDur = await getVideoMetadata(videoPath);
    const transitionPoint = Math.max(0, (videoDur.duration * 1000) - (dur * 1000));

    const filterComplex = `[0:v]xfade=transition=${fxTransition}:duration=${dur}:offset=${transitionPoint / 1000}[v];[0:a][0:a]acrossfade=d=${dur}[a]`;

    await runFFmpeg([
      '-i', videoPath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
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
    console.error('Transition error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Apply AI captions to video (inline from video editor)
router.post('/apply-captions', requireAuth, async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename, style, position } = req.body;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Find video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Step 1: Extract audio from video
    const audioPath = path.join('/tmp', 'caption-audio-' + Date.now() + '.wav');
    tempFiles.push(audioPath);

    await runFFmpeg([
      '-i', videoPath,
      '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
      '-y', audioPath
    ]);

    // Step 2: Transcribe with OpenAI Whisper
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularity: 'word'
    });

    if (!transcription.words || transcription.words.length === 0) {
      return res.status(400).json({ error: 'No speech detected in video. Make sure the video has audible speech.' });
    }

    // Step 3: Generate ASS subtitle file
    const assPath = path.join('/tmp', 'captions-' + Date.now() + '.ass');
    tempFiles.push(assPath);

    // Style definitions per preset
    const styleMap = {
      'karaoke': { fontName: 'Arial', fontSize: 16, primaryColor: '&H00FFFFFF&', outlineColor: '&H00000000&', bold: 1, outline: 2, shadow: 1, alignment: 2 },
      'bold-pop': { fontName: 'Arial', fontSize: 20, primaryColor: '&H00EC4899&', outlineColor: '&H00000000&', bold: 1, outline: 3, shadow: 0, alignment: 2 },
      'minimal': { fontName: 'Arial', fontSize: 14, primaryColor: '&H00FFFFFF&', outlineColor: '&H00000000&', bold: 0, outline: 1, shadow: 1, alignment: 2 },
      'neon-glow': { fontName: 'Arial', fontSize: 18, primaryColor: '&H0041FF00&', outlineColor: '&H0041FF00&', bold: 1, outline: 3, shadow: 0, alignment: 2 },
      'mrbeast': { fontName: 'Impact', fontSize: 22, primaryColor: '&H0000D4FF&', outlineColor: '&H00000000&', bold: 1, outline: 4, shadow: 2, alignment: 2 },
      'hormozi': { fontName: 'Arial', fontSize: 18, primaryColor: '&H00FFFFFF&', outlineColor: '&H00000000&', bold: 1, outline: 2, shadow: 1, alignment: 2 }
    };

    const s = styleMap[style] || styleMap['karaoke'];

    // Map position to ASS alignment
    const posMap = { 'top': 8, 'center': 5, 'bottom': 2 };
    const alignment = posMap[position] || 2;

    // Build ASS file
    function toASSTime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const sec = Math.floor(seconds % 60);
      const cs = Math.round((seconds % 1) * 100);
      return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
    }

    let assContent = '[Script Info]\nTitle: AI Captions\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n';
    assContent += '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    assContent += 'Style: Default,' + s.fontName + ',' + s.fontSize + ',' + s.primaryColor + ',&H00FFFFFF&,' + s.outlineColor + ',&H00000000&,' + s.bold + ',0,0,0,100,100,0,0,1,' + s.outline + ',' + s.shadow + ',' + alignment + ',10,10,30,1\n\n';
    assContent += '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

    // Group words into subtitle lines (3-5 words per line)
    const words = transcription.words;
    const wordsPerLine = 4;
    for (let i = 0; i < words.length; i += wordsPerLine) {
      const chunk = words.slice(i, i + wordsPerLine);
      const startTime = chunk[0].start;
      const endTime = chunk[chunk.length - 1].end;

      let text = '';
      if (style === 'karaoke') {
        // Karaoke mode: word-by-word highlight with \k tags
        chunk.forEach(w => {
          const dur = Math.round((w.end - w.start) * 100);
          text += '{\\k' + dur + '}' + w.word + ' ';
        });
      } else {
        text = chunk.map(w => w.word).join(' ');
      }

      assContent += 'Dialogue: 0,' + toASSTime(startTime) + ',' + toASSTime(endTime) + ',Default,,0,0,0,,' + text.trim() + '\n';
    }

    fs.writeFileSync(assPath, assContent);

    // Step 4: Burn captions into video with FFmpeg
    const outputFilename = 'captions_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Escape the ASS path for FFmpeg filter
    const assFilter = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

    await runFFmpeg([
      '-i', videoPath,
      '-vf', 'ass=' + assFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    // Cleanup temp files
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Apply captions error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to apply captions' });
  }
});


module.exports = router;
