const jwt = require('jsonwebtoken');
const { userOps } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRY = '7d';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Middleware: require authentication
async function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/auth/login');
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.clearCookie('token');
    if (req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.redirect('/auth/login');
  }

  const user = await userOps.getById(decoded.id);
  if (!user) {
    res.clearCookie('token');
    return res.redirect('/auth/login');
  }

  req.user = user;
  next();
}

// Middleware: optional auth (sets req.user if logged in)
async function optionalAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = await userOps.getById(decoded.id);
    }
  }
  next();
}

// Middleware: redirect if already logged in
function redirectIfAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      return res.redirect('/dashboard');
    }
  }
  next();
}

// Plan limits
const PLAN_LIMITS = {
  free:       { videosPerMonth: 3, brandVoices: 1, hasAnalytics: false },
  starter:    { videosPerMonth: 3, brandVoices: 1, hasAnalytics: false },
  pro:        { videosPerMonth: Infinity, brandVoices: 10, hasAnalytics: true },
  enterprise: { videosPerMonth: Infinity, brandVoices: Infinity, hasAnalytics: true }
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

async function checkPlanLimit(req, res, next) {
  const limits = getPlanLimits(req.user.plan);
  const { contentOps } = require('../db/database');

  // Check monthly video limit
  if (limits.videosPerMonth !== Infinity) {
    try {
      const count = await contentOps.countByUserIdThisMonth(req.user.id);
      if (count >= limits.videosPerMonth) {
        return res.status(403).json({
          error: 'Plan limit reached',
          message: `Your free plan allows ${limits.videosPerMonth} videos per month. Upgrade to Pro for unlimited videos.`,
          upgrade: true
        });
      }
    } catch (err) {
      console.error('Error checking plan limit:', err);
    }
  }
  req.planLimits = limits;
  next();
}

module.exports = { generateToken, verifyToken, requireAuth, optionalAuth, redirectIfAuth, getPlanLimits, checkPlanLimit };
