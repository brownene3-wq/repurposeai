const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { contentOps, outputOps } = require('../db/database');

router.get('/', requireAuth, async (req, res) => {
  // Fetch real stats
  let videosProcessed = 0, postsGenerated = 0;
  try {
    videosProcessed = await contentOps.countByUserIdThisMonth(req.user.id);
    postsGenerated = await outputOps.countByUserId(req.user.id);
  } catch (e) { console.error('Dashboard stats error:', e); }
  const planLabel = req.user.plan === 'pro' ? 'Pro' : req.user.plan === 'enterprise' ? 'Enterprise' : 'Free';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>Dashboard - RepurposeAI</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <style>
    :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0a0a0a;--dark-2:#111111;--surface:#161616;--surface-light:#1e1e1e;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
 [data-theme="light"]{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--surface-light:#F1F5F9;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;background:var(--dark);color:var(--text);min-height:100vh;transition:background .3s,color .3s}
    .dashboard{display:flex;min-height:100vh}
    .sidebar{width:250px;background:#111;border-right:1px solid #222;padding:20px 0;position:fixed;height:100vh;overflow-y:auto;display:flex;flex-direction:column}
    .sidebar .logo{font-size:1.4em;font-weight:700;color:#fff}
    .sidebar .logo span{color:#6c5ce7}
    .sidebar a{display:block;padding:12px 20px;color:#888;text-decoration:none;transition:all 0.2s;border-left:3px solid transparent}
    .sidebar a:not(.logo):hover{color:#fff;background:rgba(108,92,231,0.1)}
    .sidebar a.active{color:#6c5ce7;background:rgba(108,92,231,0.1);border-left-color:#6c5ce7}
    .theme-toggle{background:#222;border:1px solid #333;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1em;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:fixed;top:1.2rem;right:1.5rem;z-index:100}
    body.light .sidebar{background:#f8f8f8;border-color:#e0e0e0}
    body.light .sidebar a{color:#666}
    body.light .sidebar a.active{color:#6c5ce7;background:rgba(108,92,231,0.08)}
    body.light .theme-toggle{background:#fff;border-color:#ddd}
    .main-content{flex:1;margin-left:250px;padding:2rem}
    .page-header{margin-bottom:2rem}
    .page-header h1{font-size:1.8rem;font-weight:800;margin-bottom:.5rem}
    .page-header p{color:var(--text-muted);font-size:.95rem}
    .repurpose-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:2rem}
    .input-group{display:flex;gap:1rem;margin-bottom:1rem}
    .url-input{flex:1;padding:1rem 1.2rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:var(--text);font-size:1rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;outline:none;transition:border-color .3s}
    .url-input:focus{border-color:var(--primary)}
    .url-input::placeholder{color:var(--text-dim)}
    .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 20px rgba(108,58,237,0.4)}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 30px rgba(108,58,237,0.5)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
    .btn-sm{padding:.5rem 1rem;font-size:.8rem}
    .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.2)}
    .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
    .video-preview{display:none;background:var(--dark);border-radius:12px;padding:1.5rem;margin-top:1.5rem;border:var(--border-subtle)}
    .video-preview.show{display:block}
    .video-info{display:flex;gap:1.5rem;align-items:start}
    .video-thumb{width:200px;height:112px;border-radius:8px;object-fit:cover;background:var(--surface-light)}
    .video-meta h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
    .video-meta p{color:var(--text-muted);font-size:.85rem}
    .results-section{display:none}
    .results-section.show{display:block}
    .platform-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
    .platform-tab{padding:.6rem 1.2rem;border-radius:10px;background:var(--surface);border:var(--border-subtle);color:var(--text-muted);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .platform-tab:hover,.platform-tab.active{background:rgba(108,58,237,0.2);color:var(--primary-light);border-color:rgba(108,58,237,0.3)}
    .platform-content{background:var(--dark);border-radius:12px;padding:1.5rem;border:var(--border-subtle);display:none}
    .platform-content.show{display:block}
    .platform-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
    .platform-header h3{font-size:1rem;font-weight:700;display:flex;align-items:center;gap:.5rem}
    .platform-type{font-size:.75rem;color:var(--text-dim);background:var(--surface);padding:.3rem .8rem;border-radius:50px}
    .content-textarea{width:100%;min-height:200px;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);padding:1rem;font-size:.9rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;line-height:1.6;resize:vertical;outline:none}
    .content-textarea:focus{border-color:var(--primary)}
    .content-actions{display:flex;gap:.8rem;margin-top:1rem;flex-wrap:wrap}
    .char-count{font-size:.75rem;color:var(--text-dim);margin-top:.5rem}
    .loading-spinner{display:none;text-align:center;padding:3rem}
    .loading-spinner.show{display:block}
    .spinner{width:40px;height:40px;border:3px solid var(--surface);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border-radius:12px;padding:1.5rem;border:var(--border-subtle)}
    .stat-card .stat-value{font-size:1.8rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .stat-card .stat-label{font-size:.8rem;color:var(--text-dim);margin-top:.3rem}
    .toast{position:fixed;bottom:2rem;right:2rem;background:var(--success);color:#fff;padding:1rem 1.5rem;border-radius:10px;font-size:.9rem;font-weight:500;display:none;z-index:9999;animation:slideUp .3s ease}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    [data-theme="light"] .url-input{border-color:rgba(0,0,0,0.12);background:#F8F9FC}[data-theme="light"] .content-textarea{background:#F8F9FC;border-color:rgba(0,0,0,0.08)}
 @media(max-width:768px){.sidebar{display:none}.main-content{margin-left:0}.stats-grid{grid-template-columns:repeat(2,1fr)}.input-group{flex-direction:column}.video-info{flex-direction:column}.video-thumb{width:100%;height:auto}}
  </style>
</head>
<body>
 <div class="dashboard">
    <aside class="sidebar" style="display:flex;flex-direction:column;">
      <div style="padding:0 20px 20px;">
        <a href="/dashboard" class="logo" style="padding:0;margin:0;text-decoration:none;border-left:none;">Repurpose<span>AI</span></a>
      </div>
      <a href="/dashboard" class="active">&#x1F3AC; Dashboard</a>
      <a href="/repurpose">&#x1F504; Repurpose</a>
      <a href="/repurpose/history">&#x1F4DA; Library</a>
      <a href="/dashboard/analytics">&#x1F4CA; Analytics</a>
      <a href="/dashboard/calendar">&#x1F4C5; Calendar</a>
      <a href="/brand-voice">&#x1F399; Brand Voice</a>
      <a href="/billing">&#x1F4B3; Billing</a>
      <a href="/auth/logout" style="margin-top:auto;color:#ef4444;opacity:0.7;font-size:0.85rem;padding:12px 20px;">Sign Out</a>
    </aside>

    <main class="main-content">
      <button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>
      <div class="page-header">
        <h1>&#x1F3AC; Content Studio</h1>
        <p>Paste a YouTube link and let AI create content for every platform.</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${videosProcessed}</div><div class="stat-label">Videos This Month</div></div>
        <div class="stat-card"><div class="stat-value">${postsGenerated}</div><div class="stat-label">Posts Generated</div></div>
        <div class="stat-card"><div class="stat-value">7</div><div class="stat-label">Platforms</div></div>
        <div class="stat-card"><div class="stat-value">${planLabel}</div><div class="stat-label">Current Plan</div></div>
      </div>

      <div class="repurpose-card">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem">&#x1F680; Repurpose a Video</h2>
        <div class="input-group">
          <input type="text" class="url-input" id="youtubeUrl" placeholder="Paste YouTube URL here... (e.g. https://youtube.com/watch?v=...)">
          <button class="btn btn-primary" id="processBtn" onclick="processVideo()">&#x26A1; Repurpose</button>
        </div>

      </div>
    </main>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <script>
    // Force reload if served from browser back-forward cache
    window.addEventListener('pageshow', function(e) { if (e.persisted) window.location.reload(); });

    function toggleTheme(){
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      const btn = document.querySelector('.theme-toggle');
      btn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
      var h=document.documentElement;var c=h.getAttribute("data-theme");var n=c==="light"?"dark":"light";h.setAttribute("data-theme",n);localStorage.setItem("repurposeai-theme",n)
    }
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
      document.querySelector('.theme-toggle').textContent = '☀️';
    }
    (function(){var s=localStorage.getItem("repurposeai-theme");if(s==="light")document.documentElement.setAttribute("data-theme","light")})();

    function processVideo() {
      const url = document.getElementById('youtubeUrl').value.trim();
      if (!url) { alert('Please paste a YouTube URL'); return; }
      window.location.href = '/repurpose?url=' + encodeURIComponent(url);
    }

    // Allow Enter key to trigger processing
    document.getElementById('youtubeUrl').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') processVideo();
    });
  </script>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
