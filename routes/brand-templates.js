const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    cb(allowedMimes.includes(file.mimetype) ? null : new Error('Invalid file type'), allowedMimes.includes(file.mimetype));
  }
});

// Caption style presets
const captionStyles = {
  'karaoke': { name: 'Karaoke', description: 'Words appear one by one like singing', color: '#6C3AED' },
  'bold-pop': { name: 'Bold Pop', description: 'Large bold text with pop effect', color: '#EC4899' },
  'mrbeast': { name: 'MrBeast', description: 'High energy yellow with effects', color: '#FFD700' },
  'hormozi': { name: 'Hormozi', description: 'Minimal black & white style', color: '#FFFFFF' },
  'neon': { name: 'Neon', description: 'Glowing neon effect', color: '#00FF00' },
  'wave': { name: 'Wave', description: 'Text waves across screen', color: '#00BFFF' },
  'shadow': { name: 'Shadow', description: 'Dark shadow with depth', color: '#1A1A2E' },
  'motion': { name: 'Motion', description: 'Fast moving dynamic text', color: '#FF6B6B' }
};

// Aspect ratios
const aspectRatios = {
  '9:16': { label: 'TikTok / Shorts / Reels', width: 1080, height: 1920, icon: '📱' },
  '1:1': { label: 'LinkedIn / Instagram', width: 1080, height: 1080, icon: '⬜' },
  '16:9': { label: 'YouTube / Vimeo', width: 1920, height: 1080, icon: '📺' },
  '4:5': { label: 'Instagram Portrait', width: 1080, height: 1350, icon: '📸' }
};

// GET - Main Brand Templates Wizard
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('Brand Templates');
  const sidebar = getSidebar('brand-templates', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const pageStyles = `
    <style>
      ${css}
      .wizard-container {
        max-width: 900px;
        margin: 0 auto;
      }
      .wizard-header {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
      }
      .wizard-step {
        display: none;
      }
      .wizard-step.active {
        display: block;
      }
      .step-indicator {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
        justify-content: center;
      }
      .step-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        cursor: pointer;
        transition: all 0.3s;
      }
      .step-dot.active {
        background: var(--primary);
        width: 40px;
        border-radius: 6px;
      }
      .step-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 0.5rem;
      }
      .step-description {
        color: var(--text-muted);
        font-size: 0.95rem;
      }
      .aspect-ratio-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .aspect-ratio-card {
        background: var(--dark-2);
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
      }
      .aspect-ratio-card:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
      }
      .aspect-ratio-card.selected {
        border-color: var(--primary);
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.15), rgba(236, 72, 153, 0.1));
        box-shadow: 0 4px 15px rgba(108, 58, 237, 0.2);
      }
      .aspect-ratio-icon {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }
      .aspect-ratio-label {
        font-weight: 600;
        color: var(--text);
        margin-bottom: 0.25rem;
      }
      .aspect-ratio-desc {
        font-size: 0.8rem;
        color: var(--text-muted);
      }
      .caption-carousel {
        display: flex;
        gap: 1rem;
        overflow-x: auto;
        padding-bottom: 1rem;
        scroll-behavior: smooth;
      }
      .caption-preset {
        flex: 0 0 150px;
        background: var(--dark-2);
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 1rem;
        cursor: pointer;
        transition: all 0.3s;
        text-align: center;
      }
      .caption-preset:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
      }
      .caption-preset.selected {
        border-color: var(--primary);
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.15), rgba(236, 72, 153, 0.1));
        box-shadow: 0 4px 15px rgba(108, 58, 237, 0.2);
      }
      .caption-preview {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        color: var(--primary);
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .caption-name {
        font-weight: 600;
        color: var(--text);
        font-size: 0.85rem;
        margin-bottom: 0.25rem;
      }
      .caption-desc {
        font-size: 0.7rem;
        color: var(--text-muted);
      }
      .logo-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .logo-upload {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
        border: 2px dashed var(--primary);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        margin-bottom: 1.5rem;
      }
      .logo-upload:hover {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.2), rgba(236, 72, 153, 0.2));
        border-color: var(--primary-light);
      }
      .logo-upload h3 {
        margin-bottom: 0.5rem;
        color: var(--text);
      }
      .logo-upload p {
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
      .logo-preview {
        background: var(--dark-2);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        margin-bottom: 1.5rem;
        min-height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .logo-preview-image {
        max-width: 100%;
        max-height: 150px;
      }
      .logo-position-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .position-btn {
        padding: 1rem;
        background: var(--dark-2);
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s;
      }
      .position-btn:hover {
        border-color: var(--primary);
        background: rgba(108, 58, 237, 0.1);
      }
      .position-btn.selected {
        border-color: var(--primary);
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.15), rgba(236, 72, 153, 0.1));
      }
      .slider-group {
        margin-bottom: 1.5rem;
      }
      .slider-label {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-muted);
      }
      .slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--dark-2);
        outline: none;
        -webkit-appearance: none;
        appearance: none;
      }
      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary);
        cursor: pointer;
      }
      .slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary);
        cursor: pointer;
        border: none;
      }
      .wizard-buttons {
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        margin-top: 2rem;
      }
      .btn-prev, .btn-next, .btn-save {
        padding: 0.8rem 2rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
      }
      .btn-prev {
        background: transparent;
        color: var(--text);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      .btn-prev:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: var(--primary);
      }
      .btn-next, .btn-save {
        background: var(--gradient-1);
        color: #fff;
        box-shadow: 0 4px 20px rgba(108, 58, 237, 0.4);
      }
      .btn-next:hover, .btn-save:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .btn-prev:disabled, .btn-next:disabled, .btn-save:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      @media (max-width: 768px) {
        .aspect-ratio-grid {
          grid-template-columns: 1fr;
        }
        .wizard-container {
          padding: 0 1rem;
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
        <h1>Brand Templates</h1>
        <p>Create consistent branded videos in 3 easy steps</p>
      </div>

      <div class="wizard-container">
        <div class="wizard-header">
          <div class="step-indicator">
            <div class="step-dot active" onclick="goToStep(1)"></div>
            <div class="step-dot" onclick="goToStep(2)"></div>
            <div class="step-dot" onclick="goToStep(3)"></div>
          </div>
        </div>

        <!-- Step 1: Aspect Ratio -->
        <div class="wizard-step active" id="step-1">
          <div class="step-title">Step 1: Pick Aspect Ratio</div>
          <div class="step-description">Choose the format for your videos</div>

          <div class="aspect-ratio-grid" style="margin-top: 2rem;">
            ${Object.entries(aspectRatios).map(([key, value]) => {
              return `
              <div class="aspect-ratio-card" onclick="selectAspectRatio('${key}', this)">
                <div class="aspect-ratio-icon">${value.icon}</div>
                <div class="aspect-ratio-label">${key}</div>
                <div class="aspect-ratio-desc">${value.label}</div>
              </div>
            `;
            }).join('')}
          </div>
        </div>

        <!-- Step 2: Caption Style -->
        <div class="wizard-step" id="step-2">
          <div class="step-title">Step 2: Choose Caption Style</div>
          <div class="step-description">Select your preferred animation style</div>

          <div class="caption-carousel" style="margin-top: 2rem;">
            ${Object.entries(captionStyles).map(([key, value]) => {
              return `
              <div class="caption-preset" onclick="selectCaptionStyle('${key}', this)">
                <div class="caption-preview" style="color: ${value.color};">AA</div>
                <div class="caption-name">${value.name}</div>
                <div class="caption-desc">${value.description}</div>
              </div>
            `;
            }).join('')}
          </div>
        </div>

        <!-- Step 3: Logo -->
        <div class="wizard-step" id="step-3">
          <div class="step-title">Step 3: Add Logo (Optional)</div>
          <div class="step-description">Upload your brand logo and customize placement</div>

          <div class="logo-section" style="margin-top: 2rem;">
            <div class="logo-upload" ondrop="handleLogoDrop(event)" ondragover="handleLogoDragOver(event)" ondragleave="handleLogoDragLeave(event)">
              <h3>🎨 Upload Your Logo</h3>
              <p>Drop your logo here or click to browse</p>
              <button type="button" class="upload-button" onclick="document.getElementById('logoFile').click()">Select Logo</button>
              <input type="file" id="logoFile" style="display:none" accept="image/*" onchange="handleLogoSelect(event)">
              <p id="logoFileName" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;"></p>
            </div>

            <div class="logo-preview" id="logoPreview">
              <p style="color: var(--text-muted);">Logo preview will appear here</p>
            </div>

            <div class="step-description">Logo Position</div>
            <div class="logo-position-grid">
              <button type="button" class="position-btn" onclick="selectLogoPosition('top-left', this)">↖️ Top Left</button>
              <button type="button" class="position-btn" onclick="selectLogoPosition('top-right', this)">↗️ Top Right</button>
              <button type="button" class="position-btn" onclick="selectLogoPosition('bottom-left', this)">↙️ Bottom Left</button>
              <button type="button" class="position-btn" onclick="selectLogoPosition('bottom-right', this)">↘️ Bottom Right</button>
            </div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Logo Size</span>
                <span><span id="sizeValue">100</span>%</span>
              </div>
              <input type="range" class="slider" id="logoSize" min="20" max="200" value="100" oninput="updateLogoSize(this.value)">
            </div>
          </div>
        </div>

        <div class="wizard-buttons">
          <button class="btn-prev" id="prevBtn" onclick="previousStep()" style="display: none;">Previous</button>
          <button class="btn-next" id="nextBtn" onclick="nextStep()">Next</button>
          <button class="btn-save" id="saveBtn" onclick="saveTemplate()" style="display: none;">Save Template</button>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let currentStep = 1;
    let templateData = {
      aspectRatio: null,
      captionStyle: null,
      logo: null,
      logoPosition: 'top-right',
      logoSize: 100
    };

    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }

    function goToStep(step) {
      if (step >= 1 && step <= 3) {
        currentStep = step;
        updateWizard();
      }
    }

    function nextStep() {
      if (currentStep < 3) {
        if ((currentStep === 1 && templateData.aspectRatio) || currentStep > 1) {
          currentStep++;
          updateWizard();
        } else {
          showToast('Please select an aspect ratio');
        }
      }
    }

    function previousStep() {
      if (currentStep > 1) {
        currentStep--;
        updateWizard();
      }
    }

    function updateWizard() {
      // Update step visibility
      document.querySelectorAll('.wizard-step').forEach((step, idx) => {
        step.classList.toggle('active', idx + 1 === currentStep);
      });

      // Update step indicators
      document.querySelectorAll('.step-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx + 1 === currentStep);
      });

      // Update button visibility
      document.getElementById('prevBtn').style.display = currentStep > 1 ? 'block' : 'none';
      document.getElementById('nextBtn').style.display = currentStep < 3 ? 'block' : 'none';
      document.getElementById('saveBtn').style.display = currentStep === 3 ? 'block' : 'none';
    }

    function selectAspectRatio(ratio, el) {
      document.querySelectorAll('.aspect-ratio-card').forEach(card => card.classList.remove('selected'));
      el.classList.add('selected');
      templateData.aspectRatio = ratio;
    }

    function selectCaptionStyle(style, el) {
      document.querySelectorAll('.caption-preset').forEach(preset => preset.classList.remove('selected'));
      el.classList.add('selected');
      templateData.captionStyle = style;
    }

    function handleLogoDragOver(e) {
      e.preventDefault();
      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(108, 58, 237, 0.2), rgba(236, 72, 153, 0.2))';
    }

    function handleLogoDragLeave(e) {
      e.preventDefault();
      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1))';
    }

    function handleLogoDrop(e) {
      e.preventDefault();
      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1))';
      if (e.dataTransfer.files.length > 0) {
        handleLogoFile(e.dataTransfer.files[0]);
      }
    }

    function handleLogoSelect(e) {
      if (e.target.files.length > 0) {
        handleLogoFile(e.target.files[0]);
      }
    }

    function handleLogoFile(file) {
      templateData.logo = file;
      document.getElementById('logoFileName').textContent = 'Selected: ' + file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        const preview = document.getElementById('logoPreview');
        preview.innerHTML = \`<img src="\${e.target.result}" class="logo-preview-image" style="width: \${templateData.logoSize}px;">\`;
      };
      reader.readAsDataURL(file);
    }

    function selectLogoPosition(position, el) {
      document.querySelectorAll('.position-btn').forEach(btn => btn.classList.remove('selected'));
      el.classList.add('selected');
      templateData.logoPosition = position;
    }

    function updateLogoSize(value) {
      document.getElementById('sizeValue').textContent = value;
      templateData.logoSize = value;
      const preview = document.getElementById('logoPreview');
      if (preview.querySelector('img')) {
        preview.querySelector('img').style.width = (value / 100 * 150) + 'px';
      }
    }

    async function saveTemplate() {
      if (!templateData.aspectRatio) {
        showToast('Please select an aspect ratio');
        return;
      }
      if (!templateData.captionStyle) {
        showToast('Please select a caption style');
        return;
      }

      const btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const formData = new FormData();
        formData.append('aspectRatio', templateData.aspectRatio);
        formData.append('captionStyle', templateData.captionStyle);
        formData.append('logoPosition', templateData.logoPosition);
        formData.append('logoSize', templateData.logoSize);
        if (templateData.logo) {
          formData.append('logo', templateData.logo);
        }

        const response = await fetch('/brand-templates/save', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (response.ok) {
          showToast('Template saved successfully!');
          setTimeout(() => {
            window.location.href = '/brand-templates';
          }, 1500);
        } else {
          showToast(data.error || 'Failed to save template');
        }
      } catch (error) {
        showToast('Error saving template');
        console.error(error);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Template';
      }
    }

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// GET /brand-templates/list — return saved templates for the current user
// (stored in the brandTemplate cookie today; future work can move these to
// a DB table). Returns { success, templates: [...] } — shape is plural so
// the editor can scale up later without client changes.
router.get('/list', requireAuth, (req, res) => {
  try {
    var raw = (req.cookies && req.cookies.brandTemplate) || null;
    var templates = [];
    if (raw){
      try {
        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object'){
          // Only return this user's template (single-cookie scheme)
          if (!parsed.userId || parsed.userId === req.user.id){
            // Attach a derived logoUrl the client can preview directly.
            if (parsed.logoPath){
              parsed.logoUrl = '/brand-templates/logo/' + encodeURIComponent(parsed.id || 'x');
            }
            templates.push(parsed);
          }
        }
      } catch(_){ /* invalid cookie — ignore */ }
    }
    // Caption style palette, so the editor can render preview chips without
    // re-defining colors client-side.
    res.json({
      success: true,
      templates: templates,
      captionStyles: captionStyles,
      aspectRatios: aspectRatios
    });
  } catch (err){
    console.error('[brand-templates list]', err);
    res.status(500).json({ error: err.message || 'List failed' });
  }
});

// GET /brand-templates/logo/:id — serve the saved logo file for a template.
// Uses the path stashed in the brandTemplate cookie.
router.get('/logo/:id', requireAuth, (req, res) => {
  try {
    var raw = (req.cookies && req.cookies.brandTemplate) || null;
    if (!raw) return res.status(404).send('no template');
    var t = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!t || !t.logoPath || (t.userId && t.userId !== req.user.id)){
      return res.status(404).send('no logo');
    }
    if (!fs.existsSync(t.logoPath)){
      return res.status(404).send('logo file missing');
    }
    res.sendFile(path.resolve(t.logoPath));
  } catch (err){
    res.status(500).send('error');
  }
});

// POST - Save template
router.post('/save', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { aspectRatio, captionStyle, logoPosition, logoSize } = req.body;

    if (!aspectRatio || !captionStyle) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const templateId = uuidv4();
    const templateData = {
      id: templateId,
      userId: req.user.id,
      aspectRatio,
      captionStyle,
      logoPath: req.file ? req.file.path : null,
      logoPosition,
      logoSize: parseInt(logoSize) || 100,
      createdAt: new Date().toISOString()
    };

    // Store in cookies for now (in production, would save to database)
    res.cookie('brandTemplate', JSON.stringify(templateData), {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: false
    });

    res.json({ success: true, templateId });
  } catch (error) {
    console.error('Save template error:', error);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// POST - Apply template to video
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { videoPath, templateId } = req.body;

    if (!videoPath || !templateId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video file not found' });
    }

    const outputPath = path.join(outputDir, `branded-${uuidv4()}.mp4`);

    // For now, just copy the file (in production, would apply actual transformations)
    fs.copyFileSync(videoPath, outputPath);

    res.json({
      success: true,
      outputPath,
      downloadUrl: `/api/download/${path.basename(outputPath)}`
    });
  } catch (error) {
    console.error('Apply template error:', error);
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

module.exports = router;
