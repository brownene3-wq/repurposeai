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
    .notif-header h1{font-size:1.8rem;font-weight:800;margin:0 0 .4rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .notif-header p{color:var(--text-muted);font-size:.9rem;margin:0 0 24px}
    .notif-empty{padding:40px;text-align:center;color:var(--text-muted);background:var(--surface);border:1px dashed rgba(255,255,255,.10);border-radius:12px}
    body.light .notif-empty,html.light .notif-empty{border-color:rgba(0,0,0,.10)}
    .notif-empty .icon{font-size:2.4rem;opacity:.4;margin-bottom:8px}
    .notif-card{background:var(--surface);border:1px solid rgba(108,58,237,.20);border-radius:12px;padding:16px 20px;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start;transition:border-color .15s}
    body.light .notif-card,html.light .notif-card{border-color:rgba(108,58,237,.18)}
    .notif-card.unseen{background:linear-gradient(180deg,rgba(108,58,237,.08),rgba(236,72,153,.04));border-color:rgba(108,58,237,.45);box-shadow:0 0 0 1px rgba(108,58,237,.20)}
    .notif-card.upcoming{background:linear-gradient(180deg,rgba(16,185,129,.06),rgba(108,58,237,.03));border-color:rgba(16,185,129,.30)}
    body.light .notif-card.upcoming,html.light .notif-card.upcoming{border-color:rgba(16,185,129,.35)}
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
    /* AI tip cards — visually distinct from reminder cards. Unread tips
       get a brighter gradient border + soft glow so they read as
       "actionable" at a glance. */
    .ai-tip-card{position:relative;background:linear-gradient(180deg,rgba(108,58,237,.10),rgba(236,72,153,.04));border:1px solid rgba(108,58,237,.30);border-radius:14px;padding:18px 20px;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start;transition:transform .15s,box-shadow .15s}
    .ai-tip-card.unread{border-color:rgba(108,58,237,.65);box-shadow:0 0 0 1px rgba(108,58,237,.25),0 8px 24px -10px rgba(108,58,237,.35)}
    .ai-tip-card.read{opacity:.78}
    body.light .ai-tip-card,html.light .ai-tip-card{background:linear-gradient(180deg,rgba(108,58,237,.06),rgba(236,72,153,.03));border-color:rgba(108,58,237,.22)}
    .ai-tip-icon{flex-shrink:0;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;font-weight:800;font-size:1.05rem;box-shadow:0 6px 16px -8px rgba(108,58,237,.50)}
    .ai-tip-body{flex:1;min-width:0}
    .ai-tip-cat{display:inline-block;font-size:.62rem;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#a78bfa;background:rgba(108,58,237,.14);padding:3px 8px;border-radius:999px;margin-bottom:6px}
    .ai-tip-cat.suggestion{color:#34d399;background:rgba(16,185,129,.14)}
    .ai-tip-cat.idea{color:#fbbf24;background:rgba(251,191,36,.14)}
    .ai-tip-cat.warning{color:#f87171;background:rgba(239,68,68,.14)}
    .ai-tip-title{font-size:1rem;font-weight:800;color:var(--text);line-height:1.3;margin-bottom:6px}
    .ai-tip-text{color:var(--text-muted);font-size:.88rem;line-height:1.5}
    .ai-tip-actions{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ai-tip-cta{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff !important;text-decoration:none;padding:7px 14px;border-radius:8px;font-weight:700;font-size:.82rem;box-shadow:0 4px 14px -6px rgba(108,58,237,.50)}
    .ai-tip-cta:hover{filter:brightness(1.08)}
    .ai-tip-link{font-size:.78rem;color:#a78bfa;background:transparent;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;font-weight:600}
    .ai-tip-link:hover{background:rgba(108,58,237,.10)}
    .ai-tip-dismiss{position:absolute;top:10px;right:10px;background:transparent;border:none;color:var(--text-muted);width:24px;height:24px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:.55;transition:opacity .15s,background .15s}
    .ai-tip-dismiss:hover{opacity:1;background:rgba(255,255,255,.06)}
  </style>
  </head>
  <body>
    <div class="dashboard">
      ${getSidebar('notifications', req.user, req.teamPermissions)}
      ${getThemeToggle()}
      ${getBrandKitModal()}
      <main class="main-content">
        <div class="notif-page">
          <div class="notif-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
            <div>
              <h1 style="display:flex;align-items:center;gap:10px;"><img src="/images/section-icons/A-39.png" alt="" style="height:32px;width:32px;border-radius:8px"> Notifications <span id="notifUnreadBadge" class="notif-unread-badge" hidden>0</span></h1>
              <p>Personalized tips from your AI growth coach, plus reminders for your scheduled posts.</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button id="refreshTipsBtn" onclick="refreshAiTips()" style="background:transparent;border:1px solid rgba(108,58,237,.45);color:#a78bfa;padding:.55rem .9rem;border-radius:10px;font-weight:600;font-size:.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15a9 9 0 0 0 14.85 3.36L23 14"/></svg>
                Refresh tips
              </button>
              <button id="markAllReadBtn" onclick="markAllRead()" hidden style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:.55rem 1rem;border-radius:10px;font-weight:600;font-size:.85rem;cursor:pointer;box-shadow:0 4px 14px rgba(108,58,237,.30);">Mark all as read</button>
            </div>
          </div>

          <!-- AI Tips section. Loaded by loadAiTips() on page load and
               refreshed every 5 min so a freshly-generated background
               batch surfaces without a manual reload. -->
          <div id="aiTipsSection">
            <div class="notif-section-title" style="display:flex;align-items:center;gap:8px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg>
              AI Tips for You <span id="aiTipsCount" style="opacity:.7"></span>
            </div>
            <div id="aiTipsList"><div class="notif-empty"><div class="icon">✨</div><div>Generating personalized tips&hellip;</div></div></div>
          </div>

          <div id="notifList"><div class="notif-empty"><div class="icon">🔕</div><div>Loading reminders&hellip;</div></div></div>
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
          const unread = data.unread || data.due || [];
          const read = data.read || data.recent || [];
          const upcoming = data.upcoming || [];

          const badge = document.getElementById('notifUnreadBadge');
          const markBtn = document.getElementById('markAllReadBtn');
          if (unread.length > 0) {
            badge.textContent = unread.length;
            badge.removeAttribute('hidden');
            markBtn.removeAttribute('hidden');
          } else {
            badge.setAttribute('hidden', '');
            markBtn.setAttribute('hidden', '');
          }

          if (!unread.length && !upcoming.length && !read.length) {
            list.innerHTML = '<div class="notif-empty"><div class="icon"><img src="/images/section-icons/A-40.png" alt="" style="height:48px;width:48px;border-radius:10px;opacity:.6"></div><div><strong>You&rsquo;re all caught up.</strong></div><div style="margin-top:6px;font-size:.85rem">Schedule posts on the <a href="/dashboard/calendar" style="color:#a78bfa;text-decoration:none">Calendar</a> with reminders to see them here.</div></div>';
            return;
          }
          let html = '';
          if (unread.length){
            html += '<div class="notif-section-title">Unread (' + unread.length + ')</div>';
            for (const e of unread) html += renderCard(e, true);
          }
          if (upcoming.length){
            html += '<div class="notif-section-title">Upcoming (' + upcoming.length + ')</div>';
            for (const e of upcoming) html += renderCard(e, false, true);
          }
          if (read.length){
            html += '<div class="notif-section-title">Read</div>';
            for (const e of read) html += renderCard(e, false);
          }
          list.innerHTML = html;
        } catch (err) {
          list.innerHTML = '<div class="notif-empty">Could not load notifications.</div>';
        }
      }
      function fmtIn(dateStr, timeStr, reminderMins){
        try {
          const due = new Date(String(dateStr).slice(0,10) + 'T' + (timeStr || '12:00') + ':00');
          const fireAt = new Date(due.getTime() - (reminderMins||0)*60000);
          const diff = fireAt - new Date();
          if (diff <= 0) return 'soon';
          const mins = Math.round(diff/60000);
          if (mins < 60) return 'in ' + mins + ' min';
          const hrs = Math.round(mins/60);
          if (hrs < 48) return 'in ' + hrs + ' h';
          const days = Math.round(hrs/24);
          return 'in ' + days + ' d';
        } catch(_) { return ''; }
      }
      function renderCard(e, isUnread, isUpcoming){
        const dueAt = e.scheduled_date && e.scheduled_time
          ? new Date(String(e.scheduled_date).slice(0,10) + 'T' + (e.scheduled_time || '12:00') + ':00').toLocaleString()
          : '';
        const stamp = e.read_at || e.fired_at;
        const fireIn = isUpcoming ? fmtIn(e.scheduled_date, e.scheduled_time, e.reminder_minutes) : '';
        const cardClass = isUnread ? 'unseen' : (isUpcoming ? 'upcoming' : 'read');
        const icon = isUpcoming ? '\u23F0' : '\ud83d\udcc5';
        // Inline error banner — surfaces reminder-email delivery failures
        // (Resend rejected, no API key, etc.) so silent failures stop being
        // invisible. Lives inside notif-body, above the title.
        const errorBanner = e.reminder_error
          ? '<div style="background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.35);color:#fca5a5;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:0.78rem;line-height:1.4;">' +
              '<strong>Email reminder failed</strong>' +
              (e.reminder_attempts ? ' (attempt ' + escHtml(String(e.reminder_attempts)) + '/3)' : '') +
              ':\u00A0' + escHtml(String(e.reminder_error).slice(0, 200)) +
            '</div>'
          : '';
        return '<div class="notif-card ' + cardClass + '" data-id="' + escHtml(e.id) + '">' +
          '<div class="notif-icon">' + icon + '</div>' +
          '<div class="notif-body">' +
            errorBanner +
            '<div class="notif-title">' +
              (isUnread ? '<span class="unread-dot" aria-hidden="true"></span>' : '') +
              escHtml(e.title || 'Scheduled post') +
            '</div>' +
            '<div class="notif-msg">' + (isUpcoming ? 'Reminder will fire ' + escHtml(fireIn) + ' (' + escHtml(String(e.reminder_minutes||0)) + ' min before scheduled time).' : fmtMsg(e.title, e.platform)) + '</div>' +
            '<div class="notif-meta">' +
              '<span class="pill">' + escHtml(PLATFORM_LABELS[e.platform] || e.platform || 'post') + '</span>' +
              (dueAt ? '<span>Due ' + escHtml(dueAt) + '</span>' : '') +
              (isUpcoming && fireIn ? '<span>Fires ' + escHtml(fireIn) + '</span>' : '') +
              (!isUnread && !isUpcoming && stamp ? '<span>Read ' + escHtml(fmtAgo(stamp)) + '</span>' : '') +
            '</div>' +
            '<div class="notif-actions">' +
              '<a href="/dashboard/calendar">Open calendar</a>' +
              (e.analysis_id ? '<a href="/shorts?dlAnalysis=' + encodeURIComponent(e.analysis_id) + '&dlMoment=' + encodeURIComponent(e.moment_index || 0) + '">Download clip</a>' : '') +
              (isUnread ? '<button class="mark-read-btn" onclick="markOneRead(\\'' + escHtml(e.id) + '\\', this)">Mark as read</button>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }
      async function markOneRead(id, btn){
        try {
          await fetch('/notifications/api/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          await loadNotifications();
        } catch (e) { console.warn('mark-read failed', e); }
      }
      async function markAllRead(){
        const btn = document.getElementById('markAllReadBtn');
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Marking\u2026';
        try {
          await fetch('/notifications/api/mark-all-read', { method: 'POST' });
          await loadNotifications();
        } catch (e) {
          alert('Could not mark all read');
        } finally {
          btn.disabled = false; btn.textContent = orig;
        }
      }

      // ---- AI Tips ----
      const AI_CAT_ICON = { tip: '\u2728', suggestion: '\u{1F4A1}', idea: '\u{1F680}', warning: '\u26A0' };

      async function loadAiTips(){
        const list = document.getElementById('aiTipsList');
        const countEl = document.getElementById('aiTipsCount');
        try {
          const resp = await fetch('/notifications/api/ai-tips?ts=' + Date.now(), { credentials: 'same-origin' });
          const data = await resp.json();
          const tips = Array.isArray(data.tips) ? data.tips : [];
          const unread = tips.filter(function(t){ return t.status === 'unread'; });
          countEl.textContent = unread.length ? '(' + unread.length + ' new)' : '';
          if (!tips.length){
            list.innerHTML = '<div class="notif-empty"><div class="icon">\u2728</div><div><strong>Your first batch of tips is on the way.</strong></div><div style="margin-top:6px;font-size:.85rem">Connect a social account or schedule a post and refresh.</div></div>';
            return;
          }
          var html = '';
          for (var i = 0; i < tips.length; i++){
            html += renderAiTipCard(tips[i]);
          }
          list.innerHTML = html;
        } catch (e) {
          console.warn('ai tips load failed', e);
          list.innerHTML = '<div class="notif-empty">Could not load AI tips.</div>';
        }
      }

      function renderAiTipCard(t){
        var cat = String(t.category || 'tip').toLowerCase();
        var icon = AI_CAT_ICON[cat] || '\u2728';
        var unread = t.status === 'unread';
        var idEsc = escHtml(t.id);
        var actionHtml = '';
        if (t.action_url && t.action_label){
          actionHtml = '<a class="ai-tip-cta" href="' + escHtml(t.action_url) + '" onclick="markAiTipRead(\\'' + idEsc + '\\')">' + escHtml(t.action_label) + ' \u2192</a>';
        }
        var markHtml = unread ? '<button class="ai-tip-link" onclick="markAiTipRead(\\'' + idEsc + '\\', true)">Mark as read</button>' : '';
        return '<div class="ai-tip-card ' + (unread ? 'unread' : 'read') + '" data-id="' + idEsc + '">' +
          '<button class="ai-tip-dismiss" title="Dismiss" onclick="dismissAiTip(\\'' + idEsc + '\\')">\u00d7</button>' +
          '<div class="ai-tip-icon">' + icon + '</div>' +
          '<div class="ai-tip-body">' +
            '<div class="ai-tip-cat ' + escHtml(cat) + '">' + escHtml(cat) + '</div>' +
            '<div class="ai-tip-title">' + escHtml(t.title || '') + '</div>' +
            '<div class="ai-tip-text">' + escHtml(t.body || '') + '</div>' +
            '<div class="ai-tip-actions">' + actionHtml + markHtml + '</div>' +
          '</div>' +
        '</div>';
      }

      async function markAiTipRead(id, reloadAfter){
        try {
          await fetch('/notifications/api/ai-tips/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ id: id })
          });
          if (reloadAfter) await loadAiTips();
        } catch (e) { console.warn('mark-ai-tip-read failed', e); }
      }

      async function dismissAiTip(id){
        var card = document.querySelector('.ai-tip-card[data-id="' + id + '"]');
        if (card) card.style.opacity = '0.2';
        try {
          await fetch('/notifications/api/ai-tips/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ id: id })
          });
          await loadAiTips();
        } catch (e) {
          console.warn('dismiss-ai-tip failed', e);
          if (card) card.style.opacity = '';
        }
      }

      async function refreshAiTips(){
        var btn = document.getElementById('refreshTipsBtn');
        if (!btn) return;
        var orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Refreshing\u2026';
        try {
          var resp = await fetch('/notifications/api/ai-tips/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ force: true })
          });
          var data = await resp.json();
          if (data && data.generated){
            await loadAiTips();
          } else if (data && data.reason === 'throttled') {
            await loadAiTips();
            btn.innerHTML = 'Cooldown';
            setTimeout(function(){ btn.innerHTML = orig; btn.disabled = false; }, 2000);
            return;
          } else {
            await loadAiTips();
          }
        } catch (e) {
          console.warn('refresh tips failed', e);
        } finally {
          btn.innerHTML = orig;
          btn.disabled = false;
        }
      }

      loadAiTips();
      loadNotifications();
      // Reminders refresh every minute
      setInterval(loadNotifications, 60000);
      // AI tips refresh every 5 minutes (background generation finishes within seconds normally)
      setInterval(loadAiTips, 300000);
    </script>
  </body>
</html>`);
});

// API: list due/unread reminders + recently-acknowledged ones.
//   unread (= "Active reminders") = reminder_minutes > 0 AND reminder_sent = FALSE
//                                   AND time has passed AND not already published.
//                                   reminder_sent doubles as our "read" flag —
//                                   it's only flipped TRUE when the user explicitly
//                                   marks a notification read (via /api/mark-read
//                                   or /api/mark-all-read), or by visiting an entry's
//                                   download link, etc.
//   read (= "Recent") = reminder_sent = TRUE AND updated_at within 7 days.
router.get('/api/feed', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const unreadResult = await db.query(`
      SELECT * FROM calendar_entries
      WHERE user_id = $1
        AND reminder_minutes > 0
        AND reminder_sent = FALSE
        AND status != 'published'
        AND (scheduled_date::timestamp + scheduled_time::time) - (reminder_minutes || ' minutes')::interval <= NOW()
      ORDER BY scheduled_date, scheduled_time
      LIMIT 50
    `, [userId]);
    const unread = unreadResult.rows;

    const readResult = await db.query(`
      SELECT *, updated_at AS read_at FROM calendar_entries
      WHERE user_id = $1
        AND reminder_minutes > 0
        AND reminder_sent = TRUE
        AND updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY updated_at DESC
      LIMIT 20
    `, [userId]);
    const read = readResult.rows;

    // Upcoming = reminder set, not yet fired, reminder window still in the future.
    // Lets the user see immediate confirmation that their reminder is queued even
    // when the actual notification time is hours or days away.
    const upcomingResult = await db.query(`
      SELECT * FROM calendar_entries
      WHERE user_id = $1
        AND reminder_minutes > 0
        AND reminder_sent = FALSE
        AND status != 'published'
        AND (scheduled_date::timestamp + scheduled_time::time) - (reminder_minutes || ' minutes')::interval > NOW()
      ORDER BY scheduled_date, scheduled_time
      LIMIT 50
    `, [userId]);
    const upcoming = upcomingResult.rows;

    // Backward-compat: keep legacy keys (due/recent) so older clients don't break,
    // and add the new (unread/read/upcoming) names for clarity.
    res.json({ due: unread, recent: read, unread, read, upcoming });
  } catch (error) {
    console.error('Notifications feed error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// API: mark a single notification read
router.post('/api/mark-read', requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const db = getDb();
    const r = await db.query(
      `UPDATE calendar_entries SET reminder_sent = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user.id]
    );
    res.json({ success: true, marked: r.rowCount });
  } catch (error) {
    console.error('Mark-read error:', error);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// API: mark all unread notifications as read
router.post('/api/mark-all-read', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const r = await db.query(
      `UPDATE calendar_entries SET reminder_sent = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
         AND reminder_minutes > 0
         AND reminder_sent = FALSE
         AND status != 'published'
         AND (scheduled_date::timestamp + scheduled_time::time) - (reminder_minutes || ' minutes')::interval <= NOW()
       RETURNING id`,
      [req.user.id]
    );
    res.json({ success: true, marked: r.rowCount });
  } catch (error) {
    console.error('Mark-all-read error:', error);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// API: pending count (used for sidebar badge). Combines calendar
// reminders that are due-and-unread with unread AI-tip notifications,
// so the sidebar bell reflects EVERY actionable item on /notifications.
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
    const reminderCount = parseInt(result.rows[0].c, 10) || 0;

    let aiTipCount = 0;
    try {
      const { aiNotificationOps } = require('../db/database');
      if (aiNotificationOps && aiNotificationOps.countUnread) {
        aiTipCount = await aiNotificationOps.countUnread(req.user.id);
      }
    } catch (_) {}

    res.json({
      count: reminderCount + aiTipCount,
      breakdown: { reminders: reminderCount, aiTips: aiTipCount }
    });
  } catch (error) {
    console.error('Notifications count error:', error);
    res.status(500).json({ count: 0 });
  }
});

// ---------------------------------------------------------------------
// AI tips (personalized growth suggestions surfaced on /notifications
// and the Dashboard banner). Backed by ai_notifications + services/
// aiTipGenerator.js.
//
// On every GET /api/ai-tips we kick off ensureFreshTips() in the
// background — it self-throttles to 1 batch per 24h per user, so this
// is cheap and idempotent. The response only reflects what's already
// in the DB; the freshly-generated batch (if any) shows up on the
// next request once the background job finishes.
// ---------------------------------------------------------------------

let _aiNotificationOps, _aiTipGen;
try {
  const db = require('../db/database');
  _aiNotificationOps = db.aiNotificationOps;
} catch (_) {}
try { _aiTipGen = require('../services/aiTipGenerator'); } catch (_) {}

router.get('/api/ai-tips', requireAuth, async (req, res) => {
  try {
    if (!_aiNotificationOps) return res.json({ tips: [], generated: false });
    const tips = await _aiNotificationOps.listActive(req.user.id, { limit: 25 });

    // If the user has zero active tips, generate synchronously so they
    // see something on first load. Otherwise refresh in the background
    // and let the throttle decide.
    let generated = null;
    if (_aiTipGen) {
      if (!tips.length) {
        generated = await _aiTipGen.ensureFreshTips(req.user.id, { force: false });
        if (generated && generated.generated) {
          const fresh = await _aiNotificationOps.listActive(req.user.id, { limit: 25 });
          return res.json({ tips: fresh, generated: true });
        }
      } else {
        // Fire-and-forget background refresh (still throttled).
        setImmediate(() => {
          try { _aiTipGen.ensureFreshTips(req.user.id).catch(() => {}); }
          catch (_) {}
        });
      }
    }
    res.json({ tips, generated: !!(generated && generated.generated) });
  } catch (e) {
    console.error('AI tips list error:', e);
    res.status(500).json({ tips: [], error: 'Failed to load AI tips' });
  }
});

router.post('/api/ai-tips/refresh', requireAuth, async (req, res) => {
  try {
    if (!_aiTipGen) return res.status(503).json({ error: 'Generator unavailable' });
    const result = await _aiTipGen.ensureFreshTips(req.user.id, { force: !!(req.body && req.body.force) });
    res.json(result);
  } catch (e) {
    console.error('AI tips refresh error:', e);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

router.post('/api/ai-tips/mark-read', requireAuth, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!_aiNotificationOps) return res.status(503).json({ error: 'Ops unavailable' });
    const marked = await _aiNotificationOps.markRead(id, req.user.id);
    res.json({ success: true, marked });
  } catch (e) {
    console.error('AI tips mark-read error:', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/api/ai-tips/mark-all-read', requireAuth, async (req, res) => {
  try {
    if (!_aiNotificationOps) return res.status(503).json({ error: 'Ops unavailable' });
    const marked = await _aiNotificationOps.markAllRead(req.user.id);
    res.json({ success: true, marked });
  } catch (e) {
    console.error('AI tips mark-all-read error:', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/api/ai-tips/dismiss', requireAuth, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!_aiNotificationOps) return res.status(503).json({ error: 'Ops unavailable' });
    const marked = await _aiNotificationOps.dismiss(id, req.user.id);
    res.json({ success: true, marked });
  } catch (e) {
    console.error('AI tips dismiss error:', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
