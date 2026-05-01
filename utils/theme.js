// Shared theme module for consistent styling across all authenticated pages
// This ensures all pages match the dashboard's premium look and feel

function getBaseCSS() {
  return `
    :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0a0a0a;--dark-2:#111111;--surface:#161616;--surface-light:#1e1e1e;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
    [data-theme="light"],body.light,html.light{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--surface-light:#F1F5F9;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;background:var(--dark);color:var(--text);min-height:100vh}
    body.theme-ready{transition:background .3s,color .3s}
    html.light{background:var(--dark)}
    .dashboard{display:flex;height:100vh;overflow:hidden}
    .sidebar{width:250px;background:#111;border-right:1px solid #222;padding:18px 0;position:fixed;height:100vh;overflow:hidden;display:flex;flex-direction:column;transition:width .25s ease;z-index:100}
    .sidebar.collapsed{width:68px}
    .sidebar-header{padding:0 18px 14px;display:flex;align-items:center;gap:8px}
    .sidebar.collapsed .sidebar-header{padding:0 8px 14px;justify-content:center}
    .sidebar .logo{font-size:1.4em;font-weight:800;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;flex:1;text-decoration:none;line-height:1}
    .sidebar .logo span{-webkit-text-fill-color:transparent}
    .sidebar.collapsed .logo-full{display:none}
    .sidebar:not(.collapsed) .logo-mini{display:none}
    .sidebar .logo-mini{font-size:1.2em;font-weight:800;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none;line-height:1}
    .sidebar-nav{flex:1;overflow-y:auto;min-height:0;padding:4px 0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    .sidebar-nav::-webkit-scrollbar{width:6px}
    .sidebar-nav::-webkit-scrollbar-track{background:transparent}
    .sidebar-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    .sidebar-nav::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    .sidebar a{display:flex;align-items:center;gap:12px;padding:11px 20px;color:#888;text-decoration:none;transition:all 0.2s;border-left:3px solid transparent;white-space:nowrap;overflow:hidden;font-size:0.82rem;line-height:1.3}
    .sidebar.collapsed a{justify-content:center;padding:11px 0;gap:0}
    .sidebar a .nav-icon{flex-shrink:0;width:18px;text-align:center;font-size:0.95em}
    .sidebar a .nav-label{transition:opacity .2s,width .2s}
    .sidebar.collapsed a .nav-label{opacity:0;width:0;overflow:hidden}
    .sidebar a:not(.logo):hover{color:#fff;background:rgba(108,92,231,0.1)}
    .sidebar a.active{color:#6c5ce7;background:linear-gradient(90deg,rgba(108,58,237,0.12),rgba(236,72,153,0.06));border-left-color:#6C3AED}
    .sidebar-toggle{background:none;border:1px solid rgba(255,255,255,0.1);color:#888;width:28px;height:28px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.85em;transition:all .2s;flex-shrink:0;padding:0}
    .sidebar-toggle:hover{background:rgba(108,58,237,0.15);color:#fff;border-color:rgba(108,58,237,0.3)}
    .sidebar.collapsed .sidebar-toggle{transform:rotate(180deg)}
    .sidebar-footer{position:relative;padding:10px 14px 12px;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px}
    .sidebar.collapsed .sidebar-footer{padding:10px 6px 12px}
    .user-card{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);width:100%;text-align:left;cursor:pointer;color:inherit;font:inherit;transition:background .15s,border-color .15s}
    .user-card:hover{background:rgba(255,255,255,0.06);border-color:rgba(108,58,237,0.25)}
    .user-card.open{background:rgba(108,58,237,0.10);border-color:rgba(108,58,237,0.35)}
    .sidebar.collapsed .user-card{justify-content:center;padding:8px 0;border:none;background:transparent}
    .user-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.88rem;flex-shrink:0}
    .user-info{min-width:0;flex:1;overflow:hidden;display:flex;flex-direction:column;gap:5px}
    .sidebar.collapsed .user-info{display:none}
    .user-name{color:#fff;font-size:0.82rem;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .user-plan-badge{display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;padding:2px 8px;font-size:0.56rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;line-height:1.4;background:linear-gradient(135deg,rgba(108,58,237,0.25),rgba(236,72,153,0.18));color:#C8B8FF;border-radius:999px;border:1px solid rgba(108,58,237,0.35)}
    .user-card-caret{flex-shrink:0;color:#888;font-size:0.7rem;transition:transform .18s ease}
    .user-card.open .user-card-caret{transform:rotate(180deg);color:#c8b8ff}
    .sidebar.collapsed .user-card-caret{display:none}
    .user-popover{position:absolute;left:14px;right:14px;bottom:calc(100% - 6px);background:#1a1a22;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;box-shadow:0 12px 40px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:2px;z-index:200;animation:userPopIn .15s ease}
    .user-popover[hidden]{display:none}
    .sidebar.collapsed .user-popover{left:64px;right:auto;width:200px;bottom:auto;top:calc(100% - 60px)}
    .user-popover a{display:flex !important;align-items:center;gap:10px;padding:9px 12px !important;color:#d1d5db !important;font-size:0.82rem !important;text-decoration:none;border-radius:8px;border-left:none !important;background:transparent;transition:background .15s,color .15s}
    .user-popover a:hover{background:rgba(108,58,237,0.15) !important;color:#fff !important}
    .user-popover a .nav-icon{width:16px;font-size:0.95em}
    .user-popover a.popover-signout{color:#ef4444 !important}
    .user-popover a.popover-signout:hover{background:rgba(239,68,68,0.10) !important;color:#fca5a5 !important}
    .user-popover hr{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:4px 0}
    @keyframes userPopIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    .theme-toggle{background:#222;border:1px solid #333;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1em;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:fixed;top:1.2rem;right:1.5rem;z-index:100}
    body.light .sidebar,html.light .sidebar{background:#f8f8f8;border-color:#e0e0e0}
    body.light .sidebar a,html.light .sidebar a{color:#666}
    body.light .sidebar a.active,html.light .sidebar a.active{color:#6c5ce7;background:rgba(108,92,231,0.08)}
    body.light .user-card,html.light .user-card{background:rgba(0,0,0,0.03);border-color:rgba(0,0,0,0.06)}
    body.light .user-card:hover,html.light .user-card:hover{background:rgba(0,0,0,0.05);border-color:rgba(108,58,237,0.25)}
    body.light .user-card.open,html.light .user-card.open{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.35)}
    body.light .user-name,html.light .user-name{color:#1A1A2E}
    body.light .user-popover,html.light .user-popover{background:#fff;border-color:rgba(0,0,0,0.08);box-shadow:0 12px 40px rgba(0,0,0,0.15)}
    body.light .user-popover a,html.light .user-popover a{color:#1A1A2E !important}
    body.light .user-popover hr,html.light .user-popover hr{border-top-color:rgba(0,0,0,0.08)}
    body.light .sidebar-footer,html.light .sidebar-footer{border-top-color:rgba(0,0,0,0.06)}
    body.light .sidebar-nav,html.light .sidebar-nav{scrollbar-color:rgba(0,0,0,0.15) transparent}
    body.light .sidebar-nav::-webkit-scrollbar-thumb,html.light .sidebar-nav::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15)}
    body.light .theme-toggle,html.light .theme-toggle{background:#fff;border-color:#ddd}
    .main-content{flex:1;margin-left:250px;padding:2rem;overflow-y:auto;height:100vh;transition:margin-left .25s ease}
    .sidebar.collapsed ~ .main-content,.sidebar-collapsed .main-content{margin-left:68px}
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
    .toast.error{background:var(--error)}
    .toast.info{background:var(--primary)}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    [data-theme="light"] .url-input,body.light .url-input,html.light .url-input{border-color:rgba(0,0,0,0.12);background:#F8F9FC}
    [data-theme="light"] .content-textarea,body.light .content-textarea,html.light .content-textarea{background:#F8F9FC;border-color:rgba(0,0,0,0.08)}
    [data-theme="light"] select,body.light select,html.light select{background:#F8F9FC;border-color:rgba(0,0,0,0.12);color:#1A1A2E}
    .ptr-indicator{position:fixed;top:0;left:50%;transform:translateX(-50%) translateY(-60px);z-index:9998;background:var(--surface);border:var(--border-subtle);border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;box-shadow:0 4px 15px rgba(0,0,0,0.3);transition:transform .2s ease,opacity .2s;opacity:0;pointer-events:none}
    .ptr-indicator.pulling{opacity:1;pointer-events:none}
    .ptr-indicator.refreshing{opacity:1;animation:ptr-spin .8s linear infinite}
    @keyframes ptr-spin{from{transform:translateX(-50%) translateY(20px) rotate(0deg)}to{transform:translateX(-50%) translateY(20px) rotate(360deg)}}
    .mobile-menu-btn{display:none;position:fixed;top:1rem;left:1rem;z-index:1001;background:#222;border:1px solid #333;color:#fff;width:40px;height:40px;border-radius:10px;cursor:pointer;font-size:1.2em;align-items:center;justify-content:center}
    body.light .mobile-menu-btn,html.light .mobile-menu-btn{background:#fff;border-color:#ddd;color:#333}
    .sidebar-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999}
    .sidebar-overlay.active{display:block}
    @media(max-width:768px){
      .sidebar{display:none !important;position:fixed;z-index:1000;width:260px;top:0;left:0;height:100vh;transform:translateX(-100%);transition:transform .3s ease}
      .sidebar.mobile-open{display:flex !important;transform:translateX(0)}
      .mobile-menu-btn{display:flex}
      .main-content{margin-left:0;padding:1rem;padding-top:3.5rem}
      .page-header h1{font-size:1.4rem}
      .page-header p{font-size:.85rem}
      .theme-toggle{top:.9rem;right:1rem;width:32px;height:32px;font-size:.85em}
      .btn{padding:.6rem 1.2rem;font-size:.82rem}
      .card{padding:1rem !important;border-radius:12px !important}
      table{font-size:.8rem}
      table th,table td{padding:.5rem .4rem}
    }
    @media(max-width:480px){
      .main-content{padding:.75rem;padding-top:3.5rem}
      .page-header{margin-bottom:1rem}
      .page-header h1{font-size:1.2rem}
      .btn{padding:.5rem 1rem;font-size:.78rem}
    }
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
  <title>${title} - Splicora</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Splicora">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <script>
    // Apply theme BEFORE body renders to prevent flash of wrong theme (FOUC)
    (function(){
      var t = localStorage.getItem('theme');
      if(t==='light'){
        document.documentElement.classList.add('light');
        document.documentElement.setAttribute('data-theme','light');
      }
      // Apply light class to body as soon as it exists
      document.addEventListener('DOMContentLoaded', function(){
        if(t==='light') document.body.classList.add('light');
        // Enable transitions only AFTER first paint to prevent flash
        requestAnimationFrame(function(){ requestAnimationFrame(function(){
          document.body.classList.add('theme-ready');
        }); });
      });
    })();
  </script>`;
}

function getSidebar(activePage, user, teamPermissions) {
  // Map sidebar links to required permissions
  // null permission = always visible
  const allLinks = [
    // --- Core Content Tools ---
    { href: '/dashboard', icon: '\u{1F3AC}', label: 'Dashboard', key: 'dashboard', perm: null },
    { href: '/repurpose', icon: '\u{1F504}', label: 'Create', key: 'repurpose', perm: 'use_repurpose' },
    { href: '/repurpose/history', icon: '\u{1F4DA}', label: 'Library', key: 'library', perm: 'use_repurpose' },
    { href: '/shorts', icon: '\u{2702}\u{FE0F}', label: 'Smart Shorts', key: 'shorts', perm: 'use_shorts' },
    { href: '/video-editor', icon: '\u{1F3AC}', label: 'Video Editor', key: 'video-editor', perm: 'use_repurpose' },
    // --- AI & Creative Tools ---
    { href: '/ai-captions', icon: '\u{1F4AC}', label: 'AI Captions', key: 'ai-captions', perm: 'use_repurpose' },
    { href: '/caption-presets', icon: '\u{1F4DD}', label: 'Caption Styles', key: 'caption-presets', perm: 'use_repurpose' },
    { href: '/ai-hook', icon: '\u{1F3A3}', label: 'AI Hooks', key: 'ai-hook', perm: 'use_repurpose' },
    { href: '/ai-reframe', icon: '\u{1F5BC}', label: 'AI Reframe', key: 'ai-reframe', perm: 'use_repurpose' },
    { href: '/ai-thumbnail', icon: '\u{1F5BC}\u{FE0F}', label: 'AI Thumbnails', key: 'ai-thumbnail', perm: 'use_repurpose' },
    { href: '/ai-broll', icon: '\u{1F3B5}', label: 'B-Roll', key: 'ai-broll', perm: 'use_repurpose' },
    { href: '/enhance-speech', icon: '\u{1F50A}', label: 'Enhance Audio', key: 'enhance-speech', perm: 'use_repurpose' },
    // --- Brand & Planning ---
    { href: '/brand-voice', icon: '\u{1F399}', label: 'Brand Voice', key: 'brand-voice', perm: 'use_brand_voice' },
    { href: '/brand-templates', icon: '\u{1F5A8}\u{FE0F}', label: 'Brand Templates', key: 'brand-templates', perm: 'use_repurpose' },
    { href: '/dashboard/calendar', icon: '\u{1F4C5}', label: 'Calendar', key: 'calendar', perm: 'use_calendar' },
    { href: '/dashboard/analytics', icon: '\u{1F4CA}', label: 'Analytics', key: 'analytics', perm: 'view_analytics' },
    { href: '/distribute', icon: '\u{26A1}', label: 'Repurpose', key: 'distribute', perm: null },
    // --- Account ---
  ];

  // Filter links based on team permissions
  // If teamPermissions is provided (team member), only show links they have access to
  // If not provided (account owner or admin), show all
  let links;
  if (teamPermissions && typeof teamPermissions === 'object' && Object.keys(teamPermissions).length > 0) {
    links = allLinks.filter(link => {
      if (link.perm === null) return true; // Always show dashboard
      return teamPermissions[link.perm] === true;
    });
  } else {
    links = allLinks;
  }

  // Show Admin Panel link for admin users
  const isAdmin = user && user.role === 'admin';
  if (isAdmin) {
    links.push({ href: '/admin', icon: '&#x1F6E1;&#xFE0F;', label: 'Admin Panel', key: 'admin' });
  }

  const navLinks = links.map(link => {
    const activeClass = link.key === activePage ? ' class="active"' : '';
    return `      <a href="${link.href}"${activeClass}><span class="nav-icon">${link.icon}</span><span class="nav-label">${link.label}</span></a>`;
  }).join('\n');

  // User profile card data
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const fullName = (user && user.name) ? String(user.name).trim() : '';
  const firstName = fullName ? fullName.split(/\s+/)[0] : (user && user.email ? String(user.email).split('@')[0] : 'Friend');
  const initial = (firstName || '?').charAt(0).toUpperCase();
  const planRaw = (user && user.plan) ? String(user.plan).toLowerCase() : 'free';
  const planLabel = planRaw.charAt(0).toUpperCase() + planRaw.slice(1) + ' Plan';
  const cardTitle = escapeHtml(fullName || firstName) + ' \u00B7 ' + escapeHtml(planLabel);

  return `
    <aside class="sidebar" id="mainSidebar">
      <div class="sidebar-header">
        <a href="/dashboard" class="logo logo-full">Splicora</a>
        <a href="/dashboard" class="logo-mini">S<span>c</span></a>
        <button class="sidebar-toggle" id="sidebarCollapseBtn" onclick="toggleSidebarCollapse()" title="Collapse sidebar" aria-label="Collapse sidebar">&#x276E;</button>
      </div>
      <nav class="sidebar-nav">
${navLinks}
      </nav>
      <div class="sidebar-footer">
        <button type="button" class="user-card" id="userCardBtn" onclick="toggleUserMenu(event)" aria-haspopup="menu" aria-expanded="false" title="${cardTitle}">
          <div class="user-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(firstName)}</div>
            <span class="user-plan-badge">${escapeHtml(planLabel)}</span>
          </div>
          <span class="user-card-caret" aria-hidden="true">&#x25BE;</span>
        </button>
        <div class="user-popover" id="userPopover" role="menu" aria-labelledby="userCardBtn" hidden>
          <a href="/settings" role="menuitem"><span class="nav-icon">&#x2699;&#xFE0F;</span><span class="nav-label">Settings</span></a>
          <a href="/billing" role="menuitem"><span class="nav-icon">&#x1F4B3;</span><span class="nav-label">Billing</span></a>
          <hr>
          <a href="/auth/logout" role="menuitem" class="popover-signout"><span class="nav-icon">&#x1F6AA;</span><span class="nav-label">Sign Out</span></a>
        </div>
      </div>
    </aside>`;
}

function getThemeToggle() {
  return `<div class="ptr-indicator" id="ptrIndicator">&#x21BB;</div>
    <button class="mobile-menu-btn" onclick="toggleMobileMenu()">&#9776;</button>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleMobileMenu()"></div>
    <button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>`;
}

function getThemeScript() {
  return `
    // Force reload if served from browser back-forward cache
    window.addEventListener('pageshow', function(e) { if (e.persisted) window.location.reload(); });

    // Register PWA service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function(){});
    }

    // Pull-to-refresh for iOS PWA
    (function(){
      var startY = 0;
      var pulling = false;
      var ptr = document.getElementById('ptrIndicator');
      if (!ptr) return;

      document.addEventListener('touchstart', function(e) {
        if (window.scrollY === 0) {
          startY = e.touches[0].pageY;
          pulling = true;
        }
      }, {passive: true});

      document.addEventListener('touchmove', function(e) {
        if (!pulling || !ptr) return;
        var dy = e.touches[0].pageY - startY;
        if (dy > 0 && dy < 150 && window.scrollY === 0) {
          var progress = Math.min(dy / 80, 1);
          ptr.style.transform = 'translateX(-50%) translateY(' + (dy * 0.5 - 20) + 'px) rotate(' + (progress * 180) + 'deg)';
          ptr.classList.add('pulling');
          ptr.classList.remove('refreshing');
        }
      }, {passive: true});

      document.addEventListener('touchend', function(e) {
        if (!pulling || !ptr) return;
        var dy = (e.changedTouches[0] ? e.changedTouches[0].pageY : 0) - startY;
        if (dy > 80 && window.scrollY === 0) {
          ptr.classList.remove('pulling');
          ptr.classList.add('refreshing');
          setTimeout(function() { window.location.reload(); }, 400);
        } else {
          ptr.classList.remove('pulling');
          ptr.style.transform = 'translateX(-50%) translateY(-60px)';
          ptr.style.opacity = '0';
        }
        pulling = false;
      }, {passive: true});
    })();

    function toggleSidebarCollapse(){
      var sb = document.getElementById('mainSidebar');
      if (!sb) return;
      var collapsed = sb.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
      // Update main-content margin
      var mc = document.querySelector('.main-content');
      if (mc) mc.style.marginLeft = collapsed ? '68px' : '250px';
      // Close any open user menu since geometry changed
      __closeUserMenu();
    }

    function toggleUserMenu(e){
      if (e && e.stopPropagation) e.stopPropagation();
      var btn = document.getElementById('userCardBtn');
      var pop = document.getElementById('userPopover');
      if (!btn || !pop) return;
      var willOpen = pop.hasAttribute('hidden');
      if (willOpen) {
        pop.removeAttribute('hidden');
        btn.classList.add('open');
        btn.setAttribute('aria-expanded','true');
        // Defer attaching outside-click so the current click doesn't close it immediately
        setTimeout(function(){
          document.addEventListener('click', __userMenuOutside);
          document.addEventListener('keydown', __userMenuEsc);
        }, 0);
      } else {
        __closeUserMenu();
      }
    }
    function __closeUserMenu(){
      var btn = document.getElementById('userCardBtn');
      var pop = document.getElementById('userPopover');
      if (pop) pop.setAttribute('hidden','');
      if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
      document.removeEventListener('click', __userMenuOutside);
      document.removeEventListener('keydown', __userMenuEsc);
    }
    function __userMenuOutside(e){
      var btn = document.getElementById('userCardBtn');
      var pop = document.getElementById('userPopover');
      if (!btn || !pop) return;
      if (!btn.contains(e.target) && !pop.contains(e.target)) __closeUserMenu();
    }
    function __userMenuEsc(e){
      if (e && e.key === 'Escape') __closeUserMenu();
    }
    // Restore sidebar state on page load
    if (localStorage.getItem('sidebarCollapsed') === '1') {
      var sb = document.getElementById('mainSidebar');
      if (sb) {
        sb.classList.add('collapsed');
        var mc = document.querySelector('.main-content');
        if (mc) mc.style.marginLeft = '68px';
      }
    }

    function toggleMobileMenu(){
      var sb = document.querySelector('.sidebar');
      var ov = document.getElementById('sidebarOverlay');
      if(sb){
        sb.classList.toggle('mobile-open');
        if(ov) ov.classList.toggle('active', sb.classList.contains('mobile-open'));
      }
    }

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
  
    // Load v9 buttons fix
    var _s=document.createElement('script');_s.src='/public/js/v9-buttons-fix.js';document.head.appendChild(_s);`;
}

module.exports = { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript };
