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

// Helper: Get video metadata
function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg not found'));
    }

    const ffprobe = spawn(ffmpegPath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1:nokey=1', filePath]);
    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });
    ffprobe.on('close', (code) => {
      if (code === 0) {
        resolve({ duration: parseFloat(output) || 0 });
      } else {
        resolve({ duration: 0 });
      }
    });
    ffprobe.on('error', () => reject(new Error('Failed to get video metadata')));
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
    .timeline-segment:hover{opacity:0.8}
    .trim-handle{position:absolute;top:0;bottom:0;width:8px;background:rgba(255,255,255,0.3);cursor:ew-resize;border-radius:2px}
    .trim-handle.left{left:0}
    .trim-handle.right{right:0}
    .tools-section{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
    .tool-button{padding:.6rem 1.2rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;display:flex;align-items:center;gap:.4rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .tool-button:hover{background:var(--surface);border-color:var(--primary);color:var(--primary)}
    .tool-button.active{background:var(--primary);color:white;border-color:var(--primary)}
    .editor-sidebar{width:320px;display:flex;flex-direction:column;gap:1rem}
    .properties-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem}
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
    .trim-button{width:100%;padding:.6rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:.5rem;transition:all 0.2s}
    .trim-button:hover{box-shadow:0 8px 16px rgba(108,58,237,0.3)}
    .export-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem}
    .dropdown-group{margin-bottom:1.5rem}
    .dropdown-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:block}
    .dropdown{width:100%;padding:.6rem .8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:8px;color:var(--text);font-size:.85rem;outline:none;transition:border-color 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;cursor:pointer}
    .dropdown:hover{border-color:var(--primary)}
    .dropdown:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(108,58,237,0.15)}
    .export-button{width:100%;padding:.8rem;background:var(--primary);color:white;border:1px solid var(--primary);border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem;transition:all 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .export-button:hover{box-shadow:0 8px 24px rgba(108,58,237,0.3)}
    .export-button:disabled{opacity:0.5;cursor:not-allowed}
    .spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .toast{position:fixed;bottom:20px;right:20px;background:var(--surface);border:1px solid var(--border-subtle);border-radius:8px;padding:1rem 1.5rem;font-size:.9rem;z-index:1000;animation:slideIn 0.3s ease-out}
    .toast.success{border-color:#10B981;color:#10B981}
    .toast.error{border-color:#EF4444;color:#EF4444}
    @keyframes slideIn{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}
    .hidden{display:none}
    body.light .video-container{border-color:rgba(108,58,237,0.2);background:rgba(108,58,237,0.02)}
    body.light .timeline-strip{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .properties-panel,body.light .export-panel{background:rgba(108,58,237,0.05);border-color:rgba(108,58,237,0.15)}
    body.light .tool-button{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15);color:var(--text)}
    body.light .tool-button:hover{background:rgba(108,58,237,0.15);border-color:var(--primary)}
    body.light .dropdown{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .slider{background:rgba(108,58,237,0.15)}
    body.light .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.05),rgba(236,72,153,0.05));border-color:rgba(108,58,237,0.3)}
    @media(max-width:1200px){.editor-sidebar{width:280px}}
    @media(max-width:768px){.editor-container{flex-direction:column;height:auto;gap:1rem}.editor-main{min-height:600px}.editor-sidebar{width:100%}.video-preview-area{min-height:250px}.timeline-strip{height:70px}.tools-section{flex-direction:column}.tool-button{width:100%;justify-content:center}}
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
              <div class="timeline-content">
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
              </div>
            </div>

            <div class="tools-section">
              <button class="tool-button active" data-tool="trim">✂️ Trim</button>
              <button class="tool-button" data-tool="split">🔀 Split</button>
              <button class="tool-button" data-tool="text">📝 Text Overlay</button>
              <button class="tool-button" data-tool="transitions">✨ Transitions</button>
              <button class="tool-button" data-tool="filters">🎨 Filters</button>
              <button class="tool-button" data-tool="speed">⚡ Speed</button>
              <button class="tool-button" data-tool="audio">🔊 Audio</button>
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

            <div class="trim-section">
              <div class="panel-title">✂️ Trim Video</div>
              <div class="time-inputs">
                <input type="number" class="time-input" id="startTime" placeholder="Start (sec)" min="0" step="0.1">
                <input type="number" class="time-input" id="endTime" placeholder="End (sec)" min="0" step="0.1">
              </div>
              <button class="trim-button" id="trimButton" disabled>Trim</button>
            </div>
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
      slider.addEventListener('input', function() {
        const valueSpan = this.parentElement.querySelector('.slider-value');
        if (valueSpan) {
          valueSpan.textContent = this.value + '%';
        }
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

    // Tool selection
    document.querySelectorAll('.tool-button').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        var tool = this.dataset.tool;
        if (tool !== 'trim') {
          showToast(this.textContent.trim() + ' — coming soon!', 'info');
        }
      });
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

    const inputPath = path.join(uploadDir, filename);
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
      '-c:a', 'aac',
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

    // Normalize brightness/contrast/saturation (convert from 0-200 to -1 to 1 range for eq filter)
    const b = ((brightness - 100) / 100).toFixed(2);
    const c = ((contrast - 100) / 100).toFixed(2);
    const s = (saturation / 100).toFixed(2);

    const filterComplex = 'eq=brightness=' + b + ':contrast=' + c + ':saturation=' + s + ',scale=' + width + ':' + height;

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
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libx264', '-preset', 'medium', '-c:a', 'aac', '-y', outputPath];
    } else if (format === 'mov') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libx264', '-c:a', 'aac', '-y', outputPath];
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

    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
