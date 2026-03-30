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

// Plan limits - Updated pricing tiers
const PLAN_LIMITS = {
  free: {
    videosPerMonth: 3,
    repurposesPerMonth: 5,
    brandVoices: 1,
    narrationsPerMonth: 0,
    thumbnailsPerMonth: 0,
    clipsPerMonth: 0,
    batchAnalysis: false,
    thumbnailAB: false,
    clipWithBroll: false,
    hasAnalytics: false,
    hasBrandKit: false,
    hasCalendarEdit: false,
    historyDays: 7,
    watermark: true
  },
  starter: {
    videosPerMonth: 15,
    repurposesPerMonth: 30,
    brandVoices: 3,
    narrationsPerMonth: 5,
    thumbnailsPerMonth: 10,
    clipsPerMonth: 5,
    batchAnalysis: false,
    thumbnailAB: false,
    clipWithBroll: false,
    hasAnalytics: true,
    hasBrandKit: true,
    hasCalendarEdit: true,
    historyDays: 30,
    watermark: false
  },
  pro: {
    videosPerMonth: Infinity,
    repurposesPerMonth: Infinity,
    brandVoices: 10,
    narrationsPerMonth: Infinity,
    thumbnailsPerMonth: Infinity,
    clipsPerMonth: Infinity,
    batchAnalysis: true,
    thumbnailAB: true,
    clipWithBroll: true,
    hasAnalytics: true,
    hasBrandKit: true,
    hasCalendarEdit: true,
    historyDays: Infinity,
    watermark: false
  }
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

// Generic plan limit checker - pass the limit key and current count
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
          message: `Your ${req.user.plan || 'free'} plan allows ${limits.videosPerMonth} videos per month. Upgrade for more.`,
          upgrade: true,
          currentPlan: req.user.plan || 'free'
        });
      }
    } catch (err) {
      console.error('Error checking plan limit:', err);
    }
  }
  req.planLimits = limits;
  next();
}

// Feature-specific middleware: check if a feature is available on the user's plan
function requireFeature(featureKey) {
  return (req, res, next) => {
    const limits = getPlanLimits(req.user.plan);
    const value = limits[featureKey];

    // Boolean features (e.g., batchAnalysis, thumbnailAB)
    if (value === false) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not available on your ${req.user.plan || 'free'} plan. Please upgrade to access it.`,
        upgrade: true,
        feature: featureKey,
        currentPlan: req.user.plan || 'free'
      });
    }

    // Numeric features with 0 limit (e.g., narrationsPerMonth: 0 for free)
    if (value === 0) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not included in your ${req.user.plan || 'free'} plan. Upgrade to Starter or Pro to unlock it.`,
        upgrade: true,
        feature: featureKey,
        currentPlan: req.user.plan || 'free'
      });
    }

    req.planLimits = limits;
    next();
  };
}

// Check a specific usage counter against its plan limit
function checkUsageLimit(limitKey, countFn) {
  return async (req, res, next) => {
    const limits = getPlanLimits(req.user.plan);
    const maxAllowed = limits[limitKey];

    if (maxAllowed === Infinity || maxAllowed === undefined) {
      req.planLimits = limits;
      return next();
    }

    if (maxAllowed === 0) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not included in your ${req.user.plan || 'free'} plan. Upgrade to unlock it.`,
        upgrade: true,
        currentPlan: req.user.plan || 'free'
      });
    }

    try {
      const count = await countFn(req.user.id);
      if (count >= maxAllowed) {
        return res.status(403).json({
          error: 'Usage limit reached',
          message: `You've used ${count}/${maxAllowed} allowed this month on your ${req.user.plan || 'free'} plan. Upgrade for more.`,
          upgrade: true,
          currentPlan: req.user.plan || 'free',
          used: count,
          limit: maxAllowed
        });
      }
    } catch (err) {
      console.error(`Error checking ${limitKey} limit:`, err);
    }

    req.planLimits = limits;
    next();
  };
}

module.exports = { generateToken, verifyToken, requireAuth, optionalAuth, redirectIfAuth, getPlanLimits, checkPlanLimit, requireFeature, checkUsageLimit };
