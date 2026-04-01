const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { userOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const STRIPE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';

// Price ID mapping for tiers
const PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_1THUStLldgJv5lq6uzQGCicb',
  pro: process.env.STRIPE_PRICE_PRO || 'price_1THUVMLldgJv5lq6lXvOzEAH',
  teams: process.env.STRIPE_PRICE_TEAMS || 'price_1THUW4LldgJv5lq64EmlBemC'
};

// GET /billing - Billing management page
router.get('/', requireAuth, (req, res) => {
  const userPlan = req.user.plan || 'free';
  const html = `${getHeadHTML('Billing')}
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&display=swap');
      ${getBaseCSS()}
      .billing-page{max-width:1100px;margin:0 auto;padding:3rem 2rem}
      .back-link{color:var(--primary-light);text-decoration:none;font-size:.9rem;font-weight:500;display:inline-flex;align-items:center;gap:.5rem}
      .back-link:hover{text-decoration:underline}
      .page-header{margin-bottom:3rem}
      .page-header h1{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:800;margin-bottom:.5rem}
      .page-header p{color:var(--text-muted);font-size:1rem}
      .current-plan{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:2rem;display:flex;align-items:center;justify-content:space-between}
      .plan-info h3{font-size:1.1rem;font-weight:700;margin-bottom:.3rem}
      .plan-info p{color:var(--text-muted);font-size:.9rem}
      .plan-badge{padding:.4rem 1rem;border-radius:50px;font-size:.8rem;font-weight:600;background:rgba(16,185,129,0.15);color:var(--success)}
      .pricing-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1.2rem;margin-bottom:3rem}
      .price-card{background:var(--surface);border-radius:16px;padding:1.8rem;border:var(--border-subtle);transition:all .3s;position:relative}
      .price-card.featured{border-color:var(--primary);box-shadow:0 0 40px rgba(108,58,237,0.2);transform:scale(1.02)}
      .price-card.featured::before{content:'MOST POPULAR';position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--gradient-1);color:#fff;padding:.3rem 1rem;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.5px}
      .price-card h3{font-size:1.05rem;font-weight:700;margin-bottom:.5rem}
      .price-card .price{font-size:2.2rem;font-weight:800;margin:.8rem 0}
      .price-card .price span{font-size:.85rem;font-weight:400;color:var(--text-muted)}
      .price-card .desc{color:var(--text-muted);font-size:.82rem;margin-bottom:1.2rem}
      .features-list{list-style:none;margin-bottom:1.5rem}
      .features-list li{padding:.35rem 0;color:var(--text-muted);font-size:.8rem;display:flex;align-items:center;gap:.5rem}
      .features-list li::before{content:'\\2713';color:var(--primary-light);font-weight:700;font-size:.85rem}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.8rem;border-radius:50px;font-weight:600;font-size:.85rem;cursor:pointer;border:none;transition:all .3s}
      .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
      .btn-primary:hover{transform:translateY(-1px)}
      .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.15)}
      .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
      .btn-current{background:rgba(16,185,129,0.15);color:var(--success);border:1px solid rgba(16,185,129,0.3);cursor:default}
      @media(max-width:900px){.pricing-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:768px){.billing-page{margin-left:0 !important;padding:1rem !important;padding-top:3.5rem !important}.page-header h1{font-size:1.4rem}}
      @media(max-width:600px){.pricing-grid{grid-template-columns:1fr}.price-card.featured{transform:none}.current-plan{flex-direction:column;text-align:center;gap:1rem}}
    </style>
  </head>
  <body>
  <div class="dashboard">
    ${getSidebar('billing', req.user)}
    ${getThemeToggle()}
    <div class="billing-page main-content" style="margin-left:250px">
      <a href="/dashboard" class="back-link">&#x2190; Back to Dashboard</a>
      <div class="page-header">
        <h1>Billing & Plans</h1>
        <p>Manage your subscription and billing details</p>
      </div>

      <div class="current-plan">
        <div class="plan-info">
          <h3>Current Plan: ${userPlan.charAt(0).toUpperCase() + userPlan.slice(1)}</h3>
          <p>${userPlan === 'free' ? 'Upgrade to unlock more features' : userPlan === 'starter' ? 'Great for growing creators' : userPlan === 'pro' ? 'You have full access to all features' : 'Team plan with priority processing'}</p>
        </div>
        <div class="plan-badge">${userPlan.toUpperCase()}</div>
      </div>

      <div class="pricing-grid">
        <div class="price-card">
          <h3>Free</h3>
          <div class="price">$0<span>/month</span></div>
          <p class="desc">Get started with the basics</p>
          <ul class="features-list">
            <li>3 videos/month</li>
            <li>5 repurposes/month</li>
            <li>1 brand voice</li>
            <li>7-day history</li>
            <li>Watermarked exports</li>
          </ul>
          ${userPlan === 'free' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-outline" disabled>Free Tier</button>'}
        </div>

        <div class="price-card${userPlan === 'free' ? ' featured' : ''}">
          <h3>Starter</h3>
          <div class="price">$19<span>/month</span></div>
          <p class="desc">Perfect for consistent creators</p>
          <ul class="features-list">
            <li>15 videos/month</li>
            <li>30 repurposes/month</li>
            <li>3 brand voices</li>
            <li>Quick Narrate (your API key)</li>
            <li>10 AI thumbnails/month</li>
            <li>30 clips/month</li>
            <li>Analytics dashboard</li>
            <li>Brand kit & calendar</li>
            <li>30-day history</li>
            <li>No watermark</li>
          </ul>
          ${userPlan === 'starter' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-primary" onclick="handleCheckout(&apos;starter&apos;)">Upgrade to Starter</button>'}
        </div>

        <div class="price-card${userPlan === 'starter' ? ' featured' : ''}">
          <h3>Pro</h3>
          <div class="price">$39<span>/month</span></div>
          <p class="desc">For creators serious about growth</p>
          <ul class="features-list">
            <li>50 videos/month</li>
            <li>100 repurposes/month</li>
            <li>10 brand voices</li>
            <li>Unlimited AI narrations</li>
            <li>50 AI thumbnails/month</li>
            <li>150 clips/month</li>
            <li>Batch analysis</li>
            <li>A/B thumbnail testing</li>
            <li>Clips with B-roll</li>
            <li>Full analytics & calendar</li>
            <li>Unlimited history</li>
          </ul>
          ${userPlan === 'pro' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-primary" onclick="handleCheckout(&apos;pro&apos;)">Upgrade to Pro</button>'}
        </div>

        <div class="price-card">
          <h3>Teams</h3>
          <div class="price">$79<span>/month</span></div>
          <p class="desc">Scale with your whole team</p>
          <ul class="features-list">
            <li>200 videos/month</li>
            <li>500 repurposes/month</li>
            <li>25 brand voices</li>
            <li>Unlimited AI narrations</li>
            <li>150 AI thumbnails/month</li>
            <li>500 clips/month</li>
            <li>5 team seats</li>
            <li>Priority processing</li>
            <li>Batch analysis</li>
            <li>A/B thumbnail testing</li>
            <li>Clips with B-roll</li>
            <li>Full analytics & calendar</li>
            <li>Unlimited history</li>
          </ul>
          ${userPlan === 'teams' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-primary" onclick="handleCheckout(&apos;teams&apos;)">Upgrade to Teams</button>'}
        </div>
      </div>
    </div>
    </div>
    <script>${getThemeScript()}</script>
    <div id="checkoutMsg" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:2rem 2.5rem;max-width:420px;width:90%;text-align:center;z-index:9999;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      <div id="checkoutMsgIcon" style="font-size:2rem;margin-bottom:.8rem"></div>
      <div id="checkoutMsgText" style="font-size:.95rem;color:var(--text-muted);line-height:1.5"></div>
      <button onclick="document.getElementById('checkoutMsg').style.display='none';document.getElementById('checkoutOverlay').style.display='none'" style="margin-top:1.2rem;padding:.6rem 2rem;border-radius:50px;border:none;background:var(--gradient-1);color:#fff;font-weight:600;cursor:pointer;font-size:.85rem">OK</button>
    </div>
    <div id="checkoutOverlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9998"></div>
    <script>
      function showCheckoutMsg(icon, text) {
        document.getElementById('checkoutMsgIcon').innerHTML = icon;
        document.getElementById('checkoutMsgText').innerHTML = text;
        document.getElementById('checkoutMsg').style.display = 'block';
        document.getElementById('checkoutOverlay').style.display = 'block';
      }

      // Handle success/canceled URL params from Stripe redirect
      (function() {
        var params = new URLSearchParams(window.location.search);
        if (params.get('success') === 'true') {
          showCheckoutMsg('&#x2705;', 'Payment successful! Your plan has been upgraded. It may take a moment to reflect.');
          history.replaceState({}, '', '/billing');
        } else if (params.get('canceled') === 'true') {
          showCheckoutMsg('&#x274C;', 'Checkout was canceled. No charges were made.');
          history.replaceState({}, '', '/billing');
        }
      })();

      async function handleCheckout(plan) {
        try {
          const btn = event.target;
          btn.disabled = true;
          btn.innerHTML = 'Processing...';
          const res = await fetch('/billing/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan })
          });
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            btn.disabled = false;
            btn.innerHTML = 'Upgrade to ' + plan.charAt(0).toUpperCase() + plan.slice(1);
            showCheckoutMsg('&#x26A0;&#xFE0F;', data.message || 'Could not start checkout. Please try again.');
          }
        } catch (err) {
          showCheckoutMsg('&#x26A0;&#xFE0F;', 'Error connecting to payment system. Please try again.');
        }
      }
    </script>
  </body>
</html>`;
  res.send(html);
});

// Create Stripe Checkout Session
router.post('/create-checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const validPlans = ['starter', 'pro', 'teams'];

    if (!validPlans.includes(plan)) {
      return res.json({ message: 'Invalid plan selected.' });
    }

    if (!STRIPE_SECRET) {
      return res.json({ message: 'Payment system is being configured. Please check back soon!' });
    }

    if (!PRICE_MAP[plan]) {
      console.warn(`Stripe price ID not configured for plan: ${plan}. Set STRIPE_PRICE_${plan.toUpperCase()} env var.`);
      return res.json({ message: 'This plan is not yet available for purchase. Please contact support@repurposeai.ai for assistance.' });
    }

    const stripe = require('stripe')(STRIPE_SECRET);
    const priceId = PRICE_MAP[plan];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: req.user.email,
      success_url: process.env.APP_URL + '/billing?success=true',
      cancel_url: process.env.APP_URL + '/billing?canceled=true',
      metadata: { userId: req.user.id.toString(), plan }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ message: 'Failed to create checkout session' });
  }
});

// Stripe Webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = require('stripe')(STRIPE_SECRET);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_email || session.customer_details?.email;
        if (customerEmail) {
          const user = await userOps.getByEmail(customerEmail);
          if (user) {
            let plan = session.metadata?.plan;
            if (!plan) {
              const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
              const priceId = lineItems.data[0]?.price?.id;
              if (priceId === PRICE_MAP.starter) plan = 'starter';
              else if (priceId === PRICE_MAP.pro) plan = 'pro';
              else if (priceId === PRICE_MAP.teams) plan = 'teams';
            }
            if (plan) {
              await userOps.updatePlan(user.id, plan);
              console.log(`Upgraded ${customerEmail} to ${plan} plan`);
            }
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customer = await stripe.customers.retrieve(subscription.customer);
        if (customer.email) {
          const user = await userOps.getByEmail(customer.email);
          if (user) {
            await userOps.updatePlan(user.id, 'free');
            console.log(`Downgraded ${customer.email} to free plan`);
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.json({ received: true });
});

module.exports = router;
