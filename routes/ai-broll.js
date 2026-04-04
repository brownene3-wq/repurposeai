const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// FFmpeg setup
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) ffmpegPath = localFfmpeg;
if (!ffmpegPath) {
  try { ffmpegPath = require('ffmpeg-static'); } catch (e) {}
}
if (!ffmpegPath) {
  try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {}
}

// Directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/webm'];
    cb(allowedMimes.includes(file.mimetype) ? null : new Error('Invalid file type'), allowedMimes.includes(file.mimetype));
  }
});

// GET - Render AI B-Roll page
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('AI B-Roll Generator');
  const sidebar = getSidebar('ai-broll', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const pageStyles = `
    <style>
      ${css}
      .broll-container {
        max-width: 1200px;
      }
      .input-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
      }
      .form-group {
        margin-bottom: 1.5rem;
      }
      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: var(--text);
        font-size: 0.95rem;
      }
      .form-group input, .form-group select {
        width: 100%;
        padding: 0.75rem;
        background: var(--dark-2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        font-family: inherit;
        font-size: 0.9rem;
        transition: border-color 0.3s;
      }
      .form-group input:focus, .form-group select:focus {
        outline: none;
        border-color: var(--primary);
      }
      .upload-zone {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
        border: 2px dashed var(--primary);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        margin-bottom: 1.5rem;
      }
      .upload-zone.dragover {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.2), rgba(236, 72, 153, 0.2));
        border-color: var(--primary-light);
      }
      .upload-zone h3 {
        margin-bottom: 0.5rem;
        color: var(--text);
      }
      .upload-zone p {
        color: var(--text-muted);
        font-size: 0.9rem;
        margin-bottom: 1rem;
      }
      .upload-button {
        padding: 0.6rem 1.2rem;
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s;
      }
      .upload-button:hover {
        box-shadow: 0 8px 24px rgba(108, 58, 237, 0.3);
        transform: translateY(-2px);
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
      }
      .tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .tab-btn {
        padding: 1rem 1.5rem;
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-weight: 600;
        border-bottom: 2px solid transparent;
        transition: all 0.3s;
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      .tab-content {
        display: none;
      }
      .tab-content.active {
        display: block;
      }
      .btn-generate {
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
      }
      .btn-generate:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .btn-generate:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      .broll-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 1rem;
        margin-top: 1.5rem;
      }
      .broll-item {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.3s;
        cursor: pointer;
      }
      .broll-item:hover {
        border-color: var(--primary);
        transform: scale(1.05);
        box-shadow: 0 4px 15px rgba(108, 58, 237, 0.2);
      }
      .broll-thumbnail {
        width: 100%;
        height: 100px;
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
      }
      .broll-info {
        padding: 0.75rem;
        font-size: 0.8rem;
        color: var(--text-muted);
      }
      .broll-name {
        color: var(--text);
        font-weight: 600;
        margin-bottom: 0.25rem;
      }
      .results-section {
        margin-top: 2rem;
      }
      .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        color: var(--text-muted);
      }
      .progress-bar {
        width: 100%;
        height: 6px;
        background: var(--dark-2);
        border-radius: 3px;
        overflow: hidden;
        margin-top: 1rem;
        display: none;
      }
      .progress-bar.active {
        display: block;
      }
      .progress-fill {
        height: 100%;
        background: var(--gradient-1);
        width: 0%;
        transition: width 0.3s ease;
      }
      .loading-spinner {
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
      @media (max-width: 768px) {
        .form-row {
          grid-template-columns: 1fr;
        }
        .input-section {
          padding: 1.5rem;
        }
        .tabs {
          flex-wrap: wrap;
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
        <h1>AI B-Roll Generator</h1>
        <p>Automatically add relevant B-roll to enhance your videos</p>
      </div>

      <div class="input-section broll-container">
        <form id="brollForm">
          <div class="form-group">
            <label for="inputType">Input Type</label>
            <select id="inputType" name="inputType" required onchange="toggleBrollInputType()">
              <option value="">Select input type</option>
              <option value="upload">Upload Video</option>
              <option value="youtube">YouTube URL</option>
            </select>
          </div>

          <div id="uploadContainer" style="display: none;" class="upload-zone" ondrop="handleBrollDrop(event)" ondragover="handleBrollDragOver(event)" ondragleave="handleBrollDragLeave(event)">
            <h3>📹 Drop your video here</h3>
            <p>Or click to browse</p>
            <button type="button" class="upload-button" onclick="document.getElementById('brollVideoFile').click()">Select Video</button>
            <input type="file" id="brollVideoFile" style="display:none" accept="video/*" onchange="handleBrollFileSelect(event)">
            <p id="brollFileName" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;"></p>
          </div>

          <div id="youtubeContainer" style="display: none;">
            <div class="form-group">
              <label for="youtubeUrl">YouTube URL</label>
              <input type="url" id="youtubeUrl" name="youtubeUrl" placeholder="https://www.youtube.com/watch?v=...">
            </div>
          </div>

          <div class="tabs">
            <button type="button" class="tab-btn active" data-tab="ai-generated" onclick="switchTab('ai-generated', event)">AI Generated B-Roll</button>
            <button type="button" class="tab-btn" data-tab="stock" onclick="switchTab('stock', event)">Stock B-Roll (Copyright Free)</button>
          </div>

          <div class="tab-content active" id="ai-generated">
            <div class="form-group">
              <label for="aiPrompt">Describe the B-Roll you want (optional)</label>
              <input type="text" id="aiPrompt" placeholder="e.g., 'nature scenes, flowing water, mountains'">
            </div>
          </div>

          <div class="tab-content" id="stock">
            <div class="form-group">
              <label for="searchTerms">Search Terms for Stock B-Roll</label>
              <input type="text" id="searchTerms" placeholder="e.g., 'office, technology, business'">
            </div>
          </div>

          <button type="submit" class="btn-generate" id="generateBrollBtn">Add B-Roll in 1 Click</button>
          <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"></div></div>
        </form>
      </div>

      <div class="results-section">
        <div id="brollResultsContainer">
          <div class="empty-state">
            <p>Select a video and click "Add B-Roll in 1 Click" to generate footage</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let currentBrollVideo = null;

    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }

    function toggleBrollInputType() {
      const type = document.getElementById('inputType').value;
      document.getElementById('uploadContainer').style.display = type === 'upload' ? 'block' : 'none';
      document.getElementById('youtubeContainer').style.display = type === 'youtube' ? 'block' : 'none';
    }

    function handleBrollDragOver(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.add('dragover');
    }

    function handleBrollDragLeave(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.remove('dragover');
    }

    function handleBrollDrop(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        currentBrollVideo = files[0];
        document.getElementById('brollFileName').textContent = 'Selected: ' + files[0].name;
      }
    }

    function handleBrollFileSelect(e) {
      if (e.target.files.length > 0) {
        currentBrollVideo = e.target.files[0];
        document.getElementById('brollFileName').textContent = 'Selected: ' + e.target.files[0].name;
      }
    }

    function switchTab(tabName, e) {
      e.preventDefault();
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabName).classList.add('active');
      e.target.classList.add('active');
    }

    document.getElementById('brollForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const inputType = document.getElementById('inputType').value;
      const mode = document.querySelector('.tab-btn.active').dataset.tab;

      if (!inputType) {
        showToast('Please select an input type');
        return;
      }

      let content = null;
      if (inputType === 'upload') {
        if (!currentBrollVideo) {
          showToast('Please select a video file');
          return;
        }
        content = { type: 'upload', file: currentBrollVideo };
      } else if (inputType === 'youtube') {
        const url = document.getElementById('youtubeUrl').value.trim();
        if (!url) {
          showToast('Please enter a YouTube URL');
          return;
        }
        content = { type: 'youtube', url };
      }

      const btn = document.getElementById('generateBrollBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Generating B-Roll...';
      const progressBar = document.getElementById('progressBar');
      progressBar.classList.add('active');

      try {
        let response;
        if (content.type === 'upload') {
          const formData = new FormData();
          formData.append('video', content.file);
          formData.append('mode', mode);
          formData.append('prompt', document.getElementById('aiPrompt').value || document.getElementById('searchTerms').value);
          response = await fetch('/ai-broll/generate', {
            method: 'POST',
            body: formData
          });
        } else {
          response = await fetch('/ai-broll/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputType: content.type,
              url: content.url,
              mode,
              prompt: document.getElementById('aiPrompt').value || document.getElementById('searchTerms').value
            })
          });
        }

        const data = await response.json();

        if (response.ok && data.brollItems && data.brollItems.length > 0) {
          const container = document.getElementById('brollResultsContainer');
          container.innerHTML = '<h2 style="margin-bottom: 1.5rem; color: var(--text);">Generated B-Roll</h2><div class="broll-grid">' +
            data.brollItems.map((item, idx) => \`
              <div class="broll-item" onclick="selectBroll('\${item.id}')">
                <div class="broll-thumbnail">\${item.icon || '🎬'}</div>
                <div class="broll-info">
                  <div class="broll-name">\${item.name}</div>
                  <div>\${item.duration || '5s'}</div>
                </div>
              </div>
            \`).join('') + '</div>';
          showToast('B-roll generated successfully!');
        } else {
          showToast(data.error || 'Failed to generate B-roll');
        }
      } catch (error) {
        showToast('Error generating B-roll');
        console.error(error);
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Add B-Roll in 1 Click';
        progressBar.classList.remove('active');
      }
    });

    function selectBroll(id) {
      showToast('B-roll selected: ' + id);
    }

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// POST - Generate B-roll
router.post('/generate', requireAuth, upload.single('video'), async (req, res) => {
  try {
    const { inputType, url, mode, prompt } = req.body;

    if (!mode) {
      return res.status(400).json({ error: 'Please select a B-roll mode' });
    }

    let contentDescription = '';
    if (inputType === 'upload' && req.file) {
      contentDescription = `Video file: ${req.file.originalname}`;
    } else if (inputType === 'youtube' && url) {
      contentDescription = `YouTube video: ${url}`;
    } else {
      return res.status(400).json({ error: 'No content provided' });
    }

    const analysisPrompt = `Analyze this video content and identify key moments that need B-roll enhancement: "${contentDescription}"
Generate a JSON array of B-roll suggestions with this structure:
[{"moment": "description", "keywords": ["keyword1", "keyword2"], "duration": 5}]
Focus on visual elements that would enhance the content.
Return ONLY the JSON array.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: analysisPrompt }],
      max_tokens: 500,
      temperature: 0.7
    });

    let moments = [];
    try {
      moments = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      moments = [{ moment: 'Video enhancement', keywords: [prompt || 'video'], duration: 5 }];
    }

    const brollItems = moments.slice(0, 5).map((m, idx) => ({
      id: `broll-${uuidv4().slice(0, 8)}`,
      name: m.moment || `B-Roll ${idx + 1}`,
      keywords: m.keywords || [],
      duration: m.duration || 5,
      icon: ['🌿', '🏢', '🌍', '🎨', '⚡'][idx % 5],
      mode,
      sourceUrl: mode === 'stock' ? `https://pixabay.com/videos/search/${(m.keywords || []).join('+')}/` : null
    }));

    res.json({ brollItems });
  } catch (error) {
    console.error('AI B-Roll error:', error);
    res.status(500).json({ error: 'Failed to generate B-roll' });
  }
});

// POST - Apply B-roll
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { videoPath, brollItems } = req.body;

    if (!videoPath || !brollItems || !Array.isArray(brollItems)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video file not found' });
    }

    const outputPath = path.join(outputDir, `broll-applied-${uuidv4()}.mp4`);

    // For now, just copy the file (in production, would overlay B-roll with FFmpeg)
    fs.copyFileSync(videoPath, outputPath);

    res.json({
      success: true,
      outputPath,
      downloadUrl: `/api/download/${path.basename(outputPath)}`
    });
  } catch (error) {
    console.error('Apply B-roll error:', error);
    res.status(500).json({ error: 'Failed to apply B-roll' });
  }
});

module.exports = router;
