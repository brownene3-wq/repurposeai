const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript, getBrandKitModal } = require('../utils/theme');

// Page: shows pending + recently-fired reminders for the current user.
router.get('/', requireAuth, (req, res) => {
  res.send(`${getHeadHTML('Notifications')}
  <style>
    ${getBaseCSS()}
    .notif-page{padding:32px;max-width:760px}
    .notif-header h1{font-size:1.8rem;font-weight:800;margin:0 0 .4rem;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .notif-header p{color:var(--text-muted);font-size:.9rem;margin:0 0 24px}
    .notif-empty{padding:40px;text-align:center;color:var(--text-muted);background:var(--surface);border:1px dashed rgba(255,255,255,.10);border-radius:12px}
    body.light .notif-empty,html.light .notif-empty{border-color:rgba(0,0,0,.10)}
    .notif-empty .icon{font-size:2.4rem;opacity:.4;margin-bottom:8px}
    .notif-card{background:var(--surface);border:1px solid rgba(108,58,237,.20);border-radius:12px;padding:16px 20px;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start;transition:border-color .15s}
    body.light .notif-card,html.light .notif-card{border-color:rgba(108,58,237,.18)}
    .notif-card.unseen{background:linear-gradient(180deg,rgba(108,58,237,.08),rgba(236,72,153,.04));border-color:rgba(108,58,237,.45);box-shadow:0 0 0 1px rgba(108,58,237,.20)}
    .notif-icon{flex-shrink:0;width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.05em}
    .notif-body{flex:1;min-width:0}
    .notif-title{font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:4px}
    .notif-msg{color:var(--text-muted);font-size:.85rem;line-height:1.45}
    .notif-meta{margin-top:8px;font-size:.72rem;color:var(--text-dim);display:flex;gap:10px;flex-wrap:wrap}
    .notif-meta .pill{padding:2px 8px;border-radius:999px;background:rgba(108,58,237,.12);color:#a78bfa;font-weight:600;letter-spacing:.03em;text-transform:uppercase;font-size:.62rem}
    .notif-actions{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}
    .notif-actions a{font-size:.8rem;color:#a78bfa;text-decoration:none;font-weight:600;padding:4px 10px;border-radius:6px;background:rgba(108,58,237,.08);transition:background .15s}
    .notif-actions a:hover{background:rgba(108,58,237,.18)}
    .notif-section-title{font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin:24px 0 8px;padding-left:4px}
  </style>
  </head>
  <body>
    <div class="dashboard">
      ${getSidebar('notifications', req.user, req.teamPermissions)}
      ${getThemeToggle()}
      ${getBrandKitModal()}
      <main class="main-content">
        <div class="notif-page">
          <div class="notif-header">
            <h1>🔔 Notifications</h1>
            <p>Reminders for your scheduled posts. New ones land here automatically.</p>
          </div>
          <div id="notifList"><div class="notif-empty"><div class="icon">🔕</div><div>Loading…</div></div></div>
        </div>
      </main>
    </div>
    <script>
      ${getThemeScript()}

      const PLATFORM_LABELS = {
        tiktok:'TikTok',instagram:'Instagram',shorts:'YouTube Shorts',youtube:'YouTube',
        twitter:'Twitter / X',linkedin:'LinkedIn',facebook:'Facebook',blog:'Blog',newsletter:'Newsletter'
      };
      function escHtml(s){
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
          return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
      }
      function fmtMsg(title, platform){
        const t = escHtml(title || 'your post');
        const p = escHtml(PLATFORM_LABELS[platform] || platform || 'social');
        return 'Your scheduled post "' + t + '" for ' + p + ' is ready for the spotlight! Head over to your dashboard and let&rsquo;s get those views. You&rsquo;ve got this!';
      }
      function fmtAgo(ts){
        if (!ts) return '';
        const d = new Date(ts);
        const diff = Date.now() - d.getTime();
        const m = Math.floor(diff/60000);
        if (m < 1) return 'just now';
        if (m < 60) return m + ' min ago';
        const h = Math.floor(m/60);
        if (h < 24) return h + ' h ago';
        const days = Math.floor(h/24);
        return days + ' d ago';
      }
      async function loadNotifications(){
        const list = document.getElementById('notifList');
        try {
          const resp = await fetch('/notifications/api/feed?ts=' + Date.now(), { credentials: 'same-origin' });
          const data = await resp.json();
          const due = data.due || [];
          const recent = data.recent || [];
          if (!due.length && !recent.length) {
            list.innerHTML = '<div class="notif-empty"><div class="icon">🔕</div><div><strong>You\\'re all caught up.</strong></div><div style="margin-top:6px;font-size:.85rem">Schedule posts on the <a href="/dashboard/calendar" style="color:#a78bfa;text-decoration:none">Calendar</a> with reminders to see them here.</div></div>';
            return;
          }
          let html = '';
          if (due.length){
            html += '<div class="notif-section-title">Active reminders</div>';
            for (const e of due) html += renderCard(e, true);
          }
          if (recent.length){
            html += '<div class="notif-section-title">Recent</div>';
            for (const e of recent) html += renderCard(e, false);
          }
          list.innerHTML = html;
        } catch (err) {
          list.innerHTML = '<div class="notif-empty">Could not load notifications.</div>';
        }
      }
      function renderCard(e, unseen){
        const dueAt = e.scheduled_date && e.scheduled_time
          ? new Date(String(e.scheduled_date).slice(0,10) + 'T' + (e.scheduled_time || '12:00') + ':00').toLocaleString()
          : '';
        return '<div class="notif-card' + (unseen ? ' unseen' : '') + '">' +
          '<div class="notif-icon">📅</div>' +
          '<div class="notif-body">' +
            '<div class="notif-title">' + escHtml(e.title || 'Scheduled post') + '</div>' +
            '<div class="notif-msg">' + fmtMsg(e.title, e.platform) + '</div>' +
            '<div class="notif-meta">' +
              '<span class="pill">' + escHtml(PLATFORM_LABELS[e.platform] || e.platform || 'post') + '</span>' +
              (dueAt ? '<span>Due ' + escHtml(dueAt) + '</span>' : '') +
              (e.fired_at ? '<span>Fired ' + escHtml(fmtAgo(e.fired_at)) + '</span>' : '') +
            '</div>' +
            '<div class="notif-actions">' +
              '<a href="/dashboard/calendar">Open calendar</a>' +
              (e.analysis_id ? '<a href="/shorts?dlAnalysis=' + encodeURIComponent(e.analysis_id) + '&dlMoment=' + encodeURIComponent(e.moment_index || 0) + '">Download clip</a>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }
      loadNotifications();
      // Refresh every minute so newly-due reminders show up
      setInterval(loadNotifications, 60000);
    </script>
  </body>
</html>`);
});

// API: list due-now reminders for the current user + recently fired ones.
// "Due" = reminder_minutes > 0, reminder_sent = FALSE, scheduled_at - reminder_minutes <= NOW(),
// scheduled time still in the future (we don't fire post-due reminders).
// On read, mark them sent so they don't fire repeatedly. Recent = sent within 7 days.
router.get('/api/feed', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const dueResult = await db.query(`
      SELECT * FROM calendar_entries
      WHERE user_id = $1
        AND reminder_minutes > 0
        AND reminder_sent = FALSE
        AND status != 'published'
        AND (scheduled_date::timestamp + scheduled_time::time) - (reminder_minutes || ' minutes')::interval <= NOW()
      ORDER BY scheduled_date, scheduled_time
      LIMIT 50
    `, [userId]);
    const due = dueResult.rows;

    if (due.length) {
      const ids = due.map(d => d.id);
      await db.query(`UPDATE calendar_entries SET reminder_sent = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::text[])`, [ids]);
    }

    const recentResult = await db.query(`
      SELECT *, updated_at AS fired_at FROM calendar_entries
      WHERE user_id = $1
        AND reminder_minutes > 0
        AND reminder_sent = TRUE
        AND updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY updated_at DESC
      LIMIT 20
    `, [userId]);
    const recent = recentResult.rows.filter(r => !due.find(d => d.id === r.id));

    res.json({ due, recent });
  } catch (error) {
    console.error('Notifications feed error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// API: pending count (used for sidebar badge or similar)
router.get('/api/count', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query(`
      SELECT COUNT(*) AS c FROM calendar_entries
      WHERE user_id = $1
        AND reminder_minutes > 0
        AND reminder_sent = FALSE
        AND status != 'published'
        AND (scheduled_date::timestamp + scheduled_time::time) - (reminder_minutes || ' minutes')::interval <= NOW()
    `, [req.user.id]);
    res.json({ count: parseInt(result.rows[0].c, 10) || 0 });
  } catch (error) {
    console.error('Notifications count error:', error);
    res.status(500).json({ count: 0 });
  }
});

module.exports = router;
