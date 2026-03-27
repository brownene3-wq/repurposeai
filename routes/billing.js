const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { userOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const STRIPE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';

router.get('/', requireAuth, (req, res) => {
  const html = `${getHeadHTML('Billing')}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&display=swap');
    ${getBaseCSS()}
    .billing-page{max-width:900px;margin:0 auto;padding:3rem 2rem}
    .back-link{color:var(--primary-light);text-decoration:none;font-size:.9rem;font-weight:500;display:inline-flex;align-items:center;gap:.5rem;margin-bottom:2rem}
    .back-link:hover{text-decoration:underline}
    .page-header{margin-bottom:3rem}
    .page-header h1{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:800;margin-bottom:.5rem}
    .page-header p{color:var(--text-muted);font-size:1rem}
    .current-plan{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center}
    .plan-info h3{font-size:1.1rem;font-weight:700;margin-bottom:.3rem}
    .plan-info p{color:var(--text-muted);font-size:.9rem}
    .plan-badge{padding:.4rem 1rem;border-radius:50px;font-size:.8rem;font-weight:600;background:rgba(16,185,129,0.15);color:var(--success);border:1px solid rgba(16,185,129,0.3)}
    .pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin-bottom:3rem}
    .price-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);transition:all .3s;position:relative}
    .price-card.featured{border-color:var(--primary);box-shadow:0 0 40px rgba(108,58,237,0.2);transform:scale(1.02)}
    .price-card.featured::before{content:'RECOMMENDED';position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--gradient-1);padding:.25rem 1rem;border-radius:50px;font-size:.7rem;font-weight:700;letter-spacing:.08em}
    .price-card h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
    .price-card .price{font-size:2.5rem;font-weight:800;margin:.8rem 0}
    .price-card .price span{font-size:.9rem;font-weight:400;color:var(--text-muted)}
    .price-card .desc{color:var(--text-muted);font-size:.85rem;margin-bottom:1.2rem}
    .features-list{list-style:none;margin-bottom:1.5rem}
    .features-list li{padding:.4rem 0;color:var(--text-muted);font-size:.85rem;display:flex;align-items:center;gap:.5rem}
    .features-list li::before{content:'✓';color:var(--primary-light);font-weight:700;font-size:.9rem}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;text-decoration:none}
    .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
    .btn-primary:hover{transform:translateY(-1px)}
    .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.15)}
    .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
    .btn-current{background:rgba(16,185,129,0.15);color:var(--success);border:1px solid rgba(16,185,129,0.3);cursor:default}
    @media(max-width:768px){.pricing-grid{grid-template-columns:1fr}.price-card.featured{transform:none}.current-plan{flex-direction:column;gap:1rem;text-align:center}}
  </style>
</head>
<body>
  ${getSidebar('billing')}
  ${getThemeToggle()}
  <div class="billing-page" style="margin-left:250px">
    <a href="/dashboard" class="back-link">&#x2190; Back to Dashboard</a>
    <div class="page-header">
      <h1>&#x1F4B3; Billing & Plans</h1>
      <p>Choose the plan that fits your content needs.</p>
    </div>

    <div class="current-plan">
      <div class="plan-info">
        <h3>Current Plan: ${req.user.plan === 'pro' ? 'Pro' : req.user.plan === 'enterprise' ? 'Enterprise' : 'Free Starter'}</h3>
        <p>${req.user.plan === 'pro' ? 'Unlimited videos, all 7 platforms, analytics' : req.user.plan === 'enterprise' ? 'Everything in Pro, unlimited brand voices' : '3 videos per month, all 7 platforms'}</p>
      </div>
      <span class="plan-badge">Active</span>
    </div>
    ${req.query.success ? '<div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:1rem 1.5rem;margin-bottom:2rem;color:#10B981;font-weight:500">Payment successful! Your plan has been upgraded.</div>' : ''}
    ${req.query.canceled ? '<div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:1rem 1.5rem;margin-bottom:2rem;color:#EF4444;font-weight:500">Payment was canceled. No charges were made.</div>' : ''}

    <div class="pricing-grid">
      <div class="price-card">
        <h3>Starter</h3>
        <div class="price">Free</div>
        <p class="desc">Perfect for getting started</p>
        <ul class="features-list">
          <li>3 videos per month</li>
          <li>All 7 platforms</li>
          <li>AI-generated content</li>
          <li>Copy &amp; share content</li>
          <li>Content library</li>
        </ul>
        ${req.user.plan === 'free' || !req.user.plan ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-outline" disabled>Free Tier</button>'}
      </div>
      <div class="price-card featured">
        <h3>Pro</h3>
        <div class="price">$29<span>/month</span></div>
        <p class="desc">For creators serious about growth</p>
        <ul class="features-list">
          <li>Unlimited videos</li>
          <li>All 7 platforms</li>
          <li>Advanced AI with tone control</li>
          <li>Up to 10 brand voice profiles</li>
          <li>Hashtag optimization</li>
          <li>Analytics dashboard</li>
          <li>Content calendar</li>
        </ul>
        ${req.user.plan === 'pro' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<button class="btn btn-primary" onclick="upgradePlan(\'pro\')">Upgrade to Pro &#x2192;</button>'}
      </div>
      <div class="price-card">
        <h3>Enterprise</h3>
        <div class="price">Custom</div>
        <p class="desc">For agencies and teams</p>
        <ul class="features-list">
          <li>Everything in Pro</li>
          <li>Unlimited brand voices</li>
          <li>Unlimited videos</li>
          <li>Content calendar view</li>
          <li>Priority email support</li>
          <li>Custom onboarding</li>
        </ul>
        ${req.user.plan === 'enterprise' ? '<button class="btn btn-current">&#x2713; Current Plan</button>' : '<a href="/contact" class="btn btn-outline">Contact Sales</a>'}
      </div>
    </div>
  </div>

  <script>
    ${getThemeScript()}
    async function upgradePlan(plan) {
      try {
        const res = await fetch('/billing/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan })
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else if (data.message) {
          alert(data.message);
        } else {
          alert('Could not start checkout. Please try again.');
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
    
    const stripe = require('stripe')(STRIPE_SECRET);
    const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ENTERPRISE;
    
    if (!priceId) {
      return res.json({ message: 'This plan is being set up. Please contact support.' });
    }
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (process.env.APP_URL || 'https://repurposeai.ai') + '/billing?success=true',
      cancel_url: (process.env.APP_URL || 'https://repurposeai.ai') + '/billing?canceled=true',
      customer_email: req.user.email
    });
    
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_SECRET) return res.status(400).send('Stripe not configured');

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
            // Determine which plan based on the price
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
            const priceId = lineItems.data[0]?.price?.id;
            let plan = 'pro';
            if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) plan = 'enterprise';
            await userOps.updatePlan(user.id, plan);
            console.log(`Upgraded ${customerEmail} to ${plan} plan`);
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        // Downgrade to free when subscription is canceled
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
