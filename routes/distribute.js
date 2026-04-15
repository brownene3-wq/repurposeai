const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { getDb } = require('../db/database');

// Platform configuration
const PLATFORMS = [
  { id: 'tiktok', name: 'TikTok', icon: '🎵', color: '#25F4EE', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .56.04.81.1v-3.5a6.37 6.37 0 0 0-.81-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.82a4.83 4.83 0 0 1-1-.13z"/></svg>' },
  { id: 'instagram', name: 'Instagram', icon: '📷', color: '#E4405F', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
  { id: 'youtube', name: 'YouTube', icon: '▶️', color: '#FF0000', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
  { id: 'facebook', name: 'Facebook', icon: '📘', color: '#1877F2', type: 'source_destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
  { id: 'twitter', name: 'X / Twitter', icon: '𝕏', color: '#000000', type: 'destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: '#0A66C2', type: 'destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
  { id: 'pinterest', name: 'Pinterest', icon: '📌', color: '#E60023', type: 'destination', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24 18.635 24 24.003 18.633 24.003 12.013 24.003 5.393 18.635.028 12.017.028z"/></svg>' }
];

// GET /distribute - Workflows list page
router.get('/', requireAuth, async (req, res) => {
  const user = req.user;
  let workflows = [];
  let filter = req.query.filter || 'all'; // all, auto, manual, inactive

  try {
    const db = getDb();
    const allWorkflows = await db.workflowOps.getByUser(user.id);

    // Apply filter
    workflows = allWorkflows.filter(w => {
      if (filter === 'auto') return w.auto_publish === true && w.is_active === true;
      if (filter === 'manual') return w.auto_publish === false && w.is_active === true;
      if (filter === 'inactive') return w.is_active === false;
      return true; // all
    });
  } catch (e) {
    console.error('Workflows load error:', e);
  }

  const css = getBaseCSS();

  res.send(`
    ${getHeadHTML('Distribute - Splicora')}
    <style>${css}
      .workflows-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;gap:1rem;flex-wrap:wrap}
      .workflows-header h1{margin:0;font-size:1.8rem;font-weight:800}
      .btn-create{padding:0.65rem 1.6rem;border-radius:50px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;transition:all 0.3s;box-shadow:0 4px 15px rgba(108,58,237,0.3);text-decoration:none;display:inline-flex;align-items:center;gap:0.5rem}
      .btn-create:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}
      .filter-tabs{display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:2rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:1rem}
      body.light .filter-tabs,html.light .filter-tabs{border-bottom-color:rgba(0,0,0,0.08)}
      .filter-tab{padding:0.5rem 1.2rem;border-radius:50px;font-weight:600;font-size:0.85rem;cursor:pointer;border:none;background:transparent;color:var(--text-muted);transition:all 0.25s}
      .filter-tab:hover{color:var(--text)}
      .filter-tab.active{background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff}
      .workflows-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.5rem;margin-bottom:2rem}
      .workflow-card{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.08);transition:all 0.3s;position:relative;overflow:hidden}
      body.light .workflow-card,html.light .workflow-card{border-color:rgba(0,0,0,0.08)}
      .workflow-card:hover{border-color:rgba(108,58,237,0.4);box-shadow:0 8px 32px rgba(108,58,237,0.15)}
      .workflow-card.inactive{opacity:0.6;background:var(--dark-2)}
      .workflow-flow{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.06)}
      body.light .workflow-flow,html.light .workflow-flow{border-bottom-color:rgba(0,0,0,0.06)}
      .flow-platform{display:flex;flex-direction:column;align-items:center;gap:0.3rem}
      .platform-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(255,255,255,0.05);font-size:1.6rem;margin-bottom:0.3rem}
      body.light .platform-icon,html.light .platform-icon{background:rgba(0,0,0,0.05)}
      .platform-name{font-size:0.8rem;color:var(--text-muted);font-weight:600;text-transform:uppercase}
      .flow-arrow{color:var(--text-muted);font-size:1.2rem;margin:0 0.8rem}
      .account-name{font-size:0.85rem;color:var(--text);font-weight:500;margin-top:0.4rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px}
      .workflow-info{display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-bottom:1rem;font-size:0.85rem}
      .info-item{display:flex;flex-direction:column;gap:0.2rem}
      .info-label{color:var(--text-muted);font-size:0.78rem;text-transform:uppercase;font-weight:600;letter-spacing:0.5px}
      .info-value{color:var(--text);font-weight:600}
      .status-badge{display:inline-flex;align-items:center;gap:0.4rem;padding:0.35rem 0.8rem;border-radius:50px;font-size:0.75rem;font-weight:600}
      .status-badge.active{background:rgba(16,185,129,0.15);color:#10B981}
      .status-badge.inactive{background:rgba(239,68,68,0.15);color:#ef4444}
      .status-badge.auto{background:rgba(108,58,237,0.15);color:#6C3AED}
      .workflow-actions{display:flex;gap:0.6rem;margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.06)}
      body.light .workflow-actions,html.light .workflow-actions{border-top-color:rgba(0,0,0,0.06)}
      .btn-view{padding:0.45rem 0.9rem;border-radius:8px;font-weight:600;font-size:0.8rem;cursor:pointer;border:1px solid rgba(108,58,237,0.3);background:transparent;color:#6C3AED;transition:all 0.2s}
      .btn-view:hover{background:rgba(108,58,237,0.1);border-color:#6C3AED}
      .btn-delete{padding:0.45rem 0.9rem;border-radius:8px;font-weight:600;font-size:0.8rem;cursor:pointer;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;transition:all 0.2s}
      .btn-delete:hover{background:rgba(239,68,68,0.1);border-color:#ef4444}
      .toggle-auto{position:relative;width:44px;height:24px;flex-shrink:0;margin-left:auto}
      .toggle-auto input{opacity:0;width:0;height:0}
      .toggle-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.12);border-radius:24px;transition:0.3s}
      body.light .toggle-slider,html.light .toggle-slider{background:rgba(0,0,0,0.12)}
      .toggle-slider:before{content:'';position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.3s}
      .toggle-auto input:checked+.toggle-slider{background:#6C3AED}
      .toggle-auto input:checked+.toggle-slider:before{transform:translateX(20px)}
      .empty-state{text-align:center;padding:3rem 2rem;color:var(--text-muted)}
      .empty-state h3{font-size:1.3rem;margin-bottom:0.5rem;color:var(--text)}
      .empty-state p{font-size:0.9rem;margin-bottom:1.5rem}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="workflows-header">
          <div>
            <h1>Distribution Workflows</h1>
            <p style="color:var(--text-muted);font-size:0.95rem;margin:0.5rem 0 0">Automate posting content across platforms</p>
          </div>
          <a href="/distribute/create" class="btn-create"><span>+</span> Create Workflow</a>
        </div>

        <div class="filter-tabs">
          <button class="filter-tab ${filter === 'all' ? 'active' : ''}" onclick="filterWorkflows('all')">All Workflows</button>
          <button class="filter-tab ${filter === 'auto' ? 'active' : ''}" onclick="filterWorkflows('auto')">Auto-Publish</button>
          <button class="filter-tab ${filter === 'manual' ? 'active' : ''}" onclick="filterWorkflows('manual')">Manual</button>
          <button class="filter-tab ${filter === 'inactive' ? 'active' : ''}" onclick="filterWorkflows('inactive')">Inactive</button>
        </div>

        ${workflows.length === 0 ? `
          <div class="empty-state">
            <h3>No workflows yet</h3>
            <p>Create your first distribution workflow to automate posting</p>
            <a href="/distribute/create" class="btn-create"><span>+</span> Create Workflow</a>
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
                      <div class="platform-icon" style="color:${sourcePlatform?.color || '#666'}">${sourcePlatform?.icon || '?'}</div>
                      <span class="platform-name">${sourcePlatform?.name || w.source_platform}</span>
                      <div class="account-name" title="${w.source_username || ''}">${w.source_username || 'Account'}</div>
                    </div>
                    <div class="flow-arrow">→</div>
                    <div class="flow-platform">
                      <div class="platform-icon" style="color:${destPlatform?.color || '#666'}">${destPlatform?.icon || '?'}</div>
                      <span class="platform-name">${destPlatform?.name || w.destination_platform}</span>
                      <div class="account-name" title="${w.dest_username || ''}">${w.dest_username || 'Account'}</div>
                    </div>
                  </div>

                  <div class="workflow-info">
                    <div class="info-item">
                      <span class="info-label">Status</span>
                      <span class="status-badge ${isInactive ? 'inactive' : 'active'}">
                        <span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>
                        ${isInactive ? 'Inactive' : 'Active'}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Posts Sent</span>
                      <span class="info-value">${w.post_count || 0}</span>
                    </div>
                  </div>

                  <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.06)">
                    <label style="display:flex;align-items:center;gap:0.8rem;font-size:0.85rem;color:var(--text-muted)">
                      <span>Auto-Publish</span>
                      <label class="toggle-auto">
                        <input type="checkbox" ${isAuto ? 'checked' : ''} onchange="toggleAutoPublish('${w.id}', this)">
                        <span class="toggle-slider"></span>
                      </label>
                    </label>
                  </div>

                  <div class="workflow-actions">
                    <a href="/distribute/workflow/${w.id}" class="btn-view">View Details</a>
                    <button class="btn-delete" onclick="deleteWorkflow('${w.id}')">Delete</button>
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

      function showToast(msg, type) {
        const toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'success');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.3)';
        if (type === 'error') {
          toast.style.background = '#EF4444';
          toast.style.color = '#fff';
        } else {
          toast.style.background = '#10B981';
          toast.style.color = '#fff';
        }
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
      }
    </script>
    </body></html>
  `);
});

// GET /distribute/create - Create Workflow page
router.get('/create', requireAuth, async (req, res) => {
  const user = req.user;
  let connections = [];

  try {
    const db = getDb();
    connections = await db.connectedAccountOps.getByUser(user.id);
  } catch (e) {
    console.error('Connections load error:', e);
  }

  // Group connections by platform
  const connectionsByPlatform = {};
  connections.forEach(c => {
    if (!connectionsByPlatform[c.platform]) {
      connectionsByPlatform[c.platform] = [];
    }
    connectionsByPlatform[c.platform].push(c);
  });

  const css = getBaseCSS();

  res.send(`
    ${getHeadHTML('Create Workflow - Splicora')}
    <style>${css}
      .create-steps{display:flex;gap:0.5rem;margin-bottom:3rem;overflow-x:auto}
      .step{padding:0.8rem 1.4rem;border-radius:50px;font-weight:600;font-size:0.85rem;background:var(--dark-2);color:var(--text-muted);transition:all 0.25s;white-space:nowrap}
      .step.active{background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff}
      .step.done{background:rgba(16,185,129,0.2);color:#10B981}
      .create-container{max-width:900px}
      .step-content{display:none}
      .step-content.active{display:block}
      .step-title{font-size:1.6rem;font-weight:800;margin-bottom:1rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
      .step-desc{color:var(--text-muted);font-size:0.95rem;margin-bottom:2rem}
      .grid-platforms{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:2rem}
      .platform-btn{padding:1.2rem;border-radius:14px;border:2px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);cursor:pointer;transition:all 0.3s;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:0.8rem}
      body.light .platform-btn,html.light .platform-btn{border-color:rgba(0,0,0,0.1);background:#f5f5f9}
      .platform-btn:hover{border-color:rgba(108,58,237,0.4);background:rgba(108,58,237,0.05)}
      .platform-btn.selected{border-color:#6C3AED;background:rgba(108,58,237,0.15);color:#6C3AED}
      .platform-icon-lg{font-size:2rem}
      .platform-name-small{font-size:0.85rem}
      .account-selector{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:2rem}
      .account-option{padding:1rem;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:var(--dark-2);cursor:pointer;transition:all 0.25s;text-align:center}
      body.light .account-option,html.light .account-option{border-color:rgba(0,0,0,0.08)}
      .account-option:hover{border-color:rgba(108,58,237,0.3);background:rgba(108,58,237,0.05)}
      .account-option.selected{border-color:#6C3AED;background:rgba(108,58,237,0.15);color:#6C3AED;font-weight:600}
      .account-option-name{font-size:0.9rem;font-weight:600;margin-bottom:0.4rem;color:var(--text)}
      .account-option-type{font-size:0.75rem;color:var(--text-muted);text-transform:uppercase}
      .flow-preview{display:flex;align-items:center;justify-content:center;gap:2rem;padding:2rem;background:rgba(108,58,237,0.05);border-radius:14px;margin-bottom:2rem;border:1px solid rgba(108,58,237,0.1)}
      body.light .flow-preview,html.light .flow-preview{background:rgba(108,58,237,0.02);border-color:rgba(108,58,237,0.08)}
      .flow-platform-preview{display:flex;flex-direction:column;align-items:center;gap:0.5rem}
      .flow-icon{font-size:3rem}
      .flow-label{font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;font-weight:600;margin-top:0.5rem}
      .flow-arrow-lg{font-size:2rem;color:var(--text-muted)}
      .mode-selector{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
      .mode-card{padding:1.5rem;border-radius:14px;border:2px solid rgba(255,255,255,0.1);background:var(--dark-2);cursor:pointer;transition:all 0.3s;display:flex;flex-direction:column;gap:0.8rem}
      body.light .mode-card,html.light .mode-card{border-color:rgba(0,0,0,0.1)}
      .mode-card:hover{border-color:rgba(108,58,237,0.3);background:rgba(108,58,237,0.05)}
      .mode-card.selected{border-color:#6C3AED;background:rgba(108,58,237,0.15)}
      .mode-icon{font-size:2rem}
      .mode-title{font-size:1rem;font-weight:700;color:var(--text)}
      .mode-desc{font-size:0.85rem;color:var(--text-muted)}
      .settings-group{background:var(--surface);border-radius:14px;padding:1.5rem;border:1px solid rgba(255,255,255,0.06);margin-bottom:1.5rem}
      body.light .settings-group,html.light .settings-group{border-color:rgba(0,0,0,0.06)}
      .settings-group h3{margin-top:0;font-size:1rem;font-weight:700;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem}
      .delay-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1.5rem}
      .delay-option{padding:1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:var(--dark-2);cursor:pointer;transition:all 0.25s;text-align:center;font-weight:600;font-size:0.9rem}
      body.light .delay-option,html.light .delay-option{border-color:rgba(0,0,0,0.08)}
      .delay-option:hover{border-color:rgba(108,58,237,0.3)}
      .delay-option.selected{border-color:#6C3AED;background:rgba(108,58,237,0.15);color:#6C3AED}
      .time-input{padding:0.65rem 1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:0.9rem;outline:none;transition:border 0.2s}
      body.light .time-input,html.light .time-input{border-color:rgba(0,0,0,0.1);background:#f8f9fc}
      .time-input:focus{border-color:#6C3AED}
      .actions-row{display:flex;gap:1rem;margin-top:2rem}
      .btn-prev,.btn-next,.btn-create-wf{padding:0.7rem 1.8rem;border-radius:50px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;transition:all 0.3s}
      .btn-next,.btn-create-wf{background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
      .btn-next:hover,.btn-create-wf:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}
      .btn-next:disabled,.btn-create-wf:disabled{opacity:0.5;cursor:not-allowed;transform:none}
      .btn-prev{background:transparent;border:1px solid rgba(255,255,255,0.2);color:var(--text)}
      .btn-prev:hover{border-color:var(--text);background:rgba(255,255,255,0.05)}
      .summary-item{display:flex;align-items:center;gap:1rem;padding:1rem;background:var(--dark-2);border-radius:10px;margin-bottom:0.8rem}
      .summary-platforms{display:flex;align-items:center;gap:1rem;flex:1}
      .summary-platform{display:flex;flex-direction:column;align-items:center;font-size:0.85rem}
      .summary-platform-icon{font-size:2rem;margin-bottom:0.3rem}
      .summary-platform-name{color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;font-weight:600}
      .summary-arrow{color:var(--text-muted);font-size:1.2rem;margin:0 0.8rem}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div style="max-width:900px">
          <h1 style="font-size:2rem;font-weight:800;margin-bottom:0.5rem">Create Workflow</h1>
          <p style="color:var(--text-muted);font-size:0.95rem;margin-bottom:2rem">Set up a new distribution workflow in a few steps</p>

          <div class="create-steps">
            <div class="step active" data-step="1">1. Choose Mode</div>
            <div class="step" data-step="2">2. Select Source</div>
            <div class="step" data-step="3">3. Pick Source Account</div>
            <div class="step" data-step="4">4. Select Destination</div>
            <div class="step" data-step="5">5. Pick Dest Account</div>
            <div class="step" data-step="6">6. Configure & Create</div>
          </div>

          <!-- Step 1: Choose Mode -->
          <div class="step-content active" data-step="1">
            <h2 class="step-title">Choose Workflow Mode</h2>
            <p class="step-desc">How would you like to distribute your content?</p>
            <div class="mode-selector">
              <div class="mode-card" onclick="selectMode('auto-publish', this)">
                <div class="mode-icon">📤</div>
                <div class="mode-title">Auto-Publish New Posts</div>
                <div class="mode-desc">Automatically post new content from source to destination</div>
              </div>
              <div class="mode-card" onclick="selectMode('schedule-existing', this)">
                <div class="mode-icon">📅</div>
                <div class="mode-title">Schedule Existing Content</div>
                <div class="mode-desc">Queue and schedule specific content to post</div>
              </div>
            </div>
            <div class="actions-row">
              <button class="btn-next" onclick="nextStep()" disabled id="nextBtn1">Next Step</button>
            </div>
          </div>

          <!-- Step 2: Select Source Platform -->
          <div class="step-content" data-step="2">
            <h2 class="step-title">Select Source Platform</h2>
            <p class="step-desc">Which platform will you pull content from?</p>
            <div class="grid-platforms" id="sourcePlatforms">
              ${PLATFORMS.filter(p => p.type !== 'destination').map(p => `
                <button class="platform-btn" onclick="selectPlatform('source', '${p.id}', this)">
                  <span class="platform-icon-lg">${p.icon}</span>
                  <span class="platform-name-small">${p.name}</span>
                </button>
              `).join('')}
            </div>
            <div class="actions-row">
              <button class="btn-prev" onclick="prevStep()">Back</button>
              <button class="btn-next" onclick="nextStep()" disabled id="nextBtn2">Next Step</button>
            </div>
          </div>

          <!-- Step 3: Select Source Account -->
          <div class="step-content" data-step="3">
            <h2 class="step-title">Select Source Account</h2>
            <p class="step-desc">Which account will be the source?</p>
            <div class="account-selector" id="sourceAccounts">
              <!-- Populated dynamically -->
            </div>
            <div style="padding:1.5rem;background:rgba(108,58,237,0.05);border-radius:12px;border:1px solid rgba(108,58,237,0.1);margin-bottom:1.5rem">
              <p style="margin:0;font-size:0.9rem;color:var(--text-muted)">No accounts connected? <a href="/distribute/connections" style="color:#6C3AED;font-weight:600;text-decoration:none">Add a connection</a></p>
            </div>
            <div class="actions-row">
              <button class="btn-prev" onclick="prevStep()">Back</button>
              <button class="btn-next" onclick="nextStep()" disabled id="nextBtn3">Next Step</button>
            </div>
          </div>

          <!-- Step 4: Select Destination Platform -->
          <div class="step-content" data-step="4">
            <h2 class="step-title">Select Destination Platform</h2>
            <p class="step-desc">Where should content be posted to?</p>
            <div class="grid-platforms" id="destPlatforms">
              ${PLATFORMS.map(p => `
                <button class="platform-btn" onclick="selectPlatform('dest', '${p.id}', this)">
                  <span class="platform-icon-lg">${p.icon}</span>
                  <span class="platform-name-small">${p.name}</span>
                </button>
              `).join('')}
            </div>
            <div class="actions-row">
              <button class="btn-prev" onclick="prevStep()">Back</button>
              <button class="btn-next" onclick="nextStep()" disabled id="nextBtn4">Next Step</button>
            </div>
          </div>

          <!-- Step 5: Select Destination Account -->
          <div class="step-content" data-step="5">
            <h2 class="step-title">Select Destination Account</h2>
            <p class="step-desc">Which account will receive the posts?</p>
            <div class="account-selector" id="destAccounts">
              <!-- Populated dynamically -->
            </div>
            <div style="padding:1.5rem;background:rgba(108,58,237,0.05);border-radius:12px;border:1px solid rgba(108,58,237,0.1);margin-bottom:1.5rem">
              <p style="margin:0;font-size:0.9rem;color:var(--text-muted)">No accounts connected? <a href="/distribute/connections" style="color:#6C3AED;font-weight:600;text-decoration:none">Add a connection</a></p>
            </div>
            <div class="actions-row">
              <button class="btn-prev" onclick="prevStep()">Back</button>
              <button class="btn-next" onclick="nextStep()" disabled id="nextBtn5">Next Step</button>
            </div>
          </div>

          <!-- Step 6: Configure & Create -->
          <div class="step-content" data-step="6">
            <h2 class="step-title">Configure Workflow</h2>
            <p class="step-desc">Review your settings and create the workflow</p>

            <div class="flow-preview">
              <div class="flow-platform-preview">
                <div class="flow-icon" id="previewSourceIcon">📷</div>
                <div class="flow-label" id="previewSourceLabel">Source</div>
              </div>
              <div class="flow-arrow-lg">→</div>
              <div class="flow-platform-preview">
                <div class="flow-icon" id="previewDestIcon">📘</div>
                <div class="flow-label" id="previewDestLabel">Destination</div>
              </div>
            </div>

            <div class="settings-group">
              <h3>⏱ Posting Schedule</h3>
              <div class="delay-options">
                <button class="delay-option selected" onclick="selectDelay('immediate', this)">Immediately</button>
                <button class="delay-option" onclick="selectDelay('custom', this)">After Custom Hours</button>
                <button class="delay-option" onclick="selectDelay('time-slot', this)">At Specific Time</button>
              </div>
              <div id="delayCustom" style="display:none">
                <label style="display:block;margin-bottom:0.5rem;color:var(--text-muted);font-size:0.9rem">Post after (hours):</label>
                <input type="number" id="delayHours" min="0" max="168" value="0" class="time-input" style="max-width:200px" />
              </div>
              <div id="delaySlot" style="display:none">
                <label style="display:block;margin-bottom:0.5rem;color:var(--text-muted);font-size:0.9rem">Post at:</label>
                <input type="time" id="timeSlot" class="time-input" style="max-width:200px" />
              </div>
            </div>

            <div class="actions-row">
              <button class="btn-prev" onclick="prevStep()">Back</button>
              <button class="btn-create-wf" onclick="createWorkflow()">Create Workflow</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      ${getThemeScript()}

      const connectionsByPlatform = ${JSON.stringify(connectionsByPlatform)};
      let state = {
        mode: null,
        sourcePlatform: null,
        sourceAccountId: null,
        destPlatform: null,
        destAccountId: null,
        delayMode: 'immediate',
        delayHours: 0,
        timeSlot: null
      };
      let currentStep = 1;

      function selectMode(mode, el) {
        state.mode = mode;
        document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('nextBtn1').disabled = false;
      }

      function selectPlatform(type, platformId, el) {
        const platforms = document.querySelectorAll('#' + (type === 'source' ? 'sourcePlatforms' : 'destPlatforms') + ' .platform-btn');
        platforms.forEach(p => p.classList.remove('selected'));
        el.classList.add('selected');

        if (type === 'source') {
          state.sourcePlatform = platformId;
          document.getElementById('nextBtn2').disabled = false;
        } else {
          state.destPlatform = platformId;
          document.getElementById('nextBtn4').disabled = false;
        }
      }

      function selectAccount(type, accountId, el) {
        const accounts = document.querySelectorAll('#' + (type === 'source' ? 'sourceAccounts' : 'destAccounts') + ' .account-option');
        accounts.forEach(a => a.classList.remove('selected'));
        el.classList.add('selected');

        if (type === 'source') {
          state.sourceAccountId = accountId;
          document.getElementById('nextBtn3').disabled = false;
          updatePreview();
        } else {
          state.destAccountId = accountId;
          document.getElementById('nextBtn5').disabled = false;
          updatePreview();
        }
      }

      function selectDelay(mode, el) {
        state.delayMode = mode;
        document.querySelectorAll('.delay-option').forEach(d => d.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('delayCustom').style.display = mode === 'custom' ? 'block' : 'none';
        document.getElementById('delaySlot').style.display = mode === 'time-slot' ? 'block' : 'none';
      }

      function updatePreview() {
        const sourcePlatform = ${JSON.stringify(PLATFORMS)}.find(p => p.id === state.sourcePlatform);
        const destPlatform = ${JSON.stringify(PLATFORMS)}.find(p => p.id === state.destPlatform);
        if (sourcePlatform) {
          document.getElementById('previewSourceIcon').textContent = sourcePlatform.icon;
          document.getElementById('previewSourceLabel').textContent = sourcePlatform.name;
        }
        if (destPlatform) {
          document.getElementById('previewDestIcon').textContent = destPlatform.icon;
          document.getElementById('previewDestLabel').textContent = destPlatform.name;
        }
      }

      function showStep(step) {
        document.querySelectorAll('.step-content').forEach(s => s.classList.remove('active'));
        document.querySelector('[data-step="' + step + '"].step-content').classList.add('active');

        if (step === 3) populateAccountSelector('source');
        if (step === 5) populateAccountSelector('dest');

        updateStepIndicators();
      }

      function updateStepIndicators() {
        document.querySelectorAll('.step').forEach((s, i) => {
          const stepNum = i + 1;
          s.classList.remove('active', 'done');
          if (stepNum === currentStep) s.classList.add('active');
          else if (stepNum < currentStep) s.classList.add('done');
        });
      }

      function populateAccountSelector(type) {
        const platform = type === 'source' ? state.sourcePlatform : state.destPlatform;
        const accounts = connectionsByPlatform[platform] || [];
        const selector = document.getElementById((type === 'source' ? 'source' : 'dest') + 'Accounts');
        selector.innerHTML = accounts.map(acc => \`
          <div class="account-option" onclick="selectAccount('\${type}', '\${acc.id}', this)">
            <div class="account-option-name">\${acc.account_name || acc.platform_username}</div>
            <div class="account-option-type">\${acc.platform}</div>
          </div>
        \`).join('');
      }

      function nextStep() {
        if (currentStep < 6) {
          currentStep++;
          showStep(currentStep);
          document.body.scrollTop = document.documentElement.scrollTop = 0;
        }
      }

      function prevStep() {
        if (currentStep > 1) {
          currentStep--;
          showStep(currentStep);
          document.body.scrollTop = document.documentElement.scrollTop = 0;
        }
      }

      async function createWorkflow() {
        state.delayHours = state.delayMode === 'custom' ? parseInt(document.getElementById('delayHours').value) || 0 : 0;
        state.timeSlot = state.delayMode === 'time-slot' ? document.getElementById('timeSlot').value : null;

        if (!state.mode || !state.sourcePlatform || !state.sourceAccountId || !state.destPlatform || !state.destAccountId) {
          showToast('Please complete all steps', 'error');
          return;
        }

        try {
          const res = await fetch('/distribute/api/workflow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: state.mode,
              sourcePlatform: state.sourcePlatform,
              sourceAccountId: state.sourceAccountId,
              destPlatform: state.destPlatform,
              destAccountId: state.destAccountId,
              delayMode: state.delayMode,
              delayHours: state.delayHours,
              timeSlot: state.timeSlot
            })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to create workflow');

          showToast('Workflow created successfully!', 'success');
          setTimeout(() => {
            window.location.href = '/distribute';
          }, 1500);
        } catch (e) {
          showToast(e.message || 'Failed to create workflow', 'error');
        }
      }

      function showToast(msg, type) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.3);background:' + (type === 'error' ? '#EF4444' : '#10B981') + ';color:#fff';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
      }
    </script>
    </body></html>
  `);
});

// GET /distribute/connections - Connections page
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

  res.send(`
    ${getHeadHTML('Connections - Splicora')}
    <style>${css}
      .connections-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;gap:1rem;flex-wrap:wrap}
      .connections-header h1{margin:0;font-size:1.8rem;font-weight:800}
      .btn-add{padding:0.65rem 1.6rem;border-radius:50px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;transition:all 0.3s;box-shadow:0 4px 15px rgba(108,58,237,0.3);text-decoration:none;display:inline-flex;align-items:center;gap:0.5rem}
      .btn-add:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}
      .connections-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem}
      .connection-card{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.08);text-align:center;position:relative;transition:all 0.3s}
      body.light .connection-card,html.light .connection-card{border-color:rgba(0,0,0,0.08)}
      .connection-card:hover{border-color:rgba(108,58,237,0.4);box-shadow:0 8px 32px rgba(108,58,237,0.15)}
      .connection-card.inactive{opacity:0.6}
      .connection-platform-icon{font-size:3rem;margin-bottom:0.8rem}
      .connection-platform-name{font-size:1rem;font-weight:700;color:var(--text);margin-bottom:0.3rem}
      .connection-account-name{font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem;word-break:break-all}
      .status-check{display:inline-flex;align-items:center;gap:0.4rem;padding:0.35rem 0.8rem;border-radius:50px;font-size:0.75rem;font-weight:600;background:rgba(16,185,129,0.15);color:#10B981;margin-bottom:1rem}
      .status-check.inactive{background:rgba(239,68,68,0.15);color:#ef4444}
      .expiry-info{font-size:0.78rem;color:var(--text-muted);margin-bottom:1.2rem;padding:0.8rem;border-radius:8px;background:rgba(255,255,255,0.03)}
      body.light .expiry-info,html.light .expiry-info{background:rgba(0,0,0,0.03)}
      .btn-disconnect{padding:0.45rem 0.9rem;border-radius:8px;font-weight:600;font-size:0.8rem;cursor:pointer;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;transition:all 0.2s}
      .btn-disconnect:hover{background:rgba(239,68,68,0.1);border-color:#ef4444}
      .empty-state{text-align:center;padding:3rem 2rem;color:var(--text-muted)}
      .empty-state h3{font-size:1.3rem;margin-bottom:0.5rem;color:var(--text)}
      .empty-state p{font-size:0.9rem;margin-bottom:1.5rem}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="connections-header">
          <div>
            <h1>Connected Accounts</h1>
            <p style="color:var(--text-muted);font-size:0.95rem;margin:0.5rem 0 0">Manage your platform integrations</p>
          </div>
          <button class="btn-add" onclick="openAddConnection()"><span>+</span> Add Connection</button>
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:2rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:1rem">
          <button class="filter-tab ${filter === 'all' ? 'active' : ''}" onclick="filterConnections('all')">All Accounts</button>
          <button class="filter-tab ${filter === 'source' ? 'active' : ''}" onclick="filterConnections('source')">Source Platforms</button>
          <button class="filter-tab ${filter === 'destination' ? 'active' : ''}" onclick="filterConnections('destination')">Destination Platforms</button>
          <button class="filter-tab ${filter === 'inactive' ? 'active' : ''}" onclick="filterConnections('inactive')">Inactive</button>
        </div>

        ${connections.length === 0 ? `
          <div class="empty-state">
            <h3>No connections yet</h3>
            <p>Connect your social media accounts to start distributing content</p>
            <button class="btn-add" onclick="openAddConnection()"><span>+</span> Add Connection</button>
          </div>
        ` : `
          <div class="connections-grid">
            ${connections.map(c => {
              const platform = PLATFORMS.find(p => p.id === c.platform);
              const expiryDate = c.token_expires_at ? new Date(c.token_expires_at).toLocaleDateString() : 'Never';
              const isExpired = c.token_expires_at && new Date(c.token_expires_at) < new Date();

              return `
                <div class="connection-card ${!c.is_active ? 'inactive' : ''}">
                  <div class="connection-platform-icon">${platform?.icon || '?'}</div>
                  <div class="connection-platform-name">${platform?.name || c.platform}</div>
                  <div class="connection-account-name">${c.platform_username || c.account_name}</div>
                  <div class="status-check ${!c.is_active ? 'inactive' : ''}">
                    ${!c.is_active ? '✕ Inactive' : '✓ Active'}
                  </div>
                  <div class="expiry-info">
                    Token expires: ${expiryDate}
                    ${isExpired ? '<div style="color:#ef4444;margin-top:0.3rem">🔴 Token expired</div>' : ''}
                  </div>
                  <button class="btn-disconnect" onclick="disconnectAccount('${c.id}')">Disconnect</button>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>

    <script>
      ${getThemeScript()}

      function filterConnections(filter) {
        window.location.href = '/distribute/connections?filter=' + filter;
      }

      function openAddConnection() {
        showToast('Platform connection UI would open here', 'success');
      }

      async function disconnectAccount(accountId) {
        if (!confirm('Disconnect this account? Workflows using this account will be paused.')) return;
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

      function showToast(msg, type) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.3);background:' + (type === 'error' ? '#EF4444' : '#10B981') + ';color:#fff';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
      }
    </script>
    </body></html>
  `);
});

// GET /distribute/workflow/:id - View Workflow detail
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
      .workflow-detail-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;gap:1rem;flex-wrap:wrap}
      .workflow-detail-header h1{margin:0;font-size:1.8rem;font-weight:800}
      .status-badge-lg{display:inline-flex;align-items:center;gap:0.5rem;padding:0.5rem 1.2rem;border-radius:50px;font-size:0.85rem;font-weight:600;background:rgba(16,185,129,0.15);color:#10B981}
      .status-badge-lg.inactive{background:rgba(239,68,68,0.15);color:#ef4444}
      .detail-cards{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
      .detail-card{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.08)}
      body.light .detail-card,html.light .detail-card{border-color:rgba(0,0,0,0.08)}
      .detail-card h3{margin-top:0;font-size:1rem;font-weight:700;margin-bottom:1rem}
      .detail-item{display:flex;align-items:center;gap:1rem;padding:0.8rem 0;border-bottom:1px solid rgba(255,255,255,0.04)}
      body.light .detail-item,html.light .detail-item{border-bottom-color:rgba(0,0,0,0.04)}
      .detail-item:last-child{border-bottom:none}
      .detail-icon{font-size:1.5rem}
      .detail-info{flex:1}
      .detail-label{font-size:0.78rem;color:var(--text-muted);text-transform:uppercase;font-weight:600}
      .detail-value{font-size:0.9rem;color:var(--text);font-weight:600}
      .content-list{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.08);margin-bottom:1.5rem}
      body.light .content-list,html.light .content-list{border-color:rgba(0,0,0,0.08)}
      .content-list h3{margin-top:0;font-size:1rem;font-weight:700;margin-bottom:1rem}
      .content-item{display:flex;gap:1rem;padding:1rem;background:var(--dark-2);border-radius:10px;margin-bottom:0.8rem;align-items:center}
      .content-thumb{width:60px;height:60px;border-radius:8px;background:rgba(108,58,237,0.2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0}
      .content-meta{flex:1;min-width:0}
      .content-title{font-weight:600;color:var(--text);margin-bottom:0.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .content-date{font-size:0.8rem;color:var(--text-muted)}
      .btn-schedule-small{padding:0.45rem 0.9rem;border-radius:8px;font-weight:600;font-size:0.8rem;cursor:pointer;border:1px solid rgba(108,58,237,0.3);background:transparent;color:#6C3AED;transition:all 0.2s}
      .btn-schedule-small:hover{background:rgba(108,58,237,0.1);border-color:#6C3AED}
      .back-link{display:inline-flex;align-items:center;gap:0.5rem;color:#6C3AED;text-decoration:none;font-weight:600;margin-bottom:2rem}
      .back-link:hover{text-decoration:underline}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('distribute', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <a href="/distribute" class="back-link">← Back to Workflows</a>

        <div class="workflow-detail-header">
          <div>
            <h1>${sourcePlatform?.name} → ${destPlatform?.name}</h1>
            <p style="color:var(--text-muted);font-size:0.95rem;margin:0.5rem 0 0">Workflow details and queue</p>
          </div>
          <span class="status-badge-lg ${!workflow.is_active ? 'inactive' : ''}">
            <span style="width:8px;height:8px;border-radius:50%;background:currentColor"></span>
            ${!workflow.is_active ? 'Inactive' : 'Active'}
          </span>
        </div>

        <div class="detail-cards">
          <div class="detail-card">
            <h3>Source Platform</h3>
            <div class="detail-item">
              <div class="detail-icon">${sourcePlatform?.icon}</div>
              <div class="detail-info">
                <div class="detail-label">Platform</div>
                <div class="detail-value">${sourcePlatform?.name}</div>
              </div>
            </div>
            <div class="detail-item">
              <div class="detail-icon">👤</div>
              <div class="detail-info">
                <div class="detail-label">Account</div>
                <div class="detail-value">${workflow.source_username || 'Connected'}</div>
              </div>
            </div>
          </div>

          <div class="detail-card">
            <h3>Destination Platform</h3>
            <div class="detail-item">
              <div class="detail-icon">${destPlatform?.icon}</div>
              <div class="detail-info">
                <div class="detail-label">Platform</div>
                <div class="detail-value">${destPlatform?.name}</div>
              </div>
            </div>
            <div class="detail-item">
              <div class="detail-icon">👤</div>
              <div class="detail-info">
                <div class="detail-label">Account</div>
                <div class="detail-value">${workflow.dest_username || 'Connected'}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-cards" style="grid-template-columns:1fr 1fr 1fr">
          <div class="detail-card">
            <h3>📤 Mode</h3>
            <div class="detail-item">
              <div class="detail-info">
                <div class="detail-label">Type</div>
                <div class="detail-value">${workflow.content_type === 'auto-publish' ? 'Auto-Publish' : 'Schedule'}</div>
              </div>
            </div>
          </div>

          <div class="detail-card">
            <h3>⏱ Schedule</h3>
            <div class="detail-item">
              <div class="detail-info">
                <div class="detail-label">Mode</div>
                <div class="detail-value">${workflow.delay_mode === 'immediate' ? 'Immediately' : workflow.delay_mode === 'custom' ? workflow.delay_hours + ' hrs' : 'At time'}</div>
              </div>
            </div>
          </div>

          <div class="detail-card">
            <h3>📊 Stats</h3>
            <div class="detail-item">
              <div class="detail-info">
                <div class="detail-label">Posts Sent</div>
                <div class="detail-value">${workflow.post_count || 0}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="content-list">
          <h3>📋 Content Queue</h3>
          <div style="color:var(--text-muted);font-size:0.9rem">
            <p>Scheduled content for this workflow would appear here</p>
          </div>
        </div>

        <div style="display:flex;gap:1rem">
          <button onclick="deleteWorkflow('${workflow.id}')" style="padding:0.65rem 1.6rem;border-radius:50px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;background:rgba(239,68,68,0.15);color:#ef4444;transition:all 0.3s">Delete Workflow</button>
        </div>
      </div>
    </div>

    <script>
      ${getThemeScript()}

      function deleteWorkflow(workflowId) {
        if (!confirm('Delete this workflow? This cannot be undone.')) return;
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

      function showToast(msg, type) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.3);background:' + (type === 'error' ? '#EF4444' : '#10B981') + ';color:#fff';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
      }
    </script>
    </body></html>
  `);
});

// API: Create workflow
router.post('/api/workflow', requireAuth, async (req, res) => {
  try {
    const { sourcePlatform, sourceAccountId, destPlatform, destAccountId, delayMode, delayHours, timeSlot } = req.body;

    if (!sourcePlatform || !sourceAccountId || !destPlatform || !destAccountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = getDb();
    const workflowName = `${sourcePlatform.charAt(0).toUpperCase()}${sourcePlatform.slice(1)} → ${destPlatform.charAt(0).toUpperCase()}${destPlatform.slice(1)}`;

    const workflow = await db.workflowOps.create(req.user.id, {
      name: workflowName,
      sourceAccountId,
      destinationAccountId: destAccountId,
      sourcePlatform,
      destinationPlatform: destPlatform,
      contentType: 'all',
      autoPublish: true,
      delayHours: delayMode === 'custom' ? delayHours : 0,
      delayMode: delayMode,
      settings: { timeSlot: timeSlot || null }
    });

    res.json({ success: true, workflowId: workflow.id });
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

// API: Toggle auto-publish
router.post('/api/workflow/:id/toggle', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { auto_publish } = req.body;

    const db = getDb();
    const workflow = await db.workflowOps.getById(id);
    if (!workflow || workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await db.workflowOps.toggleAutoPublish(id, auto_publish);
    res.json({ success: true });
  } catch (error) {
    console.error('Toggle auto-publish error:', error);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

// API: Delete workflow
router.delete('/api/workflow/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const db = getDb();
    const workflow = await db.workflowOps.getById(id);
    if (!workflow || workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await db.workflowOps.delete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

// API: Get connections
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

// API: Delete connection
router.delete('/api/connections/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const db = getDb();
    const connection = await db.connectedAccountOps.getById(id);
    if (!connection || connection.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await db.connectedAccountOps.deactivate(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete connection error:', error);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

module.exports = router;
