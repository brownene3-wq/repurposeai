const express = require('express');
const { getDb } = require('../db/database');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// =============================================================================
// CAPTION STYLE CATEGORIES + PRESETS
// 5 categories × 20 presets = 100 total caption styles.
// Each preset has:
//   cat     - category id ('trending'|'classic'|'hits'|'title'|'vlog')
//   name    - display name
//   cls     - CSS class slug
//   preview - HTML rendered inside .preview-text
//   tier    - 'free' or 'premium' (premium gets the diamond entitlement icon)
// Free tier = the original 20 styles. Premium tier = the 80 newer styles.
// =============================================================================

const CATEGORIES = [
  { id: 'trending', label: 'Trending', icon: '<img src="/images/section-icons/A-85.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px">' },
  { id: 'classic',  label: 'Classic',  icon: '<img src="/images/section-icons/A-86.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px">' },
  { id: 'hits',     label: 'Hits',     icon: '<img src="/images/section-icons/A-87.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px">' },
  { id: 'title',    label: 'Title',    icon: '<img src="/images/section-icons/A-88.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px">' },
  { id: 'vlog',     label: 'Vlog',     icon: '<img src="/images/section-icons/A-89.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px">' }
];

const PRESETS = [
  // ---------------- TRENDING (20) ----------------
  { cat:'trending', tier:'free',    name:'TikTok Trending', cls:'tiktok-trend',  preview:'TRENDING', cs:{fontFamily:'Impact',fontSize:52,textColor:'25F4EE',outlineColor:'000000',outlineWidth:4,highlightColor:'FE2C55',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'free',    name:'Hormozi',         cls:'hormozi',       preview:'MAKE <span class="word-highlight">MONEY</span> NOW', cs:{fontFamily:'Arial',fontSize:50,textColor:'FFFFFF',outlineColor:'FF0000',outlineWidth:3,highlightColor:'FFFF00',animation:'none',position:'bottom'} },
  { cat:'trending', tier:'free',    name:'MrBeast',         cls:'mrbeast',       preview:'EPIC TEXT', cs:{fontFamily:'Impact',fontSize:54,textColor:'FFD700',outlineColor:'000000',outlineWidth:5,highlightColor:'FFFFFF',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'free',    name:'Bold Pop',        cls:'bold-pop',      preview:'BOLD POP', cs:{fontFamily:'Impact',fontSize:56,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:4,highlightColor:'FFD700',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Reels Pop',       cls:'reels-pop',     preview:'REELS', cs:{fontFamily:'Impact',fontSize:52,textColor:'F58529',outlineColor:'8134AF',outlineWidth:4,highlightColor:'DD2A7B',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'YouTube Shorts',  cls:'yt-shorts',     preview:'SHORTS', cs:{fontFamily:'Impact',fontSize:54,textColor:'FFFFFF',outlineColor:'FF0000',outlineWidth:4,highlightColor:'FF0000',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Snap Style',      cls:'snap-style',    preview:'snap it', cs:{fontFamily:'Impact',fontSize:46,textColor:'1A1A1A',outlineColor:'FFFC00',outlineWidth:3,highlightColor:'FFFC00',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Threads Bold',    cls:'threads-bold',  preview:'THREADS', cs:{fontFamily:'Impact',fontSize:52,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:4,highlightColor:'FFFFFF',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'X Caption',       cls:'x-caption',     preview:'just posted', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Viral Yellow',    cls:'viral-yellow',  preview:'VIRAL', cs:{fontFamily:'Impact',fontSize:52,textColor:'1A1A1A',outlineColor:'FFEE00',outlineWidth:3,highlightColor:'FFEE00',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Twitch Purple',   cls:'twitch-purple', preview:'LIVE NOW', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFFFFF',outlineColor:'9146FF',outlineWidth:4,highlightColor:'9146FF',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Reaction Pop',    cls:'reaction-pop',  preview:'WAIT WHAT?!', cs:{fontFamily:'Impact',fontSize:54,textColor:'FFFFFF',outlineColor:'FF1744',outlineWidth:4,highlightColor:'FF1744',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Influencer',      cls:'influencer',    preview:'✨ Slay ✨', cs:{fontFamily:'Arial',fontSize:48,textColor:'FF6FB5',outlineColor:'FFC1F0',outlineWidth:2,highlightColor:'FFC1F0',animation:'glow',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Trending Box',    cls:'trending-box',  preview:'TRENDING NOW', cs:{fontFamily:'Helvetica',fontSize:42,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Hype Bold',       cls:'hype-bold',     preview:'HYPE', cs:{fontFamily:'Impact',fontSize:56,textColor:'FF1744',outlineColor:'FFFFFF',outlineWidth:4,highlightColor:'FF1744',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Storytime',       cls:'storytime',     preview:'so <span class="word-highlight">basically</span>', cs:{fontFamily:'Arial',fontSize:48,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'4ADE80',animation:'none',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Pop Out',         cls:'pop-out',       preview:'POP OUT', cs:{fontFamily:'Impact',fontSize:52,textColor:'FFFFFF',outlineColor:'00E5FF',outlineWidth:4,highlightColor:'FFEA00',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Splash',          cls:'splash',        preview:'splash!', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFFFFF',outlineColor:'FF6FB5',outlineWidth:4,highlightColor:'8134AF',animation:'pop',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Buzz',            cls:'buzz',          preview:'BUZZING', cs:{fontFamily:'Impact',fontSize:54,textColor:'FFEA00',outlineColor:'FFEA00',outlineWidth:4,highlightColor:'FFEA00',animation:'glow',position:'bottom'} },
  { cat:'trending', tier:'premium', name:'Punchline',       cls:'punchline',     preview:'PUNCH LINE', cs:{fontFamily:'Impact',fontSize:52,textColor:'FFFFFF',outlineColor:'FF1744',outlineWidth:4,highlightColor:'FF1744',animation:'pop',position:'bottom'} },

  // ---------------- CLASSIC (20) ----------------
  { cat:'classic', tier:'free',    name:'Minimal',          cls:'minimal',         preview:'subtle text', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'classic', tier:'free',    name:'Classic Subtitle', cls:'classic-sub',     preview:'Classic subtitle text', cs:{fontFamily:'Arial',fontSize:38,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'free',    name:'Outline',          cls:'outline-style',   preview:'OUTLINE', cs:{fontFamily:'Impact',fontSize:52,textColor:'000000',outlineColor:'FFFFFF',outlineWidth:4,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'free',    name:'Clean Modern',     cls:'clean-modern',    preview:'Clean Modern', cs:{fontFamily:'Helvetica',fontSize:44,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'6C3AED',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Closed Caption',   cls:'closed-caption',  preview:'[CC] white text', cs:{fontFamily:'Helvetica',fontSize:38,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Newsroom',         cls:'newsroom',        preview:'BREAKING NEWS', cs:{fontFamily:'Georgia',fontSize:44,textColor:'FFFFFF',outlineColor:'C8102E',outlineWidth:2,highlightColor:'C8102E',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Broadcast',        cls:'broadcast',       preview:'Broadcast Style', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Documentary',      cls:'documentary',     preview:'A documentary tale', cs:{fontFamily:'Georgia',fontSize:42,textColor:'F5F5F5',outlineColor:'000000',outlineWidth:1,highlightColor:'F5F5F5',animation:'fade',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Interview',        cls:'interview',       preview:'…and then I said', cs:{fontFamily:'Georgia',fontSize:42,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Lower Third',      cls:'lower-third',     preview:'Albert · Founder', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'FFFFFF',outlineColor:'6C3AED',outlineWidth:2,highlightColor:'6C3AED',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Plain White',      cls:'plain-white',     preview:'Plain white text', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Plain Black',      cls:'plain-black',     preview:'Plain black text', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'000000',outlineColor:'FFFFFF',outlineWidth:2,highlightColor:'000000',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Sans Serif',       cls:'sans-serif',      preview:'Sans Serif', cs:{fontFamily:'Helvetica',fontSize:42,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Serif Classic',    cls:'serif-classic',   preview:'Serif Classic', cs:{fontFamily:'Georgia',fontSize:44,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Subtitle Bold',    cls:'subtitle-bold',   preview:'BOLD SUBTITLE', cs:{fontFamily:'Impact',fontSize:44,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:3,highlightColor:'FFFFFF',animation:'pop',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Pure Text',        cls:'pure-text',       preview:'pure text', cs:{fontFamily:'Helvetica',fontSize:38,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Bordered',         cls:'bordered',        preview:'BORDERED', cs:{fontFamily:'Helvetica',fontSize:40,textColor:'FFFFFF',outlineColor:'FFFFFF',outlineWidth:2,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Dictation',        cls:'dictation',       preview:'transcribed text', cs:{fontFamily:'Georgia',fontSize:42,textColor:'E2E8F0',outlineColor:'000000',outlineWidth:1,highlightColor:'E2E8F0',animation:'fade',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Letterbox',        cls:'letterbox',       preview:'L E T T E R B O X', cs:{fontFamily:'Helvetica',fontSize:38,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'classic', tier:'premium', name:'Editorial',        cls:'editorial',       preview:'Editorial Voice', cs:{fontFamily:'Georgia',fontSize:44,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },

  // ---------------- HITS (20) ----------------
  { cat:'hits', tier:'free',    name:'Neon Glow',    cls:'neon-glow',    preview:'NEON GLOW', cs:{fontFamily:'Arial',fontSize:48,textColor:'39FF14',outlineColor:'00FF00',outlineWidth:3,highlightColor:'39FF14',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'free',    name:'Fire',         cls:'fire',         preview:'ON FIRE', cs:{fontFamily:'Impact',fontSize:52,textColor:'FF6B00',outlineColor:'000000',outlineWidth:4,highlightColor:'FFD700',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'free',    name:'Street',       cls:'street',       preview:'STREET', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFFF00',outlineColor:'FF0000',outlineWidth:3,highlightColor:'FF6600',animation:'pop',position:'bottom'} },
  { cat:'hits', tier:'free',    name:'Shadow Drop',  cls:'shadow-drop',  preview:'SHADOW', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFFFFF',outlineColor:'6C3AED',outlineWidth:4,highlightColor:'A855F7',animation:'pop',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Lightning',    cls:'lightning',    preview:'⚡ LIGHTNING', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFEA00',outlineColor:'FFD600',outlineWidth:3,highlightColor:'FFEA00',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Ice Blue',     cls:'ice-blue',     preview:'ICE COLD', cs:{fontFamily:'Arial',fontSize:48,textColor:'BFDBFE',outlineColor:'2563EB',outlineWidth:3,highlightColor:'60A5FA',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Crimson',      cls:'crimson',      preview:'CRIMSON', cs:{fontFamily:'Impact',fontSize:50,textColor:'DC2626',outlineColor:'7F1D1D',outlineWidth:3,highlightColor:'DC2626',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Gold Rush',    cls:'gold-rush',    preview:'GOLD RUSH', cs:{fontFamily:'Impact',fontSize:52,textColor:'FBBF24',outlineColor:'B45309',outlineWidth:4,highlightColor:'FBBF24',animation:'pop',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Toxic Green',  cls:'toxic-green',  preview:'TOXIC', cs:{fontFamily:'Arial',fontSize:48,textColor:'84CC16',outlineColor:'4D7C0F',outlineWidth:3,highlightColor:'84CC16',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Hot Pink',     cls:'hot-pink',     preview:'HOT PINK', cs:{fontFamily:'Arial',fontSize:48,textColor:'FF1493',outlineColor:'C71585',outlineWidth:3,highlightColor:'FF1493',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Lava',         cls:'lava',         preview:'LAVA', cs:{fontFamily:'Impact',fontSize:52,textColor:'FF6B00',outlineColor:'B91C1C',outlineWidth:4,highlightColor:'FBBF24',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Hologram',     cls:'hologram',     preview:'HOLO', cs:{fontFamily:'Arial',fontSize:50,textColor:'B14EFF',outlineColor:'00D9FF',outlineWidth:2,highlightColor:'FFEA00',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Chrome',       cls:'chrome',       preview:'CHROME', cs:{fontFamily:'Impact',fontSize:52,textColor:'B8B8B8',outlineColor:'1A1A1A',outlineWidth:3,highlightColor:'F5F5F5',animation:'none',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Cyber',        cls:'cyber',        preview:'CYBER 2099', cs:{fontFamily:'Courier New',fontSize:46,textColor:'00FFFF',outlineColor:'FF00FF',outlineWidth:2,highlightColor:'FF00FF',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Glitch',       cls:'glitch',       preview:'GLITCH', cs:{fontFamily:'Courier New',fontSize:46,textColor:'FFFFFF',outlineColor:'FF1744',outlineWidth:2,highlightColor:'00E5FF',animation:'none',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Ember',        cls:'ember',        preview:'EMBER', cs:{fontFamily:'Arial',fontSize:48,textColor:'FCA5A5',outlineColor:'991B1B',outlineWidth:3,highlightColor:'DC2626',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Frost',        cls:'frost',        preview:'FROST', cs:{fontFamily:'Arial',fontSize:46,textColor:'ECFEFF',outlineColor:'67E8F9',outlineWidth:2,highlightColor:'BAE6FD',animation:'glow',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Rage',         cls:'rage',         preview:'RAGE!!', cs:{fontFamily:'Impact',fontSize:54,textColor:'FFFFFF',outlineColor:'DC2626',outlineWidth:4,highlightColor:'FFFFFF',animation:'pop',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Boom',         cls:'boom',         preview:'BOOM', cs:{fontFamily:'Impact',fontSize:56,textColor:'FFEA00',outlineColor:'DC2626',outlineWidth:4,highlightColor:'FFEA00',animation:'pop',position:'bottom'} },
  { cat:'hits', tier:'premium', name:'Strike',       cls:'strike',       preview:'STRIKE', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFFFFF',outlineColor:'DC2626',outlineWidth:3,highlightColor:'DC2626',animation:'none',position:'bottom'} },

  // ---------------- TITLE (20) ----------------
  { cat:'title', tier:'free',    name:'Karaoke',        cls:'karaoke',        preview:'<span class="word-current">Your</span> <span class="word-next">caption</span>', cs:{fontFamily:'Arial',fontSize:48,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FF00FF',animation:'none',position:'bottom'} },
  { cat:'title', tier:'free',    name:'Gradient Wave',  cls:'gradient-wave',  preview:'Gradient Wave', cs:{fontFamily:'Arial',fontSize:50,textColor:'FF6B6B',outlineColor:'6C3AED',outlineWidth:2,highlightColor:'25F4EE',animation:'glow',position:'bottom'} },
  { cat:'title', tier:'free',    name:'Cinematic',      cls:'cinematic',      preview:'Cinematic', cs:{fontFamily:'Georgia',fontSize:44,textColor:'D4A574',outlineColor:'000000',outlineWidth:1,highlightColor:'F0E0C0',animation:'fade',position:'bottom'} },
  { cat:'title', tier:'free',    name:'Soft Glow',      cls:'soft-glow',      preview:'Soft Glow', cs:{fontFamily:'Arial',fontSize:46,textColor:'FFFFFF',outlineColor:'A855F7',outlineWidth:2,highlightColor:'A855F7',animation:'glow',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Movie Title',    cls:'movie-title',    preview:'MOVIE TITLE', cs:{fontFamily:'Georgia',fontSize:50,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Western',        cls:'western',        preview:'WESTERN', cs:{fontFamily:'Georgia',fontSize:50,textColor:'92400E',outlineColor:'FBBF24',outlineWidth:3,highlightColor:'FBBF24',animation:'pop',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Vintage Film',   cls:'vintage-film',   preview:'Vintage Film', cs:{fontFamily:'Georgia',fontSize:46,textColor:'FBBF24',outlineColor:'B45309',outlineWidth:2,highlightColor:'FCD34D',animation:'fade',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Trailer',        cls:'trailer',        preview:'COMING SOON', cs:{fontFamily:'Helvetica',fontSize:50,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:3,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Big Drop',       cls:'big-drop',       preview:'BIG DROP', cs:{fontFamily:'Impact',fontSize:56,textColor:'FFFFFF',outlineColor:'1A1A1A',outlineWidth:5,highlightColor:'6C3AED',animation:'pop',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Marquee',        cls:'marquee',        preview:'MARQUEE', cs:{fontFamily:'Georgia',fontSize:50,textColor:'FBBF24',outlineColor:'F59E0B',outlineWidth:3,highlightColor:'FBBF24',animation:'glow',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Royal',          cls:'royal',          preview:'ROYAL', cs:{fontFamily:'Georgia',fontSize:48,textColor:'FBBF24',outlineColor:'C026D3',outlineWidth:2,highlightColor:'C026D3',animation:'glow',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Epic',           cls:'epic',           preview:'EPIC', cs:{fontFamily:'Impact',fontSize:56,textColor:'FFFFFF',outlineColor:'FFFFFF',outlineWidth:3,highlightColor:'FFFFFF',animation:'pop',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Saga',           cls:'saga',           preview:'The Saga', cs:{fontFamily:'Georgia',fontSize:48,textColor:'E5E7EB',outlineColor:'A855F7',outlineWidth:1,highlightColor:'A855F7',animation:'fade',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Noir',           cls:'noir',           preview:'NOIR', cs:{fontFamily:'Georgia',fontSize:50,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Heading',        cls:'heading',        preview:'Chapter One', cs:{fontFamily:'Helvetica',fontSize:48,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:0,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Headline',       cls:'headline',       preview:'HEADLINE', cs:{fontFamily:'Times New Roman',fontSize:50,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Banner',         cls:'banner',         preview:'BANNER', cs:{fontFamily:'Impact',fontSize:50,textColor:'FFFFFF',outlineColor:'6C3AED',outlineWidth:3,highlightColor:'FFFFFF',animation:'pop',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Stamp',          cls:'stamp',          preview:'APPROVED', cs:{fontFamily:'Courier New',fontSize:46,textColor:'DC2626',outlineColor:'DC2626',outlineWidth:3,highlightColor:'DC2626',animation:'none',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Award',          cls:'award',          preview:'AWARDS', cs:{fontFamily:'Georgia',fontSize:48,textColor:'FBBF24',outlineColor:'92400E',outlineWidth:2,highlightColor:'FBBF24',animation:'glow',position:'bottom'} },
  { cat:'title', tier:'premium', name:'Premiere',       cls:'premiere',       preview:'PREMIERE', cs:{fontFamily:'Georgia',fontSize:48,textColor:'FBBF24',outlineColor:'DC2626',outlineWidth:2,highlightColor:'DC2626',animation:'fade',position:'bottom'} },

  // ---------------- VLOG (20) ----------------
  { cat:'vlog', tier:'free',    name:'Typewriter',  cls:'typewriter',  preview:'typewriter', cs:{fontFamily:'Courier New',fontSize:42,textColor:'00FF00',outlineColor:'003300',outlineWidth:1,highlightColor:'00FF00',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'free',    name:'Comic',       cls:'comic',       preview:'Fun Comic!', cs:{fontFamily:'Verdana',fontSize:46,textColor:'FFE66D',outlineColor:'000000',outlineWidth:4,highlightColor:'FF6B6B',animation:'pop',position:'bottom'} },
  { cat:'vlog', tier:'free',    name:'Retro VHS',   cls:'retro-vhs',   preview:'RETRO VHS', cs:{fontFamily:'Courier New',fontSize:44,textColor:'FF3366',outlineColor:'00FFFF',outlineWidth:2,highlightColor:'FF0066',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'free',    name:'Podcast',     cls:'podcast',     preview:'The key insight is this...', cs:{fontFamily:'Georgia',fontSize:40,textColor:'E2E8F0',outlineColor:'000000',outlineWidth:1,highlightColor:'6C3AED',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Handwritten', cls:'handwritten', preview:'handwritten', cs:{fontFamily:'Verdana',fontSize:50,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Sticky Note', cls:'sticky-note', preview:'sticky note!', cs:{fontFamily:'Verdana',fontSize:42,textColor:'422006',outlineColor:'FEF08A',outlineWidth:2,highlightColor:'FEF08A',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Sketch',      cls:'sketch',      preview:'sketch', cs:{fontFamily:'Verdana',fontSize:46,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:2,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Marker',      cls:'marker',      preview:'highlight', cs:{fontFamily:'Verdana',fontSize:44,textColor:'1A1A1A',outlineColor:'FACC15',outlineWidth:2,highlightColor:'FACC15',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Doodle',      cls:'doodle',      preview:'doodle :)', cs:{fontFamily:'Verdana',fontSize:44,textColor:'FF6FB5',outlineColor:'FFFFFF',outlineWidth:2,highlightColor:'FF6FB5',animation:'pop',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Diary',       cls:'diary',       preview:'Dear diary,', cs:{fontFamily:'Georgia',fontSize:44,textColor:'FDE68A',outlineColor:'000000',outlineWidth:1,highlightColor:'FDE68A',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Casual',      cls:'casual',      preview:'hey friends', cs:{fontFamily:'Helvetica',fontSize:42,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'FFFFFF',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Chat Bubble', cls:'chat-bubble', preview:'hi there', cs:{fontFamily:'Helvetica',fontSize:38,textColor:'FFFFFF',outlineColor:'2563EB',outlineWidth:2,highlightColor:'2563EB',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Polaroid',    cls:'polaroid',    preview:'memories', cs:{fontFamily:'Courier New',fontSize:36,textColor:'1A1A1A',outlineColor:'F5F5F5',outlineWidth:0,highlightColor:'1A1A1A',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Notebook',    cls:'notebook',    preview:'notebook', cs:{fontFamily:'Courier New',fontSize:38,textColor:'FFFFFF',outlineColor:'000000',outlineWidth:1,highlightColor:'FFFFFF',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Lifestyle',   cls:'lifestyle',   preview:'lifestyle', cs:{fontFamily:'Georgia',fontSize:44,textColor:'FBCFE8',outlineColor:'000000',outlineWidth:1,highlightColor:'FBCFE8',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Travel',      cls:'travel',      preview:'Travel Diary', cs:{fontFamily:'Georgia',fontSize:42,textColor:'FEF3C7',outlineColor:'000000',outlineWidth:1,highlightColor:'FEF3C7',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Cooking',     cls:'cooking',     preview:'recipe time', cs:{fontFamily:'Georgia',fontSize:42,textColor:'FFFFFF',outlineColor:'F97316',outlineWidth:3,highlightColor:'DC2626',animation:'glow',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Daily',       cls:'daily',       preview:'daily vlog', cs:{fontFamily:'Helvetica',fontSize:42,textColor:'FFFFFF',outlineColor:'6C3AED',outlineWidth:1,highlightColor:'6C3AED',animation:'fade',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Memo',        cls:'memo',        preview:'MEMO', cs:{fontFamily:'Courier New',fontSize:40,textColor:'FDE68A',outlineColor:'000000',outlineWidth:2,highlightColor:'FDE68A',animation:'none',position:'bottom'} },
  { cat:'vlog', tier:'premium', name:'Scribble',    cls:'scribble',    preview:'scribble!', cs:{fontFamily:'Verdana',fontSize:44,textColor:'FFFFFF',outlineColor:'FF6FB5',outlineWidth:2,highlightColor:'00E5FF',animation:'pop',position:'bottom'} }
];

// Shared diamond entitlement icon (also used on the Billing page).
// Exported so routes/billing.js can import it for plan-card markup.
const PREMIUM_DIAMOND_SVG = `
<svg class="premium-badge" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Premium" role="img">
  <defs>
    <linearGradient id="premiumDiamondGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FEF3C7"/>
      <stop offset="45%" stop-color="#A855F7"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>
  </defs>
  <path d="M12 2.5 L21 9 L12 21.5 L3 9 Z" fill="url(#premiumDiamondGrad)" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round"/>
  <path d="M3.2 9 L20.8 9 M7.5 9 L12 21.5 L16.5 9 M12 2.5 L7.5 9 M12 2.5 L16.5 9" stroke="rgba(255,255,255,0.55)" stroke-width="0.4" fill="none"/>
</svg>`.trim();

// =============================================================================
// Per-style preview CSS shared across the Caption Styles page and the AI
// Captions page. Both pages render preset cards with identical preview text
// styling so what you see on Caption Styles is exactly what you get on AI
// Captions's preset picker. Page-specific layout (grid, header, modal) lives
// in each page's own <style> block.
// =============================================================================
const PRESETS_VISUAL_CSS = `
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
      will-change: transform, opacity, filter, background-position;
    }

    /* ====== PREMIUM DIAMOND BADGE ====== */
    .premium-badge {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
    }
    /* Caption preview placement */
    .preview-container > .premium-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7));
      z-index: 6;
      pointer-events: none;
    }

    /* ====== AUTOPLAY ANIMATIONS ====== */
    /* Universal shimmer sweep across every preview */
    .preview-container::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(110deg,
        transparent 0%,
        transparent 35%,
        rgba(255,255,255,0.07) 50%,
        transparent 65%,
        transparent 100%);
      background-size: 250% 100%;
      animation: shimmerSweep 4.5s linear infinite;
      z-index: 2;
    }
    @keyframes shimmerSweep {
      0%   { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }

    /* Karaoke - alternating word highlight */
    @keyframes karaokeSwap1 {
      0%, 49.99% { opacity: 1; }
      50%, 100%  { opacity: 0.45; }
    }
    @keyframes karaokeSwap2 {
      0%, 49.99% { opacity: 0.45; }
      50%, 100%  { opacity: 1; }
    }
    .karaoke .word-current { animation: karaokeSwap1 2.4s steps(1) infinite; }
    .karaoke .word-next    { animation: karaokeSwap2 2.4s steps(1) infinite; }

    /* Typewriter caret blink */
    .typewriter .preview-text::after {
      content: '|';
      margin-left: 2px;
      animation: caretBlink 0.6s steps(1) infinite;
    }
    @keyframes caretBlink { 50% { opacity: 0; } }

    /* Gradient flow */
    @keyframes gradientFlow {
      0%   { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    .gradient-wave .preview-text,
    .tiktok-trend .preview-text,
    .fire .preview-text,
    .comic .preview-text,
    .hologram .preview-text,
    .royal .preview-text,
    .chrome .preview-text,
    .gold-rush .preview-text,
    .lava .preview-text,
    .reels-pop .preview-text,
    .pop-out .preview-text,
    .award .preview-text,
    .vintage-film .preview-text {
      background-size: 200% auto;
      animation: gradientFlow 4s linear infinite;
    }

    /* Glow pulse for neon-style presets */
    @keyframes glowPulse {
      0%, 100% { filter: brightness(1) saturate(1); }
      50%      { filter: brightness(1.45) saturate(1.2); }
    }
    .neon-glow .preview-text,
    .soft-glow .preview-text,
    .lightning .preview-text,
    .ice-blue .preview-text,
    .hot-pink .preview-text,
    .toxic-green .preview-text,
    .ember .preview-text,
    .frost .preview-text,
    .crimson .preview-text,
    .cyber .preview-text {
      animation: glowPulse 2s ease-in-out infinite;
    }

    /* Glitch jitter */
    @keyframes glitchJitter {
      0%, 92%, 100% { transform: translate(0,0); }
      93%   { transform: translate(-2px, 1px); }
      95%   { transform: translate(2px, -1px); }
      97%   { transform: translate(-1px, 2px); }
    }
    .glitch .preview-text { animation: glitchJitter 2.5s steps(1) infinite; }

    /* Rage shake (preserves the rotated baseline from the static rule) */
    @keyframes rageShake {
      0%, 100%  { transform: rotate(-2deg); }
      25%       { transform: rotate(-3deg) translateX(-1px); }
      50%       { transform: rotate(-1deg) translateX(1px); }
      75%       { transform: rotate(-3deg) translateX(-1px); }
    }
    .rage .preview-text { animation: rageShake 0.4s steps(4) infinite; }

    /* Buzz vibration */
    @keyframes buzzVibe {
      0%, 100% { transform: translate(0,0); }
      20% { transform: translate(0.5px, -0.5px); }
      40% { transform: translate(-0.5px, 0.5px); }
      60% { transform: translate(0.5px, 0.5px); }
      80% { transform: translate(-0.5px, -0.5px); }
    }
    .buzz .preview-text { animation: buzzVibe 0.18s steps(5) infinite; }

    /* Wobble for handwritten / sticky / polaroid / stamp / scribble */
    @keyframes wobble {
      0%, 100% { transform: rotate(-2deg); }
      50%      { transform: rotate(2deg); }
    }
    .handwritten .preview-text { animation: wobble 3.5s ease-in-out infinite; }
    .sticky-note .preview-text { animation: wobble 3s ease-in-out infinite; }
    .polaroid .preview-text    { animation: wobble 3.6s ease-in-out infinite; }
    .stamp .preview-text       { animation: wobble 4s ease-in-out infinite; }
    .scribble .preview-text    { animation: wobble 3.2s ease-in-out infinite; }

    /* Strike thickness pulse */
    @keyframes strikePulse {
      0%, 100% { text-decoration-thickness: 2px; }
      50%      { text-decoration-thickness: 6px; }
    }
    .strike .preview-text { animation: strikePulse 1.5s ease-in-out infinite; }

    /* Shadow Drop depth pulse */
    @keyframes shadowGrow {
      0%, 100% { text-shadow: 4px 4px 0 rgba(108,58,237,0.7), 8px 8px 0 rgba(108,58,237,0.3); }
      50%      { text-shadow: 6px 6px 0 rgba(108,58,237,0.85), 12px 12px 0 rgba(108,58,237,0.45); }
    }
    .shadow-drop .preview-text { animation: shadowGrow 2.4s ease-in-out infinite; }

    /* Big Drop pulse */
    @keyframes bigDropPulse {
      0%, 100% { text-shadow: 6px 6px 0 #1a1a1a, 8px 8px 0 var(--primary); }
      50%      { text-shadow: 8px 8px 0 #1a1a1a, 12px 12px 0 var(--primary); }
    }
    .big-drop .preview-text { animation: bigDropPulse 2.4s ease-in-out infinite; }

    /* Marquee bulb blink */
    @keyframes marqueeBlink {
      0%, 100% { text-shadow: 0 0 8px #F59E0B, 0 0 16px #B45309, 0 0 4px #ffffff; }
      50%      { text-shadow: 0 0 14px #F59E0B, 0 0 24px #fbbf24, 0 0 6px #ffffff; }
    }
    .marquee .preview-text { animation: marqueeBlink 1.4s ease-in-out infinite; }

    /* Pop styles - reaction-pop, bold-pop, mrbeast, splash */
    @keyframes popScale {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.05); }
    }
    .reaction-pop .preview-text,
    .bold-pop .preview-text,
    .mrbeast .preview-text,
    .pop-out .preview-text {
      animation: popScale 1.7s ease-in-out infinite;
    }
    .splash .preview-text {
      animation: popScale 1.5s ease-in-out infinite;
    }

    /* Influencer twinkle */
    @keyframes influencerTwinkle {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.85; transform: scale(1.04); }
    }
    .influencer .preview-text { animation: influencerTwinkle 2.2s ease-in-out infinite; }

    /* Cinematic slow letter expand */
    @keyframes cinematicLetters {
      0%, 100% { letter-spacing: 0.15em; opacity: 0.85; }
      50%      { letter-spacing: 0.18em; opacity: 1; }
    }
    .cinematic .preview-text { animation: cinematicLetters 3s ease-in-out infinite; }

    /* Boom flash */
    @keyframes boomFlash {
      0%, 60%, 100% { filter: brightness(1); }
      65%, 70%      { filter: brightness(1.7); }
    }
    .boom .preview-text { animation: boomFlash 1.6s ease-in-out infinite; }

    /* Yt-shorts subtle pulse */
    @keyframes ytPulse {
      0%, 100% { box-shadow: 0 0 0 rgba(255,0,0,0); transform: scale(1); }
      50%      { box-shadow: 0 0 14px rgba(255,0,0,0.6); transform: scale(1.04); }
    }
    .yt-shorts .preview-text { animation: ytPulse 1.6s ease-in-out infinite; }

    /* Twitch-purple glow */
    @keyframes twitchGlow {
      0%, 100% { box-shadow: 0 0 0 rgba(145,70,255,0); }
      50%      { box-shadow: 0 0 16px rgba(145,70,255,0.7); }
    }
    .twitch-purple .preview-text { animation: twitchGlow 2s ease-in-out infinite; }

    /* Trending box lift */
    @keyframes liftPulse {
      0%, 100% { box-shadow: 0 4px 12px rgba(255,255,255,0.2); transform: translateY(0); }
      50%      { box-shadow: 0 8px 22px rgba(255,255,255,0.4); transform: translateY(-2px); }
    }
    .trending-box .preview-text { animation: liftPulse 2.4s ease-in-out infinite; }

    /* Hype bold red glow */
    @keyframes hypePulse {
      0%, 100% { text-shadow: 0 0 12px rgba(255,23,68,0.5); }
      50%      { text-shadow: 0 0 22px rgba(255,23,68,0.85); }
    }
    .hype-bold .preview-text { animation: hypePulse 1.5s ease-in-out infinite; }

    /* Cooking pot warmth pulse */
    @keyframes warmth {
      0%, 100% { filter: brightness(1); }
      50%      { filter: brightness(1.15); }
    }
    .cooking .preview-text { animation: warmth 2.4s ease-in-out infinite; }

    /* Snap subtle bob */
    @keyframes snapBob {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(-2px); }
    }
    .snap-style .preview-text { animation: snapBob 1.8s ease-in-out infinite; }

    /* Doodle bounce */
    @keyframes doodleBounce {
      0%, 100% { transform: translateY(0) rotate(-1deg); }
      50%      { transform: translateY(-2px) rotate(1deg); }
    }
    .doodle .preview-text { animation: doodleBounce 2s ease-in-out infinite; }

    /* Marker highlight slide */
    @keyframes markerSlide {
      0%   { background-size: 0% 50%; }
      50%, 100% { background-size: 100% 50%; }
    }
    .marker .preview-text {
      background-repeat: no-repeat;
      background-position: 0 100%;
      animation: markerSlide 2.8s ease-in-out infinite;
    }

    /* Premiere subtle pulse */
    @keyframes premierePulse {
      0%, 100% { letter-spacing: 0.15em; }
      50%      { letter-spacing: 0.2em; }
    }
    .premiere .preview-text { animation: premierePulse 3s ease-in-out infinite; }

    /* Royal shimmer */
    .royal .preview-text { /* gradientFlow already applied above */ }

    /* Punchline accent grow */
    @keyframes punchAccent {
      0%, 100% { border-color: #FF1744; }
      50%      { border-color: #FFB300; }
    }
    .punchline .preview-text { animation: punchAccent 1.4s ease-in-out infinite; }

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
    .karaoke .word-next { color: #ffffff; }

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
    }

    .fire .preview-text {
      font-weight: 800; font-size: 1.3rem;
      background: linear-gradient(180deg, #FFD700 0%, #FF6B00 40%, #FF0000 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase; letter-spacing: 0.03em;
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
    }
    .hologram .preview-text {
      font-weight: 800; font-size: 1.3rem;
      background: linear-gradient(90deg, #00D9FF, #B14EFF, #FF6FB5, #FFEA00, #00D9FF);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .chrome .preview-text {
      font-weight: 900; font-size: 1.35rem;
      background: linear-gradient(180deg, #f5f5f5 0%, #b8b8b8 30%, #6b6b6b 50%, #b8b8b8 70%, #f5f5f5 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.05em;
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
      background: linear-gradient(90deg, #FCD34D, #FBBF24, #B45309, #FBBF24, #FCD34D);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .trailer .preview-text {
      font-family: 'Helvetica', Arial, sans-serif;
      font-weight: 900; font-size: 1.4rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.25em;
    }
    .big-drop .preview-text {
      font-weight: 900; font-size: 1.5rem; color: #ffffff;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .marquee .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 900; font-size: 1.4rem; color: #FBBF24;
      text-transform: uppercase; letter-spacing: 0.1em;
    }
    .royal .preview-text {
      font-family: 'Georgia', serif;
      font-weight: 700; font-size: 1.3rem;
      background: linear-gradient(135deg, #FBBF24, #C026D3, #FBBF24);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; text-transform: uppercase; letter-spacing: 0.12em;
    }
    .epic .preview-text {
      font-weight: 900; font-size: 1.6rem;
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
      letter-spacing: 0.02em;
    }
    .sticky-note .preview-container { background: #1a1a1a; }
    .sticky-note .preview-text {
      font-family: 'Comic Sans MS', cursive;
      background: #FEF08A; color: #422006;
      font-weight: 700; font-size: 1rem;
      padding: 8px 14px; border-radius: 2px;
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
      background-image: linear-gradient(180deg, transparent 50%, #FACC15 50%);
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
`;

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
      --gradient-1: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
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
      --gradient-1: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
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

    /* Header CTA — quick link to the AI Captions page so users know where
       added styles end up and can jump there in one click. */
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    /* Quiet text-link variant — matches /billing's .back-link CTA */
    .header-cta {
      color: var(--primary-light);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
      white-space: nowrap;
    }
    .header-cta:hover { text-decoration: underline; }
    .header-cta .cta-arrow {
      transition: transform 0.15s ease;
      font-weight: 700;
    }
    .header-cta:hover .cta-arrow { transform: translateX(3px); }
    .header-cta .added-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      background: rgba(108,58,237,0.18);
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0;
      color: var(--primary-light);
    }
    .header-cta .added-count.is-empty { display: none; }
    @media (max-width: 768px) {
      .header-cta { font-size: 0.82rem; }
      .header-cta .cta-label-long { display: none; }
    }

    .content-wrapper {
      padding: 0 2rem 2rem 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Tier filter (Free vs Premium) - clickable single-select toggle */
    .tier-filter {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .tier-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.9rem;
      background: transparent;
      border: 1px solid var(--border-subtle);
      border-radius: 999px;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .tier-btn:hover {
      color: var(--text);
      border-color: var(--primary);
    }
    .tier-btn.active {
      background: var(--gradient-1);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(108,58,237,0.35);
    }
    .tier-btn .legend-dot {
      width: 10px; height: 10px; border-radius: 999px;
      background: #4ADE80;
    }
    .tier-btn .legend-diamond {
      width: 14px; height: 14px;
    }
    /* When a tier filter is active, hide cards that don't match */
    .presets-grid[data-filter='free'] .preset-card[data-tier='premium'],
    .presets-grid[data-filter='premium'] .preset-card[data-tier='free'] {
      display: none;
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

    .category-section { display: none; }
    .category-section.active { display: block; }
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

${PRESETS_VISUAL_CSS}

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
      transition: all 0.2s ease;
      font-size: 0.8rem;
    }
    .use-button:hover {
      background: linear-gradient(135deg, var(--primary), #a855f7);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(108, 58, 237, 0.4);
    }
    .use-button:active { transform: translateY(0); }

    /* Remove state */
    .use-button.is-added {
      background: rgba(108,58,237,0.12);
      color: var(--primary);
      border: 1px solid rgba(108,58,237,0.3);
    }
    .use-button.is-added:hover {
      background: rgba(239,68,68,0.15);
      color: #EF4444;
      border-color: rgba(239,68,68,0.4);
      box-shadow: none;
    }

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
    /* Clickable deselect badge — visible only when the card is selected */
    .deselect-badge {
      display: none;
      position: absolute;
      top: 6px;
      right: 6px;
      width: 22px;
      height: 22px;
      align-items: center;
      justify-content: center;
      background: var(--primary);
      color: #ffffff;
      font-size: 0.7rem;
      font-weight: 700;
      border: none;
      border-radius: 999px;
      cursor: pointer;
      z-index: 8;
      padding: 0;
      line-height: 1;
      transition: background 0.15s ease, transform 0.15s ease;
    }
    .deselect-badge:hover {
      background: #EF4444;
      transform: scale(1.1);
    }
    .deselect-badge::before { content: '✓'; }
    .deselect-badge:hover::before { content: '×'; font-size: 0.95rem; }
    .preset-card.selected .deselect-badge { display: inline-flex; }
    .preset-card.selected .preview-container > .premium-badge {
      /* Nudge the diamond slightly down-left so it doesn't collide with the deselect badge */
      top: 6px; right: 34px;
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

    /* Reduced motion: respect user preference */
    @media (prefers-reduced-motion: reduce) {
      .preview-container::after,
      .preview-text,
      .karaoke .word-current,
      .karaoke .word-next,
      .typewriter .preview-text::after {
        animation: none !important;
      }
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
      <div class="preset-card ${p.cls}" data-tier="${p.tier}" data-cls="${p.cls}">
        <div class="preview-container">
          <div class="preview-text">${p.preview}</div>
          ${p.tier === 'premium' ? PREMIUM_DIAMOND_SVG : ''}
        </div>
        <div class="preset-info">
          <h3 class="preset-name">${p.name}</h3>
          <button class="use-button add-btn" type="button" data-cls="${p.cls}" data-name="${escAttr(p.name)}">Add</button>
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
          <h1><img src="/images/section-icons/A-4.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Caption Styles</h1>
          <p>Choose from 100 premium caption presets across 5 categories to make your videos stand out</p>
        </div>
        <div class="header-actions">
          <a href="/ai-captions" class="header-cta" id="viewAiCaptionsBtn"
             title="Open the AI Captions page to use the styles you've added">
            <span><span class="cta-label-long">View on </span>AI Captions</span>
            <span class="added-count is-empty" id="addedCountBadge" aria-label="styles added">0</span>
            <span class="cta-arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </div>

      <div class="content-wrapper">
        <div class="tier-filter" role="group" aria-label="Filter by tier">
          <button class="tier-btn" type="button" data-tier="free" aria-pressed="false">
            <span class="legend-dot"></span>
            <span>Free</span>
          </button>
          <button class="tier-btn" type="button" data-tier="premium" aria-pressed="false">
            ${PREMIUM_DIAMOND_SVG.replace('class="premium-badge"', 'class="premium-badge legend-diamond"')}
            <span>Premium</span>
          </button>
        </div>

        <div class="category-tabs" role="tablist">
          ${tabsHTML}
        </div>

        ${sectionsHTML}
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

<!-- modal removed: Add/Remove flow no longer pops up -->

  <script>
    ${themeScript}

    // Category tab switching
    document.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const cat = tab.getAttribute('data-cat');
        document.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.category-section').forEach(sec => {
          sec.classList.toggle('active', sec.getAttribute('data-cat') === cat);
        });
        const wrapper = document.querySelector('.content-wrapper');
        if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Tier filter (Free / Premium) — single-select toggle. Click again to clear.
    function applyTierFilter(tier) {
      document.querySelectorAll('.presets-grid').forEach(g => {
        if (tier) g.setAttribute('data-filter', tier);
        else g.removeAttribute('data-filter');
      });
      document.querySelectorAll('.tier-btn').forEach(b => {
        const isActive = b.getAttribute('data-tier') === tier;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', String(isActive));
      });
    }
    let activeTier = null;
    document.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-tier');
        activeTier = (activeTier === t) ? null : t;
        applyTierFilter(activeTier);
      });
    });

    // Add / Remove flow ------------------------------------------------------
    function setBtnState(btn, isAdded) {
      btn.textContent = isAdded ? 'Remove' : 'Add';
      btn.classList.toggle('is-added', !!isAdded);
    }
    async function toggleAddRemove(btn) {
      const cls  = btn.getAttribute('data-cls');
      const name = btn.getAttribute('data-name');
      const isAdded = btn.classList.contains('is-added');
      const url = isAdded ? '/caption-presets/remove' : '/caption-presets/add';
      btn.disabled = true;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style: cls })
        });
        if (!r.ok) throw new Error('bad response');
        const data = await r.json().catch(() => null);
        setBtnState(btn, !isAdded);
        if (data && Array.isArray(data.enabled)) {
          updateAddedCountBadge(data.enabled.length);
        } else {
          // Best-effort fallback — increment/decrement based on the action.
          const badge = document.getElementById('addedCountBadge');
          const cur = badge ? parseInt(badge.textContent || '0', 10) || 0 : 0;
          updateAddedCountBadge(Math.max(0, cur + (isAdded ? -1 : 1)));
        }
        if (!isAdded) {
          showToast(name + ' is now available on the AI Captions page');
        } else {
          showToast(name + ' removed from AI Captions');
        }
      } catch (e) {
        showToast('Could not update — try again', true);
      } finally {
        btn.disabled = false;
      }
    }
    document.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleAddRemove(btn));
    });

    function updateAddedCountBadge(n) {
      const badge = document.getElementById('addedCountBadge');
      if (!badge) return;
      badge.textContent = String(n);
      badge.classList.toggle('is-empty', n === 0);
    }

    // Initial state: fetch the user's enabled list and mark added cards
    (async function() {
      try {
        const r = await fetch('/caption-presets/enabled');
        if (!r.ok) return;
        const data = await r.json();
        const enabled = new Set(data.enabled || []);
        document.querySelectorAll('.add-btn').forEach(btn => {
          setBtnState(btn, enabled.has(btn.getAttribute('data-cls')));
        });
        updateAddedCountBadge(enabled.size);
      } catch(e) {}
    })();

    function showToast(message, isError) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.background = isError ? '#EF4444' : 'var(--primary)';
      toast.classList.remove('hide');
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
      }, 2500);
    }

    // ---- old modal logic kept for backwards-compat in case anything still calls it ----
    // (legacy modal/popup logic removed)

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

    const db = getDb();
    await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
    await db.query('UPDATE user_settings SET default_caption_style = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [style, req.user.id]);

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

// POST: Clear the saved caption style preference (deselect the highlighted card)
router.post('/clear-preference', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.query('UPDATE user_settings SET default_caption_style = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1', [req.user.id]);
    res.clearCookie('caption_style');
    res.json({ success: true });
  } catch (error) {
    console.error('Clear caption preference error:', error);
    res.status(500).json({ error: 'Failed to clear preference' });
  }
});

// GET: Get saved caption style preference
router.get('/get-preference', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query('SELECT default_caption_style FROM user_settings WHERE user_id = $1', [req.user.id]);
    const dbStyle = result.rows[0]?.default_caption_style;
    if (dbStyle) {
      const found = PRESETS.find(p => p.cls === dbStyle);
      const name = found ? found.name : dbStyle;
      return res.json({ style: dbStyle, name });
    }
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

// =============================================================================
// Added-styles list per user. Free styles are enabled by default; premium
// styles only show on AI Captions once the user has explicitly added them.
// Storage: user_settings.enabled_caption_styles (JSONB array of class slugs).
// NULL means "use defaults (the 20 free styles)".
// =============================================================================

const FREE_STYLE_CLASSES = PRESETS.filter(p => p.tier === 'free').map(p => p.cls);

async function readEnabledStyles(userId) {
  const db = getDb();
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  const r = await db.query('SELECT enabled_caption_styles FROM user_settings WHERE user_id = $1', [userId]);
  const stored = r.rows[0]?.enabled_caption_styles;
  // Default to an empty array — nothing is enabled until the user explicitly
  // adds it from the Caption Styles page. Both 'free' and 'premium' styles
  // require an explicit Add to appear on AI Captions.
  if (stored === null || stored === undefined) {
    return [];
  }
  return Array.isArray(stored) ? stored : [];
}

async function writeEnabledStyles(userId, list) {
  const db = getDb();
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await db.query(
    'UPDATE user_settings SET enabled_caption_styles = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
    [JSON.stringify(list), userId]
  );
}

// GET /caption-presets/enabled - returns the user's enabled list
router.get('/enabled', requireAuth, async (req, res) => {
  try {
    const list = await readEnabledStyles(req.user.id);
    res.json({ enabled: list });
  } catch (e) {
    console.error('readEnabledStyles error:', e);
    res.status(500).json({ error: 'Failed to read' });
  }
});

// POST /caption-presets/add - add a style to the user's enabled list
router.post('/add', requireAuth, async (req, res) => {
  try {
    const { style } = req.body || {};
    if (!style || !PRESETS.some(p => p.cls === style)) {
      return res.status(400).json({ error: 'Unknown style' });
    }
    const list = await readEnabledStyles(req.user.id);
    if (!list.includes(style)) list.push(style);
    await writeEnabledStyles(req.user.id, list);
    res.json({ success: true, enabled: list });
  } catch (e) {
    console.error('add style error:', e);
    res.status(500).json({ error: 'Failed to add' });
  }
});

// POST /caption-presets/remove - remove a style from the user's enabled list
router.post('/remove', requireAuth, async (req, res) => {
  try {
    const { style } = req.body || {};
    if (!style) return res.status(400).json({ error: 'Missing style' });
    const list = (await readEnabledStyles(req.user.id)).filter(s => s !== style);
    await writeEnabledStyles(req.user.id, list);
    res.json({ success: true, enabled: list });
  } catch (e) {
    console.error('remove style error:', e);
    res.status(500).json({ error: 'Failed to remove' });
  }
});

// Export the diamond SVG so other routes (e.g. billing) can reuse it.
module.exports = router;
module.exports.PREMIUM_DIAMOND_SVG = PREMIUM_DIAMOND_SVG;
module.exports.PRESETS = PRESETS;
module.exports.CATEGORIES = CATEGORIES;
module.exports.readEnabledStyles = readEnabledStyles;
module.exports.FREE_STYLE_CLASSES = FREE_STYLE_CLASSES;
module.exports.PRESETS_VISUAL_CSS = PRESETS_VISUAL_CSS;
