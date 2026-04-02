const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { requireAuth } = require('../middleware/auth');
const { userOps, teamOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getThemeToggle, getThemeScript } = require('../utils/theme');

// ---- Gmail OAuth2 Setup ----
function getOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://repurposeai.ai/admin/email/oauth-callback');
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function getGmail() {
  const auth = getOAuth2Client();
  if (!auth) return null;
  return google.gmail({ version: 'v1', auth });
}

// ---- Auth Middleware ----
async function requireAdminOrEmailPerm(req, res, next) {
  const fullUser = await userOps.getById(req.user.id);
  if (!fullUser) return res.redirect('/dashboard');
  req.user = fullUser;
  if (fullUser.role === 'admin') return next();
  // Check team member permissions
  const member = await teamOps.getMemberByUserId(fullUser.id);
  if (member) {
    try {
      const perms = JSON.parse(member.permissions || '{}');
      if (perms.view_emails || perms.reply_emails) {
        req.userPerms = perms;
        return next();
      }
    } catch(e) {}
  }
  if (req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'Email access not permitted' });
  }
  return res.redirect('/dashboard');
}

function canReply(req) {
  if (req.user.role === 'admin') return true;
  return req.userPerms && req.userPerms.reply_emails;
}

// ---- Admin Email Sidebar ----
function getAdminSidebar(activePage) {
  const links = [
    { href: '/admin', icon: '&#x1F4CA;', label: 'Overview', key: 'overview' },
    { href: '/admin/subscribers', icon: '&#x1F465;', label: 'Subscribers', key: 'subscribers' },
    { href: '/admin/blog', icon: '&#x270D;&#xFE0F;', label: 'Blog CMS', key: 'blog' },
    { href: '/admin/team', icon: '&#x1F91D;', label: 'Team', key: 'team' },
    { href: '/admin/messages', icon: '&#x1F4E9;', label: 'Messages', key: 'messages' },
    { href: '/admin/email', icon: '&#x1F4E7;', label: 'Email Inbox', key: 'email' },
    { href: '/admin/bugs', icon: '&#x1F41B;', label: 'Bug Reports', key: 'bugs' },
    { href: '/admin/usage', icon: '&#x1F4C8;', label: 'Usage', key: 'usage' },
  ];
  const navLinks = links.map(l => {
    const cls = l.key === activePage ? ' class="active"' : '';
    return `<a href="${l.href}"${cls}>${l.icon} ${l.label}</a>`;
  }).join('\n');
  return `
    <aside class="sidebar" style="display:flex;flex-direction:column;">
      <div style="padding:0 20px 20px;">
        <a href="/dashboard" class="logo" style="padding:0;margin:0;text-decoration:none;border-left:none;">Repurpose<span>AI</span></a>
        <div style="margin-top:8px;font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:#6C3AED;font-weight:700;">Admin Panel</div>
      </div>
      ${navLinks}
      <div style="margin-top:auto;padding:0;">
        <a href="/dashboard" style="color:var(--text-muted);font-size:.85rem;">&#x2190; Back to App</a>
        <a href="/auth/logout" style="color:#ef4444;opacity:0.7;font-size:0.85rem;">Sign Out</a>
      </div>
    </aside>`;
}

function getAdminCSS() {
  return `
    .email-list{display:flex;flex-direction:column;gap:2px}
    .email-item{display:flex;align-items:flex-start;gap:1rem;padding:1rem 1.2rem;border-radius:10px;cursor:pointer;transition:all .2s;border:1px solid transparent}
    .email-item:hover{background:rgba(108,58,237,0.06);border-color:rgba(108,58,237,0.1)}
    .email-item.unread{background:rgba(108,58,237,0.04);font-weight:600}
    .email-item.unread .email-subject{color:var(--text)}
    .email-item .email-from{font-size:.85rem;color:var(--text);min-width:180px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .email-item .email-subject{font-size:.88rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .email-item .email-snippet{font-size:.8rem;color:var(--text-dim);margin-left:.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}
    .email-item .email-date{font-size:.75rem;color:var(--text-dim);white-space:nowrap;min-width:80px;text-align:right}
    .email-detail{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:2rem}
    .email-detail .meta{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:var(--border-subtle)}
    .email-detail .from{font-weight:600;font-size:.95rem}
    .email-detail .to-info{font-size:.8rem;color:var(--text-dim);margin-top:.3rem}
    .email-detail .date{font-size:.8rem;color:var(--text-dim)}
    .email-detail .subject{font-size:1.3rem;font-weight:700;margin-bottom:1.5rem}
    .email-detail .body{font-size:.92rem;line-height:1.8;color:var(--text-muted)}
    .email-detail .body img{max-width:100%}
    .reply-box{margin-top:1.5rem;padding-top:1.5rem;border-top:var(--border-subtle)}
    .reply-box textarea{width:100%;padding:.8rem 1rem;background:var(--surface-light);border:var(--border-subtle);border-radius:10px;color:var(--text);font-size:.9rem;font-family:inherit;outline:none;min-height:120px;resize:vertical;transition:border-color .3s}
    .reply-box textarea:focus{border-color:#6C3AED}
    .reply-actions{display:flex;gap:.8rem;margin-top:.8rem}
    .card{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:1.5rem;margin-bottom:1.5rem}
    .card h2{font-size:1.1rem;font-weight:700;margin-bottom:1rem}
    .btn-sm{padding:.45rem .9rem;font-size:.8rem;border-radius:8px;cursor:pointer;border:none;font-weight:600;transition:all .2s}
    .btn-primary-sm{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff}
    .btn-primary-sm:hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(108,58,237,0.3)}
    .btn-outline-sm{background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text-muted)}
    .btn-outline-sm:hover{border-color:#6C3AED;color:#8B5CF6}
    .search-bar{display:flex;gap:.8rem;margin-bottom:1.5rem;align-items:center}
    .search-bar input{flex:1;padding:.7rem 1rem;background:var(--surface);border:var(--border-subtle);border-radius:10px;color:var(--text);font-size:.9rem;outline:none}
    .search-bar input:focus{border-color:#6C3AED}
    .toast{position:fixed;bottom:2rem;right:2rem;background:var(--success,#10B981);color:#fff;padding:1rem 1.5rem;border-radius:10px;font-size:.9rem;font-weight:500;display:none;z-index:9999;animation:slideUp .3s ease}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    .pagination{display:flex;gap:.5rem;justify-content:center;margin-top:1.5rem}
    .pagination button{padding:.4rem .8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:var(--text-muted);cursor:pointer;font-size:.85rem}
    .pagination button:hover{border-color:#6C3AED;color:#8B5CF6}
    .pagination button.active{background:rgba(108,58,237,0.15);color:#8B5CF6;border-color:#6C3AED}
    .setup-box{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:2.5rem;text-align:center;max-width:600px;margin:2rem auto}
    .setup-box h2{font-size:1.3rem;margin-bottom:1rem}
    .setup-box p{color:var(--text-muted);font-size:.9rem;line-height:1.7;margin-bottom:1rem}
    .setup-box code{background:rgba(108,58,237,0.1);color:#8B5CF6;padding:.15rem .4rem;border-radius:4px;font-size:.85rem}
    .setup-box ol{text-align:left;color:var(--text-muted);font-size:.88rem;line-height:2;padding-left:1.5rem}
    @media(max-width:768px){.email-item .email-snippet{display:none}.email-item .email-from{min-width:120px;max-width:120px}}
  `;
}

// ========================
// EMAIL INBOX PAGE
// ========================
router.get('/', requireAuth, requireAdminOrEmailPerm, async (req, res) => {
  const gmail = getGmail();
  const page = req.query.page || '';
  const search = req.query.q || '';

  // If Gmail not configured, show setup instructions
  if (!gmail) {
    return res.send(`
      ${getHeadHTML('Email Inbox - Admin')}
      <style>${getBaseCSS()}${getAdminCSS()}</style>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('email')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header">
            <h1>Email Inbox</h1>
            <p>Connect your Gmail to view and reply to emails</p>
          </div>
          <div class="setup-box">
            <div style="font-size:3rem;margin-bottom:1rem">&#x1F4E7;</div>
            <h2>Gmail Setup Required</h2>
            <p>To view emails from <code>support@repurposeai.ai</code> in this panel, you need to set up 3 environment variables in Railway:</p>
            <ol>
              <li><code>GMAIL_CLIENT_ID</code> — from Google Cloud Console</li>
              <li><code>GMAIL_CLIENT_SECRET</code> — from Google Cloud Console</li>
              <li><code>GMAIL_REFRESH_TOKEN</code> — generated via OAuth authorization</li>
            </ol>
            <p style="margin-top:1rem">Visit <a href="/admin/email/setup" style="color:#8B5CF6">/admin/email/setup</a> for step-by-step instructions.</p>
          </div>
        </div>
      </div>
      <script>${getThemeScript()}</script>
      </body></html>
    `);
  }

  res.send(`
    ${getHeadHTML('Email Inbox - Admin')}
    <style>${getBaseCSS()}${getAdminCSS()}</style>
    </head><body>
    <div class="dashboard">
      ${getAdminSidebar('email')}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="page-header">
          <h1>Email Inbox</h1>
          <p>Emails from support@repurposeai.ai</p>
        </div>

        <div class="search-bar">
          <input type="text" id="emailSearch" placeholder="Search emails..." value="${search.replace(/"/g, '&quot;')}">
          <button class="btn-sm btn-primary-sm" onclick="searchEmails()">Search</button>
          <button class="btn-sm btn-outline-sm" onclick="loadEmails()">Refresh</button>
        </div>

        <!-- Email list view -->
        <div id="emailListView">
          <div class="card">
            <div id="emailList" style="min-height:200px">
              <div style="text-align:center;padding:2rem;color:var(--text-muted)">Loading emails...</div>
            </div>
            <div class="pagination" id="pagination"></div>
          </div>
        </div>

        <!-- Email detail view (hidden by default) -->
        <div id="emailDetailView" style="display:none">
          <div style="margin-bottom:1rem">
            <button class="btn-sm btn-outline-sm" onclick="backToList()">&#x2190; Back to Inbox</button>
          </div>
          <div id="emailDetail" class="email-detail"></div>
        </div>
      </div>
    </div>
    <div class="toast" id="toast"></div>
    <script>
      ${getThemeScript()}

      let currentPageToken = '';
      let nextPageToken = '';
      let prevPageTokens = [];
      const canReply = ${canReply(req)};

      async function loadEmails(pageToken) {
        const search = document.getElementById('emailSearch').value.trim();
        let url = '/admin/email/api/list?maxResults=20';
        if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
        if (search) url += '&q=' + encodeURIComponent(search);

        document.getElementById('emailList').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</div>';

        try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          nextPageToken = data.nextPageToken || '';
          renderEmailList(data.emails || []);
          renderPagination();
        } catch(e) {
          document.getElementById('emailList').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Error loading emails: ' + e.message + '</div>';
        }
      }

      function renderEmailList(emails) {
        if (emails.length === 0) {
          document.getElementById('emailList').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No emails found.</div>';
          return;
        }
        document.getElementById('emailList').innerHTML = '<div class="email-list">' + emails.map(function(e) {
          var unread = e.unread ? ' unread' : '';
          return '<div class="email-item' + unread + '" onclick="openEmail(\\'' + e.id + '\\')">' +
            '<div class="email-from">' + escapeHtml(e.from) + '</div>' +
            '<div class="email-subject">' + escapeHtml(e.subject || '(no subject)') + '</div>' +
            '<div class="email-snippet">' + escapeHtml(e.snippet || '') + '</div>' +
            '<div class="email-date">' + formatLocalDate(e.date) + '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      function renderPagination() {
        var html = '';
        if (prevPageTokens.length > 0) {
          html += '<button onclick="goBack()">&#x2190; Previous</button>';
        }
        if (nextPageToken) {
          html += '<button onclick="goNext()">Next &#x2192;</button>';
        }
        document.getElementById('pagination').innerHTML = html;
      }

      function goNext() {
        prevPageTokens.push(currentPageToken);
        currentPageToken = nextPageToken;
        loadEmails(nextPageToken);
      }

      function goBack() {
        currentPageToken = prevPageTokens.pop() || '';
        loadEmails(currentPageToken || undefined);
      }

      function searchEmails() {
        prevPageTokens = [];
        currentPageToken = '';
        loadEmails();
      }

      document.getElementById('emailSearch').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') searchEmails();
      });

      async function openEmail(id) {
        document.getElementById('emailListView').style.display = 'none';
        document.getElementById('emailDetailView').style.display = 'block';
        document.getElementById('emailDetail').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</div>';

        try {
          const res = await fetch('/admin/email/api/message/' + id);
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          renderEmailDetail(data);
        } catch(e) {
          document.getElementById('emailDetail').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Error: ' + e.message + '</div>';
        }
      }

      function renderEmailDetail(email) {
        var replyHtml = '';
        if (canReply) {
          replyHtml = '<div class="reply-box">' +
            '<h3 style="font-size:.95rem;font-weight:600;margin-bottom:.8rem">Reply</h3>' +
            '<textarea id="replyBody" placeholder="Type your reply..."></textarea>' +
            '<div class="reply-actions">' +
              '<button id="replyBtn" class="btn-sm btn-primary-sm" onclick="sendReply(\\'' + email.id + '\\', \\'' + escapeHtml(email.from).replace(/'/g, "\\\\'") + '\\', \\'' + escapeHtml(email.subject).replace(/'/g, "\\\\'") + '\\')">Send Reply</button>' +
            '</div>' +
          '</div>';
        }

        document.getElementById('emailDetail').innerHTML =
          '<div class="subject">' + escapeHtml(email.subject || '(no subject)') + '</div>' +
          '<div class="meta">' +
            '<div>' +
              '<div class="from">From: ' + escapeHtml(email.from) + '</div>' +
              '<div class="to-info">To: ' + escapeHtml(email.to || 'support@repurposeai.ai') + '</div>' +
            '</div>' +
            '<div class="date">' + formatLocalDateFull(email.date) + '</div>' +
          '</div>' +
          '<div class="body">' + (email.bodyHtml || escapeHtml(email.bodyText || '').replace(/\\n/g, '<br>')) + '</div>' +
          replyHtml;
      }

      async function sendReply(messageId, to, subject) {
        var body = document.getElementById('replyBody').value.trim();
        if (!body) { showToast('Please type a reply'); return; }

        var btn = document.getElementById('replyBtn');
        btn.disabled = true;
        btn.textContent = 'Sending...';

        try {
          const res = await fetch('/admin/email/api/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: messageId, to: to, subject: subject, body: body })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to send');

          // Replace the reply box with a success message
          var replyBox = document.querySelector('.reply-box');
          if (replyBox) {
            replyBox.innerHTML = '<div style="text-align:center;padding:1.5rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:12px">' +
              '<div style="font-size:1.5rem;margin-bottom:.5rem">&#x2705;</div>' +
              '<div style="color:#10B981;font-weight:600;font-size:.95rem">Reply sent successfully!</div>' +
              '<div style="color:var(--text-dim);font-size:.8rem;margin-top:.4rem">Your reply to ' + escapeHtml(to) + ' has been delivered.</div>' +
            '</div>';
          }
          showToast('Reply sent!');
        } catch(e) {
          showToast('Error: ' + e.message);
          btn.disabled = false;
          btn.textContent = 'Send Reply';
        }
      }

      function backToList() {
        document.getElementById('emailListView').style.display = 'block';
        document.getElementById('emailDetailView').style.display = 'none';
      }

      function formatLocalDate(isoStr) {
        try {
          var d = new Date(isoStr);
          var now = new Date();
          if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          }
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch(e) { return isoStr; }
      }

      function formatLocalDateFull(isoStr) {
        try {
          return new Date(isoStr).toLocaleString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
          });
        } catch(e) { return isoStr; }
      }

      function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function showToast(msg) {
        var t = document.getElementById('toast');
        t.textContent = msg; t.style.display = 'block';
        setTimeout(function() { t.style.display = 'none'; }, 3000);
      }

      // Load emails on page load
      loadEmails();
    </script>
    </body></html>
  `);
});

// ========================
// SETUP GUIDE PAGE
// ========================
router.get('/setup', requireAuth, async (req, res) => {
  const fullUser = await userOps.getById(req.user.id);
  if (!fullUser || fullUser.role !== 'admin') return res.redirect('/dashboard');

  const clientId = process.env.GMAIL_CLIENT_ID || '';
  const hasCredentials = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  const hasRefreshToken = !!process.env.GMAIL_REFRESH_TOKEN;
  const isFullyConfigured = hasCredentials && hasRefreshToken;

  res.send(`
    ${getHeadHTML('Email Setup - Admin')}
    <style>${getBaseCSS()}${getAdminCSS()}
      .step{background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:1.5rem;margin-bottom:1.2rem}
      .step h3{font-size:1rem;font-weight:700;margin-bottom:.8rem;display:flex;align-items:center;gap:.5rem}
      .step .num{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;font-size:.8rem;font-weight:700;flex-shrink:0}
      .step p{color:var(--text-muted);font-size:.88rem;line-height:1.7;margin-bottom:.5rem}
      .step code{background:rgba(108,58,237,0.1);color:#8B5CF6;padding:.15rem .4rem;border-radius:4px;font-size:.82rem}
      .step .done{color:#10B981;font-weight:600}
      .step .pending{color:#F59E0B;font-weight:600}
    </style>
    </head><body>
    <div class="dashboard">
      ${getAdminSidebar('email')}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="page-header">
          <h1>Gmail Setup Guide</h1>
          <p>Connect support@repurposeai.ai to your admin panel</p>
        </div>

        <div class="step">
          <h3><span class="num">1</span> Create Google Cloud Project</h3>
          <p>Go to <a href="https://console.cloud.google.com/" target="_blank" style="color:#8B5CF6">Google Cloud Console</a> and create a new project (or use an existing one).</p>
        </div>

        <div class="step">
          <h3><span class="num">2</span> Enable Gmail API</h3>
          <p>In your project, go to <strong>APIs &amp; Services &gt; Library</strong>, search for <code>Gmail API</code>, and click <strong>Enable</strong>.</p>
        </div>

        <div class="step">
          <h3><span class="num">3</span> Create OAuth Credentials</h3>
          <p>Go to <strong>APIs &amp; Services &gt; Credentials &gt; Create Credentials &gt; OAuth Client ID</strong>.</p>
          <p>Application type: <code>Web application</code></p>
          <p>Authorized redirect URI: <code>https://repurposeai.ai/admin/email/oauth-callback</code></p>
          <p>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>.</p>
        </div>

        <div class="step">
          <h3><span class="num">4</span> Set Environment Variables in Railway</h3>
          <p>In your Railway dashboard, add these environment variables:</p>
          <p><code>GMAIL_CLIENT_ID</code> = your Client ID</p>
          <p><code>GMAIL_CLIENT_SECRET</code> = your Client Secret</p>
          <p>Status: ${hasCredentials ? '<span class="done">&#x2713; Credentials configured</span>' : '<span class="pending">&#x23F3; Waiting for credentials</span>'}</p>
        </div>

        <div class="step">
          <h3><span class="num">5</span> Authorize Gmail Access</h3>
          ${hasCredentials ? `
            <p>Click the button below to authorize RepurposeAI to read and send emails from your Gmail account.</p>
            <a href="/admin/email/oauth-start" class="btn-sm btn-primary-sm" style="display:inline-block;padding:.7rem 1.5rem;text-decoration:none;margin-top:.5rem">Authorize Gmail &#x2192;</a>
          ` : `
            <p>Complete step 4 first, then come back here to authorize.</p>
          `}
          <p style="margin-top:.5rem">Status: ${hasRefreshToken ? '<span class="done">&#x2713; Gmail authorized</span>' : '<span class="pending">&#x23F3; Not yet authorized</span>'}</p>
        </div>

        ${isFullyConfigured ? `
          <div class="step" style="border-color:rgba(16,185,129,0.3);background:rgba(16,185,129,0.05)">
            <h3 style="color:#10B981">&#x2713; All Set!</h3>
            <p>Gmail is connected. <a href="/admin/email" style="color:#8B5CF6">Go to Email Inbox &#x2192;</a></p>
          </div>
        ` : ''}
      </div>
    </div>
    <script>${getThemeScript()}</script>
    </body></html>
  `);
});

// ========================
// OAuth Flow
// ========================
router.get('/oauth-start', requireAuth, async (req, res) => {
  const fullUser = await userOps.getById(req.user.id);
  if (!fullUser || fullUser.role !== 'admin') return res.redirect('/dashboard');

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.redirect('/admin/email/setup');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://repurposeai.ai/admin/email/oauth-callback');
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ]
  });
  res.redirect(authUrl);
});

router.get('/oauth-callback', requireAuth, async (req, res) => {
  const fullUser = await userOps.getById(req.user.id);
  if (!fullUser || fullUser.role !== 'admin') return res.redirect('/dashboard');

  const code = req.query.code;
  if (!code) return res.redirect('/admin/email/setup');

  try {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://repurposeai.ai/admin/email/oauth-callback');
    const { tokens } = await oauth2Client.getToken(code);

    // Show the refresh token so user can save it as env var
    res.send(`
      ${getHeadHTML('Gmail Authorized - Admin')}
      <style>${getBaseCSS()}${getAdminCSS()}</style>
      </head><body>
      <div class="dashboard">
        ${getAdminSidebar('email')}
        ${getThemeToggle()}
        <div class="main-content">
          <div class="page-header">
            <h1>Gmail Authorized!</h1>
            <p>One last step — save the refresh token</p>
          </div>
          <div class="setup-box" style="text-align:left;max-width:700px">
            <h2 style="color:#10B981">&#x2713; Authorization successful!</h2>
            <p>Copy the refresh token below and add it as an environment variable in Railway:</p>
            <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:1rem;margin:1rem 0;word-break:break-all">
              <code style="font-size:.8rem;color:#8B5CF6">${tokens.refresh_token || 'No refresh token received — you may already have one saved. Try re-authorizing with prompt=consent.'}</code>
            </div>
            <p>Variable name: <code>GMAIL_REFRESH_TOKEN</code></p>
            <p style="margin-top:1rem">After saving in Railway, the app will restart and your Email Inbox will be ready to use.</p>
            <a href="/admin/email" style="display:inline-block;margin-top:1rem;padding:.7rem 1.5rem;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem">Go to Email Inbox &#x2192;</a>
          </div>
        </div>
      </div>
      <script>${getThemeScript()}</script>
      </body></html>
    `);
  } catch(err) {
    console.error('OAuth callback error:', err);
    res.redirect('/admin/email/setup');
  }
});

// ========================
// BLOCKED SENDERS (system/automated emails hidden from team)
// ========================
const BLOCKED_SENDERS = [
  'noreply@google.com',
  'no-reply@accounts.google.com',
  'mail-noreply@google.com',
  'gmail-noreply@google.com',
  'googleworkspace-noreply@google.com',
  'workspace-noreply@google.com',
  'calendar-notification@google.com',
  'drive-shares-dm-noreply@google.com',
  'comments-noreply@docs.google.com',
  'apps-scripts-notifications@google.com',
  'admin@google.com',
  'postmaster@google.com',
];

// Build a Gmail query to exclude blocked senders
function getBlockedSendersQuery() {
  return BLOCKED_SENDERS.map(s => `-from:${s}`).join(' ');
}

// ========================
// API ENDPOINTS
// ========================

// List emails
router.get('/api/list', requireAuth, requireAdminOrEmailPerm, async (req, res) => {
  try {
    const gmail = getGmail();
    if (!gmail) return res.status(400).json({ error: 'Gmail not configured' });

    const maxResults = parseInt(req.query.maxResults) || 20;
    const pageToken = req.query.pageToken || undefined;
    const userQuery = req.query.q || '';
    const isAdmin = req.user.role === 'admin';

    // For team members, always filter out system/Google emails
    // For admins, only filter if they haven't typed a specific search
    const blockQuery = (!isAdmin || !userQuery) ? getBlockedSendersQuery() : '';
    const q = [userQuery, blockQuery, 'in:inbox'].filter(Boolean).join(' ');

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      pageToken,
      q: q || undefined
    });

    const messages = listRes.data.messages || [];
    const nextPageToken = listRes.data.nextPageToken || '';

    // Fetch headers for each message (batch)
    const emails = await Promise.all(messages.map(async (msg) => {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });
        const headers = detail.data.payload?.headers || [];
        const getHeader = (name) => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
        const unread = (detail.data.labelIds || []).includes('UNREAD');
        const dateStr = getHeader('Date');
        let isoDate = '';
        try {
          isoDate = new Date(dateStr).toISOString();
        } catch(e) { isoDate = dateStr; }

        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader('From').replace(/<.*>/, '').trim() || getHeader('From'),
          subject: getHeader('Subject'),
          snippet: detail.data.snippet || '',
          date: isoDate,
          unread
        };
      } catch(e) {
        return { id: msg.id, from: '?', subject: '?', snippet: '', date: '', unread: false };
      }
    }));

    res.json({ emails, nextPageToken });
  } catch(err) {
    console.error('Email list error:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Get single email
router.get('/api/message/:id', requireAuth, requireAdminOrEmailPerm, async (req, res) => {
  try {
    const gmail = getGmail();
    if (!gmail) return res.status(400).json({ error: 'Gmail not configured' });

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: 'full'
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name) => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

    // Block team members from viewing system/Google emails
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      const fromHeader = getHeader('From').toLowerCase();
      const isBlocked = BLOCKED_SENDERS.some(blocked => fromHeader.includes(blocked.toLowerCase()));
      if (isBlocked) {
        return res.status(403).json({ error: 'This email is not accessible' });
      }
    }

    // Extract body
    let bodyHtml = '';
    let bodyText = '';

    function extractParts(payload) {
      if (payload.mimeType === 'text/html' && payload.body?.data) {
        bodyHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      } else if (payload.mimeType === 'text/plain' && payload.body?.data) {
        bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }
      if (payload.parts) {
        payload.parts.forEach(extractParts);
      }
    }
    extractParts(detail.data.payload);

    // Mark as read
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: req.params.id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });
    } catch(e) { /* ignore */ }

    const dateStr = getHeader('Date');
    let formattedDate = dateStr;
    try {
      formattedDate = new Date(dateStr).toISOString();
    } catch(e) {}

    res.json({
      id: req.params.id,
      threadId: detail.data.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: formattedDate,
      bodyHtml,
      bodyText
    });
  } catch(err) {
    console.error('Email detail error:', err);
    res.status(500).json({ error: 'Failed to fetch email' });
  }
});

// Send reply
router.post('/api/reply', requireAuth, requireAdminOrEmailPerm, async (req, res) => {
  // Check reply permission
  if (!canReply(req)) {
    return res.status(403).json({ error: 'Reply permission not granted' });
  }

  try {
    const gmail = getGmail();
    if (!gmail) return res.status(400).json({ error: 'Gmail not configured' });

    const { messageId, to, subject, body } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'Recipient and body required' });

    // Extract email address from "Name <email>" format
    const toEmail = to.includes('<') ? to.match(/<(.+?)>/)?.[1] || to : to;

    const replySubject = subject?.startsWith('Re:') ? subject : 'Re: ' + (subject || '');

    // Build raw email
    const rawEmail = [
      `From: support@repurposeai.ai`,
      `To: ${toEmail}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawEmail).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage, threadId: req.body.threadId }
    });

    res.json({ success: true });
  } catch(err) {
    console.error('Reply error:', err);
    res.status(500).json({ error: 'Failed to send reply: ' + err.message });
  }
});

module.exports = router;
