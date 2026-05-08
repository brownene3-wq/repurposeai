// middleware/credits.js
// Phase 1 — unified credit metering.
//
// Reads the user's monthly usage (auto-resetting if the period rolled over),
// blocks the request if used + cost would exceed the plan cap, then attaches
// a deferred deduction that runs once the response has finished successfully.
// On 5xx / failed responses the deduction is skipped so users aren't charged
// for jobs that errored out on our side.

const { creditOps } = require('../db/database');

// Cost table — keep in sync with the comparison sheet.
// Format: feature key -> credits per action.
const COSTS = {
  'smart-shorts': 10,
  'ai-reframe':   5,
  'enhance-audio': 3,
  'ai-captions':  2,
  'ai-thumbnail': 2,
  'ai-hook':      1
};

// Plan cap table. These should be the authoritative caps; the dashboard
// should read from here too.
// Canonical plan set: free, starter, pro, teams (matches Stripe PRICE_MAP in routes/billing.js).
// 'enterprise' is NOT a real plan in this app — kept as a soft alias for safety.
const CAPS = {
  free: 25,
  starter: 50,
  pro: 100,
  teams: 500,
  // Legacy alias — kept only because old code referenced it.
  enterprise: 500
};

function capFor(plan) {
  if (plan && Object.prototype.hasOwnProperty.call(CAPS, plan)) return CAPS[plan];
  return CAPS.free;
}

function costFor(featureKey) {
  if (!Object.prototype.hasOwnProperty.call(COSTS, featureKey)) {
    throw new Error(`Unknown credit feature key: ${featureKey}`);
  }
  return COSTS[featureKey];
}

// Express middleware factory.
// Usage: router.post('/x', requireAuth, requireCredits('smart-shorts'), handler)
function requireCredits(featureKey) {
  const cost = costFor(featureKey);

  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      // Should never happen if requireAuth ran first, but fail safe.
      return res.status(401).json({ error: 'Authentication required' });
    }

    let usage;
    try {
      usage = await creditOps.getOrResetUsage(req.user.id);
    } catch (err) {
      console.error('[credits] failed to read usage:', err);
      // Fail open so a transient DB blip doesn't lock users out of the product.
      // Audit logs in DB will catch any abuse on the missed-charge side.
      return next();
    }

    if (!usage) {
      console.warn('[credits] no user row for', req.user.id);
      return next();
    }

    const cap = capFor(usage.plan);
    if (usage.used + cost > cap) {
      return res.status(402).json({
        error: 'Credits exhausted',
        message: `You've used ${usage.used}/${cap} credits this month on the ${usage.plan || 'free'} plan. ` +
                 `${featureKey} costs ${cost} credits — upgrade your plan to continue.`,
        feature: featureKey,
        cost,
        used: usage.used,
        cap,
        upgradeUrl: '/billing'
      });
    }

    // Defer the deduction until we know the request succeeded.
    // res.on('finish') fires after headers + body are sent. We treat 2xx/3xx
    // as success; 4xx/5xx skip the charge.
    let charged = false;
    res.on('finish', async () => {
      if (charged) return;
      charged = true;
      if (res.statusCode >= 200 && res.statusCode < 400) {
        try {
          await creditOps.incrementUsage(req.user.id, cost);
        } catch (err) {
          console.error('[credits] increment failed:', err);
        }
      }
    });

    // Stash so the handler can see what was billed if it cares.
    req.credits = { feature: featureKey, cost, used: usage.used, cap };
    next();
  };
}

module.exports = {
  requireCredits,
  COSTS,
  CAPS,
  capFor,
  costFor
};
