const express = require('express'); // v1.0.1
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { initDatabase } = require('./db/database');

const app = express();
const { injectChatWidget } = require('./middleware/chatWidget');

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

// Disable caching on HTML pages so browser refresh always fetches fresh content
app.disable('etag');
app.use((req, res, next) => {
  // Only set no-cache for HTML page requests (not API/JSON or static assets)
  const isApiRequest = req.path.includes('/api/') || req.path === '/billing/webhook';
  const isStreamRequest = req.path.includes('/process-stream');
  if (!isApiRequest && !isStreamRequest) {
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
app.use(pricingRouter);
app.use('/chatbot', chatbotRouter);
app.use('/shorts', shortsRouter);

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
