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
    const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    
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
router.post('/process', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'Please provide a YouTube URL' });
    }
    
    // Validate YouTube URL
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}/;
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
