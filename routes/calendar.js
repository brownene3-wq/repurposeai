const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { calendarOps, outputOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, (req, res) => {
  res.send(`${getHeadHTML('Calendar')}
  <style>
    ${getBaseCSS()}
    .calendar-page{padding:32px}
    .cal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;gap:16px;flex-wrap:wrap}
    .cal-header h1{font-size:1.8rem;font-weight:800;margin:0;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .cal-header p{color:var(--text-muted);font-size:.9rem;margin:.4rem 0 0}
    .cal-nav{display:flex;align-items:center;gap:10px}
    .cal-nav button{background:var(--surface);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;cursor:pointer;font-size:14px}
    .cal-nav button:hover{border-color:#6C3AED;color:#a78bfa}
    .cal-nav .month-label{font-weight:700;font-size:1.1rem;min-width:200px;text-align:center}
    .cal-actions{display:flex;gap:10px}
    .add-entry-btn{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:.55rem 1rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
    .add-entry-btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(108,58,237,0.35)}
    .cal-grid-wrap{background:var(--surface);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:auto;max-height:calc(100vh - 220px);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    .cal-grid-wrap::-webkit-scrollbar{width:6px;height:6px}
    .cal-grid-wrap::-webkit-scrollbar-track{background:transparent}
    .cal-grid-wrap::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    .cal-grid-wrap::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    .cal-grid-wrap::-webkit-scrollbar-corner{background:transparent}
    body.light .cal-grid-wrap,html.light .cal-grid-wrap{scrollbar-color:rgba(0,0,0,0.15) transparent}
    body.light .cal-grid-wrap::-webkit-scrollbar-thumb,html.light .cal-grid-wrap::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15)}
    body.light .cal-grid-wrap::-webkit-scrollbar-thumb:hover,html.light .cal-grid-wrap::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.30)}
    body.light .cal-grid-wrap,html.light .cal-grid-wrap{border-color:rgba(0,0,0,0.06)}
    .cal-board{display:grid;grid-template-columns:1fr 260px;gap:18px;align-items:stretch}
    @media(max-width:960px){.cal-board{grid-template-columns:1fr}}
    .cal-grid-wrap{display:block}
    .cal-legend{display:flex;flex-direction:column;gap:8px;padding:16px;background:var(--surface);border:1px solid rgba(255,255,255,0.06);border-radius:14px;align-self:stretch}
    body.light .cal-legend,html.light .cal-legend{border-color:rgba(0,0,0,0.06)}
    .cal-legend-label{font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin:0 0 4px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.06)}
    body.light .cal-legend-label,html.light .cal-legend-label{border-bottom-color:rgba(0,0,0,0.06)}
    .legend-chip{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;font-size:.85rem;font-weight:600;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);transition:opacity .15s,transform .15s,background .15s,border-color .15s;color:var(--text);cursor:pointer;user-select:none;width:100%;box-sizing:border-box}
    .legend-chip:hover{background:rgba(255,255,255,0.08);border-color:rgba(108,58,237,0.30);transform:translateX(2px)}
    body.light .legend-chip,html.light .legend-chip{background:rgba(0,0,0,0.03);border-color:rgba(0,0,0,0.06)}
    body.light .legend-chip:hover,html.light .legend-chip:hover{background:rgba(0,0,0,0.05);border-color:rgba(108,58,237,0.30)}
    .legend-chip .legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,0.05)}
    .legend-chip .legend-emoji{font-size:.95rem}
    .legend-svg svg,.cal-entry-svg svg{width:100%;height:100%;display:block}
    .legend-chip .legend-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .legend-chip .legend-count{margin-left:auto;font-size:.75rem;font-weight:700;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,0.08);color:var(--text);min-width:24px;text-align:center}
    body.light .legend-chip .legend-count,html.light .legend-chip .legend-count{background:rgba(0,0,0,0.06)}
    .legend-chip.empty{opacity:0.45}
    .legend-chip.empty .legend-count{background:transparent;color:var(--text-dim)}
    .legend-chip.active{background:linear-gradient(135deg,rgba(108,58,237,0.25),rgba(236,72,153,0.18));border-color:#6C3AED;box-shadow:0 0 0 1px rgba(108,58,237,0.40),0 4px 14px rgba(108,58,237,0.18);color:#fff;opacity:1}
    .legend-chip.active .legend-count{background:rgba(108,58,237,0.35);color:#fff}
    .legend-chip.dimmed{opacity:0.30}
    .legend-clear{margin-top:auto;font-size:.78rem;font-weight:600;color:#a78bfa;cursor:pointer;padding:9px 12px;border-radius:10px;background:rgba(108,58,237,0.06);border:1px solid rgba(108,58,237,0.20);transition:background .15s,border-color .15s;text-align:center;width:100%;box-sizing:border-box}
    .legend-clear:hover{background:rgba(108,58,237,0.14);border-color:rgba(108,58,237,0.40)}
    .legend-clear[hidden]{display:none}
    .cal-day-headers{display:grid;grid-template-columns:repeat(7,minmax(100px,1fr));min-width:700px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);position:sticky;top:0;z-index:1}
    body.light .cal-day-headers,html.light .cal-day-headers{background:rgba(0,0,0,0.02);border-bottom-color:rgba(0,0,0,0.06)}
    .cal-day-header{padding:10px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    .cal-grid{display:grid;grid-template-columns:repeat(7,minmax(100px,1fr));min-width:700px;gap:1px;background:rgba(255,255,255,0.04)}
    body.light .cal-grid,html.light .cal-grid{background:rgba(0,0,0,0.05)}
    .cal-cell{background:var(--dark-2);min-height:110px;padding:8px;cursor:pointer;transition:background .15s;display:flex;flex-direction:column;gap:4px}
    .cal-cell:hover{background:rgba(108,58,237,0.06)}
    .cal-cell.empty{background:rgba(255,255,255,0.02);cursor:default}
    body.light .cal-cell.empty,html.light .cal-cell.empty{background:rgba(0,0,0,0.02)}
    .cal-cell.today{background:rgba(108,58,237,0.10);border-top:2px solid #6C3AED;padding-top:6px}
    .cal-cell-date{font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:2px}
    .cal-cell.today .cal-cell-date{color:#a78bfa}
    .cal-entry{font-size:11px;padding:3px 6px;border-radius:5px;color:#fff;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;display:flex;align-items:center;gap:4px}
    .cal-entry:hover{filter:brightness(1.15)}
    .cal-cell-overflow{font-size:10px;color:var(--text-muted);font-weight:600;margin-top:2px}
    .cal-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center;padding:20px}
    .cal-modal-overlay.show{display:flex}
    .cal-modal{background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto}
    body.light .cal-modal,html.light .cal-modal{border-color:rgba(0,0,0,0.08)}
    .cal-modal h3{margin:0 0 4px;font-size:1.1rem}
    .cal-modal .modal-sub{color:var(--text-muted);font-size:.82rem;margin-bottom:20px}
    .cal-modal label{display:block;font-size:.75rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:.03em}
    .cal-modal input,.cal-modal select,.cal-modal textarea{width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:.85rem;font-family:inherit;outline:none;margin-bottom:14px}
    body.light .cal-modal input,body.light .cal-modal select,body.light .cal-modal textarea,html.light .cal-modal input,html.light .cal-modal select,html.light .cal-modal textarea{background:var(--dark-2);border-color:rgba(0,0,0,0.1)}
    .cal-modal input:focus,.cal-modal select:focus,.cal-modal textarea:focus{border-color:#6C3AED}
    .cal-modal textarea{resize:vertical;min-height:70px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    .cal-modal textarea::-webkit-scrollbar{width:6px}
    .cal-modal textarea::-webkit-scrollbar-track{background:transparent}
    .cal-modal textarea::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    .cal-modal textarea::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    body.light .cal-modal textarea,html.light .cal-modal textarea{scrollbar-color:rgba(0,0,0,0.15) transparent}
    body.light .cal-modal textarea::-webkit-scrollbar-thumb,html.light .cal-modal textarea::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15)}
    .cal-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .cal-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap}
    .btn-secondary{background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:.5rem 1rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer}
    .btn-secondary:hover{border-color:#6C3AED;color:#a78bfa}
    .btn-danger{background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#ef4444;padding:.5rem 1rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;margin-right:auto}
    .btn-danger:hover{background:rgba(239,68,68,0.18)}
    .btn-save{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer}
    .btn-save:hover{transform:translateY(-1px)}
    .cal-toast{position:fixed;bottom:24px;right:24px;background:var(--surface);border:1px solid rgba(108,58,237,0.4);color:var(--text);padding:12px 18px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.4);font-size:.85rem;z-index:9999;display:none}
    .cal-toast.show{display:block}
  </style>
  </head>
  <body>
    <div class="dashboard">
      ${getSidebar('calendar', req.user, req.teamPermissions)}
      ${getThemeToggle()}
      <main class="main-content">
        <div class="calendar-page">
          <div class="cal-header">
            <div>
              <h1><img src="/images/dashboard-icons/calendar.png?v=2" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;display:inline-block">Content Calendar</h1>
              <p>Plan your posts across platforms — click any day to schedule.</p>
            </div>
            <div class="cal-nav">
              <button onclick="changeMonth(-1)" title="Previous month">‹</button>
              <div class="month-label" id="monthLabel">—</div>
              <button onclick="changeMonth(1)" title="Next month">›</button>
              <button onclick="goToToday()" title="Today" style="width:auto;padding:0 12px;font-weight:600">Today</button>
            </div>
            <div class="cal-actions">
              <button class="add-entry-btn" onclick="openCreate()">+ Add Entry</button>
            </div>
          </div>
          <div class="cal-board">
            <div class="cal-grid-wrap">
              <div class="cal-day-headers">
                <div class="cal-day-header">Sun</div>
                <div class="cal-day-header">Mon</div>
                <div class="cal-day-header">Tue</div>
                <div class="cal-day-header">Wed</div>
                <div class="cal-day-header">Thu</div>
                <div class="cal-day-header">Fri</div>
                <div class="cal-day-header">Sat</div>
              </div>
              <div class="cal-grid" id="calGrid"></div>
            </div>
            <aside class="cal-legend" id="calLegend" aria-label="Platforms scheduled this month"></aside>
          </div>
        </div>
      </main>
    </div>
    <div class="cal-modal-overlay" id="entryModal" onclick="if(event.target===this)closeModal()">
      <div class="cal-modal">
        <h3 id="modalTitle">New Entry</h3>
        <div class="modal-sub" id="modalDate">—</div>
        <input type="hidden" id="entryId">
        <label>Title</label>
        <input type="text" id="entryTitleInput" placeholder="e.g. Launch announcement" maxlength="120">
        <div class="cal-row">
          <div>
            <label>Platform</label>
            <select id="entryPlatform">
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="shorts">YouTube Shorts</option>
              <option value="youtube">YouTube</option>
              <option value="twitter">Twitter / X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="facebook">Facebook</option>
              <option value="blog">Blog Post</option>
              <option value="newsletter">Newsletter</option>
            </select>
          </div>
          <div>
            <label>Status</label>
            <select id="entryStatus">
              <option value="planned">Planned</option>
              <option value="drafted">Drafted</option>
              <option value="ready">Ready</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
        <div class="cal-row">
          <div>
            <label>Date</label>
            <input type="date" id="entryDate">
          </div>
          <div>
            <label>Time</label>
            <input type="time" id="entryTime">
          </div>
        </div>
        <button type="button" id="peakTimeBtn" onclick="suggestPeakTime()" style="display:flex;align-items:center;gap:8px;width:100%;background:linear-gradient(135deg,rgba(108,58,237,0.10),rgba(236,72,153,0.06));border:1px solid rgba(108,58,237,0.30);border-radius:8px;padding:10px 12px;color:#a78bfa;cursor:pointer;font-family:inherit;font-size:0.82rem;font-weight:600;margin-bottom:14px;transition:all .15s">
          <span style="font-size:1em;">✨</span> Suggest peak time for this platform
          <span id="peakTimeHint" style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:auto;text-align:right;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </button>
        <label>Notification</label>
        <select id="entryReminder">
          <option value="0">None</option>
          <option value="15">15 minutes before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
          <option value="2880">2 days before</option>
        </select>
        <label>Notes</label>
        <textarea id="entryNotes" placeholder="Hook ideas, hashtags, links..."></textarea>
        <div id="clipDlBlock" style="display:none;background:rgba(108,58,237,0.08);border:1px solid rgba(108,58,237,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:none;">
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">From Smart Shorts</div>
          <a id="clipDlLink" href="#" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;color:#a78bfa;text-decoration:none;font-weight:600;font-size:.85rem;">
            <span style="font-size:1.1em;">▶</span> Show Clip
          </a>
          <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px;">Opens Smart Shorts to this clip so you can preview and download it.</div>
        </div>
        <div class="cal-modal-actions">
          <button class="btn-danger" id="deleteBtn" onclick="deleteEntry()" style="display:none">Delete</button>
          <button class="btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn-save" id="saveBtn" onclick="saveEntry()">Save</button>
        </div>
      </div>
    </div>
    <div class="cal-toast" id="toast"></div>
    <script>
      ${getThemeScript()}
      const PLATFORM_META = {
        tiktok:    { color:'#25F4EE', label:'TikTok',    svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .56.04.81.1v-3.5a6.37 6.37 0 0 0-.81-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.82a4.83 4.83 0 0 1-1-.13z"/></svg>' },
        instagram: { color:'#E4405F', label:'Instagram', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
        shorts:    { color:'#FF0000', label:'YT Shorts', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-1 2.53-3.37 1.53-5.36C18.78 2.22 17.39 1.4 15.92 1.4c-.61 0-1.23.14-1.81.45L4 7.4c-1.84 1-2.53 3.37-1.53 5.36.7 1.39 2.07 2.22 3.55 2.22h.04l-.65.36c-1.84 1.03-2.53 3.4-1.5 5.36.7 1.39 2.07 2.22 3.54 2.22.61 0 1.23-.14 1.81-.45l11-6c1.84-1 2.53-3.37 1.53-5.36-.5-1.04-1.31-1.69-2.32-1.99zM10 15.04V8.82l5.5 3.13L10 15.04z"/></svg>' },
        youtube:   { color:'#FF0000', label:'YouTube',   svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
        twitter:   { color:'#000000', label:'X',         svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
        linkedin:  { color:'#0A66C2', label:'LinkedIn',  svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
        facebook:  { color:'#1877F2', label:'Facebook',  svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
        blog:      { color:'#10B981', label:'Blog',      svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>' },
        newsletter:{ color:'#F59E0B', label:'Newsletter',svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>' }
      };
      let calMonth=new Date().getMonth();
      let calYear=new Date().getFullYear();
      let entries=[];
      // Active platform filter — Set of platform keys. Empty = no filter (show all).
      let activeFilters = new Set();
      function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
      function rangeForMonth(){
        return {start:ymd(new Date(calYear,calMonth,1)),end:ymd(new Date(calYear,calMonth+1,0))};
      }
      async function loadEntries(){
        const r=rangeForMonth();
        try {
          const resp=await fetch('/dashboard/calendar/api/entries?start='+r.start+'&end='+r.end);
          const data=await resp.json();
          entries=Array.isArray(data.entries)?data.entries:[];
        } catch(e){entries=[];}
        renderGrid();
      }
      async function suggestPeakTime(){
        var btn = document.getElementById('peakTimeBtn');
        var hint = document.getElementById('peakTimeHint');
        var platform = document.getElementById('entryPlatform').value;
        var orig = hint.textContent;
        hint.textContent = 'Thinking…';
        btn.disabled = true;
        try {
          var resp = await fetch('/dashboard/calendar/api/peak-time?platform=' + encodeURIComponent(platform));
          if (!resp.ok) throw new Error('Failed');
          var d = await resp.json();
          if (d.date) document.getElementById('entryDate').value = d.date;
          if (d.time) document.getElementById('entryTime').value = d.time;
          hint.textContent = d.reasoning ? (d.date + ' · ' + d.time) : '';
          showToast(d.reasoning || ('Peak time set: ' + d.date + ' ' + d.time));
        } catch (e) {
          hint.textContent = orig;
          showToast('Peak time unavailable');
        } finally {
          btn.disabled = false;
        }
      }
      function changeMonth(delta){
        calMonth+=delta;
        if(calMonth>11){calMonth=0;calYear++;}
        if(calMonth<0){calMonth=11;calYear--;}
        loadEntries();
      }
      function goToToday(){
        const t=new Date();
        calMonth=t.getMonth();calYear=t.getFullYear();
        loadEntries();
      }
      function renderLegend(byDate){
        const counts={};
        Object.keys(PLATFORM_META).forEach(k=>counts[k]=0);
        for(const dateKey in byDate){
          for(const e of byDate[dateKey]){
            if(counts.hasOwnProperty(e.platform))counts[e.platform]++;
          }
        }
        const order=['tiktok','instagram','shorts','youtube','twitter','linkedin','facebook','blog','newsletter'];
        const filterActive = activeFilters.size > 0;
        let html='<div class="cal-legend-label">Platforms</div>';
        for(const k of order){
          const m=PLATFORM_META[k];
          const c=counts[k]||0;
          const empty=c===0?' empty':'';
          const isOn = activeFilters.has(k);
          const klass = 'legend-chip' + empty + (isOn ? ' active' : '') + (filterActive && !isOn ? ' dimmed' : '');
          const titleAttr=isOn?('Filtering by ' + m.label + ' — click to clear'):(c===0?('Click to filter by ' + m.label):('Click to filter by ' + m.label + ' (' + c + ' scheduled)'));
          html+='<button type="button" class="'+klass+'" data-platform="'+k+'" onclick="togglePlatformFilter(\\''+k+'\\')" title="'+titleAttr+'" style="font-family:inherit;text-align:left;">';
          html+='<span class="legend-dot" style="background:'+m.color+'"></span>';
          html+='<span class="legend-svg" style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:'+m.color+';flex-shrink:0;" aria-hidden="true">'+(m.svg||'')+'</span>';
          html+='<span class="legend-name">'+m.label+'</span>';
          html+='<span class="legend-count">'+c+'</span>';
          html+='</button>';
        }
        html += '<button class="legend-clear" onclick="clearPlatformFilters()"' + (filterActive ? '' : ' hidden') + '>Clear filters</button>';
        document.getElementById('calLegend').innerHTML=html;
      }
      function togglePlatformFilter(platform){
        if (activeFilters.has(platform)) activeFilters.delete(platform);
        else activeFilters.add(platform);
        renderGrid();
      }
      function clearPlatformFilters(){
        activeFilters.clear();
        renderGrid();
      }

      function renderGrid(){
        const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
        document.getElementById('monthLabel').textContent=months[calMonth]+' '+calYear;
        const firstDay=new Date(calYear,calMonth,1).getDay();
        const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
        const todayStr=ymd(new Date());
        const byDate={};
        const allByDate={};
        for(const e of entries){
          const k=e.scheduled_date?String(e.scheduled_date).slice(0,10):null;
          if(!k)continue;
          (allByDate[k]=allByDate[k]||[]).push(e);
          // Filter: if filters are active, only include matching platforms
          if(activeFilters.size > 0 && !activeFilters.has(e.platform)) continue;
          (byDate[k]=byDate[k]||[]).push(e);
        }
        let html='';
        for(let i=0;i<firstDay;i++)html+='<div class="cal-cell empty"></div>';
        for(let d=1;d<=daysInMonth;d++){
          const dateStr=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
          const dayEntries=byDate[dateStr]||[];
          const isToday=dateStr===todayStr;
          html+='<div class="cal-cell'+(isToday?' today':'')+'" onclick="onCellClick(\\''+dateStr+'\\',event)">';
          html+='<div class="cal-cell-date">'+d+'</div>';
          dayEntries.slice(0,3).forEach(e=>{
            const meta=PLATFORM_META[e.platform]||{color:e.color||'#6c5ce7',svg:'',label:e.platform};
            const titleEsc=String(e.title||'Untitled').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
            html+='<div class="cal-entry" style="background:'+meta.color+'" onclick="event.stopPropagation();editEntry(\\''+e.id+'\\')" title="'+titleEsc+'">';
            html+='<span class="cal-entry-svg" aria-hidden="true" style="width:11px;height:11px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;">'+(meta.svg||'')+'</span>'+titleEsc;
            html+='</div>';
          });
          if(dayEntries.length>3)html+='<div class="cal-cell-overflow">+'+(dayEntries.length-3)+' more</div>';
          html+='</div>';
        }
        document.getElementById('calGrid').innerHTML=html;
        renderLegend(allByDate);
      }
      function onCellClick(dateStr){openCreate(dateStr);}
      function openCreate(dateStr){
        if(!dateStr)dateStr=ymd(new Date());
        document.getElementById('modalTitle').textContent='New Entry';
        document.getElementById('modalDate').textContent=formatDateLabel(dateStr);
        document.getElementById('entryId').value='';
        document.getElementById('entryTitleInput').value='';
        document.getElementById('entryPlatform').value='tiktok';
        document.getElementById('entryStatus').value='planned';
        document.getElementById('entryDate').value=dateStr;
        document.getElementById('entryTime').value='12:00';
        document.getElementById('entryNotes').value='';
        document.getElementById('entryReminder').value='0';
        var dl=document.getElementById('clipDlBlock'); if(dl) dl.style.display='none';
        document.getElementById('deleteBtn').style.display='none';
        document.getElementById('saveBtn').textContent='Save';
        document.getElementById('entryModal').classList.add('show');
        document.getElementById('entryTitleInput').focus();
      }
      function editEntry(id){
        const e=entries.find(x=>String(x.id)===String(id));
        if(!e)return;
        document.getElementById('modalTitle').textContent='Edit Entry';
        document.getElementById('modalDate').textContent=formatDateLabel(String(e.scheduled_date).slice(0,10));
        document.getElementById('entryId').value=e.id;
        document.getElementById('entryTitleInput').value=e.title||'';
        document.getElementById('entryPlatform').value=e.platform||'tiktok';
        document.getElementById('entryStatus').value=e.status||'planned';
        document.getElementById('entryDate').value=String(e.scheduled_date).slice(0,10);
        document.getElementById('entryTime').value=(e.scheduled_time||'12:00').slice(0,5);
        document.getElementById('entryNotes').value=e.notes||'';
        document.getElementById('entryReminder').value=String(e.reminder_minutes||0);
        // Show clip link when this entry came from a Smart Shorts moment
        var dl = document.getElementById('clipDlBlock');
        if(e.analysis_id && (e.moment_index !== null && e.moment_index !== undefined)){
          dl.style.display='block';
          var url='/shorts?dlAnalysis='+encodeURIComponent(e.analysis_id)+'&dlMoment='+encodeURIComponent(e.moment_index);
          document.getElementById('clipDlLink').href=url;
        } else {
          dl.style.display='none';
        }
        document.getElementById('deleteBtn').style.display='inline-block';
        document.getElementById('saveBtn').textContent='Update';
        document.getElementById('entryModal').classList.add('show');
      }
      function closeModal(){document.getElementById('entryModal').classList.remove('show');}
      function formatDateLabel(s){
        const [y,m,d]=s.split('-').map(Number);
        return new Date(y,m-1,d).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
      }
      async function saveEntry(){
        const id=document.getElementById('entryId').value;
        const payload={
          title:document.getElementById('entryTitleInput').value.trim(),
          platform:document.getElementById('entryPlatform').value,
          status:document.getElementById('entryStatus').value,
          scheduledDate:document.getElementById('entryDate').value,
          scheduledTime:document.getElementById('entryTime').value||'12:00',
          notes:document.getElementById('entryNotes').value,
          reminderMinutes:parseInt(document.getElementById('entryReminder').value||'0',10)||0
        };
        if(!payload.title){showToast('Title is required');return;}
        if(!payload.scheduledDate){showToast('Date is required');return;}
        try {
          const resp=await fetch('/dashboard/calendar/api/entries'+(id?'/'+id:''),{
            method:id?'PUT':'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
          });
          if(!resp.ok){const err=await resp.json().catch(()=>({}));throw new Error(err.error||'Save failed');}
          closeModal();
          showToast(id?'Entry updated':'Entry created');
          await loadEntries();
        } catch(e){showToast(e.message);}
      }
      async function deleteEntry(){
        const id=document.getElementById('entryId').value;
        if(!id)return;
        if(!confirm('Delete this entry?'))return;
        try {
          const resp=await fetch('/dashboard/calendar/api/entries/'+id,{method:'DELETE'});
          if(!resp.ok)throw new Error('Delete failed');
          closeModal();
          showToast('Entry deleted');
          await loadEntries();
        } catch(e){showToast(e.message);}
      }
      function showToast(msg){
        const t=document.getElementById('toast');
        t.textContent=msg;t.classList.add('show');
        setTimeout(()=>t.classList.remove('show'),2200);
      }
      document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
      loadEntries();
    </script>
  </body>
</html>`);
});

router.get('/api/entries', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required (YYYY-MM-DD)' });
    const entries = await calendarOps.getByUserId(req.user.id, start, end);
    res.json({ entries });
  } catch (error) {
    console.error('Calendar list error:', error);
    res.status(500).json({ error: 'Failed to load entries' });
  }
});

router.post('/api/entries', requireAuth, async (req, res) => {
  try {
    const entry = await calendarOps.create({
      userId: req.user.id,
      title: req.body.title,
      platform: req.body.platform,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime,
      status: req.body.status,
      contentText: req.body.contentText || '',
      notes: req.body.notes || '',
      color: req.body.color,
      analysisId: req.body.analysisId || null,
      momentIndex: req.body.momentIndex != null ? req.body.momentIndex : null,
      reminderMinutes: parseInt(req.body.reminderMinutes, 10) || 0
    });
    res.json({ entry });
  } catch (error) {
    console.error('Calendar create error:', error);
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

router.put('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    const entry = await calendarOps.update(req.params.id, req.user.id, {
      title: req.body.title,
      platform: req.body.platform,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime,
      status: req.body.status,
      contentText: req.body.contentText,
      notes: req.body.notes,
      color: req.body.color,
      reminderMinutes: parseInt(req.body.reminderMinutes, 10) || 0
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry });
  } catch (error) {
    console.error('Calendar update error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

router.delete('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    await calendarOps.delete(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

router.get('/api/data', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const outputs = await outputOps.getByUserId(userId, 500, 0);
    const calendarData = {};
    for (const output of outputs) {
      const date = new Date(output.created_at);
      const dateKey = date.toISOString().split('T')[0];
      if (!calendarData[dateKey]) calendarData[dateKey] = [];
      const platform = output.platform || 'Unknown';
      if (!calendarData[dateKey].includes(platform)) calendarData[dateKey].push(platform);
    }
    res.json(calendarData);
  } catch (error) {
    console.error('Calendar data error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});


// API: AI-powered peak-time suggestion. Uses platform-specific industry
// posting-windows research; returns the next occurrence of the recommended
// day+time as YYYY-MM-DD / HH:MM in the user's local time. Optionally future:
// enrich with content themes via OpenAI.
router.get('/api/peak-time', requireAuth, (req, res) => {
  try {
    const platform = String(req.query.platform || 'tiktok').toLowerCase();
    const recommendations = {
      tiktok:    { days: [2,4],     hour: 19, label: 'TikTok engagement peaks Tue & Thu evenings around 7 PM, when scrollers are most active.' },
      instagram: { days: [3],       hour: 11, label: 'Instagram traffic peaks midweek mornings — Wednesday at 11 AM converts feed and Reels well.' },
      shorts:    { days: [6],       hour: 10, label: 'YouTube Shorts surges Saturday mornings; 10 AM catches global weekend viewers.' },
      youtube:   { days: [6],       hour: 9,  label: 'YouTube long-form lands best Saturday 9 AM, riding the weekend search spike.' },
      twitter:   { days: [3,5],     hour: 9,  label: 'Twitter / X engagement peaks Wed & Fri at 9 AM during commute and morning scrolls.' },
      linkedin:  { days: [2,3,4],   hour: 8,  label: 'LinkedIn rewards Tue / Wed / Thu at 8 AM — professionals catching up before their day starts.' },
      facebook:  { days: [3],       hour: 13, label: 'Facebook lunch-break window: Wednesday at 1 PM gets the highest reach.' },
      blog:      { days: [3],       hour: 10, label: 'Blog posts perform best Wed at 10 AM — search and newsletter funnels both spike.' },
      newsletter:{ days: [2],       hour: 10, label: 'Newsletters open rates peak Tue at 10 AM, after Monday inbox cleanup.' }
    };
    const rec = recommendations[platform] || recommendations.tiktok;
    // Find the next occurrence of any preferred day at the given hour
    const now = new Date();
    let best = null;
    for (let offset = 0; offset < 14; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      d.setHours(rec.hour, 0, 0, 0);
      if (rec.days.includes(d.getDay()) && d.getTime() > now.getTime()) {
        best = d;
        break;
      }
    }
    if (!best) {
      best = new Date(now);
      best.setDate(now.getDate() + 1);
      best.setHours(rec.hour, 0, 0, 0);
    }
    const yyyy = best.getFullYear();
    const mm = String(best.getMonth() + 1).padStart(2, '0');
    const dd = String(best.getDate()).padStart(2, '0');
    const hh = String(best.getHours()).padStart(2, '0');
    const mi = String(best.getMinutes()).padStart(2, '0');
    res.json({
      platform,
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${mi}`,
      reasoning: rec.label
    });
  } catch (error) {
    console.error('Peak-time error:', error);
    res.status(500).json({ error: 'Failed to compute peak time' });
  }
});

module.exports = router;
