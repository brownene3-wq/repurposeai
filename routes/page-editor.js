const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { userOps, pageContentOps } = require('../db/database');

// --- Admin check (same pattern as admin.js) ---
async function requireAdmin(req, res, next) {
  const fullUser = await userOps.getById(req.user.id);
  if (!fullUser || fullUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = fullUser;
  next();
}

// --- Media upload setup ---
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `editor-${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg|mp4|webm|mov/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split('/')[1]);
    cb(null, ext || mime);
  }
});

// ===========================
// API ROUTES
// ===========================

// Load page content (draft or published)
router.get('/api/page-content/:slug', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    const status = req.query.status || 'draft';
    let content = await pageContentOps.get(slug, status);
    // If no draft exists, fall back to published
    if (!content && status === 'draft') {
      content = await pageContentOps.get(slug, 'published');
    }
    res.json({ success: true, content });
  } catch (err) {
    console.error('Load page content error:', err);
    res.status(500).json({ error: 'Failed to load page content' });
  }
});

// Save page content (draft)
router.put('/api/page-content/:slug', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    const { html, css, components, style } = req.body;
    const saved = await pageContentOps.save(slug, { html, css, components, style }, req.user.id);
    res.json({ success: true, content: saved });
  } catch (err) {
    console.error('Save page content error:', err);
    res.status(500).json({ error: 'Failed to save page content' });
  }
});

// Publish page content
router.post('/api/page-content/:slug/publish', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    const published = await pageContentOps.publish(slug, req.user.id);
    if (!published) {
      return res.status(404).json({ error: 'No draft to publish' });
    }
    res.json({ success: true, content: published });
  } catch (err) {
    console.error('Publish page content error:', err);
    res.status(500).json({ error: 'Failed to publish page content' });
  }
});

// Revert draft
router.post('/api/page-content/:slug/revert', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    await pageContentOps.revert(slug);
    res.json({ success: true });
  } catch (err) {
    console.error('Revert page content error:', err);
    res.status(500).json({ error: 'Failed to revert' });
  }
});

// Upload media
router.post('/api/page-editor/upload', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/public/uploads/${req.file.filename}`;
  res.json({ success: true, url, filename: req.file.filename });
});

// ===========================
// EDITOR UI ROUTE
// ===========================
router.get('/editor', requireAuth, requireAdmin, async (req, res) => {
  const slug = req.query.page || 'homepage';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Editor — Splicora Admin</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/grapesjs/0.21.13/css/grapes.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fff; overflow: hidden; }

    /* --- Top toolbar --- */
    .editor-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      height: 56px; background: #111; border-bottom: 1px solid #222;
      padding: 0 20px; z-index: 100; position: relative;
    }
    .editor-toolbar .left { display: flex; align-items: center; gap: 16px; }
    .editor-toolbar .logo {
      font-size: 1.15em; font-weight: 800;
      background: linear-gradient(135deg, #6C3AED, #EC4899);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .editor-toolbar .page-name {
      font-size: .85rem; color: #888; border-left: 1px solid #333;
      padding-left: 16px; display: flex; align-items: center; gap: 8px;
    }
    .editor-toolbar .page-name .dot {
      width: 8px; height: 8px; border-radius: 50%; background: #F59E0B;
    }
    .editor-toolbar .page-name .dot.saved { background: #10B981; }
    .editor-toolbar .center { display: flex; align-items: center; gap: 8px; }
    .editor-toolbar .right { display: flex; align-items: center; gap: 10px; }

    .tb-btn {
      padding: 7px 16px; border-radius: 8px; font-size: .82rem; font-weight: 600;
      cursor: pointer; border: 1px solid #333; background: #1a1a1a; color: #ccc;
      transition: all .2s; display: inline-flex; align-items: center; gap: 6px;
    }
    .tb-btn:hover { background: #222; border-color: #444; color: #fff; }
    .tb-btn.primary {
      background: linear-gradient(135deg, #6C3AED, #8B5CF6);
      border-color: #6C3AED; color: #fff;
    }
    .tb-btn.primary:hover { filter: brightness(1.1); }
    .tb-btn.danger { border-color: #EF4444; color: #EF4444; }
    .tb-btn.danger:hover { background: rgba(239, 68, 68, .15); }
    .tb-btn svg { width: 16px; height: 16px; }

    .device-btns { display: flex; gap: 4px; }
    .device-btns button {
      width: 34px; height: 34px; border-radius: 8px; border: 1px solid #333;
      background: #1a1a1a; color: #888; cursor: pointer; font-size: 1rem;
      display: flex; align-items: center; justify-content: center; transition: all .2s;
    }
    .device-btns button:hover { background: #222; color: #fff; }
    .device-btns button.active { background: rgba(108, 58, 237, .2); border-color: #6C3AED; color: #6C3AED; }

    /* --- Editor layout --- */
    .editor-wrap {
      display: flex; height: calc(100vh - 56px);
    }
    #gjs { flex: 1; overflow: hidden; }

    /* --- Right sidebar panel --- */
    .panel__right {
      width: 260px; min-width: 260px; background: #111;
      border-left: 1px solid #222; display: flex; flex-direction: column;
      overflow: hidden;
    }
    .panel__switcher {
      display: flex; border-bottom: 1px solid #222; background: #0d0d0d;
    }
    .panel__switcher .gjs-pn-btn {
      flex: 1; text-align: center; padding: 10px 4px; font-size: .75rem;
      font-weight: 600; cursor: pointer; color: #888; border: none;
      background: transparent; transition: all .2s;
    }
    .panel__switcher .gjs-pn-btn:hover { color: #ccc; }
    .panel__switcher .gjs-pn-btn.gjs-pn-active {
      color: #6C3AED !important; background: rgba(108, 58, 237, .1) !important;
      border-bottom: 2px solid #6C3AED;
    }
    .panel__content {
      flex: 1; overflow-y: auto; padding: 8px;
    }
    .panel__content > div { display: none; }
    .panel__content > div.active { display: block; }

    /* Override GrapesJS styles for dark theme */
    .gjs-one-bg { background: #111 !important; }
    .gjs-two-color { color: #ccc !important; }
    .gjs-three-bg { background: #1a1a1a !important; }
    .gjs-four-color, .gjs-four-color-h:hover { color: #6C3AED !important; }

    .gjs-cv-canvas { background: #0d0d0d !important; }
    .gjs-frame-wrapper { background: #0d0d0d; }

    /* Side panel */
    .gjs-pn-panel { background: #111 !important; border-color: #222 !important; }
    .gjs-pn-btn { color: #888 !important; border-radius: 6px !important; }
    .gjs-pn-btn.gjs-pn-active { color: #6C3AED !important; background: rgba(108, 58, 237, .15) !important; }

    .gjs-block { background: #1a1a1a !important; border: 1px solid #333 !important; border-radius: 8px !important; color: #ccc !important; min-height: 70px !important; }
    .gjs-block:hover { border-color: #6C3AED !important; }
    .gjs-block__media { color: #888 !important; }

    /* Layers / style manager */
    .gjs-layer { background: #161616 !important; }
    .gjs-layer:hover { background: #1e1e1e !important; }
    .gjs-sm-sector-title { background: #161616 !important; border-color: #222 !important; color: #aaa !important; }
    .gjs-sm-property { color: #aaa !important; }
    .gjs-field { background: #1a1a1a !important; border-color: #333 !important; color: #ddd !important; }
    .gjs-field input, .gjs-field select { color: #ddd !important; }

    /* Toolbar above selected component */
    .gjs-toolbar { background: #6C3AED !important; border-radius: 6px !important; }
    .gjs-toolbar-item { color: #fff !important; }

    /* Badge (component type name) */
    .gjs-badge { background: #6C3AED !important; color: #fff !important; border-radius: 4px !important; }

    /* RTE (rich text editor) toolbar */
    .gjs-rte-toolbar { background: #1a1a1a !important; border: 1px solid #333 !important; border-radius: 8px !important; }
    .gjs-rte-actionbar .gjs-rte-action { color: #ccc !important; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #111; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

    /* Toast notification */
    .editor-toast {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      padding: 12px 24px; border-radius: 10px; font-size: .85rem; font-weight: 600;
      transform: translateY(80px); opacity: 0; transition: all .3s ease;
      pointer-events: none;
    }
    .editor-toast.show { transform: translateY(0); opacity: 1; }
    .editor-toast.success { background: #10B981; color: #fff; }
    .editor-toast.error { background: #EF4444; color: #fff; }
    .editor-toast.info { background: #6C3AED; color: #fff; }

    /* Loading overlay */
    .editor-loading {
      position: fixed; inset: 0; background: rgba(0,0,0,.85);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; flex-direction: column; gap: 16px;
    }
    .editor-loading .spinner {
      width: 40px; height: 40px; border: 3px solid #333;
      border-top-color: #6C3AED; border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .editor-loading p { color: #888; font-size: .9rem; }

    .gjs-editor { width: 100% !important; }
  </style>
</head>
<body>

  <!-- Toolbar -->
  <div class="editor-toolbar">
    <div class="left">
      <a href="/admin" class="logo" style="text-decoration:none;">Splicora</a>
      <div class="page-name">
        <span class="dot" id="statusDot"></span>
        <span>Editing: <strong>${slug}</strong></span>
        <span id="saveStatus" style="font-size:.75rem;color:#666;margin-left:4px;"></span>
      </div>
    </div>
    <div class="center">
      <div class="device-btns">
        <button class="active" id="deviceDesktop" title="Desktop" onclick="setDevice('Desktop')">&#x1F5A5;</button>
        <button id="deviceTablet" title="Tablet" onclick="setDevice('Tablet')">&#x1F4F1;</button>
        <button id="deviceMobile" title="Mobile" onclick="setDevice('Mobile portrait')">&#x1F4F1;</button>
      </div>
    </div>
    <div class="right">
      <button class="tb-btn" onclick="previewPage()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Preview
      </button>
      <button class="tb-btn" onclick="saveDraft()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save Draft
      </button>
      <button class="tb-btn primary" onclick="publishPage()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Publish
      </button>
      <button class="tb-btn danger" onclick="revertDraft()">Revert</button>
    </div>
  </div>

  <!-- GrapesJS Editor -->
  <div class="editor-wrap">
    <div id="gjs"></div>
    <div class="panel__right">
      <div class="panel__switcher" id="panelSwitcher"></div>
      <div class="panel__content" id="panelContent">
        <div id="blocks-container" class="active"></div>
        <div id="styles-container"></div>
        <div id="layers-container"></div>
        <div id="traits-container"></div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="editor-toast" id="toast"></div>

  <!-- Loading -->
  <div class="editor-loading" id="loading">
    <div class="spinner"></div>
    <p>Loading page editor...</p>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/grapesjs/0.21.13/grapes.min.js"></script>
  <script>var PAGE_SLUG = '${slug}';</script>
  <script src="/public/js/page-editor-app.js"></script>
</body>
</html>`;

  res.send(html);
});

module.exports = router;
