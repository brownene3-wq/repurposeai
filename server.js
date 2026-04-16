const express = require('express'); // v1.0.1
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { initDatabase } = require('./db/database');
const { startWorkflowEngine } = require('./services/workflowEngine');

const app = express();
const fs = require('fs');
const path = require('path');

// Ensure upload/output directories exist
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const { injectChatWidget } = require('./middleware/chatWidget');
const { injectFeedbackWidget } = require('./middleware/feedbackWidget');

// Middleware - skip JSON parsing for Stripe webhook (needs raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/billing/webhook') return next();
  express.json()(req, res, next)
});
app.use((req, res, next) => {
  if (req.originalUrl === '/billing/webhook') return next();
  express.urlencoded({ extended: true })(req, res, next);
});
app.use(cookieParser())

// Inject chat widget into all HTML pages
app.use((req, res, next) => {
  const skip = req.path.includes('/api/') || req.path.includes('/process-stream') || req.path === '/billing/webhook' || req.path.startsWith('/chatbot') || req.path.startsWith('/shorts/analyze') || req.path.startsWith('/shorts/clip');
  if (skip) return next();
  injectChatWidget(req, res, next);
});

// Inject feedback widget into all HTML pages
app.use((req, res, next) => {
  const skip = req.path.includes('/api/') || req.path.includes('/process-stream') || req.path === '/billing/webhook' || req.path.startsWith('/chatbot') || req.path.startsWith('/shorts/analyze') || req.path.startsWith('/shorts/clip');
  if (skip) return next();
  injectFeedbackWidget(req, res, next);
});

// Disable caching on HTML pages so browser refresh always fetches fresh content
app.disable('etag');
app.use((req, res, next) => {
  // Only set no-cache for HTML page requests (not API/JSON or static assets)
  const isApiRequest = req.path.includes('/api/') || req.path === '/billing/webhook';
  const isStreamRequest = req.path.includes('/process-stream');
  const isStaticAsset = req.path.startsWith('/public/');
  if (!isApiRequest && !isStreamRequest && !isStaticAsset) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('X-Request-Time', Date.now().toString());
  }
  next();
});

// Initialize database
(async () => {
  try {
    await initDatabase();
    console.log('Database initialized');

      // Auto-promote specific users on startup
      try {
        const { userOps, adminOps } = require('./db/database');
        const promoUsers = [
          { em: 'albertdbrown85@gmail.com', plan: 'pro', role: 'admin' },
          { em: 'josephml.azares@gmail.com', plan: 'pro' },
          { em: 'zagalajonah@gmail.com', plan: 'pro' }
        ];
        for (const pu of promoUsers) {
          const u = await userOps.getByEmail(pu.em);
          if (u) {
            await userOps.updatePlan(u.id, pu.plan);
            if (pu.role) await adminOps.setUserRole(u.id, pu.role);
            console.log('Promoted ' + pu.em + ' to ' + pu.plan + (pu.role ? ' + ' + pu.role : ''));
          }
        }
      } catch (e) { console.log('Auto-promote skipped:', e.message); }
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
})();

// Import route handlers
const pagesRouter = require('./routes/pages');
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const repurposeRouter = require('./routes/repurpose');
const billingRouter = require('./routes/billing');
const contactRouter = require('./routes/contact');
const pricingRouter = require('./routes/pricing');
const analyticsRouter = require('./routes/analytics');
const scheduledRouter = require('./routes/scheduled');
const brandVoiceRouter = require('./routes/brand-voice');
const calendarRouter = require('./routes/calendar');
const chatbotRouter = require('./routes/chatbot');
const shortsRouter = require('./routes/shorts');
const staticPagesRouter = require('./routes/static-pages');
const adminRouter = require('./routes/admin');
const adminEmailRouter = require('./routes/admin-email');
const pageEditorRouter = require('./routes/page-editor');
const settingsRouter = require('./routes/settings');
const feedbackRouter = require('./routes/feedback');
const distributeRouter = require('./routes/distribute');
const aiHookRouter = require('./routes/ai-hook');
const enhanceSpeechRouter = require('./routes/enhance-speech');
const aiReframeRouter = require('./routes/ai-reframe');
const videoEditorRouter = require('./routes/video-editor');
const aiThumbnailRouter = require('./routes/ai-thumbnail');
const captionPresetsRouter = require('./routes/caption-presets');
const aiCaptionsRouter = require('./routes/ai-captions');
const aiBrollRouter = require('./routes/ai-broll');
const brandTemplatesRouter = require('./routes/brand-templates');
const tiktokRouter = require('./routes/tiktok');
const twitterRouter = require('./routes/twitter');
const instagramRouter = require('./routes/instagram');
const linkedinRouter = require('./routes/linkedin');
const pinterestRouter = require('./routes/pinterest');
const youtubeRouter = require('./routes/youtube');
const facebookRouter = require('./routes/facebook');
const threadsRouter = require('./routes/threads');
const blueskyRouter = require('./routes/bluesky');
const snapchatRouter = require('./routes/snapchat');
const googledriveRouter = require('./routes/googledrive');
const dropboxRouter = require('./routes/dropbox');
const twitchRouter = require('./routes/twitch');
const heygenRouter = require('./routes/heygen');
const audiopodcastRouter = require('./routes/audiopodcast');
const videopodcastRouter = require('./routes/videopodcast');
const zoomRouter = require('./routes/zoom');
const webexRouter = require('./routes/webex');
const amazonRouter = require('./routes/amazon');
const soundcloudRouter = require('./routes/soundcloud');
const libsynRouter = require('./routes/libsyn');
const captivateRouter = require('./routes/captivate');

// Team permission enforcement middleware
// Restricts team members to only the features they have permission for
const { loadTeamPermissions } = require('./middleware/auth');
const { teamOps } = require('./db/database');

app.use(async (req, res, next) => {
  // Only check authenticated routes (those with a token)
  const token = req.cookies?.token;
  if (!token) return next();

  // Skip public/auth routes
  const publicPaths = ['/auth', '/chatbot', '/contact', '/feedback', '/manifest.json', '/sw.js', '/offline', '/icons'];
  if (publicPaths.some(p => req.path.startsWith(p))) return next();

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
    const decoded = jwt.verify(token, JWT_SECRET);
    const { userOps } = require('./db/database');
    const user = await userOps.getById(decoded.id);
    if (!user) return next();

    // Admins and account owners pass through
    if (user.role === 'admin') return next();

    const member = await teamOps.getMemberByUserId(user.id);
    if (!member) return next(); // Not a team member = account owner = full access

    let perms = {};
    try { perms = JSON.parse(member.permissions || '{}'); } catch {}

    // Attach team info to req so routes can use it (e.g., for sidebar filtering)
    req.teamPermissions = perms;
    req.isTeamMember = true;

    // Define which routes require which permissions
    const routePermMap = {
      '/repurpose': ['use_repurpose'],
      '/shorts': ['use_shorts'],
      '/dashboard/analytics': ['view_analytics'],
      '/dashboard/calendar': ['use_calendar'],
      '/brand-voice': ['use_brand_voice'],
      '/billing': ['view_billing'],
      '/settings': ['manage_settings'],
      '/ai-hook': ['use_repurpose'],
      '/enhance-speech': ['use_repurpose'],
      '/ai-reframe': ['use_repurpose'],
      '/video-editor': ['use_repurpose'],
      '/caption-presets': ['use_repurpose'],
      '/ai-captions': ['use_repurpose'],
      '/ai-broll': ['use_repurpose'],
      '/brand-templates': ['use_repurpose'],
      '/admin': ['manage_team'],
    };

    // Check if this route is restricted
    for (const [route, requiredPerms] of Object.entries(routePermMap)) {
      if (req.path.startsWith(route)) {
        const hasAny = requiredPerms.some(p => perms[p] === true);
        if (!hasAny) {
          // For API requests, return JSON error
          if (req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
            return res.status(403).json({ error: 'You don\'t have permission to access this feature. Contact your team admin.' });
          }
          // For page requests, redirect to limited dashboard
          return res.redirect('/dashboard?restricted=1');
        }
        break;
      }
    }
  } catch (err) {
    // Token invalid, let the route's own auth handle it
  }
  next();
});

// Serve static assets (landing page videos, images, etc.)
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

// Mount routes - order matters for specificity
app.use('/', pagesRouter);
app.use('/auth', authRouter);
app.use('/dashboard/analytics', analyticsRouter);
app.use('/dashboard/scheduled', scheduledRouter);
app.use('/dashboard/calendar', calendarRouter);
app.use('/dashboard', dashboardRouter);
app.use('/billing', billingRouter);
app.use('/contact', contactRouter);
app.use('/repurpose', repurposeRouter);
app.use('/brand-voice', brandVoiceRouter);
app.use('/pricing', pricingRouter);
app.use('/chatbot', chatbotRouter);
app.use('/shorts', shortsRouter);
app.use('/', staticPagesRouter);
app.use('/settings', settingsRouter);
app.use('/feedback', feedbackRouter);
app.use('/distribute', distributeRouter);
app.use('/admin', adminRouter);
app.use('/admin', pageEditorRouter);
app.use('/admin/email', adminEmailRouter);
app.use('/ai-hook', aiHookRouter);
app.use('/enhance-speech', enhanceSpeechRouter);
app.use('/ai-reframe', aiReframeRouter);
app.use('/video-editor', videoEditorRouter);
app.use('/ai-thumbnail', aiThumbnailRouter);
app.use('/caption-presets', captionPresetsRouter);
app.use('/ai-broll', aiBrollRouter);
app.use('/brand-templates', brandTemplatesRouter);
app.use('/tiktok', tiktokRouter);
app.use('/auth/tiktok', tiktokRouter);
app.use('/twitter', twitterRouter);
app.use('/auth/twitter', twitterRouter);
app.use('/instagram', instagramRouter);
app.use('/auth/instagram', instagramRouter);
app.use('/linkedin', linkedinRouter);
app.use('/auth/linkedin', linkedinRouter);
app.use('/pinterest', pinterestRouter);
app.use('/auth/pinterest', pinterestRouter);
app.use('/youtube', youtubeRouter);
app.use('/auth/youtube', youtubeRouter);
app.use('/auth/threads', threadsRouter);
app.use('/auth/bluesky', blueskyRouter);
app.use('/auth/snapchat', snapchatRouter);
app.use('/auth/googledrive', googledriveRouter);
app.use('/auth/dropbox', dropboxRouter);
app.use('/auth/twitch', twitchRouter);
app.use('/auth/heygen', heygenRouter);
app.use('/auth/audiopodcast', audiopodcastRouter);
app.use('/auth/videopodcast', videopodcastRouter);
app.use('/auth/zoom', zoomRouter);
app.use('/auth/webex', webexRouter);
app.use('/auth/amazon', amazonRouter);
app.use('/auth/soundcloud', soundcloudRouter);
app.use('/auth/libsyn', libsynRouter);
app.use('/auth/captivate', captivateRouter);
app.use('/facebook', facebookRouter);
app.use('/auth/facebook', facebookRouter);
app.use('/ai-captions', aiCaptionsRouter);

// ========================
// PWA MANIFEST & SERVICE WORKER
// ========================
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Splicora',
    short_name: 'Splicora',
    description: 'AI-powered content creation for creators',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#6C3AED',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ],
    categories: ['productivity', 'social'],
    shortcuts: [
      { name: 'Repurpose Video', short_name: 'Repurpose', url: '/repurpose', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Smart Shorts', short_name: 'Shorts', url: '/shorts', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(`
    const CACHE_NAME = 'splicora-v1';
    const OFFLINE_URL = '/offline';

    self.addEventListener('install', (event) => {
      event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL]))
      );
      self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(
        caches.keys().then((keys) => Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        ))
      );
      self.clients.claim();
    });

    self.addEventListener('fetch', (event) => {
      if (event.request.mode === 'navigate') {
        event.respondWith(
          fetch(event.request).catch(() => caches.match(OFFLINE_URL))
        );
      }
    });
  `);
});

app.get('/offline', (req, res) => {
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Splicora - Offline</title>' +
    '<style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}' +
    '.box{padding:2rem}h1{font-size:2rem;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}' +
    'p{color:#a0aec0;font-size:1.1rem;line-height:1.7}button{margin-top:1.5rem;padding:12px 32px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:50px;font-size:1rem;font-weight:600;cursor:pointer}</style>' +
    '</head><body><div class="box"><h1>You\'re Offline</h1><p>Check your internet connection and try again.</p><button onclick="location.reload()">Retry</button></div></body></html>');
});

// Generate PWA icons dynamically (SVG-based)
app.get('/icons/:filename', (req, res) => {
  const size = req.params.filename.includes('512') ? 512 : 192;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#6C3AED"/><stop offset="100%" style="stop-color:#EC4899"/></linearGradient></defs>' +
    '<rect width="' + size + '" height="' + size + '" rx="' + (size * 0.2) + '" fill="url(#g)"/>' +
    '<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-weight="800" font-size="' + (size * 0.35) + '" fill="white">R</text>' +
    '</svg>';
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// Admin endpoint - upgrade user plan by email (secured by admin secret)
app.post('/admin/upgrade-plan', async (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET || 'repurposeai-admin-2024';
  if (req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { email, plan } = req.body;
  if (!email || !plan) return res.status(400).json({ error: 'email and plan required' });
  const { userOps } = require('./db/database');
  const user = await userOps.getByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found - they need to sign up first' });
  await userOps.updatePlan(user.id, plan);
  res.json({ success: true, message: `${email} upgraded to ${plan}` });
});

// Admin endpoint - set user role by email (secured by admin secret)
app.post('/admin/set-role', async (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET || 'repurposeai-admin-2024';
  if (req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  const { userOps, adminOps } = require('./db/database');
  const user = await userOps.getByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found - they need to sign up first' });
  await adminOps.setUserRole(user.id, role);
  res.json({ success: true, message: `${email} role set to ${role}` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 Not Found</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0a0a;
          color: #e0e0e0;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
        }
        .container {
          text-align: center;
        }
        h1 {
          font-size: 48px;
          margin: 0;
          color: #6c5ce7;
        }
        p {
          font-size: 18px;
          color: #888;
          margin: 10px 0 30px;
        }
        a {
          display: inline-block;
          padding: 12px 24px;
          background: #6c5ce7;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          transition: all 0.3s;
        }
        a:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(108, 92, 231, 0.3);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404</h1>
        <p>Page not found</p>
        <a href="/">â Back to Home</a>
      </div>
    </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Start workflow engine for automated content repurposing
  startWorkflowEngine();

  // Start calendar reminder checker (every 2 minutes)
  const { calendarOps } = require('./db/database');
  const { sendPostingReminder } = require('./utils/email');

  setInterval(async () => {
    try {
      const pending = await calendarOps.getPendingReminders();
      for (const entry of pending) {
        try {
          await sendPostingReminder({
            email: entry.reminder_email,
            title: entry.title,
            platform: entry.platform,
            scheduledDate: (entry.scheduled_date || '').toString().substring(0, 10),
            scheduledTime: entry.scheduled_time
          });
          await calendarOps.markReminderSent(entry.id);
          console.log(`[Reminder] Sent to ${entry.reminder_email} for "${entry.title}"`);
        } catch (e) {
          console.error(`[Reminder] Failed for entry ${entry.id}:`, e.message);
        }
      }
    } catch (err) {
      // Silently ignore if DB not ready yet
    }
  }, 120000); // Check every 2 minutes
});
