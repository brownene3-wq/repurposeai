const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb, contentOps, outputOps } = require('../db/database');

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // Get videos/content items this month
    const videosThisMonth = await contentOps.countByUserIdThisMonth(userId);

    // Get total posts generated (all outputs)
    const totalPosts = await outputOps.countByUserId(userId);

    // Get platform counts
    const platforms = ['Instagram', 'TikTok', 'Twitter/X', 'LinkedIn', 'Facebook', 'YouTube', 'Blog'];
    const platformCounts = {};
    let maxCount = 0;
    for (const p of platforms) {
      const count = await outputOps.countByPlatformForUser(userId, p);
      platformCounts[p] = count;
      if (count > maxCount) maxCount = count;
    }

    // Get recent activity (last 10 generated outputs with content info)
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

    // Build platform bars HTML
    const platformBarsHtml = platforms.map(p => {
      const count = platformCounts[p];
      const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      return `<div class="chart-bar"><div class="platform">${p}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div><div class="count">${count}</div></div>`;
    }).join('\n        ');

    // Build recent activity HTML
    let recentHtml;
    if (recentItems.length === 0) {
      recentHtml = `<div class="empty-state"><p>&#x1F4AD;</p><p>No activity yet. Start repurposing content to see your analytics here.</p></div>`;
    } else {
      recentHtml = `<table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #333;"><th style="text-align:left;padding:8px 12px;color:#888;font-size:0.8em;">Platform</th><th style="text-align:left;padding:8px 12px;color:#888;font-size:0.8em;">Content</th><th style="text-align:left;padding:8px 12px;color:#888;font-size:0.8em;">Date</th><th style="text-align:right;padding:8px 12px;color:#888;font-size:0.8em;">Characters</th></tr>
        ${recentItems.map(item => `<tr style="border-bottom:1px solid #222;"><td style="padding:10px 12px;font-size:0.9em;">${item.platform}</td><td style="padding:10px 12px;font-size:0.9em;color:#aaa;">${item.title}</td><td style="padding:10px 12px;font-size:0.85em;color:#666;">${item.date}</td><td style="padding:10px 12px;font-size:0.85em;color:#666;text-align:right;">${item.chars}</td></tr>`).join('')}
      </table>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics - RepurposeAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .layout { display: flex; min-height: 100vh; }
    .sidebar { width: 250px; background: #111; border-right: 1px solid #222; padding: 20px 0; position: fixed; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; }
    .sidebar .logo { padding: 0 20px 30px; font-size: 1.4em; font-weight: 700; color: #fff; }
    .sidebar .logo span { color: #6c5ce7; }
    .sidebar a { display: block; padding: 12px 20px; color: #888; text-decoration: none; transition: all 0.2s; border-left: 3px solid transparent; }
    .sidebar a:hover { color: #fff; background: rgba(108,92,231,0.1); }
    .sidebar a.active { color: #6c5ce7; background: rgba(108,92,231,0.1); border-left-color: #6c5ce7; }
    .main { margin-left: 250px; flex: 1; padding: 30px; }
    .page-title { font-size: 1.8em; font-weight: 700; margin-bottom: 30px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .stat-card { background: #161616; border: 1px solid #222; border-radius: 12px; padding: 24px; }
    .stat-card .label { color: #888; font-size: 0.85em; margin-bottom: 8px; }
    .stat-card .value { font-size: 2em; font-weight: 700; color: #fff; }
    .stat-card .change { font-size: 0.8em; color: #00b894; margin-top: 4px; }
    .section { background: #161616; border: 1px solid #222; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .section h2 { font-size: 1.2em; margin-bottom: 20px; color: #fff; }
    .chart-bar { display: flex; align-items: center; margin-bottom: 12px; }
    .chart-bar .platform { width: 100px; font-size: 0.85em; color: #888; }
    .chart-bar .bar-bg { flex: 1; height: 24px; background: #222; border-radius: 6px; overflow: hidden; }
    .chart-bar .bar-fill { height: 100%; background: linear-gradient(90deg, #6c5ce7, #a29bfe); border-radius: 6px; transition: width 0.5s; }
    .chart-bar .count { width: 40px; text-align: right; font-size: 0.85em; color: #888; margin-left: 10px; }
    .empty-state { text-align: center; padding: 40px; color: #666; }
    .empty-state p { margin-top: 10px; }
    .theme-toggle { background: #222; border: 1px solid #333; color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 1em; display: flex; align-items: center; justify-content: center; }
    body.light { background: #f5f5f5; color: #333; }
    body.light .sidebar { background: #fff; border-color: #e0e0e0; }
    body.light .sidebar a { color: #666; }
    body.light .sidebar a.active { color: #6c5ce7; background: rgba(108,92,231,0.08); }
    body.light .main { background: #f5f5f5; }
    body.light .stat-card, body.light .section { background: #fff; border-color: #e0e0e0; }
    body.light .stat-card .value { color: #333; }
    body.light .chart-bar .bar-bg { background: #e0e0e0; }
    body.light table tr { border-color: #e0e0e0 !important; }
    body.light table td { color: #333 !important; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 20px 20px;">
        <div class="logo" style="padding:0;">Repurpose<span>AI</span></div>
        <button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>
      </div>
      <a href="/dashboard">&#x1F3AC; Dashboard</a>
      <a href="/repurpose">&#x1F504; Repurpose</a>
      <a href="/repurpose/history">&#x1F4DA; Library</a>
      <a href="/dashboard/analytics" class="active">&#x1F4CA; Analytics</a>
      <a href="/dashboard/calendar">&#x1F4C5; Calendar</a>
      <a href="/brand-voice">&#x1F399; Brand Voice</a>
      <a href="/billing">&#x1F4B3; Billing</a>
      <a href="/auth/logout" style="margin-top:auto;color:#ef4444;opacity:0.7;font-size:0.85rem;padding-bottom:20px;">Sign Out</a>
    </div>
    <div class="main">
      <div class="page-title">&#x1F4CA; Analytics</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Videos This Month</div><div class="value">${videosThisMonth}</div><div class="change">${videosThisMonth > 0 ? '&#x2705; Active' : '-'}</div></div>
        <div class="stat-card"><div class="label">Posts Generated</div><div class="value">${totalPosts}</div><div class="change">${totalPosts > 0 ? '&#x2705; Active' : '-'}</div></div>
        <div class="stat-card"><div class="label">Platforms Used</div><div class="value">${platforms.filter(p => platformCounts[p] > 0).length}</div><div class="change">of ${platforms.length} available</div></div>
        <div class="stat-card"><div class="label">Avg Characters</div><div class="value">${recentItems.length > 0 ? Math.round(recentItems.reduce((s, i) => s + i.chars, 0) / recentItems.length) : 0}</div><div class="change">per post</div></div>
      </div>
      <div class="section">
        <h2>Content by Platform</h2>
        ${platformBarsHtml}
      </div>
      <div class="section">
        <h2>Recent Activity</h2>
        ${recentHtml}
      </div>
    </div>
  </div>

  <script>
    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      const btn = document.querySelector('.theme-toggle');
      btn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
    }
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
      document.querySelector('.theme-toggle').textContent = '☀️';
    }
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
