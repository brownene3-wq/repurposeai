require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initializeDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000

// ============================================
// MIDDLEWARE
// ============================================

// Security headers (relaxed for development)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

// Auth rate limiting (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});
app.use('/api/auth/', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// ROUTES
// ============================================

const pagesRouter = require('./routes/pages');
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const billingRouter = require('./routes/billing');
const contactRouter = require('./routes/contact');

app.use(pagesRouter);
app.use(authRouter);
app.use(dashboardRouter);
app.use(billingRouter);
app.use(contactRouter);

// ===========================================
// API: Health Check
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ============================================
// ERROR HANDLING
// ============================================

// 404
app.use((req, res) => {
  res.status(404).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>404 â RepurposeAI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#06060f;color:#f0f0ff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.c{max-width:480px;padding:40px}.icon{font-size:5rem;margin-bottom:20px;opacity:.4}h1{font-size:2.5rem;font-weight:800;margin-bottom:10px;background:linear-gradient(135deg,#7c3aed,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#a0a0c0;margin-bottom:28px;line-height:1.7}a{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;border-radius:99px;font-weight:700;text-decoration:none;transition:all .3s}
a:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,.5)}
</style></head><body>
<div class="c"><div class="icon">&#128270;</div><h1>404</h1><p>The page you're looking for doesn't exist or has been moved.</p><a href="/">Back to Home</a></div>
</body></html>`);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// INITIALIZE & START
// ============================================

async function start() {
  await initializeDatabase();
  app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ââââââââââââââââââââââââââââââââââââââââââââ');
  console.log('  â                                          â');
  console.log('  â      RepurposeAI Server Running          â');
  console.log('  â                                          â');
  console.log(`  â      http://localhost:${PORT}              â`);
  console.log('  â                                          â');
  console.log('  ââââââââââââââââââââââââââââââââââââââââââââ');
  console.log('');
  console.log('  Routes:');
  console.log('  âââ /              Landing page');
  console.log('  âââ /signup        Create account');
  console.log('  âââ /login         Log in');
  console.log('  âââ /dashboard     User dashboard');
  console.log('  âââ /pricing       Pricing plans');
  console.log('  âââ /contact       Contact form');
  console.log('  âââ /api/health    Health check');
  console.log('');
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });

module.exports = app;
