const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { userOps } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'repurposeai-secret-key-change-in-production';

function authStyles() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@700;800&display=swap');
    :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0F0F1A;--dark-2:#1A1A2E;--surface:#1E1E32;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--error:#EF4444;--success:#10B981}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:var(--dark);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center}
    .auth-container{display:flex;width:100%;min-height:100vh}
    .auth-left{flex:1;display:flex;align-items:center;justify-content:center;padding:2rem}
    .auth-right{flex:1;background:var(--dark-2);display:flex;align-items:center;justify-content:center;padding:2rem;position:relative;overflow:hidden}
    .auth-right::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(108,58,237,0.15),transparent 70%)}
    .auth-right-content{position:relative;text-align:center;max-width:400px}
    .auth-right-content h2{font-family:'Playfair Display',serif;font-size:2.5rem;font-weight:800;margin-bottom:1rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .auth-right-content p{color:var(--text-muted);font-size:1rem;line-height:1.7}
    .auth-form-container{width:100%;max-width:420px}
    .auth-logo{font-family:'Playfair Display',serif;font-size:1.8rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-decoration:none;display:block;margin-bottom:2rem}
    .auth-form-container h1{font-size:1.8rem;font-weight:800;margin-bottom:.5rem}
    .auth-form-container .subtitle{color:var(--text-muted);margin-bottom:2rem;font-size:.95rem}
    .form-group{margin-bottom:1.2rem}
    .form-group label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.5rem;color:var(--text-muted)}
    .form-input{width:100%;padding:.9rem 1rem;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);font-size:.95rem;font-family:'Inter',sans-serif;outline:none;transition:border-color .3s}
    .form-input:focus{border-color:var(--primary)}
    .form-input::placeholder{color:var(--text-dim)}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:1rem;border-radius:50px;font-weight:600;font-size:1rem;cursor:pointer;border:none;transition:all .3s;font-family:'Inter',sans-serif}
    .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 20px rgba(108,58,237,0.4)}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 30px rgba(108,58,237,0.5)}
    .auth-footer{text-align:center;margin-top:1.5rem;font-size:.9rem;color:var(--text-muted)}
    .auth-footer a{color:var(--primary-light);text-decoration:none;font-weight:600}
    .auth-footer a:hover{text-decoration:underline}
    .error-msg{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:var(--error);padding:.8rem 1rem;border-radius:10px;font-size:.85rem;margin-bottom:1rem;display:none}
    .error-msg.show{display:block}
    .divider{display:flex;align-items:center;gap:1rem;margin:1.5rem 0;color:var(--text-dim);font-size:.85rem}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.08)}
    @media(max-width:768px){.auth-right{display:none}.auth-left{padding:1.5rem}}
  `;
}

function authPage(type) {
  const isLogin = type === 'login';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isLogin ? 'Log In' : 'Sign Up'} - RepurposeAI</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <style>${authStyles()}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-left">
      <div class="auth-form-container">
        <a href="/" class="auth-logo">&#x26A1; RepurposeAI</a>
        <h1>${isLogin ? 'Welcome Back' : 'Create Account'}</h1>
        <p class="subtitle">${isLogin ? 'Log in to your account to continue' : 'Start repurposing content in seconds'}</p>
        <div class="error-msg" id="errorMsg"></div>
        <form id="authForm" onsubmit="handleSubmit(event)">
          ${!isLogin ? '<div class="form-group"><label>Full Name</label><input type="text" class="form-input" name="name" placeholder="Enter your name" required></div>' : ''}
          <div class="form-group"><label>Email Address</label><input type="email" class="form-input" name="email" placeholder="Enter your email" required></div>
          <div class="form-group"><label>Password</label><input type="password" class="form-input" name="password" placeholder="${isLogin ? 'Enter your password' : 'Create a password (min 6 chars)'}" minlength="6" required></div>
          <button type="submit" class="btn btn-primary" id="submitBtn">${isLogin ? 'Log In' : 'Create Account'} &#x2192;</button>
        </form>
        <div class="auth-footer">
          ${isLogin ? 'Don\'t have an account? <a href="/auth/register">Sign up free</a>' : 'Already have an account? <a href="/auth/login">Log in</a>'}
        </div>
      </div>
    </div>
    <div class="auth-right">
      <div class="auth-right-content">
        <h2>${isLogin ? 'Your Content Studio Awaits' : 'Join 10,000+ Creators'}</h2>
        <p>${isLogin ? 'Pick up where you left off. Your AI-powered content engine is ready to create.' : 'Turn every YouTube video into content for Instagram, TikTok, Facebook, LinkedIn, and Twitter.'}</p>
      </div>
    </div>
  </div>
  <script>
    async function handleSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const btn = document.getElementById('submitBtn');
      const errorMsg = document.getElementById('errorMsg');
      errorMsg.classList.remove('show');
      btn.disabled = true; btn.textContent = 'Please wait...';

      const data = Object.fromEntries(new FormData(form));
      const isLogin = ${type === 'login' ? 'true' : 'false'};
      const endpoint = isLogin ? '/auth/api/login' : '/auth/api/register';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Something went wrong');
        if (result.token) {
          document.cookie = 'token=' + result.token + ';path=/;max-age=' + (7*24*60*60);
          window.location.href = '/dashboard';
        }
      } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.classList.add('show');
        btn.disabled = false;
        btn.innerHTML = (isLogin ? 'Log In' : 'Create Account') + ' &#x2192;';
      }
    }
  </script>
</body>
</html>`;
}

// Page routes
router.get('/login', (req, res) => res.send(authPage('login')));
router.get('/register', (req, res) => res.send(authPage('register')));

// API: Register
router.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = userOps.findByEmail(email);
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = userOps.create({ name: name || email.split('@')[0], email, password: hashedPassword });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// API: Login
router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = userOps.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

module.exports = router;
