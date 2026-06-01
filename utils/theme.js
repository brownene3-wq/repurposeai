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
    .sidebar.collapsed .sidebar-header{padding:0 8px 14px;justify-content:center;gap:0}
    .sidebar.collapsed .sidebar-toggle{display:none}
    .sidebar.collapsed .logo-mini{cursor:pointer}
    .sidebar .logo{display:flex;align-items:center;text-decoration:none;line-height:1;white-space:nowrap;overflow:hidden}
    .sidebar .logo img{display:block}
    .sidebar .logo-full{flex:1;min-width:0;opacity:1;max-width:200px;transition:opacity .15s ease,max-width .25s ease,margin .25s ease}
    .sidebar.collapsed .logo-full{opacity:0;max-width:0;margin:0;flex:0 0 0;width:0;padding:0;border:none;pointer-events:none;display:none}
    .sidebar .logo-mini{display:flex;align-items:center;flex:0 0 auto;text-decoration:none;line-height:1;text-align:center;width:0;opacity:0;overflow:hidden;pointer-events:none;transition:opacity .25s ease .08s,width .25s ease}
    .sidebar .logo-mini img{display:block}
    .sidebar:not(.collapsed) .logo-mini{display:none}
    .sidebar.collapsed .logo-mini{width:28px;opacity:1;pointer-events:auto;display:flex}
    .sidebar-nav{flex:1;overflow-y:auto;min-height:0;padding:4px 0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    .sidebar-nav::-webkit-scrollbar{width:6px}
    .sidebar-nav::-webkit-scrollbar-track{background:transparent}
    .sidebar-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    .sidebar-nav::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    .sidebar a{display:flex;align-items:center;gap:12px;padding:11px 20px;color:#888;text-decoration:none;transition:all 0.2s;border-left:3px solid transparent;white-space:nowrap;overflow:hidden;font-size:0.82rem;line-height:1.3}
    .sidebar.collapsed a{justify-content:center;padding:11px 0;gap:0;border-right:3px solid transparent}
    .sidebar.collapsed .sidebar-nav{scrollbar-width:none}
    .sidebar.collapsed .sidebar-nav::-webkit-scrollbar{display:none}
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
    .user-popover .notif-bell-badge{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:linear-gradient(135deg,#EC4899,#6C3AED);color:#fff;font-size:0.62rem;font-weight:800;letter-spacing:.02em;line-height:1;box-shadow:0 2px 8px rgba(108,58,237,.30)}
    .user-popover .notif-bell-badge[hidden]{display:none}
    .user-popover a.popover-signout:hover{background:rgba(239,68,68,0.10) !important;color:#fca5a5 !important}
    .user-popover hr{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:4px 0}
    @keyframes userPopIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    /* Task #84 — Instant CSS tooltip. Native title= attributes have a
       browser-controlled ~500ms delay; we use ::after with the
       data-tooltip attribute so the label appears the moment the cursor
       enters the element. Applied wherever class="splicora-tt" lives. */
    .splicora-tt{position:relative}
    .splicora-tt::after{content:attr(data-tooltip);position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);background:rgba(15,12,28,.95);color:#fff;font-size:11px;font-weight:500;letter-spacing:.2px;padding:5px 10px;border-radius:6px;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;border:1px solid rgba(124,58,237,.35);box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:10001}
    .splicora-tt:hover::after,.splicora-tt:focus-visible::after{opacity:1;visibility:visible}
    /* Mini-logo lives in the collapsed sidebar (left edge) — anchor the
       tooltip to its right side instead of below so it doesn't get
       clipped by the sidebar's overflow:hidden. */
    .splicora-tt.splicora-tt-right::after{top:50%;left:calc(100% + 8px);transform:translateY(-50%)}
    .theme-toggle{background:#222;border:1px solid #333;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1em;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:fixed;top:1.2rem;right:1.5rem;z-index:100}
    body.light .sidebar,html.light .sidebar{background:#f8f8f8;border-color:#e0e0e0}
    body.light .sidebar a,html.light .sidebar a{color:#666}
    body.light .sidebar a.active,html.light .sidebar a.active{color:#6c5ce7;background:rgba(108,92,231,0.08)}
    .sidebar .logo-full .logo-dark{display:none !important}
    body.light .sidebar .logo-full .logo-dark,html.light .sidebar .logo-full .logo-dark{display:block !important}
    body.light .sidebar .logo-full .logo-light,html.light .sidebar .logo-full .logo-light{display:none !important}
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
    /* Unified page header — matches the Notifications page look across the app.
       Targets every wrapper variant used on the 15 standard pages: .page-header,
       .header, .workflows-header, .notif-header, plus the .page-title div used
       on Analytics. !important so per-page overrides don't drift. */
    .page-header,.header,.workflows-header,.notif-header{margin-bottom:24px !important}
    .page-header h1,.page-header h2,.header h1,.header h2,.workflows-header h1,.notif-header h1,.page-header .header-title,.header .header-title,.page-title{font-size:1.8rem !important;font-weight:800 !important;margin:0 0 .4rem !important;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%) !important;-webkit-background-clip:text !important;-webkit-text-fill-color:transparent !important;background-clip:text !important;line-height:1.2 !important;color:transparent;width:fit-content !important}
    .page-header p,.header p,.workflows-header p,.notif-header p,.page-header .header-subtitle,.header .header-subtitle{color:var(--text-muted) !important;font-size:.95rem !important;margin:0 !important}
    .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;text-decoration:none}
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
      .page-header h1,.header h1,.workflows-header h1,.notif-header h1,.page-header .header-title,.header .header-title,.page-title{font-size:1.4rem !important}
      .page-header p,.header p,.workflows-header p,.notif-header p,.page-header .header-subtitle,.header .header-subtitle{font-size:.85rem !important}
      .theme-toggle{top:.9rem;right:1rem;width:32px;height:32px;font-size:.85em}
      .btn{padding:.6rem 1.2rem;font-size:.82rem}
      .card{padding:1rem !important;border-radius:12px !important}
      table{font-size:.8rem}
      table th,table td{padding:.5rem .4rem}
    }
    @media(max-width:480px){
      .main-content{padding:.75rem;padding-top:3.5rem}
      .page-header,.header,.workflows-header,.notif-header{margin-bottom:1rem !important}
      .page-header h1,.header h1,.workflows-header h1,.notif-header h1,.page-header .header-title,.header .header-title,.page-title{font-size:1.2rem !important}
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
  <link rel="icon" type="image/x-icon" href="/images/favicon.ico?v=5">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Splicora">
  <link rel="apple-touch-icon" href="/images/icon-192.png?v=5">
  <script>
    // Restore saved theme preference for dashboard pages
    (function(){
      try {
        var t = localStorage.getItem('theme') || 'dark';
        if (t === 'light') {
          document.documentElement.classList.add('light');
          document.documentElement.setAttribute('data-theme','light');
        } else {
          document.documentElement.classList.remove('light');
          document.documentElement.setAttribute('data-theme','dark');
        }
      } catch(_){
        document.documentElement.setAttribute('data-theme','dark');
      }
      document.addEventListener('DOMContentLoaded', function(){
        try {
          var t = localStorage.getItem('theme') || 'dark';
          if (t === 'light') document.body.classList.add('light');
          else document.body.classList.remove('light');
        } catch(_){}
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
    { href: '/dashboard', icon: '<img src="/images/section-icons/A-21.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Dashboard', key: 'dashboard', perm: null },
    { href: '/distribute', icon: '<img src="/images/section-icons/A-12.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Repurpose', key: 'distribute', perm: null },
    { href: '/repurpose', icon: '<img src="/images/section-icons/A-101.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Create', key: 'repurpose', perm: 'use_repurpose' },
    { href: '/repurpose/history', icon: '<img src="/images/section-icons/A-112.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Library', key: 'library', perm: 'use_repurpose' },
    { href: '/shorts', icon: '<img src="/images/section-icons/A-1.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Smart Shorts', key: 'shorts', perm: 'use_shorts' },
    { href: '/shorts/clips', icon: '<img src="/images/section-icons/A-112.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'My Clips', key: 'my-clips', perm: 'use_shorts' },
    { href: '/video-editor', icon: '<img src="/images/section-icons/A-2.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Video Editor', key: 'video-editor', perm: 'use_repurpose' },
    // --- AI & Creative Tools ---
    { href: '/ai-captions', icon: '<img src="/images/section-icons/A-3.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'AI Captions', key: 'ai-captions', perm: 'use_repurpose' },
    { href: '/caption-presets', icon: '<img src="/images/section-icons/A-4.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Caption Styles', key: 'caption-presets', perm: 'use_repurpose' },
    { href: '/ai-hook', icon: '<img src="/images/section-icons/A-5.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'AI Hooks', key: 'ai-hook', perm: 'use_repurpose' },
    { href: '/ai-reframe', icon: '<img src="/images/section-icons/A-6.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'AI Reframe', key: 'ai-reframe', perm: 'use_repurpose' },
    { href: '/ai-thumbnail', icon: '<img src="/images/section-icons/A-103.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'AI Thumbnails', key: 'ai-thumbnail', perm: 'use_repurpose' },
    { href: '/ai-broll', icon: '<img src="/images/section-icons/A-7.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'AI B-Roll', key: 'ai-broll', perm: 'use_repurpose' },
    { href: '/enhance-speech', icon: '<img src="/images/section-icons/A-113.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Enhance Audio', key: 'enhance-speech', perm: 'use_repurpose' },
    // --- Brand & Planning ---
    { href: '/brand-voice', icon: '<img src="/images/section-icons/A-117.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Brand Voice', key: 'brand-voice', perm: 'use_brand_voice' },
    // Brand Templates moved into /settings as a tab. The standalone
    // /brand-templates route is still mounted so the iframe + save
    // API + Brand Kit modal CTAs continue to work, but it's no longer
    // a sidebar destination.
    { href: '/dashboard/calendar', icon: '<img src="/images/section-icons/A-8.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Calendar', key: 'calendar', perm: 'use_calendar' },
    { href: '/dashboard/analytics', icon: '<img src="/images/section-icons/A-50.png" alt="" style="width:20px;height:20px;border-radius:4px">', label: 'Analytics', key: 'analytics', perm: 'view_analytics' },
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
        <a href="/dashboard" class="logo logo-full splicora-tt" aria-label="Go to Dashboard" data-tooltip="Go to Dashboard" style="padding:0;margin:0;text-decoration:none;border-left:none;"><img class="logo-light" src="/images/splicora-logo-wide.png?v=4" alt="Splicora" style="height:32px;"><img class="logo-dark" src="/images/splicora-logo-wide-dark.png?v=4" alt="Splicora" style="height:32px;"></a>
        <a href="/dashboard" class="logo logo-mini splicora-tt splicora-tt-right" aria-label="Go to Dashboard" data-tooltip="Go to Dashboard" onclick="if(document.getElementById('mainSidebar').classList.contains('collapsed')){event.preventDefault();toggleSidebarCollapse();}"><img src="/images/icon-192.png?v=5" alt="S" style="height:32px;border-radius:6px;"></a>
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
          <a href="/notifications" role="menuitem" id="notifPopoverLink"><span class="nav-icon"><img src="/images/section-icons/A-99.png" alt="" style="height:20px;width:20px;vertical-align:middle;border-radius:4px"></span><span class="nav-label">Notifications</span><span id="notifBellBadge" class="notif-bell-badge" hidden>0</span></a>
          <a href="/settings" role="menuitem"><span class="nav-icon"><img src="/images/section-icons/A-100.png" alt="" style="height:20px;width:20px;vertical-align:middle;border-radius:4px"></span><span class="nav-label">Settings</span></a>
          <a href="/billing" role="menuitem"><span class="nav-icon"><img src="/images/section-icons/A-41.png" alt="" style="height:20px;width:20px;vertical-align:middle;border-radius:4px"></span><span class="nav-label">Billing</span></a>
          <hr>
          <a href="/auth/logout" role="menuitem" class="popover-signout"><span class="nav-icon"><img src="/images/section-icons/A-102.png" alt="" style="height:20px;width:20px;vertical-align:middle;border-radius:4px"></span><span class="nav-label">Sign Out</span></a>
        </div>
      </div>
    </aside>`;
}

function getThemeToggle() {
  return `<div class="ptr-indicator" id="ptrIndicator">&#x21BB;</div>
    <button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>
    <button class="mobile-menu-btn" onclick="toggleMobileMenu()">&#9776;</button>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleMobileMenu()"></div>`;
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

    // Poll the notifications unread count every 60s and reflect it in the sidebar badge
    function _refreshNotifBadge(){
      var badge = document.getElementById('notifBellBadge');
      if (!badge) return;
      fetch('/notifications/api/count', { credentials: 'same-origin' })
        .then(function(r){ return r.ok ? r.json() : { count: 0 }; })
        .then(function(d){
          var c = (d && typeof d.count === 'number') ? d.count : 0;
          if (c > 0) {
            badge.textContent = c > 99 ? '99+' : String(c);
            badge.removeAttribute('hidden');
          } else {
            badge.setAttribute('hidden', '');
          }
        })
        .catch(function(){});
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _refreshNotifBadge);
    } else {
      _refreshNotifBadge();
    }
    setInterval(_refreshNotifBadge, 60000);

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
    // Restore saved theme preference on dashboard pages
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light') {
        document.body.classList.add('light');
        document.documentElement.classList.add('light');
        document.documentElement.setAttribute('data-theme', 'light');
        const btn = document.querySelector('.theme-toggle');
        if(btn) btn.innerHTML = '&#x2600;&#xFE0F;';
      }
    } catch(_){}
  
    // Load v9 buttons fix
    var _s=document.createElement('script');_s.src='/public/js/v9-buttons-fix.js';document.head.appendChild(_s);`;
}

function getBrandKitModal() {
  // Centralized Brand Kit picker — mirrors the modal from
  // public/js/v10-editor-redesign.js so /shorts, /video-editor, and any
  // other page share one window. It lists saved Brand Templates from
  // /brand-templates/list and lets the user Apply one. Pages may override
  // window.applyBrandTemplateChoice to receive the picked template; the
  // default just toasts and stores window.__appliedBrandTemplate.
  return `
    <style>
      #v10BrandKitModal{position:fixed;inset:0;z-index:99998;background:rgba(8,6,18,.75);display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px);font-family:system-ui,sans-serif}
      #v10BrandKitModal.show{display:flex}
      #v10BrandKitModal .bk-panel{background:#1a1230;border:1px solid rgba(124,58,237,.4);border-radius:12px;padding:18px;width:min(560px,92vw);max-height:82vh;overflow-y:auto;color:#e2e0f0}
      #v10BrandKitModal .bk-title-row{display:flex;align-items:center;gap:10px;margin-bottom:6px}
      #v10BrandKitModal .bk-title{font-weight:700;font-size:14px;color:#fde047}
      #v10BrandKitModal .bk-sub{font-size:11px;color:#8886a0;margin-bottom:14px;line-height:1.5}
      #v10BrandKitModal .bk-list{min-height:100px}
      #v10BrandKitModal .bk-card{background:rgba(255,255,255,.03);border:1px solid rgba(124,58,237,.25);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:14px}
      #v10BrandKitModal .bk-swatch{flex:none;width:72px;height:72px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;text-shadow:0 1px 3px rgba(0,0,0,.6)}
      #v10BrandKitModal .bk-card-meta{flex:1;min-width:0}
      #v10BrandKitModal .bk-card-name{font-size:13px;font-weight:700;color:#e2e0f0;margin-bottom:4px}
      #v10BrandKitModal .bk-card-aspect{font-size:11px;color:#8886a0}
      #v10BrandKitModal .bk-logo-yes{font-size:10px;color:#22c55e;margin-top:4px}
      #v10BrandKitModal .bk-logo-no{font-size:10px;color:#5c5a70;margin-top:4px}
      #v10BrandKitModal .bk-logo-thumb{flex:none;width:44px;height:44px;object-fit:contain;background:rgba(255,255,255,.06);border-radius:6px;padding:4px}
      #v10BrandKitModal .bk-apply{flex:none;padding:8px 14px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer}
      /* Select-mode highlight (used by /shorts; harmless on other pages). */
      #v10BrandKitModal .bk-card.bk-card-selected{border-color:#a855f7;box-shadow:0 0 0 1px #a855f7 inset,0 8px 22px rgba(168,85,247,.18)}
      #v10BrandKitModal .bk-card-selected .bk-apply{background:linear-gradient(135deg,#10b981,#059669)}
      #v10BrandKitModal .bk-selected-badge{font-size:10px;color:#10b981;margin-top:4px;font-weight:700;letter-spacing:.4px}
      #v10BrandKitModal .bk-apply:hover{filter:brightness(1.1)}
      #v10BrandKitModal .bk-footer{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:14px}
      #v10BrandKitModal .bk-edit-link{color:#a78bfa;font-size:11px;text-decoration:none}
      #v10BrandKitModal .bk-edit-link:hover{text-decoration:underline}
      #v10BrandKitModal .bk-close-btn{padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer}
      #v10BrandKitModal .bk-close-btn:hover{background:rgba(255,255,255,.1)}
      #v10BrandKitModal .bk-loading{color:#a78bfa;font-size:12px;text-align:center;padding:24px 0}
      #v10BrandKitModal .bk-spinner{display:inline-block;width:14px;height:14px;border:2px solid #a78bfa;border-top-color:transparent;border-radius:50%;animation:bkSpin 1s linear infinite;margin-right:8px;vertical-align:middle}
      @keyframes bkSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    </style>
    <div id="v10BrandKitModal" onclick="if(event.target===this)closeBrandKitModal()" role="dialog" aria-modal="true" aria-labelledby="bkTitle">
      <div class="bk-panel">
        <div class="bk-title-row">
          <span style="font-size:18px">🎨</span>
          <span class="bk-title" id="bkTitle">BRAND KIT</span>
        </div>
        <div class="bk-sub">Pick a saved Brand Template to apply its aspect ratio, caption style, and logo to this project.</div>
        <div class="bk-list" id="bkList"></div>
        <div class="bk-footer">
          <a href="/settings?section=brandtemplates" target="_blank" rel="noopener" class="bk-edit-link">➤ Create / edit templates</a>
          <button class="bk-close-btn" onclick="closeBrandKitModal()">Close</button>
        </div>
      </div>
    </div>
    <script>
      (function(){
        function bkEsc(s){
          return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
          });
        }
        function renderTemplates(templates, captionStyles, aspectRatios, listEl){
          if (!templates.length){
            listEl.innerHTML =
              '<div style="padding:24px;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:8px;text-align:center;font-size:12px;color:#8886a0;line-height:1.5">' +
                'No saved templates yet.<br>' +
                '<a href="/settings?section=brandtemplates" target="_blank" rel="noopener" style="color:#a78bfa;text-decoration:none">Open Brand Templates in Settings</a> to create one.' +
              '</div>';
            return;
          }
          listEl.innerHTML = '';
          // Select-mode opt-in: pages can set window.brandKitModalMode='select'
          // to switch the modal from "apply once" semantics to "pick the one
          // template that future actions on this page should use." /shorts
          // uses this; /video-editor leaves the default ('apply').
          var __isSelectMode = (window.brandKitModalMode === 'select');
          var __selectedId = (window.brandKitSelectedTemplateId
            || (function(){ try { return localStorage.getItem('brandKitSelectedTemplateId'); } catch(_){ return null; } })()
            || null);
          var __btnLabel = __isSelectMode ? 'Select' : 'Apply &rarr;';
          templates.forEach(function(t){
            var capStyle = (captionStyles && captionStyles[t.captionStyle]) || {};
            var aspect   = (aspectRatios   && aspectRatios[t.aspectRatio])  || {};
            var capColor = capStyle.color || '#a78bfa';
            // Headline = the user-entered template name (e.g. "Renamed Brand TikTok").
            // The caption style's display name is moved to a secondary line
            // so users can still see which preset the template uses, but the
            // card identity is the template they named.
            var capStyleName = capStyle.name || t.captionStyle || 'Default';
            var titleName    = (t.name && String(t.name).trim()) || capStyleName;
            var aspName  = (aspect.label ? (aspect.icon + ' ' + aspect.label) : (t.aspectRatio || ''));
            var card = document.createElement('div');
            var isThisSelected = __isSelectMode && (t.id || '') === __selectedId;
            card.className = 'bk-card' + (isThisSelected ? ' bk-card-selected' : '');
            card.innerHTML =
              '<div class="bk-swatch" style="background:linear-gradient(135deg,' + capColor + ',' + capColor + '80)">Aa</div>' +
              '<div class="bk-card-meta">' +
                '<div class="bk-card-name">' + bkEsc(titleName) + '</div>' +
                '<div class="bk-card-aspect">' + bkEsc(aspName) + (capStyleName && capStyleName !== titleName ? ' &middot; ' + bkEsc(capStyleName) : '') + '</div>' +
                (t.logoUrl
                  ? ('<div class="bk-logo-yes">&#x2713; Logo attached</div>')
                  : ('<div class="bk-logo-no">No logo</div>')
                ) +
                (isThisSelected ? '<div class="bk-selected-badge">&#x2713; SELECTED</div>' : '') +
              '</div>' +
              (t.logoUrl
                ? ('<img src="' + t.logoUrl + '" class="bk-logo-thumb" onerror="this.remove()"/>')
                : ''
              ) +
              '<button class="bk-apply" data-template-id="' + (t.id || '') + '">' +
                (isThisSelected ? '&#x2713; Selected' : __btnLabel) +
              '</button>';
            listEl.appendChild(card);
          });
          Array.prototype.forEach.call(listEl.querySelectorAll('.bk-apply'), function(btn){
            btn.addEventListener('click', function(){
              var tid = btn.getAttribute('data-template-id');
              var tmpl = templates.find(function(t){ return (t.id || '') === tid; }) || templates[0];
              var modeAtClick = window.brandKitModalMode;
              // Pages can hook custom apply logic via window.applyBrandTemplateChoice
              try {
                if (typeof window.applyBrandTemplateChoice === 'function'){
                  window.applyBrandTemplateChoice(tmpl, captionStyles, aspectRatios);
                } else {
                  window.__appliedBrandTemplate = tmpl;
                  if (typeof showToast === 'function') showToast('Applied "' + (tmpl && (tmpl.name || (capStyle && capStyle.name) || 'template')) + '"');
                }
              } catch (e){ console.warn('Apply hook failed:', e); }
              if (modeAtClick === 'select') {
                // Stay open and re-paint the list so the picked card now
                // shows its "Selected" state. Use the in-memory templates,
                // no extra network fetch needed.
                try { renderTemplates(templates, captionStyles, aspectRatios, listEl); } catch (e) {}
              } else {
                closeBrandKitModal();
              }
            });
          });
        }
        window.openBrandKitModal = async function(){
          var modal = document.getElementById('v10BrandKitModal');
          if (!modal) return;
          modal.classList.add('show');
          var list = modal.querySelector('#bkList');
          list.innerHTML = '<div class="bk-loading"><span class="bk-spinner"></span>Loading templates…</div>';
          try {
            var r = await fetch('/brand-templates/list', { credentials: 'same-origin' });
            var d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed to load');
            renderTemplates(d.templates || [], d.captionStyles || {}, d.aspectRatios || {}, list);
          } catch (err){
            list.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:20px;text-align:center">' +
              (err.message || 'Failed to load templates') + '</div>';
          }
        };
        window.closeBrandKitModal = function(){
          var modal = document.getElementById('v10BrandKitModal');
          if (modal) modal.classList.remove('show');
        };
        document.addEventListener('keydown', function(e){
          if (e.key === 'Escape') {
            var m = document.getElementById('v10BrandKitModal');
            if (m && m.classList.contains('show')) closeBrandKitModal();
          }
        });
        try {
          var params = new URLSearchParams(location.search);
          if (params.get('openBrandKit') === '1') {
            window.addEventListener('DOMContentLoaded', function(){ openBrandKitModal(); });
          }
        } catch (e) {}
      })();
    </script>
  `;
}

module.exports = { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript, getBrandKitModal };
