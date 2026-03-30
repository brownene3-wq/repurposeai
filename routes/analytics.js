const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb, contentOps, outputOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

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

    // Platform brand colors
    const platformColors = {
      'Instagram': 'linear-gradient(90deg, #E1306C, #F77737)',
      'TikTok': 'linear-gradient(90deg, #00F2EA, #FF0050)',
      'Twitter/X': 'linear-gradient(90deg, #1DA1F2, #0d8bd9)',
      'LinkedIn': 'linear-gradient(90deg, #0077B5, #00a0dc)',
      'Facebook': 'linear-gradient(90deg, #1877F2, #42a5f5)',
      'YouTube': 'linear-gradient(90deg, #FF0000, #ff4444)',
      'Blog': 'linear-gradient(90deg, #6C3AED, #a78bfa)'
    };

    // Build platform bars HTML
    const platformBarsHtml = platforms.map(p => {
      const count = platformCounts[p];
      const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      const barColor = platformColors[p] || 'linear-gradient(90deg, #6c5ce7, #a29bfe)';
      return `<div class="chart-bar"><div class="platform">${p}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${barColor}"></div></div><div class="count">${count}</div></div>`;
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

    const html = `${getHeadHTML('Analytics')}
  <style>
    ${getBaseCSS()}
    .layout { display: flex; min-height: 100vh; }
    .main { margin-left: 250px; flex: 1; padding: 30px; }
    .page-title { font-size: 1.8em; font-weight: 800; margin-bottom: 30px; background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .stat-card { background: #161616; border: 1px solid #222; border-radius: 16px; padding: 24px; position: relative; overflow: hidden; transition: transform 0.2s, box-shadow 0.2s; }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
    .stat-card:nth-child(1)::before { background: linear-gradient(90deg, #6C3AED, #EC4899); }
    .stat-card:nth-child(2)::before { background: linear-gradient(90deg, #F59E0B, #F97316); }
    .stat-card:nth-child(3)::before { background: linear-gradient(90deg, #0EA5E9, #6366F1); }
    .stat-card:nth-child(4)::before { background: linear-gradient(90deg, #EF4444, #F97316); }
    .stat-card .label { color: #888; font-size: 0.85em; margin-bottom: 8px; font-weight: 500; }
    .stat-card .value { font-size: 2.2em; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
    .stat-card .change { font-size: 0.8em; color: #10B981; margin-top: 6px; font-weight: 600; }
    .section { background: #161616; border: 1px solid rgba(108,58,237,0.15); border-radius: 16px; padding: 28px; margin-bottom: 24px; }
    .section h2 { font-size: 1.2em; margin-bottom: 20px; color: #fff; font-weight: 700; }
    .chart-bar { display: flex; align-items: center; margin-bottom: 14px; }
    .chart-bar .platform { width: 100px; font-size: 0.85em; color: #999; font-weight: 500; }
    .chart-bar .bar-bg { flex: 1; height: 28px; background: #1e1e2e; border-radius: 8px; overflow: hidden; }
    .chart-bar .bar-fill { height: 100%; border-radius: 8px; transition: width 0.6s ease; min-width: 4px; }
    .chart-bar .count { width: 40px; text-align: right; font-size: 0.9em; color: #aaa; margin-left: 12px; font-weight: 600; }
    .empty-state { text-align: center; padding: 40px; color: #666; }
    .empty-state p { margin-top: 10px; }

    /* Light theme */
    body.light .stat-card { background: #fff; border-color: #e8e8ef; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    body.light .stat-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
    body.light .stat-card .label { color: #64748b; }
    body.light .stat-card .value { color: #1e293b; }
    body.light .stat-card .change { color: #059669; }
    body.light .section { background: #fff; border-color: #e8e8ef; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    body.light .section h2 { color: #1e293b; }
    body.light .chart-bar .platform { color: #475569; }
    body.light .chart-bar .bar-bg { background: #f1f5f9; }
    body.light .chart-bar .count { color: #334155; }
    body.light table tr { border-color: #e8e8ef !important; }
    body.light table th { color: #64748b !important; }
    body.light table td { color: #334155 !important; }
  </style>
</head>
<body>
  <div class="layout">
    ${getSidebar('analytics')}
    <div class="main">
      ${getThemeToggle()}
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
