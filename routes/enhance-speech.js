const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// FFmpeg path detection
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) { ffmpegPath = localFfmpeg; }
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (e) {} }
if (!ffmpegPath) { try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {} }

// Directory setup
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer configuration
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });

// GET - Main page
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('Enhance Speech');
  const sidebar = getSidebar('enhance-speech', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const pageStyles = `
    <style>
      ${css}
      .content-wrapper {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
      }
      .upload-section {
        background: var(--surface);
        border: 2px dashed rgba(108, 58, 237, 0.3);
        border-radius: 12px;
        padding: 3rem 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
      }
      .upload-section:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.05);
      }
      .upload-section.dragover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
      }
      .upload-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
        opacity: 0.7;
      }
      .upload-text {
        color: var(--text);
        margin-bottom: 0.5rem;
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
      .settings-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
      }
      .setting-group {
        margin-bottom: 1.5rem;
      }
      .setting-group:last-child {
        margin-bottom: 0;
      }
      .setting-label {
        display: block;
        margin-bottom: 0.75rem;
        font-weight: 600;
        color: var(--text);
        font-size: 0.95rem;
      }
      .slider-container {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      input[type="range"] {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: var(--dark-2);
        outline: none;
        -webkit-appearance: none;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--primary);
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(108, 58, 237, 0.4);
      }
      input[type="range"]::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--primary);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 8px rgba(108, 58, 237, 0.4);
      }
      .slider-value {
        min-width: 50px;
        text-align: right;
        color: var(--text-muted);
        font-size: 0.9rem;
      }
      .toggle-switch {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      input[type="checkbox"] {
        width: 44px;
        height: 24px;
        cursor: pointer;
        appearance: none;
        background: var(--dark-2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        position: relative;
        transition: background 0.3s;
      }
      input[type="checkbox"]:checked {
        background: var(--primary);
      }
      input[type="checkbox"]:after {
        content: '';
        position: absolute;
        width: 20px;
        height: 20px;
        border-radius: 10px;
        background: #fff;
        top: 2px;
        left: 2px;
        transition: left 0.3s;
      }
      input[type="checkbox"]:checked:after {
        left: 22px;
      }
      .toggle-label {
        color: var(--text);
      }
      select {
        width: 100%;
        padding: 0.75rem;
        background: var(--dark-2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        font-family: inherit;
        font-size: 0.9rem;
        cursor: pointer;
        transition: border-color 0.3s;
      }
      select:focus {
        outline: none;
        border-color: var(--primary);
      }
      .action-buttons {
        display: flex;
        gap: 1rem;
        margin-top: 2rem;
      }
      .btn-enhance {
        flex: 1;
        background: var(--gradient-1);
        color: #fff;
        padding: 0.9rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 20px rgba(108, 58, 237, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      .btn-enhance:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .btn-enhance:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      .btn-enhance.processing {
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
      .results-section {
        margin-top: 2rem;
        display: none;
      }
      .results-section.show {
        display: block;
      }
      .comparison-container {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
      }
      .comparison-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
        margin-bottom: 2rem;
      }
      .audio-player {
        background: var(--dark-2);
        padding: 1rem;
        border-radius: 8px;
      }
      .player-label {
        color: var(--text-muted);
        font-size: 0.8rem;
        margin-bottom: 0.5rem;
        font-weight: 600;
      }
      .download-btn {
        background: var(--success);
        color: #fff;
        padding: 0.7rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.3s;
        width: 100%;
      }
      .download-btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      .empty-state {
        text-align: center;
        padding: 2rem;
        color: var(--text-muted);
      }
      @media (max-width: 1024px) {
        .content-wrapper {
          grid-template-columns: 1fr;
        }
        .comparison-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 768px) {
        .settings-section {
          padding: 1.5rem;
        }
        .action-buttons {
          flex-direction: column;
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
        <h1>Enhance Speech</h1>
        <p>Remove background noise and enhance voice clarity with AI</p>
      </div>

      <div class="content-wrapper">
        <div class="upload-section" id="uploadSection" onclick="document.getElementById('fileInput').click()">
          <div class="upload-icon">📁</div>
          <div class="upload-text">Drop your audio or video file here</div>
          <div class="upload-subtext">Or click to select • MP3, WAV, MP4, MOV supported</div>
          <input type="file" id="fileInput" class="file-input" accept="audio/*,video/*">
          <div id="fileName" class="file-name" style="display: none;"></div>
        </div>

        <div class="settings-section">
          <div class="setting-group">
            <label class="setting-label">Noise Reduction Level</label>
            <div class="slider-container">
              <input type="range" id="noiseLevel" min="1" max="3" value="2" style="cursor: pointer;">
              <div class="slider-value" id="noiseLabel">Medium</div>
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Voice Enhancement</label>
            <div class="toggle-switch">
              <input type="checkbox" id="voiceBoost" checked>
              <span class="toggle-label">Boost voice clarity</span>
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Output Format</label>
            <select id="outputFormat">
              <option value="original">Original Format</option>
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </select>
          </div>

          <div class="action-buttons">
            <button class="btn-enhance" id="enhanceBtn" disabled>
              Enhance Audio
            </button>
          </div>
        </div>
      </div>

      <div class="results-section" id="resultsSection">
        <h2 style="margin-bottom: 1.5rem; color: var(--text);">Processing Results</h2>
        <div class="comparison-container">
          <div class="comparison-grid">
            <div>
              <div class="player-label">Before Enhancement</div>
              <div class="audio-player">
                <audio id="beforeAudio" controls style="width: 100%; margin-bottom: 0.5rem;"></audio>
              </div>
            </div>
            <div>
              <div class="player-label">After Enhancement</div>
              <div class="audio-player">
                <audio id="afterAudio" controls style="width: 100%; margin-bottom: 0.5rem;"></audio>
              </div>
            </div>
          </div>
          <button class="download-btn" id="downloadBtn">Download Enhanced Audio</button>
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

    const fileInput = document.getElementById('fileInput');
    const uploadSection = document.getElementById('uploadSection');
    const fileName = document.getElementById('fileName');
    const enhanceBtn = document.getElementById('enhanceBtn');
    const resultsSection = document.getElementById('resultsSection');
    const downloadBtn = document.getElementById('downloadBtn');
    let currentDownloadUrl = null;

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const name = e.target.files[0].name;
        fileName.textContent = '📄 ' + name;
        fileName.style.display = 'block';
        enhanceBtn.disabled = false;
      }
    });

    uploadSection.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadSection.classList.add('dragover');
    });

    uploadSection.addEventListener('dragleave', () => {
      uploadSection.classList.remove('dragover');
    });

    uploadSection.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadSection.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        const name = files[0].name;
        fileName.textContent = '📄 ' + name;
        fileName.style.display = 'block';
        enhanceBtn.disabled = false;
      }
    });

    document.getElementById('noiseLevel').addEventListener('change', (e) => {
      const labels = ['Low', 'Medium', 'High'];
      document.getElementById('noiseLabel').textContent = labels[parseInt(e.target.value) - 1];
    });

    enhanceBtn.addEventListener('click', async () => {
      if (!fileInput.files.length) {
        showToast('Please select a file first');
        return;
      }

      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      formData.append('noiseLevel', document.getElementById('noiseLevel').value);
      formData.append('voiceBoost', document.getElementById('voiceBoost').checked);
      formData.append('outputFormat', document.getElementById('outputFormat').value);

      enhanceBtn.disabled = true;
      enhanceBtn.classList.add('processing');
      enhanceBtn.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/enhance-speech/process', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Processing failed');
        }

        document.getElementById('beforeAudio').src = data.originalUrl;
        document.getElementById('afterAudio').src = data.enhancedUrl;
        currentDownloadUrl = data.enhancedUrl;
        resultsSection.classList.add('show');
        showToast('Audio enhanced successfully!');
      } catch (error) {
        showToast('Error: ' + error.message, 4000);
      } finally {
        enhanceBtn.disabled = false;
        enhanceBtn.classList.remove('processing');
        enhanceBtn.textContent = 'Enhance Audio';
      }
    });

    downloadBtn.addEventListener('click', () => {
      if (!currentDownloadUrl) {
        showToast('No file to download');
        return;
      }
      const a = document.createElement('a');
      a.href = currentDownloadUrl;
      a.download = 'enhanced-audio.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// Helper function to process audio with ffmpeg
function processAudioWithFfmpeg(inputPath, outputPath, noiseLevel, voiceBoost) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg not found. Please install FFmpeg.'));
    }

    const noiseFilters = {
      '1': 'afftdn=nf=-25',
      '2': 'afftdn=nf=-40',
      '3': 'afftdn=nf=-60'
    };

    const noiseFilter = noiseFilters[String(noiseLevel)] || noiseFilters['2'];
    let audioFilters = `${noiseFilter},highpass=f=80`;

    if (voiceBoost) {
      audioFilters += ',equalizer=f=1000:t=q:w=1:g=3,equalizer=f=3000:t=q:w=1:g=2,compand=attacks=0.02:decays=0.15:points=-80/-80|-45/-15|-27/-9|0/-3|20/-3:gain=3';
    }

    const ffmpegArgs = [
      '-i', inputPath,
      '-af', audioFilters,
      '-q:a', '0',
      '-y',
      outputPath
    ];

    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg error: ${stderr}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

// POST - Process audio
router.post('/process', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const noiseLevel = req.body.noiseLevel || '2';
    const voiceBoost = req.body.voiceBoost === 'true';
    const outputFormat = req.body.outputFormat || 'original';

    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    const timestamp = Date.now();
    const baseName = `enhanced_${timestamp}`;

    let outputPath;
    if (outputFormat === 'mp3') {
      outputPath = path.join(outputDir, `${baseName}.mp3`);
    } else if (outputFormat === 'wav') {
      outputPath = path.join(outputDir, `${baseName}.wav`);
    } else {
      outputPath = path.join(outputDir, `${baseName}${fileExtension}`);
    }

    await processAudioWithFfmpeg(req.file.path, outputPath, noiseLevel, voiceBoost);

    const originalUrl = `/enhance-speech/serve/${req.file.filename}`;
    const enhancedUrl = `/enhance-speech/download/${path.basename(outputPath)}`;

    res.json({
      success: true,
      originalUrl: originalUrl,
      enhancedUrl: enhancedUrl
    });
  } catch (error) {
    console.error('Audio processing error:', error);
    res.status(500).json({ error: error.message || 'Audio processing failed' });
  }
});

// GET - Download processed file
router.get('/download/:filename', requireAuth, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(outputDir, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filepath, filename);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// GET - Serve uploaded file (for before comparison)
router.get('/serve/:filename', requireAuth, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(uploadDir, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filepath);
  } catch (error) {
    console.error('Serve error:', error);
    res.status(500).json({ error: 'File serve failed' });
  }
});

module.exports = router;
