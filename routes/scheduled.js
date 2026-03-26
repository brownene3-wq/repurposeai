const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scheduled - RepurposeAI</title>
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
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; }
    .page-title { font-size: 1.8em; font-weight: 700; }
    .badge { background: #6c5ce7; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 0.7em; font-weight: 600; }
    .section { background: #161616; border: 1px solid #222; border-radius: 12px; padding: 40px; margin-bottom: 24px; text-align: center; }
    .empty-icon { font-size: 3em; margin-bottom: 16px; }
    .empty-title { font-size: 1.3em; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .empty-desc { color: #888; margin-bottom: 24px; }
    .cta-btn { display: inline-block; background: #6c5ce7; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background 0.2s; }
    .cta-btn:hover { background: #5a4bd1; }
    .how-it-works { background: #161616; border: 1px solid #222; border-radius: 12px; padding: 30px; }
    .how-it-works h2 { font-size: 1.2em; margin-bottom: 24px; color: #fff; }
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; }
    .step { text-align: center; padding: 20px; }
    .step-num { width: 36px; height: 36px; background: #6c5ce7; color: #fff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 12px; }
    .step h3 { color: #fff; margin-bottom: 8px; }
    .step p { color: #888; font-size: 0.9em; }
    .theme-toggle { position: fixed; bottom: 20px; right: 20px; background: #222; border: 1px solid #333; color: #fff; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; font-size: 1.2em; display: flex; align-items: center; justify-content: center; }
    body.light { background: #f5f5f5; color: #333; }
    body.light .sidebar { background: #fff; border-color: #e0e0e0; }
    body.light .sidebar a { color: #666; }
    body.light .sidebar a.active { color: #6c5ce7; background: rgba(108,92,231,0.08); }
    body.light .section, body.light .how-it-works { background: #fff; border-color: #e0e0e0; }
    body.light .step h3, body.light .empty-title { color: #333; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 20px 20px;">
        <div class="logo" style="padding:0;margin-bottom:0">Repurpose<span>AI</span></div>
        <button class="theme-toggle" onclick="document.body.classList.toggle('light')" style="position:static;margin:0">&#x1F319;</button>
      </div>
      <a href="/dashboard">&#x1F3AC; Dashboard</a>
      <a href="/repurpose">&#x1F504; Repurpose</a>
      <a href="/repurpose/history">&#x1F4DA; Library</a>
      <a href="/dashboard/calendar">&#x1F4C5; Calendar</a>
      <a href="/brand-voice">&#x1F399; Brand Voice</a>
      <a href="/dashboard/analytics">&#x1F4CA; Analytics</a>
      <a href="/billing">&#x1F4B3; Billing</a>
      <a href="/dashboard/scheduled" class="active">&#x23F0; Scheduled</a>
      <a href="/auth/logout" style="margin-top:auto;color:#ef4444;opacity:0.7;font-size:0.85rem;padding-bottom:20px;">Sign Out</a>
    </div>
    <div class="main">
      <div class="page-header">
        <div class="page-title">&#x23F0; Scheduled Posts</div>
        <div class="badge">Coming Soon</div>
      </div>
      <div class="section">
        <div class="empty-icon">&#x1F4C5;</div>
        <div class="empty-title">No scheduled posts yet</div>
        <div class="empty-desc">Once you repurpose a video, you can schedule posts to go out automatically.</div>
        <a href="/repurpose" class="cta-btn">&#x1F504; Repurpose a Video</a>
      </div>
      <div class="how-it-works">
        <h2>How Scheduling Works</h2>
        <div class="steps">
          <div class="step"><div class="step-num">1</div><h3>Repurpose</h3><p>Upload or paste a video link and generate content for multiple platforms.</p></div>
          <div class="step"><div class="step-num">2</div><h3>Schedule</h3><p>Pick a date and time for each platform post to go live.</p></div>
          <div class="step"><div class="step-num">3</div><h3>Publish</h3><p>We auto-publish your content at the scheduled time.</p></div>
        </div>
      </div>
    </div>
  </div>
  <button class="theme-toggle" onclick="document.body.classList.toggle('light')">&#x1F319;</button>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
