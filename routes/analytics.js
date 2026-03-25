const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
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
    .sidebar { width: 250px; background: #111; border-right: 1px solid #222; padding: 20px 0; position: fixed; height: 100vh; overflow-y: auto; }
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
    .theme-toggle { position: fixed; bottom: 20px; right: 20px; background: #222; border: 1px solid #333; color: #fff; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; font-size: 1.2em; display: flex; align-items: center; justify-content: center; }
    body.light { background: #f5f5f5; color: #333; }
    body.light .sidebar { background: #fff; border-color: #e0e0e0; }
    body.light .sidebar a { color: #666; }
    body.light .sidebar a.active { color: #6c5ce7; background: rgba(108,92,231,0.08); }
    body.light .main { background: #f5f5f5; }
    body.light .stat-card, body.light .section { background: #fff; border-color: #e0e0e0; }
    body.light .stat-card .value { color: #333; }
    body.light .chart-bar .bar-bg { background: #e0e0e0; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div class="logo">Repurpose<span>AI</span></div>
      <a href="/dashboard">&#x1F3AC; Dashboard</a>
      <a href="/repurpose">&#x1F504; Repurpose</a>
      <a href="/dashboard/analytics" class="active">&#x1F4CA; Analytics</a>
      <a href="/dashboard/scheduled">&#x23F0; Scheduled</a>
      <a href="/billing">&#x1F4B3; Billing</a>
      <a href="/contact">&#x1F4E7; Support</a>
    </div>
    <div class="main">
      <div class="page-title">&#x1F4CA; Analytics</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Videos This Month</div><div class="value">0</div><div class="change">-</div></div>
        <div class="stat-card"><div class="label">Posts Generated</div><div class="value">0</div><div class="change">-</div></div>
        <div class="stat-card"><div class="label">Total Copies</div><div class="value">0</div><div class="change">-</div></div>
        <div class="stat-card"><div class="label">Downloads</div><div class="value">0</div><div class="change">-</div></div>
      </div>
      <div class="section">
        <h2>Content by Platform</h2>
        <div class="chart-bar"><div class="platform">Twitter/X</div><div class="bar-bg"><div class="bar-fill" style="width:0%"></div></div><div class="count">0</div></div>
        <div class="chart-bar"><div class="platform">LinkedIn</div><div class="bar-bg"><div class="bar-fill" style="width:0%"></div></div><div class="count">0</div></div>
        <div class="chart-bar"><div class="platform">Instagram</div><div class="bar-bg"><div class="bar-fill" style="width:0%"></div></div><div class="count">0</div></div>
        <div class="chart-bar"><div class="platform">Facebook</div><div class="bar-bg"><div class="bar-fill" style="width:0%"></div></div><div class="count">0</div></div>
        <div class="chart-bar"><div class="platform">Blog</div><div class="bar-bg"><div class="bar-fill" style="width:0%"></div></div><div class="count">0</div></div>
      </div>
      <div class="section">
        <h2>Recent Activity</h2>
        <div class="empty-state"><p>&#x1F4AD;</p><p>No activity yet. Start repurposing content to see your analytics here.</p></div>
      </div>
    </div>
  </div>
  <button class="theme-toggle" onclick="document.body.classList.toggle('light')">&#x1F319;</button>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
