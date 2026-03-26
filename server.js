const express = require('express');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { initDatabase } = require('./db/database');

const app = express();

// Middleware - skip JSON parsing for Stripe webhook (needs raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/billing/webhook') return next();
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.originalUrl === '/billing/webhook') return next();
  express.urlencoded({ extended: true })(req, res, next);
});
app.use(cookieParser());

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
        <a href="/">← Back to Home</a>
      </div>
    </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
