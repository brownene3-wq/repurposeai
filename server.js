require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Import routes
const pagesRouter = require('./routes/pages');
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const billingRouter = require('./routes/billing');
const contactRouter = require('./routes/contact');
const repurposeRouter = require('./routes/repurpose');
const pricingRouter = require('./routes/pricing');
const analyticsRouter = require('./routes/analytics');
const scheduledRouter = require('./routes/scheduled');

// Routes - analytics and scheduled MUST be mounted before dashboard
app.use('/', pagesRouter);
app.use('/auth', authRouter);
app.use('/dashboard/analytics', analyticsRouter);
app.use('/dashboard/scheduled', scheduledRouter);
app.use('/dashboard', dashboardRouter);
app.use('/billing', billingRouter);
app.use('/contact', contactRouter);
app.use('/repurpose', repurposeRouter);
app.use(pricingRouter);

// Initialize database and start server
async function start() {
  try {
    await initDatabase();
    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err.message);
    console.log('Server will start without database - some features may not work');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();
