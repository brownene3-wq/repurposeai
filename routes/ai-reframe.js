const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

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
        display: none;
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
      .action-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .action-button:disabled {
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
      .preview-section {
        margin-top: 2rem;
        display: none;
      }
      .preview-section.show {
        display: block;
      }
      .preview-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
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
      .empty-state {
        text-align: center;
        padding: 2rem;
        color: var(--text-muted);
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
        <div class="input-tabs">
          <button class="input-tab active" data-tab="url">YouTube URL</button>
          <button class="input-tab" data-tab="upload">Upload File</button>
        </div>

        <div id="urlTab" class="tab-content active">
          <input type="text" class="url-input" id="youtubeUrl" placeholder="Paste YouTube video URL here...">
        </div>

        <div id="uploadTab" class="tab-content">
          <div class="upload-area" id="uploadArea" onclick="document.getElementById('fileInput').click()">
            <div class="upload-icon">🎬</div>
            <div class="upload-text">Drop your video file here</div>
            <div class="upload-subtext">Or click to select • MP4, MOV, WebM supported</div>
            <input type="file" id="fileInput" class="file-input" accept="video/*">
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

        <button class="action-button" id="reframeBtn" disabled>
          Reframe Video
          <span class="coming-soon-badge">Coming Soon</span>
        </button>
      </div>

      <div class="preview-section" id="previewSection">
        <h2 style="margin-bottom: 1.5rem; color: var(--text);">Preview</h2>
        <div class="preview-grid">
          <div class="preview-container">
            <div class="preview-label">Original</div>
            <div class="empty-state">Video preview will appear here</div>
          </div>
          <div class="preview-container">
            <div class="preview-label">Selected Formats</div>
            <div class="empty-state">Reframed versions will appear here</div>
          </div>
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

    // Aspect ratio selection
    document.querySelectorAll('input[name="aspect"]').forEach(checkbox => {
      checkbox.addEventListener('change', checkInputs);
    });

    function checkInputs() {
      const hasUrl = youtubeUrl.value.trim().length > 0;
      const hasFile = fileInput.files.length > 0;
      const hasAspectRatio = document.querySelectorAll('input[name="aspect"]:checked').length > 0;

      reframeBtn.disabled = !(hasUrl || hasFile) || !hasAspectRatio;
    }

    reframeBtn.addEventListener('click', async () => {
      const hasUrl = youtubeUrl.value.trim().length > 0;
      const hasFile = fileInput.files.length > 0;

      if (!hasUrl && !hasFile) {
        showToast('Please provide a YouTube URL or upload a video');
        return;
      }

      const selectedRatios = Array.from(document.querySelectorAll('input[name="aspect"]:checked')).map(c => c.value);
      if (selectedRatios.length === 0) {
        showToast('Please select at least one aspect ratio');
        return;
      }

      showToast('Video reframing is being set up. Check back soon!', 4000);
    });

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// POST - Process video (placeholder)
router.post('/process', requireAuth, (req, res) => {
  res.json({ success: false, message: 'Video reframing coming soon' });
});

module.exports = router;
