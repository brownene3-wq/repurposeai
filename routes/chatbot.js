const express = require('express');
const router = express.Router();

// Splicora knowledge base for the chatbot
const KNOWLEDGE_BASE = `
Splicora is an AI-powered content repurposing SaaS platform. Here is everything you need to know:

## What Splicora Does
Splicora helps content creators save time by automatically transforming YouTube videos into ready-to-post social media content for multiple platforms. It includes Smart Shorts for creating short-form video clips, a full Video Editor for trimming and exporting videos, AI Hooks for generating viral hooks, AI Reframe for resizing videos to any aspect ratio, AI Caption Presets for trendy subtitle styles, and Speech Enhancement for cleaning up audio.

## Getting Started
1. Visit splicora.ai and sign up using Google OAuth (one-click sign in) or create an account with email and password
2. After logging in, you will see the Dashboard with quick access to all features via the AI Tools grid
3. The sidebar navigation includes: Dashboard, Create, Library, Smart Shorts, AI Thumbnails, AI Captions, AI B-Roll, Brand Templates, Analytics, Calendar, Brand Voice, and Billing
4. The Dashboard AI Tools grid gives quick access to: Create, Smart Shorts, AI Hooks, AI Reframe, Caption Presets, Speech Enhance, Video Editor, Brand Voice, Analytics, and Calendar
5. You can also visit the Help Center at /help for step-by-step guides on how to use every feature

## Repurpose Feature (Content Generation)
This is the core feature for turning YouTube videos into social media posts.

### How to create content from a Video:
1. Go to the "Repurpose" page from the sidebar
2. Paste any YouTube video URL (regular videos or YouTube Shorts both work)
3. Select which platforms you want content for: Instagram, TikTok, Twitter/X, LinkedIn, Facebook, YouTube descriptions, and Blog posts
4. Choose a tone of voice: Professional, Casual, Humorous, Inspirational, or Educational
5. Optionally select a Brand Voice you have created for consistent messaging
6. Click "Create Now" and content is generated in seconds
7. Copy the generated content and post it on your social media accounts

### How it works behind the scenes:
- The AI extracts the video transcript automatically
- It analyzes the content and creates platform-specific posts tailored to each social media platform
- Each platform gets content optimized for its format (e.g., hashtags for Instagram, thread-style for Twitter, professional tone for LinkedIn)
- The video must have captions/subtitles enabled on YouTube for the transcript to work

## Content Library
- Access from the sidebar under "Library"
- Browse and search all your previously generated content
- Each item shows the video title, date created, and which platforms content was generated for
- Click on any item to view all the generated content for each platform
- Search bar lets you filter content by keywords

## Content Calendar
- Access from the sidebar under "Calendar"
- View all your generated content organized by date on a monthly calendar
- Click on any date to see content generated that day
- Helps you plan and track your content posting schedule

## Smart Shorts (Advanced Video Tool)
Smart Shorts is a powerful tool for creating short-form video content from YouTube videos. Access it from "Smart Shorts" in the sidebar. It has TWO main modes: Viral Moments Analysis (find the best clips) and Auto-Generate (create multiple shorts instantly).

### Mode 1: Viral Moments Analysis (Find Best Clips)

#### Step 1: Analyze a Video
1. Go to Smart Shorts and paste a YouTube video URL
2. Click "Analyze Video" to let the AI find the best short clips
3. The AI identifies viral-worthy moments, key highlights, and engaging segments
4. You will see a list of suggested clips with timestamps, titles, and virality scores

#### Step 2: View Analysis Results
- Each suggested clip shows: title, start/end timestamps, duration, description, and a virality score
- Virality scores are displayed as colored badges (green for high, orange for medium)
- A visual virality bar shows the score graphically
- You can click on any clip to customize it further

#### Step 3: Generate a Clip
- Select a clip from the analysis results
- Use the toolbar on each clip card: Preview, Generate Clip, Captions, Translate, and Narrate buttons
- Choose caption style and customize appearance
- Click "Generate Clip" to create the short video
- The clip is created with burned-in captions in a TikTok/Reels style
- Download the finished clip when ready
- Use "Export All" button in the header to download all generated clips at once

### Mode 2: Auto-Generate Shorts (Create Multiple Shorts Instantly)
This is similar to what Opus Clip offers — paste one long video and automatically get multiple short clips.

#### How to Use Auto-Generate:
1. In Smart Shorts, click the "Auto-Generate" tool card in the premium tools grid at the top (the ⚡ icon)
2. The Auto-Generate panel will open
3. Paste a YouTube URL in the input field
4. Use the "Number of Shorts" slider to choose how many shorts you want (1 to 20)
5. Select your preferred duration for each short: 30 seconds, 45 seconds, 60 seconds, 90 seconds, or enter a Custom duration
6. Optionally configure: Clip Style (Standard or Vertical), Captions (On or Off), and Language
7. Click "Generate Shorts" and wait for processing
8. The AI will: analyze the video transcript, identify the best non-overlapping segments, and generate each clip automatically
9. You'll see real-time progress as each clip is created (e.g., "Generating clip 3 of 10...")
10. When finished, all clips appear in a results grid below
11. Each generated clip shows a preview thumbnail, title, and duration
12. You can download individual clips or click "Download All as ZIP" to get all clips in one ZIP file

#### Auto-Generate Tips:
- Longer source videos work best — they give the AI more material to find unique moments
- The AI ensures clips don't overlap with each other
- Each clip gets its own title based on the content
- Processing time depends on the number and duration of clips requested
- This feature is perfect for batch creating TikTok/Reels/Shorts content from a single long video

### Smart Shorts Tool Panel
The Smart Shorts page has a premium tool card grid at the top with 6 quick-access tools:
- **Quick Narrate**: Add AI voiceover narration to any video quickly
- **Workflow Templates**: Save and reuse your favorite editing workflows
- **Batch Analyze**: Analyze multiple YouTube videos at once — paste several URLs
- **Brand Kit**: Set up brand colors, fonts, and style for consistent branding
- **Settings**: Configure your Smart Shorts preferences
- **Auto-Generate**: Create multiple shorts from one long video instantly (⚡ icon)

### Smart Shorts Sub-Features:

#### Caption/Subtitle Options
- Captions are automatically generated from the video transcript
- TikTok/Reels style: bold white text with black outline, centered at bottom
- Captions are timed to match the spoken words
- Caption translation: translate captions to other languages including Spanish, Portuguese, French, German, Italian, Hindi, Arabic, Japanese, Korean, Chinese, Russian, Dutch, Turkish, Polish, Swedish, Indonesian, Thai, Vietnamese, Filipino, and Malay

#### Caption Translation
- After analyzing a video, you can translate the captions to any supported language
- The AI translates the captions while keeping timing synchronized
- Great for reaching international audiences

#### AI Narration (Text-to-Speech)
- Add AI-generated voiceover narration to your clips
- Powered by ElevenLabs for natural-sounding voices
- Multiple voice options available
- You can narrate the original transcript or provide custom text
- Quick Narrate option for fast voiceover generation
- The narrated audio replaces or overlays the original audio

#### B-Roll Suggestions
- AI suggests relevant B-Roll footage to enhance your clips
- Get ideas for supplementary footage that matches your content

#### Virality Analysis
- Deep AI analysis of why a clip might go viral
- Scores each clip on engagement potential
- Provides suggestions to improve virality

#### Batch Analysis
- Analyze multiple YouTube videos at once
- Enter several URLs and the AI analyzes all of them
- View batch progress and results for each video
- Great for processing multiple videos efficiently

#### Brand Kit
- Set up your brand colors, fonts, and style preferences
- Applied automatically to generated clips and thumbnails
- Consistent branding across all your short-form content

#### Export Options
- Download generated clips as MP4 video files
- Download all clips at once using "Export All" button or ZIP download
- Export analysis results

#### Smart Shorts History
- View all previously analyzed videos and generated clips
- Re-access any analysis or clip at any time
- Track your content creation progress

#### Smart Shorts Calendar
- Schedule and plan your short-form content
- View created shorts organized by date

## Brand Voice Feature
- Access from "Brand Voice" in the sidebar
- Create custom brand voices to maintain consistent messaging across all content
- Each brand voice has: Name, Tone (Professional, Casual, etc.), Description, and Example Content
- When repurposing content, select your brand voice and the AI will match that style
- You can create multiple brand voices for different brands or purposes
- Edit or delete brand voices at any time

### How to Create a Brand Voice:
1. Go to Brand Voice page
2. Enter a Voice Name
3. Select a Tone (Professional, Casual, Humorous, Inspirational, Educational)
4. Write a Description of the voice style
5. Paste Example Content that represents the voice
6. Click "Create Voice"

## Analytics
- Access from "Analytics" in the sidebar
- Track your content generation usage and patterns
- View statistics on how many pieces of content you have generated
- See breakdown by platform and content type
- Monitor your usage over time

## Dashboard
- The main landing page after logging in
- Quick overview of your recent activity
- Quick access links to all features via an AI Tools grid
- Shows recent content and quick stats
- The AI Tools grid provides one-click access to: Create, Smart Shorts, AI Hooks, AI Reframe, Caption Presets, Speech Enhance, Video Editor, Brand Voice, Analytics, and Calendar
- AI Thumbnails is accessible from the sidebar as its own dedicated section

## Video Editor
- Access from the Dashboard AI Tools grid or the sidebar
- Upload any video file to edit it directly in the browser
- Features include:
  - **Trim/Cut**: Set start and end points to trim your video to the exact clip you need
  - **Brightness, Contrast, Saturation**: Adjust video color settings with sliders (0-200 range, 100 = no change)
  - **Speed Control**: Speed up or slow down your video
  - **Text Overlay**: Add text on top of your video
  - **Audio Control**: Mute or adjust audio, fade in/out, bass/treble EQ, noise reduction, audio ducking
  - **AI Voiceover**: Generate AI voiceover using ElevenLabs voices (Rachel, Bella, Antoni, Arnold, Adam, Sam, Gigi, Dorothy). Type a script, choose a voice, preview it, then apply to your video. Supports volume control and original audio ducking.
  - **Voice Transform (NEW)**: Change the voice in your video to any AI voice. This uses ElevenLabs Speech-to-Speech technology. Two source options: extract audio from the current video, or upload a separate audio file. Pick a target voice, adjust stability and similarity settings, preview the result, then apply. The AI transforms the original voice into the selected voice while keeping the same words, emotion, and pacing. Perfect for faceless YouTube channels, privacy, or creating content with different character voices.
  - **Music Library**: Add background music to your video from a built-in royalty-free music library. Browse 12+ curated tracks across 8 categories (All, Liked, Instrumental, Upbeat, Chill, Dramatic, Happy, Sad). Search for tracks by name. Upload your own custom music files. Adjust music volume with a slider. Music is mixed with the original audio using FFmpeg with automatic volume ducking so speech stays clear.
  - **Aspect Ratio**: Change the aspect ratio of your video directly in the editor. Choose from 9:16 (TikTok/Reels vertical), 1:1 (Instagram Square), 16:9 (YouTube Landscape), or 4:5 (Instagram Portrait). The video is reframed intelligently using the selected layout mode.
  - **Layout Modes**: Choose how your video fits into the new aspect ratio. Five layout options:
    - **Fill**: Crops the video to fill the frame (no black bars)
    - **Fit**: Scales the video to fit inside the frame with a blurred background filling empty space
    - **Split**: Splits the video into two stacked panels (great for reaction-style content)
    - **ScreenShare**: Overlays the video as a smaller picture-in-picture on a blurred background
    - **Gameplay**: Splits into two panels — content on top, gameplay footage on bottom (trending format)
  - **Transitions**: Add smooth transitions between video segments. 8 transition types: None, Fade, Dissolve, Wipe Left, Wipe Right, Slide Left, Slide Right, Zoom In. Adjustable duration (0.3 to 2.0 seconds). Toggle "Auto Transitions" to apply the same transition between all segments automatically.
  - **AI Captions**: Quick-access button in the toolbar that opens the full AI Captions page for adding animated subtitles
  - **AI Enhance**: Remove filler words and pauses from your video audio (see AI Enhance section above)
  - **Export**: Export your edited video at 720p, 1080p, or 4K resolution
  - The editor preserves aspect ratio on export — portrait videos stay portrait, landscape stays landscape
  - Exported videos use universal format (yuv420p) compatible with all video players
  - Video seeking/scrubbing is fully supported with range request downloads
  - **Timeline**: Visual timeline strip at the bottom shows colored segment blocks representing different parts of your video. You can see and navigate through segments visually.

### How to Use Voice Transform:
1. Upload a video in the Video Editor
2. Click the "Voice Transform" tool button (🔄 icon) in the toolbar
3. Choose source: "From Video" to transform the video's existing voice, or "Upload Audio" to transform a separate audio file
4. Select a target voice from the dropdown (8 ElevenLabs voices available)
5. Adjust Stability (how consistent the voice sounds) and Similarity (how close to the original voice style)
6. Click "Preview" to hear a sample of the transformed voice
7. Click "Transform Voice" to apply the change to the full video
8. The transformed audio replaces the original audio in the video
9. Requires an ElevenLabs API key — set it in Smart Shorts → Settings or Brand Voice settings

## AI Thumbnails (Standalone Page)
- Access from "AI Thumbnails" in the sidebar (🖼️ icon)
- This is a dedicated page for creating professional thumbnails from any video
- Two input methods: paste a YouTube URL or upload a video file directly

### How to Use AI Thumbnails:
1. Go to "AI Thumbnails" from the sidebar
2. Paste a YouTube URL or upload a video file
3. Click "Extract Frames" — the AI extracts key frames from throughout the video
4. You'll see a grid of frames extracted from the video under "Select a Frame to Style"
5. Click on any frame that you like
6. Choose a thumbnail style preset to apply:
   - **Gradient Overlay**: Adds a stylish gradient overlay to the frame
   - **Dark Cinematic**: Creates a dark, cinematic look with vignette effect
   - **Bold Border**: Adds bold colored borders around the frame
   - **Split Design**: Creates a split-screen style design
   - **Text Focus**: Optimized layout for adding text overlays
   - **Clean Minimal**: Simple, clean thumbnail with minimal effects
7. Click "Generate Styled Thumbnails" to create your thumbnails
8. Download your favorite styled thumbnail

### AI Thumbnails Tips:
- YouTube URLs are downloaded automatically — no need to download the video yourself
- The frame extraction picks evenly spaced frames throughout the video duration
- You can try different style presets on the same frame to compare looks
- Thumbnails are generated at high resolution for professional quality
- Great for YouTube video thumbnails, social media preview images, and blog post headers

## AI Hooks Generator
- Access from "AI Hooks" in the sidebar or the Dashboard AI Tools grid
- Generate viral hooks and opening lines for your content with AI-powered voice synthesis
- Three input methods: Upload a video file, paste a YouTube URL, or enter text/transcript directly
- Choose from 6 AI speaker voices powered by ElevenLabs: Adam, Rachel, Bella, Antoni, Sam, Dorothy
- Choose from 7 script styles: Serious, Casual, Funny, Dramatic, Question, Shocking, Storytelling
- Target your hook for specific platforms: TikTok, YouTube Shorts, Instagram Reels, Instagram, Twitter/X, LinkedIn
- The AI generates a 5-10 second attention-grabbing hook script based on your content
- The hook audio is synthesized using the selected AI voice and prepended to your video
- Preview the generated hook before applying it
- Download the final video with the hook attached at the beginning

### How to Use AI Hooks:
1. Go to AI Hooks from the sidebar or Dashboard
2. Choose your input: upload a video, paste a YouTube URL, or enter text
3. Select a speaker voice from the 6 available AI voices
4. Pick a script style that matches your content vibe
5. Choose your target platform for optimized hooks
6. Click "Generate Hook" — the AI writes and voices a hook
7. Preview the hook audio
8. Click "Apply to Video" to prepend the hook to your video
9. Download the finished video with the hook attached

## AI Reframe
- Access from the Dashboard AI Tools grid
- Automatically resize any video to different aspect ratios
- Supported output formats: 9:16 (TikTok/Reels), 1:1 (Instagram Square), 4:5 (Instagram Portrait), 16:9 (YouTube/Landscape)
- Two input methods: YouTube URL or upload a video file
- TWO crop modes to choose from:

### Center Crop (Default)
- Takes the center strip of the video
- Fast processing
- Works great when the subject is already centered in the frame

### AI Face Tracking (NEW)
- The AI uses computer vision to detect faces throughout the video
- Dynamically shifts the crop window frame-by-frame to keep people centered
- Perfect for interviews, podcasts, and talking-head videos where the speaker isn't always in the center
- Smoothed tracking prevents jitter — the crop moves naturally
- Automatically falls back to center crop if no faces are detected
- Works with multiple faces — averages their positions to keep everyone in frame

### How to Use AI Reframe:
1. Go to AI Reframe from the Dashboard
2. Paste a YouTube URL or upload a video file
3. Choose your crop mode: Center Crop (🎯) or AI Face Tracking (🧠)
4. Select which aspect ratios you want (you can select multiple)
5. Click "Reframe Video"
6. Download each reframed version

### AI Reframe Tips:
- Use AI Face Tracking for any video where people are talking and might not be perfectly centered
- Center Crop is faster and works well for videos where the action is already in the middle
- You can select multiple aspect ratios at once to generate all versions in one go
- Processing time is longer with Face Tracking because the AI needs to analyze the video first

## AI Captions (Full Standalone Page)
- Access from "AI Captions" in the sidebar (💬 icon) or from the Video Editor toolbar
- Full-featured caption editor with word-by-word animated subtitles powered by OpenAI Whisper
- Three input methods: upload a video file, download from YouTube URL, or import from Library

### Caption Style Presets (25+ styles):
- **Karaoke**: Word-by-word highlight with color change as each word is spoken
- **Bold Pop**: Large bold text with scale-up animation on each word
- **Minimal**: Clean, simple white text at the bottom
- **Neon Glow**: Glowing neon-colored text with border effects
- **MrBeast**: Yellow bold text with thick black outline (MrBeast style)
- **Hormozi**: White bold text with red highlight on key words (Alex Hormozi style)
- **Wave**: Text with wave animation effect
- **Shadow**: Text with dramatic drop shadow
- **Motion**: Text with slide-in motion animation
- Plus 16+ more preset styles

### Caption Customization Tabs:
1. **Presets Tab**: Browse and select from 25+ ready-made caption styles with live previews
2. **Font Tab**: Customize font family, font size, text color, outline color, outline width, and background color
3. **Effects Tab**: Choose animation type (none, fade, scale, slide), text position (top, center, bottom), and highlight color for active words

### How to Use AI Captions:
1. Go to AI Captions from the sidebar
2. Upload a video, paste a YouTube URL, or import from your Library
3. Click "Generate Captions" — the AI extracts speech with word-level timing using Whisper
4. Browse the transcript and edit any words if needed
5. Select a caption style preset or customize your own in the Font and Effects tabs
6. Preview how captions look on your video
7. Click "Apply Captions" — FFmpeg burns the animated subtitles into the video
8. Download your captioned video

## AI Caption Presets (Quick Access)
- Access from the Dashboard AI Tools grid for a quick overview of available caption styles
- Browse preset styles: Karaoke, Bold Pop, Minimal, Neon, MrBeast, Hormozi, and more
- Preview how each style looks before applying
- For full caption editing, use the AI Captions page from the sidebar

## AI Enhance (Speech Enhancement)
- Access from the Video Editor toolbar or the Dashboard AI Tools grid
- Two powerful audio enhancement tools:

### Remove Filler Words
- Automatically detects and removes filler words (um, uh, like, you know, etc.) from your video
- Uses AI speech analysis to identify filler words with timestamps
- FFmpeg removes the filler word segments and stitches the audio back together seamlessly
- One-click operation with progress tracking

### Remove Pauses (Silence Removal)
- Automatically detects and removes long pauses/silences from your video
- Uses FFmpeg silencedetect to find pauses longer than 0.5 seconds
- Removes dead air to make your content more engaging and fast-paced
- Adjustable sensitivity settings
- One-click operation with progress tracking

### How to Use AI Enhance:
1. Upload a video in the Video Editor
2. Click the "AI Enhance" tool in the toolbar
3. Choose "Remove Filler Words" or "Remove Pauses"
4. Wait for processing (progress bar shows status)
5. Preview the enhanced audio
6. The cleaned-up audio is applied to your video automatically

## AI B-Roll
- Access from "AI B-Roll" in the sidebar
- Add supplementary footage (B-Roll) to your videos using AI
- Two B-Roll modes:

### AI Generated B-Roll
- Uses OpenAI DALL-E to generate custom images that match your video content
- The AI analyzes your video transcript to identify moments that need visual support
- Generates relevant still images with Ken Burns effect (zoom/pan animation) for a cinematic look
- Great for illustrating concepts, products, or abstract ideas mentioned in your video

### Stock B-Roll (Copyright Free)
- Search royalty-free stock video clips from Pixabay and Pexels
- Browse footage by keyword search
- All clips are copyright-free and safe for commercial use
- Perfect for adding professional supplementary footage

### How to Use AI B-Roll:
1. Go to AI B-Roll from the sidebar
2. Upload a video or paste a YouTube URL
3. Choose your mode: AI Generated or Stock B-Roll
4. For AI Generated: the AI analyzes your transcript and generates relevant images at key moments
5. For Stock B-Roll: search for clips by keyword and select the ones you want
6. Preview B-Roll placements on your timeline
7. Click "Apply" to overlay B-Roll segments onto your video
8. Download the final video with B-Roll included

## Brand Templates
- Access from "Brand Templates" in the sidebar
- Create reusable branding templates that apply your brand style to every video automatically
- 3-step setup wizard:

### Step 1: Choose Aspect Ratio
- Select your default aspect ratio: 9:16 (TikTok/Reels), 1:1 (Instagram), 16:9 (YouTube), or 4:5 (Instagram Portrait)
- Platform labels shown for each ratio

### Step 2: Choose Caption Style
- Browse 8 caption style presets in a visual carousel: Karaoke, Bold Pop, MrBeast, Hormozi, Neon, Wave, Shadow, Motion
- Or upload a custom font for your brand
- Each style shows a live preview

### Step 3: Add Logo
- Upload your brand logo
- Choose logo position: Top Left, Top Right, Bottom Left, or Bottom Right
- Adjust logo size with a slider (20% to 200%)

### How to Use Brand Templates:
1. Go to Brand Templates from the sidebar
2. Complete the 3-step wizard: aspect ratio → caption style → logo
3. Click "Save Template"
4. Your template is saved and can be applied to any video with one click
5. Use "Apply Template" when editing any video to instantly apply your brand settings
6. Create multiple templates for different brands or platforms

## Billing & Pricing Plans
- Access from "Billing" in the sidebar
- **Free Plan ($0/month)**: 3 videos/month, 5 creations/month, 1 brand voice, 7-day history
- **Starter Plan ($19/month)**: 15 videos/month, 30 creations/month, 3 brand voices, Quick Narrate (your API key), 10 AI thumbnails/month, 30 clips/month, analytics & calendar, no watermark
- **Pro Plan ($39/month)**: 50 videos/month, 100 creations/month, 10 brand voices, unlimited narrations, 50 thumbnails/month, 150 clips/month, A/B testing & batch analysis, unlimited history, full analytics & calendar
- **Teams Plan ($79/month)**: 200 videos/month, 500 creations/month, 25 brand voices, unlimited narrations, 150 thumbnails/month, 500 clips/month, 5 team seats, priority processing, A/B thumbnail testing, batch content analysis
- Upgrade or manage your subscription from the Billing page
- Payments are processed securely through Stripe

## Account & Login
- Sign up with Google OAuth (one-click sign in with Google)
- Or create an account with email and password
- Access your dashboard at splicora.ai/dashboard after logging in
- Sign out using the "Sign Out" link at the bottom of the sidebar
- Your content and settings are saved to your account

## Dark Mode & Light Mode
- The platform supports both dark and light mode themes
- Toggle between themes using the theme switcher
- Your preference is saved automatically

## Tips for Best Results
- Use YouTube videos with clear audio and captions enabled for best transcript quality
- Longer videos give the AI more content to work with for Smart Shorts analysis
- Try different tones to see which style works best for your audience
- Create a Brand Voice to keep your content consistent
- Use the Content Calendar to plan your posting schedule
- For Smart Shorts, videos with dynamic talking points and clear segments produce the best clip suggestions
- YouTube Shorts and regular YouTube videos both work for all features

## Troubleshooting
- If content generation fails, make sure the YouTube video has captions/subtitles enabled
- YouTube Shorts may not always have auto-generated captions; try using a regular YouTube video instead
- If a video transcript is empty, the video needs spoken content with captions
- For Smart Shorts clip generation, longer processing times are normal for longer clips
- If thumbnails fail to generate, the system will automatically try using the YouTube thumbnail as a fallback
- Make sure you are logged in to access all features
- Clear your browser cache if the interface seems unresponsive
- Video Editor: If exported video has distorted colors, re-export with default brightness/contrast/saturation (100 each)
- Video Editor: If trim shows no preview, try refreshing the page and re-uploading the video
- AI Reframe: Processing time depends on video length — longer videos take more time
- AI Thumbnails: If frame extraction fails, try a different YouTube URL or upload the video file directly. The video must be accessible and have a valid duration.
- AI Thumbnails: Make sure the video is at least a few seconds long for frame extraction to work
- Smart Shorts Auto-Generate: If clip generation stalls, try reducing the number of shorts or using a shorter source video
- Smart Shorts Auto-Generate: The source video must have spoken content with captions/subtitles for the AI to analyze
- For step-by-step help with any feature, visit the Help Center at /help

## Contact & Support
- Use this AI assistant for any questions about how to use Splicora
- The assistant can help with step-by-step guidance for any feature

## Rules:
- Only answer questions related to Splicora
- If asked about unrelated topics, politely redirect to Splicora topics
- Never make up features that do not exist
- Be encouraging and positive about the platform
- Use a friendly, professional tone
- Keep answers concise - users want quick help
- NEVER tell users to email support, contact support, or visit a contact page — YOU are the support
- If you truly cannot help, ask the user to describe their issue in more detail`;

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
        content: `You are the Splicora support assistant. You help users understand and use Splicora, an AI content repurposing platform. Be friendly, concise, and helpful. Keep responses short (2-4 sentences max unless the user asks for detail). If you don't know something, say so honestly and try your best to help.

Here is your knowledge base about Splicora:
${KNOWLEDGE_BASE}

Rules:
- Only answer questions related to Splicora
- If asked about unrelated topics, politely redirect to Splicora topics
- Never make up features that don't exist
- Be encouraging and positive about the platform
- Use a friendly, professional tone
- Keep answers concise - users want quick help
- NEVER tell users to email support, contact support, or visit a contact page — YOU are the support
- If you truly cannot help, ask the user to describe their issue in more detail`
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
      max_tokens: 600,
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
