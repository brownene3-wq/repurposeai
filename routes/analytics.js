const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb, contentOps, outputOps, shortsOps, creditOps, storageOps, featureUsageOps, workflowOps, connectedAccountOps, calendarOps, clipRenderOps, userRenderOps, pool } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // ── Core Content Stats ──
    const videosThisMonth = await contentOps.countByUserIdThisMonth(userId);
    const totalContent = await contentOps.countByUserId(userId);
    const totalPosts = await outputOps.countByUserId(userId);

    // ── Platform breakdown ──
    const platforms = ['Instagram', 'TikTok', 'Twitter/X', 'LinkedIn', 'Facebook', 'YouTube', 'Blog', 'Pinterest', 'Threads', 'Snapchat', 'Bluesky'];
    const platformCounts = {};
    let maxPlatformCount = 0;
    for (const p of platforms) {
      const count = await outputOps.countByPlatformForUser(userId, p);
      platformCounts[p] = count;
      if (count > maxPlatformCount) maxPlatformCount = count;
    }
    const activePlatforms = platforms.filter(p => platformCounts[p] > 0).length;

    // ── Smart Shorts ──
    // Now reports BOTH analyses started and finished moment clip
    // renders, since both surface in the Library Clips tab and both
    // represent "work the user did with Smart Shorts."
    let shortsAnalyses = 0, shortsClips = 0;
    try { shortsAnalyses = await shortsOps.countByUserId(userId); } catch(e) {}
    try { shortsClips = await clipRenderOps.countByUser(userId); } catch(e) {}
    const shortsCount = shortsAnalyses + shortsClips;

    // ── Library renders (Edited/Captioned/Hook/Reframed/B-Roll/Thumbs)
    //    Counts every successful render logged via recordRender().
    let libraryRenders = 0;
    let libraryByTool = {};
    try {
      const r = await pool.query(
        `SELECT tool, COUNT(*) AS n FROM user_renders
          WHERE user_id = $1 AND deleted_at IS NULL AND status = 'ready'
          GROUP BY tool`,
        [userId]
      );
      r.rows.forEach(row => { libraryByTool[row.tool] = Number(row.n); libraryRenders += Number(row.n); });
    } catch(e) {}

    // ── Connected accounts (Phase 2 unified system) ──
    let connectedAccountsCount = 0, connectedPlatformsCount = 0;
    try {
      const accts = await connectedAccountOps.getByUser(userId);
      connectedAccountsCount = (accts || []).length;
      connectedPlatformsCount = new Set((accts || []).map(a => a.platform)).size;
    } catch(e) {}

    // ── Published vs scheduled (calendar_entries auto-publish path) ──
    let publishedCount = 0, scheduledUpcomingCount = 0;
    try {
      const r1 = await pool.query(
        `SELECT COUNT(*)::int AS n FROM calendar_entries
          WHERE user_id = $1 AND status = 'published'`,
        [userId]
      );
      publishedCount = Number(r1.rows[0].n || 0);
      const r2 = await pool.query(
        `SELECT COUNT(*)::int AS n FROM calendar_entries
          WHERE user_id = $1 AND auto_publish = TRUE AND status <> 'published'
            AND (scheduled_date::timestamp + scheduled_time::time) > NOW()`,
        [userId]
      );
      scheduledUpcomingCount = Number(r2.rows[0].n || 0);
    } catch(e) {}

    // ── "Things worked on this month" — broadest definition so the
    //    headline card reflects ALL platform activity, not just the
    //    legacy Repurpose flow.
    let thingsThisMonth = 0;
    try {
      const r = await pool.query(
        `SELECT (
            (SELECT COUNT(*) FROM content_items   WHERE user_id = $1 AND created_at >= date_trunc('month', NOW()))
          + (SELECT COUNT(*) FROM smart_shorts    WHERE user_id = $1 AND created_at >= date_trunc('month', NOW()))
          + (SELECT COUNT(*) FROM clip_renders    WHERE user_id = $1 AND created_at >= date_trunc('month', NOW()) AND deleted_at IS NULL)
          + (SELECT COUNT(*) FROM user_renders    WHERE user_id = $1 AND created_at >= date_trunc('month', NOW()) AND deleted_at IS NULL)
         )::int AS n`,
        [userId]
      );
      thingsThisMonth = Number(r.rows[0].n || 0);
    } catch(e) {
      thingsThisMonth = videosThisMonth;  // fall back if anything errors
    }

    // ── Workflows ──
    let workflows = [];
    let activeWorkflows = 0;
    let totalWorkflowPosts = 0;
    try {
      workflows = await workflowOps.getByUser(userId);
      activeWorkflows = workflows.filter(w => w.is_active).length;
      totalWorkflowPosts = workflows.reduce((s, w) => s + (w.post_count || 0), 0);
    } catch(e) {}

    // ── Credits ──
    // creditOps.breakdownThisMonth returns an ARRAY of
    // { feature, credits } objects — not a key→number map. The old
    // code looped with for…in over the array, which iterates string
    // indices and gave each object as the 'value', producing
    // '0[object Object][object Object]...' when concatenated.
    // Normalize into a { feature: credits } map up front so both the
    // total and the per-feature bars work correctly.
    let creditBreakdown = {};
    let totalCreditsThisMonth = 0;
    try {
      const raw = await creditOps.breakdownThisMonth(userId);
      if (Array.isArray(raw)) {
        for (const row of raw) {
          const key = row && row.feature;
          const n = Number(row && row.credits) || 0;
          if (key) creditBreakdown[key] = (creditBreakdown[key] || 0) + n;
          totalCreditsThisMonth += n;
        }
      } else if (raw && typeof raw === 'object') {
        // Defensive: handle the object-shape variant too.
        for (const key of Object.keys(raw)) {
          const n = Number(raw[key]) || 0;
          creditBreakdown[key] = n;
          totalCreditsThisMonth += n;
        }
      }
    } catch(e) {}

    // ── Storage ──
    let storageUsed = 0;
    let storageBreakdown = {};
    try {
      const usage = await storageOps.getUsage(userId);
      storageUsed = usage ? (usage.bytes_used || 0) : 0;
      storageBreakdown = await storageOps.breakdownAllTime(userId);
    } catch(e) {}

    // ── Feature Usage ──
    let featureUsage = {};
    try {
      featureUsage = await featureUsageOps.getByUser(userId);
    } catch(e) {}

    // ── Connected Accounts ──
    let connectedAccounts = [];
    try {
      connectedAccounts = await connectedAccountOps.getByUser(userId);
    } catch(e) {}

    // ── Calendar ──
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    let calendarEntries = [];
    try {
      calendarEntries = await calendarOps.getByUserId(userId, weekStart.toISOString(), weekEnd.toISOString());
    } catch(e) {}

    // ── Recent Activity (last 10 outputs) ──
    const recentOutputs = await outputOps.getByUserId(userId, 10, 0);
    const recentItems = [];
    for (const output of recentOutputs) {
      const content = await contentOps.getById(output.content_id);
      recentItems.push({
        platform: output.platform || 'Unknown',
        title: content ? content.title : 'Untitled',
        date: new Date(output.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        chars: output.character_count || 0
      });
    }

    // ── Platform brand colors ──
    const platformColors = {
      'Instagram': 'linear-gradient(90deg, #E1306C, #F77737)',
      'TikTok': 'linear-gradient(90deg, #00F2EA, #FF0050)',
      'Twitter/X': 'linear-gradient(90deg, #1DA1F2, #0d8bd9)',
      'LinkedIn': 'linear-gradient(90deg, #0077B5, #00a0dc)',
      'Facebook': 'linear-gradient(90deg, #1877F2, #42a5f5)',
      'YouTube': 'linear-gradient(90deg, #FF0000, #ff4444)',
      'Blog': 'linear-gradient(90deg, #6C3AED, #a78bfa)',
      'Pinterest': 'linear-gradient(90deg, #E60023, #ff4d6a)',
      'Threads': 'linear-gradient(90deg, #333, #666)',
      'Snapchat': 'linear-gradient(90deg, #FFFC00, #ffe033)',
      'Bluesky': 'linear-gradient(90deg, #0085FF, #33a1ff)'
    };

    // ── Feature labels for credit/usage breakdown ──
    const featureLabels = {
      'repurpose': 'Repurpose Content',
      'smart_shorts': 'Smart Shorts',
      'ai_captions': 'AI Captions',
      'ai_broll': 'AI B-Roll',
      'ai_hook': 'AI Hooks',
      'ai_thumbnail': 'AI Thumbnails',
      'ai_reframe': 'AI Reframe',
      'enhance_speech': 'Speech Enhancement',
      'video_editor': 'Video Editor',
      'brand_voice': 'Brand Voice',
      'distribute': 'Auto-Distribute',
      'calendar': 'Content Calendar'
    };
    const featureColors = {
      'repurpose': '#6C3AED',
      'smart_shorts': '#EC4899',
      'ai_captions': '#F59E0B',
      'ai_broll': '#0EA5E9',
      'ai_hook': '#10B981',
      'ai_thumbnail': '#EF4444',
      'ai_reframe': '#8B5CF6',
      'enhance_speech': '#06B6D4',
      'video_editor': '#F97316',
      'brand_voice': '#14B8A6',
      'distribute': '#6366F1',
      'calendar': '#A855F7'
    };

    // ── Build platform bars HTML ──
    const platformBarsHtml = platforms
      .filter(p => platformCounts[p] > 0)
      .sort((a, b) => platformCounts[b] - platformCounts[a])
      .map(p => {
        const count = platformCounts[p];
        const pct = maxPlatformCount > 0 ? Math.round((count / maxPlatformCount) * 100) : 0;
        const barColor = platformColors[p] || 'linear-gradient(90deg, #6c5ce7, #a29bfe)';
        return `<div class="chart-bar"><div class="platform">${p}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${barColor}"></div></div><div class="count">${count}</div></div>`;
      }).join('\n');

    const noPlatformData = Object.values(platformCounts).every(c => c === 0);

    // ── Build credit breakdown HTML ──
    const creditKeys = Object.keys(creditBreakdown).filter(k => creditBreakdown[k] > 0).sort((a,b) => creditBreakdown[b] - creditBreakdown[a]);
    const maxCredits = creditKeys.length > 0 ? creditBreakdown[creditKeys[0]] : 0;
    const creditBarsHtml = creditKeys.map(key => {
      const count = creditBreakdown[key];
      const pct = maxCredits > 0 ? Math.round((count / maxCredits) * 100) : 0;
      const color = featureColors[key] || '#6C3AED';
      const label = featureLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<div class="chart-bar"><div class="platform">${label}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><div class="count">${count}</div></div>`;
    }).join('\n');

    // ── Build feature usage HTML ──
    const usageKeys = Object.keys(featureUsage).filter(k => featureUsage[k] > 0).sort((a,b) => featureUsage[b] - featureUsage[a]);
    const maxUsage = usageKeys.length > 0 ? featureUsage[usageKeys[0]] : 0;
    const featureUsageHtml = usageKeys.map(key => {
      const count = featureUsage[key];
      const pct = maxUsage > 0 ? Math.round((count / maxUsage) * 100) : 0;
      const color = featureColors[key] || '#6C3AED';
      const label = featureLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<div class="chart-bar"><div class="platform">${label}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><div class="count">${count}</div></div>`;
    }).join('\n');

    // ── Build workflows table ──
    let workflowsHtml;
    if (workflows.length === 0) {
      workflowsHtml = `<div class="empty-state"><p>&#x1F504;</p><p>No workflows yet. Set up automated distribution to see workflow stats here.</p></div>`;
    } else {
      workflowsHtml = `<table class="data-table">
        <tr><th>Workflow</th><th>Status</th><th>Posts</th><th>Auto-Publish</th></tr>
        ${workflows.map(w => {
          const statusBadge = w.is_active
            ? '<span class="badge badge-green">Active</span>'
            : '<span class="badge badge-gray">Paused</span>';
          const autoPub = w.auto_publish
            ? '<span class="badge badge-purple">On</span>'
            : '<span class="badge badge-gray">Off</span>';
          const name = (w.source_username || 'Source') + ' → ' + (w.dest_username || w.dest_platform || 'Dest');
          return `<tr><td>${name}</td><td>${statusBadge}</td><td>${w.post_count || 0}</td><td>${autoPub}</td></tr>`;
        }).join('')}
      </table>`;
    }

    // ── Build connected accounts HTML ──
    let connectedHtml;
    if (connectedAccounts.length === 0) {
      connectedHtml = `<div class="empty-state"><p>&#x1F517;</p><p>No accounts connected yet. Link your social media accounts to get started.</p></div>`;
    } else {
      const platformGroups = {};
      connectedAccounts.forEach(a => {
        const p = a.platform || 'Unknown';
        if (!platformGroups[p]) platformGroups[p] = [];
        platformGroups[p].push(a);
      });
      connectedHtml = `<div class="connected-grid">${Object.keys(platformGroups).map(p => {
        const accounts = platformGroups[p];
        const color = platformColors[p] ? platformColors[p].match(/#[0-9A-Fa-f]{6}/)?.[0] || '#6C3AED' : '#6C3AED';
        return `<div class="connected-card">
          <div class="connected-platform" style="color:${color}">${p}</div>
          <div class="connected-count">${accounts.length} account${accounts.length > 1 ? 's' : ''}</div>
          <div class="connected-names">${accounts.map(a => a.username || a.account_name || 'Connected').join(', ')}</div>
        </div>`;
      }).join('')}</div>`;
    }

    // ── Build calendar HTML ──
    let calendarHtml;
    if (calendarEntries.length === 0) {
      calendarHtml = `<div class="empty-state"><p>&#x1F4C5;</p><p>No scheduled content this week. Use the Content Calendar to plan ahead.</p></div>`;
    } else {
      calendarHtml = `<table class="data-table">
        <tr><th>Title</th><th>Platform</th><th>Scheduled</th><th>Status</th></tr>
        ${calendarEntries.map(e => {
          const date = new Date(e.scheduled_date || e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const status = e.reminder_sent ? '<span class="badge badge-green">Reminded</span>' : '<span class="badge badge-purple">Upcoming</span>';
          return `<tr><td>${e.title || 'Untitled'}</td><td>${e.platform || '-'}</td><td>${date}</td><td>${status}</td></tr>`;
        }).join('')}
      </table>`;
    }

    // ── Build recent activity HTML ──
    let recentHtml;
    if (recentItems.length === 0) {
      recentHtml = `<div class="empty-state"><p>&#x1F4AD;</p><p>No activity yet. Start creating content to see your analytics here.</p></div>`;
    } else {
      recentHtml = `<table class="data-table">
        <tr><th>Platform</th><th>Content</th><th>Date</th><th style="text-align:right">Characters</th></tr>
        ${recentItems.map(item => `<tr><td>${item.platform}</td><td class="text-muted">${item.title}</td><td class="text-dim">${item.date}</td><td class="text-dim" style="text-align:right">${item.chars}</td></tr>`).join('')}
      </table>`;
    }

    // ── Storage formatting ──
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + sizes[i];
    }

    // ── Build storage breakdown ──
    const storageKeys = Object.keys(storageBreakdown).filter(k => storageBreakdown[k] > 0).sort((a,b) => storageBreakdown[b] - storageBreakdown[a]);
    const maxStorage = storageKeys.length > 0 ? storageBreakdown[storageKeys[0]] : 0;
    const storageBarsHtml = storageKeys.map(key => {
      const bytes = storageBreakdown[key];
      const pct = maxStorage > 0 ? Math.round((bytes / maxStorage) * 100) : 0;
      const color = featureColors[key] || '#6C3AED';
      const label = featureLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<div class="chart-bar"><div class="platform">${label}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><div class="count">${formatBytes(bytes)}</div></div>`;
    }).join('\n');

    const html = `${getHeadHTML('Analytics')}
  <style>
    ${getBaseCSS()}
    .layout { display: flex; min-height: 100vh; }
    .main { margin-left: 250px; flex: 1; padding: 30px; }

    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: #161616; border: 1px solid #222; border-radius: 16px; padding: 22px; position: relative; overflow: hidden; transition: transform 0.2s, box-shadow 0.2s; }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
    .stat-card:nth-child(1)::before { background: linear-gradient(90deg, #6C3AED, #EC4899); }
    .stat-card:nth-child(2)::before { background: linear-gradient(90deg, #F59E0B, #F97316); }
    .stat-card:nth-child(3)::before { background: linear-gradient(90deg, #0EA5E9, #6366F1); }
    .stat-card:nth-child(4)::before { background: linear-gradient(90deg, #10B981, #06B6D4); }
    .stat-card:nth-child(5)::before { background: linear-gradient(90deg, #EC4899, #F97316); }
    .stat-card:nth-child(6)::before { background: linear-gradient(90deg, #EF4444, #F59E0B); }
    .stat-card:nth-child(7)::before  { background: linear-gradient(90deg, #8B5CF6, #6366F1); }
    .stat-card:nth-child(8)::before  { background: linear-gradient(90deg, #14B8A6, #10B981); }
    .stat-card:nth-child(9)::before  { background: linear-gradient(90deg, #F97316, #EAB308); }
    .stat-card:nth-child(10)::before { background: linear-gradient(90deg, #3B82F6, #06B6D4); }
    .stat-card .label { color: #888; font-size: 0.82em; margin-bottom: 6px; font-weight: 500; }
    .stat-card .value { font-size: 2em; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
    .stat-card .sub { font-size: 0.78em; color: #10B981; margin-top: 4px; font-weight: 600; }

    /* Section cards */
    .analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .section { background: #161616; border: 1px solid rgba(108,58,237,0.15); border-radius: 16px; padding: 24px; margin-bottom: 20px; }
    .section.full-width { grid-column: 1 / -1; }
    .section h2 { font-size: 1.1em; margin-bottom: 16px; color: #fff; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .section h2 .icon { font-size: 1.2em; }

    /* Chart bars */
    .chart-bar { display: flex; align-items: center; margin-bottom: 10px; }
    .chart-bar .platform { width: 110px; font-size: 0.82em; color: #999; font-weight: 500; flex-shrink: 0; }
    .chart-bar .bar-bg { flex: 1; height: 26px; background: #1e1e2e; border-radius: 8px; overflow: hidden; }
    .chart-bar .bar-fill { height: 100%; border-radius: 8px; transition: width 0.6s ease; min-width: 4px; }
    .chart-bar .count { width: 60px; text-align: right; font-size: 0.85em; color: #aaa; margin-left: 10px; font-weight: 600; flex-shrink: 0; }

    /* Data tables */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { text-align: left; padding: 8px 12px; color: #888; font-size: 0.78em; font-weight: 600; border-bottom: 1px solid #333; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-table td { padding: 10px 12px; font-size: 0.88em; border-bottom: 1px solid #222; color: #ccc; }
    .text-muted { color: #aaa !important; }
    .text-dim { color: #666 !important; font-size: 0.82em !important; }

    /* Badges */
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.75em; font-weight: 600; }
    .badge-green { background: rgba(16,185,129,0.15); color: #10B981; }
    .badge-purple { background: rgba(108,58,237,0.15); color: #A855F7; }
    .badge-gray { background: rgba(255,255,255,0.06); color: #666; }

    /* Connected accounts grid */
    .connected-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .connected-card { background: rgba(255,255,255,0.03); border: 1px solid #222; border-radius: 12px; padding: 16px; text-align: center; }
    .connected-platform { font-weight: 700; font-size: 0.9em; margin-bottom: 4px; }
    .connected-count { font-size: 0.78em; color: #888; }
    .connected-names { font-size: 0.72em; color: #555; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Empty state */
    .empty-state { text-align: center; padding: 30px; color: #555; }
    .empty-state p { margin-top: 8px; font-size: 0.9em; }

    /* ── Light theme ── */
    body.light .stat-card { background: #fff; border-color: #e8e8ef; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    body.light .stat-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
    body.light .stat-card .label { color: #64748b; }
    body.light .stat-card .value { color: #1e293b; }
    body.light .stat-card .sub { color: #059669; }
    body.light .section { background: #fff; border-color: #e8e8ef; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    body.light .section h2 { color: #1e293b; }
    body.light .chart-bar .platform { color: #475569; }
    body.light .chart-bar .bar-bg { background: #f1f5f9; }
    body.light .chart-bar .count { color: #334155; }
    body.light .data-table th { color: #64748b; border-color: #e8e8ef; }
    body.light .data-table td { color: #334155; border-color: #f1f5f9; }
    body.light .text-muted { color: #64748b !important; }
    body.light .text-dim { color: #94a3b8 !important; }
    body.light .badge-green { background: rgba(16,185,129,0.1); color: #059669; }
    body.light .badge-purple { background: rgba(108,58,237,0.1); color: #7C3AED; }
    body.light .badge-gray { background: #f1f5f9; color: #94a3b8; }
    body.light .connected-card { background: #f8fafc; border-color: #e8e8ef; }
    body.light .connected-count { color: #64748b; }
    body.light .connected-names { color: #94a3b8; }
    body.light .empty-state { color: #94a3b8; }

    /* ── Responsive ── */
    @media(max-width:768px){
      .main{margin-left:0 !important;padding:1rem !important;padding-top:3.5rem !important}
      .stats-grid{grid-template-columns:1fr 1fr;gap:10px}
      .analytics-grid{grid-template-columns:1fr}
      .stat-card{padding:14px}
      .stat-card .value{font-size:1.5em}
      .chart-bar .platform{width:80px;font-size:.72em}
      .section{padding:16px}
      .connected-grid{grid-template-columns:1fr 1fr}
    }
    @media(max-width:480px){
      .stats-grid{grid-template-columns:1fr}
      .connected-grid{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <div class="layout">
    ${getSidebar('analytics', req.user, req.teamPermissions)}
    ${getThemeToggle()}
    <div class="main">
      <div class="page-header">
        <h1><img src="/images/section-icons/A-50.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Analytics</h1>
        <p style="color:#888;margin:0 0 8px">Performance metrics and usage insights across your entire workspace.</p>
      </div>

      <!-- ═══ Top Stats — 10 cards across two rows.  Same .stat-card
           class so look / typography / hover behaviour is identical to
           the old layout. The four new cards (Library Renders,
           Connected Accounts, Published Posts, Scheduled Posts) reflect
           features added since the original Analytics page was built. -->
      <div class="stats-grid">
        <!-- Row 1: activity & generation -->
        <div class="stat-card">
          <div class="label">Things Created This Month</div>
          <div class="value">${thingsThisMonth}</div>
          <div class="sub">${thingsThisMonth > 0 ? '&#x2705; Active' : 'No activity yet'}</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Content Items</div>
          <div class="value">${totalContent}</div>
          <div class="sub">Lifetime uploads</div>
        </div>
        <div class="stat-card">
          <div class="label">Posts Generated</div>
          <div class="value">${totalPosts}</div>
          <div class="sub">Across ${activePlatforms} platform${activePlatforms !== 1 ? 's' : ''}</div>
        </div>
        <div class="stat-card">
          <div class="label">Active Workflows</div>
          <div class="value">${activeWorkflows}</div>
          <div class="sub">${totalWorkflowPosts} auto-distributed</div>
        </div>
        <div class="stat-card">
          <div class="label">Smart Shorts</div>
          <div class="value">${shortsCount}</div>
          <div class="sub">${shortsAnalyses} analyses · ${shortsClips} clips</div>
        </div>
        <div class="stat-card">
          <div class="label">Credits This Month</div>
          <div class="value">${totalCreditsThisMonth}</div>
          <div class="sub">AI processing credits</div>
        </div>
        <!-- Row 2: new feature metrics (Library + Connections + Publish) -->
        <div class="stat-card">
          <div class="label">Library Renders</div>
          <div class="value">${libraryRenders}</div>
          <div class="sub">${Object.keys(libraryByTool).length || 0} tool${Object.keys(libraryByTool).length === 1 ? '' : 's'} producing output</div>
        </div>
        <div class="stat-card">
          <div class="label">Connected Accounts</div>
          <div class="value">${connectedAccountsCount}</div>
          <div class="sub">${connectedPlatformsCount} platform${connectedPlatformsCount === 1 ? '' : 's'} linked</div>
        </div>
        <div class="stat-card">
          <div class="label">Published Posts</div>
          <div class="value">${publishedCount}</div>
          <div class="sub">Lifetime auto-publishes</div>
        </div>
        <div class="stat-card">
          <div class="label">Scheduled Posts</div>
          <div class="value">${scheduledUpcomingCount}</div>
          <div class="sub">${scheduledUpcomingCount > 0 ? 'Upcoming queue' : 'Nothing queued'}</div>
        </div>
      </div>

      <!-- ═══ Two-Column Grid ═══ -->
      <div class="analytics-grid">

        <!-- Content by Platform -->
        <div class="section">
          <h2><span class="icon"><img src="/images/section-icons/A-50.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Content by Platform</h2>
          ${noPlatformData ? '<div class="empty-state"><p>No platform data yet. Generate content to see your distribution.</p></div>' : platformBarsHtml}
        </div>

        <!-- Credit Usage -->
        <div class="section">
          <h2><span class="icon"><img src="/images/section-icons/A-50.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Credit Usage This Month</h2>
          ${creditKeys.length === 0 ? '<div class="empty-state"><p>No credits used this month. AI features will show usage here.</p></div>' : creditBarsHtml}
        </div>

        <!-- Feature Usage -->
        <div class="section">
          <h2><span class="icon"><img src="/images/section-icons/A-115.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> AI Tools Usage</h2>
          ${usageKeys.length === 0 ? '<div class="empty-state"><p>No feature usage recorded yet. Your AI tool activity will appear here.</p></div>' : featureUsageHtml}
        </div>

        <!-- Storage -->
        <div class="section">
          <h2><span class="icon"><img src="/images/section-icons/A-116.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Storage Usage</h2>
          <div style="margin-bottom:16px;">
            <span style="font-size:1.6em;font-weight:800;color:#fff">${formatBytes(storageUsed)}</span>
            <span style="color:#888;font-size:0.85em;margin-left:8px">total used</span>
          </div>
          ${storageKeys.length === 0 ? '<div class="empty-state"><p>No storage data yet.</p></div>' : storageBarsHtml}
        </div>

        <!-- Workflows -->
        <div class="section full-width">
          <h2><span class="icon"><img src="/images/section-icons/A-45.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Workflow Performance</h2>
          ${workflowsHtml}
        </div>

        <!-- Connected Accounts -->
        <div class="section full-width">
          <h2><span class="icon"><img src="/images/section-icons/A-51.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Connected Accounts</h2>
          ${connectedHtml}
        </div>

        <!-- Calendar This Week -->
        <div class="section full-width">
          <h2><span class="icon"><img src="/images/section-icons/A-53.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Scheduled This Week</h2>
          ${calendarHtml}
        </div>

        <!-- Recent Activity -->
        <div class="section full-width">
          <h2><span class="icon"><img src="/images/section-icons/A-42.png" alt="" style="height:24px;width:24px;vertical-align:middle;border-radius:6px"></span> Recent Activity</h2>
          ${recentHtml}
        </div>

      </div>
    </div>
  </div>

  <script>
    ${getThemeScript()}
  </script>
</body>
</html>`;
    res.send(html);
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).send('Error loading analytics');
  }
});

module.exports = router;
