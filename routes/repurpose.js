const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// YouTube video info extraction using oEmbed (no API key needed)
async function getYouTubeInfo(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) throw new Error('Invalid YouTube URL');
    const data = await response.json();
    
    // Extract video ID
    const videoId = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
    
    return {
      title: data.title,
      author: data.author_name,
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      videoId: videoId,
      url: url
    };
  } catch (err) {
    throw new Error('Could not fetch video info. Please check the URL.');
  }
}

// AI Content Generation Engine
function generatePlatformContent(videoInfo) {
  const { title, author } = videoInfo;
  
  // Generate platform-specific content
  const platforms = {
    instagram: {
      name: 'Instagram',
      icon: '&#x1F4F7;',
      caption: `\u2728 ${title}\n\nCheck out this amazing content from ${author}! This is a must-watch for anyone interested in this topic.\n\n&#x1F449; Link in bio for the full video\n\n#ContentCreator #VideoContent #Repurpose #SocialMedia #GrowthHacking #ContentStrategy #DigitalMarketing #CreatorEconomy #InstagramReels #ViralContent`,
      type: 'Reel / Post Caption',
      charLimit: 2200
    },
    tiktok: {
      name: 'TikTok',
      icon: '&#x1F3B5;',
      caption: `${title} &#x1F525;\n\nYou NEED to see this! ${author} breaks it down perfectly.\n\n#fyp #foryou #viral #contentcreator #learnontiktok #trending`,
      type: 'Video Caption',
      charLimit: 300
    },
    facebook: {
      name: 'Facebook',
      icon: '&#x1F4D8;',
      caption: `&#x1F3AC; ${title}\n\nJust watched this incredible video by ${author} and had to share it with you all!\n\nKey takeaways:\n\u2022 The insights shared are game-changing\n\u2022 Perfect for anyone looking to level up\n\u2022 Practical tips you can implement today\n\nWhat do you think? Drop your thoughts in the comments! &#x1F447;\n\n#ContentRepurposing #VideoMarketing #SocialMedia`,
      type: 'Post',
      charLimit: 63206
    },
    linkedin: {
      name: 'LinkedIn',
      icon: '&#x1F4BC;',
      caption: `${title}\n\nI recently came across this excellent video by ${author} and wanted to share some key insights with my network.\n\nHere are the main takeaways:\n\n1. The approach presented is both innovative and practical\n2. There are clear applications for businesses of all sizes\n3. The methodology can be adapted to various industries\n\nI highly recommend watching the full video for the complete context.\n\nWhat are your thoughts on this topic? I'd love to hear different perspectives from my network.\n\n#ProfessionalDevelopment #ContentStrategy #Innovation #Leadership #Business`,
      type: 'Article Post',
      charLimit: 3000
    },
    twitter: {
      name: 'Twitter / X',
      icon: '&#x1F426;',
      caption: `\u1F9F5 Thread on: ${title}\n\n1/ Just watched an incredible video by @${author.replace(/\s+/g, '')} \n\nHere are the key points you need to know \u1F447\n\n2/ The main insight: this content breaks down complex ideas into actionable steps that anyone can follow.\n\n3/ Why it matters: In today's fast-paced digital world, having the right strategy makes all the difference.\n\n4/ My favorite takeaway: The practical examples shown make it easy to implement right away.\n\n5/ If you found this thread helpful, give it a RT and follow for more content breakdowns!\n\nFull video: ${videoInfo.url}`,
      type: 'Thread',
      charLimit: 280
    }
  };
  
  return platforms;
}

// API endpoint: Process YouTube video
// GET /repurpose - Show the repurpose form
router.get('/', requireAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repurpose - RepurposeAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .layout { display: flex; min-height: 100vh; }
    .sidebar { width: 250px; background: #111; border-right: 1px solid #222; padding: 20px 0; position: fixed; height: 100vh; overflow-y: auto; }
    .sidebar .logo { padding: 0 20px 30px; font-size: 1.4em; font-weight: 700; color: #fff; }
    .sidebar .logo span { color: #6c5ce7; }
    .sidebar a { display: block; padding: 12px 20px; color: #888; text-decoration: none; transition: all 0.2s; border-left: 3px solid transparent; }
    .sidebar a:hover { color: #fff; background: rgba(108,92,231,0.1); }
    .sidebar a.active { color: #6c5ce7; background: rgba(108,92,231,0.1); border-left-color: #6c5ce7; }
    .main { margin-left: 250px; flex: 1; padding: 30px; max-width: 800px; }
    .page-title { font-size: 1.8em; font-weight: 700; margin-bottom: 30px; }
    .form-section { background: #161616; border: 1px solid #222; border-radius: 12px; padding: 30px; margin-bottom: 24px; }
    .form-section h2 { font-size: 1.1em; margin-bottom: 16px; color: #fff; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; color: #aaa; font-size: 0.9em; }
    .form-group input[type=text], .form-group select { width: 100%; padding: 12px 16px; background: #0a0a0a; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 1em; outline: none; }
    .form-group input:focus, .form-group select:focus { border-color: #6c5ce7; }
    .platform-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .platform-option { background: #0a0a0a; border: 2px solid #333; border-radius: 8px; padding: 16px; text-align: center; cursor: pointer; transition: all 0.2s; }
    .platform-option:hover { border-color: #6c5ce7; }
    .platform-option.selected { border-color: #6c5ce7; background: rgba(108,92,231,0.1); }
    .platform-option input { display: none; }
    .platform-option .icon { font-size: 1.5em; margin-bottom: 6px; }
    .platform-option .name { font-size: 0.85em; color: #ccc; }
    .submit-btn { display: inline-block; background: #6c5ce7; color: #fff; padding: 14px 32px; border: none; border-radius: 8px; font-size: 1em; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .submit-btn:hover { background: #5a4bd1; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #result { display: none; margin-top: 24px; }
    #result .output-card { background: #161616; border: 1px solid #222; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    #result .output-card h3 { margin-bottom: 12px; color: #6c5ce7; }
    #result .output-card pre { white-space: pre-wrap; color: #ccc; line-height: 1.6; }
    .theme-toggle { position: fixed; bottom: 20px; right: 20px; background: #222; border: 1px solid #333; color: #fff; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; font-size: 1.2em; display: flex; align-items: center; justify-content: center; }
    body.light { background: #f5f5f5; color: #333; }
    body.light .sidebar { background: #fff; border-color: #e0e0e0; }
    body.light .sidebar a { color: #666; }
    body.light .sidebar a.active { color: #6c5ce7; background: rgba(108,92,231,0.08); }
    body.light .form-section, body.light #result .output-card { background: #fff; border-color: #e0e0e0; }
    body.light .form-group input, body.light .form-group select, body.light .platform-option { background: #f5f5f5; border-color: #ddd; color: #333; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div class="logo">Repurpose<span>AI</span></div>
      <a href="/dashboard">&#x1F3AC; Dashboard</a>
      <a href="/repurpose" class="active">&#x1F504; Repurpose</a>
      <a href="/dashboard/analytics">&#x1F4CA; Analytics</a>
      <a href="/dashboard/scheduled">&#x23F0; Scheduled</a>
      <a href="/billing">&#x1F4B3; Billing</a>
      <a href="/contact">&#x1F4E7; Support</a>
    </div>
    <div class="main">
      <div class="page-title">&#x1F504; Repurpose Content</div>
      <form id="repurposeForm">
        <div class="form-section">
          <h2>Step 1: Paste Your Video URL</h2>
          <div class="form-group">
            <label>YouTube or YouTube Shorts URL</label>
            <input type="text" id="videoUrl" name="url" placeholder="https://www.youtube.com/watch?v=..." required>
          </div>
        </div>
        <div class="form-section">
          <h2>Step 2: Choose Platforms</h2>
          <div class="platform-grid">
            <label class="platform-option" onclick="this.classList.toggle('selected')">
              <input type="checkbox" name="platforms" value="twitter">
              <div class="icon">&#x1D54F;</div><div class="name">Twitter/X</div>
            </label>
            <label class="platform-option" onclick="this.classList.toggle('selected')">
              <input type="checkbox" name="platforms" value="linkedin">
              <div class="icon">&#x1F4BC;</div><div class="name">LinkedIn</div>
            </label>
            <label class="platform-option" onclick="this.classList.toggle('selected')">
              <input type="checkbox" name="platforms" value="instagram">
              <div class="icon">&#x1F4F7;</div><div class="name">Instagram</div>
            </label>
            <label class="platform-option" onclick="this.classList.toggle('selected')">
              <input type="checkbox" name="platforms" value="facebook">
              <div class="icon">&#x1F44D;</div><div class="name">Facebook</div>
            </label>
            <label class="platform-option" onclick="this.classList.toggle('selected')">
              <input type="checkbox" name="platforms" value="blog">
              <div class="icon">&#x1F4DD;</div><div class="name">Blog Post</div>
            </label>
          </div>
        </div>
        <div class="form-section">
          <h2>Step 3: Select Tone</h2>
          <div class="form-group">
            <select id="tone" name="tone">
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="humorous">Humorous</option>
              <option value="inspirational">Inspirational</option>
              <option value="educational">Educational</option>
            </select>
          </div>
        </div>
        <button type="submit" class="submit-btn" id="submitBtn">&#x1F680; Repurpose Now</button>
      </form>
      <div id="result"></div>
    </div>
  </div>
  <button class="theme-toggle" onclick="document.body.classList.toggle('light')">&#x1F319;</button>
  <script>
    document.getElementById('repurposeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Processing...';
      const url = document.getElementById('videoUrl').value;
      const platforms = Array.from(document.querySelectorAll('input[name=platforms]:checked')).map(c => c.value);
      const tone = document.getElementById('tone').value;
      if (!platforms.length) { alert('Please select at least one platform'); btn.disabled = false; btn.innerHTML = '&#x1F680; Repurpose Now'; return; }
      try {
        const resp = await fetch('/repurpose/process', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ url, platforms, tone }) });
        const data = await resp.json();
        const resultDiv = document.getElementById('result');
        resultDiv.style.display = 'block';
        if (data.error) { resultDiv.innerHTML = '<div class="output-card"><h3>Error</h3><pre>' + data.error + '</pre></div>'; }
        else { resultDiv.innerHTML = '<div class="output-card"><h3>Generated Content</h3><pre>' + JSON.stringify(data, null, 2) + '</pre></div>'; }
      } catch(err) { alert('Error: ' + err.message); }
      btn.disabled = false;
      btn.innerHTML = '&#x1F680; Repurpose Now';
    });
  </script>
</body>
</html>`;
  res.send(html);
});

router.post('/process', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'Please provide a YouTube URL' });
    }
    
    // Validate YouTube URL
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)[a-zA-Z0-9_-]{11}/;
    if (!ytRegex.test(url)) {
      return res.status(400).json({ error: 'Please provide a valid YouTube URL' });
    }
    
    // Get video info
    const videoInfo = await getYouTubeInfo(url);
    
    // Generate content for all platforms
    const content = generatePlatformContent(videoInfo);
    
    res.json({
      success: true,
      video: videoInfo,
      content: content
    });
  } catch (err) {
    console.error('Repurpose error:', err);
    res.status(500).json({ error: err.message || 'Failed to process video' });
  }
});

// API endpoint: Regenerate content for a specific platform
router.post('/regenerate', requireAuth, async (req, res) => {
  try {
    const { videoInfo, platform, tone } = req.body;
    
    if (!videoInfo || !platform) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const content = generatePlatformContent(videoInfo);
    const platformContent = content[platform];
    
    if (!platformContent) {
      return res.status(400).json({ error: 'Invalid platform' });
    }
    
    // Add tone variation
    if (tone === 'professional') {
      platformContent.caption = platformContent.caption.replace(/!/g, '.').replace(/\u1F525/g, '');
    } else if (tone === 'casual') {
      platformContent.caption = platformContent.caption.replace(/\./g, '!').replace('I recently', 'Just');
    }
    
    res.json({ success: true, content: platformContent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate content' });
  }
});

module.exports = router;
