const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { getDb } = require('../db/database');

// Platform configuration with SVG icons
const PLATFORMS = [
  { id: 'tiktok', name: 'TikTok', color: '#25F4EE', colorDark: '#00C9B7', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .56.04.81.1v-3.5a6.37 6.37 0 0 0-.81-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.82a4.83 4.83 0 0 1-1-.13z"/></svg>' },
  { id: 'instagram', name: 'Instagram', color: '#E4405F', colorDark: '#F56040', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
  { id: 'youtube', name: 'YouTube', color: '#FF0000', colorDark: '#FF4444', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
  { id: 'facebook', name: 'Facebook', color: '#1877F2', colorDark: '#4B9BFF', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
  { id: 'twitter', name: 'X (Twitter)', color: '#000000', colorDark: '#FFFFFF', type: 'destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  { id: 'linkedin', name: 'LinkedIn', color: '#0A66C2', colorDark: '#3B99FC', type: 'destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
  { id: 'pinterest', name: 'Pinterest', color: '#E60023', colorDark: '#FF4B5C', type: 'destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24 18.635 24 24.003 18.633 24.003 12.013 24.003 5.393 18.635.028 12.017.028z"/></svg>' }
];

// Shared CSS for Repurpose pages
function getDistributeCSS() {
  return `
    /* ─── Filter Tabs (Repurpose.io style) ─── */
    .filter-tabs{display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:2rem;padding:4px;background:rgba(255,255,255,0.04);border-radius:12px;width:fit-content}
    body.light .filter-tabs,html.light .filter-tabs{background:rgba(0,0,0,0.04)}
    .filter-tab{padding:0.55rem 1.3rem;border-radius:10px;font-weight:600;font-size:0.84rem;cursor:pointer;border:none;background:transparent;color:var(--text-muted);transition:all 0.2s;letter-spacing:0.01em}
    .filter-tab:hover{color:var(--text);background:rgba(255,255,255,0.06)}
    body.light .filter-tab:hover,html.light .filter-tab:hover{background:rgba(0,0,0,0.06)}
    .filter-tab.active{background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;box-shadow:0 2px 10px rgba(108,58,237,0.3)}

    /* ─── Gradient Button ─── */
    .btn-gradient{padding:0.65rem 1.6rem;border-radius:50px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;transition:all 0.3s;box-shadow:0 4px 15px rgba(108,58,237,0.3);text-decoration:none;display:inline-flex;align-items:center;gap:0.5rem}
    .btn-gradient:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}

    /* ─── Platform Icon Circles ─── */
    .platform-icon-circle{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;transition:all 0.3s;pointer-events:none}
    .platform-icon-circle svg{width:24px;height:24px;pointer-events:none}
    .platform-icon-circle.lg{width:56px;height:56px;border-radius:16px}
    .platform-icon-circle.lg svg{width:28px;height:28px}
    .platform-icon-circle.xl{width:64px;height:64px;border-radius:18px}
    .platform-icon-circle.xl svg{width:32px;height:32px}

    /* Ensure clicks always hit the parent card, not child SVGs/spans */
    .platform-card > *,.mode-card > *,.account-card > *,.platform-picker-item > *,.delay-btn > *{pointer-events:none}

    /* ─── Modal Overlay ─── */
    .modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:10000;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity 0.25s}
    .modal-overlay.open{display:flex;opacity:1}
    .modal{background:var(--surface);border-radius:20px;border:1px solid rgba(255,255,255,0.1);max-width:560px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 25px 80px rgba(0,0,0,0.5);animation:modalSlide 0.3s ease}
    body.light .modal,html.light .modal{border-color:rgba(0,0,0,0.1);box-shadow:0 25px 80px rgba(0,0,0,0.15)}
    @keyframes modalSlide{from{opacity:0;transform:translateY(20px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
    .modal-header{padding:1.5rem 1.8rem 0;display:flex;align-items:center;justify-content:space-between}
    .modal-header h2{font-size:1.3rem;font-weight:800;margin:0}
    .modal-close{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.06);border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
    body.light .modal-close,html.light .modal-close{background:rgba(0,0,0,0.06)}
    .modal-close:hover{background:rgba(239,68,68,0.15);color:#ef4444}
    .modal-body{padding:1.2rem 1.8rem 1.8rem}
    .modal-subtitle{font-size:0.9rem;color:var(--text-muted);margin:0.5rem 0 1.5rem}

    /* ─── Platform Picker Grid (inside modal) ─── */
    .platform-picker-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.8rem}
    @media(max-width:480px){.platform-picker-grid{grid-template-columns:1fr}}
    .platform-picker-item{display:flex;align-items:center;gap:1rem;padding:1rem 1.2rem;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);cursor:pointer;transition:all 0.25s;text-decoration:none}
    body.light .platform-picker-item,html.light .platform-picker-item{border-color:rgba(0,0,0,0.08);background:rgba(0,0,0,0.02)}
    .platform-picker-item:hover{border-color:rgba(108,58,237,0.4);background:rgba(108,58,237,0.06);transform:translateY(-1px);box-shadow:0 4px 16px rgba(108,58,237,0.12)}
    .platform-picker-item .p-icon{flex-shrink:0}
    .platform-picker-item .p-info{flex:1;min-width:0}
    .platform-picker-item .p-name{font-weight:700;font-size:0.95rem;color:var(--text);margin-bottom:0.15rem}
    .platform-picker-item .p-desc{font-size:0.78rem;color:var(--text-muted)}
    .platform-picker-item .p-arrow{color:var(--text-muted);font-size:0.85rem;transition:transform 0.2s}
    .platform-picker-item:hover .p-arrow{transform:translateX(3px);color:var(--text)}

    /* ─── Toast ─── */
    .splicora-toast{position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:0.88rem;font-weight:500;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,0.3);color:#fff;animation:slideUp 0.3s ease;display:flex;align-items:center;gap:0.6rem}
    .splicora-toast.success{background:linear-gradient(135deg,#10B981,#059669)}
    .splicora-toast.error{background:linear-gradient(135deg,#EF4444,#DC2626)}
    .splicora-toast.info{background:linear-gradient(135deg,#6C3AED,#EC4899)}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
  `;
}

// Helper to render a platform icon circle
function platformIconHTML(platform, size = '') {
  if (!platform) return '<div class="platform-icon-circle ' + size + '" style="background:rgba(255,255,255,0.06);color:#666"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="12">?</text></svg></div>';
  return `<div class="platform-icon-circle ${size}" style="background:${platform.color}18;color:${platform.color}">${platform.svg}</div>`;
}

// Shared toast script
function getToastScript() {
  return `
    function showToast(msg, type) {
      document.querySelectorAll('.splicora-toast').forEach(t => t.remove());
      const toast = document.createElement('div');
      toast.className = 'splicora-toast ' + (type || 'success');
      toast.innerHTML = (type === 'error' ? '✕' : type === 'info' ? 'ℹ' : '✓') + ' ' + msg;
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)'; setTimeout(() => toast.remove(), 300); }, 4000);
    }
  `;
}

// ═══════════════════════════════════════
// GET /distribute — Workflows list page
// ═══════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  const user = req.user;
  let workflows = [];
  let filter = req.query.filter || 'all';

  try {
    const db = getDb();
    const allWorkflows = await db.workflowOps.getByUser(user.id);
    workflows = allWorkflows.filter(w => {
      if (filter === 'auto') return w.auto_publish === true && w.is_active === true;
      if (filter === 'manual') return w.auto_publish === false && w.is_active === true;
      if (filter === 'inactive') return w.is_active === false;
      return true;
    });
  } catch (e) {
    console.error('Workflows load error:', e);
  }

  const css = getBaseCSS();

  res.send(`
    ${getHeadHTML('Repurpose - Splicora')}
    <style>${css}
      ${getDistributeCSS()}
      .workflows-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;gap:1rem;flex-wrap:wrap}
      .workflows-header h1{margin:0;font-size:1.8rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

      .workflows-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1.5rem;margin-bottom:2rem}
      .workflow-card{background:var(--surface);border-radius:18px;padding:1.5rem;border:1px solid rgba(255,255,255,0.06);transition:all 0.3s;position:relative;overflow:hidden}
      body.light .workflow-card,html.light .workflow-card{border-color:rgba(0,0,0,0.06)}
      .workflow-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#6C3AED,#EC4899);opacity:0;transition:opacity 0.3s}
      .workflow-card:hover{border-color:rgba(108,58,237,0.3);box-shadow:0 8px 32px rgba(108,58,237,0.1)}
      .workflow-card:hover::before{opacity:1}
      .workflow-card.inactive{opacity:0.55}
      .workflow-card.inactive::before{background:linear-gradient(90deg,#ef4444,#f97316)}

      .workflow-flow{display:flex;align-items:center;justify-content:center;gap:1.2rem;margin-bottom:1.5rem;padding-bottom:1.2rem;border-bottom:1px solid rgba(255,255,255,0.06)}
      body.light .workflow-flow,html.light .workflow-flow{border-bottom-color:rgba(0,0,0,0.06)}
      .flow-platform{display:flex;flex-direction:column;align-items:center;gap:0.4rem}
      .flow-platform .platform-name{font-size:0.78rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
      .flow-platform .account-name{font-size:0.82rem;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
      .flow-arrow{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(108,58,237,0.1);color:#6C3AED;flex-shrink:0}
      .flow-arrow svg{width:16px;height:16px}

      .workflow-meta{display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-bottom:1.2rem}
      .meta-item{display:flex;flex-direction:column;gap:0.2rem}
      .meta-label{font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;font-weight:600;letter-spacing:0.5px}
      .meta-value{font-size:0.9rem;color:var(--text);font-weight:600}
      .status-pill{display:inline-flex;align-items:center;gap:0.35rem;padding:0.3rem 0.75rem;border-radius:50px;font-size:0.75rem;font-weight:600;width:fit-content}
      .status-pill.active{background:rgba(16,185,129,0.12);color:#10B981}
      .status-pill.inactive{background:rgba(239,68,68,0.12);color:#ef4444}
      .status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}

      .workflow-footer{display:flex;align-items:center;justify-content:space-between;padding-top:1.2rem;border-top:1px solid rgba(255,255,255,0.06)}
      body.light .workflow-footer,html.light .workflow-footer{border-top-color:rgba(0,0,0,0.06)}
      .toggle-container{display:flex;align-items:center;gap:0.6rem;font-size:0.82rem;color:var(--text-muted)}
      .toggle-switch{position:relative;width:40px;height:22px;flex-shrink:0}
      .toggle-switch input{opacity:0;width:0;height:0}
      .toggle-track{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.1);border-radius:22px;transition:0.3s}
      body.light .toggle-track,html.light .toggle-track{background:rgba(0,0,0,0.1)}
      .toggle-track::before{content:'';position:absolute;height:16px;width:16px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.2)}
      .toggle-switch input:checked+.toggle-track{background:#6C3AED}
      .toggle-switch input:checked+.toggle-track::before{transform:translateX(18px)}
      .wf-actions{display:flex;gap:0.5rem}
      .btn-wf{padding:0.4rem 0.85rem;border-radius:8px;font-weight:600;font-size:0.78rem;cursor:pointer;border:1px solid;transition:all 0.2s;background:transparent}
      .btn-wf.view{border-color:rgba(108,58,237,0.3);color:#6C3AED}
      .btn-wf.view:hover{background:rgba(108,58,237,0.1);border-color:#6C3AED}
      .btn-wf.delete{border-color:rgba(239,68,68,0.2);color:#ef4444}
      .btn-wf.delete:hover{background:rgba(239,68,68,0.1);border-color:#ef4444}

      .empty-state{text-align:center;padding:4rem 2rem;color:var(--text-muted)}
      .empty-state .empty-icon{font-size:3.5rem;margin-bottom:1rem;opacity:0.4}
      .empty-state h3{font-size:1.3rem;margin-bottom:0.5rem;color:var(--text)}
      .empty-state p{font-size:0.9rem;margin-bottom:1.5rem;max-width:400px;margin-left:auto;margin-right:auto}

      .tab-subnav{display:flex;gap:1rem;margin-bottom:2rem;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:0}
      body.light .tab-subnav,html.light .tab-subnav{border-bottom-color:rgba(0,0,0,0.06)}
      .tab-subnav a{color:var(--text-muted);text-decoration:none;padding:0.8rem 0;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;transition:all 0.2s}
      .tab-subnav a:hover{color:var(--text)}
      .tab-subnav a.active{color:#6C3AED;border-bottom-color:#6C3AED}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="workflows-header">
          <div>
            <h1>Repurpose</h1>
            <p style="color:var(--text-muted);font-size:0.95rem;margin:0.5rem 0 0">Automate posting content across platforms</p>
          </div>
          <a href="/distribute/create" class="btn-gradient">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Workflow
          </a>
        </div>

        <div class="tab-subnav">
          <a href="/distribute" class="active">Workflows</a>
          <a href="/distribute/connections">Connected Accounts</a>
        </div>

        <div class="filter-tabs">
          <button class="filter-tab ${filter === 'all' ? 'active' : ''}" onclick="filterWorkflows('all')">All</button>
          <button class="filter-tab ${filter === 'auto' ? 'active' : ''}" onclick="filterWorkflows('auto')">Auto-Publish</button>
          <button class="filter-tab ${filter === 'manual' ? 'active' : ''}" onclick="filterWorkflows('manual')">Manual</button>
          <button class="filter-tab ${filter === 'inactive' ? 'active' : ''}" onclick="filterWorkflows('inactive')">Inactive</button>
        </div>

        ${workflows.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📡</div>
            <h3>${filter === 'all' ? 'No workflows yet' : 'No ' + filter + ' workflows'}</h3>
            <p>${filter === 'all' ? 'Create your first repurposing workflow to start automatically posting content across platforms.' : 'No workflows match the selected filter.'}</p>
            ${filter === 'all' ? `<a href="/distribute/create" class="btn-gradient">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Workflow
            </a>` : ''}
          </div>
        ` : `
          <div class="workflows-grid">
            ${workflows.map(w => {
              const sourcePlatform = PLATFORMS.find(p => p.id === w.source_platform);
              const destPlatform = PLATFORMS.find(p => p.id === w.destination_platform);
              const isInactive = !w.is_active;
              const isAuto = w.auto_publish;

              return `
                <div class="workflow-card ${isInactive ? 'inactive' : ''}">
                  <div class="workflow-flow">
                    <div class="flow-platform">
                      ${platformIconHTML(sourcePlatform)}
                      <span class="platform-name">${sourcePlatform?.name || w.source_platform}</span>
                      <div class="account-name" title="${w.source_username || ''}">${w.source_username || 'Account'}</div>
                    </div>
                    <div class="flow-arrow">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </div>
                    <div class="flow-platform">
                      ${platformIconHTML(destPlatform)}
                      <span class="platform-name">${destPlatform?.name || w.destination_platform}</span>
                      <div class="account-name" title="${w.dest_username || ''}">${w.dest_username || 'Account'}</div>
                    </div>
                  </div>

                  <div class="workflow-meta">
                    <div class="meta-item">
                      <span class="meta-label">Status</span>
                      <span class="status-pill ${isInactive ? 'inactive' : 'active'}">
                        <span class="status-dot"></span>
                        ${isInactive ? 'Inactive' : 'Active'}
                      </span>
                    </div>
                    <div class="meta-item">
                      <span class="meta-label">Posts Sent</span>
                      <span class="meta-value">${w.post_count || 0}</span>
                    </div>
                  </div>

                  <div class="workflow-footer">
                    <div class="toggle-container">
                      <span>Auto</span>
                      <label class="toggle-switch">
                        <input type="checkbox" ${isAuto ? 'checked' : ''} onchange="toggleAutoPublish('${w.id}', this)">
                        <span class="toggle-track"></span>
                      </label>
                    </div>
                    <div class="wf-actions">
                      <a href="/distribute/workflow/${w.id}" class="btn-wf view">Details</a>
                      <button class="btn-wf delete" onclick="deleteWorkflow('${w.id}')">Delete</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>

    <script>
      ${getThemeScript()}
      ${getToastScript()}

      function filterWorkflows(filter) {
        window.location.href = '/distribute?filter=' + filter;
      }

      async function toggleAutoPublish(workflowId, checkbox) {
        const enabled = checkbox.checked;
        try {
          const res = await fetch('/distribute/api/workflow/' + workflowId + '/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_publish: enabled })
          });
          if (!res.ok) throw new Error('Failed to update');
          showToast('Workflow updated', 'success');
        } catch (e) {
          checkbox.checked = !enabled;
          showToast(e.message || 'Failed to update workflow', 'error');
        }
      }

      function deleteWorkflow(workflowId) {
        if (!confirm('Delete this workflow? This cannot be undone.')) return;
        fetch('/distribute/api/workflow/' + workflowId, { method: 'DELETE' })
          .then(r => r.json())
          .then(d => {
            if (d.success) {
              showToast('Workflow deleted', 'success');
              setTimeout(() => location.reload(), 1000);
            } else {
              showToast(d.error || 'Failed to delete', 'error');
            }
          })
          .catch(e => showToast('Failed to delete', 'error'));
      }
    </script>
    </body></html>
  `);
});

// ═══════════════════════════════════════
// GET /distribute/create — Create Workflow
// ═══════════════════════════════════════
router.get('/create', requireAuth, async (req, res) => {
  const user = req.user;
  let connections = [];

  try {
    const db = getDb();
    connections = await db.connectedAccountOps.getByUser(user.id);
  } catch (e) {
    console.error('Connections load error:', e);
  }

  const connectionsByPlatform = {};
  connections.forEach(c => {
    if (!connectionsByPlatform[c.platform]) connectionsByPlatform[c.platform] = [];
    connectionsByPlatform[c.platform].push(c);
  });

  const css = getBaseCSS();

  res.send(`
    ${getHeadHTML('Create Workflow - Splicora')}
    <style>${css}
      ${getDistributeCSS()}

      /* ─── Step Indicator ─── */
      .step-bar{display:flex;align-items:center;gap:0;margin-bottom:2.5rem;overflow-x:auto;padding-bottom:0.5rem}
      .step-indicator{display:flex;align-items:center;gap:0.6rem;padding:0.6rem 1.2rem;border-radius:50px;font-weight:600;font-size:0.82rem;color:var(--text-muted);white-space:nowrap;transition:all 0.3s;background:transparent;cursor:default;position:relative}
      .step-indicator .step-num{width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;transition:all 0.3s;flex-shrink:0}
      body.light .step-indicator .step-num,html.light .step-indicator .step-num{background:rgba(0,0,0,0.06)}
      .step-indicator.active{color:var(--text)}
      .step-indicator.active .step-num{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;box-shadow:0 2px 10px rgba(108,58,237,0.3)}
      .step-indicator.done{color:#10B981}
      .step-indicator.done .step-num{background:rgba(16,185,129,0.15);color:#10B981}
      .step-connector{width:24px;height:2px;background:rgba(255,255,255,0.08);flex-shrink:0;margin:0 -0.2rem}
      body.light .step-connector,html.light .step-connector{background:rgba(0,0,0,0.08)}
      .step-connector.done{background:#10B981}

      /* ─── Step Content ─── */
      .step-content{display:none;animation:fadeIn 0.3s ease}
      .step-content.active{display:block}
      @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      .step-title{font-size:1.5rem;font-weight:800;margin-bottom:0.5rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
      .step-desc{color:var(--text-muted);font-size:0.95rem;margin-bottom:2rem}

      /* ─── Platform Grid (Create flow) ─── */
      .platform-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem;margin-bottom:2rem}
      .platform-card{padding:1.5rem 1rem;border-radius:16px;border:2px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);color:var(--text);cursor:pointer;transition:all 0.3s;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:0.8rem;text-align:center}
      body.light .platform-card,html.light .platform-card{border-color:rgba(0,0,0,0.06);background:rgba(0,0,0,0.02)}
      .platform-card:hover{border-color:rgba(108,58,237,0.3);background:rgba(108,58,237,0.04);transform:translateY(-2px)}
      .platform-card.selected{border-color:#6C3AED;background:rgba(108,58,237,0.1);box-shadow:0 4px 20px rgba(108,58,237,0.15)}
      .platform-card .p-label{font-size:0.85rem}

      /* ─── Account Cards ─── */
      .account-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem}
      .account-card{padding:1.2rem;border-radius:14px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);cursor:pointer;transition:all 0.3s;text-align:center}
      body.light .account-card,html.light .account-card{border-color:rgba(0,0,0,0.06);background:rgba(0,0,0,0.02)}
      .account-card:hover{border-color:rgba(108,58,237,0.3);background:rgba(108,58,237,0.04)}
      .account-card.selected{border-color:#6C3AED;background:rgba(108,58,237,0.1);box-shadow:0 4px 16px rgba(108,58,237,0.12)}
      .account-card .acc-name{font-size:0.95rem;font-weight:700;color:var(--text);margin-bottom:0.3rem}
      .account-card .acc-platform{font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;font-weight:600}
      .no-accounts-hint{padding:1.5rem;background:rgba(108,58,237,0.04);border-radius:14px;border:1px dashed rgba(108,58,237,0.2);margin-bottom:1.5rem;display:flex;align-items:center;gap:1rem}
      .no-accounts-hint .hint-icon{font-size:1.5rem;flex-shrink:0}
      .no-accounts-hint p{margin:0;font-size:0.88rem;color:var(--text-muted)}
      .no-accounts-hint a{color:#6C3AED;font-weight:600;text-decoration:none}
      .no-accounts-hint a:hover{text-decoration:underline}

      /* ─── Mode Selector ─── */
      .mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
      @media(max-width:600px){.mode-grid{grid-template-columns:1fr}}
      .mode-card{padding:1.8rem 1.5rem;border-radius:18px;border:2px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);cursor:pointer;transition:all 0.3s;display:flex;flex-direction:column;gap:0.8rem}
      body.light .mode-card,html.light .mode-card{border-color:rgba(0,0,0,0.06);background:rgba(0,0,0,0.02)}
      .mode-card:hover{border-color:rgba(108,58,237,0.3);background:rgba(108,58,237,0.04);transform:translateY(-2px)}
      .mode-card.selected{border-color:#6C3AED;background:rgba(108,58,237,0.1);box-shadow:0 4px 20px rgba(108,58,237,0.15)}
      .mode-card .mode-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.15));display:flex;align-items:center;justify-content:center;font-size:1.4rem}
      .mode-card .mode-title{font-size:1.05rem;font-weight:700;color:var(--text)}
      .mode-card .mode-desc{font-size:0.85rem;color:var(--text-muted);line-height:1.5}

      /* ─── Flow Preview ─── */
      .flow-preview-box{display:flex;align-items:center;justify-content:center;gap:2rem;padding:2rem;background:rgba(108,58,237,0.04);border-radius:18px;margin-bottom:2rem;border:1px solid rgba(108,58,237,0.08)}
      body.light .flow-preview-box,html.light .flow-preview-box{background:rgba(108,58,237,0.02)}
      .flow-preview-platform{display:flex;flex-direction:column;align-items:center;gap:0.5rem;text-align:center}
      .flow-preview-label{font-size:0.78rem;color:var(--text-muted);text-transform:uppercase;font-weight:600;letter-spacing:0.5px}
      .flow-preview-name{font-size:0.9rem;font-weight:700;color:var(--text)}
      .flow-preview-arrow{width:48px;height:48px;border-radius:50%;background:rgba(108,58,237,0.1);display:flex;align-items:center;justify-content:center;color:#6C3AED}
      .flow-preview-arrow svg{width:20px;height:20px}

      /* ─── Settings ─── */
      .settings-card{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.06);margin-bottom:1.5rem}
      body.light .settings-card,html.light .settings-card{border-color:rgba(0,0,0,0.06)}
      .settings-card h3{margin:0 0 1rem;font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.5rem}
      .delay-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.8rem;margin-bottom:1rem}
      .delay-btn{padding:0.9rem;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);cursor:pointer;transition:all 0.25s;text-align:center;font-weight:600;font-size:0.88rem;color:var(--text)}
      body.light .delay-btn,html.light .delay-btn{border-color:rgba(0,0,0,0.06);background:rgba(0,0,0,0.02)}
      .delay-btn:hover{border-color:rgba(108,58,237,0.3)}
      .delay-btn.selected{border-color:#6C3AED;background:rgba(108,58,237,0.1);color:#6C3AED}
      .time-input{padding:0.65rem 1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:0.9rem;outline:none;transition:border 0.2s}
      body.light .time-input,html.light .time-input{border-color:rgba(0,0,0,0.1);background:#f8f9fc}
      .time-input:focus{border-color:#6C3AED}

      /* ─── Action Buttons ─── */
      .actions-row{display:flex;gap:1rem;margin-top:2rem}
      .btn-step{padding:0.7rem 1.8rem;border-radius:50px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;transition:all 0.3s}
      .btn-step.next{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
      .btn-step.next:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}
      .btn-step.next:disabled{opacity:0.4;cursor:not-allowed;transform:none}
      .btn-step.prev{background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text)}
      body.light .btn-step.prev,html.light .btn-step.prev{border-color:rgba(0,0,0,0.15)}
      .btn-step.prev:hover{border-color:var(--text);background:rgba(255,255,255,0.04)}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div style="max-width:900px">
          <a href="/distribute" style="display:inline-flex;align-items:center;gap:0.5rem;color:#6C3AED;text-decoration:none;font-weight:600;margin-bottom:1.5rem;font-size:0.9rem">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Workflows
          </a>
          <h1 style="font-size:2rem;font-weight:800;margin-bottom:0.5rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Create Workflow</h1>
          <p style="color:var(--text-muted);font-size:0.95rem;margin-bottom:2rem">Set up automated content repurposing in a few steps</p>

          <div class="step-bar">
            <div class="step-indicator active" data-step="1"><span class="step-num">1</span> Mode</div>
            <div class="step-connector"></div>
            <div class="step-indicator" data-step="2"><span class="step-num">2</span> Source</div>
            <div class="step-connector"></div>
            <div class="step-indicator" data-step="3"><span class="step-num">3</span> Account</div>
            <div class="step-connector"></div>
            <div class="step-indicator" data-step="4"><span class="step-num">4</span> Destination</div>
            <div class="step-connector"></div>
            <div class="step-indicator" data-step="5"><span class="step-num">5</span> Account</div>
            <div class="step-connector"></div>
            <div class="step-indicator" data-step="6"><span class="step-num">6</span> Configure</div>
          </div>

          <!-- Step 1: Mode -->
          <div class="step-content active" data-step="1">
            <h2 class="step-title">Choose Workflow Mode</h2>
            <p class="step-desc">How would you like to repurpose your content?</p>
            <div class="mode-grid">
              <div class="mode-card" onclick="selectMode('auto-publish', this)">
                <div class="mode-icon">📤</div>
                <div class="mode-title">Auto-Publish New Posts</div>
                <div class="mode-desc">Automatically repurpose new content from your source platform to your destination — hands-free.</div>
              </div>
              <div class="mode-card" onclick="selectMode('schedule-existing', this)">
                <div class="mode-icon">📅</div>
                <div class="mode-title">Schedule Existing Content</div>
                <div class="mode-desc">Pick specific posts from your library and schedule them for optimal posting times.</div>
              </div>
            </div>
            <div class="actions-row">
              <button class="btn-step next" onclick="nextStep()" disabled id="nextBtn1">Next Step →</button>
            </div>
          </div>

          <!-- Step 2: Source Platform -->
          <div class="step-content" data-step="2">
            <h2 class="step-title">Select Source Platform</h2>
            <p class="step-desc">Which platform will you pull content from?</p>
            <div class="platform-grid" id="sourcePlatforms">
              ${PLATFORMS.filter(p => p.type !== 'destination').map(p => `
                <div class="platform-card" onclick="selectPlatform('source', '${p.id}', this)">
                  ${platformIconHTML(p, 'lg')}
                  <span class="p-label">${p.name}</span>
                </div>
              `).join('')}
            </div>
            <div class="actions-row">
              <button class="btn-step prev" onclick="prevStep()">← Back</button>
              <button class="btn-step next" onclick="nextStep()" disabled id="nextBtn2">Next Step →</button>
            </div>
          </div>

          <!-- Step 3: Source Account -->
          <div class="step-content" data-step="3">
            <h2 class="step-title">Select Source Account</h2>
            <p class="step-desc">Choose which connected account to pull content from</p>
            <div class="account-grid" id="sourceAccounts"></div>
            <div class="no-accounts-hint" id="noSourceHint" style="display:none">
              <span class="hint-icon">🔗</span>
              <p>No accounts connected for this platform yet. <a href="/distribute/connections">Add a connection</a> first, then come back here.</p>
            </div>
            <div class="actions-row">
              <button class="btn-step prev" onclick="prevStep()">← Back</button>
              <button class="btn-step next" onclick="nextStep()" disabled id="nextBtn3">Next Step →</button>
            </div>
          </div>

          <!-- Step 4: Destination Platform -->
          <div class="step-content" data-step="4">
            <h2 class="step-title">Select Destination Platform</h2>
            <p class="step-desc">Where should your content be posted to?</p>
            <div class="platform-grid" id="destPlatforms">
              ${PLATFORMS.map(p => `
                <div class="platform-card" onclick="selectPlatform('dest', '${p.id}', this)">
                  ${platformIconHTML(p, 'lg')}
                  <span class="p-label">${p.name}</span>
                </div>
              `).join('')}
            </div>
            <div class="actions-row">
              <button class="btn-step prev" onclick="prevStep()">← Back</button>
              <button class="btn-step next" onclick="nextStep()" disabled id="nextBtn4">Next Step →</button>
            </div>
          </div>

          <!-- Step 5: Destination Account -->
          <div class="step-content" data-step="5">
            <h2 class="step-title">Select Destination Account</h2>
            <p class="step-desc">Which account should receive the posts?</p>
            <div class="account-grid" id="destAccounts"></div>
            <div class="no-accounts-hint" id="noDestHint" style="display:none">
              <span class="hint-icon">🔗</span>
              <p>No accounts connected for this platform yet. <a href="/distribute/connections">Add a connection</a> first, then come back here.</p>
            </div>
            <div class="actions-row">
              <button class="btn-step prev" onclick="prevStep()">← Back</button>
              <button class="btn-step next" onclick="nextStep()" disabled id="nextBtn5">Next Step →</button>
            </div>
          </div>

          <!-- Step 6: Configure -->
          <div class="step-content" data-step="6">
            <h2 class="step-title">Configure & Create</h2>
            <p class="step-desc">Review your workflow and set posting preferences</p>

            <div class="flow-preview-box">
              <div class="flow-preview-platform">
                <div id="previewSourceIcon"></div>
                <div class="flow-preview-label">Source</div>
                <div class="flow-preview-name" id="previewSourceName">—</div>
              </div>
              <div class="flow-preview-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </div>
              <div class="flow-preview-platform">
                <div id="previewDestIcon"></div>
                <div class="flow-preview-label">Destination</div>
                <div class="flow-preview-name" id="previewDestName">—</div>
              </div>
            </div>

            <div class="settings-card">
              <h3>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Posting Schedule
              </h3>
              <div class="delay-grid">
                <button class="delay-btn selected" onclick="selectDelay('immediate', this)">Immediately</button>
                <button class="delay-btn" onclick="selectDelay('custom', this)">Custom Delay</button>
                <button class="delay-btn" onclick="selectDelay('time-slot', this)">Specific Time</button>
              </div>
              <div id="delayCustom" style="display:none;margin-top:0.8rem">
                <label style="display:block;margin-bottom:0.4rem;color:var(--text-muted);font-size:0.85rem;font-weight:600">Post after (hours):</label>
                <input type="number" id="delayHours" min="0" max="168" value="0" class="time-input" style="max-width:200px" />
              </div>
              <div id="delaySlot" style="display:none;margin-top:0.8rem">
                <label style="display:block;margin-bottom:0.4rem;color:var(--text-muted);font-size:0.85rem;font-weight:600">Post at:</label>
                <input type="time" id="timeSlot" class="time-input" style="max-width:200px" />
              </div>
            </div>

            <div class="actions-row">
              <button class="btn-step prev" onclick="prevStep()">← Back</button>
              <button class="btn-step next" onclick="createWorkflow()" id="createBtn">Create Workflow ✓</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      ${getThemeScript()}
      ${getToastScript()}

      const connectionsByPlatform = ${JSON.stringify(connectionsByPlatform)};
      const PLATFORMS_DATA = ${JSON.stringify(PLATFORMS.map(p => ({ id: p.id, name: p.name, color: p.color, svg: p.svg })))};
      let state = { mode:null, sourcePlatform:null, sourceAccountId:null, destPlatform:null, destAccountId:null, delayMode:'immediate', delayHours:0, timeSlot:null };
      let currentStep = 1;

      function selectMode(mode, el) {
        state.mode = mode;
        document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('nextBtn1').disabled = false;
      }

      function selectPlatform(type, platformId, el) {
        const container = type === 'source' ? 'sourcePlatforms' : 'destPlatforms';
        document.querySelectorAll('#' + container + ' .platform-card').forEach(p => p.classList.remove('selected'));
        el.classList.add('selected');
        if (type === 'source') { state.sourcePlatform = platformId; document.getElementById('nextBtn2').disabled = false; }
        else { state.destPlatform = platformId; document.getElementById('nextBtn4').disabled = false; }
      }

      function selectAccount(type, accountId, el) {
        const container = type === 'source' ? 'sourceAccounts' : 'destAccounts';
        document.querySelectorAll('#' + container + ' .account-card').forEach(a => a.classList.remove('selected'));
        el.classList.add('selected');
        if (type === 'source') { state.sourceAccountId = accountId; document.getElementById('nextBtn3').disabled = false; }
        else { state.destAccountId = accountId; document.getElementById('nextBtn5').disabled = false; }
        updatePreview();
      }

      function selectDelay(mode, el) {
        state.delayMode = mode;
        document.querySelectorAll('.delay-btn').forEach(d => d.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('delayCustom').style.display = mode === 'custom' ? 'block' : 'none';
        document.getElementById('delaySlot').style.display = mode === 'time-slot' ? 'block' : 'none';
      }

      function updatePreview() {
        const src = PLATFORMS_DATA.find(p => p.id === state.sourcePlatform);
        const dst = PLATFORMS_DATA.find(p => p.id === state.destPlatform);
        if (src) {
          document.getElementById('previewSourceIcon').innerHTML = '<div class="platform-icon-circle lg" style="background:' + src.color + '18;color:' + src.color + '">' + src.svg + '</div>';
          document.getElementById('previewSourceName').textContent = src.name;
        }
        if (dst) {
          document.getElementById('previewDestIcon').innerHTML = '<div class="platform-icon-circle lg" style="background:' + dst.color + '18;color:' + dst.color + '">' + dst.svg + '</div>';
          document.getElementById('previewDestName').textContent = dst.name;
        }
      }

      function populateAccountSelector(type) {
        const platform = type === 'source' ? state.sourcePlatform : state.destPlatform;
        const accounts = connectionsByPlatform[platform] || [];
        const selector = document.getElementById(type === 'source' ? 'sourceAccounts' : 'destAccounts');
        const hint = document.getElementById(type === 'source' ? 'noSourceHint' : 'noDestHint');

        if (accounts.length === 0) {
          selector.innerHTML = '';
          hint.style.display = 'flex';
        } else {
          hint.style.display = 'none';
          selector.innerHTML = accounts.map(acc =>
            '<div class="account-card" onclick="selectAccount(\\'' + type + '\\', \\'' + acc.id + '\\', this)"><div class="acc-name">' + (acc.account_name || acc.platform_username) + '</div><div class="acc-platform">' + acc.platform + '</div></div>'
          ).join('');
        }
      }

      function showStep(step) {
        document.querySelectorAll('.step-content').forEach(s => s.classList.remove('active'));
        document.querySelector('.step-content[data-step="' + step + '"]').classList.add('active');
        if (step === 3) populateAccountSelector('source');
        if (step === 5) populateAccountSelector('dest');
        if (step === 6) updatePreview();
        updateStepIndicators();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      function updateStepIndicators() {
        document.querySelectorAll('.step-indicator').forEach((s, i) => {
          const n = i + 1;
          s.classList.remove('active', 'done');
          if (n === currentStep) s.classList.add('active');
          else if (n < currentStep) s.classList.add('done');
        });
        document.querySelectorAll('.step-connector').forEach((c, i) => {
          c.classList.toggle('done', i + 1 < currentStep);
        });
      }

      function nextStep() { if (currentStep < 6) { currentStep++; showStep(currentStep); } }
      function prevStep() { if (currentStep > 1) { currentStep--; showStep(currentStep); } }

      async function createWorkflow() {
        state.delayHours = state.delayMode === 'custom' ? parseInt(document.getElementById('delayHours').value) || 0 : 0;
        state.timeSlot = state.delayMode === 'time-slot' ? document.getElementById('timeSlot').value : null;
        if (!state.mode || !state.sourcePlatform || !state.sourceAccountId || !state.destPlatform || !state.destAccountId) {
          showToast('Please complete all steps', 'error'); return;
        }
        const btn = document.getElementById('createBtn');
        btn.disabled = true; btn.textContent = 'Creating...';
        try {
          const res = await fetch('/distribute/api/workflow', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: state.mode, sourcePlatform: state.sourcePlatform, sourceAccountId: state.sourceAccountId, destPlatform: state.destPlatform, destAccountId: state.destAccountId, delayMode: state.delayMode, delayHours: state.delayHours, timeSlot: state.timeSlot })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to create workflow');
          showToast('Workflow created!', 'success');
          setTimeout(() => window.location.href = '/distribute', 1200);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Create Workflow ✓';
          showToast(e.message || 'Failed to create workflow', 'error');
        }
      }
    </script>
    </body></html>
  `);
});

// ═══════════════════════════════════════
// GET /distribute/connections — Connected Accounts
// ═══════════════════════════════════════
router.get('/connections', requireAuth, async (req, res) => {
  const user = req.user;
  let connections = [];
  const filter = req.query.filter || 'all';

  try {
    const db = getDb();
    let allConnections = await db.connectedAccountOps.getByUser(user.id);
    connections = allConnections.filter(c => {
      if (filter === 'source') return c.account_type !== 'destination';
      if (filter === 'destination') return c.account_type !== 'source';
      if (filter === 'inactive') return !c.is_active;
      return true;
    });
  } catch (e) {
    console.error('Connections load error:', e);
  }

  const css = getBaseCSS();

  // Platform descriptions for the modal
  const platformDescriptions = {
    tiktok: 'Short-form video content',
    instagram: 'Photos, Reels & Stories',
    youtube: 'Long & short-form video',
    facebook: 'Posts, Reels & Stories',
    twitter: 'Text posts & threads',
    linkedin: 'Professional content',
    pinterest: 'Pins & visual content'
  };

  res.send(`
    ${getHeadHTML('Connected Accounts - Splicora')}
    <style>${css}
      ${getDistributeCSS()}
      .connections-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;gap:1rem;flex-wrap:wrap}
      .connections-header h1{margin:0;font-size:1.8rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

      .tab-subnav{display:flex;gap:1rem;margin-bottom:2rem;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:0}
      body.light .tab-subnav,html.light .tab-subnav{border-bottom-color:rgba(0,0,0,0.06)}
      .tab-subnav a{color:var(--text-muted);text-decoration:none;padding:0.8rem 0;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;transition:all 0.2s}
      .tab-subnav a:hover{color:var(--text)}
      .tab-subnav a.active{color:#6C3AED;border-bottom-color:#6C3AED}

      .connections-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem}

      .connection-card{background:var(--surface);border-radius:18px;padding:1.5rem;border:1px solid rgba(255,255,255,0.06);position:relative;transition:all 0.3s;overflow:hidden}
      body.light .connection-card,html.light .connection-card{border-color:rgba(0,0,0,0.06)}
      .connection-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;opacity:0;transition:opacity 0.3s}
      .connection-card:hover{border-color:rgba(108,58,237,0.3);box-shadow:0 8px 32px rgba(108,58,237,0.1)}
      .connection-card:hover::before{opacity:1}
      .connection-card.inactive{opacity:0.55}
      .conn-top{display:flex;align-items:center;gap:1rem;margin-bottom:1.2rem}
      .conn-info{flex:1;min-width:0}
      .conn-platform-name{font-size:1rem;font-weight:700;color:var(--text);margin-bottom:0.15rem}
      .conn-account-name{font-size:0.85rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .conn-status{display:inline-flex;align-items:center;gap:0.35rem;padding:0.3rem 0.75rem;border-radius:50px;font-size:0.73rem;font-weight:600}
      .conn-status.active{background:rgba(16,185,129,0.12);color:#10B981}
      .conn-status.expired{background:rgba(239,68,68,0.12);color:#ef4444}
      .conn-status.inactive{background:rgba(239,68,68,0.12);color:#ef4444}
      .conn-meta{font-size:0.78rem;color:var(--text-muted);padding:0.8rem;border-radius:10px;background:rgba(255,255,255,0.02);margin-bottom:1.2rem;display:flex;align-items:center;gap:0.5rem}
      body.light .conn-meta,html.light .conn-meta{background:rgba(0,0,0,0.02)}
      .conn-actions{display:flex;gap:0.5rem}
      .btn-reconnect{padding:0.4rem 0.85rem;border-radius:8px;font-weight:600;font-size:0.78rem;cursor:pointer;border:1px solid rgba(108,58,237,0.3);background:transparent;color:#6C3AED;transition:all 0.2s}
      .btn-reconnect:hover{background:rgba(108,58,237,0.1);border-color:#6C3AED}
      .btn-disconnect{padding:0.4rem 0.85rem;border-radius:8px;font-weight:600;font-size:0.78rem;cursor:pointer;border:1px solid rgba(239,68,68,0.2);background:transparent;color:#ef4444;transition:all 0.2s}
      .btn-disconnect:hover{background:rgba(239,68,68,0.1);border-color:#ef4444}

      .empty-state{text-align:center;padding:4rem 2rem;color:var(--text-muted)}
      .empty-state .empty-icon{font-size:3.5rem;margin-bottom:1rem;opacity:0.4}
      .empty-state h3{font-size:1.3rem;margin-bottom:0.5rem;color:var(--text)}
      .empty-state p{font-size:0.9rem;margin-bottom:1.5rem;max-width:400px;margin-left:auto;margin-right:auto}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="connections-header">
          <div>
            <h1>Repurpose</h1>
            <p style="color:var(--text-muted);font-size:0.95rem;margin:0.5rem 0 0">Manage your platform integrations</p>
          </div>
          <button class="btn-gradient" onclick="openPlatformPicker()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Connection
          </button>
        </div>

        <div class="tab-subnav">
          <a href="/distribute">Workflows</a>
          <a href="/distribute/connections" class="active">Connected Accounts</a>
        </div>

        <div class="filter-tabs">
          <button class="filter-tab ${filter === 'all' ? 'active' : ''}" onclick="filterConnections('all')">All</button>
          <button class="filter-tab ${filter === 'source' ? 'active' : ''}" onclick="filterConnections('source')">Sources</button>
          <button class="filter-tab ${filter === 'destination' ? 'active' : ''}" onclick="filterConnections('destination')">Destinations</button>
          <button class="filter-tab ${filter === 'inactive' ? 'active' : ''}" onclick="filterConnections('inactive')">Inactive</button>
        </div>

        ${connections.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">🔗</div>
            <h3>${filter === 'all' ? 'No accounts connected' : 'No ' + filter + ' accounts'}</h3>
            <p>${filter === 'all' ? 'Connect your social media accounts to start repurposing content across platforms automatically.' : 'No accounts match the selected filter.'}</p>
            ${filter === 'all' ? `<button class="btn-gradient" onclick="openPlatformPicker()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Connection
            </button>` : ''}
          </div>
        ` : `
          <div class="connections-grid">
            ${connections.map(c => {
              const platform = PLATFORMS.find(p => p.id === c.platform);
              const expiryDate = c.token_expires_at ? new Date(c.token_expires_at).toLocaleDateString() : null;
              const isExpired = c.token_expires_at && new Date(c.token_expires_at) < new Date();

              return `
                <div class="connection-card ${!c.is_active ? 'inactive' : ''}" style="--card-color:${platform?.color || '#6C3AED'}">
                  <style>.connection-card[style*="${platform?.color || '#6C3AED'}"]::before{background:linear-gradient(90deg,${platform?.color || '#6C3AED'},${platform?.color || '#6C3AED'}80)}</style>
                  <div class="conn-top">
                    ${platformIconHTML(platform)}
                    <div class="conn-info">
                      <div class="conn-platform-name">${platform?.name || c.platform}</div>
                      <div class="conn-account-name">${c.platform_username || c.account_name || 'Connected Account'}</div>
                    </div>
                    <span class="conn-status ${!c.is_active ? 'inactive' : isExpired ? 'expired' : 'active'}">
                      <span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>
                      ${!c.is_active ? 'Inactive' : isExpired ? 'Expired' : 'Active'}
                    </span>
                  </div>
                  ${expiryDate ? `
                    <div class="conn-meta">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Token expires: ${expiryDate} ${isExpired ? ' — Expired!' : ''}
                    </div>
                  ` : ''}
                  <div class="conn-actions">
                    ${isExpired ? `<button class="btn-reconnect" onclick="reconnectAccount('${c.platform}')">Reconnect</button>` : ''}
                    <button class="btn-disconnect" onclick="disconnectAccount('${c.id}')">Disconnect</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Platform Picker Modal -->
    <div class="modal-overlay" id="platformPickerModal">
      <div class="modal">
        <div class="modal-header">
          <h2>Connect a Platform</h2>
          <button class="modal-close" onclick="closePlatformPicker()">✕</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">Choose a platform to connect. You'll be redirected to authorize access.</p>
          <div class="platform-picker-grid">
            ${PLATFORMS.map(p => `
              <div class="platform-picker-item" onclick="initOAuth('${p.id}')">
                <div class="p-icon">${platformIconHTML(p)}</div>
                <div class="p-info">
                  <div class="p-name">${p.name}</div>
                  <div class="p-desc">${platformDescriptions[p.id] || 'Connect your account'}</div>
                </div>
                <span class="p-arrow">→</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <script>
      ${getThemeScript()}
      ${getToastScript()}

      function filterConnections(filter) {
        window.location.href = '/distribute/connections?filter=' + filter;
      }

      function openPlatformPicker() {
        const modal = document.getElementById('platformPickerModal');
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('open'));
      }

      function closePlatformPicker() {
        const modal = document.getElementById('platformPickerModal');
        modal.classList.remove('open');
        setTimeout(() => modal.style.display = 'none', 250);
      }

      // Close modal on overlay click
      document.getElementById('platformPickerModal').addEventListener('click', function(e) {
        if (e.target === this) closePlatformPicker();
      });

      // Close modal on Escape
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closePlatformPicker();
      });

      function initOAuth(platform) {
        closePlatformPicker();
        showToast('Connecting to ' + platform.charAt(0).toUpperCase() + platform.slice(1) + '...', 'info');
        // Redirect to OAuth flow
        window.location.href = '/auth/' + platform + '/connect?redirect=/distribute/connections';
      }

      function reconnectAccount(platform) {
        showToast('Reconnecting to ' + platform.charAt(0).toUpperCase() + platform.slice(1) + '...', 'info');
        window.location.href = '/auth/' + platform + '/connect?redirect=/distribute/connections';
      }

      async function disconnectAccount(accountId) {
        if (!confirm('Disconnect this account? Any workflows using it will be paused.')) return;
        try {
          const res = await fetch('/distribute/api/connections/' + accountId, { method: 'DELETE' });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'Failed');
          showToast('Account disconnected', 'success');
          setTimeout(() => location.reload(), 1000);
        } catch (e) {
          showToast(e.message || 'Failed to disconnect', 'error');
        }
      }
    </script>
    </body></html>
  `);
});

// ═══════════════════════════════════════
// GET /distribute/workflow/:id — Workflow Detail
// ═══════════════════════════════════════
router.get('/workflow/:id', requireAuth, async (req, res) => {
  const user = req.user;
  const { id } = req.params;
  let workflow = null;

  try {
    const db = getDb();
    workflow = await db.workflowOps.getById(id);
    if (!workflow || workflow.user_id !== user.id) {
      return res.status(404).send('Workflow not found');
    }
  } catch (e) {
    console.error('Workflow load error:', e);
    return res.status(500).send('Error loading workflow');
  }

  const sourcePlatform = PLATFORMS.find(p => p.id === workflow.source_platform);
  const destPlatform = PLATFORMS.find(p => p.id === workflow.destination_platform);
  const css = getBaseCSS();

  res.send(`
    ${getHeadHTML('Workflow Details - Splicora')}
    <style>${css}
      ${getDistributeCSS()}

      .detail-flow{display:flex;align-items:center;justify-content:center;gap:2rem;padding:2.5rem;background:rgba(108,58,237,0.04);border-radius:20px;margin-bottom:2rem;border:1px solid rgba(108,58,237,0.08)}
      body.light .detail-flow,html.light .detail-flow{background:rgba(108,58,237,0.02)}
      .detail-flow-platform{display:flex;flex-direction:column;align-items:center;gap:0.6rem;text-align:center}
      .detail-flow-platform .plat-name{font-size:1rem;font-weight:700;color:var(--text)}
      .detail-flow-platform .plat-account{font-size:0.85rem;color:var(--text-muted)}
      .detail-flow-arrow{width:56px;height:56px;border-radius:50%;background:rgba(108,58,237,0.1);display:flex;align-items:center;justify-content:center;color:#6C3AED}
      .detail-flow-arrow svg{width:24px;height:24px}

      .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1.5rem;margin-bottom:2rem}
      .stat-card{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.06);text-align:center}
      body.light .stat-card,html.light .stat-card{border-color:rgba(0,0,0,0.06)}
      .stat-card .stat-icon{font-size:1.5rem;margin-bottom:0.5rem}
      .stat-card .stat-label{font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:0.3rem}
      .stat-card .stat-value{font-size:1.4rem;font-weight:800;color:var(--text)}

      .queue-section{background:var(--surface);border-radius:18px;padding:1.5rem;border:1px solid rgba(255,255,255,0.06);margin-bottom:2rem}
      body.light .queue-section,html.light .queue-section{border-color:rgba(0,0,0,0.06)}
      .queue-section h3{margin:0 0 1rem;font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.5rem}
      .queue-empty{color:var(--text-muted);font-size:0.9rem;padding:2rem;text-align:center;background:rgba(255,255,255,0.02);border-radius:12px}
      body.light .queue-empty,html.light .queue-empty{background:rgba(0,0,0,0.02)}

      .danger-zone{padding:1.5rem;background:rgba(239,68,68,0.04);border-radius:16px;border:1px solid rgba(239,68,68,0.1)}
      .danger-zone h3{margin:0 0 0.5rem;font-size:0.9rem;font-weight:700;color:#ef4444}
      .danger-zone p{margin:0 0 1rem;font-size:0.85rem;color:var(--text-muted)}
      .btn-danger{padding:0.55rem 1.4rem;border-radius:50px;font-weight:600;font-size:0.85rem;cursor:pointer;border:none;background:rgba(239,68,68,0.12);color:#ef4444;transition:all 0.3s}
      .btn-danger:hover{background:rgba(239,68,68,0.2)}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <a href="/distribute" style="display:inline-flex;align-items:center;gap:0.5rem;color:#6C3AED;text-decoration:none;font-weight:600;margin-bottom:1.5rem;font-size:0.9rem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Workflows
        </a>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;flex-wrap:wrap;gap:1rem">
          <div>
            <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:0.3rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${sourcePlatform?.name || '?'} → ${destPlatform?.name || '?'}</h1>
            <p style="color:var(--text-muted);font-size:0.9rem;margin:0">Workflow details and content queue</p>
          </div>
          <span class="status-pill ${!workflow.is_active ? 'inactive' : 'active'}" style="font-size:0.85rem;padding:0.45rem 1rem">
            <span class="status-dot"></span>
            ${!workflow.is_active ? 'Inactive' : 'Active'}
          </span>
        </div>

        <div class="detail-flow">
          <div class="detail-flow-platform">
            ${platformIconHTML(sourcePlatform, 'xl')}
            <div class="plat-name">${sourcePlatform?.name || 'Unknown'}</div>
            <div class="plat-account">${workflow.source_username || 'Connected'}</div>
          </div>
          <div class="detail-flow-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </div>
          <div class="detail-flow-platform">
            ${platformIconHTML(destPlatform, 'xl')}
            <div class="plat-name">${destPlatform?.name || 'Unknown'}</div>
            <div class="plat-account">${workflow.dest_username || 'Connected'}</div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">📤</div>
            <div class="stat-label">Mode</div>
            <div class="stat-value" style="font-size:1rem">${workflow.content_type === 'auto-publish' ? 'Auto-Publish' : 'Schedule'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">⏱</div>
            <div class="stat-label">Delay</div>
            <div class="stat-value" style="font-size:1rem">${workflow.delay_mode === 'immediate' ? 'Instant' : workflow.delay_mode === 'custom' ? workflow.delay_hours + ' hrs' : 'Timed'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-label">Posts Sent</div>
            <div class="stat-value">${workflow.post_count || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📅</div>
            <div class="stat-label">Created</div>
            <div class="stat-value" style="font-size:0.9rem">${workflow.created_at ? new Date(workflow.created_at).toLocaleDateString() : '—'}</div>
          </div>
        </div>

        <div class="queue-section">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            Content Queue
          </h3>
          <div class="queue-empty">
            No content in queue yet. Once this workflow runs, scheduled and published content will appear here.
          </div>
        </div>

        <div class="danger-zone">
          <h3>Danger Zone</h3>
          <p>Permanently delete this workflow and all its scheduled content. This action cannot be undone.</p>
          <button class="btn-danger" onclick="deleteWorkflow('${workflow.id}')">Delete Workflow</button>
        </div>
      </div>
    </div>

    <script>
      ${getThemeScript()}
      ${getToastScript()}

      function deleteWorkflow(workflowId) {
        if (!confirm('Delete this workflow permanently? This cannot be undone.')) return;
        fetch('/distribute/api/workflow/' + workflowId, { method: 'DELETE' })
          .then(r => r.json())
          .then(d => {
            if (d.success) {
              showToast('Workflow deleted', 'success');
              setTimeout(() => window.location.href = '/distribute', 1000);
            } else {
              showToast(d.error || 'Failed to delete', 'error');
            }
          })
          .catch(e => showToast('Failed to delete', 'error'));
      }
    </script>
    </body></html>
  `);
});

// ═══════════════════════════════════════
// API Routes
// ═══════════════════════════════════════

// Create workflow
router.post('/api/workflow', requireAuth, async (req, res) => {
  try {
    const { sourcePlatform, sourceAccountId, destPlatform, destAccountId, delayMode, delayHours, timeSlot } = req.body;
    if (!sourcePlatform || !sourceAccountId || !destPlatform || !destAccountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const db = getDb();
    const workflowName = `${sourcePlatform.charAt(0).toUpperCase()}${sourcePlatform.slice(1)} → ${destPlatform.charAt(0).toUpperCase()}${destPlatform.slice(1)}`;
    const workflow = await db.workflowOps.create(req.user.id, {
      name: workflowName, sourceAccountId, destinationAccountId: destAccountId,
      sourcePlatform, destinationPlatform: destPlatform, contentType: 'all',
      autoPublish: true, delayHours: delayMode === 'custom' ? delayHours : 0,
      delayMode: delayMode, settings: { timeSlot: timeSlot || null }
    });
    res.json({ success: true, workflowId: workflow.id });
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

// Toggle auto-publish
router.post('/api/workflow/:id/toggle', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { auto_publish } = req.body;
    const db = getDb();
    const workflow = await db.workflowOps.getById(id);
    if (!workflow || workflow.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    await db.workflowOps.toggleAutoPublish(id, auto_publish);
    res.json({ success: true });
  } catch (error) {
    console.error('Toggle auto-publish error:', error);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

// Delete workflow
router.delete('/api/workflow/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const workflow = await db.workflowOps.getById(id);
    if (!workflow || workflow.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    await db.workflowOps.delete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

// Get connections
router.get('/api/connections', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const connections = await db.connectedAccountOps.getByUser(req.user.id);
    res.json(connections);
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Delete connection
router.delete('/api/connections/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const connection = await db.connectedAccountOps.getById(id);
    if (!connection || connection.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    await db.connectedAccountOps.deactivate(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete connection error:', error);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

module.exports = router;
