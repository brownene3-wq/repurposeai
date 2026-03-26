const express = require('express');
const router = express.Router();

// RepurposeAI knowledge base for the chatbot
const KNOWLEDGE_BASE = `
RepurposeAI is an AI-powered content repurposing SaaS platform. Here is everything you need to know:

## What RepurposeAI Does
- Takes any YouTube video URL and automatically generates tailored social media content for multiple platforms
- Supported platforms: Instagram, TikTok, Twitter/X, LinkedIn, Facebook, YouTube descriptions, and Blog posts
- Users paste a YouTube link, select platforms, choose a tone, and click "Repurpose Now"
- AI analyzes the video transcript and creates platform-specific content in seconds

## How It Works
1. Paste a YouTube video URL on the Repurpose page
2. Select which platforms you want content for (Instagram, TikTok, Twitter/X, LinkedIn, Facebook, YouTube, Blog)
3. Choose a tone of voice: Professional, Casual, Humorous, Inspirational, or Educational
4. Optionally select a Brand Voice you've created for consistent messaging
5. Click "Repurpose Now" and content is generated in seconds
6. Copy the generated content and post it on your social media accounts

## Features
- Content Calendar: View all your generated content organized by date
- Content Library: Browse and search all your previously generated content
- Brand Voice: Create custom brand voices to maintain consistent messaging across all content
- Analytics: Track your content generation usage and patterns
- Multiple tones: Professional, Casual, Humorous, Inspirational, Educational
- Works with regular YouTube videos and YouTube Shorts
- Dark mode and light mode support

## Pricing Plans
- Free Plan: Limited usage to try the platform
- Pro Plan: Higher limits for regular content creators
- Enterprise Plan: Unlimited usage for teams and agencies
- All plans include access to all platforms and features
- Users can upgrade from the Billing page in their dashboard

## Account & Login
- Sign up with Google OAuth (one-click sign in with Google)
- Or create an account with email and password
- Access your dashboard at repurposeai.ai/dashboard after logging in

## Brand Voice Feature
- Create custom brand voices from the Brand Voice page in the sidebar
- Each brand voice has a name, tone, description, and example content
- When you select a brand voice during repurposing, the AI maintains that voice across all generated content
- The tone selector is automatically disabled when a brand voice is selected (since the brand voice defines the tone)

## Tips for Best Results
- Use videos with clear spoken content and captions enabled
- Longer videos with more content give better results
- Try different tones to see which works best for your audience
- Create brand voices for consistency if you manage multiple brands
- Videos in English work best

## Technical Notes
- The platform fetches video transcripts automatically - captions must be available on the video
- Content generation typically takes 5-10 seconds depending on the number of platforms selected
- Generated content is saved to your Content Library automatically

## Contact & Support
- Visit the Contact page at repurposeai.ai/contact for support
- The platform is built and maintained by the RepurposeAI team
`;

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Rate limit: basic protection (could be enhanced with Redis)
    const userMessage = message.trim().substring(0, 500);

    // Build conversation messages
    const messages = [
      {
        role: 'system',
        content: `You are the RepurposeAI support assistant. You help users understand and use RepurposeAI, an AI content repurposing platform. Be friendly, concise, and helpful. Keep responses short (2-4 sentences max unless the user asks for detail). If you don't know something, say so and suggest they visit the Contact page.

Here is your knowledge base about RepurposeAI:
${KNOWLEDGE_BASE}

Rules:
- Only answer questions related to RepurposeAI
- If asked about unrelated topics, politely redirect to RepurposeAI topics
- Never make up features that don't exist
- Be encouraging and positive about the platform
- Use a friendly, professional tone
- Keep answers concise - users want quick help`
      }
    ];

    // Add conversation history (last 6 messages max)
    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-6);
      recentHistory.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content.substring(0, 500) });
        }
      });
    }

    messages.push({ role: 'user', content: userMessage });

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: messages
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error('Chatbot error:', error.message);
    res.status(500).json({ reply: "I'm having trouble right now. Please try again in a moment, or visit our Contact page for help." });
  }
});

module.exports = router;
