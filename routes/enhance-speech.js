const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

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
      .coming-soon-badge {
        display: inline-block;
        background: var(--warning);
        color: #000;
        padding: 0.3rem 0.8rem;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 0.5rem;
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
              <span class="coming-soon-badge">Coming Soon</span>
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
                <audio controls style="width: 100%; margin-bottom: 0.5rem;"></audio>
              </div>
            </div>
            <div>
              <div class="player-label">After Enhancement</div>
              <div class="audio-player">
                <audio controls style="width: 100%; margin-bottom: 0.5rem;"></audio>
              </div>
            </div>
          </div>
          <button class="download-btn">Download Enhanced Audio</button>
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

      showToast('Audio enhancement processing is being set up. Check back soon!', 4000);
    });

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// POST - Process audio (placeholder)
router.post('/process', requireAuth, (req, res) => {
  res.json({ success: false, message: 'Audio enhancement coming soon' });
});

module.exports = router;
