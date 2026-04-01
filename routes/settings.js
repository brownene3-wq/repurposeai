const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, async (req, res) => {
  const user = req.user;
  const hasGoogle = !!user.google_id;

  res.send(`
    ${getHeadHTML('Settings - RepurposeAI')}
    <style>${getBaseCSS()}
      .settings-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:1.5rem}
      .settings-card h2{font-size:1.2rem;font-weight:700;margin-bottom:.3rem}
      .settings-card p.desc{color:var(--text-muted);font-size:.85rem;margin-bottom:1.5rem}
      .form-group{margin-bottom:1.2rem}
      .form-group label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.4rem;color:var(--text-muted)}
      .form-group input{width:100%;max-width:400px;padding:.7rem 1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:.9rem;outline:none;transition:border .2s}
      .form-group input:focus{border-color:#6C3AED}
      body.light .form-group input,html.light .form-group input{border-color:rgba(0,0,0,0.12);background:#f8f9fc}
      .btn-save{padding:.65rem 1.8rem;border-radius:50px;font-weight:600;font-size:.85rem;cursor:pointer;border:none;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;transition:all .3s;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
      .btn-save:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}
      .btn-save:disabled{opacity:.5;cursor:not-allowed;transform:none}
      .badge-google{display:inline-flex;align-items:center;gap:.4rem;background:rgba(66,133,244,0.12);color:#4285F4;font-size:.75rem;font-weight:600;padding:4px 10px;border-radius:20px}
      .badge-email{display:inline-flex;align-items:center;gap:.4rem;background:rgba(16,185,129,0.12);color:#10B981;font-size:.75rem;font-weight:600;padding:4px 10px;border-radius:20px}
      .toast{display:none;position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:.9rem;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.3)}
      .toast.success{background:#10B981;color:#fff}
      .toast.error{background:#EF4444;color:#fff}
      .divider{height:1px;background:rgba(255,255,255,0.06);margin:1.5rem 0}
      body.light .divider,html.light .divider{background:rgba(0,0,0,0.08)}
      .info-row{display:flex;align-items:center;gap:.8rem;margin-bottom:.8rem}
      .info-row .label{font-size:.85rem;color:var(--text-muted);min-width:80px}
      .info-row .value{font-size:.9rem;color:var(--text);font-weight:500}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('settings', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="page-header">
          <h1>Settings</h1>
          <p>Manage your account and preferences</p>
        </div>

        <!-- Profile Section -->
        <div class="settings-card">
          <h2>Profile</h2>
          <p class="desc">Your account information</p>
          <div class="info-row">
            <span class="label">Email</span>
            <span class="value">${user.email}</span>
            ${hasGoogle ? '<span class="badge-google">&#x1F310; Google</span>' : '<span class="badge-email">&#x2709; Email</span>'}
          </div>
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" id="nameInput" value="${user.name || ''}" placeholder="Your name">
          </div>
          <button class="btn-save" onclick="saveName()">Save Name</button>
        </div>

        <!-- Password Section -->
        <div class="settings-card">
          ${hasGoogle ? `
            <h2>Create Password</h2>
            <p class="desc">You signed up with Google. Create a password so you can also log in with your email and password.</p>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="newPassword" placeholder="Min 6 characters" minlength="6">
            </div>
            <div class="form-group">
              <label>Confirm Password</label>
              <input type="password" id="confirmPassword" placeholder="Confirm your password">
            </div>
            <button class="btn-save" onclick="setPassword()">Create Password</button>
          ` : `
            <h2>Change Password</h2>
            <p class="desc">Update your login password</p>
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" id="currentPassword" placeholder="Enter current password">
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="newPassword" placeholder="Min 6 characters" minlength="6">
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="confirmPassword" placeholder="Confirm new password">
            </div>
            <button class="btn-save" onclick="changePassword()">Change Password</button>
          `}
        </div>

        <!-- Plan Info -->
        <div class="settings-card">
          <h2>Subscription</h2>
          <p class="desc">Your current plan and billing</p>
          <div class="info-row">
            <span class="label">Plan</span>
            <span class="value" style="text-transform:capitalize">${user.plan || 'Free'}</span>
          </div>
          <a href="/billing" style="color:#6C3AED;font-size:.85rem;font-weight:600;text-decoration:none">Manage Billing &rarr;</a>
        </div>
      </div>
    </div>

    <div class="toast" id="toast"></div>

    <script>
      ${getThemeScript()}

      function showToast(msg, type) {
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast ' + (type || 'success');
        t.style.display = 'block';
        setTimeout(function() { t.style.display = 'none'; }, 4000);
      }

      async function saveName() {
        var name = document.getElementById('nameInput').value.trim();
        if (!name) { showToast('Please enter a name', 'error'); return; }
        try {
          var res = await fetch('/auth/api/update-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          showToast(data.message || 'Name updated!', 'success');
        } catch (e) {
          showToast(e.message || 'Failed to update name', 'error');
        }
      }

      async function setPassword() {
        var pw = document.getElementById('newPassword').value;
        var cpw = document.getElementById('confirmPassword').value;
        if (!pw || pw.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
        if (pw !== cpw) { showToast('Passwords do not match', 'error'); return; }
        try {
          var res = await fetch('/auth/api/set-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw, confirmPassword: cpw })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          showToast(data.message || 'Password created!', 'success');
          document.getElementById('newPassword').value = '';
          document.getElementById('confirmPassword').value = '';
        } catch (e) {
          showToast(e.message || 'Failed to set password', 'error');
        }
      }

      async function changePassword() {
        var cur = document.getElementById('currentPassword').value;
        var pw = document.getElementById('newPassword').value;
        var cpw = document.getElementById('confirmPassword').value;
        if (!cur) { showToast('Please enter your current password', 'error'); return; }
        if (!pw || pw.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
        if (pw !== cpw) { showToast('New passwords do not match', 'error'); return; }
        try {
          var res = await fetch('/auth/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: cur, newPassword: pw, confirmPassword: cpw })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          showToast(data.message || 'Password changed!', 'success');
          document.getElementById('currentPassword').value = '';
          document.getElementById('newPassword').value = '';
          document.getElementById('confirmPassword').value = '';
        } catch (e) {
          showToast(e.message || 'Failed to change password', 'error');
        }
      }
    </script>
    </body></html>
  `);
});

module.exports = router;
