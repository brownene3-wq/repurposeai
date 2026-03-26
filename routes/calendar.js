const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { contentOps, outputOps } = require('../db/database');

// GET - Content calendar page
router.get('/', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
      <meta http-equiv="Pragma" content="no-cache">
      <meta http-equiv="Expires" content="0">
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
      <title>Content Calendar - Content Repurpose SaaS</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0a0a;
          color: #e0e0e0;
          transition: background 0.3s, color 0.3s;
        }

        body.light {
          background: #f5f5f5;
          color: #1a1a1a;
        }

        .container {
          display: flex;
          min-height: 100vh;
        }

        .sidebar {
          width: 250px;
          background: #111;
          border-right: 1px solid #222;
          padding: 20px 0;
          position: fixed;
          height: 100vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }

        .sidebar .logo {
          font-size: 1.4em;
          font-weight: 700;
          color: #fff;
        }

        .sidebar .logo span {
          color: #6c5ce7;
        }

        .sidebar a {
          display: block;
          padding: 12px 20px;
          color: #888;
          text-decoration: none;
          transition: all 0.2s;
          border-left: 3px solid transparent;
        }

        .sidebar a:not(.logo):hover {
          color: #fff;
          background: rgba(108,92,231,0.1);
        }

        .sidebar a.active {
          color: #6c5ce7;
          background: rgba(108,92,231,0.1);
          border-left-color: #6c5ce7;
        }

        .theme-toggle {
          background: #222;
          border: 1px solid #333;
          color: #fff;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 1em;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          position: fixed;
          top: 1.2rem;
          right: 1.5rem;
          z-index: 100;
        }

        body.light .sidebar {
          background: #f8f8f8;
          border-color: #e0e0e0;
        }

        body.light .sidebar a {
          color: #666;
        }

        body.light .sidebar a.active {
          color: #6c5ce7;
          background: rgba(108,92,231,0.08);
        }

        body.light .theme-toggle {
          background: #fff;
          border-color: #ddd;
        }

        .main-content {
          margin-left: 250px;
          flex: 1;
          padding: 40px;
        }

        .header {
          margin-bottom: 40px;
        }

        .header h1 {
          font-size: 32px;
          margin-bottom: 10px;
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header p {
          color: #888;
          font-size: 16px;
        }

        body.light .header p {
          color: #999;
        }

        .calendar-wrapper {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 30px;
          max-width: 1400px;
        }

        .calendar-section {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 30px;
          backdrop-filter: blur(10px);
        }

        body.light .calendar-section {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .calendar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 30px;
        }

        .calendar-header h2 {
          font-size: 22px;
          color: #e0e0e0;
        }

        body.light .calendar-header h2 {
          color: #1a1a1a;
        }

        .month-navigation {
          display: flex;
          gap: 10px;
        }

        .nav-btn {
          padding: 8px 12px;
          border: 1px solid #333;
          background: #0a0a0a;
          color: #b0b0b0;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.3s;
          font-size: 14px;
        }

        body.light .nav-btn {
          border: 1px solid #ddd;
          background: #f5f5f5;
          color: #666;
        }

        .nav-btn:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 8px;
          margin-bottom: 15px;
        }

        .weekday {
          text-align: center;
          font-weight: 600;
          padding: 10px;
          color: #888;
          font-size: 13px;
        }

        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 8px;
        }

        .calendar-day {
          aspect-ratio: 1;
          border: 1px solid #222;
          border-radius: 8px;
          padding: 8px;
          cursor: pointer;
          transition: all 0.3s;
          position: relative;
          background: #0a0a0a;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 80px;
        }

        body.light .calendar-day {
          background: #f5f5f5;
          border: 1px solid #e0e0e0;
        }

        .calendar-day:hover {
          border-color: #6c5ce7;
          background: #0f0f0f;
        }

        body.light .calendar-day:hover {
          background: #f0f0f0;
        }

        .calendar-day.other-month {
          opacity: 0.3;
        }

        .calendar-day.today {
          border-color: #6c5ce7;
          background: rgba(108, 92, 231, 0.1);
        }

        body.light .calendar-day.today {
          background: rgba(108, 92, 231, 0.05);
        }

        .day-number {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 4px;
          color: #e0e0e0;
        }

        body.light .day-number {
          color: #1a1a1a;
        }

        .day-content {
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          justify-content: center;
        }

        .content-indicator {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          transition: all 0.3s;
        }

        .content-indicator:hover {
          width: 8px;
          height: 8px;
        }

        /* Modal styles */
        .modal-overlay {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          z-index: 1000;
          align-items: center;
          justify-content: center;
        }
        .modal-overlay.show { display: flex; }
        .modal {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 12px;
          width: 90%;
          max-width: 700px;
          max-height: 80vh;
          overflow-y: auto;
          padding: 0;
          animation: modalIn 0.2s ease;
        }
        body.light .modal {
          background: #fff;
          border: 1px solid #ddd;
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid #333;
          position: sticky;
          top: 0;
          background: #1a1a1a;
          border-radius: 12px 12px 0 0;
          z-index: 1;
        }
        body.light .modal-header {
          background: #fff;
          border-bottom-color: #e0e0e0;
        }
        .modal-header h3 {
          font-size: 18px;
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .modal-close {
          background: none;
          border: 1px solid #444;
          color: #aaa;
          font-size: 20px;
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .modal-close:hover { border-color: #6c5ce7; color: #6c5ce7; }
        body.light .modal-close { border-color: #ddd; color: #666; }
        .modal-body { padding: 24px; }
        .modal-loading {
          text-align: center;
          padding: 40px;
          color: #888;
        }
        .modal-empty {
          text-align: center;
          padding: 40px;
          color: #666;
          font-size: 14px;
        }
        .platform-card {
          background: #111;
          border: 1px solid #222;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
        }
        body.light .platform-card {
          background: #f8f8f8;
          border-color: #e0e0e0;
        }
        .platform-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .platform-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          color: #fff;
        }
        .platform-badge.instagram { background: #e1306c; }
        .platform-badge.twitter, .platform-badge.twitterx { background: #1da1f2; }
        .platform-badge.linkedin { background: #0a66c2; }
        .platform-badge.tiktok { background: #ff0050; }
        .platform-badge.facebook { background: #1877f2; }
        .platform-badge.youtube { background: #ff0000; }
        .platform-badge.blog { background: #6c5ce7; }
        .copy-btn {
          padding: 6px 12px;
          border: 1px solid #333;
          background: transparent;
          color: #aaa;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }
        .copy-btn:hover { border-color: #6c5ce7; color: #6c5ce7; }
        .copy-btn.copied { border-color: #00b894; color: #00b894; }
        body.light .copy-btn { border-color: #ddd; color: #666; }
        .platform-content {
          font-size: 13px;
          line-height: 1.6;
          color: #ccc;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 200px;
          overflow-y: auto;
        }
        body.light .platform-content { color: #444; }

        .twitter-indicator, .twitterx-indicator { background: #1da1f2; }
        .linkedin-indicator { background: #0a66c2; }
        .instagram-indicator { background: #e1306c; }
        .tiktok-indicator { background: #ff0050; }
        .facebook-indicator { background: #1877f2; }
        .youtube-indicator { background: #ff0000; }
        .blog-indicator { background: #6c5ce7; }

        .sidebar-content {
          position: sticky;
          top: 40px;
        }

        .sidebar-section {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
        }

        body.light .sidebar-section {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .sidebar-section h3 {
          font-size: 14px;
          margin-bottom: 15px;
          color: #6c5ce7;
          text-transform: uppercase;
          font-weight: 600;
        }

        .content-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .content-item {
          background: #0a0a0a;
          border: 1px solid #222;
          border-radius: 6px;
          padding: 10px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.3s;
        }

        body.light .content-item {
          background: #f5f5f5;
          border: 1px solid #ddd;
        }

        .content-item:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .content-item-title {
          font-weight: 500;
          margin-bottom: 4px;
          color: #e0e0e0;
        }

        body.light .content-item-title {
          color: #1a1a1a;
        }

        .content-item-date {
          color: #888;
          font-size: 11px;
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
          color: #888;
        }

        .empty-state h2 {
          font-size: 24px;
          margin-bottom: 10px;
        }

        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
          padding: 15px;
          background: #0a0a0a;
          border-radius: 8px;
          font-size: 12px;
        }

        body.light .legend {
          background: #f5f5f5;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        @media (max-width: 1024px) {
          .calendar-wrapper {
            grid-template-columns: 1fr;
          }

          .sidebar-content {
            position: static;
          }
        }

        @media (max-width: 768px) {
          .sidebar {
            width: 100%;
            height: auto;
            position: relative;
            border-right: none;
            border-bottom: 1px solid #222;
          }

          .main-content {
            margin-left: 0;
          }

          .theme-toggle {
            position: static;
            margin-top: 20px;
          }

          .calendar-day {
            min-height: 60px;
          }

          .day-number {
            font-size: 12px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="sidebar" style="display:flex;flex-direction:column;">
          <div style="padding:0 20px 20px;">
            <a href="/dashboard" class="logo" style="padding:0;margin:0;text-decoration:none;border-left:none;">Repurpose<span>AI</span></a>
          </div>
          <a href="/dashboard">&#x1F3AC; Dashboard</a>
          <a href="/repurpose">&#x1F504; Repurpose</a>
          <a href="/repurpose/history">&#x1F4DA; Library</a>
          <a href="/dashboard/analytics">&#x1F4CA; Analytics</a>
          <a href="/dashboard/calendar" class="active">&#x1F4C5; Calendar</a>
          <a href="/brand-voice">&#x1F399; Brand Voice</a>
          <a href="/billing">&#x1F4B3; Billing</a>
          <a href="/auth/logout" style="margin-top:auto;color:#ef4444;opacity:0.7;font-size:0.85rem;padding:12px 20px;">Sign Out</a>
        </div>

        <div class="main-content">
          <button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>
          <div class="header">
            <h1>Content Calendar</h1>
            <p>Visualize your content generation timeline</p>
          </div>

          <div class="calendar-wrapper">
            <div class="calendar-section">
              <div class="calendar-header">
                <h2 id="monthYear">January 2026</h2>
                <div class="month-navigation">
                  <button class="nav-btn" onclick="previousMonth()">← Prev</button>
                  <button class="nav-btn" onclick="todayMonth()">Today</button>
                  <button class="nav-btn" onclick="nextMonth()">Next →</button>
                </div>
              </div>

              <div class="weekdays">
                <div class="weekday">Sun</div>
                <div class="weekday">Mon</div>
                <div class="weekday">Tue</div>
                <div class="weekday">Wed</div>
                <div class="weekday">Thu</div>
                <div class="weekday">Fri</div>
                <div class="weekday">Sat</div>
              </div>

              <div class="calendar-grid" id="calendarGrid"></div>

              <div class="legend" style="margin-top: 30px;">
                <div class="legend-item"><div class="legend-dot instagram-indicator"></div><span>Instagram</span></div>
                <div class="legend-item"><div class="legend-dot tiktok-indicator"></div><span>TikTok</span></div>
                <div class="legend-item"><div class="legend-dot twitter-indicator"></div><span>Twitter/X</span></div>
                <div class="legend-item"><div class="legend-dot linkedin-indicator"></div><span>LinkedIn</span></div>
                <div class="legend-item"><div class="legend-dot facebook-indicator"></div><span>Facebook</span></div>
                <div class="legend-item"><div class="legend-dot youtube-indicator"></div><span>YouTube</span></div>
                <div class="legend-item"><div class="legend-dot blog-indicator"></div><span>Blog</span></div>
              </div>
            </div>

            <div class="sidebar-content">
              <div class="sidebar-section">
                <h3>Today</h3>
                <div class="content-list" id="todayList">
                  <div style="color: #888; font-size: 12px;">No content today</div>
                </div>
              </div>

              <div class="sidebar-section">
                <h3>This Week</h3>
                <div class="content-list" id="weekList">
                  <div style="color: #888; font-size: 12px;">No upcoming content</div>
                </div>
              </div>

              <div class="sidebar-section">
                <h3>Recent</h3>
                <div class="content-list" id="recentList">
                  <div style="color: #888; font-size: 12px;">No recent content</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Content Modal -->
      <div class="modal-overlay" id="contentModal">
        <div class="modal">
          <div class="modal-header">
            <h3 id="modalTitle">Content</h3>
            <button class="modal-close" onclick="closeModal()">&times;</button>
          </div>
          <div class="modal-body" id="modalBody">
            <div class="modal-loading">Loading...</div>
          </div>
        </div>
      </div>

      <script>
        // Force reload if served from browser back-forward cache
        window.addEventListener('pageshow', function(e) { if (e.persisted) window.location.reload(); });
        let currentDate = new Date();
        let calendarData = {};

        async function loadCalendarData() {
          try {
            const response = await fetch('/dashboard/calendar/api/data');
            if (response.ok) {
              calendarData = await response.json();
              renderCalendar();
              updateSidebars();
            }
          } catch (error) {
            console.error('Error loading calendar data:', error);
          }
        }

        function renderCalendar() {
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth();

          document.getElementById('monthYear').textContent = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

          const firstDay = new Date(year, month, 1);
          const lastDay = new Date(year, month + 1, 0);
          const daysInMonth = lastDay.getDate();
          const startingDayOfWeek = firstDay.getDay();

          const grid = document.getElementById('calendarGrid');
          grid.innerHTML = '';

          // Previous month days
          const prevMonthLastDay = new Date(year, month, 0).getDate();
          for (let i = startingDayOfWeek - 1; i >= 0; i--) {
            const dayNum = prevMonthLastDay - i;
            const cell = createDayCell(dayNum, true);
            grid.appendChild(cell);
          }

          // Current month days
          const today = new Date();
          for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateKey = formatDateKey(date);
            const isToday = today.toDateString() === date.toDateString();
            const content = calendarData[dateKey] || [];

            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            if (isToday) cell.classList.add('today');

            const dayNum = document.createElement('div');
            dayNum.className = 'day-number';
            dayNum.textContent = day;
            cell.appendChild(dayNum);

            if (content.length > 0) {
              const indicators = document.createElement('div');
              indicators.className = 'day-content';
              content.forEach(platform => {
                const indicator = document.createElement('div');
                const cssClass = platform.toLowerCase().replace(/[^a-z]/g, '');
                indicator.className = 'content-indicator ' + cssClass + '-indicator';
                indicator.title = platform;
                indicators.appendChild(indicator);
              });
              cell.appendChild(indicators);
              cell.onclick = function() { openDateModal(dateKey, date); };
              cell.style.cursor = 'pointer';
            }

            grid.appendChild(cell);
          }

          // Next month days
          const remainingCells = 42 - (startingDayOfWeek + daysInMonth);
          for (let day = 1; day <= remainingCells; day++) {
            const cell = createDayCell(day, true);
            grid.appendChild(cell);
          }
        }

        function createDayCell(dayNum, otherMonth = false) {
          const cell = document.createElement('div');
          cell.className = 'calendar-day';
          if (otherMonth) cell.classList.add('other-month');

          const dayNumEl = document.createElement('div');
          dayNumEl.className = 'day-number';
          dayNumEl.textContent = dayNum;
          cell.appendChild(dayNumEl);

          return cell;
        }

        function updateSidebars() {
          const today = new Date();
          const todayKey = formatDateKey(today);

          // Today's content
          const todayContent = calendarData[todayKey] || [];
          const todayList = document.getElementById('todayList');
          if (todayContent.length > 0) {
            todayList.innerHTML = todayContent.map(p => \`
              <div class="content-item" onclick="openSingleContent('\${p}', 'Today', '\${todayKey}')">
                <div class="content-item-title">\${p}</div>
                <div class="content-item-date">Today</div>
              </div>
            \`).join('');
          }

          // This week's content
          const weekContent = [];
          for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const key = formatDateKey(date);
            if (calendarData[key]) {
              calendarData[key].forEach(p => {
                weekContent.push({ platform: p, date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), dateKey: key });
              });
            }
          }

          const weekList = document.getElementById('weekList');
          if (weekContent.length > 0) {
            weekList.innerHTML = weekContent.map(c => \`
              <div class="content-item" onclick="openSingleContent('\${c.platform}', '\${c.date}', '\${c.dateKey}')">
                <div class="content-item-title">\${c.platform}</div>
                <div class="content-item-date">\${c.date}</div>
              </div>
            \`).join('');
          }

          // Recent content (last 30 days including today)
          const recentContent = [];
          for (let i = -30; i <= 0; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const key = formatDateKey(date);
            if (calendarData[key]) {
              calendarData[key].forEach(p => {
                recentContent.push({ platform: p, date: i === 0 ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), dateKey: key });
              });
            }
          }

          const recentList = document.getElementById('recentList');
          if (recentContent.length > 0) {
            recentList.innerHTML = recentContent.slice(0, 5).map(c => \`
              <div class="content-item" onclick="openSingleContent('\${c.platform}', '\${c.date}', '\${c.dateKey}')">
                <div class="content-item-title">\${c.platform}</div>
                <div class="content-item-date">\${c.date}</div>
              </div>
            \`).join('');
          }
        }

        function formatDateKey(date) {
          return date.toISOString().split('T')[0];
        }

        function previousMonth() {
          currentDate.setMonth(currentDate.getMonth() - 1);
          renderCalendar();
        }

        function nextMonth() {
          currentDate.setMonth(currentDate.getMonth() + 1);
          renderCalendar();
        }

        function todayMonth() {
          currentDate = new Date();
          renderCalendar();
        }

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

        // Modal functions
        function openDateModal(dateKey, date) {
          var modal = document.getElementById('contentModal');
          var title = document.getElementById('modalTitle');
          var body = document.getElementById('modalBody');
          title.textContent = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          body.innerHTML = '<div class="modal-loading">Loading content...</div>';
          modal.classList.add('show');
          fetchDateContent(dateKey, body);
        }

        function openSingleContent(platform, dateLabel, dateKey) {
          var modal = document.getElementById('contentModal');
          var title = document.getElementById('modalTitle');
          var body = document.getElementById('modalBody');
          title.textContent = platform + ' - ' + dateLabel;
          body.innerHTML = '<div class="modal-loading">Loading content...</div>';
          modal.classList.add('show');
          fetchDateContent(dateKey, body, platform);
        }

        function closeModal() {
          document.getElementById('contentModal').classList.remove('show');
        }

        document.getElementById('contentModal').addEventListener('click', function(e) {
          if (e.target === this) closeModal();
        });

        async function fetchDateContent(dateKey, container, filterPlatform) {
          try {
            var url = '/dashboard/calendar/api/date-content?date=' + encodeURIComponent(dateKey);
            if (filterPlatform) url += '&platform=' + encodeURIComponent(filterPlatform);
            var resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to load');
            var items = await resp.json();
            if (items.length === 0) {
              container.innerHTML = '<div class="modal-empty">No content found for this date.</div>';
              return;
            }
            var html = '';
            items.forEach(function(item) {
              var cssClass = item.platform.toLowerCase().replace(/[^a-z]/g, '');
              html += '<div class="platform-card">';
              html += '<div class="platform-card-header">';
              html += '<span class="platform-badge ' + cssClass + '">' + item.platform + '</span>';
              html += '<button class="copy-btn" onclick="copyContent(this, ' + "'" + item.id + "'" + ')">Copy</button>';
              html += '</div>';
              html += '<div class="platform-content" id="content-' + item.id + '">' + escapeHtml(item.generated_content) + '</div>';
              html += '</div>';
            });
            container.innerHTML = html;
          } catch (err) {
            container.innerHTML = '<div class="modal-empty">Error loading content. Please try again.</div>';
          }
        }

        function escapeHtml(text) {
          var div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function copyContent(btn, id) {
          var el = document.getElementById('content-' + id);
          if (!el) return;
          navigator.clipboard.writeText(el.textContent).then(function() {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
          });
        }

        loadCalendarData();
      </script>
    </body>
    </html>
  `);
});

// GET - Calendar data API
router.get('/api/data', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all generated outputs for user
    const outputs = await outputOps.getByUserId(userId, 500, 0);

    const calendarData = {};

    for (const output of outputs) {
      const date = new Date(output.created_at);
      const dateKey = date.toISOString().split('T')[0];

      if (!calendarData[dateKey]) {
        calendarData[dateKey] = [];
      }

      const platform = output.platform || 'Unknown';
      if (!calendarData[dateKey].includes(platform)) {
        calendarData[dateKey].push(platform);
      }
    }

    res.json(calendarData);
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

// GET - Content for a specific date
router.get('/api/date-content', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, platform } = req.query;
    if (!date) return res.status(400).json({ error: 'Date parameter required' });

    // Get outputs for that date
    const startOfDay = date + 'T00:00:00.000Z';
    const endOfDay = date + 'T23:59:59.999Z';

    const { pool } = require('../db/database');
    let query = `SELECT id, platform, generated_content, tone, created_at FROM generated_outputs WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3`;
    const params = [userId, startOfDay, endOfDay];

    if (platform) {
      query += ` AND platform = $4`;
      params.push(platform);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching date content:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

module.exports = router;
