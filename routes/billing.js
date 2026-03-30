const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { userOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const STRIPE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';

// Price ID mapping for tiers
const PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO
};

// GET /billing - Billing management page
router.get('/', requireAuth, (req, res) => {
  const userPlan = req.user.plan || 'free';
  const html = `${getHeadHTML('Billing')}
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&display=swap');
      ${getBaseCSS()}
      .billing-page{max-width:900px;margin:0 auto;padding:3rem 2rem}
      .back-link{color:var(--primary-light);text-decoration:none;font-size:.9rem;font-weight:500;display:inline-flex;align-items:center;gap:.5rem}
      .back-link:hover{text-decoration:underline}
      .page-header{margin-bottom:3rem}
      .page-header h1{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:800;margin-bottom:.5rem}
      .page-header p{color:var(--text-muted);font-size:1rem}
      .current-plan{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:2rem;display:flex;align-items:center;justify-content:space-between}
      .plan-info h3{font-size:1.1rem;font-weight:700;margin-bottom:.3rem}
      .plan-info p{color:var(--text-muted);font-size:.9rem}
      .plan-badge{padding:.4rem 1rem;border-radius:50px;font-size:.8rem;font-weight:600;background:rgba(16,185,129,0.15);color:var(--success)}
      .pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin-bottom:3rem}
      .price-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);transition:all .3s;position:relative}
      .price-card.featured{border-color:var(--primary);box-shadow:0 0 40px rgba(108,58,237,0.2);transform:scale(1.02)}
      .price-card.featured::before{content:'BEST VALUE';position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--gradient-1);color:#fff;padding:.3rem 1rem;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.5px}
      .price-card h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
      .price-card .price{font-size:2.5rem;font-weight:800;margin:.8rem 0}
      .price-card .price span{font-size:.9rem;font-weight:400;color:var(--text-muted)}
      .price-card .desc{color:var(--text-muted);font-size:.85rem;margin-bottom:1.2rem}
      .features-list{list-style:none;margin-bottom:1.5rem}
      .features-list li{padding:.4rem 0;color:var(--text-muted);font-size:.85rem;display:flex;align-items:center;gap:.5rem}
      .features-list li::before{content:'\2713';color:var(--primary-light);font-weight:700;font-size:.9rem}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s}
      .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
      .btn-primary:hover{transform:translateY(-1px)}
      .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.15)}
      .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
      .btn-current{background:rgba(16,185,129,0.15);color:var(--success);border:1px solid rgba(16,185,129,0.3);cursor:default}
      @media(max-width:768px){.pricing-grid{grid-template-columns:1fr}.price-card.featured{transform:none}.current-plan{flex-direction:column;text-align:center;gap:1rem}}
    </style>
    </head>
    <body>
    ${getSidebar('billing')}
    ${getThemeToggle()}
    <div class="billing-page" style="margin-left:250px">
      <a href="/dashboard" class="back-link">&#x2190; Back to Dashboard</a>
      <div class="page-header">
        <h1>Billing & Plans</h1>
        <p>Manage your subscription and billing details</p>
      </div>
      <div class="current-plan">
        <div class="plan-info">
          <h3>Current Plan: ${userPlan.charAt(0).toUpperCase() + userPlan.slice(1)}</h3>
          <p>${userPlan === 'free' ? 'Upgrade to unlock more features' : userPlan === 'starter' ? 'Great for growing creators' : 'You have full access to all features'}</p>
        </div>
        <div class="plan-badge">${userPlan.toUpperCase()}</div>
      </div>
      <div class="pricing-grid">
        <div class="price-card">
          <h3>Free</h3>
          <div class="price">$0<span>/month</span></div>
          <p class="desc">Get started with the basics</p>
          <ul class="features-list">
            <li>3 Smart Shorts/month</li>
            <li>5 repurposes/month</li>
            <li>1 brand voice</li>
            <li>7-day history</li>
            <li>Watermarked exports</li>
          </ul>
          ${userPlan === 'free' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-outline" disabled>Free Tier</button>'}
        </div>
        <div class="price-card featured">
          <h3>Starter</h3>
          <div class="price">$19<span>/month</span></div>
          <p class="desc">Perfect for consistent creators</p>
          <ul class="features-list">
            <li>15 Smart Shorts/month</li>
            <li>30 repurposes/month</li>
            <li>3 brand voices</li>
            <li>5 AI narrations/month</li>
            <li>10 AI thumbnails/month</li>
            <li>5 clips/month</li>
            <li>Analytics dashboard</li>
            <li>Brand kit & calendar</li>
            <li>30-day history</li>
            <li>No watermark</li>
          </ul>
          ${userPlan === 'starter' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-primary" onclick="handleCheckout(\'starter\')">Upgrade to Starter</button>'}
        </div>
        <div class="price-card">
          <h3>Pro</h3>
          <div class="price">$39<span>/month</span></div>
          <p class="desc">For creators serious about growth</p>
          <ul class="features-list">
            <li>50 Smart Shorts/month</li>
            <li>100 repurposes/month</li>
            <li>10 brand voices</li>
            <li>Unlimited AI narrations</li>
            <li>50 AI thumbnails/month</li>
            <li>25 clips/month</li>
            <li>Batch analysis</li>
            <li>A/B thumbnail testing</li>
            <li>Clips with B-roll</li>
            <li>Full analytics & calendar</li>
            <li>Unlimited history</li>
          </ul>
          ${userPlan === 'pro' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-primary" onclick="handleCheckout(\'pro\')">Upgrade to Pro</button>'}
        </div>
      </div>
    </div>
    ${getThemeScript()}
    <script>
      async function handleCheckout(plan) {
        try {
          const res = await fetch('/billing/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan })
          });
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            alert(data.message || 'Could not start checkout. Please try again.');
          }
        } catch (err) {
          alert('Error connecting to payment system. Please try again.');
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
    if (!STRIPE_SECRET) {
      return res.json({ message: 'Payment system is being configured. Please check back soon!' });
    }
    if (!PRICE_MAP[plan]) {
      return res.json({ message: 'Invalid plan selected.' });
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
              if (priceId === process.env.STRIPE_PRICE_STARTER) plan = 'starter';
              else if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'pro';
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
