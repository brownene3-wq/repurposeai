// Shared theme module for consistent styling across all authenticated pages
// This ensures all pages match the dashboard's premium look and feel

function getBaseCSS() {
  return `
    :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0a0a0a;--dark-2:#111111;--surface:#161616;--surface-light:#1e1e1e;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
    [data-theme="light"],body.light,html.light{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--surface-light:#F1F5F9;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;background:var(--dark);color:var(--text);min-height:100vh;transition:background .3s,color .3s}
    .dashboard{display:flex;min-height:100vh}
    .sidebar{width:250px;background:#111;border-right:1px solid #222;padding:20px 0;position:fixed;height:100vh;overflow-y:auto;display:flex;flex-direction:column}
    .sidebar .logo{font-size:1.4em;font-weight:800;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .sidebar .logo span{-webkit-text-fill-color:transparent}
    .sidebar a{display:block;padding:12px 20px;color:#888;text-decoration:none;transition:all 0.2s;border-left:3px solid transparent}
    .sidebar a:not(.logo):hover{color:#fff;background:rgba(108,92,231,0.1)}
    .sidebar a.active{color:#6c5ce7;background:linear-gradient(90deg,rgba(108,58,237,0.12),rgba(236,72,153,0.06));border-left-color:#6C3AED}
    .theme-toggle{background:#222;border:1px solid #333;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1em;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:fixed;top:1.2rem;right:1.5rem;z-index:100}
    body.light .sidebar,html.light .sidebar{background:#f8f8f8;border-color:#e0e0e0}
    body.light .sidebar a,html.light .sidebar a{color:#666}
    body.light .sidebar a.active,html.light .sidebar a.active{color:#6c5ce7;background:rgba(108,92,231,0.08)}
    body.light .theme-toggle,html.light .theme-toggle{background:#fff;border-color:#ddd}
    .main-content{flex:1;margin-left:250px;padding:2rem}
    .page-header{margin-bottom:2rem}
    .page-header h1{font-size:1.8rem;font-weight:800;margin-bottom:.5rem;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .page-header p{color:var(--text-muted);font-size:.95rem}
    .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 20px rgba(108,58,237,0.4)}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 30px rgba(108,58,237,0.5)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
    .btn-sm{padding:.5rem 1rem;font-size:.8rem}
    .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.2)}
    .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
    .toast{position:fixed;bottom:2rem;right:2rem;background:var(--success);color:#fff;padding:1rem 1.5rem;border-radius:10px;font-size:.9rem;font-weight:500;display:none;z-index:9999;animation:slideUp .3s ease}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    [data-theme="light"] .url-input,body.light .url-input,html.light .url-input{border-color:rgba(0,0,0,0.12);background:#F8F9FC}
    [data-theme="light"] .content-textarea,body.light .content-textarea,html.light .content-textarea{background:#F8F9FC;border-color:rgba(0,0,0,0.08)}
    [data-theme="light"] select,body.light select,html.light select{background:#F8F9FC;border-color:rgba(0,0,0,0.12);color:#1A1A2E}
    @media(max-width:768px){.sidebar{display:none}.main-content{margin-left:0}}
  `;
}

function getHeadHTML(title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>${title} - RepurposeAI</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <script>
    // Apply theme BEFORE body renders to prevent flash of wrong theme (FOUC)
    (function(){
      var t = localStorage.getItem('theme');
      if(t==='light'){
        document.documentElement.classList.add('light');
        document.documentElement.setAttribute('data-theme','light');
      }
    })();
  </script>`;
}

function getSidebar(activePage) {
  const links = [
    { href: '/dashboard', icon: '&#x1F3AC;', label: 'Dashboard', key: 'dashboard' },
    { href: '/repurpose', icon: '&#x1F504;', label: 'Repurpose', key: 'repurpose' },
    { href: '/repurpose/history', icon: '&#x1F4DA;', label: 'Library', key: 'library' },
    { href: '/shorts', icon: '&#x2702;&#xFE0F;', label: 'Smart Shorts', key: 'shorts' },
    { href: '/dashboard/analytics', icon: '&#x1F4CA;', label: 'Analytics', key: 'analytics' },
    { href: '/dashboard/calendar', icon: '&#x1F4C5;', label: 'Calendar', key: 'calendar' },
    { href: '/brand-voice', icon: '&#x1F399;', label: 'Brand Voice', key: 'brand-voice' },
    { href: '/billing', icon: '&#x1F4B3;', label: 'Billing', key: 'billing' },
  ];

  const navLinks = links.map(link => {
    const activeClass = link.key === activePage ? ' class="active"' : '';
    return `      <a href="${link.href}"${activeClass}>${link.icon} ${link.label}</a>`;
  }).join('\n');

  return `
    <aside class="sidebar" style="display:flex;flex-direction:column;">
      <div style="padding:0 20px 20px;">
        <a href="/dashboard" class="logo" style="padding:0;margin:0;text-decoration:none;border-left:none;">Repurpose<span>AI</span></a>
      </div>
${navLinks}
      <a href="/auth/logout" style="margin-top:auto;color:#ef4444;opacity:0.7;font-size:0.85rem;padding:12px 20px;">Sign Out</a>
    </aside>`;
}

function getThemeToggle() {
  return '<button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>';
}

function getThemeScript() {
  return `
    // Force reload if served from browser back-forward cache
    window.addEventListener('pageshow', function(e) { if (e.persisted) window.location.reload(); });

    function toggleTheme(){
      const isLight = !document.body.classList.contains('light');
      document.body.classList.toggle('light', isLight);
      document.documentElement.classList.toggle('light', isLight);
      document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      const btn = document.querySelector('.theme-toggle');
      if(btn) btn.innerHTML = isLight ? '&#x2600;&#xFE0F;' : '&#x1F319;';
    }
    // Sync theme to body (html.light was already set in <head> before body rendered)
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
      const btn = document.querySelector('.theme-toggle');
      if(btn) btn.innerHTML = '&#x2600;&#xFE0F;';
    }
  `;
}

module.exports = { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript };
