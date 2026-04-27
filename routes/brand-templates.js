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
  '1:1':  { label: 'LinkedIn / Instagram', width: 1080, height: 1080, icon: '⬜' },
  '16:9': { label: 'YouTube / Vimeo', width: 1920, height: 1080, icon: '📺' },
  '4:5':  { label: 'Instagram Portrait', width: 1080, height: 1350, icon: '📸' }
};

// ----- Cookie helpers -----
// Templates are stored as a JSON array in the `brandTemplates` cookie.
// Each entry: { id, name, aspectRatio, captionStyle, logoFilename, logoPosition, logoSize, createdAt, updatedAt }
const TEMPLATES_COOKIE = 'brandTemplates';
const COOKIE_MAX_AGE = 180 * 24 * 60 * 60 * 1000; // 180 days

function readTemplates(req) {
  try {
    const raw = req.cookies && req.cookies[TEMPLATES_COOKIE];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    // Backward-compat: migrate legacy single-template `brandTemplate` cookie
    // (written by the pre-multi-template wizard) into the new array shape so
    // existing users don't lose their saved template on first visit.
    const legacy = req.cookies && req.cookies.brandTemplate;
    if (legacy) {
      try {
        const obj = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
        if (obj && obj.id && (!obj.userId || obj.userId === (req.user && req.user.id))) {
          return [{
            id: obj.id,
            name: obj.name || 'Imported template',
            aspectRatio: obj.aspectRatio || null,
            captionStyle: obj.captionStyle || null,
            logoFilename: obj.logoPath ? path.basename(obj.logoPath) : (obj.logoFilename || null),
            logoPosition: obj.logoPosition || 'top-right',
            logoSize: parseInt(obj.logoSize) || 100,
            createdAt: obj.createdAt || new Date().toISOString(),
            updatedAt: obj.updatedAt || obj.createdAt || new Date().toISOString()
          }];
        }
      } catch (e) {}
    }
    return [];
  } catch (e) {
    return [];
  }
}

// Build a client-facing template object (adds logoUrl the editor expects)
function decorate(t) {
  const out = Object.assign({}, t);
  if (t && t.logoFilename && safeFilename(t.logoFilename)) {
    out.logoUrl = '/brand-templates/logo/' + encodeURIComponent(t.logoFilename);
  }
  return out;
}

function writeTemplates(res, templates) {
  res.cookie(TEMPLATES_COOKIE, JSON.stringify(templates), {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: false,
    sameSite: 'lax'
  });
}

function sanitizeName(name) {
  if (!name) return '';
  return String(name).trim().slice(0, 60);
}

function safeFilename(filename) {
  // Only allow UUID-like/multer filenames (no path traversal, no slashes)
  return /^[A-Za-z0-9._-]+$/.test(filename || '');
}

// ----- Routes -----

// GET - Main Brand Templates page (list + wizard)
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('Brand Templates');
  const sidebar = getSidebar('brand-templates', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const templates = readTemplates(req);

  const pageStyles = `
    <style>
      ${css}
      .wizard-container { max-width: 900px; margin: 0 auto; }
      .saved-templates-section { margin-bottom: 2rem; }
      .saved-templates-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
      .saved-templates-header h2 { font-size: 1.2rem; font-weight: 700; color: var(--text); margin: 0; }
      .saved-templates-header .count { color: var(--text-muted); font-size: 0.9rem; }
      .saved-templates-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 1rem;
      }
      .saved-template-card {
        background: var(--surface);
        border: 2px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 1rem;
        transition: all 0.2s;
        position: relative;
        cursor: pointer;
      }
      .saved-template-card:hover {
        border-color: var(--primary);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(108, 58, 237, 0.2);
      }
      .saved-template-thumb {
        height: 100px;
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(108,58,237,0.15), rgba(236,72,153,0.12));
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        color: var(--primary);
        margin-bottom: 0.75rem;
        overflow: hidden;
      }
      .saved-template-thumb img { max-width: 70%; max-height: 70%; }
      .saved-template-name {
        font-weight: 600;
        color: var(--text);
        margin-bottom: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .saved-template-meta {
        font-size: 0.75rem;
        color: var(--text-muted);
        margin-bottom: 0.75rem;
      }
      .saved-template-actions {
        display: flex;
        gap: 0.4rem;
      }
      .saved-template-actions button {
        flex: 1;
        padding: 0.4rem 0.5rem;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        background: var(--dark-2);
        color: var(--text);
        font-size: 0.75rem;
        cursor: pointer;
        transition: all 0.2s;
      }
      .saved-template-actions button:hover { background: rgba(108,58,237,0.15); border-color: var(--primary); }
      .saved-template-actions button.danger:hover { background: rgba(239,68,68,0.15); border-color: #ef4444; color: #ef4444; }
      .empty-templates {
        padding: 1.25rem;
        border: 1px dashed rgba(255,255,255,0.15);
        border-radius: 12px;
        color: var(--text-muted);
        text-align: center;
        font-size: 0.9rem;
      }
      .wizard-header { background: var(--surface); border: var(--border-subtle); border-radius: 12px; padding: 2rem; margin-bottom: 2rem; }
      .wizard-mode-banner {
        display: none;
        margin-bottom: 1rem;
        padding: 0.75rem 1rem;
        background: linear-gradient(135deg, rgba(108,58,237,0.2), rgba(236,72,153,0.15));
        border: 1px solid var(--primary);
        border-radius: 8px;
        color: var(--text);
        font-size: 0.9rem;
        justify-content: space-between;
        align-items: center;
      }
      .wizard-mode-banner.visible { display: flex; }
      .wizard-mode-banner button {
        padding: 0.3rem 0.7rem;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.2);
        background: transparent;
        color: var(--text);
        cursor: pointer;
        font-size: 0.8rem;
      }
      .wizard-step { display: none; }
      .wizard-step.active { display: block; }
      .step-indicator { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; justify-content: center; }
      .step-dot { width: 12px; height: 12px; border-radius: 50%; background: rgba(255,255,255,0.2); cursor: pointer; transition: all 0.3s; }
      .step-dot.active { background: var(--primary); width: 40px; border-radius: 6px; }
      .step-title { font-size: 1.5rem; font-weight: 700; color: var(--text); margin-bottom: 0.5rem; }
      .step-description { color: var(--text-muted); font-size: 0.95rem; }
      .aspect-ratio-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
      .aspect-ratio-card { background: var(--dark-2); border: 2px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem; text-align: center; cursor: pointer; transition: all 0.3s; }
      .aspect-ratio-card:hover { border-color: var(--primary); background: rgba(108,58,237,0.1); }
      .aspect-ratio-card.selected { border-color: var(--primary); background: linear-gradient(135deg, rgba(108,58,237,0.15), rgba(236,72,153,0.1)); box-shadow: 0 4px 15px rgba(108,58,237,0.2); }
      .aspect-ratio-icon { font-size: 2rem; margin-bottom: 0.5rem; }
      .aspect-ratio-label { font-weight: 600; color: var(--text); margin-bottom: 0.25rem; }
      .aspect-ratio-desc { font-size: 0.8rem; color: var(--text-muted); }
      .caption-carousel { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 1rem; scroll-behavior: smooth; }
      .caption-preset { flex: 0 0 150px; background: var(--dark-2); border: 2px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1rem; cursor: pointer; transition: all 0.3s; text-align: center; }
      .caption-preset:hover { border-color: var(--primary); background: rgba(108,58,237,0.1); }
      .caption-preset.selected { border-color: var(--primary); background: linear-gradient(135deg, rgba(108,58,237,0.15), rgba(236,72,153,0.1)); box-shadow: 0 4px 15px rgba(108,58,237,0.2); }
      .caption-preview { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--primary); height: 40px; display: flex; align-items: center; justify-content: center; }
      .caption-name { font-weight: 600; color: var(--text); font-size: 0.85rem; margin-bottom: 0.25rem; }
      .caption-desc { font-size: 0.7rem; color: var(--text-muted); }
      .logo-section { background: var(--surface); border: var(--border-subtle); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
      .logo-upload { background: linear-gradient(135deg, rgba(108,58,237,0.1), rgba(236,72,153,0.1)); border: 2px dashed var(--primary); border-radius: 12px; padding: 2rem; text-align: center; cursor: pointer; transition: all 0.3s; margin-bottom: 1.5rem; }
      .logo-upload:hover { background: linear-gradient(135deg, rgba(108,58,237,0.2), rgba(236,72,153,0.2)); border-color: var(--primary-light); }
      .logo-upload h3 { margin-bottom: 0.5rem; color: var(--text); }
      .logo-upload p { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem; }
      .upload-button { padding: 0.6rem 1.2rem; background: var(--primary); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s; }
      .upload-button:hover { box-shadow: 0 8px 24px rgba(108,58,237,0.3); transform: translateY(-2px); }
      .logo-preview { background: var(--dark-2); border-radius: 12px; padding: 2rem; text-align: center; margin-bottom: 1.5rem; min-height: 200px; display: flex; align-items: center; justify-content: center; position: relative; }
      .logo-preview-image { max-width: 100%; max-height: 150px; }
      .logo-position-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
      .position-btn { padding: 1rem; background: var(--dark-2); border: 2px solid rgba(255,255,255,0.1); border-radius: 8px; color: var(--text); cursor: pointer; font-weight: 600; transition: all 0.3s; }
      .position-btn:hover { border-color: var(--primary); background: rgba(108,58,237,0.1); }
      .position-btn.selected { border-color: var(--primary); background: linear-gradient(135deg, rgba(108,58,237,0.15), rgba(236,72,153,0.1)); }
      .slider-group { margin-bottom: 1.5rem; }
      .slider-label { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--text-muted); }
      .slider { width: 100%; height: 6px; border-radius: 3px; background: var(--dark-2); outline: none; -webkit-appearance: none; appearance: none; }
      .slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--primary); cursor: pointer; }
      .slider::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--primary); cursor: pointer; border: none; }
      .wizard-buttons { display: flex; gap: 1rem; justify-content: space-between; margin-top: 2rem; }
      .btn-prev, .btn-next, .btn-save { padding: 0.8rem 2rem; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.3s; }
      .btn-prev { background: transparent; color: var(--text); border: 1px solid rgba(255,255,255,0.2); }
      .btn-prev:hover { background: rgba(255,255,255,0.05); border-color: var(--primary); }
      .btn-next, .btn-save { background: var(--gradient-1); color: #fff; box-shadow: 0 4px 20px rgba(108,58,237,0.4); }
      .btn-next:hover, .btn-save:hover { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(108,58,237,0.5); }
      .btn-prev:disabled, .btn-next:disabled, .btn-save:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      /* Modal for name prompt */
      .bt-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 9999; }
      .bt-modal-backdrop.visible { display: flex; }
      .bt-modal {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 1.5rem;
        width: min(420px, 92vw);
      }
      .bt-modal h3 { margin: 0 0 0.75rem; color: var(--text); }
      .bt-modal p { margin: 0 0 1rem; color: var(--text-muted); font-size: 0.9rem; }
      .bt-modal input[type=text] {
        width: 100%;
        padding: 0.6rem 0.8rem;
        border-radius: 8px;
        background: var(--dark-2);
        border: 1px solid rgba(255,255,255,0.1);
        color: var(--text);
        font-size: 1rem;
        margin-bottom: 1rem;
      }
      .bt-modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
      .bt-modal-actions button {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.15);
        background: var(--dark-2);
        color: var(--text);
        cursor: pointer;
        font-weight: 600;
      }
      .bt-modal-actions button.primary { background: var(--gradient-1); border: none; color: #fff; }
      @media (max-width: 768px) {
        .aspect-ratio-grid { grid-template-columns: 1fr; }
        .wizard-container { padding: 0 1rem; }
      }
    </style>
  `;

  const templatesInitial = JSON.stringify(templates).replace(/</g, '\\u003c');

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

        <!-- Saved templates list -->
        <div class="saved-templates-section" id="savedTemplatesSection">
          <div class="saved-templates-header">
            <h2>Your Templates</h2>
            <span class="count" id="templateCount"></span>
          </div>
          <div id="savedTemplatesContainer"></div>
        </div>

        <div class="wizard-mode-banner" id="modeBanner">
          <span id="modeBannerText">Editing template</span>
          <button type="button" onclick="cancelEdit()">Cancel</button>
        </div>

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
            ${Object.entries(aspectRatios).map(([key, value]) => `
              <div class="aspect-ratio-card" data-ratio="${key}" onclick="selectAspectRatio('${key}', this)">
                <div class="aspect-ratio-icon">${value.icon}</div>
                <div class="aspect-ratio-label">${key}</div>
                <div class="aspect-ratio-desc">${value.label}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Step 2: Caption Style -->
        <div class="wizard-step" id="step-2">
          <div class="step-title">Step 2: Choose Caption Style</div>
          <div class="step-description">Select your preferred animation style</div>
          <div class="caption-carousel" style="margin-top: 2rem;">
            ${Object.entries(captionStyles).map(([key, value]) => `
              <div class="caption-preset" data-style="${key}" onclick="selectCaptionStyle('${key}', this)">
                <div class="caption-preview" style="color: ${value.color};">AA</div>
                <div class="caption-name">${value.name}</div>
                <div class="caption-desc">${value.description}</div>
              </div>
            `).join('')}
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
              <button type="button" class="position-btn" data-pos="top-left" onclick="selectLogoPosition('top-left', this)">↖️ Top Left</button>
              <button type="button" class="position-btn" data-pos="top-right" onclick="selectLogoPosition('top-right', this)">↗️ Top Right</button>
              <button type="button" class="position-btn" data-pos="bottom-left" onclick="selectLogoPosition('bottom-left', this)">↙️ Bottom Left</button>
              <button type="button" class="position-btn" data-pos="bottom-right" onclick="selectLogoPosition('bottom-right', this)">↘️ Bottom Right</button>
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

  <!-- Name prompt modal -->
  <div class="bt-modal-backdrop" id="nameModal">
    <div class="bt-modal">
      <h3 id="nameModalTitle">Name your template</h3>
      <p id="nameModalDesc">Give this template a name so you can find it later.</p>
      <input type="text" id="nameModalInput" placeholder="My TikTok brand" maxlength="60">
      <div class="bt-modal-actions">
        <button type="button" onclick="closeNameModal()">Cancel</button>
        <button type="button" class="primary" id="nameModalConfirm">Save</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let currentStep = 1;
    // State for the wizard (draft being built/edited).
    let templateData = {
      aspectRatio: null,
      captionStyle: null,
      logo: null,            // File object if user picked a new file
      logoFilename: null,    // filename on server for existing logo (when editing)
      logoPosition: 'top-right',
      logoSize: 100
    };
    let editingId = null;     // null = new template, otherwise = id we're updating
    // Server-rendered list of templates.
    let savedTemplates = ${templatesInitial};

    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, duration);
    }

    function goToStep(step) {
      if (step >= 1 && step <= 3) { currentStep = step; updateWizard(); }
    }

    function nextStep() {
      if (currentStep < 3) {
        if ((currentStep === 1 && templateData.aspectRatio) || currentStep > 1) {
          currentStep++; updateWizard();
        } else {
          showToast('Please select an aspect ratio');
        }
      }
    }

    function previousStep() {
      if (currentStep > 1) { currentStep--; updateWizard(); }
    }

    function updateWizard() {
      document.querySelectorAll('.wizard-step').forEach((step, idx) => {
        step.classList.toggle('active', idx + 1 === currentStep);
      });
      document.querySelectorAll('.step-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx + 1 === currentStep);
      });
      document.getElementById('prevBtn').style.display = currentStep > 1 ? 'block' : 'none';
      document.getElementById('nextBtn').style.display = currentStep < 3 ? 'block' : 'none';
      document.getElementById('saveBtn').style.display = currentStep === 3 ? 'block' : 'none';
      if (currentStep === 3) {
        document.getElementById('saveBtn').textContent = editingId ? 'Update Template' : 'Save Template';
      }
    }

    function selectAspectRatio(ratio, el) {
      document.querySelectorAll('.aspect-ratio-card').forEach(c => c.classList.remove('selected'));
      if (el) el.classList.add('selected');
      templateData.aspectRatio = ratio;
    }

    function selectCaptionStyle(style, el) {
      document.querySelectorAll('.caption-preset').forEach(p => p.classList.remove('selected'));
      if (el) el.classList.add('selected');
      templateData.captionStyle = style;
    }

    function handleLogoDragOver(e) { e.preventDefault(); e.currentTarget.style.background = 'linear-gradient(135deg, rgba(108,58,237,0.2), rgba(236,72,153,0.2))'; }
    function handleLogoDragLeave(e) { e.preventDefault(); e.currentTarget.style.background = 'linear-gradient(135deg, rgba(108,58,237,0.1), rgba(236,72,153,0.1))'; }
    function handleLogoDrop(e) {
      e.preventDefault();
      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(108,58,237,0.1), rgba(236,72,153,0.1))';
      if (e.dataTransfer.files.length > 0) handleLogoFile(e.dataTransfer.files[0]);
    }
    function handleLogoSelect(e) { if (e.target.files.length > 0) handleLogoFile(e.target.files[0]); }

    function handleLogoFile(file) {
      templateData.logo = file;
      templateData.logoFilename = null; // replacing any existing server-side logo
      document.getElementById('logoFileName').textContent = 'Selected: ' + file.name;
      const reader = new FileReader();
      reader.onload = (e) => {
        const preview = document.getElementById('logoPreview');
        preview.innerHTML = '<img src="' + e.target.result + '" class="logo-preview-image">';
      };
      reader.readAsDataURL(file);
    }

    function selectLogoPosition(position, el) {
      document.querySelectorAll('.position-btn').forEach(b => b.classList.remove('selected'));
      if (el) el.classList.add('selected');
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

    // ----- Saved templates list -----
    function escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderSavedTemplates() {
      const container = document.getElementById('savedTemplatesContainer');
      const countEl = document.getElementById('templateCount');
      countEl.textContent = savedTemplates.length ? savedTemplates.length + ' saved' : '';

      if (!savedTemplates.length) {
        container.innerHTML = '<div class="empty-templates">No saved templates yet. Build one below and click Save Template.</div>';
        return;
      }

      container.innerHTML = '<div class="saved-templates-grid">' + savedTemplates.map(t => {
        const thumb = t.logoFilename
          ? '<img src="/brand-templates/logo/' + encodeURIComponent(t.logoFilename) + '" alt="logo">'
          : (t.aspectRatio || '—');
        const meta = (t.aspectRatio || '?') + ' · ' + (t.captionStyle || '?');
        return '<div class="saved-template-card" data-id="' + escapeHtml(t.id) + '" onclick="loadTemplate(\\'' + t.id + '\\', false)">' +
                 '<div class="saved-template-thumb">' + thumb + '</div>' +
                 '<div class="saved-template-name">' + escapeHtml(t.name || 'Untitled') + '</div>' +
                 '<div class="saved-template-meta">' + escapeHtml(meta) + '</div>' +
                 '<div class="saved-template-actions" onclick="event.stopPropagation();">' +
                   '<button type="button" onclick="renameTemplate(\\'' + t.id + '\\')">Rename</button>' +
                   '<button type="button" onclick="loadTemplate(\\'' + t.id + '\\', true)">Edit</button>' +
                   '<button type="button" onclick="duplicateTemplate(\\'' + t.id + '\\')">Duplicate</button>' +
                   '<button type="button" class="danger" onclick="deleteTemplate(\\'' + t.id + '\\')">Delete</button>' +
                 '</div>' +
               '</div>';
      }).join('') + '</div>';
    }

    function loadTemplate(id, editMode) {
      const t = savedTemplates.find(x => x.id === id);
      if (!t) return;
      editingId = editMode ? id : null;

      templateData = {
        aspectRatio: t.aspectRatio || null,
        captionStyle: t.captionStyle || null,
        logo: null,
        logoFilename: t.logoFilename || null,
        logoPosition: t.logoPosition || 'top-right',
        logoSize: t.logoSize || 100
      };

      // Visual state
      document.querySelectorAll('.aspect-ratio-card').forEach(c => {
        c.classList.toggle('selected', c.getAttribute('data-ratio') === templateData.aspectRatio);
      });
      document.querySelectorAll('.caption-preset').forEach(c => {
        c.classList.toggle('selected', c.getAttribute('data-style') === templateData.captionStyle);
      });
      document.querySelectorAll('.position-btn').forEach(c => {
        c.classList.toggle('selected', c.getAttribute('data-pos') === templateData.logoPosition);
      });
      document.getElementById('logoSize').value = templateData.logoSize;
      document.getElementById('sizeValue').textContent = templateData.logoSize;
      document.getElementById('logoFileName').textContent = templateData.logoFilename ? 'Using saved logo' : '';
      const preview = document.getElementById('logoPreview');
      if (templateData.logoFilename) {
        preview.innerHTML = '<img src="/brand-templates/logo/' + encodeURIComponent(templateData.logoFilename) + '" class="logo-preview-image" style="width: ' + (templateData.logoSize / 100 * 150) + 'px;">';
      } else {
        preview.innerHTML = '<p style="color: var(--text-muted);">Logo preview will appear here</p>';
      }

      // Banner
      const banner = document.getElementById('modeBanner');
      if (editMode) {
        banner.classList.add('visible');
        document.getElementById('modeBannerText').textContent = 'Editing: ' + (t.name || 'Untitled');
      } else {
        banner.classList.remove('visible');
      }

      currentStep = 1;
      updateWizard();
      window.scrollTo({ top: document.querySelector('.wizard-header').offsetTop - 20, behavior: 'smooth' });
    }

    function cancelEdit() {
      editingId = null;
      document.getElementById('modeBanner').classList.remove('visible');
      resetWizard();
    }

    function resetWizard() {
      templateData = { aspectRatio: null, captionStyle: null, logo: null, logoFilename: null, logoPosition: 'top-right', logoSize: 100 };
      document.querySelectorAll('.aspect-ratio-card, .caption-preset, .position-btn').forEach(e => e.classList.remove('selected'));
      document.getElementById('logoSize').value = 100;
      document.getElementById('sizeValue').textContent = 100;
      document.getElementById('logoFileName').textContent = '';
      document.getElementById('logoPreview').innerHTML = '<p style="color: var(--text-muted);">Logo preview will appear here</p>';
      document.getElementById('logoFile').value = '';
      currentStep = 1;
      updateWizard();
    }

    // Name prompt modal
    function openNameModal({ title, description, defaultValue, onConfirm }) {
      document.getElementById('nameModalTitle').textContent = title || 'Name your template';
      document.getElementById('nameModalDesc').textContent = description || '';
      const input = document.getElementById('nameModalInput');
      input.value = defaultValue || '';
      const confirmBtn = document.getElementById('nameModalConfirm');
      const backdrop = document.getElementById('nameModal');
      backdrop.classList.add('visible');
      setTimeout(() => input.focus(), 50);

      const confirm = () => {
        const val = input.value.trim();
        if (!val) { input.focus(); return; }
        closeNameModal();
        onConfirm(val);
      };
      confirmBtn.onclick = confirm;
      input.onkeydown = (e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') closeNameModal(); };
    }
    function closeNameModal() { document.getElementById('nameModal').classList.remove('visible'); }

    async function saveTemplate() {
      if (!templateData.aspectRatio) { showToast('Please select an aspect ratio'); return; }
      if (!templateData.captionStyle) { showToast('Please select a caption style'); return; }

      const existing = editingId ? savedTemplates.find(x => x.id === editingId) : null;
      const defaultName = existing ? existing.name : '';

      openNameModal({
        title: editingId ? 'Rename & update' : 'Name your template',
        description: 'This name is shown in your template list.',
        defaultValue: defaultName,
        onConfirm: async (name) => {
          const btn = document.getElementById('saveBtn');
          btn.disabled = true;
          btn.textContent = editingId ? 'Updating…' : 'Saving…';
          try {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('aspectRatio', templateData.aspectRatio);
            formData.append('captionStyle', templateData.captionStyle);
            formData.append('logoPosition', templateData.logoPosition);
            formData.append('logoSize', templateData.logoSize);
            if (templateData.logo) {
              formData.append('logo', templateData.logo);
            } else if (templateData.logoFilename) {
              formData.append('logoFilename', templateData.logoFilename);
            }

            const url = editingId ? '/brand-templates/' + encodeURIComponent(editingId) : '/brand-templates/save';
            const method = editingId ? 'PUT' : 'POST';
            const response = await fetch(url, { method, body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to save template');

            savedTemplates = data.templates || savedTemplates;
            renderSavedTemplates();
            showToast(editingId ? 'Template updated' : 'Template saved');
            editingId = null;
            document.getElementById('modeBanner').classList.remove('visible');
            resetWizard();
          } catch (err) {
            console.error(err);
            showToast(err.message || 'Error saving template');
          } finally {
            btn.disabled = false;
            btn.textContent = editingId ? 'Update Template' : 'Save Template';
          }
        }
      });
    }

    function renameTemplate(id) {
      const t = savedTemplates.find(x => x.id === id);
      if (!t) return;
      openNameModal({
        title: 'Rename template',
        description: 'Choose a new name.',
        defaultValue: t.name || '',
        onConfirm: async (name) => {
          try {
            const fd = new FormData();
            fd.append('name', name);
            const response = await fetch('/brand-templates/' + encodeURIComponent(id) + '/rename', { method: 'POST', body: fd });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to rename');
            savedTemplates = data.templates;
            renderSavedTemplates();
            showToast('Renamed');
          } catch (err) { showToast(err.message); }
        }
      });
    }

    async function duplicateTemplate(id) {
      try {
        const response = await fetch('/brand-templates/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to duplicate');
        savedTemplates = data.templates;
        renderSavedTemplates();
        showToast('Duplicated');
      } catch (err) { showToast(err.message); }
    }

    async function deleteTemplate(id) {
      const t = savedTemplates.find(x => x.id === id);
      if (!t) return;
      if (!confirm('Delete "' + (t.name || 'Untitled') + '"? This cannot be undone.')) return;
      try {
        const response = await fetch('/brand-templates/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to delete');
        savedTemplates = data.templates;
        renderSavedTemplates();
        if (editingId === id) { editingId = null; document.getElementById('modeBanner').classList.remove('visible'); resetWizard(); }
        showToast('Deleted');
      } catch (err) { showToast(err.message); }
    }

    renderSavedTemplates();

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// POST /save - Create new template
router.post('/save', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { aspectRatio, captionStyle, logoPosition, logoSize } = req.body;
    const name = sanitizeName(req.body.name);
    if (!aspectRatio || !captionStyle) return res.status(400).json({ error: 'Missing required fields' });
    if (!name) return res.status(400).json({ error: 'Template name is required' });

    const templates = readTemplates(req);
    if (templates.length >= 20) return res.status(400).json({ error: 'Template limit reached (20 max). Delete one to add more.' });

    const now = new Date().toISOString();
    const newTemplate = {
      id: uuidv4(),
      name,
      aspectRatio,
      captionStyle,
      logoFilename: req.file ? path.basename(req.file.path) : null,
      logoPosition: logoPosition || 'top-right',
      logoSize: parseInt(logoSize) || 100,
      createdAt: now,
      updatedAt: now
    };
    templates.push(newTemplate);
    writeTemplates(res, templates);
    res.json({ success: true, template: newTemplate, templates });
  } catch (error) {
    console.error('Save template error:', error);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// PUT /:id - Update existing template
router.put('/:id', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { id } = req.params;
    const templates = readTemplates(req);
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });

    const existing = templates[idx];
    const { aspectRatio, captionStyle, logoPosition, logoSize } = req.body;
    const name = sanitizeName(req.body.name) || existing.name;

    // Logo handling: new upload, existing reference, or none
    let logoFilename = existing.logoFilename;
    if (req.file) {
      // New logo uploaded — delete old file to avoid /tmp bloat
      if (existing.logoFilename) {
        const oldPath = path.join(uploadDir, existing.logoFilename);
        if (fs.existsSync(oldPath) && safeFilename(existing.logoFilename)) {
          try { fs.unlinkSync(oldPath); } catch (e) {}
        }
      }
      logoFilename = path.basename(req.file.path);
    } else if (req.body.logoFilename && safeFilename(req.body.logoFilename)) {
      // Keep existing
      logoFilename = req.body.logoFilename;
    }

    templates[idx] = {
      ...existing,
      name,
      aspectRatio: aspectRatio || existing.aspectRatio,
      captionStyle: captionStyle || existing.captionStyle,
      logoFilename,
      logoPosition: logoPosition || existing.logoPosition,
      logoSize: logoSize != null ? parseInt(logoSize) || existing.logoSize : existing.logoSize,
      updatedAt: new Date().toISOString()
    };
    writeTemplates(res, templates);
    res.json({ success: true, template: templates[idx], templates });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// POST /:id/rename - Just rename
router.post('/:id/rename', requireAuth, upload.none(), async (req, res) => {
  try {
    const { id } = req.params;
    const name = sanitizeName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const templates = readTemplates(req);
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });
    templates[idx].name = name;
    templates[idx].updatedAt = new Date().toISOString();
    writeTemplates(res, templates);
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Rename template error:', error);
    res.status(500).json({ error: 'Failed to rename template' });
  }
});

// POST /:id/duplicate
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const templates = readTemplates(req);
    const src = templates.find(t => t.id === id);
    if (!src) return res.status(404).json({ error: 'Template not found' });
    if (templates.length >= 20) return res.status(400).json({ error: 'Template limit reached (20 max).' });

    const now = new Date().toISOString();
    const copy = {
      ...src,
      id: uuidv4(),
      name: (src.name || 'Untitled') + ' (copy)',
      createdAt: now,
      updatedAt: now
    };
    // Note: logoFilename is shared by reference — both templates point to same /tmp file.
    // Deleting one will not delete the file if the other still references it (see DELETE handler).
    templates.push(copy);
    writeTemplates(res, templates);
    res.json({ success: true, template: copy, templates });
  } catch (error) {
    console.error('Duplicate template error:', error);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

// DELETE /:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const templates = readTemplates(req);
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });
    const removed = templates.splice(idx, 1)[0];

    // Only delete the underlying logo file if no remaining template references it
    if (removed.logoFilename && safeFilename(removed.logoFilename)) {
      const stillReferenced = templates.some(t => t.logoFilename === removed.logoFilename);
      if (!stillReferenced) {
        const p = path.join(uploadDir, removed.logoFilename);
        if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
      }
    }

    writeTemplates(res, templates);
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// GET /logo/:filename - Serve a stored logo, but only if the current user's
// cookie references that filename. This prevents enumeration of /tmp files.
router.get('/logo/:filename', requireAuth, (req, res) => {
  try {
    const { filename } = req.params;
    if (!safeFilename(filename)) return res.status(400).send('Bad filename');
    const templates = readTemplates(req);
    const ok = templates.some(t => t.logoFilename === filename);
    if (!ok) return res.status(404).send('Not found');
    const p = path.join(uploadDir, filename);
    if (!fs.existsSync(p)) return res.status(404).send('Not found');
    res.sendFile(p);
  } catch (error) {
    console.error('Serve logo error:', error);
    res.status(500).send('Error');
  }
});

// GET /list - JSON list of saved templates (used by the editor's Brand Kit modal)
// Returns templates with a `logoUrl` field the client can use directly.
router.get('/list', requireAuth, (req, res) => {
  try {
    const templates = readTemplates(req).map(decorate);
    res.json({
      success: true,
      templates,
      captionStyles,
      aspectRatios
    });
  } catch (err) {
    console.error('[brand-templates list]', err);
    res.status(500).json({ error: err.message || 'List failed' });
  }
});

// POST /apply - Apply template to video (unchanged from before)
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { videoPath, templateId } = req.body;
    if (!videoPath || !templateId) return res.status(400).json({ error: 'Missing required fields' });
    if (!fs.existsSync(videoPath)) return res.status(400).json({ error: 'Video file not found' });
    const outputPath = path.join(outputDir, `branded-${uuidv4()}.mp4`);
    fs.copyFileSync(videoPath, outputPath);
    res.json({ success: true, outputPath, downloadUrl: `/api/download/${path.basename(outputPath)}` });
  } catch (error) {
    console.error('Apply template error:', error);
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

module.exports = router;
