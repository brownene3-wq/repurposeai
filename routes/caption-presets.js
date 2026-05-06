const express = require('express');
const { getDb } = require('../db/database');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// =============================================================================
// CAPTION STYLE CATEGORIES + PRESETS
// 5 categories × 20 presets = 100 total caption styles.
// Each preset has: cat (category id), name (display), cls (CSS class slug),
// preview (HTML rendered inside .preview-text).
// =============================================================================

const CATEGORIES = [
  { id: 'trending', label: 'Trending', icon: '🔥' },
  { id: 'classic',  label: 'Classic',  icon: '🎬' },
  { id: 'hits',     label: 'Hits',     icon: '⚡' },
  { id: 'title',    label: 'Title',    icon: '🏆' },
  { id: 'vlog',     label: 'Vlog',     icon: '📹' }
];

const PRESETS = [
  // ---------------- TRENDING (20) ----------------
  { cat:'trending', name:'TikTok Trending', cls:'tiktok-trend',  preview:'TRENDING' },
  { cat:'trending', name:'Hormozi',         cls:'hormozi',       preview:'MAKE <span class="word-highlight">MONEY</span> NOW' },
  { cat:'trending', name:'MrBeast',         cls:'mrbeast',       preview:'EPIC TEXT' },
  { cat:'trending', name:'Bold Pop',        cls:'bold-pop',      preview:'BOLD POP' },
  { cat:'trending', name:'Reels Pop',       cls:'reels-pop',     preview:'REELS' },
  { cat:'trending', name:'YouTube Shorts',  cls:'yt-shorts',     preview:'SHORTS' },
  { cat:'trending', name:'Snap Style',      cls:'snap-style',    preview:'snap it' },
  { cat:'trending', name:'Threads Bold',    cls:'threads-bold',  preview:'THREADS' },
  { cat:'trending', name:'X Caption',       cls:'x-caption',     preview:'just posted' },
  { cat:'trending', name:'Viral Yellow',    cls:'viral-yellow',  preview:'VIRAL' },
  { cat:'trending', name:'Twitch Purple',   cls:'twitch-purple', preview:'LIVE NOW' },
  { cat:'trending', name:'Reaction Pop',    cls:'reaction-pop',  preview:'WAIT WHAT?!' },
  { cat:'trending', name:'Influencer',      cls:'influencer',    preview:'✨ Slay ✨' },
  { cat:'trending', name:'Trending Box',    cls:'trending-box',  preview:'TRENDING NOW' },
  { cat:'trending', name:'Hype Bold',       cls:'hype-bold',     preview:'HYPE' },
  { cat:'trending', name:'Storytime',       cls:'storytime',     preview:'so <span class="word-highlight">basically</span>' },
  { cat:'trending', name:'Pop Out',         cls:'pop-out',       preview:'POP OUT' },
  { cat:'trending', name:'Splash',          cls:'splash',        preview:'splash!' },
  { cat:'trending', name:'Buzz',            cls:'buzz',          preview:'BUZZING' },
  { cat:'trending', name:'Punchline',       cls:'punchline',     preview:'PUNCH LINE' },

  // ---------------- CLASSIC (20) ----------------
  { cat:'classic', name:'Minimal',          cls:'minimal',         preview:'subtle text' },
  { cat:'classic', name:'Classic Subtitle', cls:'classic-sub',     preview:'Classic subtitle text' },
  { cat:'classic', name:'Outline',          cls:'outline-style',   preview:'OUTLINE' },
  { cat:'classic', name:'Clean Modern',     cls:'clean-modern',    preview:'Clean Modern' },
  { cat:'classic', name:'Closed Caption',   cls:'closed-caption',  preview:'[CC] white text' },
  { cat:'classic', name:'Newsroom',         cls:'newsroom',        preview:'BREAKING NEWS' },
  { cat:'classic', name:'Broadcast',        cls:'broadcast',       preview:'Broadcast Style' },
  { cat:'classic', name:'Documentary',      cls:'documentary',     preview:'A documentary tale' },
  { cat:'classic', name:'Interview',        cls:'interview',       preview:'…and then I said' },
  { cat:'classic', name:'Lower Third',      cls:'lower-third',     preview:'Albert · Founder' },
  { cat:'classic', name:'Plain White',      cls:'plain-white',     preview:'Plain white text' },
  { cat:'classic', name:'Plain Black',      cls:'plain-black',     preview:'Plain black text' },
  { cat:'classic', name:'Sans Serif',       cls:'sans-serif',      preview:'Sans Serif' },
  { cat:'classic', name:'Serif Classic',    cls:'serif-classic',   preview:'Serif Classic' },
  { cat:'classic', name:'Subtitle Bold',    cls:'subtitle-bold',   preview:'BOLD SUBTITLE' },
  { cat:'classic', name:'Pure Text',        cls:'pure-text',       preview:'pure text' },
  { cat:'classic', name:'Bordered',         cls:'bordered',        preview:'BORDERED' },
  { cat:'classic', name:'Dictation',        cls:'dictation',       preview:'transcribed text' },
  { cat:'classic', name:'Letterbox',        cls:'letterbox',       preview:'L E T T E R B O X' },
  { cat:'classic', name:'Editorial',        cls:'editorial',       preview:'Editorial Voice' },

  // ---------------- HITS (20) ----------------
  { cat:'hits', name:'Neon Glow',    cls:'neon-glow',    preview:'NEON GLOW' },
  { cat:'hits', name:'Fire',         cls:'fire',         preview:'ON FIRE' },
  { cat:'hits', name:'Street',       cls:'street',       preview:'STREET' },
  { cat:'hits', name:'Shadow Drop',  cls:'shadow-drop',  preview:'SHADOW' },
  { cat:'hits', name:'Lightning',    cls:'lightning',    preview:'⚡ LIGHTNING' },
  { cat:'hits', name:'Ice Blue',     cls:'ice-blue',     preview:'ICE COLD' },
  { cat:'hits', name:'Crimson',      cls:'crimson',      preview:'CRIMSON' },
  { cat:'hits', name:'Gold Rush',    cls:'gold-rush',    preview:'GOLD RUSH' },
  { cat:'hits', name:'Toxic Green',  cls:'toxic-green',  preview:'TOXIC' },
  { cat:'hits', name:'Hot Pink',     cls:'hot-pink',     preview:'HOT PINK' },
  { cat:'hits', name:'Lava',         cls:'lava',         preview:'LAVA' },
  { cat:'hits', name:'Hologram',     cls:'hologram',     preview:'HOLO' },
  { cat:'hits', name:'Chrome',       cls:'chrome',       preview:'CHROME' },
  { cat:'hits', name:'Cyber',        cls:'cyber',        preview:'CYBER 2099' },
  { cat:'hits', name:'Glitch',       cls:'glitch',       preview:'GLITCH' },
  { cat:'hits', name:'Ember',        cls:'ember',        preview:'EMBER' },
  { cat:'hits', name:'Frost',        cls:'frost',        preview:'FROST' },
  { cat:'hits', name:'Rage',         cls:'rage',         preview:'RAGE!!' },
  { cat:'hits', name:'Boom',         cls:'boom',         preview:'BOOM' },
  { cat:'hits', name:'Strike',       cls:'strike',       preview:'STRIKE' },

  // ---------------- TITLE (20) ----------------
  { cat:'title', name:'Karaoke',        cls:'karaoke',        preview:'<span class="word-current">Your</span> <span class="word-next">caption</span>' },
  { cat:'title', name:'Gradient Wave',  cls:'gradient-wave',  preview:'Gradient Wave' },
  { cat:'title', name:'Cinematic',      cls:'cinematic',      preview:'Cinematic' },
  { cat:'title', name:'Soft Glow',      cls:'soft-glow',      preview:'Soft Glow' },
  { cat:'title', name:'Movie Title',    cls:'movie-title',    preview:'MOVIE TITLE' },
  { cat:'title', name:'Western',        cls:'western',        preview:'WESTERN' },
  { cat:'title', name:'Vintage Film',   cls:'vintage-film',   preview:'Vintage Film' },
  { cat:'title', name:'Trailer',        cls:'trailer',        preview:'COMING SOON' },
  { cat:'title', name:'Big Drop',       cls:'big-drop',       preview:'BIG DROP' },
  { cat:'title', name:'Marquee',        cls:'marquee',        preview:'MARQUEE' },
  { cat:'title', name:'Royal',          cls:'royal',          preview:'ROYAL' },
  { cat:'title', name:'Epic',           cls:'epic',           preview:'EPIC' },
  { cat:'title', name:'Saga',           cls:'saga',           preview:'The Saga' },
  { cat:'title', name:'Noir',           cls:'noir',           preview:'NOIR' },
  { cat:'title', name:'Heading',        cls:'heading',        preview:'Chapter One' },
  { cat:'title', name:'Headline',       cls:'headline',       preview:'HEADLINE' },
  { cat:'title', name:'Banner',         cls:'banner',         preview:'BANNER' },
  { cat:'title', name:'Stamp',          cls:'stamp',          preview:'APPROVED' },
  { cat:'title', name:'Award',          cls:'award',          preview:'AWARDS' },
  { cat:'title', name:'Premiere',       cls:'premiere',       preview:'PREMIERE' },

  // ---------------- VLOG (20) ----------------
  { cat:'vlog', name:'Typewriter',  cls:'typewriter',  preview:'typewriter' },
  { cat:'vlog', name:'Comic',       cls:'comic',       preview:'Fun Comic!' },
  { cat:'vlog', name:'Retro VHS',   cls:'retro-vhs',   preview:'RETRO VHS' },
  { cat:'vlog', name:'Podcast',     cls:'podcast',     preview:'The key insight is this...' },
  { cat:'vlog', name:'Handwritten', cls:'handwritten', preview:'handwritten' },
  { cat:'vlog', name:'Sticky Note', cls:'sticky-note', preview:'sticky note!' },
  { cat:'vlog', name:'Sketch',      cls:'sketch',      preview:'sketch' },
  { cat:'vlog', name:'Marker',      cls:'marker',      preview:'highlight' },
  { cat:'vlog', name:'Doodle',      cls:'doodle',      preview:'doodle :)' },
  { cat:'vlog', name:'Diary',       cls:'diary',       preview:'Dear diary,' },
  { cat:'vlog', name:'Casual',      cls:'casual',      preview:'hey friends' },
  { cat:'vlog', name:'Chat Bubble', cls:'chat-bubble', preview:'hi there' },
  { cat:'vlog', name:'Polaroid',    cls:'polaroid',    preview:'memories' },
  { cat:'vlog', name:'Notebook',    cls:'notebook',    preview:'notebook' },
  { cat:'vlog', name:'Lifestyle',   cls:'lifestyle',   preview:'lifestyle' },
  { cat:'vlog', name:'Travel',      cls:'travel',      preview:'Travel Diary' },
  { cat:'vlog', name:'Cooking',     cls:'cooking',     preview:'recipe time' },
  { cat:'vlog', name:'Daily',       cls:'daily',       preview:'daily vlog' },
  { cat:'vlog', name:'Memo',        cls:'memo',        preview:'MEMO' },
  { cat:'vlog', name:'Scribble',    cls:'scribble',    preview:'scribble!' }
];

router.get('/', requireAuth, (req, res) => {
  const headHTML = getHeadHTML('Caption Styles');
  const sidebar = getSidebar('caption-presets', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();
  const baseCSS = getBaseCSS();

  const css = `
    ${baseCSS}

    :root {
      --primary: #6C3AED;
      --surface: #1a1a2e;
      --dark: #0f0f1e;
      --text: #ffffff;
      --text-muted: #a0aec0;
      --border-subtle: #2d2d4a;
      --gradient-1: linear-gradient(135deg, #6C3AED, #ec4899);
      --gradient-wave: linear-gradient(90deg, #a855f7, #ec4899);
      --neon-green: #39ff14;
      --neon-cyan: #00ffff;
      --golden: #d4a574;
    }

    [data-theme="light"] {
      --surface: #ffffff;
      --dark: #f5f5f5;
      --text: #1a1a2e;
      --text-muted: #64748b;
      --border-subtle: #e2e8f0;
      --gradient-1: linear-gradient(135deg, #6C3AED, #ec4899);
      --golden: #b8860b;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--dark);
      color: var(--text);
      line-height: 1.6;
    }

    .dashboard { display: flex; height: 100vh; overflow: hidden; }
    .sidebar { flex-shrink: 0; }
    .main-content { flex: 1; overflow-y: auto; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 1.5rem;
    }

    .header-content h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header-content p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .theme-toggle-header { display: flex; align-items: center; }

    .content-wrapper {
      padding: 0 2rem 2rem 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Category tabs */
    .category-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      padding: 0.5rem;
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
    }
    .category-tab {
      flex: 1 1 0;
      min-width: 110px;
      padding: 0.75rem 1rem;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 10px;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .category-tab:hover {
      color: var(--text);
      background: rgba(108,58,237,0.1);
    }
    .category-tab.active {
      background: var(--gradient-1);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(108,58,237,0.35);
    }
    .category-tab .cat-icon { font-size: 1rem; }
    .category-tab .cat-count {
      background: rgba(255,255,255,0.18);
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .category-tab:not(.active) .cat-count {
      background: rgba(108,58,237,0.15);
      color: var(--primary);
    }

    .category-section {
      display: none;
    }
    .category-section.active {
      display: block;
    }
    .category-heading {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 1rem;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text);
    }
    .category-heading .cat-icon { font-size: 1.3rem; }
    .category-heading .cat-meta {
      color: var(--text-muted);
      font-weight: 500;
      font-size: 0.85rem;
    }

    .presets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .preset-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
    }

    .preset-card:hover {
      border-color: var(--primary);
      box-shadow: 0 6px 24px rgba(108, 58, 237, 0.2);
      transform: translateY(-3px);
    }

    .preview-container {
      background: #000000;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      position: relative;
      overflow: hidden;
    }

    .preview-text {
      font-size: 0.95rem;
      text-align: center;
      white-space: nowrap;
      word-wrap: break-word;
      max-width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
    }

    /* =============================== */
    /*   ORIGINAL 20 PRESET STYLES     */
    /* =============================== */

    .karaoke .preview-text { font-weight: 600; letter-spacing: 0.05em; }
    .karaoke .word-current {
      background: var(--gradient-wave);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .karaoke .word-next { color: #ffffff; opacity: 0.7; }

    .bold-pop .preview-text {
      font-weight: 900; font-size: 1.4rem; color: #ffffff;
      text-shadow:
        -2px -2px 0 #000, 2px -2px 0 #000,
        -2px 2px 0 #000, 2px 2px 0 #000,
        -2px 0 0 #000, 2px 0 0 #000,
        0 -2px 0 #000, 0 2px 0 #000,
        -3px 0 0 #000, 3px 0 0 #000,
        0 -3px 0 #000, 0 3px 0 #000;
    }

    .minimal .preview-text {
      font-weight: 300; font-size: 1rem; letter-spacing: 0.1em;
      color: #ffffff; text-transform: lowercase; opacity: 0.9;
    }

    .neon-glow .preview-text {
      color: var(--neon-green); font-weight: 600; font-size: 1.1rem;
      text-shadow:
        0 0 10px var(--neon-green), 0 0 20px var(--neon-green),
        0 0 30px var(--neon-green), 0 0 40px var(--neon-cyan),
        0 0 20px var(--neon-cyan);
      filter: brightness(1.2);
    }

    .gradient-wave .preview-text {
      background: var(--gradient-wave);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 700; font-size: 1.3rem; letter-spacing: 0.03em;
    }

    .typewriter .preview-text {
      font-family: 'Courier New', monospace;
      color: #00ff00; font-weight: 500; font-size: 1.1rem;
      letter-spacing: 0.05em;
      text-shadow: 0 0 8px rgba(0, 255, 0, 0.5);
    }

    .cinematic .preview-text {
      font-family: 'Georgia', 'Times New Roman', serif;
      color: var(--golden); font-weight: 600; font-size: 1.3rem;
      letter-spacing: 0.15em; font-style: italic;
    }

    .street .preview-text {
      font-weight: 900; color: #ffff00; font-size: 1.3rem;
      font-style: italic; text-transform: uppercase; letter-spacing: 0.05em;
      text-shadow: 2px 2px 0 #ff6600, 4px 4px 0 #ff0000, -2px 2px 0 #ff0000;
    }

    .hormozi .preview-text {
      font-weight: 900; font-size: 1.4rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.02em;
    }
    .hormozi .word-highlight {
      color: #FACC15; background: rgba(250,204,21,0.15);
      padding: 0 4px; border-radius: 3px;
    }

    .mrbeast .preview-text {
      font-weight: 900; font-size: 1.5rem; color: #FFD700;
      text-transform: uppercase; letter-spacing: 0.03em;
      text-shadow:
        -3px -3px 0 #1a1a1a, 3px -3px 0 #1a1a1a,
        -3px 3px 0 #1a1a1a, 3px 3px 0 #1a1a1a,
        -4px 0 0 #1a1a1a, 4px 0 0 #1a1a1a,
        0 -4px 0 #1a1a1a, 0 4px 0 #1a1a1a;
      -webkit-text-stroke: 1px #000;
    }

    .classic-sub .preview-container { background: #111; }
    .classic-sub .preview-text {
      background: rgba(0,0,0,0.75); color: #ffffff;
      font-weight: 500; font-size: 1rem; padding: 6px 16px;
      border-radius: 4px; letter-spacing: 0.02em;
    }

    .outline-style .preview-text {
      font-weight: 900; font-size: 1.4rem; color: transparent;
      -webkit-text-stroke: 2px #ffffff; letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .soft-glow .preview-text {
      color: #ffffff; font-weight: 600; font-size: 1.2rem;
      text-shadow:
        0 0 10px rgba(255,255,255,0.8),
        0 0 20px rgba(255,255,255,0.5),
        0 0 40px rgba(255,255,255,0.3),
        0 0 60px rgba(168,85,247,0.3);
      letter-spacing: 0.05em;
    }

    .retro-vhs .preview-text {
      font-family: 'Courier New', monospace;
      color: #ff3366; font-weight: 700; font-size: 1.2rem;
      text-transform: uppercase; letter-spacing: 0.15em;
      text-shadow: 2px 0 #00ffff, -2px 0 #ff0066, 0 0 8px rgba(255,51,102,0.5);
    }

    .comic .preview-text {
      font-family: 'Comic Sans MS', 'Chalkboard SE', cursive;
      color: #ffffff; font-weight: 700; font-size: 1.2rem;
      background: linear-gradient(135deg, #FF6B6B, #FFE66D);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(2px 2px 0 #000);
    }

    .fire .preview-text {
      font-weight: 800; font-size: 1.3rem;
      background: linear-gradient(180deg, #FFD700 0%, #FF6B00 40%, #FF0000 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase; letter-spacing: 0.03em;
      filter: drop-shadow(0 0 8px rgba(255,107,0,0.6));
    }

    .clean-modern .preview-text {
      font-weight: 500; font-size: 1.1rem; color: #ffffff;
      letter-spacing: 0.08em;
      border-bottom: 2px solid var(--primary); padding-bottom: 4px;
    }

    .podcast .preview-text {
      font-family: 'Georgia', 'Times New Roman', serif;
      color: #e2e8f0; font-weight: 400; font-size: 1.15rem;
      font-style: italic; letter-spacing: 0.02em;
      border-left: 3px solid var(--primary); padding-left: 12px;
    }

    .tiktok-trend .preview-text {
      font-weight: 800; font-size: 1.3rem; color: #ffffff;
      background: linear-gradient(90deg, #25F4EE, #FE2C55);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase; letter-spacing: 0.04em;
    }

    .shadow-drop .preview-text {
      font-weight: 800; font-size: 1.3rem; color: #ffffff;
      text-shadow: 4px 4px 0 rgba(108,58,237,0.7), 8px 8px 0 rgba(108,58,237,0.3);
      text-transform: uppercase; letter-spacing: 0.03em;
    }

    /* =============================== */
    /*   NEW PRESETS (80)              */
    /* =============================== */

    /* ---- TRENDING ---- */
    .reels-pop .preview-text {
      font-weight: 800; font-size: 1.3rem;
      background: linear-gradient(135deg, #F58529, #DD2A7B, #8134AF);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.04em;
      filter: drop-shadow(0 0 6px rgba(221,42,123,0.4));
    }
    .yt-shorts .preview-text {
      font-weight: 900; font-size: 1.35rem; color: #FFFFFF;
      background: #FF0000; padding: 4px 10px; border-radius: 4px;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .snap-style .preview-text {
      font-weight: 700; font-size: 1.1rem; color: #1a1a1a;
      background: #FFFC00; padding: 5px 14px; border-radius: 6px;
      letter-spacing: 0.02em;
    }
    .threads-bold .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #ffffff;
      letter-spacing: -0.02em; text-transform: uppercase;
    }
    .x-caption .preview-text {
      font-weight: 500; font-size: 1.05rem; color: #ffffff;
      letter-spacing: 0; opacity: 0.95;
    }
    .viral-yellow .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #1a1a1a;
      background: #FFEE00; padding: 4px 12px; border-radius: 4px;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .twitch-purple .preview-text {
      font-weight: 800; font-size: 1.2rem; color: #fff;
      background: linear-gradient(135deg, #9146FF, #6441A5);
      padding: 5px 14px; border-radius: 6px; text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .reaction-pop .preview-text {
      font-weight: 900; font-size: 1.35rem; color: #FFFFFF;
      text-shadow: 3px 3px 0 #FF1744, 6px 6px 0 rgba(255,23,68,0.4);
      text-transform: uppercase; letter-spacing: 0.02em;
    }
    .influencer .preview-text {
      font-weight: 700; font-size: 1.2rem; font-style: italic;
      background: linear-gradient(135deg, #FF6FB5, #FFC1F0);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 6px rgba(255,111,181,0.4));
    }
    .trending-box .preview-text {
      font-weight: 800; font-size: 1.05rem; color: #1a1a1a;
      background: #ffffff; padding: 6px 14px; border-radius: 4px;
      text-transform: uppercase; letter-spacing: 0.08em;
      box-shadow: 0 4px 12px rgba(255,255,255,0.2);
    }
    .hype-bold .preview-text {
      font-weight: 900; font-size: 1.4rem; color: #FF1744;
      -webkit-text-stroke: 1px #ffffff;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 0 0 12px rgba(255,23,68,0.5);
    }
    .storytime .preview-text {
      font-weight: 600; font-size: 1.1rem; color: #ffffff;
      letter-spacing: 0.01em;
    }
    .storytime .word-highlight {
      background: #4ADE80; color: #052e16;
      padding: 1px 6px; border-radius: 4px; font-weight: 700;
    }
    .pop-out .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 2px 2px 0 #00E5FF, 4px 4px 0 #FF1744, 6px 6px 0 #FFEA00;
    }
    .splash .preview-text {
      font-weight: 800; font-size: 1.25rem; color: #ffffff;
      background: radial-gradient(circle, #FF6FB5 0%, #8134AF 70%);
      padding: 6px 16px; border-radius: 50px;
      letter-spacing: 0.02em;
    }
    .buzz .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #FFEA00;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 1px 0 #FFEA00, -1px 0 #FFEA00, 0 0 14px #FFEA00, 0 0 28px rgba(255,234,0,0.6);
    }
    .punchline .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.05em;
      border-left: 4px solid #FF1744; border-right: 4px solid #FF1744;
      padding: 0 12px;
    }

    /* ---- CLASSIC ---- */
    .closed-caption .preview-container { background: #000; }
    .closed-caption .preview-text {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: #000000; color: #ffffff; font-weight: 500;
      font-size: 1rem; padding: 5px 12px; letter-spacing: 0;
    }
    .newsroom .preview-text {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-weight: 700; font-size: 1.25rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.05em;
      border-bottom: 3px solid #C8102E; padding-bottom: 4px;
    }
    .broadcast .preview-text {
      font-weight: 600; font-size: 1.1rem; color: #ffffff;
      letter-spacing: 0.02em;
      background: rgba(0,0,0,0.85); padding: 6px 14px; border-radius: 2px;
    }
    .documentary .preview-text {
      font-family: 'Georgia', serif;
      color: #f5f5f5; font-weight: 400; font-size: 1.1rem;
      letter-spacing: 0.04em; opacity: 0.95;
    }
    .interview .preview-text {
      font-family: 'Georgia', serif;
      color: #ffffff; font-style: italic; font-weight: 500;
      font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.5);
      padding-bottom: 3px;
    }
    .lower-third .preview-text {
      font-weight: 700; font-size: 1.05rem; color: #ffffff;
      background: linear-gradient(90deg, var(--primary), transparent);
      padding: 5px 18px 5px 12px; border-left: 4px solid var(--primary);
    }
    .plain-white .preview-text {
      font-weight: 500; font-size: 1.1rem; color: #ffffff;
    }
    .plain-black .preview-container { background: #fafafa; }
    .plain-black .preview-text {
      font-weight: 600; font-size: 1.1rem; color: #0a0a0a;
    }
    .sans-serif .preview-text {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-weight: 400; font-size: 1.1rem; color: #ffffff;
      letter-spacing: 0.01em;
    }
    .serif-classic .preview-text {
      font-family: 'Times New Roman', Times, serif;
      font-weight: 600; font-size: 1.2rem; color: #ffffff;
      letter-spacing: 0.02em;
    }
    .subtitle-bold .preview-text {
      font-weight: 800; font-size: 1.15rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7);
    }
    .pure-text .preview-text {
      font-weight: 300; font-size: 1.05rem; color: #ffffff;
      letter-spacing: 0.03em;
    }
    .bordered .preview-text {
      font-weight: 600; font-size: 1.05rem; color: #ffffff;
      border: 1px solid #ffffff; padding: 4px 12px;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .dictation .preview-text {
      font-family: 'Georgia', serif; color: #e2e8f0;
      font-style: italic; font-size: 1.1rem; opacity: 0.9;
    }
    .letterbox .preview-text {
      font-weight: 600; font-size: 1rem; color: #ffffff;
      letter-spacing: 0.4em; text-transform: uppercase;
    }
    .editorial .preview-text {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-weight: 700; font-size: 1.2rem; color: #ffffff;
      letter-spacing: 0.01em;
    }

    /* ---- HITS ---- */
    .lightning .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #FFEA00;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 0 0 10px #FFEA00, 0 0 20px #FFEA00, 0 0 30px #FFD600,
        2px 0 0 #FFEA00, -2px 0 0 #FFEA00;
    }
    .ice-blue .preview-text {
      font-weight: 800; font-size: 1.3rem; color: #BFDBFE;
      text-transform: uppercase; letter-spacing: 0.05em;
      text-shadow: 0 0 8px #93C5FD, 0 0 18px #60A5FA, 0 0 28px #2563EB;
    }
    .crimson .preview-text {
      font-weight: 900; font-size: 1.35rem; color: #DC2626;
      text-transform: uppercase; letter-spacing: 0.03em;
      text-shadow: 0 0 12px rgba(220,38,38,0.7), 0 0 22px rgba(127,29,29,0.5);
    }
    .gold-rush .preview-text {
      font-weight: 900; font-size: 1.35rem;
      background: linear-gradient(180deg, #FEF3C7 0%, #FBBF24 50%, #B45309 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.04em;
      filter: drop-shadow(2px 2px 0 #422006);
    }
    .toxic-green .preview-text {
      font-weight: 800; font-size: 1.3rem; color: #84CC16;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 0 0 8px #84CC16, 0 0 16px #4D7C0F, 0 0 24px #4D7C0F;
    }
    .hot-pink .preview-text {
      font-weight: 800; font-size: 1.3rem; color: #FF1493;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 0 0 8px #FF1493, 0 0 16px #C71585, 0 0 24px #FF69B4;
    }
    .lava .preview-text {
      font-weight: 900; font-size: 1.35rem;
      background: linear-gradient(180deg, #FBBF24 0%, #F97316 50%, #B91C1C 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.04em;
      filter: drop-shadow(0 0 8px rgba(249,115,22,0.6));
    }
    .hologram .preview-text {
      font-weight: 800; font-size: 1.3rem;
      background: linear-gradient(90deg, #00D9FF, #B14EFF, #FF6FB5, #FFEA00, #00D9FF);
      background-size: 200% 100%;
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .chrome .preview-text {
      font-weight: 900; font-size: 1.35rem;
      background: linear-gradient(180deg, #f5f5f5 0%, #b8b8b8 30%, #6b6b6b 50%, #b8b8b8 70%, #f5f5f5 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.05em;
      filter: drop-shadow(2px 2px 0 #1a1a1a);
    }
    .cyber .preview-text {
      font-family: 'Courier New', monospace;
      font-weight: 700; font-size: 1.2rem; color: #00FFFF;
      text-transform: uppercase; letter-spacing: 0.1em;
      text-shadow: 0 0 5px #00FFFF, 0 0 10px #FF00FF, 2px 0 #FF00FF, -2px 0 #00FFFF;
    }
    .glitch .preview-text {
      font-family: 'Courier New', monospace;
      font-weight: 800; font-size: 1.25rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.06em;
      text-shadow: 3px 0 0 #FF1744, -3px 0 0 #00E5FF, 0 0 12px rgba(255,255,255,0.4);
    }
    .ember .preview-text {
      font-weight: 800; font-size: 1.25rem; color: #FCA5A5;
      text-transform: uppercase; letter-spacing: 0.05em;
      text-shadow: 0 0 8px #DC2626, 0 0 16px #991B1B, 0 6px 12px rgba(220,38,38,0.4);
    }
    .frost .preview-text {
      font-weight: 700; font-size: 1.25rem; color: #ECFEFF;
      text-transform: uppercase; letter-spacing: 0.06em;
      text-shadow: 0 0 6px #CFFAFE, 0 0 14px #67E8F9, 1px 1px 0 #BAE6FD;
    }
    .rage .preview-text {
      font-weight: 900; font-size: 1.35rem; color: #FFFFFF;
      background: #DC2626; padding: 4px 12px; border-radius: 3px;
      text-transform: uppercase; letter-spacing: 0.05em;
      transform: rotate(-2deg);
    }
    .boom .preview-text {
      font-weight: 900; font-size: 1.5rem; color: #FFEA00;
      text-transform: uppercase; letter-spacing: 0.03em;
      text-shadow: -3px 0 0 #DC2626, 3px 0 0 #DC2626, 0 -3px 0 #DC2626, 0 3px 0 #DC2626,
        4px 4px 0 #1a1a1a;
      -webkit-text-stroke: 1px #1a1a1a;
    }
    .strike .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #FFFFFF;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-decoration: line-through;
      text-decoration-color: #DC2626;
      text-decoration-thickness: 4px;
    }

    /* ---- TITLE ---- */
    .movie-title .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.4rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.2em;
    }
    .western .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 900; font-size: 1.4rem; color: #92400E;
      text-transform: uppercase; letter-spacing: 0.05em;
      text-shadow: 2px 2px 0 #FBBF24, 4px 4px 0 #1a1a1a;
      -webkit-text-stroke: 1px #FBBF24;
    }
    .vintage-film .preview-text {
      font-family: 'Georgia', serif; font-style: italic;
      font-weight: 600; font-size: 1.25rem;
      color: #FBBF24; letter-spacing: 0.05em;
      filter: sepia(0.4);
    }
    .trailer .preview-text {
      font-family: 'Helvetica', Arial, sans-serif;
      font-weight: 900; font-size: 1.4rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.25em;
    }
    .big-drop .preview-text {
      font-weight: 900; font-size: 1.5rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.04em;
      text-shadow: 6px 6px 0 #1a1a1a, 8px 8px 0 var(--primary);
    }
    .marquee .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 900; font-size: 1.4rem; color: #FBBF24;
      text-transform: uppercase; letter-spacing: 0.1em;
      text-shadow: 0 0 8px #F59E0B, 0 0 16px #B45309, 0 0 4px #ffffff;
    }
    .royal .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.3rem;
      background: linear-gradient(135deg, #FBBF24, #C026D3, #FBBF24);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.12em;
    }
    .epic .preview-text {
      font-weight: 900; font-size: 1.6rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.1em;
      -webkit-text-stroke: 2px #ffffff;
      color: transparent;
    }
    .saga .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.3rem;
      font-style: italic; color: #E5E7EB;
      letter-spacing: 0.03em;
      text-shadow: 0 0 14px rgba(168,85,247,0.6);
    }
    .noir .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.4rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.3em;
      filter: contrast(1.4);
    }
    .heading .preview-text {
      font-family: 'Helvetica', Arial, sans-serif;
      font-weight: 700; font-size: 1.3rem; color: #ffffff;
      letter-spacing: -0.01em;
    }
    .headline .preview-text {
      font-family: 'Times New Roman', serif;
      font-weight: 900; font-size: 1.4rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.02em;
      border-top: 2px solid #ffffff; border-bottom: 2px solid #ffffff;
      padding: 4px 0;
    }
    .banner .preview-text {
      font-weight: 900; font-size: 1.3rem; color: #ffffff;
      background: var(--primary); padding: 6px 16px;
      text-transform: uppercase; letter-spacing: 0.06em;
      transform: skewX(-8deg);
    }
    .stamp .preview-text {
      font-family: 'Courier New', monospace;
      font-weight: 900; font-size: 1.25rem; color: #DC2626;
      text-transform: uppercase; letter-spacing: 0.1em;
      border: 3px solid #DC2626; padding: 4px 12px; border-radius: 4px;
      transform: rotate(-6deg);
      filter: opacity(0.9);
    }
    .award .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.3rem;
      background: linear-gradient(180deg, #FEF3C7, #FBBF24, #92400E);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.15em;
    }
    .premiere .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.3rem; color: #FBBF24;
      text-transform: uppercase; letter-spacing: 0.15em;
      background: linear-gradient(180deg, transparent 60%, #DC2626 60%);
      padding: 4px 12px;
    }

    /* ---- VLOG ---- */
    .handwritten .preview-text {
      font-family: 'Brush Script MT', 'Lucida Handwriting', cursive;
      font-weight: 400; font-size: 1.5rem; color: #ffffff;
      letter-spacing: 0.02em; transform: rotate(-2deg);
    }
    .sticky-note .preview-container { background: #1a1a1a; }
    .sticky-note .preview-text {
      font-family: 'Comic Sans MS', cursive;
      background: #FEF08A; color: #422006;
      font-weight: 700; font-size: 1rem;
      padding: 8px 14px; border-radius: 2px;
      transform: rotate(-3deg);
      box-shadow: 3px 4px 8px rgba(0,0,0,0.4);
    }
    .sketch .preview-text {
      font-family: 'Comic Sans MS', cursive;
      font-weight: 700; font-size: 1.2rem; color: #ffffff;
      letter-spacing: 0.03em;
      text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 2px 0 0 rgba(0,0,0,0.3);
    }
    .marker .preview-text {
      font-family: 'Comic Sans MS', cursive;
      font-weight: 700; font-size: 1.15rem; color: #1a1a1a;
      background: linear-gradient(180deg, transparent 50%, #FACC15 50%);
      padding: 0 6px;
    }
    .doodle .preview-text {
      font-family: 'Comic Sans MS', cursive;
      font-weight: 700; font-size: 1.15rem; color: #FF6FB5;
      letter-spacing: 0.02em;
      text-shadow: 2px 2px 0 #ffffff, -1px -1px 0 #ffffff;
    }
    .diary .preview-text {
      font-family: 'Georgia', serif;
      font-style: italic; font-weight: 500; font-size: 1.2rem;
      color: #FDE68A; letter-spacing: 0.02em;
    }
    .casual .preview-text {
      font-family: 'Helvetica', sans-serif;
      font-weight: 500; font-size: 1.1rem; color: #ffffff;
      letter-spacing: 0; opacity: 0.95;
    }
    .chat-bubble .preview-text {
      font-family: 'Helvetica', sans-serif;
      font-weight: 600; font-size: 1rem; color: #ffffff;
      background: #2563EB; padding: 8px 14px; border-radius: 18px;
    }
    .polaroid .preview-container { background: #1a1a1a; }
    .polaroid .preview-text {
      font-family: 'Courier New', monospace;
      background: #f5f5f5; color: #1a1a1a;
      font-weight: 500; font-size: 0.95rem;
      padding: 8px 14px 16px 14px;
      transform: rotate(-2deg);
      box-shadow: 2px 4px 12px rgba(0,0,0,0.5);
    }
    .notebook .preview-text {
      font-family: 'Courier New', monospace;
      font-weight: 500; font-size: 1rem; color: #ffffff;
      letter-spacing: 0.02em;
      border-bottom: 1px solid rgba(255,255,255,0.4);
      padding-bottom: 2px;
    }
    .lifestyle .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 400; font-size: 1.2rem; color: #FBCFE8;
      font-style: italic; letter-spacing: 0.04em;
    }
    .travel .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.15rem; color: #FEF3C7;
      letter-spacing: 0.1em; text-transform: uppercase;
      border: 1px dashed #FEF3C7; padding: 4px 12px;
    }
    .cooking .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 600; font-size: 1.15rem; color: #ffffff;
      background: linear-gradient(135deg, #F97316, #DC2626);
      padding: 4px 14px; border-radius: 24px;
      letter-spacing: 0.02em;
    }
    .daily .preview-text {
      font-weight: 600; font-size: 1.1rem; color: #ffffff;
      letter-spacing: 0.02em;
      border-bottom: 2px wavy #6C3AED;
      padding-bottom: 4px;
    }
    .memo .preview-text {
      font-family: 'Courier New', monospace;
      font-weight: 700; font-size: 1.1rem; color: #FDE68A;
      text-transform: uppercase; letter-spacing: 0.1em;
      border-left: 3px solid #FDE68A; padding-left: 10px;
    }
    .scribble .preview-text {
      font-family: 'Comic Sans MS', cursive;
      font-weight: 700; font-size: 1.15rem; color: #ffffff;
      letter-spacing: 0.02em;
      text-shadow: 2px 2px 0 #FF6FB5, -2px -2px 0 #00E5FF;
    }

    .preset-info {
      padding: 0.75rem;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .preset-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.5rem;
    }

    .use-button {
      margin-top: auto;
      padding: 0.5rem 1rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 0.8rem;
    }

    .use-button:hover {
      background: linear-gradient(135deg, var(--primary), #a855f7);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(108, 58, 237, 0.4);
    }

    .use-button:active { transform: translateY(0); }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--primary);
      color: white;
      padding: 1rem 2rem;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(108, 58, 237, 0.3);
      display: none;
      align-items: center;
      gap: 0.75rem;
      z-index: 1000;
      font-weight: 500;
      animation: slideIn 0.3s ease;
    }
    .toast.show { display: flex; }
    .toast::before { content: '✓'; font-size: 1.5rem; font-weight: bold; }
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to   { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to   { transform: translateX(400px); opacity: 0; }
    }
    .toast.hide { animation: slideOut 0.3s ease forwards; }

    /* Selected card state */
    .preset-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary), 0 8px 32px rgba(108,58,237,0.25);
      position: relative;
    }
    .preset-card.selected::after {
      content: '✓';
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--primary);
      color: white;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 10px;
      z-index: 2;
    }

    /* Modal styles */
    .style-modal-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .style-modal-overlay.show { display: flex; }
    .style-modal {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 20px;
      width: 90%;
      max-width: 480px;
      overflow: hidden;
      animation: modalIn 0.3s ease;
    }
    @keyframes modalIn {
      from { transform: scale(0.9); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }
    .style-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }
    .style-modal-header h3 {
      font-size: 1.1rem;
      font-weight: 700;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .modal-close {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0 0.25rem;
      line-height: 1;
    }
    .modal-close:hover { color: var(--text); }
    .style-modal-body { padding: 1.5rem; }
    .style-modal-body > p {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-bottom: 1.25rem;
    }
    .modal-preview {
      background: #000;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 80px;
    }
    .modal-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .modal-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.85rem 1.5rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      border: none;
      font-family: inherit;
    }
    .modal-btn-primary {
      background: var(--primary);
      color: white;
    }
    .modal-btn-primary:hover {
      box-shadow: 0 8px 24px rgba(108,58,237,0.4);
      transform: translateY(-2px);
    }
    .modal-btn-secondary {
      background: rgba(108,58,237,0.15);
      color: var(--primary);
      border: 1px solid rgba(108,58,237,0.3);
    }
    .modal-btn-secondary:hover {
      background: rgba(108,58,237,0.25);
    }
    .modal-hint {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-align: center;
      opacity: 0.7;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .presets-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
      }
      .header { padding: 1.5rem; margin-bottom: 1.5rem; }
      .header-content h1 { font-size: 1.5rem; }
      .content-wrapper { padding: 0 1rem 1.5rem 1rem; }
      .preview-container { height: 100px; padding: 1.5rem; }
      .preview-text { font-size: 1rem; }
      .bold-pop .preview-text { font-size: 1.1rem; }
      .cinematic .preview-text { font-size: 1rem; letter-spacing: 0.1em; }
      .street .preview-text { font-size: 1rem; }
      .toast { bottom: 1rem; right: 1rem; padding: 0.75rem 1.5rem; font-size: 0.9rem; }
      .category-tab { min-width: 0; padding: 0.6rem 0.75rem; font-size: 0.8rem; }
      .category-tab .cat-icon { font-size: 0.9rem; }
    }

    @media (max-width: 480px) {
      .presets-grid { grid-template-columns: 1fr; }
      .header-content h1 { font-size: 1.25rem; }
      .header-content p { font-size: 0.85rem; }
      .preview-container { height: 100px; }
      .preview-text { font-size: 0.9rem; }
    }
  `;

  // ----- Build category sections from PRESETS -----
  const escAttr = (s) => String(s).replace(/'/g, "&#39;").replace(/"/g, '&quot;');
  const tabsHTML = CATEGORIES.map((c, i) => `
    <button class="category-tab ${i === 0 ? 'active' : ''}" data-cat="${c.id}">
      <span class="cat-icon">${c.icon}</span>
      <span>${c.label}</span>
      <span class="cat-count">${PRESETS.filter(p => p.cat === c.id).length}</span>
    </button>
  `).join('');

  const sectionsHTML = CATEGORIES.map((c, i) => {
    const cards = PRESETS.filter(p => p.cat === c.id).map(p => `
      <div class="preset-card ${p.cls}">
        <div class="preview-container">
          <div class="preview-text">${p.preview}</div>
        </div>
        <div class="preset-info">
          <h3 class="preset-name">${p.name}</h3>
          <button class="use-button" onclick="useStyle('${escAttr(p.name)}','${p.cls}')">Use Style</button>
        </div>
      </div>
    `).join('');
    return `
      <section class="category-section ${i === 0 ? 'active' : ''}" data-cat="${c.id}">
        <div class="category-heading">
          <span class="cat-icon">${c.icon}</span>
          <span>${c.label}</span>
          <span class="cat-meta">· ${PRESETS.filter(p => p.cat === c.id).length} styles</span>
        </div>
        <div class="presets-grid">${cards}</div>
      </section>
    `;
  }).join('');

  const html = `${headHTML}
<style>${css}</style>
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    ${themeToggle}
    <main class="main-content">
      <div class="header">
        <div class="header-content">
          <h1>Caption Styles</h1>
          <p>Choose from 100 premium caption presets across 5 categories to make your videos stand out</p>
        </div>
      </div>

      <div class="content-wrapper">
        <div class="category-tabs" role="tablist">
          ${tabsHTML}
        </div>

        ${sectionsHTML}
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <!-- Style Selection Modal -->
  <div class="style-modal-overlay" id="styleModal">
    <div class="style-modal">
      <div class="style-modal-header">
        <h3 id="modalTitle">Apply Caption Style</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="style-modal-body">
        <p id="modalDescription">Where would you like to use this caption style?</p>
        <div class="modal-preview" id="modalPreview"></div>
        <div class="modal-actions">
          <a href="/shorts" class="modal-btn modal-btn-primary">
            <span>🎬</span> Use in Smart Shorts
          </a>
          <button class="modal-btn modal-btn-secondary" onclick="savePreference()">
            <span>💾</span> Set as Default Style
          </button>
        </div>
        <p class="modal-hint">Your selected style will be applied when generating clips in Smart Shorts</p>
      </div>
    </div>
  </div>

  <script>
    ${themeScript}

    let selectedStyle = null;

    // Category tab switching
    document.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const cat = tab.getAttribute('data-cat');
        document.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.category-section').forEach(sec => {
          sec.classList.toggle('active', sec.getAttribute('data-cat') === cat);
        });
        // Smooth scroll to top of grid area
        const wrapper = document.querySelector('.content-wrapper');
        if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    function useStyle(styleName, styleClass) {
      selectedStyle = { name: styleName, class: styleClass };

      // Update modal
      document.getElementById('modalTitle').textContent = styleName + ' Style';
      document.getElementById('modalDescription').textContent = 'Apply "' + styleName + '" caption style to your videos';

      // Show preview in modal
      const previewEl = document.getElementById('modalPreview');
      const card = document.querySelector('.' + styleClass + ' .preview-text');
      if (card) {
        previewEl.innerHTML = '<div class="' + styleClass + '"><div class="preview-text">' + card.innerHTML + '</div></div>';
      }

      document.getElementById('styleModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('styleModal').classList.remove('show');
    }

    // Close modal on overlay click
    document.getElementById('styleModal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    async function savePreference() {
      if (!selectedStyle) return;

      try {
        const response = await fetch('/caption-presets/save-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style: selectedStyle.class, name: selectedStyle.name })
        });

        if (response.ok) {
          closeModal();
          showToast(selectedStyle.name + ' set as your default caption style!');

          // Highlight the selected card
          document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
          const sel = document.querySelector('.preset-card.' + selectedStyle.class);
          if (sel) sel.classList.add('selected');
        } else {
          showToast('Failed to save preference', true);
        }
      } catch (err) {
        showToast('Failed to save preference', true);
      }
    }

    function showToast(message, isError) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      if (isError) {
        toast.style.background = '#EF4444';
      } else {
        toast.style.background = 'var(--primary)';
      }
      toast.classList.remove('hide');
      toast.classList.add('show');

      setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
      }, 2500);
    }

    // Load saved preference on page load — also activate the category that contains the saved style
    (async function() {
      try {
        const response = await fetch('/caption-presets/get-preference');
        if (response.ok) {
          const data = await response.json();
          if (data.style) {
            const card = document.querySelector('.preset-card.' + data.style);
            if (card) {
              card.classList.add('selected');
              const section = card.closest('.category-section');
              if (section) {
                const cat = section.getAttribute('data-cat');
                const tab = document.querySelector('.category-tab[data-cat="' + cat + '"]');
                if (tab) tab.click();
              }
            }
          }
        }
      } catch(e) {}
    })();
  </script>
</body>
</html>`;

  res.send(html);
});

// POST: Save caption style preference
router.post('/save-preference', requireAuth, async (req, res) => {
  try {
    const { style, name } = req.body;
    if (!style || !name) {
      return res.status(400).json({ error: 'Style and name are required' });
    }

    // Persist to user_settings.default_caption_style so other features (Smart Shorts
    // caption picker, Settings page) all see the same value.
    const db = getDb();
    await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
    await db.query('UPDATE user_settings SET default_caption_style = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [style, req.user.id]);

    // Also set a cookie so legacy reads still work without an extra DB roundtrip.
    res.cookie('caption_style', JSON.stringify({ style, name }), {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax'
    });

    res.json({ success: true, style, name });
    featureUsageOps.log(req.user.id, 'caption_styles').catch(() => {});
  } catch (error) {
    console.error('Save caption preference error:', error);
    res.status(500).json({ error: 'Failed to save preference' });
  }
});

// GET: Get saved caption style preference
router.get('/get-preference', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query('SELECT default_caption_style FROM user_settings WHERE user_id = $1', [req.user.id]);
    const dbStyle = result.rows[0]?.default_caption_style;
    if (dbStyle) {
      // Best-effort label lookup — find the preset by class slug.
      const found = PRESETS.find(p => p.cls === dbStyle);
      const name = found ? found.name : dbStyle;
      return res.json({ style: dbStyle, name });
    }
    // Cookie fallback for older preferences
    const pref = req.cookies?.caption_style;
    if (pref) {
      const parsed = JSON.parse(pref);
      return res.json(parsed);
    }
    res.json({ style: null, name: null });
  } catch (error) {
    res.json({ style: null, name: null });
  }
});

module.exports = router;
