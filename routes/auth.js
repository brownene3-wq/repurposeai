const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const { userOps } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'repurposeai-secret-key-change-in-production';
const BASE_URL = process.env.BASE_URL || 'https://repurposeai.ai';

// OAuth Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || '';
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';

// Helper: make HTTPS POST request
function httpsPost(url, data, headers) {
 return new Promise((resolve, reject) => {
  const body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
  const parsed = new URL(url);
  const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers } };
  const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d)); } }); });
  req.on('error', reject);
  req.write(body);
  req.end();
 });
}

// Helper: make HTTPS GET request
function httpsGet(url, headers) {
 return new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers: headers || {} };
  const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d)); } }); });
  req.on('error', reject);
  req.end();
 });
}

// Helper: find or create OAuth user
function findOrCreateOAuthUser(email, name) {
 let user = userOps.findByEmail(email);
 if (!user) {
  const randomPass = 'OAUTH_' + require('crypto').randomBytes(32).toString('hex');
  user = userOps.create(email, randomPass, name || email.split('@')[0]);
 }
 return user;
}

// Helper: issue JWT and redirect to dashboard
function loginAndRedirect(res, user) {
 const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
 res.cookie('token', token, { httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
 res.redirect('/dashboard');
}

// ========== GOOGLE OAUTH ==========
router.get('/google', (req, res) => {
 if (!GOOGLE_CLIENT_ID) return res.status(500).send('Google OAuth not configured. Set GOOGLE_CLIENT_ID env var.');
 const params = new URLSearchParams({
  client_id: GOOGLE_CLIENT_ID,
  redirect_uri: BASE_URL + '/auth/google/callback',
  response_type: 'code',
  scope: 'openid email profile',
  access_type: 'offline',
  prompt: 'consent'
 });
 res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

router.get('/google/callback', async (req, res) => {
 try {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login?error=Google+login+cancelled');

  const tokenData = await httpsPost('https://oauth2.googleapis.com/token', {
   code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
   redirect_uri: BASE_URL + '/auth/google/callback', grant_type: 'authorization_code'
  });

  if (!tokenData.access_token) return res.redirect('/auth/login?error=Google+auth+failed');

  const profile = await httpsGet('https://www.googleapis.com/oauth2/v2/userinfo', {
   Authorization: 'Bearer ' + tokenData.access_token
  });

  if (!profile.email) return res.redirect('/auth/login?error=Could+not+get+email+from+Google');

  const user = findOrCreateOAuthUser(profile.email, profile.name);
  loginAndRedirect(res, user);
 } catch (err) {
  console.error('Google OAuth error:', err);
  res.redirect('/auth/login?error=Google+login+failed');
 }
});

// ========== MICROSOFT OAUTH ==========
router.get('/microsoft', (req, res) => {
 if (!MICROSOFT_CLIENT_ID) return res.status(500).send('Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID env var.');
 const params = new URLSearchParams({
  client_id: MICROSOFT_CLIENT_ID,
  redirect_uri: BASE_URL + '/auth/microsoft/callback',
  response_type: 'code',
  scope: 'openid email profile User.Read',
  response_mode: 'query'
 });
 res.redirect('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + params.toString());
});

router.get('/microsoft/callback', async (req, res) => {
 try {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login?error=Microsoft+login+cancelled');

  const tokenData = await httpsPost('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
   code, client_id: MICROSOFT_CLIENT_ID, client_secret: MICROSOFT_CLIENT_SECRET,
   redirect_uri: BASE_URL + '/auth/microsoft/callback', grant_type: 'authorization_code',
   scope: 'openid email profile User.Read'
  });

  if (!tokenData.access_token) return res.redirect('/auth/login?error=Microsoft+auth+failed');

  const profile = await httpsGet('https://graph.microsoft.com/v1.0/me', {
   Authorization: 'Bearer ' + tokenData.access_token
  });

  const email = profile.mail || profile.userPrincipalName;
  if (!email) return res.redirect('/auth/login?error=Could+not+get+email+from+Microsoft');

  const user = findOrCreateOAuthUser(email, profile.displayName);
  loginAndRedirect(res, user);
 } catch (err) {
  console.error('Microsoft OAuth error:', err);
  res.redirect('/auth/login?error=Microsoft+login+failed');
 }
});

// ========== AUTH PAGES ==========
function authStyles() {
 return `
 @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@700;800&display=swap');
 :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0F0F1A;--dark-2:#1A1A2E;--surface:#1E1E32;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--error:#EF4444;--success:#10B981}
 [data-theme="light"]{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08)}
 *{margin:0;padding:0;box-sizing:border-box}
 body{font-family:'Inter',sans-serif;background:var(--dark);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center;transition:background .3s,color .3s}
 .auth-container{display:flex;width:100%;min-height:100vh}
 .auth-left{flex:1;display:flex;align-items:center;justify-content:center;padding:2rem}
 .auth-right{flex:1;background:var(--dark-2);display:flex;align-items:center;justify-content:center;padding:2rem;position:relative;overflow:hidden;transition:background .3s}
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
 .form-input{width:100%;padding:.9rem 1rem;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);font-size:.95rem;font-family:'Inter',sans-serif;outline:none;transition:border-color .3s,background .3s}
 [data-theme="light"] .form-input{border-color:rgba(0,0,0,0.12);background:#F8F9FC}
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
 [data-theme="light"] .divider::before,[data-theme="light"] .divider::after{background:rgba(0,0,0,0.1)}
 .oauth-buttons{display:flex;flex-direction:column;gap:.8rem;margin-bottom:.5rem}
 .btn-oauth{display:inline-flex;align-items:center;justify-content:center;gap:.8rem;width:100%;padding:.85rem 1rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:1px solid rgba(255,255,255,0.12);background:var(--surface);color:var(--text);transition:all .3s;font-family:'Inter',sans-serif;text-decoration:none}
 [data-theme="light"] .btn-oauth{border-color:rgba(0,0,0,0.12);background:#fff}
 .btn-oauth:hover{border-color:var(--primary-light);transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.1)}
 .btn-oauth svg{width:20px;height:20px;flex-shrink:0}
 .theme-toggle{position:fixed;top:1.5rem;right:1.5rem;z-index:100;background:var(--surface);border:1px solid rgba(255,255,255,0.1);border-radius:50px;padding:.5rem .8rem;cursor:pointer;display:flex;align-items:center;gap:.5rem;font-size:.85rem;color:var(--text-muted);transition:all .3s;font-family:'Inter',sans-serif}
 [data-theme="light"] .theme-toggle{border-color:rgba(0,0,0,0.1)}
 .theme-toggle:hover{border-color:var(--primary-light);color:var(--text)}
 .theme-toggle .toggle-track{width:44px;height:24px;background:var(--dark-2);border-radius:12px;position:relative;transition:background .3s}
 [data-theme="light"] .theme-toggle .toggle-track{background:#D1D5DB}
 .theme-toggle .toggle-thumb{width:20px;height:20px;background:var(--gradient-1);border-radius:50%;position:absolute;top:2px;left:2px;transition:transform .3s}
 [data-theme="light"] .theme-toggle .toggle-thumb{transform:translateX(20px)}
 @media(max-width:768px){.auth-right{display:none}.auth-left{padding:1.5rem}}
 `;
}

function authPage(type) {
 var isLogin = type === 'login';
 var googleEnabled = !!GOOGLE_CLIENT_ID;
 var microsoftEnabled = !!MICROSOFT_CLIENT_ID;
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
 <button class="theme-toggle" onclick="toggleTheme()">
 <span>&#x1F319;</span>
 <div class="toggle-track"><div class="toggle-thumb"></div></div>
 <span>&#x2600;&#xFE0F;</span>
 </button>
 <div class="auth-container">
 <div class="auth-left">
 <div class="auth-form-container">
 <a href="/" class="auth-logo">&#x26A1; RepurposeAI</a>
 <h1>${isLogin ? 'Welcome Back' : 'Create Account'}</h1>
 <p class="subtitle">${isLogin ? 'Log in to your account to continue' : 'Start repurposing content in seconds'}</p>
 <div class="error-msg ${new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('error') ? 'show' : ''}" id="errorMsg"></div>

 <div class="oauth-buttons">
 <a href="/auth/google" class="btn-oauth${googleEnabled ? '' : ' disabled" style="opacity:0.5;pointer-events:none'}">
 <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
 Continue with Google
 </a>
 <a href="/auth/microsoft" class="btn-oauth${microsoftEnabled ? '' : ' disabled" style="opacity:0.5;pointer-events:none'}">
 <svg viewBox="0 0 24 24"><rect fill="#F25022" x="1" y="1" width="10" height="10"/><rect fill="#7FBA00" x="13" y="1" width="10" height="10"/><rect fill="#00A4EF" x="1" y="13" width="10" height="10"/><rect fill="#FFB900" x="13" y="13" width="10" height="10"/></svg>
 Continue with Microsoft
 </a>
 </div>

 <div class="divider">or continue with email</div>

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
 function toggleTheme() {
 var h = document.documentElement;
 var c = h.getAttribute('data-theme');
 var n = c === 'light' ? 'dark' : 'light';
 h.setAttribute('data-theme', n);
 localStorage.setItem('repurposeai-theme', n);
 }
 (function() {
 var s = localStorage.getItem('repurposeai-theme');
 if (s === 'light') document.documentElement.setAttribute('data-theme', 'light');
 var params = new URLSearchParams(window.location.search);
 var err = params.get('error');
 if (err) { var el = document.getElementById('errorMsg'); el.textContent = decodeURIComponent(err); el.classList.add('show'); }
 })();

 async function handleSubmit(e) {
 e.preventDefault();
 var form = e.target;
 var btn = document.getElementById('submitBtn');
 var errorMsg = document.getElementById('errorMsg');
 errorMsg.classList.remove('show');
 btn.disabled = true; btn.textContent = 'Please wait...';

 var data = Object.fromEntries(new FormData(form));
 var isLogin = ${isLogin};
 var endpoint = isLogin ? '/auth/api/login' : '/auth/api/register';

 try {
 var res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
 });
 var result = await res.json();
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
 if (existing) return res.status(400).json({ error: 'An account with this email already exists. If you signed up with Google, please use the Continue with Google button to log in.' });

 const user = userOps.create(email, password, name || email.split('@')[0]);
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
 if (!user) return res.status(401).json({ error: 'Invalid email or password. If you signed up with Google, please use the Continue with Google button above.' });

 const valid = await bcrypt.compare(password, user.password_hash);
 if (!valid) return res.status(401).json({ error: 'Invalid email or password. If you signed up with Google, please use the Continue with Google button above.' });

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
