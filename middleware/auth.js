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

  try {
    const decoded = verifyToken(token);
    if (!decoded) throw new Error('Invalid token');

    const user = await userOps.getById(decoded.id);
    if (!user) throw new Error('User not found');

    req.user = user;
    next();
  } catch (err) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    res.redirect('/auth/login');
  }
}

// Optional auth - attaches user if token present
function optionalAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = verifyToken(token);
      if (decoded) req.user = decoded;
    } catch (err) {}
  }
  next();
}

// Redirect if already logged in
function redirectIfAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = verifyToken(token);
      if (decoded) return res.redirect('/dashboard');
    } catch (err) {}
  }
  next();
}

// Plan limits - pricing tiers
// Narrations use customer's own ElevenLabs API key (no cost to us)
// Thumbnails use our Stability AI / DALL-E key (our cost)
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
    narrationsPerMonth: Infinity,
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
    videosPerMonth: 50,
    repurposesPerMonth: 100,
    brandVoices: 10,
    narrationsPerMonth: Infinity,
    thumbnailsPerMonth: 50,
    clipsPerMonth: 25,
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

// Check plan limit middleware (numeric limits)
function checkPlanLimit(limitKey) {
  return async (req, res, next) => {
    const limits = getPlanLimits(req.user.plan);
    const maxAllowed = limits[limitKey];
    if (maxAllowed === Infinity) return next();
    if (maxAllowed === 0) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not included in your ${req.user.plan || 'free'} plan. Upgrade to unlock it.`,
        upgradeUrl: '/billing',
        currentPlan: req.user.plan || 'free'
      });
    }
    next();
  };
}

// Middleware: check boolean feature flag
function requireFeature(featureKey) {
  return (req, res, next) => {
    const limits = getPlanLimits(req.user.plan);
    const allowed = limits[featureKey];
    if (allowed === false || allowed === 0) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not available on your ${req.user.plan || 'free'} plan. Please upgrade to access it.`,
        upgradeUrl: '/billing',
        currentPlan: req.user.plan || 'free'
      });
    }
    next();
  };
}

// Middleware: check usage count against plan limit
function checkUsageLimit(limitKey, countFn) {
  return async (req, res, next) => {
    const limits = getPlanLimits(req.user.plan);
    const maxAllowed = limits[limitKey];
    if (maxAllowed === Infinity) return next();
    if (maxAllowed === 0) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not included in your ${req.user.plan || 'free'} plan. Upgrade to unlock it.`,
        upgradeUrl: '/billing',
        currentPlan: req.user.plan || 'free'
      });
    }
    try {
      const count = await countFn(req.user.id);
      if (count >= maxAllowed) {
        return res.status(403).json({
          error: 'Usage limit reached',
          message: `You've used ${count}/${maxAllowed} allowed this month on your ${req.user.plan || 'free'} plan. Upgrade for more.`,
          upgradeUrl: '/billing',
          currentPlan: req.user.plan || 'free',
          used: count,
          allowed: maxAllowed
        });
      }
      next();
    } catch (err) {
      console.error(`Error checking ${limitKey} limit:`, err);
      next();
    }
  };
}

module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  redirectIfAuth,
  getPlanLimits,
  checkPlanLimit,
  requireFeature,
  checkUsageLimit
};
