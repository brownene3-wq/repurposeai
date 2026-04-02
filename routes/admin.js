const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { requireAuth } = require('../middleware/auth');
const { adminOps, blogOps, teamOps, userOps, contactOps, bugReportOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getThemeToggle, getThemeScript } = require('../utils/theme');

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;h').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Admin auth middleware â checks role is admin
async function requireAdmin(req, res, next) {
  // Re-fetch full user to get role (req.user from JWT may not have it)
  const fullUser = await userOps.getById(req.user.id);
  if (!fullUser || fullUser.role !== 'admin') {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.redirect('/dashboard');
  }
  req.user = fullUser;
  next();
}

// Check if user has specific permission (for team members)
function hasPermission(user, member, permission) {
  if (user.role === 'admin') return true;
  if (!member) return false;
  try {
    const perms = JSON.parse(member.permissions || '{}');
    return perms[permission] === true;
  } catch { return false; }
}

function getAdminSidebar(activePage) {
  const links = [
    { href: '/admin', icon: '&#x1F4CA;', label: 'Overview', key: 'overview' },
    { href: '/admin/subscribers', icon: '&#x1F465;', label: 'Subscribers', key: 'subscribers' },
    { href: '/admin/blog', icon: '&#x270D;&#xFE0F;', label: 'Blog CMS', key: 'blog' },
    { href: '/admin/team', icon: '&#x1F91D;', label: 'Team', key: 'team' },
    { href: '/admin/messages', icon: '&#x1F4E9;', label: 'Messages', key: 'messages' },
    { href: '/admin/email', icon: '&#x1F4E7;', label: 'Email Inbox', key: 'email' },
    { href: '/admin/bugs', icon: '&#x1F41B;', label: 'Bug Reports', key: 'bugs' },
    { href: '/admin/usage', icon: '&#x1F4C8;', label: 'Usage', key: 'usage' },
  ];
  const navLinks = links.map(l => {
    const cls = l.key === activePage ? ' class="active"' : '';
    return `<a href="${l.href}"${cls}>${l.icon} ${l.label}</a>`;
  }).join('\n');

  return `
    <aside class="sidebar" style="display:flex;flex-direction:column;">
      <div style="padding:0 20px 20px;">
        <a href="/dashboard" class="logo" style="padding:0;margin:0;text-decoration:none;border-left:none;">Repurpose<span>AI</span></a>
        <div style="margin-top:8px;font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:#6C3AED;font-weight:700;">Admin Panel</div>
      </div>
      ${navLinks}
      <div style="margin-top:auto;padding:0;">
        <a href="/dashboard" style="color:var(--text-muted);font-size:.85rem;">&#x2190; Back to App</a>
        <a href="/auth/logout" style="color:#ef4444;opacity:0.7;font-size:0.85rem;">Sign Out</a>
      </div>
    </aside>`;
}

function getAdminCSS() {
  return `
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.2rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:1.5rem;transition:transform .2s}
    .stat-card:hover{transform:translateY(-2px)}
    .stat-card .label{font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem}
    .stat-card .value{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .stat-card .sub{font-size:.8rem;color:var(--text-dim);margin-top:.3rem}
    .data-table{width:100%;border-collapse:collapse;font-size:.9rem}
    .data-table th{text-align:left;padding:.8rem 1rem;border-bottom:2px solid rgba(108,58,237,0.2);color:var(--text-muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
    .data-table td{padding:.8rem 1rem;border-bottom:var(--border-subtle)}
    .data-table tr:hover td{background:rgba(108,58,237,0.04)}
    .badge{display:inline-block;padding:.2rem .6rem;border-radius:20px;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
    .badge-free{background:rgba(113,128,150,0.15);color:#A0AEC0}
    .badge-starter{background:rgba(6,182,212,0.15);color:#06B6D4}
    .badge-pro{background:rgba(108,58,237,0.15);color:#8B5CF6}
    .badge-teams{background:rgba(236,72,153,0.15);color:#EC4899}
    .badge-admin{background:rgba(239,68,68,0.15);color:#EF4444}
    .badge-editor{background:rgba(16,185,129,0.15);color:#10B981}
    .badge-viewer{background:rgba(245,158,11,0.15);color:#F59E0B}
    .badge-published{background:rgba(16,185,129,0.15);color:#10B981}
    .badge-draft{background:rgba(245,158,11,0.15);color:#F59E0B}
    .badge-pending{background:rgba(245,158,11,0.15);color:#F59E0B}
    .badge-accepted{background:rgba(16,185,129,0.15);color:#10B981}
    .badge-expired{background:rgba(239,68,68,0.15);color:#EF4444}
    .card{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:1.5rem;margin-bottom:1.5rem}
    .card h2{font-size:1.1rem;font-weight:700;margin-bottom:1rem}
    .form-group{margin-bottom:1rem}
    .form-group label{display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.03em}
    .form-group input,.form-group textarea,.form-group select{width:100%;padding:.7rem 1rem;background:var(--surface-light);border:var(--border-subtle);border-radius:10px;color:var(--text);font-size:.9rem;font-family:inherit;outline:none;transition:border-color .3s}
    .form-group input:focus,.form-group textarea:focus,.form-group select:focus{border-color:#6C3AED}
    .form-row{display:flex;gap:1rem}
    .form-row .form-group{flex:1}
    .btn-sm{padding:.45rem .9rem;font-size:.8rem;border-radius:8px;cursor:pointer;border:none;font-weight:600;transition:all .2s}
    .btn-primary-sm{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff}
    .btn-primary-sm:hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(108,58,237,0.3)}
    .btn-danger-sm{background:rgba(239,68,68,0.15);color:#EF4444}
    .btn-danger-sm:hover{background:rgba(239,68,68,0.25)}
    .btn-outline-sm{background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text-muted)}
    .btn-outline-sm:hover{border-color:#6C3AED;color:#8B5CF6}
    .search-bar{display:flex;gap:.8rem;margin-bottom:1.5rem;align-items:center}
    .search-bar input{flex:1;padding:.7rem 1rem;background:var(--surface);border:var(--border-subtle);border-radius:10px;color:var(--text);font-size:.9rem;outline:none}
    .search-bar input:focus{border-color:#6C3AED}
    body.light .search-bar select,html.light .search-bar select{background:#F8F9FC;border-color:rgba(0,0,0,0.12);color:#1A1A2E}
body.light .btn-outline-sm,html.light .btn-outline-sm{border-color:rgba(0,0,0,0.15);color:var(--text-muted)}
body.light .data-table th,html.light .data-table th{border-bottom-color:rgba(108,58,237,0.15)}
body.light .data-table tr:hover td,html.light .data-table tr:hover td{background:rgba(108,58,237,0.06)}
body.light .card,html.light .card{background:var(--surface);border-color:rgba(0,0,0,0.08)}
body.light .stat-card,html.light .stat-card{background:var(--surface);border-color:rgba(0,0,0,0.08)}
body.light .toast,html.light .toast{background:var(--success)}
    .empty-state{text-align:center;padding:3rem 1rem;color:var(--text-muted)}
    .empty-state .icon{font-size:3rem;margin-bottom:1rem}
    .tab-bar{display:flex;gap:.5rem;margin-bottom:1.5rem;border-bottom:var(--border-subtle);padding-bottom:.5rem}
    .tab-bar .tab{padding:.5rem 1rem;border-radius:8px 8px 0 0;font-size:.85rem;font-weight:600;color:var(--text-muted);cursor:pointer;border:none;background:none;transition:all .2s}
    .tab-bar .tab.active{color:#6C3AED;border-bottom:2px solid #6C3AED}
    .tab-bar .tab:hover{color:var(--text)}
    .perm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.5rem}
    .perm-item{display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;background:var(--surface-light);border-radius:8px;font-size:.82rem}
    .perm-item input[type="checkbox"]{accent-color:#6C3AED}
    .toast{position:fixed;bottom:2rem;right:2rem;background:var(--success);color:#fff;padding:1rem 1.5rem;border-radius:10px;font-size:.9rem;font-weight:500;display:none;z-index:9999;animation:slideUp .3s ease}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    .ql-toolbar.ql-snow{border-color:rgba(255,255,255,0.1)!important;background:var(--surface-light);border-radius:10px 10px 0 0}
    .ql-container.ql-snow{border-color:rgba(255,255,255,0.1)!important;background:var(--surface-light);border-radius:0 0 10px 10px;min-height:300px;font-size:.95rem;color:var(--text)}
    .ql-editor{min-height:300px;color:var(--text)}
    .ql-editor.ql-blank::before{color:var(--text-dim)}
    .ql-snow .ql-stroke{stroke:var(--text-muted)!important}
    .ql-snow .ql-fill{fill:var(--text-muted)!important}
    .ql-snow .ql-picker-label{color:var(--text-muted)!important}
    .ql-snow .ql-picker-options{background:var(--surface)!important;border-color:rgba(255,255,255,0.1)!important}
    body.light .ql-toolbar.ql-snow,html.light .ql-toolbar.ql-snow{border-color:rgba(0,0,0,0.1)!important;background:#f8f9fc}
    body.light .ql-container.ql-snow,html.light .ql-container.ql-snow{border-color:rgba(0,0,0,0.1)!important;background:#fff}
    body.light .ql-snow .ql-stroke,html.light .ql-snow .ql-stroke{stroke:#374151!important}
    body.light .ql-snow .ql-fill,html.light .ql-snow .ql-fill{fill:#374151!important}
    body.light .ql-snow .ql-picker-label,html.light .ql-snow .ql-picker-label{color:#374151!important}
    body.light .ql-snow .ql-picker-options,html.light .ql-snow .ql-picker-options{background:#fff!important;border-color:rgba(0,0,0,0.1)!important}
    @media(max-width:768px){.stat-grid{grid-template-columns:1fr 1fr}.form-row{flex-direction:column}.data-table{font-size:.8rem}}
  `;
}

// ========================
// OVERVIEW PAGE
// ========================
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await adminOps.getStats();
    const planBreakdown = await adminOps.countUsersByPlan();
    const recentUsers = await adminOps.getAllUsers(5, 0);

    res.send(`
      ${getHeadHTML('Admin Dashboard')}
      <style>${getBaseCSS()}${getAdminCSS()}</style>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('overview')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header">
            <h1>Admin Overview</h1>
            <p>Platform stats and quick insights</p>
          </div>

          <div class="stat-grid">
            <div class="stat-card">
              <div class="label">Total Users</div>
              <div class="value">${stats.totalUsers}</div>
              <div class="sub">+${stats.newUsersThisMonth} this month</div>
            </div>
            <div class="stat-card">
              <div class="label">Content Items</div>
              <div class="value">${stats.totalContent}</div>
            </div>
            <div class="stat-card">
              <div class="label">Generated Outputs</div>
              <div class="value">${stats.totalOutputs}</div>
            </div>
            <div class="stat-card">
              <div class="label">Smart Shorts</div>
              <div class="value">${stats.totalShorts}</div>
            </div>
          </div>

          <div class="card">
            <h2>Users by Plan</h2>
            <div class="stat-grid">
              ${planBreakdown.map(p => `
                <div class="stat-card">
                  <div class="label">${p.plan || 'free'}</div>
                  <div class="value">${p.count}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card">
            <h2>Recent Signups</h2>
            <table class="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Joined</th></tr></thead>
              <tbody>
                ${recentUsers.map(u => `
                  <tr>
                    <td>${escapeHtml(u.name || 'â')}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="badge badge-${u.plan || 'free'}">${u.plan || 'free'}</span></td>
                    <td>${new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <script>${getThemeScript()}</script>
      </body></html>
    `);
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).send('Error loading admin dashboard');
  }
});

// ========================
// SUBSCRIBERS PAGE
// ========================
router.get('/subscribers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await adminOps.getAllUsers(200, 0);
    const totalUsers = await adminOps.countUsers();
    const planStats = await adminOps.countUsersByPlan();

    res.send(`
      ${getHeadHTML('Subscribers - Admin')}
      <style>${getBaseCSS()}${getAdminCSS()}
      </style>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('subscribers')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header">
            <h1>Subscribers</h1>
            <p>${totalUsers} total users</p>
          </div>

          <div class="dashboard-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.5rem;margin:2rem 0;">
            <div style="background:var(--surface-light);border:1px solid var(--surface);border-radius:16px;padding:1.5rem;">
              <div style="font-size:.75rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.5rem;">Total Subscribers</div>
              <div style="font-size:2.2rem;font-weight:700;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${totalUsers}</div>
            </div>
            ${(planStats || []).map(p => `
            <div style="background:var(--surface-light);border:1px solid var(--surface);border-radius:16px;padding:1.5rem;">
              <div style="font-size:.75rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.5rem;">${(p.plan || 'free').charAt(0).toUpperCase() + (p.plan || 'free').slice(1)} Plan</div>
              <div style="font-size:2.2rem;font-weight:700;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${p.count}</div>
            </div>
            `).join('')}
          </div>

          <div style="background:var(--surface-light);border:1px solid var(--surface);border-radius:16px;padding:2rem;margin-bottom:2rem;">
            <h2 style="margin:0 0 1.5rem;font-size:1.3rem;font-weight:600;color:var(--text-primary, #111827);">Subscriber Growth</h2>
            <canvas id="growthChart" height="100"></canvas>
          </div>
          <script>
          (function(){
            const users = [${users.map(u => `{created: "${u.created_at}"}`).join(',')}];
            const dailyCounts = {};
            users.forEach(u => {
              const d = new Date(u.created).toISOString().split('T')[0];
              dailyCounts[d] = (dailyCounts[d] || 0) + 1;
            });
            const sortedDates = Object.keys(dailyCounts).sort();
            let cumulative = 0;
            const labels = [];
            const data = [];
            sortedDates.forEach(d => {
              cumulative += dailyCounts[d];
              labels.push(d);
              data.push(cumulative);
            });
            const ctx = document.getElementById('growthChart');
            if(ctx) {
              const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
              new Chart(ctx, {
                type: 'line',
                data: {
                  labels: labels.map(l => new Date(l).toLocaleDateString()),
                  datasets: [{
                    label: 'Total Subscribers',
                    data: data,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168,85,247,0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointBackgroundColor: '#7c3aed',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                  }]
                },
                options: {
                  responsive: true,
                  plugins: {
                    legend: { display: false }
                  },
                  scales: {
                    x: {
                      grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
                      ticks: { color: isDark ? '#9ca3af' : '#6b7280' }
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
                      ticks: { color: isDark ? '#9ca3af' : '#6b7280', stepSize: 1 }
                    }
                  }
                }
              });
            }
          })();
          <\/script>

          <div class="search-bar">
            <input type="text" id="userSearch" placeholder="Search by name or email...">
            <select id="planFilter" style="padding:.7rem 1rem;background:var(--surface);border:var(--border-subtle);border-radius:10px;color:var(--text);font-size:.9rem">
              <option value="">All Plans</option>
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="teams">Teams</option>
            </select>
          </div>

          <div class="card" style="overflow-x:auto">
            <table class="data-table" id="usersTable">
              <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                ${users.map(u => `
                  <tr data-name="${escapeHtml((u.name || '').toLowerCase())}" data-email="${escapeHtml(u.email.toLowerCase())}" data-plan="${u.plan || 'free'}">
                    <td>${escapeHtml(u.name || 'â')}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="badge badge-${u.plan || 'free'}">${u.plan || 'free'}</span></td>
                    <td><span class="badge badge-${u.role || 'user'}">${u.role || 'user'}</span></td>
                    <td>${new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <button class="btn-sm btn-outline-sm" onclick="toggleRole('${u.id}','${u.role || 'user'}')">
                        ${u.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <script>
        ${getThemeScript()}

        // Search and filter
        document.getElementById('userSearch').addEventListener('input', filterUsers);
        document.getElementById('planFilter').addEventListener('change', filterUsers);
        function filterUsers() {
          const q = document.getElementById('userSearch').value.toLowerCase().trim();
          const plan = document.getElementById('planFilter').value;
          document.querySelectorAll('#usersTable tbody tr').forEach(function(row) {
            const name = row.getAttribute('data-name');
            const email = row.getAttribute('data-email');
            const rowPlan = row.getAttribute('data-plan');
            const matchSearch = !q || name.includes(q) || email.includes(q);
            const matchPlan = !plan || rowPlan === plan;
            row.style.display = (matchSearch && matchPlan) ? '' : 'none';
          });
        }

        async function toggleRole(userId, currentRole) {
          const newRole = currentRole === 'admin' ? 'user' : 'admin';
          if (!confirm('Set this user role to ' + newRole + '?')) return;
          try {
            const res = await fetch('/admin/api/set-role', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, role: newRole })
            });
            if (!res.ok) throw new Error('Failed');
            showToast('Role updated to ' + newRole);
            setTimeout(function() { location.reload(); }, 800);
          } catch (e) {
            showToast('Error updating role');
          }
        }

        function showToast(msg) {
          var t = document.getElementById('toast');
          t.textContent = msg; t.style.display = 'block';
          setTimeout(function() { t.style.display = 'none'; }, 3000);
        }
      </script>
      </body></html>
    `);
  } catch (err) {
    console.error('Subscribers error:', err);
    res.status(500).send('Error loading subscribers');
  }
});

// ========================
// BLOG CMS PAGE
// ========================
router.get('/blog', requireAuth, requireAdmin, async (req, res) => {
  try {
    const posts = await blogOps.getAll();

    res.send(`
      ${getHeadHTML('Blog CMS - Admin')}
      <link href="https://cdn.quilljs.com/1.3.7/quill.snow.css" rel="stylesheet">
      <style>${getBaseCSS()}${getAdminCSS()}</style>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('blog')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <h1>Blog CMS</h1>
              <p>Create and manage blog posts</p>
            </div>
            <button class="btn-sm btn-primary-sm" onclick="showEditor()" style="padding:.6rem 1.2rem;font-size:.85rem">+ New Post</button>
          </div>

          <!-- POST LIST -->
          <div id="postList">
            ${posts.length === 0 ? `
              <div class="empty-state">
                <div class="icon">&#x270D;&#xFE0F;</div>
                <p>No blog posts yet. Create your first one!</p>
              </div>
            ` : `
              <div class="card" style="overflow-x:auto">
                <table class="data-table">
                  <thead><tr><th>Title</th><th>Author</th><th>Tag</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
                  <tbody>
                    ${posts.map(p => `
                      <tr>
                        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title}</td>
                        <td>${p.author_name || 'Unknown'}</td>
                        <td><span class="badge badge-starter">${p.tag}</span></td>
                        <td><span class="badge badge-${p.status}">${p.status}</span></td>
                        <td>${new Date(p.created_at).toLocaleDateString()}</td>
                        <td style="white-space:nowrap">
                          <button class="btn-sm btn-outline-sm" onclick="editPost('${p.id}')">Edit</button>
                          <button class="btn-sm btn-danger-sm" onclick="deletePost('${p.id}')">Delete</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- POST EDITOR (hidden by default) -->
          <div id="postEditor" style="display:none">
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                <h2 id="editorTitle">New Blog Post</h2>
                <button class="btn-sm btn-outline-sm" onclick="hideEditor()">&#x2190; Back to posts</button>
              </div>
              <input type="hidden" id="postId" value="">
              <div class="form-row">
                <div class="form-group">
                  <label>Title</label>
                  <input type="text" id="postTitleInput" placeholder="Enter post title..." oninput="autoSlug()">
                </div>
                <div class="form-group" style="max-width:200px">
                  <label>Tag</label>
                  <select id="postTag">
                    <option>General</option>
                    <option>Content Strategy</option>
                    <option>AI & Automation</option>
                    <option>Growth</option>
                    <option>Product Update</option>
                    <option>Tips & Tricks</option>
                    <option>Case Study</option>
                    <option>Brand Voice</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>URL Slug</label>
                  <input type="text" id="postSlug" placeholder="auto-generated-from-title">
                </div>
                <div class="form-group">
                  <label>Cover Image URL (optional)</label>
                  <input type="text" id="postCover" placeholder="https://...">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Excerpt</label>
                  <input type="text" id="postExcerpt" placeholder="Short summary for the blog listing page..." maxlength="300">
                </div>
                <div class="form-group" style="max-width:250px">
                  <label>Author Name (optional)</label>
                  <input type="text" id="postAuthorName" placeholder="Leave blank for your name">
                </div>
              </div>
              <div class="form-group">
                <label>Content</label>
                <div id="quillEditor"></div>
              </div>
              <div style="display:flex;gap:.8rem;margin-top:1rem">
                <button class="btn-sm btn-primary-sm" onclick="savePost('published')" style="padding:.6rem 1.5rem">Publish</button>
                <button class="btn-sm btn-outline-sm" onclick="savePost('draft')" style="padding:.6rem 1.5rem">Save as Draft</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
      <script>
        ${getThemeScript()}

        var quill = new Quill('#quillEditor', {
          theme: 'snow',
          placeholder: 'Write your blog post here...',
          modules: {
            toolbar: [
              [{ header: [1, 2, 3, false] }],
              ['bold', 'italic', 'underline', 'strike'],
              [{ list: 'ordered' }, { list: 'bullet' }],
              ['blockquote', 'code-block'],
              ['link', 'image'],
              [{ color: [] }, { background: [] }],
              ['clean']
            ]
          }
        });

        function autoSlug() {
          var title = document.getElementById('postTitleInput').value;
          var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          document.getElementById('postSlug').value = slug;
        }

        function showEditor(postData) {
          document.getElementById('postList').style.display = 'none';
          document.getElementById('postEditor').style.display = 'block';
          if (postData) {
            document.getElementById('editorTitle').textContent = 'Edit Post';
            document.getElementById('postId').value = postData.id;
            document.getElementById('postTitleInput').value = postData.title;
            document.getElementById('postSlug').value = postData.slug;
            document.getElementById('postExcerpt').value = postData.excerpt || '';
            document.getElementById('postCover').value = postData.cover_image || '';
            document.getElementById('postTag').value = postData.tag || 'General';
            document.getElementById('postAuthorName').value = postData.author_name || '';
            quill.root.innerHTML = postData.content || '';
          } else {
            document.getElementById('editorTitle').textContent = 'New Blog Post';
            document.getElementById('postId').value = '';
            document.getElementById('postTitleInput').value = '';
            document.getElementById('postSlug').value = '';
            document.getElementById('postExcerpt').value = '';
            document.getElementById('postCover').value = '';
            document.getElementById('postTag').value = 'General';
            document.getElementById('postAuthorName').value = '';
            quill.root.innerHTML = '';
          }
        }

        function hideEditor() {
          document.getElementById('postList').style.display = 'block';
          document.getElementById('postEditor').style.display = 'none';
        }

        async function editPost(id) {
          try {
            const res = await fetch('/admin/api/blog/' + id);
            const post = await res.json();
            showEditor(post);
          } catch (e) {
            showToast('Error loading post');
          }
        }

        async function savePost(status) {
          const id = document.getElementById('postId').value;
          const data = {
            title: document.getElementById('postTitleInput').value,
            slug: document.getElementById('postSlug').value,
            excerpt: document.getElementById('postExcerpt').value,
            content: quill.root.innerHTML,
            coverImage: document.getElementById('postCover').value,
            tag: document.getElementById('postTag').value,
            authorName: document.getElementById('postAuthorName').value,
            status: status
          };
          if (!data.title || !data.slug) { showToast('Title and slug are required'); return; }
          try {
            const url = id ? '/admin/api/blog/' + id : '/admin/api/blog';
            const method = id ? 'PUT' : 'POST';
            const res = await fetch(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
            showToast(status === 'published' ? 'Post published!' : 'Draft saved!');
            setTimeout(function() { location.reload(); }, 800);
          } catch (e) {
            showToast('Error: ' + e.message);
          }
        }

        async function deletePost(id) {
          if (!confirm('Delete this blog post?')) return;
          try {
            const res = await fetch('/admin/api/blog/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed');
            showToast('Post deleted');
            setTimeout(function() { location.reload(); }, 800);
          } catch (e) {
            showToast('Error deleting post');
          }
        }

        function showToast(msg) {
          var t = document.getElementById('toast');
          t.textContent = msg; t.style.display = 'block';
          setTimeout(function() { t.style.display = 'none'; }, 3000);
        }
      </script>
      </body></html>
    `);
  } catch (err) {
    console.error('Blog CMS error:', err);
    res.status(500).send('Error loading blog CMS');
  }
});

// ========================
// TEAM MANAGEMENT PAGE
// ========================
router.get('/team', requireAuth, requireAdmin, async (req, res) => {
  try {
    const members = await teamOps.getMembers();
    const invitations = await teamOps.getInvitations();

    const allPermissions = [
      { key: 'use_repurpose', label: 'Use Repurpose Tool' },
      { key: 'use_shorts', label: 'Use Smart Shorts' },
      { key: 'use_calendar', label: 'Use Calendar' },
      { key: 'use_brand_voice', label: 'Use Brand Voice' },
      { key: 'view_analytics', label: 'View Analytics' },
      { key: 'view_billing', label: 'View Billing' },
      { key: 'manage_settings', label: 'Manage Settings' },
      { key: 'blog_create', label: 'Create Blog Posts' },
      { key: 'blog_edit', label: 'Edit Blog Posts' },
      { key: 'blog_delete', label: 'Delete Blog Posts' },
      { key: 'blog_publish', label: 'Publish Blog Posts' },
      { key: 'view_subscribers', label: 'View Subscribers' },
      { key: 'view_messages', label: 'View Messages' },
      { key: 'view_emails', label: 'View Emails' },
      { key: 'reply_emails', label: 'Reply to Emails' },
      { key: 'manage_team', label: 'Manage Team' },
    ];

    res.send(`
      ${getHeadHTML('Team Management - Admin')}
      <style>${getBaseCSS()}${getAdminCSS()}</style>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('team')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header">
            <h1>Team Management</h1>
            <p>Invite workers and manage permissions</p>
          </div>

          <!-- INVITE FORM -->
          <div class="card">
            <h2>Invite New Team Member</h2>
            <div class="form-row">
              <div class="form-group">
                <label>Email Address</label>
                <input type="email" id="inviteEmail" placeholder="worker@example.com">
              </div>
              <div class="form-group" style="max-width:200px">
                <label>Role</label>
                <select id="inviteRole">
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Custom Permissions</label>
              <div class="perm-grid" id="invitePerms">
                ${allPermissions.map(p => `
                  <label class="perm-item">
                    <input type="checkbox" name="perm" value="${p.key}"> ${p.label}
                  </label>
                `).join('')}
              </div>
            </div>
            <button class="btn-sm btn-primary-sm" onclick="sendInvite()" style="padding:.6rem 1.5rem">Send Invitation</button>
          </div>

          <!-- CURRENT TEAM MEMBERS -->
          <div class="card">
            <h2>Team Members (${members.length})</h2>
            ${members.length === 0 ? '<p style="color:var(--text-muted)">No team members yet.</p>' : `
              <table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Permissions</th><th>Actions</th></tr></thead>
                <tbody>
                  ${members.map(m => {
                    let perms = {};
                    try { perms = JSON.parse(m.permissions || '{}'); } catch(e) {}
                    const permLabels = Object.keys(perms).filter(k => perms[k]).map(k => k.replace(/_/g,' ')).join(', ');
                    return `
                      <tr>
                        <td>${m.name || 'â'}</td>
                        <td>${m.email}</td>
                        <td><span class="badge badge-${m.role}">${m.role}</span></td>
                        <td style="max-width:200px;font-size:.8rem;color:var(--text-muted)">${permLabels || 'None'}</td>
                        <td>
                          <button class="btn-sm btn-danger-sm" onclick="removeMember('${m.id}')">Remove</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>

          <!-- PENDING INVITATIONS -->
          <div class="card">
            <h2>Pending Invitations (${invitations.filter(i => i.status === 'pending').length})</h2>
            ${invitations.length === 0 ? '<p style="color:var(--text-muted)">No invitations sent yet.</p>' : `
              <table class="data-table">
                <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Invited By</th><th>Sent</th><th>Actions</th></tr></thead>
                <tbody>
                  ${invitations.map(i => `
                    <tr>
                      <td>${i.email}</td>
                      <td><span class="badge badge-${i.role}">${i.role}</span></td>
                      <td><span class="badge badge-${i.status}">${i.status}</span></td>
                      <td>${i.inviter_name || 'â'}</td>
                      <td>${new Date(i.created_at).toLocaleDateString()}</td>
                      <td>
                        ${i.status === 'pending' ? `<button class="btn-sm btn-danger-sm" onclick="revokeInvite('${i.id}')">Revoke</button>` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <script>
        ${getThemeScript()}

        async function sendInvite() {
          const email = document.getElementById('inviteEmail').value.trim();
          const role = document.getElementById('inviteRole').value;
          if (!email) { showToast('Email is required'); return; }
          var perms = {};
          document.querySelectorAll('#invitePerms input[type="checkbox"]').forEach(function(cb) {
            if (cb.checked) perms[cb.value] = true;
          });
          try {
            const res = await fetch('/admin/api/team/invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, role, permissions: perms })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            showToast('Invitation sent! Link: ' + window.location.origin + '/admin/invite/' + data.token);
            setTimeout(function() { location.reload(); }, 2000);
          } catch (e) {
            showToast('Error: ' + e.message);
          }
        }

        async function removeMember(id) {
          if (!confirm('Remove this team member?')) return;
          try {
            await fetch('/admin/api/team/member/' + id, { method: 'DELETE' });
            showToast('Member removed');
            setTimeout(function() { location.reload(); }, 800);
          } catch (e) { showToast('Error removing member'); }
        }

        async function revokeInvite(id) {
          if (!confirm('Revoke this invitation?')) return;
          try {
            await fetch('/admin/api/team/invite/' + id, { method: 'DELETE' });
            showToast('Invitation revoked');
            setTimeout(function() { location.reload(); }, 800);
          } catch (e) { showToast('Error revoking invitation'); }
        }

        function showToast(msg) {
          var t = document.getElementById('toast');
          t.textContent = msg; t.style.display = 'block';
          setTimeout(function() { t.style.display = 'none'; }, 4000);
        }
      </script>
      </body></html>
    `);
  } catch (err) {
    console.error('Team page error:', err);
    res.status(500).send('Error loading team page');
  }
});

// ========================
// MESSAGES PAGE (Contact form submissions)
// ========================
router.get('/messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const messages = await contactOps.getAll(100, 0);

    res.send(`
      ${getHeadHTML('Messages - Admin')}
      <style>${getBaseCSS()}${getAdminCSS()}
        .card.unread { border-left: 4px solid #a855f7; }
        .card.unread .msg-name { font-weight: 700; }
        .read-badge { display:inline-block;padding:2px 10px;border-radius:12px;font-size:.75rem;font-weight:600; }
        .read-badge.unread { background:#7c3aed;color:#fff; }
        .read-badge.read { background:var(--border-color,#374151);color:var(--text-dim,#9ca3af); }
        .response-badge { display:inline-block;padding:2px 10px;border-radius:12px;font-size:.75rem;font-weight:600;margin-left:8px; }
        .response-badge.within { background:#059669;color:#fff; }
        .response-badge.over { background:#dc2626;color:#fff; }
        .response-badge.pending { background:#d97706;color:#fff; }
      </style>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('messages')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header">
            <h1>Contact Messages</h1>
            <p>${messages.length} messages from your contact form</p>
          </div>

          ${messages.length === 0 ? `
            <div class="empty-state">
              <div class="icon">&#x1F4E9;</div>
              <p>No messages yet.</p>
            </div>
          ` : messages.map((m, i) => `
            <div class="card ${m.is_read ? '' : 'unread'}" id="msg-${i}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.8rem">
                <div>
                  <strong>${m.name}</strong> <span style="color:var(--text-muted);font-size:.85rem">&lt;${m.email}&gt;</span>
                </div>
                <span style="font-size:.8rem;color:var(--text-dim)">${new Date(m.created_at).toLocaleString()}</span>
                <span class="read-badge ${m.is_read ? 'read' : 'unread'}">${m.is_read ? 'Read' : 'New'}</span>
              </div>
              <div style="font-size:.85rem;color:var(--primary-light);margin-bottom:.5rem">${m.subject}</div>
              <p style="font-size:.9rem;color:var(--text-muted);line-height:1.6;margin-bottom:1rem">${m.message}</p>
              <div id="reply-area-${i}">
                <button class="btn-sm" style="margin-right:8px;background:${m.is_read ? 'var(--border-color,#374151)' : '#7c3aed'};color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;" onclick="markRead('${m.id}',${i})">${m.is_read ? '\u2713 Read' : 'Mark Read'}</button>
                <button class="btn-sm btn-primary-sm" onclick="showReplyForm(${i}, '${m.email.replace(/'/g, "\\'")}', '${(m.subject || 'General Inquiry').replace(/'/g, "\\'")}')">Reply</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="toast" id="toast" style="position:fixed;bottom:2rem;right:2rem;background:#10B981;color:#fff;padding:1rem 1.5rem;border-radius:10px;font-size:.9rem;font-weight:500;display:none;z-index:9999"></div>
      <script>
        ${getThemeScript()}

        async function markRead(id, idx) {
          await fetch('/admin/messages/' + id + '/read', { method: 'POST' });
          location.reload();
        }
        async function markResponded(id) {
          await fetch('/admin/messages/' + id + '/responded', { method: 'POST' });
        }
        function showReplyForm(idx, email, subject) {
          var area = document.getElementById('reply-area-' + idx);
          area.innerHTML = '<div style="margin-top:.8rem;border-top:1px solid rgba(255,255,255,0.06);padding-top:1rem">' +
            '<div style="font-size:.85rem;font-weight:600;margin-bottom:.5rem">Reply to ' + escapeHtml(email) + '</div>' +
            '<textarea id="reply-body-' + idx + '" placeholder="Type your reply..." style="width:100%;padding:.8rem 1rem;background:rgba(255,255,255,0.04);border:1px solid rgba(124,58,237,0.15);border-radius:10px;color:var(--text);font-size:.9rem;font-family:inherit;outline:none;min-height:100px;resize:vertical;margin-bottom:.5rem"></textarea>' +
            '<div style="display:flex;gap:.5rem">' +
              '<button id="reply-btn-' + idx + '" class="btn-sm btn-primary-sm" onclick="sendReply(' + idx + ', \\'' + email.replace(/'/g, "\\\\'") + '\\', \\'' + subject.replace(/'/g, "\\\\'") + '\\')">Send Reply</button>' +
              '<button class="btn-sm btn-outline-sm" onclick="cancelReply(' + idx + ', \\'' + email.replace(/'/g, "\\\\'") + '\\', \\'' + subject.replace(/'/g, "\\\\'") + '\\')">Cancel</button>' +
            '</div>' +
          '</div>';
          document.getElementById('reply-body-' + idx).focus();
        }

        function cancelReply(idx, email, subject) {
          var area = document.getElementById('reply-area-' + idx);
          area.innerHTML = '<button class="btn-sm btn-primary-sm" onclick="showReplyForm(' + idx + ', \\'' + email.replace(/'/g, "\\\\'") + '\\', \\'' + subject.replace(/'/g, "\\\\'") + '\\')">Reply</button>';
        }

        async function sendReply(idx, email, subject) {
          var body = document.getElementById('reply-body-' + idx).value.trim();
          if (!body) { showToast('Please type a reply'); return; }

          var btn = document.getElementById('reply-btn-' + idx);
          btn.disabled = true;
          btn.textContent = 'Sending...';

          try {
            var res = await fetch('/admin/messages/reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: email, subject: subject, body: body })
            });
            var data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send');

            var area = document.getElementById('reply-area-' + idx);
            area.innerHTML = '<div style="margin-top:.8rem;padding:1rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:10px;text-align:center">' +
              '<span style="color:#10B981;font-weight:600;font-size:.85rem">&#x2705; Reply sent to ' + escapeHtml(email) + '</span>' +
            '</div>';
            showToast('Reply sent!');
          } catch(e) {
            showToast('Error: ' + e.message);
            btn.disabled = false;
            btn.textContent = 'Send Reply';
          }
        }

        function escapeHtml(s) {
          if (!s) return '';
          return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function showToast(msg) {
          var t = document.getElementById('toast');
          t.textContent = msg; t.style.display = 'block';
          setTimeout(function() { t.style.display = 'none'; }, 3000);
        }
      </script>
      </body></html>
    `);
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).send('Error loading messages');
  }
});

// ========================
// REPLY TO CONTACT MESSAGE (via Gmail)

router.post('/messages/:id/read', requireAuth, requireAdmin, async (req, res) => {
  try {
    await contactOps.markAsRead(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/messages/:id/responded', requireAuth, requireAdmin, async (req, res) => {
  try {
    await contactOps.markAsResponded(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ========================
router.post('/messages/reply', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'Recipient and message body are required' });

    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({ error: 'Gmail not configured. Set up Gmail in Email Inbox settings first.' });
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://repurposeai.ai/admin/email/oauth-callback');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const replySubject = subject?.startsWith('Re:') ? subject : 'Re: ' + (subject || 'Your message');

    const rawEmail = [
      'From: support@repurposeai.ai',
      'To: ' + to,
      'Subject: ' + replySubject,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawEmail).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Message reply error:', err);
    res.status(500).json({ error: 'Failed to send reply: ' + err.message });
  }
});

// ========================
// INVITATION ACCEPT PAGE (public)
// ========================
router.get('/invite/:token', async (req, res) => {
  try {
    const invitation = await teamOps.getInvitationByToken(req.params.token);
    if (!invitation || invitation.status !== 'pending') {
      return res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#06060f;color:#fff">
        <div style="text-align:center"><h1>Invalid Invitation</h1><p style="color:#a0a0c0">This invitation is invalid or has expired.</p><a href="/" style="color:#7c3aed">Go Home</a></div>
      </body></html>`);
    }
    if (new Date(invitation.expires_at) < new Date()) {
      await teamOps.updateInvitationStatus(invitation.id, 'expired');
      return res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#06060f;color:#fff">
        <div style="text-align:center"><h1>Invitation Expired</h1><p style="color:#a0a0c0">This invitation has expired. Please ask the admin to send a new one.</p><a href="/" style="color:#7c3aed">Go Home</a></div>
      </body></html>`);
    }
    // Redirect to registration with the invite token
    res.redirect(`/auth/register?invite=${req.params.token}`);
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).send('Error processing invitation');
  }
});

// ========================
// API ENDPOINTS
// ========================

// Set user role
router.post('/api/set-role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, role } = req.body;
    if (!['admin', 'user', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const user = await adminOps.setUserRole(userId, role);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Blog CRUD API
router.get('/api/blog/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await blogOps.getById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get post' });
  }
});

router.post('/api/blog', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, slug, excerpt, content, coverImage, tag, status, authorName } = req.body;
    if (!title || !slug) return res.status(400).json({ error: 'Title and slug required' });
    const post = await blogOps.create(req.user.id, title, slug, excerpt, content, tag, coverImage, status, authorName);
    res.json(post);
  } catch (err) {
    console.error('Blog create error:', err);
    if (err.code === '23505') return res.status(400).json({ error: 'A post with this slug already exists' });
    res.status(500).json({ error: 'Failed to create post' });
  }
});

router.put('/api/blog/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await blogOps.update(req.params.id, req.body);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    console.error('Blog update error:', err);
    if (err.code === '23505') return res.status(400).json({ error: 'A post with this slug already exists' });
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.delete('/api/blog/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await blogOps.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Team API
router.post('/api/team/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, role, permissions } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const invitation = await teamOps.createInvitation(req.user.id, email, role || 'editor', permissions || {});
    const inviteLink = 'https://repurposeai.ai/admin/invite/' + invitation.token;

    // Send invitation email via Gmail
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (clientId && clientSecret && refreshToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://repurposeai.ai/admin/email/oauth-callback');
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const roleName = (role || 'editor').charAt(0).toUpperCase() + (role || 'editor').slice(1);
        const htmlBody = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0c0c1d;color:#f0f0ff;border-radius:16px;overflow:hidden">
            <div style="background:linear-gradient(135deg,#7c3aed,#06b6d4);padding:30px 40px">
              <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">RepurposeAI</h1>
            </div>
            <div style="padding:40px">
              <h2 style="margin:0 0 16px;font-size:20px;color:#f0f0ff">You're Invited!</h2>
              <p style="color:#a0a0c0;font-size:15px;line-height:1.7;margin:0 0 8px">
                You've been invited to join <strong style="color:#f0f0ff">RepurposeAI</strong> as a <strong style="color:#8B5CF6">${roleName}</strong>.
              </p>
              <p style="color:#a0a0c0;font-size:15px;line-height:1.7;margin:0 0 24px">
                Click the button below to accept your invitation and get started.
              </p>
              <a href="${inviteLink}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#EC4899);color:#fff;text-decoration:none;border-radius:99px;font-weight:700;font-size:15px">
                Accept Invitation &rarr;
              </a>
              <p style="color:#6a6a8e;font-size:13px;margin-top:24px;line-height:1.6">
                This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
              </p>
              <hr style="border:none;border-top:1px solid rgba(124,58,237,0.15);margin:24px 0">
              <p style="color:#6a6a8e;font-size:12px;margin:0">
                If the button doesn't work, copy this link: ${inviteLink}
              </p>
            </div>
          </div>
        `;

        const rawEmail = [
          'From: support@repurposeai.ai',
          'To: ' + email,
          'Subject: You\'re invited to join RepurposeAI',
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=utf-8',
          '',
          htmlBody
        ].join('\r\n');

        const encodedMessage = Buffer.from(rawEmail).toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedMessage }
        });
        console.log('Invitation email sent to:', email);
      } catch (emailErr) {
        console.error('Failed to send invitation email (invite still created):', emailErr.message);
      }
    }

    res.json({ success: true, token: invitation.token });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

router.delete('/api/team/invite/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await teamOps.deleteInvitation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke invitation' });
  }
});

router.delete('/api/team/member/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await teamOps.removeMember(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Accept invitation API (called after registration/login)
router.post('/api/team/accept', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    const invitation = await teamOps.getInvitationByToken(token);
    if (!invitation || invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }
    if (new Date(invitation.expires_at) < new Date()) {
      await teamOps.updateInvitationStatus(invitation.id, 'expired');
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    // Add as team member
    let perms = {};
    try { perms = JSON.parse(invitation.permissions || '{}'); } catch(e) {}
    await teamOps.addMember(req.user.id, invitation.invited_by, invitation.role, perms);
    await teamOps.updateInvitationStatus(invitation.id, 'accepted');
    // Set user role
    await adminOps.setUserRole(req.user.id, invitation.role);
    res.json({ success: true });
  } catch (err) {
    console.error('Accept invite error:', err);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// ========================
// BUG REPORTS PAGE
// ========================
router.get('/bugs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const reports = await bugReportOps.getAll();
    const openCount = reports.filter(r => r.status === 'open').length;
    const resolvedCount = reports.filter(r => r.status === 'resolved').length;

    const reportRows = reports.map(r => {
      const statusBadge = r.status === 'open' ? 'badge-pending' : r.status === 'resolved' ? 'badge-published' : 'badge-draft';
      const categoryIcons = { bug: '&#x1F41B;', feature: '&#x1F4A1;', ui: '&#x1F3A8;', performance: '&#x26A1;', other: '&#x1F4AC;' };
      const catIcon = categoryIcons[r.category] || '&#x1F4AC;';
      const date = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const email = r.user_email || 'Anonymous';
      const desc = (r.description || '').length > 120 ? r.description.substring(0, 120) + '...' : r.description;
      return `<tr class="${r.is_read ? '' : 'unread-row'}">
        <td>${catIcon} ${r.category}</td>
        <td style="max-width:300px">${desc}</td>
        <td>${r.page || '-'}</td>
        <td>${email}</td>
        <td><span class="badge ${statusBadge}">${r.status}</span></td>
        <td>${date}</td>
        <td>
          ${r.status === 'open' ? `<button class="btn-sm btn-primary-sm" onclick="updateBugStatus('${r.id}','resolved')">Resolve</button>` : `<button class="btn-sm btn-outline-sm" onclick="updateBugStatus('${r.id}','open')">Reopen</button>`}
          <button class="btn-sm btn-danger-sm" onclick="deleteBug('${r.id}')" style="margin-left:4px">Delete</button>
         <button class="btn-sm" style="margin-top:4px;background:${r.is_read ? 'var(--border-color,#374151)' : '#7c3aed'};color:#fff;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;" onclick="markBugRead('${r.id}')">${r.is_read ? '\u2713' : 'Mark Read'}</button></td>
      </tr>`;
    }).join('');

    res.send(`
      ${getHeadHTML('Bug Reports')}
      <style>${getBaseCSS()}${getAdminCSS()}
        tr.unread-row { background: rgba(124,58,237,0.08) !important; }
        tr.unread-row td:first-child { border-left: 3px solid #a855f7; }
      </style>
      </head>
      <body>
      <div class="dashboard">
        ${getAdminSidebar('bugs')}
        ${getThemeToggle()}
        <main class="main-content">
          <div class="page-header">
            <h1>&#x1F41B; Bug Reports</h1>
            <p>User-submitted feedback and bug reports</p>
          </div>

          <div class="stat-grid">
            <div class="stat-card"><div class="label">Total Reports</div><div class="value">${reports.length}</div></div>
            <div class="stat-card"><div class="label">Open</div><div class="value">${openCount}</div></div>
            <div class="stat-card"><div class="label">Resolved</div><div class="value">${resolvedCount}</div></div>
          </div>

          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
              <h2>All Reports</h2>
              <div>
                <button class="btn-sm btn-outline-sm" onclick="filterBugs('all')" id="filterAll" style="margin-right:4px">All</button>
                <button class="btn-sm btn-outline-sm" onclick="filterBugs('open')" id="filterOpen" style="margin-right:4px">Open</button>
                <button class="btn-sm btn-outline-sm" onclick="filterBugs('resolved')" id="filterResolved">Resolved</button>
              </div>
            </div>
            ${reports.length === 0 ? `
              <div class="empty-state">
                <div class="icon">&#x1F389;</div>
                <p>No bug reports yet. That's a good sign!</p>
              </div>
            ` : `
              <div style="overflow-x:auto">
                <table class="data-table" id="bugsTable">
                  <thead><tr>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Page</th>
                    <th>User</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr></thead>
                  <tbody>${reportRows}</tbody>
                </table>
              </div>
            `}
          </div>
        </main>
      </div>
      <div class="toast" id="toast"></div>
      <script>
        ${getThemeScript()}

        function showToast(msg, color) {
          var t = document.getElementById('toast');
          t.textContent = msg;
          t.style.background = color || 'var(--success)';
          t.style.display = 'block';
          setTimeout(function() { t.style.display = 'none'; }, 3000);
        }

        async function markBugRead(id) {
          await fetch('/admin/bugs/' + id + '/read', { method: 'POST' });
          location.reload();
        }
        function updateBugStatus(id, status) {
          fetch('/admin/api/bugs/' + id + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) { showToast('Status updated!'); window.location.reload(); }
            else showToast(data.error || 'Failed', '#EF4444');
          })
          .catch(function() { showToast('Error updating status', '#EF4444'); });
        }

        function deleteBug(id) {
          if (!confirm('Delete this report permanently?')) return;
          fetch('/admin/api/bugs/' + id, { method: 'DELETE' })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) { showToast('Report deleted'); window.location.reload(); }
            else showToast(data.error || 'Failed', '#EF4444');
          })
          .catch(function() { showToast('Error', '#EF4444'); });
        }

        function filterBugs(status) {
          var rows = document.querySelectorAll('#bugsTable tbody tr');
          rows.forEach(function(row) {
            var badge = row.querySelector('.badge');
            if (!badge) return;
            var rowStatus = badge.textContent.trim();
            if (status === 'all') row.style.display = '';
            else row.style.display = rowStatus === status ? '' : 'none';
          });
          document.querySelectorAll('[id^="filter"]').forEach(function(b) { b.style.borderColor = ''; b.style.color = ''; });
          var active = document.getElementById('filter' + status.charAt(0).toUpperCase() + status.slice(1));
          if (active) { active.style.borderColor = '#6C3AED'; active.style.color = '#8B5CF6'; }
        }
      </script>
      </body></html>
    `);
  } catch (err) {
    console.error('Admin bugs error:', err);
    res.status(500).send('Error loading bug reports');
  }
});

// API: Update bug status
router.put('/api/bugs/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body;
    await bugReportOps.updateStatus(req.params.id, status, notes || '');
    res.json({ success: true });
  } catch (err) {
    console.error('Update bug status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// API: Delete bug report
router.delete('/api/bugs/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await bugReportOps.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete bug error:', err);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});


router.post('/bugs/:id/read', requireAuth, requireAdmin, async (req, res) => {
  try {
    await bugReportOps.markAsRead(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/bugs/:id/responded', requireAuth, requireAdmin, async (req, res) => {
  try {
    await bugReportOps.markAsResponded(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ==================== USAGE ====================
router.get('/usage', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usageStats, platformBreakdown, summary] = await Promise.all([
      adminOps.getUserUsageStats(),
      adminOps.getPlatformBreakdown(),
      adminOps.getUsageSummary()
    ]);

    const platformRows = platformBreakdown.map(p => `<tr><td>${p.platform || 'Unknown'}</td><td class="value">${p.count}</td></tr>`).join('');

    const userRows = usageStats.map(u => {
      const plan = (u.plan || 'free').toLowerCase();
      const badgeClass = plan === 'pro' ? 'badge-pro' : plan === 'starter' ? 'badge-starter' : plan === 'teams' ? 'badge-teams' : 'badge-free';
      const lastLogin = u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never';
      const lastActivity = u.last_activity ? new Date(u.last_activity).toLocaleDateString() : 'Never';
      const joined = new Date(u.created_at).toLocaleDateString();
      return `<tr>
        <td><strong>${u.name || 'No Name'}</strong><br><span style="font-size:.75rem;color:var(--text-muted)">${u.email}</span></td>
        <td><span class="badge ${badgeClass}">${plan}</span></td>
        <td class="value">${u.repurpose_count || 0}</td>
        <td class="value">${u.content_items_count || 0}</td>
        <td class="value">${u.smart_shorts_count || 0}</td>
        <td class="value">${u.brand_voices_count || 0}</td>
        <td class="value">${u.calendar_entries_count || 0}</td>
        <td>${u.login_count || 0}</td>
        <td>${lastLogin}</td>
        <td>${lastActivity}</td>
        <td>${joined}</td>
      </tr>`;
    }).join('');

    res.send(`
      ${getHeadHTML('Usage - Admin')}
      <style>${getBaseCSS()}${getAdminCSS()}
        .usage-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
        .usage-table-wrap{overflow-x:auto;margin-bottom:2rem;background:var(--surface);border-radius:16px;border:var(--border-subtle);padding:1.5rem}
        .usage-table-wrap h3{margin:0 0 1rem;font-size:1.1rem;color:var(--text)}
        .platform-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem}
        .platform-card{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:1.5rem}
        .platform-card h3{margin:0 0 1rem;font-size:1.1rem;color:var(--text)}
        .platform-table{width:100%;border-collapse:collapse}
        .platform-table td{padding:.5rem .8rem;border-bottom:1px solid rgba(108,58,237,0.1)}
        .platform-table td.value{text-align:right;font-weight:700;color:#6C3AED}
        .search-box{background:var(--surface);border:var(--border-subtle);border-radius:10px;padding:.6rem 1rem;color:var(--text);font-size:.9rem;width:300px;margin-bottom:1rem}
        .search-box:focus{outline:none;border-color:#6C3AED}
        .data-table td.value{font-weight:700;text-align:center;color:#6C3AED}
        .data-table th{white-space:nowrap}
        .export-btn{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:.5rem 1.2rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:600}
        .export-btn:hover{opacity:.9}
      </style>
      <script>${getThemeScript()}</script>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('usage')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem">
            <div>
              <h1>Usage Analytics</h1>
              <p>Customer usage tracking for billing and refund decisions</p>
            </div>
            <button class="export-btn" onclick="exportCSV()">Export CSV</button>
          </div>

          <div class="usage-summary">
            <div class="stat-card">
              <div class="label">Total Users</div>
              <div class="value">${summary.total_users || 0}</div>
            </div>
            <div class="stat-card">
              <div class="label">Active (7 days)</div>
              <div class="value">${summary.active_7d || 0}</div>
            </div>
            <div class="stat-card">
              <div class="label">Active (30 days)</div>
              <div class="value">${summary.active_30d || 0}</div>
            </div>
            <div class="stat-card">
              <div class="label">Total Repurposes</div>
              <div class="value">${summary.total_outputs || 0}</div>
            </div>
            <div class="stat-card">
              <div class="label">Repurposes (30d)</div>
              <div class="value">${summary.outputs_30d || 0}</div>
            </div>
            <div class="stat-card">
              <div class="label">Content Items</div>
              <div class="value">${summary.total_content || 0}</div>
            </div>
            <div class="stat-card">
              <div class="label">Smart Shorts</div>
              <div class="value">${summary.total_shorts || 0}</div>
            </div>
          </div>

          <div class="usage-table-wrap">
            <h3>Per-User Usage Details</h3>
            <input type="text" class="search-box" placeholder="Search by name or email..." oninput="filterTable(this.value)">
            <div style="overflow-x:auto">
              <table class="data-table" id="usageTable">
                <thead><tr>
                  <th>User</th><th>Plan</th><th>Repurposes</th><th>Content</th><th>Shorts</th><th>Voices</th><th>Calendar</th><th>Logins</th><th>Last Login</th><th>Last Activity</th><th>Joined</th>
                </tr></thead>
                <tbody>${userRows}</tbody>
              </table>
            </div>
          </div>

          <div class="platform-grid">
            <div class="platform-card">
              <h3>Platform Breakdown</h3>
              <table class="platform-table">
                <tbody>${platformRows}</tbody>
              </table>
            </div>
            <div class="platform-card">
              <h3>Quick Refund Check</h3>
              <p style="font-size:.85rem;color:var(--text-muted);margin:0 0 .8rem">Users with low or zero usage are highlighted for easy refund decisions.</p>
              <div id="lowUsageList"></div>
            </div>
          </div>
        </div>
      </div>
      <script>
        function filterTable(q) {
          const rows = document.querySelectorAll('#usageTable tbody tr');
          q = q.toLowerCase();
          rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
        }
        function exportCSV() {
          const table = document.getElementById('usageTable');
          const rows = table.querySelectorAll('tr');
          let csv = [];
          rows.forEach(r => {
            const cols = r.querySelectorAll('th, td');
            const row = [];
            cols.forEach(c => row.push('"' + c.textContent.trim().replace(/"/g, '""') + '"'));
            csv.push(row.join(','));
          });
          const blob = new Blob([csv.join('\n')], {type:'text/csv'});
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'usage_export_' + new Date().toISOString().split('T')[0] + '.csv';
          a.click();
        }
        // Highlight low usage users
        (function(){
          const rows = document.querySelectorAll('#usageTable tbody tr');
          const lowUsers = [];
          rows.forEach(r => {
            const cells = r.querySelectorAll('td');
            const repurposes = parseInt(cells[2].textContent) || 0;
            if (repurposes <= 2) {
              r.style.background = 'rgba(239,68,68,0.06)';
              lowUsers.push(cells[0].textContent.trim().split('\n')[0]);
            }
          });
          const el = document.getElementById('lowUsageList');
          if (lowUsers.length === 0) el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No low-usage users found.</p>';
          else el.innerHTML = lowUsers.map(n => '<div style="padding:.3rem 0;font-size:.85rem;color:#ef4444">\u2022 ' + n + '</div>').join('');
        })();
      </script>
      </body></html>
    `);
  } catch(e) {
    console.error('Usage page error:', e);
    res.status(500).send('Error loading usage page');
  }
});

module.exports = router;
