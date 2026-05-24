const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireCredits } = require('../middleware/credits');
const { requireStorageHeadroom, trackUploadBytes } = require('../middleware/storage');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { featureUsageOps } = require('../db/database');

function getYoutubeCookiesArgs() {
  const p = process.env.YT_COOKIES_PATH;
  if (p && require('fs').existsSync(p)) return ['--cookies', p];
  return [];
}

function getYoutubeProxyArgs() {
  const p = process.env.YT_PROXY_URL;
  if (p) return ['--proxy', p];
  return [];
}

// FFmpeg path detection
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) { ffmpegPath = localFfmpeg; }
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (e) {} }
if (!ffmpegPath) { try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {} }

// RNNoise model detection.
// FFmpeg's `arnndn` filter is the only built-in option capable of *fully*
// eliminating steady ambient noise (fans, AC, hum, room tone). It needs a
// pre-trained text-format weight file. The Dockerfile downloads three
// well-known models from GregorR/rnnoise-models into /usr/local/share/rnnoise:
//   - sh.rnnn  somnolent-hogwash    speech-tuned, most aggressive on voice
//   - mp.rnnn  marathon-prescription general-purpose
//   - cb.rnnn  conjoined-burgers     conference-call / phone audio
// In dev environments where the models aren't present we fall back to a
// stacked afftdn + anlmdn chain so the feature keeps working — just less
// aggressively. That fallback is intentionally *much* stronger than the old
// single-pass afftdn=nf=-60 chain, which was the original "high doesn't
// remove anything" complaint.
const RNNOISE_DIR = '/usr/local/share/rnnoise';
const rnnoiseModels = {
  speech:  path.join(RNNOISE_DIR, 'sh.rnnn'),
  general: path.join(RNNOISE_DIR, 'mp.rnnn'),
  call:    path.join(RNNOISE_DIR, 'cb.rnnn'),
};
const rnnoiseAvailable = Object.fromEntries(
  Object.entries(rnnoiseModels).map(([k, p]) => [k, fs.existsSync(p)])
);
console.log('[enhance-speech] RNNoise models:', rnnoiseAvailable);

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
        <h1><img src="/images/section-icons/A-69.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Enhance Audio</h1>
        <p>Remove background noise and enhance voice clarity with AI</p>
      </div>

      <!-- Hero Visual Section -->
      <div style="background:linear-gradient(135deg,rgba(139,92,246,0.15),rgba(236,72,153,0.1));border-radius:20px;padding:2.5rem;margin-bottom:2rem;position:relative;overflow:hidden;border:1px solid rgba(139,92,246,0.2)">
        <div style="display:flex;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap">
          <div style="background:linear-gradient(135deg,#8B5CF6,#EC4899);border-radius:16px;padding:2rem 3rem;position:relative;min-width:240px;text-align:center">
            <img src="/images/section-icons/A-69.png" alt="" style="height:64px;width:64px;border-radius:12px;margin-bottom:0.5rem">
            <div style="display:flex;align-items:center;gap:4px;justify-content:center;margin-top:8px">
              <div style="width:3px;height:18px;background:rgba(255,255,255,0.6);border-radius:2px;animation:swave1 1s ease-in-out infinite"></div>
              <div style="width:3px;height:28px;background:rgba(255,255,255,0.8);border-radius:2px;animation:swave2 1s ease-in-out infinite 0.1s"></div>
              <div style="width:3px;height:22px;background:rgba(255,255,255,0.7);border-radius:2px;animation:swave1 1s ease-in-out infinite 0.2s"></div>
              <div style="width:3px;height:32px;background:rgba(255,255,255,0.9);border-radius:2px;animation:swave2 1s ease-in-out infinite 0.3s"></div>
              <div style="width:3px;height:18px;background:rgba(255,255,255,0.6);border-radius:2px;animation:swave1 1s ease-in-out infinite 0.4s"></div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="background:linear-gradient(135deg,#10B981,#34D399);border-radius:12px;padding:0.8rem 1.5rem;text-align:center;font-size:0.9rem;color:#fff;display:flex;align-items:center;gap:8px;justify-content:center"><img src="/images/section-icons/A-70.png" alt="" style="height:22px;width:22px;border-radius:4px"> Crystal Clear Audio</div>
            <div style="background:linear-gradient(135deg,#F59E0B,#FBBF24);border-radius:12px;padding:0.8rem 1.5rem;text-align:center;font-size:0.9rem;color:#fff;display:flex;align-items:center;gap:8px;justify-content:center"><img src="/images/section-icons/A-71.png" alt="" style="height:22px;width:22px;border-radius:4px"> Noise Removal</div>
            <div style="background:linear-gradient(135deg,#6366F1,#818CF8);border-radius:12px;padding:0.8rem 1.5rem;text-align:center;font-size:0.9rem;color:#fff;display:flex;align-items:center;gap:8px;justify-content:center"><img src="/images/section-icons/A-72.png" alt="" style="height:22px;width:22px;border-radius:4px"> Voice Enhancement</div>
          </div>
        </div>
        <style>
          @keyframes swave1{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.5)}}
          @keyframes swave2{0%,100%{transform:scaleY(1.5)}50%{transform:scaleY(0.7)}}
        </style>
      </div>

      <!-- Link Input & Upload Options -->
      <div style="background:var(--surface);border-radius:16px;padding:1.5rem;margin-bottom:2rem;border:1px solid var(--border-subtle)">
        <div style="display:flex;gap:8px;margin-bottom:1rem;width:100%;max-width:600px;margin-left:auto;margin-right:auto">
          <div style="position:relative;flex:1">
            <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><img src="/images/section-icons/A-73.png" alt="" style="height:16px;width:16px"></span>
            <input type="text" id="heroLinkInput" placeholder="Drop a YouTube link" readonly style="width:100%;padding:12px 12px 12px 36px;background:var(--dark-2);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:0.95rem;cursor:text" onclick="this.removeAttribute('readonly');this.focus()">
          </div>
          <button type="button" id="heroImportBtn" onclick="handleHeroImport()" style="padding:10px 20px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem;white-space:nowrap">▶ Import</button>
        </div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button type="button" id="heroUploadBtn" onclick="document.getElementById('fileInput').click()" style="padding:10px 20px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem"><img src="/images/section-icons/A-74.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Upload</button>
          <button type="button" style="padding:10px 20px;background:linear-gradient(135deg,#4285F4,#34A853);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem"><img src="/images/section-icons/A-75.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Google Drive</button>
          <button type="button" style="padding:10px 20px;background:linear-gradient(135deg,#0061FF,#0041B3);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem"><img src="/images/section-icons/A-76.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Dropbox</button>
        </div>
        <p style="text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:0.8rem">You can upload videos up to 120 minutes long.</p>
      </div>



      <div class="content-wrapper">
        <div class="upload-section" id="uploadSection" onclick="document.getElementById('fileInput').click()">
          <div class="upload-icon"><img src="/images/section-icons/A-74.png" alt="" style="height:48px;width:48px;border-radius:10px"></div>
          <div class="upload-text">Drop your audio or video file here</div>
          <div class="upload-subtext">Or click to select • MP3, WAV, M4A, OGG and other audio formats supported</div>
          <input type="file" id="fileInput" class="file-input" accept="audio/*">
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
              <option value="mp3" selected>MP3</option>
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

    // When the user imports audio from a URL, the server stores it in the
    // shared upload directory and returns a filename token. We hold that
    // token here so the Enhance Audio button knows to reference the imported
    // file rather than re-uploading bytes from disk.
    let importedFilename = null;
    let importedDisplayName = null;

    // Whenever the user picks a *local* file (drag/drop or file picker), the
    // imported-URL state is stale and must be cleared, otherwise we'd send
    // both and the server would silently use whichever it sees first.
    function clearImportedFile() {
      importedFilename = null;
      importedDisplayName = null;
    }

    // Import-from-URL flow. Reads the hero link input, validates it, asks
    // the server to download the audio via yt-dlp, and on success queues
    // the resulting file as if the user had uploaded it.
    window.handleHeroImport = async function handleHeroImport() {
      const heroInput = document.getElementById('heroLinkInput');
      const importBtn = document.getElementById('heroImportBtn');
      const url = (heroInput && heroInput.value || '').trim();
      if (!url) {
        showToast('Please paste a valid URL', 4000);
        if (heroInput) {
          heroInput.removeAttribute('readonly');
          heroInput.focus();
        }
        return;
      }
      // Cheap client-side sanity check — server validates strictly.
      let parsed;
      try { parsed = new URL(url); }
      catch (_) { showToast('Please paste a valid URL', 4000); return; }
      if (!/^https?:$/.test(parsed.protocol)) {
        showToast('Only http(s) URLs are supported', 4000);
        return;
      }
      const originalLabel = importBtn ? importBtn.innerHTML : '';
      if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = '<span class="spinner"></span> Importing...';
      }
      try {
        const r = await fetch('/enhance-speech/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('Import failed (HTTP ' + r.status + ')'));
        // Success: clear any stale local-file selection and display the
        // imported file as the queued upload.
        try { fileInput.value = ''; } catch (_) {}
        importedFilename = data.filename;
        importedDisplayName = data.displayName || data.filename;
        fileName.textContent = '🌐 ' + importedDisplayName;
        fileName.style.display = 'block';
        enhanceBtn.disabled = false;
        showToast('Audio imported — ready to enhance');
      } catch (err) {
        showToast('Import failed: ' + err.message, 5000);
      } finally {
        if (importBtn) {
          importBtn.disabled = false;
          importBtn.innerHTML = originalLabel || '▶ Import';
        }
      }
    };

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        clearImportedFile();
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
        clearImportedFile();
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
      const hasLocal = fileInput.files.length > 0;
      if (!hasLocal && !importedFilename) {
        showToast('Please select a file first');
        return;
      }

      const noiseLevel = document.getElementById('noiseLevel').value;
      const voiceBoost = document.getElementById('voiceBoost').checked;
      const outputFormat = document.getElementById('outputFormat').value;

      let fetchOpts;
      if (hasLocal) {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('noiseLevel', noiseLevel);
        formData.append('voiceBoost', voiceBoost);
        formData.append('outputFormat', outputFormat);
        fetchOpts = { method: 'POST', body: formData };
      } else {
        // URL-imported file — server already has the bytes; just reference it.
        fetchOpts = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importedFilename, noiseLevel, voiceBoost, outputFormat }),
        };
      }

      enhanceBtn.disabled = true;
      enhanceBtn.classList.add('processing');
      enhanceBtn.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/enhance-speech/process', fetchOpts);

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
      // The server's enhanced URL is /enhance-speech/download/enhanced_<ts>.<ext>
      // — derive the extension from it so a WAV save isn't mis-named .mp3.
      const ext = (currentDownloadUrl.match(/\.([a-z0-9]+)(?:\?|$)/i) || [,'mp3'])[1].toLowerCase();
      const a = document.createElement('a');
      a.href = currentDownloadUrl;
      a.download = 'enhanced-audio.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    ${themeScript}
  
      // Rotating placeholder for hero link input
      (function(){
        var heroInput = document.getElementById('heroLinkInput');
        if(!heroInput) return;
        var placeholders = ['Drop a YouTube link','Drop a Rumble link','Drop a Zoom link','Drop a Twitch link'];
        var idx = 0;
        setInterval(function(){
          idx = (idx + 1) % placeholders.length;
          heroInput.placeholder = placeholders[idx];
        }, 2500);
      })();
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

    // Build a noise-reduction chain per level. Old behaviour was a single
    // afftdn pass with only the noise-floor parameter set, which barely
    // attenuates ambient noise in practice — `nr` (the actual reduction in
    // dB) defaults to 12 and `nt` (noise tracking) defaults to off, so the
    // filter never knows what's noise vs signal. The new chain:
    //   - Low:    one tracked afftdn pass (preserves naturalness)
    //   - Medium: two-pass tracked afftdn for a clearly cleaner result
    //   - High:   RNN-based arnndn (when the model is present) followed by a
    //             tracked afftdn cleanup, plus aggressive band-limiting to
    //             telephone-grade speech band where ambient noise lives.
    //             When the model is missing (dev/local without the Dockerfile)
    //             we fall back to a stacked afftdn + anlmdn chain that is
    //             still much stronger than the original.
    const level = String(noiseLevel);
    let chain;
    if (level === '1') {
      chain = ['afftdn=nr=12:nf=-25:nt=w', 'highpass=f=80'];
    } else if (level === '3') {
      if (rnnoiseAvailable.speech) {
        chain = [
          `arnndn=m=${rnnoiseModels.speech}`,
          'afftdn=nr=20:nf=-35:nt=w',
          'highpass=f=120',
          'lowpass=f=8000',
        ];
      } else {
        // Fallback: aggressive multi-stage classical denoiser chain. Tuned
        // empirically against pink-noise + speech mixes. Each afftdn pass
        // shaves another ~5-7 dB off the noise floor. anlmdn cleans up
        // residual non-stationary artefacts. Voice band 150-7500 Hz survives.
        chain = [
          'afftdn=nr=40:nf=-40:nt=w',
          'afftdn=nr=30:nf=-35:nt=w',
          'afftdn=nr=25:nf=-30:nt=w',
          'anlmdn=s=0.0002:p=0.002:r=0.006:m=15',
          'highpass=f=150',
          'lowpass=f=7500',
        ];
      }
    } else { // '2' or unknown -> medium
      chain = [
        'afftdn=nr=25:nf=-35:nt=w',
        'highpass=f=90',
        'afftdn=nr=15:nf=-30:nt=w',
      ];
    }
    let audioFilters = chain.join(',');

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

// Multer wrapper: only invoke multer when the request is multipart. The new
// JSON variant (used after URL import) doesn't carry a file so multer would
// otherwise reject the request because it has no file field.
function maybeMultipart(req, res, next) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.startsWith('multipart/')) return upload.single('file')(req, res, next);
  return next();
}

// Allow only filenames that look like they came out of multer's upload dir
// (multer's default disk-storage names are random hex strings). This is the
// security boundary preventing a logged-in user from passing
// `../../etc/passwd` and getting it processed/served.
function isSafeUploadFilename(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  if (name === '.' || name === '..') return false;
  // Multer's default filenames are 32+ hex chars, optionally with extension.
  return /^[A-Za-z0-9._-]{8,128}$/.test(name);
}

// POST - Import audio from URL (YouTube, Twitch, Rumble, Zoom recording, etc.)
// Uses yt-dlp to download just the audio track into the same upload directory
// multer uses, so the existing /process flow can pick it up by filename.
router.post('/import-url', requireAuth, async (req, res) => {
  let outFile = null;
  try {
    const rawUrl = (req.body && req.body.url || '').toString().trim();
    if (!rawUrl) return res.status(400).json({ error: 'Please paste a valid URL' });

    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) {
      return res.status(400).json({ error: 'Please paste a valid URL' });
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http(s) URLs are supported' });
    }
    // Block obvious SSRF targets. Public hostnames only.
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
      host === '0.0.0.0' || host.endsWith('.local') ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return res.status(400).json({ error: 'That URL is not accessible from the server' });
    }

    // Resolve yt-dlp; if the binary isn't available, surface a clear error.
    let ytdlpBin = 'yt-dlp';
    try { execSync('which yt-dlp', { stdio: 'pipe' }); }
    catch (_) {
      try { execSync('pip3 install --break-system-packages yt-dlp', { stdio: 'pipe' }); }
      catch (_) {
        return res.status(500).json({ error: 'yt-dlp is not installed on the server' });
      }
    }

    // Random target filename (matching multer's style) so /process and /serve
    // can find it, and so two simultaneous imports don't collide.
    const token = require('crypto').randomBytes(16).toString('hex');
    outFile = path.join(uploadDir, token + '.mp3');

    // Pre-flight title fetch — gives the UI something nicer to show than the
    // raw URL, and also doubles as a "is this URL even reachable / supported"
    // probe before we commit to a download. Mirrors the YouTube anti-bot
    // arg set used by ai-broll/ai-captions/shorts so YouTube doesn't reject
    // the request with the "confirm you're not a bot" page.
    let displayName = parsed.hostname + parsed.pathname;
    const TITLE_ARGS = [
      '--no-warnings', '--no-check-certificates', '--geo-bypass',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--retries', '3', '--extractor-retries', '3',
      '--get-title',
    ];
    try {
      const titleProc = execSync(
        ytdlpBin + ' ' + TITLE_ARGS.map(a => JSON.stringify(a)).join(' ') + ' ' + JSON.stringify(rawUrl),
        { encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (titleProc) displayName = titleProc.split('\n')[0].slice(0, 200);
    } catch (_) { /* fall back to URL as displayName */ }

    // Download audio only, transcoded to mp3 so /process can handle it
    // uniformly. 5-minute timeout — covers typical podcasts/short videos.
    await new Promise((resolve, reject) => {
      const args = [
        '--no-warnings', '--no-check-certificates', '--geo-bypass',
        '--no-playlist',
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '--user-agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        // Same anti-bot arg set used by ai-broll / ai-captions / shorts —
        // routes through the bgutil-pot-provider sidecar started in the
        // Dockerfile, which lets yt-dlp pass YouTube's PO-token check.
        '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--retries', '3', '--extractor-retries', '3', '--fragment-retries', '3',
        ...getYoutubeCookiesArgs(),
        ...getYoutubeProxyArgs(),
        '-o', outFile.replace(/\.mp3$/, '.%(ext)s'),
        rawUrl,
      ];
      const proc = spawn(ytdlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrTail = '';
      proc.stdout.on('data', () => {});
      proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-600); });
      const killer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 300000);
      proc.on('close', (code) => {
        clearTimeout(killer);
        if (code === 0 && fs.existsSync(outFile)) return resolve();
        reject(new Error(stderrTail.split('\n').slice(-3).join(' ').trim() || 'Download failed (exit ' + code + ')'));
      });
      proc.on('error', (err) => { clearTimeout(killer); reject(err); });
    });

    if (!fs.existsSync(outFile)) {
      return res.status(500).json({ error: 'Download finished but file is missing' });
    }
    const stat = fs.statSync(outFile);
    if (stat.size < 1024) {
      try { fs.unlinkSync(outFile); } catch (_) {}
      return res.status(500).json({ error: 'Downloaded file is empty' });
    }

    return res.json({
      success: true,
      filename: path.basename(outFile),
      displayName,
      sizeBytes: stat.size,
    });
  } catch (err) {
    if (outFile) { try { fs.unlinkSync(outFile); } catch (_) {} }
    const msg = (err && err.message ? err.message : 'Import failed').slice(0, 300);
    console.error('[enhance-speech] import-url error:', msg);
    return res.status(500).json({ error: msg });
  }
});

// POST - Process audio.
// Two ways in:
//   - multipart upload (legacy / drag-drop / Upload button) — multer puts the
//     file at req.file.path
//   - JSON { importedFilename, ... } (new — used after /import-url) — we look
//     up the file by name in the upload dir.
router.post('/process', requireAuth, requireCredits('enhance-audio'), requireStorageHeadroom(), maybeMultipart, trackUploadBytes('enhance-audio'), async (req, res) => {
  try {
    let inputPath, sourceFilename, originalExtension;
    if (req.file) {
      inputPath = req.file.path;
      sourceFilename = req.file.filename;
      originalExtension = path.extname(req.file.originalname).toLowerCase();
    } else if (req.body && req.body.importedFilename) {
      const safe = req.body.importedFilename;
      if (!isSafeUploadFilename(safe)) {
        return res.status(400).json({ error: 'Invalid imported filename' });
      }
      const candidate = path.join(uploadDir, safe);
      // Defence-in-depth: ensure the resolved path is still inside uploadDir
      // (path.join with '..' could escape on some platforms).
      const resolved = path.resolve(candidate);
      if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) {
        return res.status(400).json({ error: 'Invalid imported filename' });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(400).json({ error: 'Imported file not found — please re-import' });
      }
      inputPath = resolved;
      sourceFilename = safe;
      originalExtension = path.extname(safe).toLowerCase();
    } else {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const noiseLevel = (req.body && req.body.noiseLevel) || '2';
    const voiceBoostRaw = req.body && req.body.voiceBoost;
    const voiceBoost = voiceBoostRaw === true || voiceBoostRaw === 'true';
    // Output format is now mp3 or wav only — the UI no longer offers
    // "Original Format" because users were getting a downloaded file whose
    // extension didn't match what they could open in their audio app.
    let outputFormat = ((req.body && req.body.outputFormat) || 'mp3').toLowerCase();
    if (outputFormat !== 'mp3' && outputFormat !== 'wav') outputFormat = 'mp3';

    const timestamp = Date.now();
    const baseName = `enhanced_${timestamp}`;
    const outputPath = path.join(outputDir, `${baseName}.${outputFormat}`);

    await processAudioWithFfmpeg(inputPath, outputPath, noiseLevel, voiceBoost);

    const originalUrl = `/enhance-speech/serve/${sourceFilename}`;
    const enhancedUrl = `/enhance-speech/download/${path.basename(outputPath)}`;

    res.json({
      success: true,
      originalUrl: originalUrl,
      enhancedUrl: enhancedUrl
    });
    featureUsageOps.log(req.user.id, 'enhance_speech').catch(() => {});
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
