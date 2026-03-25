const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// Route imports
const pagesRouter = require('./routes/pages');
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const billingRouter = require('./routes/billing');
const contactRouter = require('./routes/contact');
const repurposeRouter = require('./routes/repurpose');
const { initializeDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// CORS for API routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Routes
app.use('/', pagesRouter);
app.use('/auth', authRouter);
app.use('/dashboard', dashboardRouter);
app.use('/billing', billingRouter);
app.use('/contact', contactRouter);
app.use('/repurpose', repurposeRouter);

// Redirect /pricing to /billing
app.get('/pricing', (req, res) => res.redirect('/billing'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', service: 'RepurposeAI' });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('RepurposeAI v2.0.0 running on port ' + PORT);
    console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
