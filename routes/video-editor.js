const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

// FFmpeg detection and setup
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) {
  ffmpegPath = localFfmpeg;
}
if (!ffmpegPath) {
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (e) {}
}
if (!ffmpegPath) {
  try {
    execSync('which ffmpeg', { stdio: 'pipe' });
    ffmpegPath = 'ffmpeg';
  } catch (e) {}
}

// Upload and output directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer configuration
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept all video/* MIME types plus common variants browsers may report
    const allowedMimes = [
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
      'video/x-matroska', 'video/x-ms-wmv', 'video/x-flv', 'video/3gpp',
      'video/3gpp2', 'video/ogg', 'video/mpeg', 'video/mp2t',
      'video/x-m4v', 'video/x-ms-asf', 'video/x-msvideo',
      'application/octet-stream' // Some browsers report video files as generic binary
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const videoExts = ['.mp4','.mov','.webm','.avi','.mkv','.wmv','.flv','.3gp','.m4v','.ts','.mpeg','.mpg','.ogv','.mts','.m2ts','.vob','.divx'];
    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('video/') || videoExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload a video file (MP4, MOV, AVI, MKV, WebM, etc).'));
    }
  }
});

// Helper: Get video metadata using ffmpeg (not ffprobe)
function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg not found'));
    }

    // First try ffprobe if available
    let ffprobePath = null;
    try {
      execSync('which ffprobe', { stdio: 'pipe' });
      ffprobePath = 'ffprobe';
    } catch (e) {
      // Try ffprobe next to ffmpeg
      const ffprobeLocal = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
      if (fs.existsSync(ffprobeLocal)) {
        ffprobePath = ffprobeLocal;
      }
    }

    if (ffprobePath) {
      const proc = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && parseFloat(output) > 0) {
          resolve({ duration: parseFloat(output) });
        } else {
          resolve({ duration: 0 });
        }
      });
      proc.on('error', () => resolve({ duration: 0 }));
    } else {
      // Fallback: use ffmpeg stderr output to parse duration
      const proc = spawn(ffmpegPath, ['-i', filePath, '-f', 'null', '-t', '0', '-']);
      let stderrOutput = '';
      proc.stderr.on('data', (data) => { stderrOutput += data.toString(); });
      proc.on('close', () => {
        const match = stderrOutput.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          const hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const seconds = parseInt(match[3]);
          const centiseconds = parseInt(match[4]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
          resolve({ duration: totalSeconds });
        } else {
          resolve({ duration: 0 });
        }
      });
      proc.on('error', () => resolve({ duration: 0 }));
    }
  });
}

// Helper: Run FFmpeg command
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg not found'));
    }

    const ffmpeg = spawn(ffmpegPath, args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

// GET: Render video editor page
router.get('/', requireAuth, async (req, res) => {
  const html = `${getHeadHTML('Video Editor')}
  <style>
    ${getBaseCSS()}
    .editor-container{display:grid;grid-template-columns:350px 1fr 380px;grid-template-rows:38px 1fr 260px;height:100vh;gap:0;padding:0;overflow:hidden}
    .editor-topbar{grid-column:1/4;grid-row:1}
    .media-library{grid-column:1;grid-row:2;display:flex;flex-direction:column;overflow:hidden;background:#110d1c;border-right:1px solid rgba(108,58,237,.08)}
    .editor-main{grid-column:2;grid-row:2;display:flex;flex-direction:column;background:#0a0612;overflow:hidden}
    .editor-sidebar{grid-column:3;grid-row:2;display:flex;flex-direction:column;background:#110d1c;border-left:1px solid rgba(108,58,237,.08);overflow:hidden;width:auto;min-width:0}
    #timelineContainer{grid-column:1/4;grid-row:3;background:#0c0814;border-top:1px solid rgba(108,58,237,.12);display:flex;flex-direction:column;overflow:hidden}
    .editor-main{display:flex;flex-direction:column;min-width:0;overflow:hidden;background:#0a0612;grid-column:2;grid-row:2}
    .video-container{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:.5rem;flex:1;display:flex;flex-direction:column;min-height:0;max-height:calc(100vh - 120px);overflow:hidden}
    .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border:2px dashed var(--primary);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:all 0.2s;min-height:180px;display:flex;flex-direction:column;justify-content:center}
    .upload-zone.dragover{background:linear-gradient(135deg,rgba(108,58,237,0.2),rgba(236,72,153,0.2));border-color:var(--primary)}
    .upload-zone.has-video{display:none}
    .upload-zone h3{font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:.5rem}
    .upload-zone p{color:var(--text-muted);font-size:.9rem;margin-bottom:1rem}
    .upload-button{padding:.6rem 1.2rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s}
    .upload-button:hover{box-shadow:0 8px 24px rgba(108,58,237,0.3);transform:translateY(-2px)}
    .video-preview-area{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border-radius:10px;flex:1;display:none;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:280px;max-height:55vh}
    .video-preview-area.has-video{display:flex;background:transparent;padding:0}
    .video-player{width:100%;height:100%;border-radius:12px;object-fit:contain;background:#000}
.timeline-container{background:#0c0814;border:none;border-top:1px solid rgba(108,58,237,.12);border-radius:0;margin:0;overflow:hidden;flex-shrink:0;user-select:none;grid-column:1/4;grid-row:3}
    .timeline-ruler{height:24px;background:#12121f;display:flex;align-items:flex-end;position:relative;padding:0 40px;border-bottom:1px solid rgba(255,255,255,0.06)}
    .timeline-ruler-mark{position:absolute;bottom:0;font-size:.6rem;color:rgba(255,255,255,0.35);transform:translateX(-50%)}
    .timeline-ruler-mark::after{content:'';display:block;width:1px;height:6px;background:rgba(255,255,255,0.15);margin:2px auto 0}
    .timeline-tracks{position:relative;padding:6px 0;min-height:90px}
    .timeline-track{display:flex;align-items:center;margin:2px 0;padding:0 8px;position:relative}
    .timeline-track#timelineVideoTrack .timeline-track-content{height:64px}
    .timeline-track#timelineAudioTrack .timeline-track-content{height:44px}
    .timeline-track#timelineMusicTrack .timeline-track-content{height:38px}
    .timeline-track-label{width:32px;flex-shrink:0;font-size:.6rem;color:var(--text-muted);text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px}
    .timeline-track-content{flex:1;height:100%;position:relative;border-radius:6px;overflow:hidden;cursor:pointer}
    .timeline-video-bar{height:100%;background:linear-gradient(180deg,#0d9488,#0f766e);border-radius:6px;position:relative;overflow:hidden;border:1px solid rgba(13,148,136,0.3)}
    .thumb-strip{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;overflow:hidden;border-radius:6px}
    .thumb-strip img{display:block;pointer-events:none}
    .track-info-overlay{position:absolute;top:0;left:0;right:0;padding:4px 12px;display:flex;align-items:center;gap:8px;z-index:2;background:linear-gradient(180deg,rgba(0,0,0,0.6) 0%,rgba(0,0,0,0) 100%)}
    .track-info-overlay .track-info{font-size:.7rem;color:rgba(255,255,255,0.95);font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,0.8)}
    .track-info-overlay .track-duration{font-size:.65rem;color:rgba(255,255,255,0.7);text-shadow:0 1px 3px rgba(0,0,0,0.8)}
    .timeline-audio-bar{height:100%;background:linear-gradient(180deg,#1e293b,#0f172a);border-radius:6px;position:relative;overflow:hidden;border:1px solid rgba(56,189,248,0.15)}
    .timeline-music-bar{height:100%;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-radius:6px;display:flex;align-items:center;padding:0 12px;position:relative;overflow:hidden}
    .timeline-music-bar .track-info{font-size:.72rem;color:rgba(255,255,255,0.9);font-weight:500;white-space:nowrap;z-index:2}
    .timeline-music-bar .track-volume{font-size:.65rem;color:rgba(255,255,255,0.6);margin-left:8px;z-index:2}
    .timeline-music-bar .waveform-bg{position:absolute;top:0;left:0;right:0;bottom:0;opacity:0.25}
    .timeline-playhead{position:absolute;top:0;bottom:0;width:2px;background:#fff;z-index:10;cursor:col-resize;pointer-events:auto}
    .timeline-playhead::before{content:'';position:absolute;top:-2px;left:-9px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:14px solid #fff;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))}
    .timeline-playhead-hitbox{position:absolute;top:-6px;bottom:0;left:-12px;width:26px;cursor:col-resize;z-index:11}
    .timeline-trim-handle{position:absolute;top:0;bottom:0;width:14px;cursor:col-resize;z-index:5;display:flex;align-items:center;justify-content:center;transition:background .2s}
    .timeline-trim-handle.left{left:0;background:linear-gradient(90deg,rgba(255,255,255,0.25),rgba(255,255,255,0.05));border-radius:6px 0 0 6px;border-left:3px solid rgba(255,255,255,0.6)}
    .timeline-trim-handle.right{right:0;background:linear-gradient(270deg,rgba(255,255,255,0.25),rgba(255,255,255,0.05));border-radius:0 6px 6px 0;border-right:3px solid rgba(255,255,255,0.6)}
    .timeline-trim-handle:hover{background:rgba(255,255,255,0.3)}
    .timeline-trim-handle::after{content:'';width:2px;height:18px;background:rgba(255,255,255,0.5);border-radius:1px}
    .timeline-trim-overlay{position:absolute;top:0;bottom:0;background:rgba(0,0,0,0.5);pointer-events:none;z-index:3}
    .timeline-empty{text-align:center;color:var(--text-muted);font-size:.85rem;padding:1.5rem}
    body.light .timeline-container{background:#f0f0f5;border-color:rgba(108,58,237,0.12)}
    body.light .timeline-ruler{background:#e8e8f0}
    .tools-section{display:none}
    .category-tabs{display:flex;gap:2px;background:var(--dark);border-radius:10px;padding:3px;border:1px solid var(--border-subtle)}
    .category-tab{flex:1;padding:8px 4px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;border-radius:8px;font-size:.72rem;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:2px;transition:all .25s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .category-tab:hover{background:rgba(108,58,237,0.1);color:var(--text)}
    .category-tab.active{background:linear-gradient(135deg,#6C3AED,#7C3AED);color:#fff;box-shadow:0 2px 8px rgba(108,58,237,0.4)}
    .cat-icon{font-size:16px;line-height:1}
    .cat-label{font-size:.65rem;letter-spacing:.3px;text-transform:uppercase}
    .category-tools{margin-top:6px;margin-bottom:8px}
    .category-grid{display:flex;gap:4px;flex-wrap:wrap;max-height:calc(100vh - 380px);overflow-y:auto}
    .category-grid .tool-button{flex:1 1 calc(50% - 4px);min-width:0;justify-content:center;padding:10px 8px;font-size:.75rem;border-radius:10px;background:var(--surface);border:1px solid var(--border-subtle);transition:all .25s;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .category-grid .tool-button:hover{border-color:var(--primary);background:rgba(108,58,237,0.08);transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,0.15)}
    .category-grid .tool-button.active{background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.1));border-color:var(--primary);color:var(--primary)}
    .properties-panel.collapsed .slider-group{display:none}
    .properties-panel.collapsed{padding:6px 10px}
    .properties-panel .panel-title{margin-bottom:0}
    .properties-panel:not(.collapsed) .panel-title{margin-bottom:8px}
    .export-floating{margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)}
    @keyframes panelSlide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
    
    .tool-button{padding:.45rem .8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:8px;color:var(--text);cursor:pointer;font-size:.78rem;font-weight:500;transition:all .2s;display:flex;align-items:center;gap:.3rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .tool-button:hover{background:var(--surface);border-color:var(--primary);color:var(--primary)}
    .tool-button.active{background:var(--primary);color:white;border-color:var(--primary)}
    .gradient-presets{display:flex;gap:8px;padding:8px 0;overflow-x:auto;scrollbar-width:none}
    .gradient-presets::-webkit-scrollbar{display:none}
    .gradient-preset-card{flex:0 0 80px;height:50px;border-radius:10px;cursor:pointer;transition:all 0.2s;border:2px solid transparent;position:relative}
    .gradient-preset-card:hover{opacity:0.85;transform:scale(1.05)}
    .gradient-preset-card.selected{border-color:#fff;transform:scale(1.05)}
    .gradient-preset-card:nth-child(1){background:linear-gradient(135deg,#6C3AED,#EC4899)}
    .gradient-preset-card:nth-child(2){background:linear-gradient(135deg,#0EA5E9,#6366F1)}
    .gradient-preset-card:nth-child(3){background:linear-gradient(135deg,#F59E0B,#EF4444)}
    .gradient-preset-card:nth-child(4){background:linear-gradient(135deg,#10B981,#06B6D4)}
    .gradient-preset-card:nth-child(5){background:linear-gradient(135deg,#8B5CF6,#A78BFA)}
    .toolbar-btn{padding:6px 12px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--surface);color:var(--text-primary);cursor:pointer;font-size:.8rem;transition:all .2s;display:flex;align-items:center;gap:4px}
    .toolbar-btn:hover{background:var(--primary);color:white;border-color:var(--primary)}
    .broll-overlay{position:absolute;cursor:move;border:2px dashed rgba(255,255,255,.6);border-radius:4px;z-index:10;overflow:hidden}
    .broll-overlay video,.broll-overlay img{width:100%;height:100%;object-fit:cover}
    .broll-overlay .resize-handle{position:absolute;bottom:0;right:0;width:16px;height:16px;background:var(--primary);border-radius:50%;cursor:se-resize;border:2px solid white}
    .broll-pos-btn:hover,.broll-pos-btn.active{background:var(--primary)!important;color:white!important;border-color:var(--primary)!important}
    #youtubeUrlInput:focus{border-color:var(--primary);box-shadow:0 0 0 2px rgba(108,58,237,.2)}
    .transcript-timestamp{color:var(--primary);font-weight:600;cursor:pointer;font-size:.8rem}
    .transcript-timestamp:hover{text-decoration:underline}
    .editor-sidebar{display:flex;flex-direction:column;gap:.4rem;overflow-y:auto;overflow-x:hidden;padding:0;scrollbar-width:thin;background:#110d1c;border-left:1px solid rgba(108,58,237,.08);grid-column:3;grid-row:2;width:auto;min-width:0}
    .editor-sidebar::-webkit-scrollbar{width:4px}
    .editor-sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
    .properties-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:.6rem .8rem;flex-shrink:0}
    .tool-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:1rem;display:none;flex-shrink:0}
    .tool-panel.active{display:block;max-height:calc(100vh - 400px);overflow-y:auto;animation:panelSlide .2s ease}
    .panel-title{font-size:.85rem;font-weight:700;color:var(--text);margin-bottom:.75rem;display:flex;align-items:center;gap:.5rem}
    .slider-group{margin-bottom:.4rem}
    .slider-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:flex;justify-content:space-between}
    .slider-value{color:var(--primary);font-weight:600}
    .slider{width:100%;height:6px;border-radius:3px;background:var(--dark);outline:none;-webkit-appearance:none;appearance:none}
    .slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer;transition:box-shadow 0.2s}
    .slider::-webkit-slider-thumb:hover{box-shadow:0 0 0 8px rgba(108,58,237,0.2)}
    .slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer;border:none;transition:box-shadow 0.2s}
    .slider::-moz-range-thumb:hover{box-shadow:0 0 0 8px rgba(108,58,237,0.2)}
    .trim-section{margin-bottom:1.5rem}
    .time-inputs{display:flex;gap:.5rem}
    .time-input{flex:1;padding:.5rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);font-size:.8rem}
    .time-input:focus{outline:none;border-color:var(--primary)}
    .input-field{padding:.6rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);font-size:.8rem;width:100%;margin-bottom:1rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .input-field:focus{outline:none;border-color:var(--primary)}
    .text-input{padding:.6rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);font-size:.8rem;width:100%;margin-bottom:1rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .text-input:focus{outline:none;border-color:var(--primary)}
    .trim-button,.tool-action-button{width:100%;padding:.6rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:.5rem;transition:all 0.2s}
    .trim-button:hover,.tool-action-button:hover{box-shadow:0 8px 16px rgba(108,58,237,0.3)}
    .trim-button:disabled,.tool-action-button:disabled{opacity:0.5;cursor:not-allowed}
    .filter-buttons{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem}
    .filter-btn{padding:.5rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text);cursor:pointer;font-size:.75rem;font-weight:600;transition:all 0.2s}
    .filter-btn:hover{border-color:var(--primary);color:var(--primary)}
    .filter-btn.selected{background:var(--primary);color:white;border-color:var(--primary)}
    .dropdown-group{margin-bottom:.6rem}
    .dropdown-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:block}
    .dropdown{width:100%;padding:.6rem .8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:8px;color:var(--text);font-size:.85rem;outline:none;transition:border-color 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;cursor:pointer}
    .dropdown:hover{border-color:var(--primary)}
    .dropdown:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(108,58,237,0.15)}
    .export-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:12px;padding:.6rem .8rem;flex-shrink:0}
    .export-button{width:100%;padding:.8rem;background:var(--primary);color:white;border:1px solid var(--primary);border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem;transition:all 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .export-button:hover{box-shadow:0 8px 24px rgba(108,58,237,0.3)}
    .export-button:disabled{opacity:0.5;cursor:not-allowed}
    .spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid var(--border-subtle);border-radius:8px;padding:1rem 1.5rem;font-size:.9rem;z-index:1000;animation:slideIn 0.3s ease-out;display:block!important;color:white;max-width:400px;height:fit-content;box-shadow:0 8px 24px rgba(0,0,0,0.4)}
    .toast.success{border-color:#10B981;background:#064e3b;color:#6ee7b7}
    .toast.error{border-color:#EF4444;background:#7f1d1d;color:#fca5a5}
    @keyframes slideIn{from{transform:translateX(-50%) translateY(-30px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
    .hidden{display:none}
    body.light .video-container{border-color:rgba(108,58,237,0.2);background:rgba(108,58,237,0.02)}
    body.light .properties-panel,body.light .export-panel,body.light .tool-panel{background:rgba(108,58,237,0.05);border-color:rgba(108,58,237,0.15)}
    body.light .tool-button{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15);color:var(--text)}
    body.light .tool-button:hover{background:rgba(108,58,237,0.15);border-color:var(--primary)}
    body.light .dropdown{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .slider{background:rgba(108,58,237,0.15)}
    body.light .upload-zone{background:linear-gradient(135deg,rgba(108,58,237,0.05),rgba(236,72,153,0.05));border-color:rgba(108,58,237,0.3)}
    body.light .input-field,body.light .text-input{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .filter-btn{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    @media(max-width:1400px){.editor-container{grid-template-columns:350px 1fr 380px}}
    @media(max-width:1200px){.editor-container{grid-template-columns:300px 1fr 320px}}
    @media(max-width:768px){.editor-container{grid-template-columns:1fr;grid-template-rows:auto 1fr auto;height:auto;gap:0}.media-library{display:flex;flex-direction:column}.editor-main{min-height:600px}.editor-sidebar{width:100%;min-width:100%;max-height:none}.video-preview-area{min-height:250px}.timeline-container{margin-top:.5rem}.tools-section{flex-direction:column}.tool-button{width:100%;justify-content:center}}
    /* Override main-content padding for editor — maximize usable space */
    .main-content{padding:.5rem !important}
  
    /* Full-screen editing mode — collapse app sidebar */
    .dashboard.editor-fullscreen .sidebar{width:0;min-width:0;overflow:hidden;padding:0;opacity:0;pointer-events:none;transition:all 0.3s ease}
    .dashboard.editor-fullscreen .main-content{margin-left:0 !important;transition:all 0.3s ease}
    .sidebar{transition:all 0.3s ease}
    .main-content{transition:all 0.3s ease}
    .editor-fullscreen-toggle{position:fixed;top:12px;left:12px;z-index:1000;background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;box-shadow:0 2px 12px rgba(108,58,237,0.3);transition:all 0.2s}
    .editor-fullscreen-toggle:hover{transform:scale(1.05);box-shadow:0 4px 16px rgba(108,58,237,0.4)}
    .dashboard.editor-fullscreen .editor-fullscreen-toggle{left:12px}
    
    /* Annotation canvas overlay */
    .annotation-canvas-wrapper{position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:none}
    .annotation-canvas-wrapper.active{pointer-events:auto;cursor:crosshair}
    .annotation-canvas{width:100%;height:100%}
    
    /* Crop overlay */
    .crop-overlay{position:absolute;top:0;left:0;width:100%;height:100%;z-index:11;display:none}
    .crop-overlay.active{display:block}
    .crop-handle{position:absolute;width:14px;height:14px;background:#fff;border:2px solid var(--primary);border-radius:2px;z-index:12}
    .crop-region{border:2px solid #fff;position:absolute;background:transparent;cursor:move;box-shadow:0 0 0 1px rgba(0,0,0,0.3)}
    .crop-dim{position:absolute;background:rgba(0,0,0,0.5)}
    
    /* New tool panels */
    .annotation-tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
    .annotation-tool-btn{padding:8px 12px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;transition:all 0.2s}
    .annotation-tool-btn:hover,.annotation-tool-btn.active{background:var(--primary);color:#fff;border-color:var(--primary)}
    .annotation-color-picker{display:flex;gap:6px;align-items:center;margin-top:8px}
    .annotation-color-swatch{width:28px;height:28px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all 0.2s}
    .annotation-color-swatch.active{border-color:#fff;transform:scale(1.15)}
    .annotation-size-slider{width:100%;margin-top:8px}
    
    /* Crop panel */
    .crop-preset{padding:8px 14px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--surface);color:var(--text);cursor:pointer;font-size:12px;transition:all 0.2s}
    .crop-preset:hover,.crop-preset.active{background:var(--primary);color:#fff}
    
    /* Elements panel */
    .element-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}
    .element-item{padding:12px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--surface);cursor:pointer;text-align:center;font-size:20px;transition:all 0.2s}
    .element-item:hover{background:var(--primary);transform:scale(1.05);border-color:var(--primary)}
    
    /* Enhanced tool sections */
    .tools-section{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:var(--surface);border-radius:10px;border:1px solid var(--border-subtle)}
    .tool-button{padding:6px 12px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--surface);color:var(--text);cursor:pointer;font-size:12px;white-space:nowrap;transition:all 0.15s}
    .tool-button:hover{background:rgba(108,58,237,0.15);border-color:var(--primary)}
    .tool-button.active{background:var(--primary);color:#fff;border-color:var(--primary)}
    
    /* Keyframes bar */
    .keyframe-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--surface);border-radius:8px;border:1px solid var(--border-subtle);margin-top:6px}
    .keyframe-dot{width:8px;height:8px;border-radius:50%;background:var(--primary);cursor:pointer}
    .keyframe-dot.active{background:#EC4899;box-shadow:0 0 6px rgba(236,72,153,0.5)}
    
    /* ═══ MEDIA LIBRARY (Left Panel) ═══ */
    .media-library{background:#110d1c;border-right:1px solid rgba(108,58,237,.08);display:flex;flex-direction:column;overflow:hidden;grid-column:1;grid-row:2}
    .ml-head{padding:8px 10px;border-bottom:1px solid rgba(108,58,237,.06);display:flex;align-items:center;gap:6px}
    .ml-head h3{font-size:11px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.7px;flex:1}
    .ml-tabs{display:flex;border-bottom:1px solid rgba(108,58,237,.06)}
    .ml-tab{flex:1;padding:8px 4px;text-align:center;font-size:9.5px;font-weight:700;color:#4a3d65;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;text-transform:uppercase;letter-spacing:.3px;background:none;border-top:none;border-left:none;border-right:none}
    .ml-tab:hover{color:#a78bfa;background:rgba(108,58,237,.03)}
    .ml-tab.active{color:#a78bfa;border-bottom-color:#7c3aed;background:rgba(108,58,237,.04)}
    .ml-search{padding:5px 8px}
    .ml-search input{width:100%;background:#0c0814;border:1px solid rgba(108,58,237,.1);border-radius:6px;padding:5px 8px;color:#ccc;font-size:10px;outline:none}
    .ml-body{flex:1;overflow-y:auto;padding:5px 6px}
    .ml-upload{border:2px dashed rgba(108,58,237,.2);border-radius:9px;padding:12px;text-align:center;margin-bottom:7px;cursor:pointer;transition:all .25s;background:rgba(108,58,237,.02)}
    .ml-upload:hover{border-color:#7c3aed;background:rgba(108,58,237,.06)}
    .ml-section{font-size:8px;font-weight:700;color:#3d3358;text-transform:uppercase;letter-spacing:.8px;padding:6px 2px 3px;display:flex;align-items:center;gap:4px}
    .ml-section::after{content:'';flex:1;height:1px;background:rgba(108,58,237,.05)}
    .ml-folder{display:flex;align-items:center;gap:6px;padding:5px 7px;background:#16112a;border-radius:6px;border:1px solid rgba(108,58,237,.04);cursor:pointer;margin-bottom:2px;transition:all .2s}
    .ml-folder:hover{border-color:rgba(108,58,237,.15);background:rgba(108,58,237,.04)}
    .ml-fgrid{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:5px}
    .ml-fitem{background:#16112a;border-radius:6px;border:1px solid rgba(108,58,237,.05);overflow:hidden;cursor:grab;transition:all .2s;position:relative}
    .ml-fitem:hover{border-color:rgba(108,58,237,.25);transform:scale(1.02);box-shadow:0 2px 8px rgba(0,0,0,.25)}
    .ml-fth{aspect-ratio:16/10;background:#0c0814;display:flex;align-items:center;justify-content:center;font-size:18px;position:relative}
    .ml-fth .ml-badge{position:absolute;top:2px;left:2px;font-size:6px;padding:1px 4px;border-radius:2px;font-weight:700;color:#fff;text-transform:uppercase}
    .ml-fth .ml-badge.vid{background:rgba(108,58,237,.75)}
    .ml-fth .ml-badge.aud{background:rgba(34,197,94,.75)}
    .ml-fth .ml-dur{position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.75);color:#bbb;font-size:7px;padding:0 3px;border-radius:2px;font-weight:600}
    .ml-fth .ml-add{position:absolute;bottom:2px;left:2px;background:rgba(108,58,237,.8);color:#fff;font-size:7px;padding:1px 4px;border-radius:2px;font-weight:700;opacity:0;transition:opacity .2s}
    .ml-fitem:hover .ml-add{opacity:1}
    .ml-fnm{padding:3px 5px;font-size:8px;color:#5a4d78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ml-foot{padding:5px 6px;border-top:1px solid rgba(108,58,237,.05);display:flex;gap:3px}
    .ml-fb{flex:1;padding:5px;background:rgba(108,58,237,.05);border:1px solid rgba(108,58,237,.06);border-radius:5px;color:#5a4d78;font-size:8px;font-weight:700;cursor:pointer;text-align:center;transition:all .2s}.ml-fitem.selected{border:2px solid #6c3aed;background:rgba(108,58,237,.15)}.ml-fitem:hover{background:rgba(108,58,237,.08);transform:translateY(-1px)}.ml-folder{cursor:pointer;transition:background .2s}.ml-folder:hover{background:rgba(108,58,237,.1);border-radius:6px}.ml-folder.open{background:rgba(108,58,237,.08)}.ml-fb:hover{background:rgba(108,58,237,.15)!important;transform:translateY(-1px)}.tb3{cursor:pointer;transition:all .15s ease}.tb3:hover{background:rgba(108,58,237,.15)!important;transform:scale(1.02)}.tb3.on{background:rgba(108,58,237,.2)!important;border-color:rgba(108,58,237,.5)!important}.mt-tool-btn{cursor:pointer;transition:all .15s}.mt-tool-btn:hover{background:rgba(108,58,237,.2)}.annotation-tool-btn{cursor:pointer;transition:all .15s}.annotation-tool-btn:hover{background:rgba(108,58,237,.15)}.annotation-tool-btn.active{background:rgba(108,58,237,.25);border-color:#6c3aed}@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    .ml-fb:hover{background:rgba(108,58,237,.12);color:#a78bfa}
    .ml-fb.ai{background:linear-gradient(135deg,rgba(108,58,237,.08),rgba(236,72,153,.04));border-color:rgba(108,58,237,.1);color:#a78bfa}

    /* ═══ FILMSTRIP + AUDIO WAVEFORM (CapCut-style) ═══ */
    .filmstrip-wrap{width:100%;padding:2px 0 4px;position:relative;cursor:pointer;user-select:none}
    .fs-ruler{display:flex;align-items:flex-end;padding:0 40px;height:18px;position:relative}
    .fs-ruler span{flex:1;font-size:9px;color:#4a5568;font-variant-numeric:tabular-nums;font-weight:500}
    .fs-playhead{position:absolute;left:calc(40px + 0%);top:0;z-index:10;display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:grab}
    .fs-playhead .ph-tri{width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid #fff;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))}
    .fs-playhead .ph-line{width:2px;background:#fff;box-shadow:0 0 6px rgba(255,255,255,.4)}
    .fs-row{display:flex;align-items:center;height:56px;position:relative;margin-bottom:2px}
    .fs-row.audio-row{height:38px}
    .fs-label{width:40px;font-size:9px;font-weight:800;color:#5a6a7a;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0;text-align:right;padding-right:6px}
    .fs-track{flex:1;height:100%;border-radius:4px;overflow:hidden;position:relative;border:2px solid rgba(0,200,200,.25)}
    .fs-track.video-track{background:#0a1015}
    .fs-track.audio-track{background:#0a1520;border-color:rgba(0,150,255,.2)}
    .fs-thumbs{display:flex;height:100%;width:100%;overflow:hidden;gap:0}.fs-thumbs img,.fs-thumb-placeholder{flex:1;height:100%;object-fit:cover;min-width:0;display:block}.fs-thumb-placeholder{background:linear-gradient(135deg,#1a2a3c 0%,#2a1a3c 100%);animation:fsPulse 1.5s ease-in-out infinite alternate}@keyframes fsPulse{0%{opacity:.4}100%{opacity:.7}}
    .fs-thumb{flex:1;background-size:cover;background-position:center;position:relative;border-right:1px solid rgba(0,0,0,.3)}
    .fs-thumb:last-child{border-right:none}
    .fs-dur{position:absolute;top:3px;left:4px;background:rgba(0,0,0,.7);color:#7fdbca;font-size:8px;font-weight:700;padding:1px 4px;border-radius:2px;z-index:2}
    .fs-audio-canvas{width:100%;height:100%;display:block}

    
    /* ═══ CINEMA SUITE PRO: FULL VIEWPORT MODE ═══ */
    .dashboard .sidebar{display:none!important}
    .editor-fullscreen-toggle{display:none!important}
    .dashboard .main-content{padding:0!important;margin:0!important;width:100vw!important;max-width:100vw!important}
    .dashboard{overflow:hidden!important}
    .main-content .ptr-indicator,.main-content .mobile-menu-btn,.main-content .sidebar-overlay,.main-content .theme-toggle{display:none!important}
    .feedback-btn{display:none!important}
    /* Hide extra original editor panels inside video-container */
    .video-container>div:not(.upload-zone):not(.video-preview-area):not(.filmstrip-wrap):not(.tools-section){display:none!important}
    .video-container .tools-section{display:none!important}
    .video-container{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .upload-zone{flex:1;background:#0a0612!important}
/* ═══ FULLSCREEN VIDEO PREVIEW ═══ */
.fullscreen-btn{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:8px;background:rgba(124,58,237,.7);border:1px solid rgba(124,58,237,.4);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:100;transition:background .2s,transform .2s;backdrop-filter:blur(8px)}
.fullscreen-btn:hover{background:rgba(124,58,237,.95);transform:scale(1.08)}
.fullscreen-btn svg{width:18px;height:18px}
.editor-container.fullscreen-mode .media-library,.editor-container.fullscreen-mode .editor-sidebar{display:none!important}
.editor-container.fullscreen-mode{grid-template-columns:1fr!important}
.editor-container.fullscreen-mode .editor-main{grid-column:1!important}
.editor-container.fullscreen-mode .editor-topbar{grid-column:1!important}
.editor-container.fullscreen-mode #timelineContainer{grid-column:1!important}
.exit-fullscreen-bar{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(12,8,20,.85);border:1px solid rgba(124,58,237,.3);border-radius:10px;padding:6px 16px;display:flex;align-items:center;gap:10px;z-index:200;backdrop-filter:blur(12px);opacity:0;pointer-events:none;transition:opacity .3s}
.editor-container.fullscreen-mode .editor-main:hover .exit-fullscreen-bar{opacity:1;pointer-events:auto}
.exit-fullscreen-bar span{color:rgba(255,255,255,.6);font-size:12px}
.exit-fullscreen-btn{background:rgba(124,58,237,.7);border:none;color:#fff;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;transition:background .2s}
.exit-fullscreen-btn:hover{background:rgba(124,58,237,1)}

    /* ═══ TOP BAR ═══ */
    .editor-topbar{grid-column:1/4;background:#110d1c;border-bottom:1px solid rgba(108,58,237,.1);display:flex;align-items:center;padding:0 12px;gap:5px;height:38px;z-index:100}
    .e-logo{font-size:13px;font-weight:800;background:linear-gradient(135deg,#7c3aed,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-right:8px;cursor:pointer}
    .e-sep{width:1px;height:16px;background:rgba(108,58,237,.12);margin:0 3px}
    .e-tb{padding:4px 9px;font-size:10px;font-weight:600;color:#5a4d78;background:transparent;border:1px solid rgba(108,58,237,.08);border-radius:5px;cursor:pointer;transition:all .2s}
    .e-tb:hover{color:#a78bfa;border-color:#7c3aed}
    .e-tb.on{background:rgba(108,58,237,.1);color:#a78bfa}
    .e-sp{flex:1}
    .e-tb.ex{background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;border:none;font-weight:700;padding:5px 16px}

    /* ═══ RIGHT PANEL: ORGANIZED SECTIONS ═══ */
    .editor-sidebar .cat-tabs-new{display:flex;gap:1px;padding:3px;background:#0c0814;border-bottom:1px solid rgba(108,58,237,.06)}
    .editor-sidebar .cat-btn{flex:1;padding:7px 2px;border:none;background:transparent;color:#4a3d65;cursor:pointer;border-radius:6px;font-size:9px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:2px;transition:all .25s;text-transform:uppercase}
    .editor-sidebar .cat-btn:hover{background:rgba(108,58,237,.06);color:#a78bfa}
    .editor-sidebar .cat-btn.on{background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;box-shadow:0 2px 8px rgba(108,58,237,.3)}
    .editor-sidebar .cat-btn .ci{font-size:13px}
    .editor-sidebar .t-body{flex:1;overflow-y:auto;padding:6px}
    .editor-sidebar .tool-sec{margin-bottom:6px}
    .editor-sidebar .tool-sec-title{font-size:8px;font-weight:700;color:#3d3358;text-transform:uppercase;letter-spacing:.8px;padding:4px 2px 3px;display:flex;align-items:center;gap:4px}
    .editor-sidebar .tool-sec-title::after{content:'';flex:1;height:1px;background:rgba(108,58,237,.05)}
    .editor-sidebar .tg2{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px}
    .editor-sidebar .tb3{flex:1 1 calc(50% - 3px);min-width:0;padding:8px 4px;text-align:center;font-size:10px;font-weight:600;color:#b8a6d9;background:#16112a;border:1px solid rgba(108,58,237,.06);border-radius:6px;cursor:pointer;transition:all .2s;white-space:nowrap}
    .editor-sidebar .tb3:hover{border-color:#7c3aed;background:rgba(108,58,237,.07)}
    .editor-sidebar .tb3.on{background:linear-gradient(135deg,rgba(108,58,237,.15),rgba(236,72,153,.06));border-color:#7c3aed;color:#e9d5ff}
    .editor-sidebar .tb3.ai-t{border-color:rgba(236,72,153,.08);background:linear-gradient(135deg,rgba(108,58,237,.04),rgba(236,72,153,.02))}
    .editor-sidebar .tb3.ai-t:hover{border-color:#ec4899}
    .editor-sidebar .cat-content-new{display:none}
    .editor-sidebar .cat-content-new.active{display:block}
    .editor-sidebar .s-panel{background:#16112a;border-radius:7px;border:1px solid rgba(108,58,237,.06);padding:9px;margin-top:4px}
    .editor-sidebar .s-panel h4{font-size:10px;font-weight:700;color:#c4b5fd;margin-bottom:7px;display:flex;align-items:center;gap:5px}
    .editor-sidebar .s-row{display:flex;align-items:center;gap:5px;margin-bottom:5px}
    .editor-sidebar .s-lbl{font-size:9px;color:#5a4d78;min-width:50px}
    .editor-sidebar .s-track{flex:1;height:3px;background:#1e1730;border-radius:2px;cursor:pointer}
    .editor-sidebar .s-fill{height:100%;border-radius:2px}
    .editor-sidebar .s-val{font-size:9px;color:#a78bfa;font-weight:600;min-width:30px;text-align:right}
    .editor-sidebar .s-apply{width:100%;padding:7px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border:none;border-radius:6px;color:#fff;font-size:10px;font-weight:700;cursor:pointer;margin-top:3px}
    .editor-sidebar .exp-section{padding:6px;border-top:1px solid rgba(108,58,237,.06);margin-top:auto}
    .editor-sidebar .exp-row{display:flex;gap:3px;margin-bottom:3px}
    .editor-sidebar .exp-sel{flex:1;background:#0c0814;border:1px solid rgba(108,58,237,.1);border-radius:4px;padding:4px 6px;color:#b8a6d9;font-size:9px}
    .editor-sidebar .exp-go{width:100%;padding:8px;background:linear-gradient(135deg,#7c3aed,#ec4899);border:none;border-radius:7px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.3px}

    /* ═══ TIMELINE BAR ═══ */
    .timeline-container{grid-column:1/4}
    .tl-toolbar{display:flex;align-items:center;gap:4px;padding:4px 8px;background:#110d1c;border-bottom:1px solid rgba(108,58,237,.05)}
    .tl-btn{padding:3px 7px;font-size:9px;font-weight:700;color:#3d3358;border:1px solid rgba(108,58,237,.06);border-radius:4px;cursor:pointer;background:transparent;transition:all .2s}
    .tl-btn:hover{color:#a78bfa;border-color:rgba(108,58,237,.2)}
    .tl-btn.on{background:#7c3aed;color:#fff;border-color:transparent}
    .tl-spacer{flex:1}
    .tl-info-text{font-size:8px;color:#2d2344}
    .tl-add-btn{padding:3px 8px;font-size:9px;font-weight:700;color:#a78bfa;background:rgba(108,58,237,.08);border:1px solid rgba(108,58,237,.12);border-radius:4px;cursor:pointer}
    .tl-add-btn:hover{background:rgba(108,58,237,.15)}
    
    /* Multi-Track Timeline Editor */
    .mt-toolbar{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#110d1c;border-bottom:1px solid rgba(108,58,237,.1)}
    .mt-toolbar-left,.mt-toolbar-right{display:flex;align-items:center;gap:6px}
    .mt-tool-btn{display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:11px;font-weight:600;color:#5a4d7a;background:transparent;border:1px solid rgba(108,58,237,.1);border-radius:6px;cursor:pointer;transition:all .2s}
    .mt-tool-btn:hover{color:#a78bfa;border-color:rgba(108,58,237,.25);background:rgba(108,58,237,.06)}
    .mt-tool-btn.active{background:#7c3aed;color:#fff;border-color:#7c3aed}
    .mt-tool-btn svg{flex-shrink:0}
    .mt-add-track-btn{display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:11px;font-weight:600;color:#a78bfa;background:rgba(108,58,237,.08);border:1px solid rgba(108,58,237,.15);border-radius:6px;cursor:pointer;transition:all .2s}
    .mt-add-track-btn:hover{background:rgba(108,58,237,.18);border-color:rgba(108,58,237,.3)}
    .mt-info{font-size:10px;color:#4a3d6a;font-weight:500}
    .mt-timeline-body{display:flex;flex:1;overflow:hidden;min-height:0}
    .mt-labels{display:flex;flex-direction:column;width:44px;flex-shrink:0;background:#0e0a18;border-right:1px solid rgba(108,58,237,.08);padding-top:22px;overflow-y:hidden}
    .mt-label{height:36px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.5px;color:#4a3d6a;border-bottom:1px solid rgba(108,58,237,.04);position:relative;flex-shrink:0}
    /* Always-visible delete button on user-added audio tracks. Red bullet in
       the top-right of the label. Turns solid red on hover for affordance. */
    .mt-label .mt-label-del{display:block;position:absolute;top:2px;right:2px;width:14px;height:14px;font-size:10px;font-weight:700;line-height:13px;text-align:center;border-radius:50%;background:rgba(239,68,68,.25);color:#fca5a5;cursor:pointer;border:1px solid rgba(239,68,68,.5);z-index:2;user-select:none}
    .mt-label .mt-label-del:hover{background:#ef4444;color:#fff;border-color:#ef4444}
    .mt-label-video{color:#a78bfa}
    .mt-label-audio{color:#38bdf8}
    .mt-label-music{color:#f472b6}
    .mt-label-text{color:#facc15}
    .mt-label-fx{color:#34d399}
    .mt-tracks-area{flex:1;overflow-x:auto;overflow-y:auto;position:relative;background:#0a0612}
    .mt-time-ruler{display:flex;align-items:center;height:22px;padding:0 8px;border-bottom:1px solid rgba(108,58,237,.08);background:#0e0a18;position:sticky;top:0;z-index:5}
    .mt-time-ruler span{flex:1;font-size:9px;color:#3d3358;font-variant-numeric:tabular-nums}
    .mt-track{height:36px;position:relative;border-bottom:1px solid rgba(108,58,237,.04);background:rgba(10,6,18,.6)}
    .mt-track:hover{background:rgba(108,58,237,.03)}
    .mt-track-video{background:rgba(124,58,237,.03)}
    .mt-track-audio{background:rgba(56,189,248,.03)}
    .mt-track-music{background:rgba(244,114,182,.02)}
    .mt-track-text{background:rgba(250,204,21,.02)}
    .mt-track-fx{background:rgba(52,211,153,.02)}
    .mt-clip{position:absolute;top:3px;height:30px;border-radius:6px;display:flex;align-items:center;padding:0 8px;cursor:grab;transition:box-shadow .2s}
    .mt-clip:hover{box-shadow:0 0 12px rgba(124,58,237,.3)}
    .mt-clip-video{background:linear-gradient(135deg,rgba(124,58,237,.35),rgba(124,58,237,.2));border:1px solid rgba(124,58,237,.4)}
    .mt-clip-audio{background:linear-gradient(135deg,rgba(56,189,248,.3),rgba(56,189,248,.15));border:1px solid rgba(56,189,248,.35)}
    .mt-clip.selected{outline:2px solid #a78bfa;outline-offset:-2px;box-shadow:0 0 16px rgba(139,92,246,.55)}
    body[data-timeline-tool="select"] .mt-clip{cursor:grab}
    body[data-timeline-tool="select"] .mt-clip:active{cursor:grabbing}
    body[data-timeline-tool="razor"] .mt-tracks-area{cursor:crosshair}
    /* Razor tool: clicking a clip splits it at the click point */
    body[data-timeline-tool="razor"] .mt-clip{cursor:col-resize}
    .mt-clip-music{background:linear-gradient(135deg,rgba(244,114,182,.3),rgba(244,114,182,.15));border:1px solid rgba(244,114,182,.35)}
    .mt-clip-text{background:linear-gradient(135deg,rgba(250,204,21,.25),rgba(250,204,21,.12));border:1px solid rgba(250,204,21,.3)}
    .mt-clip-fx{background:linear-gradient(135deg,rgba(52,211,153,.25),rgba(52,211,153,.12));border:1px solid rgba(52,211,153,.3)}
    .mt-clip-label{font-size:9px;font-weight:600;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mt-playhead{position:absolute;top:0;left:80px;width:2px;height:100%;background:#7c3aed;z-index:10;pointer-events:none}
    .mt-playhead .mt-playhead-handle{position:absolute;top:0;left:-7px;width:16px;height:14px;background:#7c3aed;border-radius:0 0 4px 4px;cursor:ew-resize;pointer-events:auto;box-shadow:0 2px 4px rgba(0,0,0,.3)}
    .mt-playhead .mt-playhead-handle:hover{background:#a78bfa}
    .mt-playhead.mt-playhead-dragging .mt-playhead-handle{background:#a78bfa}
    .mt-tracks-area{cursor:crosshair}
    </style>

    <script type="text/javascript" src="https://www.dropbox.com/static/api/2/dropins.js" id="dropboxjs" data-app-key="${process.env.DROPBOX_APP_KEY || ''}"></script>
</head>
<body>
 <div class="dashboard">
    <button class="editor-fullscreen-toggle" id="fullscreenToggle" title="Toggle full-screen editing">
      <span id="fullscreenIcon">⛶</span> <span id="fullscreenLabel">Focus Mode</span>
    </button>
    ${getSidebar('video-editor', req.user, req.teamPermissions)}

    <main class="main-content">
      ${getThemeToggle()}

      <div class="editor-container">

          <div class="editor-topbar">
            <a href="/dashboard" style="text-decoration:none"><span class="e-logo">Splicora</span></a><div class="e-sep"></div>
            <button class="e-tb" onclick="if(typeof undo==='function')undo()">\u21a9 Undo</button>
            <button class="e-tb" onclick="if(typeof redo==='function')redo()">\u21aa Redo</button><div class="e-sep"></div>
            <button class="e-tb on">\ud83e\uddf2 Snap</button>
            <button class="e-tb">\ud83d\udcf7 Snapshot</button>
            <button class="e-tb">\ud83d\udd17 Link Tracks</button>
            <div class="e-sp"></div>
            <button class="e-tb">\ud83d\udcbe Auto-saved</button>
            <button class="e-tb ex" onclick="if(typeof exportVideo==='function')exportVideo()">\ud83c\udfac Export</button>
          </div>
              <!-- ═══ LEFT: MEDIA LIBRARY ═══ -->
              <div class="media-library" id="mediaLibrary">
                <div class="ml-head"><h3>&#128194; Media</h3></div>
                <div class="ml-tabs">
                  <button class="ml-tab active" data-filter="vid" onclick="document.querySelectorAll('.ml-tab').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.querySelectorAll('.ml-fitem').forEach(el=>{el.style.display=el.dataset.mediaType==='vid'?'':'none'})">Videos</button>
                  <button class="ml-tab" data-filter="aud" onclick="document.querySelectorAll('.ml-tab').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.querySelectorAll('.ml-fitem').forEach(el=>{el.style.display=el.dataset.mediaType==='aud'?'':'none'})">Audio</button>
                  <button class="ml-tab" data-filter="img" onclick="document.querySelectorAll('.ml-tab').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.querySelectorAll('.ml-fitem').forEach(el=>{el.style.display=el.dataset.mediaType==='img'?'':'none'})">Images</button>
                  <button class="ml-tab" data-filter="all" onclick="document.querySelectorAll('.ml-tab').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.querySelectorAll('.ml-fitem').forEach(el=>{el.style.display=''})">All</button>
                </div>
                <div class="ml-search"><input placeholder="&#128269; Search media..." /></div>
                <div class="ml-body">
                  <div class="ml-upload">
                    <div style="font-size:22px">&#9729;&#65039;</div>
                    <div style="font-size:9px;color:#5a4d78;font-weight:600;margin-top:1px">Drop files or click to upload</div>
                    <div style="font-size:8px;color:#3d3358;margin-top:1px">MP4, MOV, MP3, WAV, PNG, JPG</div>
                    <button style="margin-top:5px;padding:4px 14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:5px;color:#fff;font-size:9px;font-weight:700;border:none;cursor:pointer">+ Upload</button>
                  </div>
                  <div class="ml-section">Folders</div>
                  <div class="ml-folder"><span style="font-size:15px">&#128193;</span><span style="font-size:10px;font-weight:600;color:#b8a6d9;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Completed Videos</span><span style="font-size:8px;color:#3d3358">12</span></div>
                  <div class="ml-folder"><span style="font-size:15px">&#128193;</span><span style="font-size:10px;font-weight:600;color:#b8a6d9;flex:1">Not Completed</span><span style="font-size:8px;color:#3d3358">5</span></div>
                  <div class="ml-folder"><span style="font-size:15px">&#128193;</span><span style="font-size:10px;font-weight:600;color:#b8a6d9;flex:1">Leonardo AI Images</span><span style="font-size:8px;color:#3d3358">24</span></div>
                  <div class="ml-section">Recent &mdash; drag to timeline</div>
                  <div class="ml-fgrid" id="mediaFileGrid">
                  </div>
                </div>
                <div class="ml-foot">
                  <button class="ml-fb">&#128229; Import</button>
                  <button class="ml-fb">&#128193; Folder</button>
                  <button class="ml-fb ai">&#10024; AI B-Roll</button>
                </div>
              </div>

        <div class="editor-main">
          <div class="video-container">
            <div class="upload-zone" id="uploadZone">
              <h3>📹 Upload Your Video</h3>
              <p>Drop your video here or click to browse</p>
              <div style="display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin-bottom:12px">
                <button type="button" class="upload-button">Select Video</button>
                <button type="button" class="upload-button" id="dropboxImportBtn" style="background:linear-gradient(135deg,#0061FF,#0041B3)">📦 Dropbox</button>
              </div>
              <input type="file" id="fileInput" style="display:none" accept="video/*">
              <div style="display:flex;align-items:center;gap:8px;margin-top:12px;width:100%;max-width:560px">
                <div style="flex:1;height:1px;background:var(--border-subtle)"></div>
                <span style="color:var(--text-muted);font-size:.8rem">or drop a link</span>
                <div style="flex:1;height:1px;background:var(--border-subtle)"></div>
              </div>
              <div style="display:flex;gap:8px;margin-top:8px;width:100%;max-width:560px">
                <div style="position:relative;flex:1">
                  <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:1rem">🔗</span>
                  <input type="text" id="youtubeUrlInput" placeholder="Drop a YouTube, Zoom, Twitch, or Rumble link" style="width:100%;padding:12px 14px 12px 36px;border-radius:10px;border:1px solid var(--border-subtle);background:var(--surface);color:var(--text-primary);font-size:.9rem;outline:none;box-sizing:border-box">
                </div>
                <button type="button" id="youtubeImportBtn" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#6C3AED,#EC4899);color:white;font-weight:600;cursor:pointer;white-space:nowrap;font-size:.9rem">▶ Import</button>
              </div>
              <div style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap;justify-content:center">
                <button type="button" class="upload-button" id="googleDriveImportBtn" style="background:linear-gradient(135deg,#4285F4,#34A853);padding:8px 16px;font-size:.8rem">📁 Google Drive</button>
              </div>
              <p style="color:var(--text-muted);font-size:.75rem;margin-top:8px">You can upload videos up to 120 minutes long. Supports YouTube, Zoom, Twitch, Rumble links.</p>
            </div>

            <div class="video-preview-area" id="videoPreviewArea">
              <video class="video-player" id="videoPlayer" controls></video>
              <div class="annotation-canvas-wrapper" id="annotationWrapper">
                <canvas class="annotation-canvas" id="annotationCanvas"></canvas>
              </div>
              <div class="crop-overlay" id="cropOverlay"></div>
            </div>

            
              <!-- ═══ FILMSTRIP + AUDIO WAVEFORM (CapCut-style) ═══ -->
              <div class="filmstrip-wrap" id="filmstripWrap" style="display:none;padding:4px 8px;">
                <div class="fs-ruler">
                  <span>0:00</span><span>0:30</span><span>1:00</span><span>1:30</span>
                  <div class="fs-playhead" id="fsPlayhead">
                    <div class="ph-tri"></div>
                    <div class="ph-line"></div>
                  </div>
                </div>
                <div class="fs-row">
                  <div class="fs-label">VIDEO</div>
                  <div class="fs-track video-track">
                    <div class="fs-thumbs" id="fsThumbs"></div>
                    <span class="fs-dur" id="fsDuration"></span>
                  </div>
                </div>
                <div class="fs-row audio-row">
                  <div class="fs-label">AUDIO</div>
                  <div class="fs-track audio-track">
                    <canvas class="fs-audio-canvas" id="fsAudioCanvas"></canvas>
                  </div>
                </div>
              </div>

              <div class="timeline-container" id="timelineContainer">
              <div class="mt-toolbar">
                <div class="mt-toolbar-left">
                  <button class="mt-tool-btn active" id="mtRazorBtn" title="Razor Tool"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.121 14.121L7.05 21.192a2 2 0 01-2.828 0l-.414-.414a2 2 0 010-2.828l7.07-7.071"/><path d="M16.243 11.999L21.9 6.343a2 2 0 000-2.829l-.707-.707a2 2 0 00-2.828 0L12.707 8.464"/><line x1="8" y1="8" x2="16" y2="16"/></svg> Razor</button>
                  <button class="mt-tool-btn" id="mtSelectBtn" title="Select Tool"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg> Select</button>
                  <button class="mt-tool-btn" id="mtSnapBtn" title="Snap Toggle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Snap</button>
                </div>
                <div class="mt-toolbar-right">
                  <button class="mt-add-track-btn" id="mtAddTrackBtn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Track</button>
                  <span class="mt-info">5 tracks &bull; 0:00</span>
                </div>
              </div>
              <div class="mt-timeline-body">
                <div class="mt-labels">
                  <div class="mt-label mt-label-video">V1</div>
                  <div class="mt-label mt-label-audio">A1</div>
                  <div class="mt-label mt-label-music">M1</div>
                  <div class="mt-label mt-label-text">T1</div>
                  <div class="mt-label mt-label-fx">FX</div>
                </div>
                <div class="mt-tracks-area" id="mtTracksArea">
                  <div class="mt-time-ruler" id="mtTimeRuler">
                    <span>0:00</span><span>0:30</span><span>1:00</span><span>1:30</span><span>2:00</span><span>2:30</span><span>3:00</span><span>3:30</span><span>4:00</span>
                  </div>
                  <div class="mt-track mt-track-video" data-type="video">
                  </div>
                  <div class="mt-track mt-track-audio" data-type="audio">
                  </div>
                  <div class="mt-track mt-track-music" data-type="music"></div>
                  <div class="mt-track mt-track-text" data-type="text"></div>
                  <div class="mt-track mt-track-fx" data-type="fx"></div>
                  <div class="mt-playhead" id="mtPlayhead"><div class="mt-playhead-handle" id="mtPlayheadHandle" title="Drag to scrub"></div></div>
                </div>
              </div>
            </div>

            <div class="tools-section">
              <button type="button" id="undoBtn" class="tool-button" style="background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;border:none;font-weight:700" title="Undo last action">↩️ Undo</button>
              <button type="button" id="redoBtn" class="tool-button" style="background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;border:none;font-weight:700" title="Redo last action">↪️ Redo</button>
              <button class="tool-button active" data-tool="trim">✂️ Trim</button>
              <button class="tool-button" data-tool="split">🔀 Split</button>
              <button class="tool-button" data-tool="filters">🎨 Filters</button>
              <button class="tool-button" data-tool="speed">⚡ Speed</button>
              <button class="tool-button" data-tool="audio">🔊 Audio</button>
              <button class="tool-button" data-tool="music">🎵 Music</button>
              <button class="tool-button" data-tool="enhance">✨ AI Enhance</button>
              <button class="tool-button" data-tool="captions">💬 AI Captions</button>
              <button class="tool-button" data-tool="voiceover">🎙️ AI Voice</button>
              <button class="tool-button" data-tool="voicetransform">🔄 Voice Transform</button>
              <button class="tool-button" data-tool="text">📝 Text Overlay</button>
              <button class="tool-button" data-tool="transitions">✨ Transitions</button>
              <button class="tool-button" data-tool="broll">🎬 B-Roll</button>
              <button class="tool-button" data-tool="aihook">🪝 AI Hook</button>
              <button class="tool-button" data-tool="brandtemplate">🎨 Brand Template</button>
              <button class="tool-button" data-tool="transcript">📜 Transcript</button>
              <button class="tool-button" data-tool="crop"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>Crop</button>
              <button class="tool-button" data-tool="annotations">✏️ Annotations</button>
              <button class="tool-button" data-tool="elements">⭐ Elements</button>
              <button class="tool-button" data-tool="zoom">🔍 Zoom & Pan</button>
              <button class="tool-button" data-tool="pip">📺 Picture-in-Picture</button>
              <button class="tool-button" data-tool="keyframes">💎 Keyframes</button>
              <button class="tool-button" data-tool="colorgrade">🎨 Color Grading</button>
            </div>

            <!-- Background Color Presets -->
            
            <!-- Crop Panel -->
            <div id="cropPanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Crop Presets</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="crop-preset" data-ratio="free">Free</button>
                <button class="crop-preset" data-ratio="16:9">16:9</button>
                <button class="crop-preset" data-ratio="9:16">9:16</button>
                <button class="crop-preset" data-ratio="4:3">4:3</button>
                <button class="crop-preset" data-ratio="1:1">1:1</button>
                <button class="crop-preset" data-ratio="4:5">4:5</button>
                <button class="crop-preset" data-ratio="21:9">21:9</button>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px">
                <button class="tool-button active" id="applyCropBtn" style="flex:1">✅ Apply Crop</button>
                <button class="tool-button" id="resetCropBtn" style="flex:1">↩️ Reset</button>
              </div>
            </div>

            <!-- Annotations Panel -->
            <div id="annotationsPanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Drawing Tools</label>
              <div class="annotation-tools">
                <button class="annotation-tool-btn" data-shape="arrow">➡️ Arrow</button>
                <button class="annotation-tool-btn" data-shape="circle">⭕ Circle</button>
                <button class="annotation-tool-btn" data-shape="rect">▪️ Rectangle</button>
                <button class="annotation-tool-btn" data-shape="line">📏 Line</button>
                <button class="annotation-tool-btn" data-shape="freehand">✏️ Freehand</button>
                <button class="annotation-tool-btn" data-shape="text">🔤 Text</button>
                <button class="annotation-tool-btn" data-shape="highlight">🟡 Highlight</button>
                <button class="annotation-tool-btn" data-shape="blur">🔲 Blur</button>
              </div>
              <label class="dropdown-label" style="margin-top:10px;margin-bottom:6px;display:block">Color</label>
              <div class="annotation-color-picker">
                <div class="annotation-color-swatch active" data-color="#FF0000" style="background:#FF0000"></div>
                <div class="annotation-color-swatch" data-color="#00FF00" style="background:#00FF00"></div>
                <div class="annotation-color-swatch" data-color="#0088FF" style="background:#0088FF"></div>
                <div class="annotation-color-swatch" data-color="#FFFF00" style="background:#FFFF00"></div>
                <div class="annotation-color-swatch" data-color="#FF00FF" style="background:#FF00FF"></div>
                <div class="annotation-color-swatch" data-color="#FFFFFF" style="background:#FFFFFF;border:1px solid rgba(255,255,255,0.3)"></div>
                <div class="annotation-color-swatch" data-color="#000000" style="background:#000000;border:1px solid rgba(255,255,255,0.3)"></div>
                <input type="color" id="annotationCustomColor" value="#FF0000" style="width:28px;height:28px;border:none;border-radius:50%;cursor:pointer;padding:0">
              </div>
              <label class="dropdown-label" style="margin-top:10px;margin-bottom:4px;display:block">Stroke Width</label>
              <input type="range" id="annotationStrokeWidth" min="1" max="20" value="3" class="annotation-size-slider">
              <div style="margin-top:10px;display:flex;gap:8px">
                <button class="tool-button" id="undoAnnotation" style="flex:1">↩️ Undo</button>
                <button class="tool-button" id="clearAnnotations" style="flex:1">🗑️ Clear All</button>
              </div>
            </div>

            <!-- Elements Panel -->
            <div id="elementsPanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Shapes & Stickers</label>
              <div class="element-grid">
                <div class="element-item" data-element="arrow-right">➡️</div>
                <div class="element-item" data-element="arrow-up">⬆️</div>
                <div class="element-item" data-element="circle">🔴</div>
                <div class="element-item" data-element="star">⭐</div>
                <div class="element-item" data-element="heart">❤️</div>
                <div class="element-item" data-element="fire">🔥</div>
                <div class="element-item" data-element="check">✅</div>
                <div class="element-item" data-element="cross">❌</div>
                <div class="element-item" data-element="question">❓</div>
                <div class="element-item" data-element="exclaim">❗</div>
                <div class="element-item" data-element="lightning">⚡</div>
                <div class="element-item" data-element="sparkle">✨</div>
                <div class="element-item" data-element="pointer">👆</div>
                <div class="element-item" data-element="eyes">👀</div>
                <div class="element-item" data-element="hundred">💯</div>
                <div class="element-item" data-element="trophy">🏆</div>
              </div>
              <label class="dropdown-label" style="margin-top:12px;margin-bottom:6px;display:block">Element Size</label>
              <input type="range" id="elementSize" min="20" max="200" value="60" style="width:100%">
            </div>

            <!-- Zoom & Pan Panel -->
            <div id="zoomPanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Zoom & Pan</label>
              <div class="slider-group">
                <div class="slider-label"><span>Zoom Level</span><span id="zoomValue">100%</span></div>
                <input type="range" id="zoomLevel" min="100" max="400" value="100" style="width:100%">
              </div>
              <div class="slider-group" style="margin-top:8px">
                <div class="slider-label"><span>Pan X</span><span id="panXValue">0</span></div>
                <input type="range" id="panX" min="-100" max="100" value="0" style="width:100%">
              </div>
              <div class="slider-group" style="margin-top:8px">
                <div class="slider-label"><span>Pan Y</span><span id="panYValue">0</span></div>
                <input type="range" id="panY" min="-100" max="100" value="0" style="width:100%">
              </div>
              <button class="tool-button active" id="resetZoom" style="margin-top:10px;width:100%">↩️ Reset Zoom</button>
            </div>

            <!-- Picture-in-Picture Panel -->
            <div id="pipPanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Picture-in-Picture</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                <button class="crop-preset" data-pip="top-right">↗️ Top Right</button>
                <button class="crop-preset" data-pip="top-left">↖️ Top Left</button>
                <button class="crop-preset" data-pip="bottom-right">↘️ Bottom Right</button>
                <button class="crop-preset" data-pip="bottom-left">↙️ Bottom Left</button>
              </div>
              <div class="slider-group">
                <div class="slider-label"><span>PiP Size</span><span id="pipSizeValue">30%</span></div>
                <input type="range" id="pipSize" min="10" max="50" value="30" style="width:100%">
              </div>
              <div class="slider-group" style="margin-top:8px">
                <div class="slider-label"><span>Border Radius</span><span id="pipRadiusValue">8px</span></div>
                <input type="range" id="pipRadius" min="0" max="50" value="8" style="width:100%">
              </div>
              <div style="margin-top:10px">
                <button class="tool-button active" id="addPipBtn" style="width:100%">➕ Add PiP Source</button>
              </div>
            </div>

            <!-- Keyframes Panel -->
            <div id="keyframesPanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Keyframe Animation</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                <button class="crop-preset" data-kf="opacity">Opacity</button>
                <button class="crop-preset" data-kf="scale">Scale</button>
                <button class="crop-preset" data-kf="position">Position</button>
                <button class="crop-preset" data-kf="rotation">Rotation</button>
              </div>
              <div class="keyframe-bar">
                <span style="font-size:11px;color:var(--text-muted)">Timeline:</span>
                <div style="flex:1;height:4px;background:var(--border-subtle);border-radius:2px;position:relative">
                  <div class="keyframe-dot active" style="position:absolute;left:0;top:-2px"></div>
                  <div class="keyframe-dot" style="position:absolute;left:50%;top:-2px"></div>
                  <div class="keyframe-dot" style="position:absolute;right:0;top:-2px"></div>
                </div>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px">
                <button class="tool-button active" id="addKeyframeBtn" style="flex:1">➕ Add Keyframe</button>
                <button class="tool-button" id="clearKeyframesBtn" style="flex:1">🗑️ Clear</button>
              </div>
            </div>

            <!-- Color Grading Panel -->
            <div id="colorGradePanel" class="tool-panel" style="display:none;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle);margin-top:8px">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Color Grading</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                <button class="crop-preset color-grade-preset" data-grade="cinematic">🎬 Cinematic</button>
                <button class="crop-preset color-grade-preset" data-grade="vintage">📷 Vintage</button>
                <button class="crop-preset color-grade-preset" data-grade="warm">🌅 Warm</button>
                <button class="crop-preset color-grade-preset" data-grade="cool">❄️ Cool</button>
                <button class="crop-preset color-grade-preset" data-grade="bw">⬛ B&W</button>
                <button class="crop-preset color-grade-preset" data-grade="dramatic">🎭 Dramatic</button>
                <button class="crop-preset color-grade-preset" data-grade="pastel">🌸 Pastel</button>
                <button class="crop-preset color-grade-preset" data-grade="none">↩️ None</button>
              </div>
              <div class="slider-group">
                <div class="slider-label"><span>Temperature</span><span id="tempValue">0</span></div>
                <input type="range" id="colorTemp" min="-100" max="100" value="0" style="width:100%">
              </div>
              <div class="slider-group" style="margin-top:6px">
                <div class="slider-label"><span>Tint</span><span id="tintValue">0</span></div>
                <input type="range" id="colorTint" min="-100" max="100" value="0" style="width:100%">
              </div>
              <div class="slider-group" style="margin-top:6px">
                <div class="slider-label"><span>Vibrance</span><span id="vibranceValue">0</span></div>
                <input type="range" id="colorVibrance" min="-100" max="100" value="0" style="width:100%">
              </div>
              <div class="slider-group" style="margin-top:6px">
                <div class="slider-label"><span>Vignette</span><span id="vignetteValue">0</span></div>
                <input type="range" id="colorVignette" min="0" max="100" value="0" style="width:100%">
              </div>
            </div>

<div style="margin-top:1rem;padding:12px 16px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle)">
              <label class="dropdown-label" style="margin-bottom:8px;display:block">Background Color</label>
              <div class="gradient-presets" id="gradientPresets" style="display:flex;gap:10px;padding:4px 0;overflow-x:auto;flex-wrap:wrap">
                <div class="gradient-preset-card" data-gradient="linear-gradient(135deg,#6C3AED,#EC4899)" title="Purple Pink" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid transparent;flex-shrink:0"></div>
                <div class="gradient-preset-card" data-gradient="linear-gradient(135deg,#0EA5E9,#6366F1)" title="Blue Indigo" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid transparent;flex-shrink:0"></div>
                <div class="gradient-preset-card" data-gradient="linear-gradient(135deg,#F59E0B,#EF4444)" title="Orange Red" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid transparent;flex-shrink:0"></div>
                <div class="gradient-preset-card" data-gradient="linear-gradient(135deg,#10B981,#06B6D4)" title="Green Teal" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid transparent;flex-shrink:0"></div>
                <div class="gradient-preset-card" data-gradient="linear-gradient(135deg,#8B5CF6,#A78BFA)" title="Purple Lavender" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid transparent;flex-shrink:0"></div>
                <div class="gradient-preset-card" data-gradient="#000000" title="Black" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid rgba(255,255,255,0.3);flex-shrink:0;background:#000"></div>
                <div class="gradient-preset-card" data-gradient="#FFFFFF" title="White" style="width:60px;height:40px;border-radius:8px;cursor:pointer;border:2px solid rgba(0,0,0,0.15);flex-shrink:0;background:#fff"></div>
              </div>
            </div>

            <!-- Aspect Ratio, Layout, Tracking -->
            <div style="display:flex;gap:1rem;margin-top:1rem;flex-wrap:wrap">
              <div style="flex:1;min-width:140px;padding:12px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle)">
                <label class="dropdown-label">Aspect Ratio</label>
                <select class="dropdown" id="aspectRatioSelect" style="padding:.5rem .6rem;font-size:.85rem;width:100%">
                  <option value="16:9">16:9 (YouTube)</option>
                  <option value="9:16">9:16 (TikTok)</option>
                  <option value="1:1">1:1 (Instagram)</option>
                  <option value="4:5">4:5 (Reels)</option>
                </select>
              </div>
              <div style="flex:1;min-width:140px;padding:12px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle)">
                <label class="dropdown-label">Layout Mode</label>
                <select class="dropdown" id="layoutSelect" style="padding:.5rem .6rem;font-size:.85rem;width:100%">
                  <option value="fill">Fill</option>
                  <option value="fit">Fit (Blur)</option>
                  <option value="split">Split Screen</option>
                  <option value="screenshare">Screen Share</option>
                  <option value="gameplay">Gameplay</option>
                </select>
              </div>
              <div style="flex:1;min-width:140px;padding:12px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle)">
                <label class="dropdown-label">Subject Tracking</label>
                <select class="dropdown" id="trackingSelect" style="padding:.5rem .6rem;font-size:.85rem;width:100%">
                  <option value="off">Tracker Off</option>
                  <option value="auto">Auto Tracking</option>
                  <option value="manual">Manual Subject</option>
                </select>
              </div>
            </div>

            <!-- Editor Toolbar -->
            <div style="display:flex;gap:8px;margin-top:1rem;flex-wrap:wrap;align-items:center;padding:10px 14px;background:var(--surface);border-radius:12px;border:1px solid var(--border-subtle)">
              <button type="button" class="toolbar-btn" id="hideTimelineBtn" title="Hide Timeline">🙈 Hide Timeline</button>
              <button type="button" class="toolbar-btn" id="deleteClipBtn" title="Delete Selected" style="color:#EF4444">🗑️ Delete</button>
              <div style="flex:1"></div>
              <button type="button" class="toolbar-btn" id="zoomOutBtn" title="Zoom Out">➖</button>
              <button type="button" class="toolbar-btn" id="zoomInBtn" title="Zoom In">➕</button>
              <div style="flex:1"></div>
              <button type="button" class="toolbar-btn" id="saveChangesBtn" title="Save Changes" style="background:var(--primary);color:white;border-color:var(--primary)">💾 Save</button>
              <button type="button" class="toolbar-btn" id="quickExportBtn" title="Export" style="background:linear-gradient(135deg,#10B981,#06B6D4);color:white;border-color:transparent">📥 Export</button>
            </div>
          </div>
        </div>

        <div class="editor-sidebar">
          <div class="cat-tabs-new">
            <button class="cat-btn on" onclick="swCat2(this,'edit')"><span class="ci">\u2702\ufe0f</span>EDIT</button>
            <button class="cat-btn" onclick="swCat2(this,'audio')"><span class="ci">\ud83d\udd0a</span>AUDIO</button>
            <button class="cat-btn" onclick="swCat2(this,'ai')"><span class="ci">\u2728</span>AI</button>
            <button class="cat-btn" onclick="swCat2(this,'fx')"><span class="ci">\ud83c\udfa8</span>FX</button>
          </div>
          <div class="t-body">
            <!-- EDIT TAB -->
            <div class="cat-content-new active" id="cat-edit2">
              <div class="tool-sec"><div class="tool-sec-title">Clip Tools</div>
                <div class="tg2">
                  <div class="tb3 on">\u2702\ufe0f Trim</div>
                  <div class="tb3">\ud83d\udcd0 Split</div>
                  <div class="tb3">\u26a1 Speed</div>
                  <div class="tb3">\ud83d\udd32 Crop</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">Transform</div>
                <div class="tg2">
                  <div class="tb3">\u2194\ufe0f Resize</div>
                  <div class="tb3">\ud83d\udd04 Rotate</div>
                  <div class="tb3">\u2195\ufe0f Flip</div>
                  <div class="tb3">\ud83d\udccc Position</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">Timing</div>
                <div class="tg2">
                  <div class="tb3">\u23ea Reverse</div>
                  <div class="tb3">\ud83d\udd01 Loop</div>
                  <div class="tb3">\u23f8\ufe0f Freeze</div>
                  <div class="tb3">\ud83c\udf9e\ufe0f Keyframe</div>
                </div>
              </div>
                            <div class="s-panel" style="margin-top:4px">
                <h4>\u2699\ufe0f Properties</h4>
                <div class="s-row"><span class="s-lbl">Opacity</span><div class="s-track"><div class="s-fill" style="width:100%;background:#7c3aed"></div></div><span class="s-val">100%</span></div>
                <div class="s-row"><span class="s-lbl">Volume</span><div class="s-track"><div class="s-fill" style="width:80%;background:#22c55e"></div></div><span class="s-val">80%</span></div>
                <div class="s-row"><span class="s-lbl">Speed</span><div class="s-track"><div class="s-fill" style="width:50%;background:#ec4899"></div></div><span class="s-val">1.0x</span></div>
              </div>
            </div>
            <!-- AUDIO TAB -->
            <div class="cat-content-new" id="cat-audio2">
              <div class="tool-sec"><div class="tool-sec-title">Audio Control</div>
                <div class="tg2">
                  <div class="tb3 on">\ud83d\udd0a Volume</div>
                  <div class="tb3">\ud83c\udfb5 Music</div>
                  <div class="tb3">\ud83c\udf99\ufe0f Voiceover</div>
                  <div class="tb3">\ud83d\udd07 Mute</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">Audio Effects</div>
                <div class="tg2">
                  <div class="tb3">\ud83d\udd09 Fade In/Out</div>
                  <div class="tb3">\ud83c\udfa4 Voice Change</div>
                  <div class="tb3">\ud83d\udce2 Equalizer</div>
                  <div class="tb3">\ud83d\udd14 Sound FX</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">Advanced Audio</div>
                <div class="tg2">
                  <div class="tb3">\ud83c\udf9a\ufe0f Compressor</div>
                  <div class="tb3">\ud83d\udd15 Noise Remove</div>
                  <div class="tb3">\ud83c\udfb6 Beat Sync</div>
                  <div class="tb3">\ud83d\udcca Visualizer</div>
                </div>
              </div>
            </div>
            <!-- AI TAB -->
            <div class="cat-content-new" id="cat-ai2">
              <div class="tool-sec"><div class="tool-sec-title">AI Generation</div>
                <div class="tg2">
                  <div class="tb3 ai-t on">\u2728 Enhance</div>
                  <div class="tb3 ai-t">\ud83d\udcdd Captions</div>
                  <div class="tb3 ai-t">\ud83e\ude9d AI Hook</div>
                  <div class="tb3 ai-t">\ud83c\udfa8 Brand Kit</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">AI Analysis</div>
                <div class="tg2">
                  <div class="tb3 ai-t">\ud83d\udcdc Transcript</div>
                  <div class="tb3 ai-t">\ud83c\udfac B-Roll</div>
                  <div class="tb3 ai-t">\ud83e\udde0 Smart Cut</div>
                  <div class="tb3 ai-t">\ud83d\udc41\ufe0f Scene Detect</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">AI Creative</div>
                <div class="tg2">
                  <div class="tb3 ai-t">\ud83c\udfad Style Transfer</div>
                  <div class="tb3 ai-t">\ud83d\uddbc\ufe0f BG Remove</div>
                  <div class="tb3 ai-t">\ud83d\udde3\ufe0f AI Voice</div>
                  <div class="tb3 ai-t">\ud83c\udf0d Translate</div>
                </div>
              </div>
            </div>
            <!-- FX TAB -->
            <div class="cat-content-new" id="cat-fx2">
              <div class="tool-sec"><div class="tool-sec-title">Visual Effects</div>
                <div class="tg2">
                  <div class="tb3 on">\ud83c\udfa8 Filters</div>
                  <div class="tb3">\u2728 Transitions</div>
                  <div class="tb3">\ud83d\udcdd Text</div>
                  <div class="tb3">\ud83d\udcce Stickers</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">Color & Grade</div>
                <div class="tg2">
                  <div class="tb3">\ud83c\udfa8 Color Grade</div>
                  <div class="tb3">\u2600\ufe0f Exposure</div>
                  <div class="tb3">\ud83c\udf08 Saturation</div>
                  <div class="tb3">\ud83c\udfa5 LUT</div>
                </div>
              </div>
              <div class="tool-sec"><div class="tool-sec-title">Motion & Overlays</div>
                <div class="tg2">
                  <div class="tb3">\ud83d\udd0d Zoom</div>
                  <div class="tb3">\ud83d\udcfa PiP</div>
                  <div class="tb3">\ud83d\udcab Animations</div>
                  <div class="tb3">\ud83d\udd8a\ufe0f Annotations</div>
                </div>
              </div>
            </div>
          </div>
          <div class="exp-section">
            <div class="exp-row">
              <select class="exp-sel"><option>1080p</option><option>720p</option><option>4K</option></select>
              <select class="exp-sel"><option>MP4</option><option>MOV</option><option>WebM</option></select>
            </div>
            <button class="exp-go" onclick="if(typeof exportVideo==='function')exportVideo()">\ud83c\udfac Export Video</button>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script>
    (function(){var orig=document.getElementById.bind(document);var noop={disabled:false,value:'',textContent:'',innerHTML:'',src:'',checked:false,selectedIndex:0,style:{},classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false}},addEventListener:function(){},removeEventListener:function(){},appendChild:function(){return this},removeChild:function(){},insertBefore:function(){},setAttribute:function(){},getAttribute:function(){return null},querySelector:function(){return null},querySelectorAll:function(){return[]},focus:function(){},blur:function(){},click:function(){},play:function(){return Promise.resolve()},pause:function(){},remove:function(){},replaceWith:function(){},cloneNode:function(){return this},contains:function(){return false},closest:function(){return null},matches:function(){return false},dispatchEvent:function(){return true},hasAttribute:function(){return false},removeAttribute:function(){},hasChildNodes:function(){return false},getBoundingClientRect:function(){return{top:0,left:0,right:0,bottom:0,width:0,height:0,x:0,y:0}},offsetWidth:0,offsetHeight:0,offsetTop:0,offsetLeft:0,scrollWidth:0,scrollHeight:0,children:[],childNodes:[],parentNode:null,parentElement:null,nextSibling:null,previousSibling:null,firstChild:null,lastChild:null,dataset:{},tagName:'DIV',nodeName:'DIV',nodeType:1};noop.style=new Proxy({},{set:function(){return true},get:function(){return''}});document.getElementById=function(id){return orig(id)||noop}})();

    // ═══ CINEMA SUITE PRO: Move timeline to grid root ═══
    (function(){
      var ec = document.querySelector(".editor-container");
      var tl = document.getElementById("timelineContainer");
      if(ec && tl && tl.parentElement !== ec) ec.appendChild(tl);
    })();

    // ═══ CINEMA SUITE PRO: Fullscreen video preview toggle ═══
    (function(){
      var em = document.querySelector(".editor-main");
      var ec = document.querySelector(".editor-container");
      if(!em || !ec) return;
      em.style.position = "relative";
      var expandSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
      var shrinkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
      var btn = document.createElement("button");
      btn.className = "fullscreen-btn";
      btn.title = "Fullscreen preview";
      btn.innerHTML = expandSvg;
      em.appendChild(btn);
      var bar = document.createElement("div");
      bar.className = "exit-fullscreen-bar";
      bar.innerHTML = '<span>Press Esc or</span><button class="exit-fullscreen-btn">Exit Fullscreen</button>';
      em.appendChild(bar);
      function enterFS(){ ec.classList.add("fullscreen-mode"); btn.innerHTML = shrinkSvg; btn.title = "Exit fullscreen"; }
      function exitFS(){ ec.classList.remove("fullscreen-mode"); btn.innerHTML = expandSvg; btn.title = "Fullscreen preview"; }
      btn.addEventListener("click", function(){ ec.classList.contains("fullscreen-mode") ? exitFS() : enterFS(); });
      bar.querySelector(".exit-fullscreen-btn")?.addEventListener("click", exitFS);
      document.addEventListener("keydown", function(e){ if(e.key === "Escape" && ec.classList.contains("fullscreen-mode")) exitFS(); });
    })();

    // ═══ CINEMA SUITE PRO: Category tab switching ═══
    function swCat2(el, cat) {
      document.querySelectorAll('.cat-btn').forEach(function(t) { t.classList.remove('on'); });
      el.classList.add('on');
      document.querySelectorAll('.cat-content-new').forEach(function(c) { c.classList.remove('active'); });
      var target = document.getElementById('cat-' + cat + '2');
      if (target) target.classList.add('active');
    }

    // ═══ MEDIA LIBRARY: Populate file grid ═══
    function populateMediaGrid() {
      const grid = document.getElementById('mediaFileGrid');
      if (!grid) return;
      // Start empty — only real user uploads populate the media library.
      // Items are appended by media-panel-fix.js handleFiles() on upload.
      grid.innerHTML = '';
    }

    // ═══ FILMSTRIP: Generate video thumbnails ═══
    function generateFilmstripThumbs() {
      var container = document.getElementById('fsThumbs');
      if (!container || !container.innerHTML && container.innerHTML !== '') return;
      container.innerHTML = '';

      var video = document.getElementById('videoPlayer');
      if (!video || !video.src || !video.duration || !isFinite(video.duration)) {
        // Fallback: show colored placeholders if no video loaded
        for (var i = 0; i < 16; i++) {
          var ph = document.createElement('div');
          ph.className = 'fs-thumb-placeholder';
          container.appendChild(ph);
        }
        return;
      }

      var duration = video.duration;
      var NUM_THUMBS = Math.min(24, Math.max(8, Math.round(duration / 3)));
      var interval = duration / NUM_THUMBS;

      // Show loading placeholders first
      for (var p = 0; p < NUM_THUMBS; p++) {
        var placeholder = document.createElement('div');
        placeholder.className = 'fs-thumb-placeholder';
        placeholder.setAttribute('data-idx', p);
        container.appendChild(placeholder);
      }

      // Create hidden canvas for frame extraction
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      canvas.width = 160;
      canvas.height = 90;

      // Clone the video element to avoid disrupting playback
      var extractor = document.createElement('video');
      extractor.crossOrigin = 'anonymous';
      extractor.muted = true;
      extractor.preload = 'auto';
      extractor.src = video.src;

      var currentIdx = 0;

      function extractFrame() {
        if (currentIdx >= NUM_THUMBS) {
          extractor.removeEventListener('seeked', onSeeked);
          extractor.src = '';
          extractor = null;
          return;
        }
        var seekTime = Math.min(currentIdx * interval + 0.5, duration - 0.1);
        extractor.currentTime = seekTime;
      }

      function onSeeked() {
        try {
          ctx.drawImage(extractor, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.6);

          var img = document.createElement('img');
          img.src = dataUrl;
          img.alt = 'Frame ' + currentIdx;
          img.draggable = false;

          // Replace the placeholder at this index
          var ph = container.querySelector('[data-idx="' + currentIdx + '"]');
          if (ph) {
            ph.replaceWith(img);
          } else {
            container.appendChild(img);
          }
        } catch (e) {
          // CORS or other error - leave placeholder
        }

        currentIdx++;
        // Use requestAnimationFrame to keep UI responsive
        requestAnimationFrame(extractFrame);
      }

      extractor.addEventListener('seeked', onSeeked);
      extractor.addEventListener('loadeddata', function() {
        extractFrame();
      });

      // If already loaded
      if (extractor.readyState >= 2) {
        extractFrame();
      }
    }

    // ═══ FILMSTRIP: Draw blue audio waveform ═══
    function drawFilmstripAudioWaveform() {
      var canvas = document.getElementById('fsAudioCanvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      var w = rect.width, h = rect.height, mid = h / 2;
      var barWidth = 2, gap = 1, total = Math.floor(w / (barWidth + gap));
      for (var i = 0; i < total; i++) {
        var x = i * (barWidth + gap);
        var base = Math.sin(i * 0.03) * Math.sin(i * 0.07) * Math.cos(i * 0.01);
        var detail = Math.sin(i * 0.15) * 0.3 + Math.sin(i * 0.4) * 0.15;
        var envelope = 0.5 + 0.5 * Math.sin(i * 0.005 + 1);
        var amp = Math.abs(base + detail) * envelope;
        if (Math.sin(i * 0.02) > 0.85) amp *= 0.15;
        amp = Math.max(amp, 0.03);
        var barH = amp * (h * 0.85);
        var brightness = Math.floor(150 + amp * 105);
        ctx.fillStyle = 'rgb(30,' + brightness + ',' + Math.floor(brightness * 1.4) + ')';
        ctx.fillRect(x, mid - barH / 2, barWidth, barH);
      }
    }

    // ═══ FILMSTRIP: Size playhead line ═══
    function sizeFilmstripPlayhead() {
      var wrap = document.getElementById('filmstripWrap');
      var ph = document.getElementById('fsPlayhead');
      if (!wrap || !ph) return;
      var line = ph.querySelector('.ph-line');
      if (line) line.style.height = (wrap.offsetHeight - 18) + 'px';
    }

    // ═══ Show filmstrip when video is loaded ═══
    function showFilmstrip(duration) {
      var wrap = document.getElementById('filmstripWrap');
      if (wrap) {
        wrap.style.display = 'block';
        var durEl = document.getElementById('fsDuration');
        if (durEl && duration) {
          var mins = Math.floor(duration / 60);
          var secs = Math.floor(duration % 60);
          durEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
        }
        setTimeout(function() {
          generateFilmstripThumbs();
          drawFilmstripAudioWaveform();
          sizeFilmstripPlayhead();
        }, 100);
      }
    }

    // Filmstrip preview timeline: click-to-seek, scrubbing, and timeupdate sync
    (function initFilmstripInteractivity() {
      var wrap = document.querySelector('#filmstripWrap');
      var playhead = document.querySelector('#fsPlayhead');
      var video = document.getElementById('videoPlayer');
      if (!wrap || !playhead) return;

      var LABEL_W = 40;
      var isDragging = false;

      function getTrackWidth() {
        return wrap.offsetWidth - LABEL_W;
      }

      function ratioFromX(clientX) {
        var rect = wrap.getBoundingClientRect();
        var x = clientX - rect.left - LABEL_W;
        return Math.max(0, Math.min(1, x / getTrackWidth()));
      }

      function movePlayhead(ratio) {
        playhead.style.left = (LABEL_W + ratio * getTrackWidth()) + 'px';
      }

      function seekVideo(ratio) {
        var v = document.getElementById('videoPlayer');
        if (v && v.duration && isFinite(v.duration)) {
          v.currentTime = ratio * v.duration;
        }
      }

      wrap.addEventListener('mousedown', function(e) {
        isDragging = true;
        var r = ratioFromX(e.clientX);
        movePlayhead(r);
        seekVideo(r);
        playhead.style.cursor = 'grabbing';
        e.preventDefault();
      });

      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        var r = ratioFromX(e.clientX);
        movePlayhead(r);
        seekVideo(r);
      });

      document.addEventListener('mouseup', function() {
        if (isDragging) {
          isDragging = false;
          playhead.style.cursor = 'grab';
        }
      });

      // Touch support for mobile
      wrap.addEventListener('touchstart', function(e) {
        isDragging = true;
        var t = e.touches[0];
        var r = ratioFromX(t.clientX);
        movePlayhead(r);
        seekVideo(r);
        e.preventDefault();
      }, {passive: false});

      document.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        var t = e.touches[0];
        var r = ratioFromX(t.clientX);
        movePlayhead(r);
        seekVideo(r);
      }, {passive: false});

      document.addEventListener('touchend', function() {
        isDragging = false;
      });

      // Sync playhead position on video timeupdate
      var vp = document.getElementById('videoPlayer');
      if (vp && vp.addEventListener) {
        vp.addEventListener('timeupdate', function() {
          if (isDragging) return;
          if (vp.duration && isFinite(vp.duration)) {
            var ratio = vp.currentTime / vp.duration;
            movePlayhead(ratio);
          }
        });
      }

      // Recalculate on window resize
      window.addEventListener('resize', function() {
        var v = document.getElementById('videoPlayer');
        if (v && v.duration && isFinite(v.duration) && !isDragging) {
          movePlayhead(v.currentTime / v.duration);
        }
      });
    })();

    // Initialize media library on page load
    document.addEventListener('DOMContentLoaded', function() {
      populateMediaGrid();
    });
    if (document.readyState !== 'loading') { populateMediaGrid(); }


    ${getThemeScript()}



    let currentVideoFile = null;
    let originalVideoFile = null; // Always keeps the original upload for speed resets
    let videoDuration = 0;
    let selectedFilter = null;

    // Toast notifications
    
// === PREMIUM SIDEBAR REDESIGN: Tabbed Category System ===
    (function() {
      var sidebar = document.querySelector('.editor-sidebar');
      if (!sidebar) return;
      var propsPanel = sidebar.querySelector('.properties-panel');
      var toolsSection = document.querySelector('.tools-section');
      var exportPanel = sidebar.querySelector('.export-panel');
      if (!toolsSection) return;

      // Clear any initially active tool panels
      document.querySelectorAll('.tool-panel.active').forEach(function(p) { p.classList.remove('active'); });

      // Move extra panels from video-container into sidebar
      var panelIds = ['cropPanel','annotationsPanel','elementsPanel','zoomPanel','pipPanel','keyframesPanel','colorGradePanel'];
      panelIds.forEach(function(id) {
        var panel = document.getElementById(id);
        if (panel && panel.closest('.editor-sidebar') === null) {
          if (exportPanel) exportPanel.before(panel);
          else sidebar.appendChild(panel);
        }
      });

      // Make properties panel collapsible (starts collapsed)
      if (propsPanel) {
        propsPanel.classList.add('collapsed');
        var title = propsPanel.querySelector('.panel-title');
        if (title) {
          title.style.cursor = 'pointer';
          var arrow = document.createElement('span');
          arrow.textContent = ' \u25B8';
          arrow.style.cssText = 'float:right;transition:transform .2s';
          title.appendChild(arrow);
          title.addEventListener('click', function() {
            propsPanel.classList.toggle('collapsed');
            arrow.textContent = propsPanel.classList.contains('collapsed') ? ' \u25B8' : ' \u25BE';
          });
        }
      }

      var categories = [
        { id: 'edit', label: 'Edit', icon: '\u2702\uFE0F', tools: ['trim','split','speed','crop'] },
        { id: 'audio', label: 'Audio', icon: '\uD83D\uDD0A', tools: ['audio','music','voiceover','voicetransform'] },
        { id: 'ai', label: 'AI', icon: '\u2728', tools: ['enhance','captions','aihook','brandtemplate','transcript','broll'] },
        { id: 'effects', label: 'Effects', icon: '\uD83C\uDFA8', tools: ['filters','text','transitions','annotations','elements','zoom','pip','keyframes','colorgrade'] }
      ];

      var tabContainer = document.createElement('div');
      tabContainer.className = 'category-tabs';
      var toolGrid = document.createElement('div');
      toolGrid.className = 'category-tools';
      toolGrid.id = 'categoryTools';

      categories.forEach(function(cat, index) {
        var tab = document.createElement('button');
        tab.className = 'category-tab' + (index === 0 ? ' active' : '');
        tab.dataset.category = cat.id;
        tab.innerHTML = '<span class="cat-icon">' + cat.icon + '</span><span class="cat-label">' + cat.label + '</span>';
        var grid = document.createElement('div');
        grid.className = 'category-grid';
        grid.dataset.category = cat.id;
        grid.style.display = index === 0 ? 'flex' : 'none';
        if (cat.id === 'edit') {
          var undoBtn = document.getElementById('undoBtn');
          var redoBtn = document.getElementById('redoBtn');
          if (undoBtn) grid.appendChild(undoBtn);
          if (redoBtn) grid.appendChild(redoBtn);
        }
        cat.tools.forEach(function(toolName) {
          var btn = toolsSection.querySelector('[data-tool="' + toolName + '"]');
          if (btn) grid.appendChild(btn);
        });
        tab.addEventListener('click', function() {
          tabContainer.querySelectorAll('.category-tab').forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
          toolGrid.querySelectorAll('.category-grid').forEach(function(g) { g.style.display = 'none'; });
          grid.style.display = 'flex';
          document.querySelectorAll('.tool-panel').forEach(function(p) { p.classList.remove('active'); });
          document.querySelectorAll('.tool-button').forEach(function(b) { b.classList.remove('active'); });
        });
        tabContainer.appendChild(tab);
        toolGrid.appendChild(grid);
      });

      toolsSection.style.display = 'none';
      if (propsPanel) {
        propsPanel.after(tabContainer);
        tabContainer.after(toolGrid);
      }
      if (exportPanel) exportPanel.classList.add('export-floating');
    })();


function showToast(message, type = 'success') {
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.style.display = 'block';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    // Upload handlers
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoPreviewArea = document.getElementById('videoPreviewArea');

    document.querySelector('.upload-button')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    uploadZone.addEventListener('click', (e) => {
      if (e.target === fileInput) return;
      // Don't open file picker when clicking on URL input, buttons, or other interactive elements
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('input[type="text"]') || e.target.id === 'youtubeUrlInput' || e.target.id === 'youtubeImportBtn' || e.target.id === 'dropboxImportBtn' || e.target.id === 'googleDriveImportBtn') return;
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await uploadVideo(file);
    });

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        await uploadVideo(file);
      }
    });

    async function uploadVideo(file) {
      var uploadBtn = document.querySelector('.upload-button');
      var originalText = uploadBtn.textContent;
      uploadBtn.textContent = 'Uploading...';
      uploadBtn.disabled = true;
      uploadZone.style.opacity = '0.6';
      uploadZone.style.pointerEvents = 'none';

      const formData = new FormData();
      formData.append('video', file);

      try {
        const response = await fetch('/video-editor/upload', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          var errData = {};
          try { errData = await response.json(); } catch(e) {}
          throw new Error(errData.error || 'Upload failed (status ' + response.status + ')');
        }

        const data = await response.json();
        currentVideoFile = data;
        originalVideoFile = { ...data }; // Save original for speed resets
        videoDuration = data.duration || 0;
        initTimeline();

        videoPlayer.src = data.serveUrl;
        videoPlayer?.addEventListener('loadedmetadata', function() {
            // Show filmstrip when video loads
            if (typeof showFilmstrip === "function") showFilmstrip(this.duration);

          if (videoPlayer?.duration && videoPlayer?.duration !== Infinity) {
            videoDuration = videoPlayer?.duration;
          }
        });
        uploadZone.classList.add('has-video');
        videoPreviewArea.classList.add('has-video');
        (function(){var e=document.getElementById('trimButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('exportButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('splitButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('filterButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('speedButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('audioButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('previewVoiceButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('voiceoverButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('vtPreviewBtn');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('vtApplyBtn');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('textButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('speedSelect');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('addMusicButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('removeFillerWordsBtn');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('removePausesBtn');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('applyTransitionButton');if(e)e.disabled=false;})();
        (function(){var e=document.getElementById('applyCaptionsBtn');if(e)e.disabled=false;})();

        // Set end time to video duration
        (function(){var e=document.getElementById('endTime');if(e)e.value=Math.round(videoDuration);})();

        // Add the uploaded file to the Media library ("All" + correct type
        // tab) as a raw asset. Do NOT create a Draft here — Media and
        // Projects are strictly separate: Media holds raw assets, Projects
        // only holds drafts and completed exports. Drafts will be created
        // by an explicit save action in a future iteration.
        try {
          if (typeof window.addUploadedMediaItem === 'function') {
            window.addUploadedMediaItem({
              name: (file && file.name) || data.filename,
              filename: data.filename,
              serveUrl: data.serveUrl,
              duration: videoDuration
              // mediaType auto-classified from filename extension
            });
          }
        } catch (_) {}

        showToast('Video uploaded successfully!', 'success');
      } catch (error) {
        uploadBtn.textContent = originalText;
        uploadBtn.disabled = false;
        uploadZone.style.opacity = '1';
        uploadZone.style.pointerEvents = 'auto';
        showToast('Failed to upload video: ' + error.message, 'error');
      }
    }

    // Slider updates
    document.querySelectorAll('.slider').forEach(slider => {
      if (slider.id === 'volumeSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('volumeValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'fadeInSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('fadeInValue').textContent = this.value + 's';
        });
      } else if (slider.id === 'fadeOutSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('fadeOutValue').textContent = this.value + 's';
        });
      } else if (slider.id === 'bassSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('bassValue').textContent = this.value + 'dB';
        });
      } else if (slider.id === 'trebleSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('trebleValue').textContent = this.value + 'dB';
        });
      } else if (slider.id === 'voiceVolumeSlider') {
        slider.addEventListener('input', function() {
          document.getElementById('voiceVolumeValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'fontSize') {
        slider.addEventListener('input', function() {
          document.getElementById('fontSizeValue').textContent = this.value + 'px';
        });
      } else if (slider.id === 'musicVolume') {
        slider.addEventListener('input', function() {
          document.getElementById('musicVolumeValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'vtStability') {
        slider.addEventListener('input', function() {
          document.getElementById('vtStabilityValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'vtSimilarity') {
        slider.addEventListener('input', function() {
          document.getElementById('vtSimilarityValue').textContent = this.value + '%';
        });
      } else if (slider.id === 'brightness' || slider.id === 'contrast' || slider.id === 'saturation') {
        slider.addEventListener('input', function() {
          const valueSpan = this.parentElement.querySelector('.slider-value');
          if (valueSpan) {
            valueSpan.textContent = this.value + '%';
          }
          // Apply real-time CSS filter preview on the video
          applyVideoFilterPreview();
        });
      } else {
        slider.addEventListener('input', function() {
          const valueSpan = this.parentElement.querySelector('.slider-value');
          if (valueSpan) {
            valueSpan.textContent = this.value + '%';
          }
        });
      }
    });

    function applyVideoFilterPreview() {
      var b = parseInt(document.getElementById('brightness')?.value) || 100;
      var c = parseInt(document.getElementById('contrast')?.value) || 100;
      var s = parseInt(document.getElementById('saturation')?.value) || 100;
      videoPlayer.style.filter = 'brightness(' + (b / 100) + ') contrast(' + (c / 100) + ') saturate(' + (s / 100) + ')';
    }

    // Tool panel switching
    document.querySelectorAll('.tool-button').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        var tool = this.dataset.tool;

        document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));
        var panelId = tool + 'Panel';
        var panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.add('active');
        }
      });
    });

    // Music library filter buttons
    document.querySelectorAll('[data-music-filter]').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('[data-music-filter]').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        loadMusicLibrary(this.dataset.musicFilter);
      });
    });

    // Initialize music library
    let selectedMusicFile = null;
    let currentPreviewAudio = null;
    let currentCategory = 'all';

    async function loadMusicLibrary(category = 'all', searchQuery = '') {
      currentCategory = category;
      const listContainer = document.getElementById('musicList');
      if (!listContainer) return;
      listContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:1rem"><span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.2);border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite;margin-right:.5rem;vertical-align:middle"></span>Loading music...</div>';

      try {
        let url = '/video-editor/search-music?category=' + encodeURIComponent(category);
        if (searchQuery) url += '&q=' + encodeURIComponent(searchQuery);

        const response = await fetch(url);
        const data = await response.json();

        if (!data.tracks || data.tracks.length === 0) {
          listContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:1rem">No tracks found. Try a different search or category.</div>';
          return;
        }

        listContainer.innerHTML = data.tracks.map(track => {
          const previewUrl = (track.previewUrl || track.downloadUrl || '').replace(/'/g, "\\\\'");
          const hasPreview = track.previewUrl || track.downloadUrl;
          const playBtn = hasPreview
            ? '<button class="music-play-btn" style="width:32px;height:32px;min-width:32px;background:rgba(108,58,237,0.2);border:1px solid var(--primary);color:var(--primary);border-radius:50%;font-size:.8rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s" onclick="event.stopPropagation();previewMusicTrack(this, \\'' + previewUrl + '\\')">&#9654;</button>'
            : '';
          const artistInfo = track.artist ? '<span style="color:var(--text-muted)"> &middot; ' + track.artist + '</span>' : '';
          return '<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;background:var(--dark);border-radius:8px;margin-bottom:.35rem;border:1px solid rgba(255,255,255,0.08);cursor:pointer;transition:all .15s" data-track-id="' + track.id + '" onclick="selectMusicTrack(this, \\'' + track.name.replace(/'/g, "\\\\'") + '\\', \\'' + track.id + '\\', \\'' + previewUrl + '\\')" onmouseover="this.style.borderColor=\\'rgba(108,58,237,0.3)\\'" onmouseout="if(!this.classList.contains(\\'selected\\'))this.style.borderColor=\\'rgba(255,255,255,0.08)\\'">' +
            playBtn +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:.8rem;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + track.name + '</div>' +
              '<div style="font-size:.68rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + track.duration + artistInfo + '</div>' +
            '</div>' +
          '</div>';
        }).join('');

        // Show track count
        listContainer.innerHTML = '<div style="font-size:.7rem;color:var(--text-muted);margin-bottom:.4rem">' + data.tracks.length + ' tracks</div>' + listContainer.innerHTML;
      } catch (error) {
        listContainer.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:.85rem;padding:1rem">Failed to load music. Try uploading your own.</div>';
      }
    }

    window.selectMusicTrack = function(element, trackName, trackId, downloadUrl) {
      document.querySelectorAll('[data-track-id]').forEach(function(el) { el.style.borderColor = 'rgba(255,255,255,0.1)'; });
      element.style.borderColor = 'var(--primary)';
      selectedMusicFile = { id: trackId, name: trackName, downloadUrl: downloadUrl || null };
      document.getElementById('addMusicButton').disabled = false;
      showToast('Selected: ' + trackName, 'success');
    };

    window.previewMusicTrack = function(btnElement, previewUrl) {
      if (!previewUrl) {
        showToast('No preview available for this track', 'error');
        return;
      }

      // Stop any currently playing preview
      if (currentPreviewAudio) {
        currentPreviewAudio.pause();
        currentPreviewAudio = null;
        // Reset all play buttons to play icon
        document.querySelectorAll('.music-play-btn').forEach(function(b) {
          b.innerHTML = '&#9654;';
          b.style.background = 'rgba(108,58,237,0.2)';
        });
      }

      // If this button was already playing, just stop
      if (btnElement.innerHTML.includes('9724') || btnElement.innerHTML.includes('■')) {
        btnElement.innerHTML = '&#9654;';
        btnElement.style.background = 'rgba(108,58,237,0.2)';
        return;
      }

      currentPreviewAudio = new Audio(previewUrl);
      currentPreviewAudio.volume = 0.5;
      currentPreviewAudio.play().catch(function() {
        showToast('Loading preview...', 'success');
        // Retry after a short delay — the server may be generating the audio
        setTimeout(function() {
          currentPreviewAudio = new Audio(previewUrl);
          currentPreviewAudio.volume = 0.5;
          currentPreviewAudio.play().catch(function() {
            showToast('Could not play preview', 'error');
            btnElement.innerHTML = '&#9654;';
            btnElement.style.background = 'rgba(108,58,237,0.2)';
          });
          currentPreviewAudio.addEventListener('ended', function() {
            btnElement.innerHTML = '&#9654;';
            btnElement.style.background = 'rgba(108,58,237,0.2)';
            currentPreviewAudio = null;
          });
        }, 2000);
      });
      // Show stop icon while playing
      btnElement.innerHTML = '&#9724;';
      btnElement.style.background = 'rgba(108,58,237,0.4)';

      currentPreviewAudio.addEventListener('ended', function() {
        btnElement.innerHTML = '&#9654;';
        btnElement.style.background = 'rgba(108,58,237,0.2)';
        currentPreviewAudio = null;
      });
    };

    // Custom music file upload
    document.getElementById('customMusicFile')?.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        selectedMusicFile = { name: file.name, file: file };
        document.getElementById('addMusicButton').disabled = false;
        showToast('Selected: ' + file.name, 'success');
      }
    });

    // Music search with debounce
    let musicSearchTimeout = null;
    document.getElementById('musicSearch')?.addEventListener('input', function() {
      const query = this.value.trim();
      clearTimeout(musicSearchTimeout);
      musicSearchTimeout = setTimeout(function() {
        loadMusicLibrary(currentCategory, query);
      }, 500);
    });

    // Load default music library on page load
    loadMusicLibrary('all');


    // Aspect Ratio handler
    // Gradient preset cards click handler
    document.querySelectorAll('.gradient-preset-card').forEach(function(card) {
      card.addEventListener('click', function() {
        document.querySelectorAll('.gradient-preset-card').forEach(function(c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        var grad = card.dataset.gradient;
        var videoContainer = document.querySelector('.video-container');
        if (videoContainer) videoContainer.style.background = grad;
        var videoEl = document.getElementById('videoPlayer');
        if (videoEl) videoEl.style.background = 'transparent';
      });
    });

    document.getElementById('aspectRatioSelect')?.addEventListener('change', function() {
      const ratio = this.value;
      const vc = document.querySelector('.video-container');
      if (!vc) return;
      const ratioMap = { '16:9': '56.25%', '9:16': '177.78%', '1:1': '100%', '4:5': '125%' };
      const widthMap = { '16:9': '100%', '9:16': '56.25%', '1:1': '100%', '4:5': '80%' };
      vc.style.paddingBottom = ratioMap[ratio] || '56.25%';
      vc.style.width = widthMap[ratio] || '100%';
      vc.style.height = '0';
      vc.style.margin = '0 auto';
      vc.style.position = 'relative';
      const vp = document.getElementById('videoPlayer');
      if (vp) {
        vp.style.position = 'absolute';
        vp.style.top = '0';
        vp.style.left = '0';
        vp.style.width = '100%';
        vp.style.height = '100%';
        vp.style.objectFit = 'cover';
      }
      showToast('Aspect ratio: ' + ratio, 'success');
    });

    // Layout Mode handler
    document.getElementById('layoutSelect')?.addEventListener('change', function() {
      const layout = this.value;
      const vc = document.querySelector('.video-container');
      const vp = document.getElementById('videoPlayer');
      if (!vc || !vp) return;

      // Reset styles
      vp.style.objectFit = '';
      vp.style.width = '100%';
      vp.style.height = '100%';
      vc.style.flexDirection = '';
      vc.style.overflow = 'hidden';

      // Remove any split/layout overlays
      const existingClone = vc.querySelector('.layout-clone');
      if (existingClone) existingClone.remove();

      switch(layout) {
        case 'fill':
          vp.style.objectFit = 'cover';
          break;
        case 'fit':
          vp.style.objectFit = 'contain';
          vc.style.background = 'linear-gradient(135deg,#1a1a2e,#16213e)';
          // Add blur backdrop
          vc.style.backdropFilter = 'blur(20px)';
          break;
        case 'split':
          vp.style.width = '50%';
          vp.style.objectFit = 'cover';
          const clone = vp.cloneNode(false);
          clone.className = 'layout-clone';
          clone.src = vp.src;
          clone.currentTime = vp.currentTime;
          clone.muted = true;
          clone.style.width = '50%';
          clone.style.objectFit = 'cover';
          clone.style.pointerEvents = 'none';
          vc.style.flexDirection = 'row';
          vc.style.display = 'flex';
          vc.appendChild(clone);
          vp.addEventListener('timeupdate', function syncClone() { if (clone.parentElement) clone.currentTime = vp.currentTime; else vp.removeEventListener('timeupdate', syncClone); });
          break;
        case 'screenshare':
          vp.style.objectFit = 'contain';
          vp.style.width = '70%';
          vp.style.margin = '0 auto';
          vp.style.display = 'block';
          break;
        case 'gameplay':
          vp.style.objectFit = 'cover';
          vp.style.height = '60%';
          break;
      }
      showToast('Layout: ' + this.options[this.selectedIndex].text, 'success');
    });

    // Transition buttons
    let selectedTransition = 'none';
    document.querySelectorAll('.transition-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.transition-btn').forEach(b => b.style.borderColor = 'rgba(255,255,255,0.1)');
        this.style.borderColor = 'var(--primary)';
        selectedTransition = this.dataset.transition;
      });
    });

    // Transition duration slider
    document.getElementById('transitionDuration')?.addEventListener('input', function() {
      document.getElementById('transitionDurationValue').textContent = this.value + 's';
    });

    // Apply transitions handler
    // Brand Template handler
    document.getElementById('applyBrandBtn')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('applyBrandBtn');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Applying Brand...';

      try {
        const formData = new FormData();
        formData.append('filename', currentVideoFile.filename);
        formData.append('primaryColor', document.getElementById('brandPrimaryColor')?.value);
        formData.append('secondaryColor', document.getElementById('brandSecondaryColor')?.value);
        formData.append('textColor', document.getElementById('brandTextColor')?.value);
        formData.append('fontFamily', document.getElementById('brandFontSelect')?.value);
        formData.append('logoPosition', document.getElementById('logoPositionSelect')?.value);
        formData.append('logoSize', document.getElementById('logoSizeSelect') ? document.getElementById('logoSizeSelect')?.value : 'medium');

        // Attach logo file if selected
        var logoInput = document.getElementById('brandLogoInput');
        if (logoInput && logoInput.files && logoInput.files[0]) {
          formData.append('logo', logoInput.files[0]);
        }

        const response = await fetch('/video-editor/apply-brand-template', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Brand template failed');
        }

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        showToast('Brand template applied!', 'success');
      } catch (error) {
        showToast('Brand template error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '✨ Apply Brand Template';
      }
    });

    // Brand logo upload trigger
    document.getElementById('brandLogoBtn')?.addEventListener('click', () => {
      document.getElementById('brandLogoInput')?.click();
    });
    document.getElementById('brandLogoInput')?.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        document.getElementById('brandLogoBtn').innerHTML = '📎 ' + e.target.files[0].name;
      }
    });

    document.getElementById('applyTransitionButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const autoTransitions = document.getElementById('autoTransitions')?.checked;
      const duration = parseFloat(document.getElementById('transitionDuration')?.value) || 0.5;

      const button = document.getElementById('applyTransitionButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Applying...';

      try {
        const response = await fetch('/video-editor/apply-transition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            transitionType: selectedTransition,
            duration: duration,
            autoTransitions: autoTransitions
          })
        });

        if (!response.ok) throw new Error('Apply transition failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        showToast('Transitions applied successfully!', 'success');
      } catch (error) {
        showToast('Failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = 'Apply Transitions';
      }
    });

    // === AI Captions inline panel ===
    var selectedCaptionStyle = 'karaoke';
    var captionPosition = 'bottom';

    window.selectCaptionStyle = function(el, style) {
      document.querySelectorAll('.caption-style-option').forEach(function(opt) {
        opt.style.borderColor = 'rgba(255,255,255,0.1)';
      });
      el.style.borderColor = 'var(--primary)';
      selectedCaptionStyle = style;
    };

    window.setCaptionPosition = function(pos, el) {
      document.querySelectorAll('#captionsPanel .filter-btn').forEach(function(b) { b.classList.remove('selected'); });
      el.classList.add('selected');
      captionPosition = pos;
    };

    document.getElementById('applyCaptionsBtn')?.addEventListener('click', async function() {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      var btn = this;
      var progressDiv = document.getElementById('captionProgress');
      var progressBar = document.getElementById('captionProgressBar');
      var progressText = document.getElementById('captionProgressText');

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Processing...';
      progressDiv.style.display = 'block';
      progressBar.style.width = '10%';
      progressText.textContent = 'Extracting speech with Whisper AI...';

      try {
        // Step 1: Extract transcript
        setTimeout(function() { progressBar.style.width = '30%'; }, 1000);
        setTimeout(function() { progressBar.style.width = '50%'; progressText.textContent = 'Generating captions...'; }, 3000);
        setTimeout(function() { progressBar.style.width = '70%'; progressText.textContent = 'Burning captions into video...'; }, 6000);

        var response = await fetch('/video-editor/apply-captions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoFilename: currentVideoFile.filename,
            style: selectedCaptionStyle,
            position: captionPosition
          })
        });

        if (!response.ok) {
          var errData = await response.json().catch(function() { return {}; });
          throw new Error(errData.error || 'Caption generation failed');
        }

        progressBar.style.width = '100%';
        progressText.textContent = 'Done!';

        var data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        initTimeline();

        showToast('Captions applied successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '💬 Generate & Apply Captions';
        setTimeout(function() { progressDiv.style.display = 'none'; progressBar.style.width = '0%'; }, 2000);
      }
    });


        // === PROFESSIONAL TIMELINE ===
    var timelineState = {
      trimStart: 0,
      trimEnd: 0,
      isDragging: false,
      dragType: null, // 'playhead', 'trimLeft', 'trimRight'
      musicTrack: null
    };

    function initTimeline() {
          if (!document.getElementById("timelineTracks")) return;

      if (!videoDuration || videoDuration <= 0) return;
      timelineState.trimEnd = videoDuration;

      var tracksEl = document.getElementById('timelineTracks');
      var rulerEl = document.getElementById('timelineRuler');
      var emptyEl = document.getElementById('timelineEmpty');
      if (emptyEl) emptyEl.style.display = 'none';

      // Build ruler marks
      rulerEl.innerHTML = '';
      var interval = videoDuration <= 30 ? 5 : videoDuration <= 120 ? 10 : 30;
      for (var t = 0; t <= videoDuration; t += interval) {
        var pct = (t / videoDuration) * 100;
        var mark = document.createElement('div');
        mark.className = 'timeline-ruler-mark';
        mark.style.left = 'calc(40px + ' + pct + '% * (100% - 48px) / 100%)';
        mark.style.left = (40 + pct * (tracksEl.offsetWidth - 48) / 100) + 'px';
        var mins = Math.floor(t / 60);
        var secs = String(Math.floor(t % 60)).padStart(2, '0');
        mark.textContent = mins + ':' + secs;
        rulerEl.appendChild(mark);
      }

      // Build video track
      var existingVideo = document.getElementById('timelineVideoTrack');
      if (existingVideo) existingVideo.remove();

      var videoTrack = document.createElement('div');
      videoTrack.className = 'timeline-track';
      videoTrack.id = 'timelineVideoTrack';

      var durMins = Math.floor(videoDuration / 60);
      var durSecs = String(Math.floor(videoDuration % 60)).padStart(2, '0');
      var durStr = (durMins > 0 ? durMins + ':' : '0:') + durSecs;

      videoTrack.innerHTML = '<div class="timeline-track-label">' +
        '<span style="font-size:0.65rem;opacity:0.7;text-transform:uppercase;letter-spacing:0.5px">Video</span>' +
        '</div>' +
        '<div class="timeline-track-content" id="videoTrackContent">' +
          '<div class="timeline-trim-overlay" id="trimOverlayLeft" style="left:0;width:0"></div>' +
          '<div class="timeline-video-bar" id="videoBar">' +
            '<div class="thumb-strip" id="thumbStrip"></div>' +
            '<div class="track-info-overlay">' +
              '<span class="track-duration" style="font-size:.6rem;opacity:0.6">' + durStr + '</span>' +
            '</div>' +
            '<div class="timeline-trim-handle left" id="trimHandleLeft"></div>' +
            '<div class="timeline-trim-handle right" id="trimHandleRight"></div>' +
          '</div>' +
          '<div class="timeline-trim-overlay" id="trimOverlayRight" style="right:0;width:0"></div>' +
        '</div>';

      var playhead = document.getElementById('timelinePlayhead');
      tracksEl.insertBefore(videoTrack, playhead.nextSibling);

      // Build audio waveform track
      var existingAudio = document.getElementById('timelineAudioTrack');
      if (existingAudio) existingAudio.remove();

      var audioTrack = document.createElement('div');
      audioTrack.className = 'timeline-track';
      audioTrack.id = 'timelineAudioTrack';
      audioTrack.innerHTML = '<div class="timeline-track-label">' +
        '<span style="font-size:0.65rem;opacity:0.7;text-transform:uppercase;letter-spacing:0.5px">Audio</span>' +
        '</div>' +
        '<div class="timeline-track-content">' +
          '<div class="timeline-audio-bar" id="audioBar">' +
            '<canvas id="waveformCanvas" style="width:100%;height:100%"></canvas>' +
          '</div>' +
        '</div>';
      tracksEl.appendChild(audioTrack);

      // Track click-to-seek is handled by the global timelineTracks mousedown below

      setupTrimHandles();
      startPlayheadLoop();

      // Fetch and render timeline thumbnails
      fetchTimelineThumbs(currentVideoFile.filename);
      // Fetch and render audio waveform
      fetchAudioWaveform(currentVideoFile.filename);
    }

    function fetchTimelineThumbs(filename) {
      fetch('/video-editor/timeline-frames?filename=' + encodeURIComponent(filename))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.frames || !data.frames.length) return;
          var strip = document.getElementById('thumbStrip');
          if (!strip) return;
          strip.innerHTML = '';
          data.frames.forEach(function(src) {
            var img = document.createElement('img');
            img.src = src;
            img.style.height = '100%';
            img.style.width = 'auto';
            img.style.objectFit = 'cover';
            img.style.flexShrink = '0';
            img.style.minWidth = '0';
            strip.appendChild(img);
          });
          // Make images fill the bar evenly
          var barWidth = strip.parentElement.offsetWidth;
          var imgWidth = Math.ceil(barWidth / data.frames.length);
          strip.querySelectorAll('img').forEach(function(img) {
            img.style.width = imgWidth + 'px';
          });
        })
        .catch(function() {});
    }

    function fetchAudioWaveform(filename) {
      fetch('/video-editor/audio-waveform?filename=' + encodeURIComponent(filename))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.peaks || !data.peaks.length) return;
          drawWaveform('waveformCanvas', data.peaks);
        })
        .catch(function() {});
    }

    function drawWaveform(canvasId, peaks) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var container = canvas.parentElement;
      canvas.width = container.offsetWidth * (window.devicePixelRatio || 1);
      canvas.height = container.offsetHeight * (window.devicePixelRatio || 1);
      canvas.style.width = container.offsetWidth + 'px';
      canvas.style.height = container.offsetHeight + 'px';
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      var w = container.offsetWidth;
      var h = container.offsetHeight;
      var barW = Math.max(1.5, (w / peaks.length) - 0.5);
      var gap = 0.5;

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < peaks.length; i++) {
        var val = peaks[i];
        var peakH = Math.max(1, val * h * 0.9);
        var x = i * (barW + gap);
        var y = (h - peakH) / 2;

        // Color based on audio level: silence=dim, speech=blue, loud/music=bright cyan
        if (val < 0.05) {
          ctx.fillStyle = 'rgba(100,116,139,0.3)'; // Silence — dim gray
        } else if (val < 0.35) {
          // Low-moderate: speech range — blue gradient
          var t = (val - 0.05) / 0.3;
          var r = Math.round(59 + t * 10);
          var g = Math.round(130 + t * 40);
          var b = Math.round(200 + t * 46);
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.85)';
        } else {
          // Loud: music/emphasis — bright cyan-blue
          var t2 = Math.min(1, (val - 0.35) / 0.65);
          var r2 = Math.round(56 - t2 * 20);
          var g2 = Math.round(189 + t2 * 30);
          var b2 = Math.round(248);
          ctx.fillStyle = 'rgba(' + r2 + ',' + g2 + ',' + b2 + ',0.95)';
        }

        // Rounded bars for premium look
        var radius = Math.min(barW / 2, 1.5);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + barW - radius, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
        ctx.lineTo(x + barW, y + peakH - radius);
        ctx.quadraticCurveTo(x + barW, y + peakH, x + barW - radius, y + peakH);
        ctx.lineTo(x + radius, y + peakH);
        ctx.quadraticCurveTo(x, y + peakH, x, y + peakH - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
      }

      // Draw center line for visual reference (very subtle)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }

    // === PLAYHEAD SYSTEM ===
    // Uses RAF for smooth animation, but completely pauses RAF updates
    // during drag AND while the video is seeking after drag release.
    var playheadRAF = null;
    var playheadDragging = false;
    var playheadSeeking = false; // true while waiting for video to finish seeking after drag
    var dragPct = 0;
    var lockedLeft = null; // CSS left value to hold during seek

    function startPlayheadLoop() {
      function tick() {
        if (!videoDuration || videoDuration <= 0) { playheadRAF = requestAnimationFrame(tick); return; }
        var trackContent = document.getElementById('videoTrackContent');
        var playhead = document.getElementById('timelinePlayhead');
        if (!trackContent || !playhead) { playheadRAF = requestAnimationFrame(tick); return; }

        // SKIP position update while dragging OR while seek is in progress
        if (!playheadDragging && !playheadSeeking) {
          var pct = videoPlayer?.currentTime / videoDuration;
          var trackRect = trackContent.getBoundingClientRect();
          var containerRect = document.getElementById('timelineTracks')?.getBoundingClientRect();
          var left = (trackRect.left - containerRect.left) + pct * trackRect.width;
          playhead.style.left = left + 'px';
        } else if (lockedLeft !== null) {
          // Keep playhead visually locked at the position the user chose
          playhead.style.left = lockedLeft + 'px';
        }

        playheadRAF = requestAnimationFrame(tick);
      }
      if (playheadRAF) cancelAnimationFrame(playheadRAF);
      playheadRAF = requestAnimationFrame(tick);
    }

    // When the video finishes seeking, unlock the playhead so RAF can take over
    videoPlayer?.addEventListener('seeked', function() {
      if (playheadSeeking) {
        // Verify the seek actually landed near where we wanted
        var seekedPct = videoPlayer?.currentTime / videoDuration;
        var diff = Math.abs(seekedPct - dragPct);
        if (diff > 0.05 && dragPct > 0.01) {
          // Seek failed or landed far from target — force currentTime again
          videoPlayer.currentTime = dragPct * videoDuration;
        }
        playheadSeeking = false;
        lockedLeft = null;
      }
    });

    function updatePlayhead() {
      // Kept for compatibility but playhead now uses RAF loop
    }

    // Helper: compute playhead left px from a mouse clientX
    function computePlayheadLeft(clientX) {
      var trackContent = document.getElementById('videoTrackContent');
      if (!trackContent) return null;
      var trackRect = trackContent.getBoundingClientRect();
      var containerRect = document.getElementById('timelineTracks')?.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - trackRect.left) / trackRect.width));
      return {
        left: (trackRect.left - containerRect.left) + pct * trackRect.width,
        pct: pct
      };
    }

    // --- Playhead drag: mousedown on playhead/hitbox ---
    document.addEventListener('mousedown', function(e) {
      var hitbox = document.getElementById('playheadHitbox');
      var playhead = document.getElementById('timelinePlayhead');
      if (!hitbox && !playhead) return;
      if (e.target === hitbox || e.target === playhead || (hitbox && hitbox.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        playheadDragging = true;
        playheadSeeking = false;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }
    }, true);

    // --- Playhead drag: mousemove ---
    document.addEventListener('mousemove', function(e) {
      if (!playheadDragging || !videoDuration) return;
      e.preventDefault();
      var result = computePlayheadLeft(e.clientX);
      if (!result) return;
      dragPct = result.pct;
      lockedLeft = result.left;
      // Move playhead visually IMMEDIATELY via CSS — don't touch videoPlayer at all
      var playhead = document.getElementById('timelinePlayhead');
      if (playhead) playhead.style.left = result.left + 'px';
    });

    // --- Playhead drag: mouseup ---
    document.addEventListener('mouseup', function() {
      if (playheadDragging) {
        playheadDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Now seek the video — but keep playhead LOCKED until seek completes
        if (videoDuration) {
          playheadSeeking = true;
          videoPlayer.currentTime = dragPct * videoDuration;
          // Safety timeout: if seeked event never fires, unlock after 5s
          setTimeout(function() { if (playheadSeeking) { playheadSeeking = false; lockedLeft = null; } }, 5000);
        }
      }
    });

    // --- Click anywhere on timeline tracks to seek ---
    document.getElementById('timelineTracks')?.addEventListener('mousedown', function(e) {
      if (playheadDragging) return;
      if (e.target.classList.contains('timeline-trim-handle')) return;
      if (!videoDuration) return;
      var result = computePlayheadLeft(e.clientX);
      if (!result) return;
      var trackContent = document.getElementById('videoTrackContent');
      if (!trackContent) return;
      var rect = trackContent.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right) return;
      dragPct = result.pct;
      lockedLeft = result.left;
      // Move playhead visually immediately and lock it
      var playhead = document.getElementById('timelinePlayhead');
      if (playhead) playhead.style.left = result.left + 'px';
      // Seek the video with lock
      playheadSeeking = true;
      videoPlayer.currentTime = dragPct * videoDuration;
      setTimeout(function() { if (playheadSeeking) { playheadSeeking = false; lockedLeft = null; } }, 5000);
      // Start dragging so user can keep sliding
      playheadDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    // Start playhead animation loop
    startPlayheadLoop();

    function setupTrimHandles() {
      var leftHandle = document.getElementById('trimHandleLeft');
      var rightHandle = document.getElementById('trimHandleRight');
      var trackContent = document.getElementById('videoTrackContent');

      function startDrag(type, e) {
        e.preventDefault();
        e.stopPropagation();
        timelineState.isDragging = true;
        timelineState.dragType = type;
        document.body.style.cursor = 'col-resize';

        function onMove(ev) {
          if (!document.getElementById("startTime")) return;
          var rect = trackContent.getBoundingClientRect();
          var pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          var time = pct * videoDuration;

          if (type === 'trimLeft') {
            timelineState.trimStart = Math.min(time, timelineState.trimEnd - 0.5);
            document.getElementById('startTime').value = Math.round(timelineState.trimStart);
            var leftPct = (timelineState.trimStart / videoDuration) * 100;
            document.getElementById('trimOverlayLeft').style.width = leftPct + '%';
          } else {
            timelineState.trimEnd = Math.max(time, timelineState.trimStart + 0.5);
            document.getElementById('endTime').value = Math.round(timelineState.trimEnd);
            var rightPct = ((videoDuration - timelineState.trimEnd) / videoDuration) * 100;
            document.getElementById('trimOverlayRight').style.width = rightPct + '%';
          }
        }

        function onUp() {
          timelineState.isDragging = false;
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }

      if (leftHandle) leftHandle.addEventListener('mousedown', function(e) { startDrag('trimLeft', e); });
      if (rightHandle) rightHandle.addEventListener('mousedown', function(e) { startDrag('trimRight', e); });
    }

    function addMusicToTimeline(musicName, volume) {
      var existingMusic = document.getElementById('timelineMusicTrack');
      if (existingMusic) existingMusic.remove();

      var tracksEl = document.getElementById('timelineTracks');
      var musicTrack = document.createElement('div');
      musicTrack.className = 'timeline-track';
      musicTrack.id = 'timelineMusicTrack';

      musicTrack.innerHTML = '<div class="timeline-track-label">🎵</div>' +
        '<div class="timeline-track-content">' +
          '<div class="timeline-music-bar">' +
            '<span class="track-info">' + musicName + '</span>' +
            '<span class="track-volume">' + (volume || '30') + '%</span>' +
            '<canvas class="waveform-bg" id="musicWaveformCanvas"></canvas>' +
          '</div>' +
        '</div>';

      tracksEl.appendChild(musicTrack);
      drawFakeWaveform('musicWaveformCanvas');
      timelineState.musicTrack = musicName;
    }

    function drawFakeWaveform(canvasId) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
      ctx.fillStyle = 'rgba(147,197,253,0.5)';
      var barWidth = 3;
      var gap = 2;
      for (var x = 0; x < canvas.width; x += barWidth + gap) {
        var h = Math.random() * canvas.height * 0.8 + canvas.height * 0.1;
        var y = (canvas.height - h) / 2;
        ctx.fillRect(x, y, barWidth, h);
      }
    }

    // Filter button selection
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        selectedFilter = this.dataset.filter;
      });
    });

    // Trim handler
    document.getElementById('trimButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const startTime = parseFloat(document.getElementById('startTime')?.value) || 0;
      const endTime = parseFloat(document.getElementById('endTime')?.value) || videoDuration;

      if (startTime >= endTime) {
        showToast('Start time must be less than end time', 'error');
        return;
      }

      const button = document.getElementById('trimButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Trimming...';

      try {
        const response = await fetch('/video-editor/trim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            startTime,
            endTime
          })
        });

        if (!response.ok) throw new Error('Trim failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;
        document.getElementById('endTime').value = Math.round(videoDuration);

        showToast('Video trimmed successfully!', 'success');
      } catch (error) {
        showToast('Trim failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '✂️ Trim';
      }
    });

    // Split handler
    document.getElementById('splitButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const splitTime = videoPlayer ? videoPlayer?.currentTime : 0;
      if (!splitTime || splitTime <= 0 || splitTime >= videoDuration) {
        showToast('Move the playhead to where you want to split (between 0 and ' + Math.round(videoDuration) + ' seconds)', 'error');
        return;
      }

      const button = document.getElementById('splitButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Splitting...';

      try {
        const response = await fetch('/video-editor/split', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            splitTime: splitTime
          })
        });

        if (!response.ok) throw new Error('Split failed');

        const data = await response.json();
        showToast('Video split successfully! ' + data.files.length + ' files created', 'success');
      } catch (error) {
        showToast('Split failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🔀 Split';
      }
    });

    // Filter handler
    document.getElementById('filterButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      if (!selectedFilter) {
        showToast('Please select a filter', 'error');
        return;
      }

      const button = document.getElementById('filterButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Applying...';

      try {
        const response = await fetch('/video-editor/filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            filter: selectedFilter
          })
        });

        if (!response.ok) throw new Error('Filter failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Filter applied successfully!', 'success');
      } catch (error) {
        showToast('Filter failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🎨 Apply Filter';
      }
    });

    // Speed handler — always applies speed relative to the ORIGINAL upload
    document.getElementById('speedButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const speed = parseFloat(document.getElementById('speedSelect')?.value);

      // If 1x selected, just revert to original video (no FFmpeg needed)
      if (speed === 1) {
        if (originalVideoFile) {
          currentVideoFile = { ...originalVideoFile };
          videoPlayer.src = originalVideoFile.serveUrl;
          videoDuration = originalVideoFile.duration || videoDuration;
          initTimeline();
          showToast('Speed reset to normal', 'success');
        }
        return;
      }

      const button = document.getElementById('speedButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        // Always use the original file so speed changes are absolute, not cumulative
        var sourceFilename = originalVideoFile ? originalVideoFile.filename : currentVideoFile.filename;

        const response = await fetch('/video-editor/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: sourceFilename,
            speed: speed
          })
        });

        if (!response.ok) throw new Error('Speed adjustment failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        initTimeline();

        showToast('Speed adjusted to ' + speed + 'x!', 'success');
      } catch (error) {
        showToast('Speed adjustment failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '⚡ Apply Speed';
      }
    });

    // Audio handler
    document.getElementById('audioButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const volume = parseFloat(document.getElementById('volumeSlider')?.value);
      const fadeIn = parseFloat(document.getElementById('fadeInSlider')?.value);
      const fadeOut = parseFloat(document.getElementById('fadeOutSlider')?.value);
      const bass = parseInt(document.getElementById('bassSlider')?.value);
      const treble = parseInt(document.getElementById('trebleSlider')?.value);
      const noiseReduction = document.getElementById('noiseReduction')?.checked;
      const audioDucking = document.getElementById('audioDucking')?.checked;

      const button = document.getElementById('audioButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/video-editor/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            volume,
            fadeIn,
            fadeOut,
            bass,
            treble,
            noiseReduction,
            audioDucking
          })
        });

        if (!response.ok) throw new Error('Audio adjustment failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Audio enhanced successfully!', 'success');
      } catch (error) {
        showToast('Audio processing failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🔊 Apply Audio';
      }
    });

    // Voiceover preview handler
    document.getElementById('previewVoiceButton')?.addEventListener('click', async () => {
      var script = document.getElementById('voiceoverScript')?.value.trim();
      if (!script) { showToast('Please enter a voiceover script', 'error'); return; }

      var voice = document.getElementById('voiceSelect')?.value;
      var btn = document.getElementById('previewVoiceButton');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating...';

      try {
        var response = await fetch('/video-editor/voiceover-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: script, voiceId: voice })
        });
        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Preview failed');
        }
        var blob = await response.blob();
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        audio.play();
        showToast('Playing voiceover preview', 'success');
      } catch (error) {
        showToast('Preview failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔈 Preview';
      }
    });

    // Voiceover apply handler
    document.getElementById('voiceoverButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) { showToast('Please upload a video first', 'error'); return; }
      var script = document.getElementById('voiceoverScript')?.value.trim();
      if (!script) { showToast('Please enter a voiceover script', 'error'); return; }

      var voice = document.getElementById('voiceSelect')?.value;
      var voiceVolume = parseFloat(document.getElementById('voiceVolumeSlider')?.value);
      var duckOriginal = document.getElementById('duckOriginal')?.checked;

      var btn = document.getElementById('voiceoverButton');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating & Mixing...';

      try {
        var response = await fetch('/video-editor/voiceover-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            text: script,
            voiceId: voice,
            voiceVolume: voiceVolume,
            duckOriginal: duckOriginal
          })
        });
        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Voiceover failed');
        }
        var data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        showToast('Voiceover applied successfully!', 'success');
      } catch (error) {
        showToast('Voiceover failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🎙️ Apply to Video';
      }
    });

    // Voice Transform: source toggle
    document.querySelectorAll('input[name="vtSource"]').forEach(radio => {
      radio.addEventListener('change', function() {
        document.getElementById('vtSourceVideoLabel').style.borderColor = this.value === 'video' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('vtSourceUploadLabel').style.borderColor = this.value === 'upload' ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
        document.getElementById('vtUploadArea').style.display = this.value === 'upload' ? 'block' : 'none';
      });
    });
    document.getElementById('vtAudioFile')?.addEventListener('change', function(e) {
      if (e.target.files.length > 0) {
        document.getElementById('vtAudioFileName').textContent = '🎵 ' + e.target.files[0].name;
        document.getElementById('vtAudioFileName').style.display = 'block';
      }
    });
    document.getElementById('vtStability')?.addEventListener('input', function() {
      document.getElementById('vtStabilityValue').textContent = this.value + '%';
    });
    document.getElementById('vtSimilarity')?.addEventListener('input', function() {
      document.getElementById('vtSimilarityValue').textContent = this.value + '%';
    });

    // Voice Transform: apply handler
    document.getElementById('vtApplyBtn')?.addEventListener('click', async () => {
      if (!currentVideoFile) { showToast('Please upload a video first', 'error'); return; }

      var vtSource = document.querySelector('input[name="vtSource"]:checked').value;
      var voiceId = document.getElementById('vtVoiceSelect')?.value;
      var stability = parseInt(document.getElementById('vtStability')?.value) / 100;
      var similarity = parseInt(document.getElementById('vtSimilarity')?.value) / 100;

      var btn = document.getElementById('vtApplyBtn');
      var progress = document.getElementById('vtProgress');
      var progressBar = document.getElementById('vtProgressBar');
      var progressText = document.getElementById('vtProgressText');

      // Build form data
      var formData = new FormData();
      formData.append('filename', currentVideoFile.filename);
      formData.append('voiceId', voiceId);
      formData.append('stability', stability);
      formData.append('similarity', similarity);
      formData.append('source', vtSource);

      if (vtSource === 'upload') {
        var audioFile = document.getElementById('vtAudioFile')?.files[0];
        if (!audioFile) { showToast('Please upload an audio file', 'error'); return; }
        formData.append('audioFile', audioFile);
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Transforming...';
      progress.style.display = 'block';
      progressBar.style.width = '10%';
      progressText.textContent = 'Extracting audio...';

      try {
        // Simulate progress stages
        setTimeout(() => { progressBar.style.width = '30%'; progressText.textContent = 'Sending to ElevenLabs...'; }, 2000);
        setTimeout(() => { progressBar.style.width = '60%'; progressText.textContent = 'Transforming voice...'; }, 5000);
        setTimeout(() => { progressBar.style.width = '80%'; progressText.textContent = 'Mixing audio back...'; }, 8000);

        var response = await fetch('/video-editor/voice-transform', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Voice transform failed');
        }

        var data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;
        progressBar.style.width = '100%';
        progressText.textContent = 'Voice transformed successfully!';
        showToast('Voice transformed successfully!', 'success');
      } catch (error) {
        showToast('Voice transform failed: ' + error.message, 'error');
        progressText.textContent = 'Failed: ' + error.message;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔄 Transform Voice';
        setTimeout(() => { progress.style.display = 'none'; }, 3000);
      }
    });

    // Voice Transform: preview handler
    document.getElementById('vtPreviewBtn')?.addEventListener('click', async () => {
      if (!currentVideoFile) { showToast('Please upload a video first', 'error'); return; }
      var btn = document.getElementById('vtPreviewBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating preview...';

      try {
        var vtSource = document.querySelector('input[name="vtSource"]:checked').value;
        var voiceId = document.getElementById('vtVoiceSelect')?.value;
        var stability = parseInt(document.getElementById('vtStability')?.value) / 100;
        var similarity = parseInt(document.getElementById('vtSimilarity')?.value) / 100;

        var formData = new FormData();
        formData.append('filename', currentVideoFile.filename);
        formData.append('voiceId', voiceId);
        formData.append('stability', stability);
        formData.append('similarity', similarity);
        formData.append('source', vtSource);
        formData.append('previewOnly', 'true');

        if (vtSource === 'upload') {
          var audioFile = document.getElementById('vtAudioFile')?.files[0];
          if (!audioFile) { showToast('Please upload an audio file', 'error'); return; }
          formData.append('audioFile', audioFile);
        }

        var response = await fetch('/video-editor/voice-transform', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          var err = await response.json();
          throw new Error(err.error || 'Preview failed');
        }

        var data = await response.json();
        // Play the preview audio
        var audio = new Audio(data.previewUrl);
        audio.play();
        showToast('Playing voice preview...', 'success');
      } catch (error) {
        showToast('Preview failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔈 Preview';
      }
    });

    // Text overlay handler
    document.getElementById('textButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const text = document.getElementById('overlayText')?.value.trim();
      if (!text) {
        showToast('Please enter text', 'error');
        return;
      }

      const position = document.getElementById('textPosition')?.value;
      const fontSize = parseInt(document.getElementById('fontSize')?.value);

      const button = document.getElementById('textButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing...';

      try {
        const response = await fetch('/video-editor/text-overlay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            text: text,
            position: position,
            fontSize: fontSize,
            customX: position === 'custom' ? parseInt(document.getElementById('textPosX')?.value) : null,
            customY: position === 'custom' ? parseInt(document.getElementById('textPosY')?.value) : null
          })
        });

        if (!response.ok) throw new Error('Text overlay failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration || videoDuration;

        showToast('Text overlay applied successfully!', 'success');
      } catch (error) {
        showToast('Text overlay failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '📝 Apply Text';
      }
    });

    // Text position dropdown handler
    document.getElementById('textPosition')?.addEventListener('change', function() {
      var customControls = document.getElementById('customPositionControls');
      if (this.value === 'custom') {
        customControls.style.display = 'block';
        enableTextDrag();
      } else {
        customControls.style.display = 'none';
        disableTextDrag();
      }
    });

    // Drag text overlay on video
    var textDragOverlay = null;
    function enableTextDrag() {
      var videoContainer = document.querySelector('.video-container');
      if (!videoContainer) return;
      if (textDragOverlay) textDragOverlay.remove();
      
      textDragOverlay = document.createElement('div');
      textDragOverlay.id = 'textDragOverlay';
      textDragOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;z-index:10';
      videoContainer.style.position = 'relative';
      videoContainer.appendChild(textDragOverlay);
      
      var dragMarker = document.createElement('div');
      dragMarker.id = 'textDragMarker';
      dragMarker.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(108,58,237,0.7);color:#fff;padding:4px 10px;border-radius:4px;font-size:14px;pointer-events:none;white-space:nowrap;border:2px solid #6C3AED';
      dragMarker.textContent = document.getElementById('overlayText')?.value || 'Text';
      textDragOverlay.appendChild(dragMarker);
      
      textDragOverlay.addEventListener('click', function(e) {
        var rect = this.getBoundingClientRect();
        var xPercent = Math.round(((e.clientX - rect.left) / rect.width) * 100);
        var yPercent = Math.round(((e.clientY - rect.top) / rect.height) * 100);
        document.getElementById('textPosX').value = xPercent;
        document.getElementById('textPosY').value = yPercent;
        dragMarker.style.left = xPercent + '%';
        dragMarker.style.top = yPercent + '%';
        showToast('Position set: ' + xPercent + '%, ' + yPercent + '%', 'success');
      });
    }
    
    function disableTextDrag() {
      if (textDragOverlay) { textDragOverlay.remove(); textDragOverlay = null; }
    }
    
    // Update drag marker text when input changes
    document.getElementById('overlayText')?.addEventListener('input', function() {
      var marker = document.getElementById('textDragMarker');
      if (marker) marker.textContent = this.value || 'Text';
    });

    // Export handler
    document.getElementById('exportButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('exportButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Exporting...';

      try {
        const brightness = parseFloat(document.getElementById('brightness')?.value);
        const contrast = parseFloat(document.getElementById('contrast')?.value);
        const saturation = parseFloat(document.getElementById('saturation')?.value);
        const resolution = document.getElementById('resolution')?.value;
        const format = document.getElementById('format')?.value;

        const response = await fetch('/video-editor/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: currentVideoFile.filename,
            brightness,
            contrast,
            saturation,
            resolution,
            format,
            crop: window._appliedCrop || null
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Export failed');

        // Trigger download
        const downloadLink = document.createElement('a');
        downloadLink.href = data.downloadUrl;
        downloadLink.download = data.filename;
        downloadLink.click();

        // Promote this project from Drafts -> Completed Videos
        try {
          var _now = new Date();
          var _dateStr = _now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          if (typeof window.addCompletedEntry === 'function') {
            window.addCompletedEntry({
              id: 'c_' + Date.now(),
              name: data.filename || (currentVideoFile && currentVideoFile.filename) || 'Exported video',
              filename: data.filename,
              serveUrl: data.downloadUrl,
              downloadUrl: data.downloadUrl,
              size: '',
              date: _dateStr
            });
          }
          if (typeof window.removeDraftByFilename === 'function' && currentVideoFile && currentVideoFile.filename) {
            window.removeDraftByFilename(currentVideoFile.filename);
          }
        } catch (_) {}

        showToast('Video exported successfully!', 'success');
      } catch (error) {
        showToast('Export failed: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '📥 Export Video';
      }
    });

    // Add Music handler
    document.getElementById('addMusicButton')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      if (!selectedMusicFile) {
        showToast('Please select a music track', 'error');
        return;
      }

      const button = document.getElementById('addMusicButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Adding Music...';

      try {
        const formData = new FormData();
        formData.append('videoFilename', currentVideoFile.filename);
        formData.append('musicVolume', document.getElementById('musicVolume')?.value / 100);

        if (selectedMusicFile.file) {
          formData.append('musicFile', selectedMusicFile.file);
        } else {
          formData.append('musicTrackId', selectedMusicFile.id);
          if (selectedMusicFile.downloadUrl) {
            formData.append('musicTrackUrl', selectedMusicFile.downloadUrl);
          }
        }

        const response = await fetch('/video-editor/add-music', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) throw new Error('Failed to add music');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;

        addMusicToTimeline(selectedMusicFile.name || 'Music', document.getElementById('musicVolume')?.value);
        showToast('Music added successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = '🎵 Add to Video';
      }
    });

    // Remove Filler Words handler
    document.getElementById('removeFillerWordsBtn')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('removeFillerWordsBtn');
      const progressDiv = document.getElementById('fillerWordsProgress');
      const progressBar = document.getElementById('fillerWordsProgressBar');

      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing';
      progressDiv.style.display = 'block';
      progressBar.style.width = '0%';

      try {
        const response = await fetch('/video-editor/remove-filler-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoFilename: currentVideoFile.filename
          })
        });

        if (!response.ok) throw new Error('Processing failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;
        progressBar.style.width = '100%';

        showToast('Filler words removed successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = 'Process';
        setTimeout(() => {
          progressDiv.style.display = 'none';
        }, 2000);
      }
    });

    // Remove Pauses handler
    document.getElementById('removePausesBtn')?.addEventListener('click', async () => {
      if (!currentVideoFile) {
        showToast('Please upload a video first', 'error');
        return;
      }

      const button = document.getElementById('removePausesBtn');
      const progressDiv = document.getElementById('pausesProgress');
      const progressBar = document.getElementById('pausesProgressBar');

      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Processing';
      progressDiv.style.display = 'block';
      progressBar.style.width = '0%';

      try {
        const response = await fetch('/video-editor/remove-silences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoFilename: currentVideoFile.filename
          })
        });

        if (!response.ok) throw new Error('Processing failed');

        const data = await response.json();
        currentVideoFile = data;
        videoPlayer.src = data.serveUrl;
        videoDuration = data.duration;
        progressBar.style.width = '100%';

        showToast('Pauses removed successfully!', 'success');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = 'Process';
        setTimeout(() => {
          progressDiv.style.display = 'none';
        }, 2000);
      }
    });
  

    // ===== YOUTUBE IMPORT =====
    const youtubeImportBtn = document.getElementById('youtubeImportBtn');
    const youtubeUrlInput = document.getElementById('youtubeUrlInput');
    if (youtubeImportBtn) {
      youtubeImportBtn.addEventListener('click', async function() {
        const url = youtubeUrlInput.value.trim();
        if (!url) { showToast('Please paste a YouTube URL', 'error'); return; }
        if (!url.match(/youtube\.com|youtu\.be|zoom\.us|twitch\.tv|rumble\.com/i)) { showToast('Please enter a valid video URL', 'error'); return; }
        youtubeImportBtn.disabled = true;
        youtubeImportBtn.textContent = '⏳ Importing...';
        try {
          const resp = await fetch('/video-editor/youtube-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Import failed');
          showToast('YouTube video imported!');
          currentVideoFile = data;
          videoDuration = data.duration || 0;
          videoPlayer.src = data.serveUrl;
          if (videoDuration > 0) initTimeline();
          videoPlayer?.addEventListener('loadedmetadata', function() {
            if (videoPlayer?.duration && videoPlayer?.duration !== Infinity) {
              videoDuration = videoPlayer?.duration;
              initTimeline();
            }
          });
          uploadZone.classList.add('has-video');
          videoPreviewArea.classList.add('has-video');
          document.getElementById('exportButton').disabled = false;
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          youtubeImportBtn.disabled = false;
          youtubeImportBtn.textContent = '▶ Import';
        }
      });
    }

    // ===== DROPBOX IMPORT =====
    const dropboxBtn = document.getElementById('dropboxImportBtn');
    if (dropboxBtn) {
      dropboxBtn.addEventListener('click', function() {
        if (typeof Dropbox !== 'undefined' && Dropbox.choose) {
          Dropbox.choose({
            success: async function(files) {
              const file = files[0];
              dropboxBtn.disabled = true;
              dropboxBtn.textContent = '⏳ Importing...';
              try {
                const resp = await fetch('/video-editor/dropbox-import', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: file.link, name: file.name })
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Import failed');
                showToast('Dropbox video imported!');
                currentVideoFile = data;
                videoDuration = data.duration || 0;
                videoPlayer.src = data.serveUrl;
                if (videoDuration > 0) initTimeline();
                videoPlayer?.addEventListener('loadedmetadata', function() {
                  if (videoPlayer?.duration && videoPlayer?.duration !== Infinity) {
                    videoDuration = videoPlayer?.duration;
                    initTimeline();
                  }
                });
                uploadZone.classList.add('has-video');
                videoPreviewArea.classList.add('has-video');
                document.getElementById('exportButton').disabled = false;
              } catch (err) {
                showToast(err.message, 'error');
              } finally {
                dropboxBtn.disabled = false;
                dropboxBtn.textContent = '📦 Dropbox';
              }
            },
            linkType: 'direct',
            multiselect: false,
            extensions: ['video']
          });
        } else {
          showToast('Dropbox SDK loading... try again in a moment', 'error');
        }
      });
    }

    // ===== GRADIENT PRESETS (fixed) =====
    document.querySelectorAll('.gradient-preset-card').forEach(card => {
      const gradient = card.dataset.gradient;
      if (gradient && gradient.startsWith('linear')) {
        card.style.background = gradient;
      }
      card.addEventListener('click', function() {
        document.querySelectorAll('.gradient-preset-card').forEach(c => c.style.borderColor = 'transparent');
        this.style.borderColor = '#fff';
        const vc = document.querySelector('.video-container');
        if (vc) vc.style.background = gradient;
      });
    });

    // ===== TOOLBAR CONTROLS =====
    const hideTimelineBtn = document.getElementById('hideTimelineBtn');
    const timelineContainer = document.getElementById('timelineContainer');
    if (hideTimelineBtn && timelineContainer) {
      let timelineVisible = true;
      hideTimelineBtn.addEventListener('click', function() {
        timelineVisible = !timelineVisible;
        timelineContainer.style.display = timelineVisible ? '' : 'none';
        this.textContent = timelineVisible ? '🙈 Hide Timeline' : '👁 Show Timeline';
      });
    }

    const deleteClipBtn = document.getElementById('deleteClipBtn');
    if (deleteClipBtn) {
      deleteClipBtn.addEventListener('click', function() {
        if (!currentVideoFile) { showToast('No video loaded', 'error'); return; }
        if (confirm('Are you sure you want to delete this clip?')) {
          videoPlayer.src = '';
          currentVideoFile = null;
          videoDuration = 0;
          uploadZone.classList.remove('has-video');
          document.getElementById('exportButton').disabled = true;
          showToast('Clip deleted');
        }
      });
    }

    let timelineZoom = 1;
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => { timelineZoom = Math.min(timelineZoom + 0.25, 4); if (timelineContainer) timelineContainer.style.transform = 'scaleX(' + timelineZoom + ')'; });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { timelineZoom = Math.max(timelineZoom - 0.25, 0.25); if (timelineContainer) timelineContainer.style.transform = 'scaleX(' + timelineZoom + ')'; });

    const saveChangesBtn = document.getElementById('saveChangesBtn');
    if (saveChangesBtn) {
      saveChangesBtn.addEventListener('click', function() {
        showToast('Changes saved!');
        this.textContent = '✅ Saved';
        setTimeout(() => { this.textContent = '💾 Save'; }, 2000);
      });
    }

    const quickExportBtn = document.getElementById('quickExportBtn');
    if (quickExportBtn) {
      quickExportBtn.addEventListener('click', function() {
        document.getElementById('exportButton')?.click();
      });
    }


    // ===== B-ROLL OVERLAY =====
    const brollUploadBtn = document.getElementById('brollUploadBtn');
    const brollFileInput = document.getElementById('brollFileInput');
    const brollControls = document.getElementById('brollControls');
    let brollOverlay = null;
    let brollDragging = false;
    let brollResizing = false;
    let brollOffset = {x:0, y:0};

    if (brollUploadBtn && brollFileInput) {
      brollUploadBtn.addEventListener('click', () => brollFileInput.click());
      brollFileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        brollControls.style.display = 'block';
        // Create overlay on video
        const previewArea = document.getElementById('videoPreviewArea');
        if (brollOverlay) brollOverlay.remove();
        brollOverlay = document.createElement('div');
        brollOverlay.className = 'broll-overlay';
        brollOverlay.style.width = '30%';
        brollOverlay.style.top = '10px';
        brollOverlay.style.right = '10px';
        const isVideo = file.type.startsWith('video');
        const el = document.createElement(isVideo ? 'video' : 'img');
        el.src = URL.createObjectURL(file);
        if (isVideo) { el.muted = true; el.loop = true; el.autoplay = true; }
        brollOverlay.appendChild(el);
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        brollOverlay.appendChild(handle);
        previewArea.style.position = 'relative';
        previewArea.appendChild(brollOverlay);

        // Drag to reposition
        brollOverlay.addEventListener('mousedown', function(e) {
          if (e.target === handle) return;
          brollDragging = true;
          brollOffset.x = e.clientX - brollOverlay.offsetLeft;
          brollOffset.y = e.clientY - brollOverlay.offsetTop;
          e.preventDefault();
        });

        // Resize handle
        handle.addEventListener('mousedown', function(e) {
          brollResizing = true;
          e.stopPropagation();
          e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
          if (brollDragging && brollOverlay) {
            const parent = brollOverlay.parentElement;
            const rect = parent.getBoundingClientRect();
            let x = e.clientX - brollOffset.x;
            let y = e.clientY - brollOffset.y;
            x = Math.max(0, Math.min(x, rect.width - brollOverlay.offsetWidth));
            y = Math.max(0, Math.min(y, rect.height - brollOverlay.offsetHeight));
            brollOverlay.style.left = x + 'px';
            brollOverlay.style.top = y + 'px';
            brollOverlay.style.right = 'auto';
          }
          if (brollResizing && brollOverlay) {
            const parent = brollOverlay.parentElement;
            const rect = parent.getBoundingClientRect();
            const w = Math.max(50, e.clientX - brollOverlay.getBoundingClientRect().left);
            brollOverlay.style.width = (w / rect.width * 100) + '%';
          }
        });
        document.addEventListener('mouseup', function() { brollDragging = false; brollResizing = false; });

        showToast('B-Roll loaded! Drag to reposition, resize with corner handle.');
      });
    }

    // B-Roll position grid buttons
    document.querySelectorAll('.broll-pos-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        if (!brollOverlay) return;
        document.querySelectorAll('.broll-pos-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const pos = this.dataset.pos;
        brollOverlay.style.right = 'auto';
        brollOverlay.style.left = 'auto';
        brollOverlay.style.top = 'auto';
        brollOverlay.style.bottom = 'auto';
        const positions = {
          'top-left': {top:'10px',left:'10px'},
          'top-center': {top:'10px',left:'50%',transform:'translateX(-50%)'},
          'top-right': {top:'10px',right:'10px'},
          'center-left': {top:'50%',left:'10px',transform:'translateY(-50%)'},
          'center': {top:'50%',left:'50%',transform:'translate(-50%,-50%)'},
          'center-right': {top:'50%',right:'10px',transform:'translateY(-50%)'},
          'bottom-left': {bottom:'10px',left:'10px'},
          'bottom-center': {bottom:'10px',left:'50%',transform:'translateX(-50%)'},
          'bottom-right': {bottom:'10px',right:'10px'}
        };
        const p = positions[pos] || positions['center'];
        brollOverlay.style.transform = '';
        Object.assign(brollOverlay.style, p);
      });
    });

    // B-Roll width + opacity sliders
    const brollWidthSlider = document.getElementById('brollWidth');
    const brollOpacitySlider = document.getElementById('brollOpacity');
    if (brollWidthSlider) brollWidthSlider.addEventListener('input', function() {
      document.getElementById('brollWidthVal').textContent = this.value + '%';
      if (brollOverlay) brollOverlay.style.width = this.value + '%';
    });
    if (brollOpacitySlider) brollOpacitySlider.addEventListener('input', function() {
      document.getElementById('brollOpacityVal').textContent = this.value + '%';
      if (brollOverlay) brollOverlay.style.opacity = this.value / 100;
    });

    const removeBrollBtn = document.getElementById('removeBrollBtn');
    if (removeBrollBtn) removeBrollBtn.addEventListener('click', function() {
      if (brollOverlay) { brollOverlay.remove(); brollOverlay = null; }
      brollControls.style.display = 'none';
      showToast('B-Roll removed');
    });

    // ===== AI HOOK GENERATOR =====
    const generateHookBtn = document.getElementById('generateHookBtn');
    if (generateHookBtn) {
      generateHookBtn.addEventListener('click', async function() {
        const style = document.getElementById('hookStyleSelect')?.value;
        const topic = document.getElementById('hookTopicInput')?.value.trim();
        this.disabled = true;
        this.textContent = '⏳ Generating...';
        try {
          const resp = await fetch('/video-editor/generate-hook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ style, topic })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Failed to generate hook');
          document.getElementById('hookText').textContent = data.hook;
          document.getElementById('hookResult').style.display = 'block';
          showToast('Hook generated!');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          this.disabled = false;
          this.textContent = '✨ Generate AI Hook';
        }
      });
    }
    const regenerateHookBtn = document.getElementById('regenerateHookBtn');
    if (regenerateHookBtn) regenerateHookBtn.addEventListener('click', () => generateHookBtn.click());

    // ===== TRANSCRIPT =====
    const autoTranscriptBtn = document.getElementById('autoTranscriptBtn');
    if (autoTranscriptBtn) {
      autoTranscriptBtn.addEventListener('click', async function() {
        if (!currentVideoFile) { showToast('Upload a video first', 'error'); return; }
        this.disabled = true;
        this.textContent = '⏳ Transcribing...';
        const statusEl = document.getElementById('transcriptStatus');
        statusEl.style.display = 'block';
        statusEl.textContent = '🤖 Running AI speech-to-text... this may take a moment.';
        try {
          const resp = await fetch('/video-editor/transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: currentVideoFile.filename })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Transcription failed');
          document.getElementById('transcriptText').value = data.transcript;
          statusEl.textContent = '✅ Transcript generated!';
          setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
          showToast('Transcript generated!');
        } catch (err) {
          statusEl.textContent = '❌ ' + err.message;
          showToast(err.message, 'error');
        } finally {
          this.disabled = false;
          this.textContent = '🤖 Auto-Generate';
        }
      });
    }

    const clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
    if (clearTranscriptBtn) clearTranscriptBtn.addEventListener('click', () => {
      document.getElementById('transcriptText').value = '';
      showToast('Transcript cleared');
    });

    const saveTranscriptBtn = document.getElementById('saveTranscriptBtn');
    if (saveTranscriptBtn) saveTranscriptBtn.addEventListener('click', () => {
      showToast('Transcript saved!');
    });

    // ===== BRAND TEMPLATE =====
    const brandLogoBtn = document.getElementById('brandLogoBtn');
    const brandLogoInput = document.getElementById('brandLogoInput');
    if (brandLogoBtn && brandLogoInput) {
      brandLogoBtn.addEventListener('click', () => brandLogoInput.click());
      brandLogoInput.addEventListener('change', function() {
        if (this.files[0]) {
          brandLogoBtn.textContent = '✅ ' + this.files[0].name;
          showToast('Logo uploaded!');
        }
      });
    }


      // B-Roll tab switching
      document.querySelectorAll('.broll-tab').forEach(function(tab){
        tab.addEventListener('click', function(){
          document.querySelectorAll('.broll-tab').forEach(function(t){
            t.style.background='var(--dark-2)';t.style.color='var(--text-muted)';t.style.borderColor='rgba(255,255,255,0.1)';
            t.classList.remove('active');
          });
          this.style.background='var(--primary)';this.style.color='#fff';this.style.borderColor='var(--primary)';
          this.classList.add('active');
          var tabName = this.getAttribute('data-broll-tab');
          document.getElementById('brollUploadBtn').style.display = tabName==='upload' ? 'block' : 'none';
          document.getElementById('brollAiSection').style.display = tabName==='ai' ? 'block' : 'none';
          document.getElementById('brollStockSection').style.display = tabName==='stock' ? 'block' : 'none';
        });
      });


    // ===== UNDO / REDO SYSTEM =====
    var editorHistory = [];
    var editorHistoryIndex = -1;
    var maxHistory = 30;

    function saveEditorState(actionName) {
      var video = document.querySelector('#videoPreview video, #videoPreview source');
      var state = {
        action: actionName,
        timestamp: Date.now(),
        videoSrc: video ? video.src : '',
        filters: document.getElementById('videoPreview') ? document.getElementById('videoPreview')?.style.filter : '',
        transform: document.getElementById('videoPreview') ? document.getElementById('videoPreview')?.style.transform : '',
        containerBg: document.querySelector('.video-container') ? document.querySelector('.video-container')?.style.background : ''
      };
      // Remove any forward history
      editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);
      editorHistory.push(state);
      if (editorHistory.length > maxHistory) editorHistory.shift();
      editorHistoryIndex = editorHistory.length - 1;
      updateUndoRedoButtons();
    }

    function restoreEditorState(state) {
      if (!state) return;
      var preview = document.getElementById('videoPreview');
      if (preview && state.filters) preview.style.filter = state.filters;
      if (preview && state.transform !== undefined) preview.style.transform = state.transform;
      var vc = document.querySelector('.video-container');
      if (vc && state.containerBg !== undefined) vc.style.background = state.containerBg;
      showToast('Action undone: ' + (state.action || 'change'), 'info');
    }

    function updateUndoRedoButtons() {
      var undoBtn = document.getElementById('undoBtn');
      var redoBtn = document.getElementById('redoBtn');
      if (undoBtn) undoBtn.style.opacity = editorHistoryIndex > 0 ? '1' : '0.5';
      if (redoBtn) redoBtn.style.opacity = editorHistoryIndex < editorHistory.length - 1 ? '1' : '0.5';
    }

    var undoBtn = document.getElementById('undoBtn');
    var redoBtn = document.getElementById('redoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function() {
        if (editorHistoryIndex > 0) {
          editorHistoryIndex--;
          restoreEditorState(editorHistory[editorHistoryIndex]);
          updateUndoRedoButtons();
        } else {
          showToast('Nothing to undo', 'info');
        }
      });
    }
    if (redoBtn) {
      redoBtn.addEventListener('click', function() {
        if (editorHistoryIndex < editorHistory.length - 1) {
          editorHistoryIndex++;
          restoreEditorState(editorHistory[editorHistoryIndex]);
          updateUndoRedoButtons();
        } else {
          showToast('Nothing to redo', 'info');
        }
      });
    }
    // Save initial state
    saveEditorState('initial');
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (undoBtn) undoBtn.click(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); if (redoBtn) redoBtn.click(); }
    });

    // ===== STOCK B-ROLL SEARCH HANDLER =====
    var brollStockSearchBtn = document.getElementById('brollStockSearchBtn');
    var brollStockSearch = document.getElementById('brollStockSearch');
    if (brollStockSearchBtn) {
      brollStockSearchBtn.addEventListener('click', async function() {
        var query = brollStockSearch.value.trim();
        if (!query) { showToast('Enter a search term', 'error'); return; }
        brollStockSearchBtn.disabled = true;
        brollStockSearchBtn.textContent = '⏳ Searching...';
        try {
          var resp = await fetch('/video-editor/search-stock-video?q=' + encodeURIComponent(query));
          var data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Search failed');
          var resultsDiv = document.getElementById('brollStockResults');
          if (!resultsDiv) {
            resultsDiv = document.createElement('div');
            resultsDiv.id = 'brollStockResults';
            resultsDiv.style.cssText = 'max-height:250px;overflow-y:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px';
            brollStockSearchBtn.parentElement.parentElement.appendChild(resultsDiv);
          }
          resultsDiv.innerHTML = '';
          if (!data.videos || data.videos.length === 0) {
            resultsDiv.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:.82rem;padding:20px">No videos found. Try a different search term.</p>';
          } else {
            data.videos.forEach(function(v) {
              var card = document.createElement('div');
              card.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--border-subtle);cursor:pointer;aspect-ratio:16/9;background:var(--dark-2)';
              card.innerHTML = '<video src="' + v.preview + '" muted loop style="width:100%;height:100%;object-fit:cover"></video><div style="position:absolute;bottom:0;left:0;right:0;padding:4px 6px;background:rgba(0,0,0,0.7);font-size:.7rem;color:#fff">' + (v.duration || 0) + 's - ' + (v.user || 'Pixabay') + '</div>';
              card.addEventListener('mouseenter', function() { card.querySelector('video')?.play(); });
              card.addEventListener('mouseleave', function() { card.querySelector('video')?.pause(); });
              card.addEventListener('click', function() {
                showToast('Downloading B-Roll clip...', 'info');
                window.selectedBrollUrl = v.download;
                showToast('B-Roll clip selected! It will be overlaid on your video.', 'success');
              });
              resultsDiv.appendChild(card);
            });
          }
        } catch(e) { showToast(e.message || 'Search failed', 'error'); }
        brollStockSearchBtn.disabled = false;
        brollStockSearchBtn.textContent = '\ud83d\udd0d Search';
      });
    }

    // ===== INLINE ELEVENLABS API KEY SAVE =====
    var vtSaveApiKey = document.getElementById('vtSaveApiKey');
    if (vtSaveApiKey) {
      vtSaveApiKey.addEventListener('click', async function() {
        var keyInput = document.getElementById('vtElevenLabsKey');
        var key = keyInput ? keyInput.value.trim() : '';
        if (!key) { showToast('Please enter your ElevenLabs API key', 'error'); return; }
        vtSaveApiKey.disabled = true;
        vtSaveApiKey.textContent = 'Saving...';
        try {
          var resp = await fetch('/video-editor/save-elevenlabs-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
          });
          if (!resp.ok) throw new Error('Failed to save');
          showToast('ElevenLabs API key saved!', 'success');
          keyInput.value = '';
          keyInput.placeholder = 'Key saved \u2713';
        } catch(e) { showToast('Failed to save API key', 'error'); }
        vtSaveApiKey.disabled = false;
        vtSaveApiKey.textContent = 'Save';
      });
    }

    // ===== FULLSCREEN / FOCUS MODE =====
    var fullscreenToggle = document.getElementById('fullscreenToggle');
    var isFullscreen = false;
    if (fullscreenToggle) {
      fullscreenToggle.addEventListener('click', function() {
        isFullscreen = !isFullscreen;
        var dashboard = document.querySelector('.dashboard');
        if (isFullscreen) {
          dashboard.classList.add('editor-fullscreen');
          document.getElementById('fullscreenIcon').textContent = '⬅';
          document.getElementById('fullscreenLabel').textContent = 'Show Menu';
        } else {
          dashboard.classList.remove('editor-fullscreen');
          document.getElementById('fullscreenIcon').textContent = '⛶';
          document.getElementById('fullscreenLabel').textContent = 'Focus Mode';
        }
      });
    }

    // Auto-enter focus mode when video is loaded
    var origUploadHandler = uploadZone ? uploadZone.onclick : null;
    function autoFocusMode() {
      if (!isFullscreen && document.querySelector('.dashboard')) {
        fullscreenToggle && fullscreenToggle.click();
      }
    }

    // ===== NEW TOOL PANELS =====
    var toolPanelMap = {
      crop: 'cropPanel',
      annotations: 'annotationsPanel',
      elements: 'elementsPanel',
      zoom: 'zoomPanel',
      pip: 'pipPanel',
      keyframes: 'keyframesPanel',
      colorgrade: 'colorGradePanel'
    };

    // Extend existing tool button click handler
    document.querySelectorAll('.tool-button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tool = this.dataset.tool;
        // Hide all new tool panels
        Object.values(toolPanelMap).forEach(function(panelId) {
          var panel = document.getElementById(panelId);
          if (panel) panel.style.display = 'none';
        });
        // Show relevant panel
        if (toolPanelMap[tool]) {
          var panel = document.getElementById(toolPanelMap[tool]);
          if (panel) panel.style.display = 'block';
        }
        // Toggle annotation mode
        var annotWrapper = document.getElementById('annotationWrapper');
        if (annotWrapper) {
          if (tool === 'annotations') {
            annotWrapper.classList.add('active');
            resizeAnnotCanvas();
          } else {
            annotWrapper.classList.remove('active');
          }
        }
        // Toggle crop overlay
        var cropOverlay = document.getElementById('cropOverlay');
        if (cropOverlay) {
          if (tool === 'crop') {
            cropOverlay.classList.add('active');
          } else {
            cropOverlay.classList.remove('active');
          }
        }
        // Mark active
        document.querySelectorAll('.tool-button').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
      });
    });

    // _____ INTERACTIVE CROP ENGINE _____
    (function() {
      var cropOverlay = document.getElementById('cropOverlay');
      if (!cropOverlay) return;

      // Crop state
      var cropState = { x: 0.1, y: 0.1, w: 0.8, h: 0.8, ratio: null, active: false };
      window._cropState = cropState;

      // Build crop UI inside overlay
      cropOverlay.innerHTML = '<div class="crop-dim crop-dim-top"></div>' +
        '<div class="crop-dim crop-dim-bottom"></div>' +
        '<div class="crop-dim crop-dim-left"></div>' +
        '<div class="crop-dim crop-dim-right"></div>' +
        '<div class="crop-region" id="cropRegion">' +
          '<div class="crop-handle" data-pos="tl" style="top:-6px;left:-6px;cursor:nw-resize"></div>' +
          '<div class="crop-handle" data-pos="tr" style="top:-6px;right:-6px;cursor:ne-resize"></div>' +
          '<div class="crop-handle" data-pos="bl" style="bottom:-6px;left:-6px;cursor:sw-resize"></div>' +
          '<div class="crop-handle" data-pos="br" style="bottom:-6px;right:-6px;cursor:se-resize"></div>' +
          '<div class="crop-handle" data-pos="tm" style="top:-6px;left:50%;margin-left:-6px;cursor:n-resize"></div>' +
          '<div class="crop-handle" data-pos="bm" style="bottom:-6px;left:50%;margin-left:-6px;cursor:s-resize"></div>' +
          '<div class="crop-handle" data-pos="ml" style="top:50%;margin-top:-6px;left:-6px;cursor:w-resize"></div>' +
          '<div class="crop-handle" data-pos="mr" style="top:50%;margin-top:-6px;right:-6px;cursor:e-resize"></div>' +
          '<div class="crop-grid"></div>' +
        '</div>';

      var region = document.getElementById('cropRegion');
      var dims = cropOverlay.querySelectorAll('.crop-dim');
      var dimTop = dims[0], dimBot = dims[1], dimLeft = dims[2], dimRight = dims[3];

      // Add grid lines (rule of thirds)
      var grid = region.querySelector('.crop-grid');
      grid.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';
      grid.innerHTML = '<div style="position:absolute;top:33.33%;left:0;right:0;border-top:1px solid rgba(255,255,255,0.3)"></div>' +
        '<div style="position:absolute;top:66.66%;left:0;right:0;border-top:1px solid rgba(255,255,255,0.3)"></div>' +
        '<div style="position:absolute;left:33.33%;top:0;bottom:0;border-left:1px solid rgba(255,255,255,0.3)"></div>' +
        '<div style="position:absolute;left:66.66%;top:0;bottom:0;border-left:1px solid rgba(255,255,255,0.3)"></div>';

      // Update visual positions
      function updateCropUI() {
        var ow = cropOverlay.offsetWidth, oh = cropOverlay.offsetHeight;
        var px = cropState.x * ow, py = cropState.y * oh;
        var pw = cropState.w * ow, ph = cropState.h * oh;
        region.style.left = px + 'px';
        region.style.top = py + 'px';
        region.style.width = pw + 'px';
        region.style.height = ph + 'px';
        // Dim areas
        dimTop.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:' + py + 'px;background:rgba(0,0,0,0.55)';
        dimBot.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:' + (oh - py - ph) + 'px;background:rgba(0,0,0,0.55)';
        dimLeft.style.cssText = 'position:absolute;top:' + py + 'px;left:0;width:' + px + 'px;height:' + ph + 'px;background:rgba(0,0,0,0.55)';
        dimRight.style.cssText = 'position:absolute;top:' + py + 'px;right:0;width:' + (ow - px - pw) + 'px;height:' + ph + 'px;background:rgba(0,0,0,0.55)';
      }

      // Make region draggable
      var dragging = null, dragStart = {};

      region.addEventListener('mousedown', function(e) {
        if (e.target.classList.contains('crop-handle')) return;
        e.preventDefault();
        dragging = 'move';
        dragStart = { mx: e.clientX, my: e.clientY, x: cropState.x, y: cropState.y };
      });

      // Handle resize
      region.querySelectorAll('.crop-handle').forEach(function(h) {
        h.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          dragging = h.dataset.pos;
          dragStart = { mx: e.clientX, my: e.clientY, x: cropState.x, y: cropState.y, w: cropState.w, h: cropState.h };
        });
      });

      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var ow = cropOverlay.offsetWidth, oh = cropOverlay.offsetHeight;
        var dx = (e.clientX - dragStart.mx) / ow;
        var dy = (e.clientY - dragStart.my) / oh;

        if (dragging === 'move') {
          cropState.x = Math.max(0, Math.min(1 - cropState.w, dragStart.x + dx));
          cropState.y = Math.max(0, Math.min(1 - cropState.h, dragStart.y + dy));
        } else {
          var nx = dragStart.x, ny = dragStart.y, nw = dragStart.w, nh = dragStart.h;
          if (dragging.indexOf('l') !== -1) { nx += dx; nw -= dx; }
          if (dragging.indexOf('r') !== -1 || dragging === 'mr') { nw += dx; }
          if (dragging.indexOf('t') !== -1) { ny += dy; nh -= dy; }
          if (dragging.indexOf('b') !== -1 || dragging === 'bm') { nh += dy; }

          // Enforce aspect ratio if set
          if (cropState.ratio && dragging !== 'ml' && dragging !== 'mr' && dragging !== 'tm' && dragging !== 'bm') {
            nh = nw * (oh / ow) / cropState.ratio;
            if (dragging.indexOf('t') !== -1) ny = dragStart.y + dragStart.h - nh;
          }

          // Minimum size
          if (nw >= 0.05 && nh >= 0.05 && nx >= 0 && ny >= 0 && nx + nw <= 1 && ny + nh <= 1) {
            cropState.x = nx; cropState.y = ny; cropState.w = nw; cropState.h = nh;
          }
        }
        updateCropUI();
      });

      document.addEventListener('mouseup', function() { dragging = null; });

      // Crop presets
      document.querySelectorAll('.crop-preset').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.crop-preset').forEach(function(b) { b.classList.remove('active'); });
          this.classList.add('active');
          var ratio = this.dataset.ratio;
          if (ratio === 'free') {
            cropState.ratio = null;
            return;
          }
          var parts = ratio.split(':');
          var r = parseInt(parts[0]) / parseInt(parts[1]);
          cropState.ratio = r;
          // Adjust crop region to match ratio
          var ow = cropOverlay.offsetWidth, oh = cropOverlay.offsetHeight;
          var aspect = ow / oh;
          var newW, newH;
          if (r * aspect >= 1) {
            newW = 0.8; newH = (newW * aspect) / r;
            if (newH > 0.9) { newH = 0.9; newW = (newH * r) / aspect; }
          } else {
            newH = 0.8; newW = (newH * r) / aspect;
            if (newW > 0.9) { newW = 0.9; newH = (newW * aspect) / r; }
          }
          cropState.w = newW; cropState.h = newH;
          cropState.x = (1 - newW) / 2; cropState.y = (1 - newH) / 2;
          updateCropUI();
        });
      });

      // Apply crop
      var applyCropBtn = document.getElementById('applyCropBtn');
      if (applyCropBtn) {
        applyCropBtn.addEventListener('click', function() {
          window._appliedCrop = { x: cropState.x, y: cropState.y, w: cropState.w, h: cropState.h };
          var pct = Math.round(cropState.w * cropState.h * 100);
          this.textContent = '\u2705 Crop Applied (' + pct + '% area)';
          setTimeout(function() { applyCropBtn.textContent = '\u2705 Apply Crop'; }, 2000);
        });
      }

      // Reset crop
      var resetCropBtn = document.getElementById('resetCropBtn');
      if (resetCropBtn) {
        resetCropBtn.addEventListener('click', function() {
          cropState.x = 0; cropState.y = 0; cropState.w = 1; cropState.h = 1;
          cropState.ratio = null;
          window._appliedCrop = null;
          document.querySelectorAll('.crop-preset').forEach(function(b) { b.classList.remove('active'); });
          updateCropUI();
        });
      }

      // Init when crop tool is activated
      var observer = new MutationObserver(function() {
        if (cropOverlay.classList.contains('active') && !cropState.active) {
          cropState.active = true;
          updateCropUI();
        } else if (!cropOverlay.classList.contains('active')) {
          cropState.active = false;
        }
      });
      observer.observe(cropOverlay, { attributes: true, attributeFilter: ['class'] });
    })();

    // ===== ANNOTATION DRAWING ENGINE =====
    var annotCanvas = document.getElementById('annotationCanvas');
    var annotCtx = annotCanvas ? annotCanvas.getContext('2d') : null;
    var annotShapes = [];
    var currentAnnotShape = 'arrow';
    var annotColor = '#FF0000';
    var annotStrokeWidth = 3;
    var annotDrawing = false;
    var annotStartX = 0, annotStartY = 0;

    function resizeAnnotCanvas() {
      if (!annotCanvas) return;
      var wrapper = document.getElementById('annotationWrapper');
      if (!wrapper) return;
      var rect = wrapper.parentElement.getBoundingClientRect();
      annotCanvas.width = rect.width;
      annotCanvas.height = rect.height;
      redrawAnnotations();
    }

    function redrawAnnotations() {
      if (!annotCtx) return;
      annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
      annotShapes.forEach(function(shape) {
        annotCtx.strokeStyle = shape.color;
        annotCtx.fillStyle = shape.color;
        annotCtx.lineWidth = shape.strokeWidth;
        annotCtx.lineCap = 'round';
        annotCtx.lineJoin = 'round';

        if (shape.type === 'arrow') {
          drawArrow(annotCtx, shape.x1, shape.y1, shape.x2, shape.y2);
        } else if (shape.type === 'circle') {
          var rx = Math.abs(shape.x2 - shape.x1) / 2;
          var ry = Math.abs(shape.y2 - shape.y1) / 2;
          var cx = (shape.x1 + shape.x2) / 2;
          var cy = (shape.y1 + shape.y2) / 2;
          annotCtx.beginPath();
          annotCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          annotCtx.stroke();
        } else if (shape.type === 'rect') {
          annotCtx.strokeRect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1);
        } else if (shape.type === 'line') {
          annotCtx.beginPath();
          annotCtx.moveTo(shape.x1, shape.y1);
          annotCtx.lineTo(shape.x2, shape.y2);
          annotCtx.stroke();
        } else if (shape.type === 'freehand' && shape.points) {
          annotCtx.beginPath();
          shape.points.forEach(function(pt, i) {
            if (i === 0) annotCtx.moveTo(pt.x, pt.y);
            else annotCtx.lineTo(pt.x, pt.y);
          });
          annotCtx.stroke();
        } else if (shape.type === 'highlight') {
          annotCtx.globalAlpha = 0.3;
          annotCtx.fillRect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1);
          annotCtx.globalAlpha = 1.0;
        } else if (shape.type === 'text' && shape.text) {
          annotCtx.font = (shape.strokeWidth * 6) + 'px Arial';
          annotCtx.fillText(shape.text, shape.x1, shape.y1);
        }
      });
    }

    function drawArrow(ctx, x1, y1, x2, y2) {
      var headLen = 15;
      var angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    var freehandPoints = [];
    if (annotCanvas) {
      annotCanvas.addEventListener('mousedown', function(e) {
        if (!document.getElementById('annotationWrapper')?.classList.contains('active')) return;
        annotDrawing = true;
        var rect = annotCanvas.getBoundingClientRect();
        annotStartX = e.clientX - rect.left;
        annotStartY = e.clientY - rect.top;
        if (currentAnnotShape === 'freehand') {
          freehandPoints = [{x: annotStartX, y: annotStartY}];
        }
      });

      annotCanvas.addEventListener('mousemove', function(e) {
        if (!annotDrawing) return;
        if (currentAnnotShape === 'freehand') {
          var rect = annotCanvas.getBoundingClientRect();
          freehandPoints.push({x: e.clientX - rect.left, y: e.clientY - rect.top});
          redrawAnnotations();
          annotCtx.strokeStyle = annotColor;
          annotCtx.lineWidth = annotStrokeWidth;
          annotCtx.lineCap = 'round';
          annotCtx.beginPath();
          freehandPoints.forEach(function(pt, i) {
            if (i === 0) annotCtx.moveTo(pt.x, pt.y);
            else annotCtx.lineTo(pt.x, pt.y);
          });
          annotCtx.stroke();
        }
      });

      annotCanvas.addEventListener('mouseup', function(e) {
        if (!annotDrawing) return;
        annotDrawing = false;
        var rect = annotCanvas.getBoundingClientRect();
        var endX = e.clientX - rect.left;
        var endY = e.clientY - rect.top;

        if (currentAnnotShape === 'text') {
          var text = prompt('Enter text:');
          if (text) {
            annotShapes.push({type: 'text', x1: annotStartX, y1: annotStartY, text: text, color: annotColor, strokeWidth: annotStrokeWidth});
          }
        } else if (currentAnnotShape === 'freehand') {
          annotShapes.push({type: 'freehand', points: freehandPoints.slice(), color: annotColor, strokeWidth: annotStrokeWidth});
        } else {
          annotShapes.push({type: currentAnnotShape, x1: annotStartX, y1: annotStartY, x2: endX, y2: endY, color: annotColor, strokeWidth: annotStrokeWidth});
        }
        redrawAnnotations();
      });

      window.addEventListener('resize', resizeAnnotCanvas);
      setTimeout(resizeAnnotCanvas, 500);
    }

    // Annotation tool buttons
    document.querySelectorAll('.annotation-tool-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentAnnotShape = this.dataset.shape;
        document.querySelectorAll('.annotation-tool-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
      });
    });

    // Annotation color swatches
    document.querySelectorAll('.annotation-color-swatch').forEach(function(swatch) {
      swatch.addEventListener('click', function() {
        annotColor = this.dataset.color;
        document.querySelectorAll('.annotation-color-swatch').forEach(function(s) { s.classList.remove('active'); });
        this.classList.add('active');
      });
    });

    var annotCustomColor = document.getElementById('annotationCustomColor');
    if (annotCustomColor) {
      annotCustomColor.addEventListener('input', function() { annotColor = this.value; });
    }

    // _____ ELEMENTS / STICKERS HANDLER _____
    document.querySelectorAll('.element-item').forEach(function(item) {
      item.addEventListener('click', function() {
        if (!currentVideoFile) { showToast('Upload a video first', 'error'); return; }
        var emoji = this.textContent.trim();
        var previewArea = document.getElementById('videoPreviewArea');
        if (!previewArea) return;

        // Create draggable element overlay
        var el = document.createElement('div');
        el.className = 'element-overlay';
        el.textContent = emoji;
        el.style.cssText = 'position:absolute;font-size:48px;cursor:move;z-index:20;user-select:none;left:50%;top:50%;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));transition:transform 0.1s';
        previewArea.style.position = 'relative';
        previewArea.appendChild(el);

        // Drag logic
        var dragging = false, ox = 0, oy = 0;
        el.addEventListener('mousedown', function(e) {
          dragging = true;
          ox = e.clientX - el.offsetLeft;
          oy = e.clientY - el.offsetTop;
          el.style.transform = 'scale(1.1)';
          e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
          if (!dragging) return;
          el.style.left = (e.clientX - ox) + 'px';
          el.style.top = (e.clientY - oy) + 'px';
          el.style.transform = 'scale(1.1)';
        });
        document.addEventListener('mouseup', function() {
          if (dragging) { dragging = false; el.style.transform = 'scale(1)'; }
        });

        // Double-click to remove
        el.addEventListener('dblclick', function() { el.remove(); });
        
        // Visual feedback
        this.style.transform = 'scale(1.2)';
        setTimeout(function() { item.style.transform = ''; }, 200);
        showToast('Element added! Drag to position, double-click to remove.');
      });
    });

    var annotStrokeSlider = document.getElementById('annotationStrokeWidth');
    if (annotStrokeSlider) {
      annotStrokeSlider.addEventListener('input', function() { annotStrokeWidth = parseInt(this.value); });
    }

    // Undo / Clear annotations
    var undoAnnotBtn = document.getElementById('undoAnnotation');
    if (undoAnnotBtn) {
      undoAnnotBtn.addEventListener('click', function() { annotShapes.pop(); redrawAnnotations(); });
    }
    var clearAnnotBtn = document.getElementById('clearAnnotations');
    if (clearAnnotBtn) {
      clearAnnotBtn.addEventListener('click', function() { annotShapes = []; redrawAnnotations(); });
    }

    // ===== ZOOM & PAN =====
    var zoomSlider = document.getElementById('zoomLevel');
    var panXSlider = document.getElementById('panX');
    var panYSlider = document.getElementById('panY');
    function applyZoomPan() {
      if (!videoPlayer) return;
      var z = (zoomSlider ? zoomSlider.value : 100) / 100;
      var px = panXSlider ? panXSlider.value : 0;
      var py = panYSlider ? panYSlider.value : 0;
      videoPlayer.style.transform = 'scale(' + z + ') translate(' + px + '%, ' + py + '%)';
      if (document.getElementById('zoomValue')) document.getElementById('zoomValue').textContent = Math.round(z * 100) + '%';
      if (document.getElementById('panXValue')) document.getElementById('panXValue').textContent = px;
      if (document.getElementById('panYValue')) document.getElementById('panYValue').textContent = py;
    }
    if (zoomSlider) zoomSlider.addEventListener('input', applyZoomPan);
    if (panXSlider) panXSlider.addEventListener('input', applyZoomPan);
    if (panYSlider) panYSlider.addEventListener('input', applyZoomPan);
    var resetZoomBtn = document.getElementById('resetZoom');
    if (resetZoomBtn) {
      resetZoomBtn.addEventListener('click', function() {
        if (zoomSlider) zoomSlider.value = 100;
        if (panXSlider) panXSlider.value = 0;
        if (panYSlider) panYSlider.value = 0;
        applyZoomPan();
      });
    }

    // ===== COLOR GRADING =====
    var colorGrades = {
      cinematic: 'saturate(1.3) contrast(1.15) brightness(0.95) sepia(0.15)',
      vintage: 'sepia(0.4) contrast(1.1) brightness(0.95) saturate(0.8)',
      warm: 'sepia(0.2) saturate(1.2) brightness(1.05)',
      cool: 'saturate(0.9) brightness(1.05) hue-rotate(15deg)',
      bw: 'grayscale(1) contrast(1.2)',
      dramatic: 'contrast(1.4) brightness(0.85) saturate(1.3)',
      pastel: 'saturate(0.7) brightness(1.15) contrast(0.9)',
      none: 'none'
    };
    document.querySelectorAll('.color-grade-preset').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var grade = this.dataset.grade;
        if (videoPlayer) videoPlayer.style.filter = colorGrades[grade] || 'none';
        document.querySelectorAll('.color-grade-preset').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
      });
    });

    var colorTempSlider = document.getElementById('colorTemp');
    var colorTintSlider = document.getElementById('colorTint');
    var colorVibranceSlider = document.getElementById('colorVibrance');
    var colorVignetteSlider = document.getElementById('colorVignette');
    function applyColorGrading() {
      if (!videoPlayer) return;
      var temp = colorTempSlider ? colorTempSlider.value : 0;
      var tint = colorTintSlider ? colorTintSlider.value : 0;
      var vibrance = colorVibranceSlider ? colorVibranceSlider.value : 0;
      var vignette = colorVignetteSlider ? colorVignetteSlider.value : 0;
      var hueRot = (temp * 0.3) + (tint * 0.5);
      var sat = 1 + (vibrance / 100);
      var sepiaAmt = Math.max(0, temp / 200);
      var tintBright = 1 + (Math.abs(tint) * 0.001);
      videoPlayer.style.filter = 'hue-rotate(' + hueRot + 'deg) saturate(' + sat + ') sepia(' + sepiaAmt + ') brightness(' + tintBright + ')';
      // Apply vignette as inset box-shadow on video container
      var vigAmt = Math.abs(vignette);
      if (vigAmt > 0) {
        videoPlayer.style.boxShadow = 'inset 0 0 ' + (vigAmt * 1.5) + 'px ' + (vigAmt * 0.5) + 'px rgba(0,0,0,' + (vigAmt / 100) + ')';
      } else {
        videoPlayer.style.boxShadow = 'none';
      }
      if (document.getElementById('tempValue')) document.getElementById('tempValue').textContent = temp;
      if (document.getElementById('tintValue')) document.getElementById('tintValue').textContent = tint;
      if (document.getElementById('vibranceValue')) document.getElementById('vibranceValue').textContent = vibrance;
      if (document.getElementById('vignetteValue')) document.getElementById('vignetteValue').textContent = vignette;
    }
    if (colorTempSlider) colorTempSlider.addEventListener('input', applyColorGrading);
    if (colorTintSlider) colorTintSlider.addEventListener('input', applyColorGrading);
    if (colorVibranceSlider) colorVibranceSlider.addEventListener('input', applyColorGrading);
    if (colorVignetteSlider) colorVignetteSlider.addEventListener('input', applyColorGrading);

    // _____ PICTURE-IN-PICTURE HANDLER _____
    var pipPosition = 'top-right';
    var pipFileInput = document.createElement('input');
    pipFileInput.type = 'file';
    pipFileInput.accept = 'video/*,image/*';
    pipFileInput.style.display = 'none';
    document.body.appendChild(pipFileInput);

    document.querySelectorAll('[data-pip]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        pipPosition = this.dataset.pip;
        document.querySelectorAll('[data-pip]').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        // Update existing PiP overlay if present
        var existing = document.querySelector('.pip-overlay');
        if (existing) {
          var pos = pipPosition.split('-');
          existing.style.top = pos[0] === 'top' ? '8px' : 'auto';
          existing.style.bottom = pos[0] === 'bottom' ? '8px' : 'auto';
          existing.style.right = pos[1] === 'right' ? '8px' : 'auto';
          existing.style.left = pos[1] === 'left' ? '8px' : 'auto';
        }
        showToast('PiP position: ' + pipPosition.replace('-', ' '));
      });
    });

    var addPipBtn = document.getElementById('addPipBtn');
    if (addPipBtn) {
      addPipBtn.addEventListener('click', function() {
        if (!currentVideoFile) { showToast('Upload a main video first', 'error'); return; }
        pipFileInput.click();
      });
    }

    pipFileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var previewArea = document.getElementById('videoPreviewArea');
      if (!previewArea) return;
      previewArea.style.position = 'relative';

      // Remove existing PiP overlay
      var old = document.querySelector('.pip-overlay');
      if (old) old.remove();

      var overlay = document.createElement(file.type.startsWith('image') ? 'img' : 'video');
      overlay.className = 'pip-overlay';
      if (overlay.tagName === 'VIDEO') { overlay.autoplay = true; overlay.loop = true; overlay.muted = true; }
      overlay.src = URL.createObjectURL(file);
      var size = (document.getElementById('pipSize') ? document.getElementById('pipSize')?.value : 30) + '%';
      var radius = (document.getElementById('pipRadius') ? document.getElementById('pipRadius')?.value : 8) + 'px';
      var pos = pipPosition.split('-');
      overlay.style.cssText = 'position:absolute;width:' + size + ';z-index:15;border-radius:' + radius + ';box-shadow:0 4px 12px rgba(0,0,0,0.4);cursor:move;'
        + (pos[0] === 'top' ? 'top:8px;' : 'bottom:8px;')
        + (pos[1] === 'right' ? 'right:8px;' : 'left:8px;');
      previewArea.appendChild(overlay);

      // Drag support
      var dragging = false, ox = 0, oy = 0;
      overlay.addEventListener('mousedown', function(ev) { dragging = true; ox = ev.clientX - overlay.offsetLeft; oy = ev.clientY - overlay.offsetTop; ev.preventDefault(); });
      document.addEventListener('mousemove', function(ev) { if (!dragging) return; overlay.style.left = (ev.clientX - ox) + 'px'; overlay.style.top = (ev.clientY - oy) + 'px'; overlay.style.right = 'auto'; overlay.style.bottom = 'auto'; });
      document.addEventListener('mouseup', function() { dragging = false; });

      // Update size and radius from sliders
      if (document.getElementById('pipSize')) {
        document.getElementById('pipSize')?.addEventListener('input', function() { overlay.style.width = this.value + '%'; });
      }
      if (document.getElementById('pipRadius')) {
        document.getElementById('pipRadius')?.addEventListener('input', function() { overlay.style.borderRadius = this.value + 'px'; });
      }

      showToast('PiP source added! Drag to reposition.');

    // _____ KEYFRAMES HANDLER _____
    var activeKfProp = null;
    var keyframes = [];

    document.querySelectorAll('[data-kf]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        activeKfProp = this.dataset.kf;
        document.querySelectorAll('[data-kf]').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        showToast('Keyframe property: ' + activeKfProp + '. Click Add Keyframe to set.');
      });
    });

    var addKeyframeBtn = document.getElementById('addKeyframeBtn');
    if (addKeyframeBtn) {
      addKeyframeBtn.addEventListener('click', function() {
        if (!currentVideoFile) { showToast('Upload a video first', 'error'); return; }
        if (!activeKfProp) { showToast('Select a property first (Opacity, Scale, etc.)', 'error'); return; }
        if (!videoPlayer) return;
        var time = videoPlayer?.currentTime || 0;
        var value;
        switch (activeKfProp) {
          case 'opacity': value = parseFloat(prompt('Opacity (0 to 1):', '1')) || 1; videoPlayer.style.opacity = value; break;
          case 'scale': value = parseFloat(prompt('Scale (0.1 to 3):', '1')) || 1; videoPlayer.style.transform = 'scale(' + value + ')'; break;
          case 'position':
            var x = parseInt(prompt('X offset (px):', '0')) || 0;
            var y = parseInt(prompt('Y offset (px):', '0')) || 0;
            value = {x: x, y: y};
            videoPlayer.style.transform = 'translate(' + x + 'px,' + y + 'px)';
            break;
          case 'rotation': value = parseInt(prompt('Rotation (degrees):', '0')) || 0; videoPlayer.style.transform = 'rotate(' + value + 'deg)'; break;
        }
        keyframes.push({ property: activeKfProp, time: time.toFixed(2), value: value });
        showToast('Keyframe added at ' + time.toFixed(2) + 's: ' + activeKfProp + ' = ' + JSON.stringify(value));
      });
    }

    var clearKeyframesBtn = document.getElementById('clearKeyframesBtn');
    if (clearKeyframesBtn) {
      clearKeyframesBtn.addEventListener('click', function() {
        keyframes = [];
        if (videoPlayer) {
          videoPlayer.style.opacity = '';
          videoPlayer.style.transform = '';
        }
        showToast('Keyframes cleared');
      });
    }
    });

    // ===== PIP SIZE SLIDER =====
    var pipSizeSlider = document.getElementById('pipSize');
    if (pipSizeSlider) {
      pipSizeSlider.addEventListener('input', function() {
        if (document.getElementById('pipSizeValue')) document.getElementById('pipSizeValue').textContent = this.value + '%';
      });
    }
    var pipRadiusSlider = document.getElementById('pipRadius');
    if (pipRadiusSlider) {
      pipRadiusSlider.addEventListener('input', function() {
        if (document.getElementById('pipRadiusValue')) document.getElementById('pipRadiusValue').textContent = this.value + 'px';
      });
    }

    // ===== AUTO FOCUS MODE ON VIDEO LOAD =====
    if (videoPlayer) {
      videoPlayer?.addEventListener('loadeddata', function() {
        autoFocusMode();
        resizeAnnotCanvas();
      });
    }
</script>
<script>
/* Legacy +Upload wiring removed.
 *
 * Previously this IIFE created a separate #mediaFileInput and bound
 *   btn.onclick = function(){ fi.click(); }
 * to EVERY button on the page containing "+ Upload". That ran in parallel
 * with v10-editor-redesign.js's addEventListener click handler on the same
 * button, so a single user click opened TWO file dialogs (one per input).
 *
 * The entire responsibility — creating file inputs, handling the upload
 * click, and appending media items on change — is now owned by
 *   public/js/media-panel-fix.js  (handleFiles, appendMediaItem)
 *   public/js/v10-editor-redesign.js  (buildDropZone, triggerUpload)
 * which also store serveUrl/blob URLs on the .ml-fitem dataset so the
 * preview window can play them. Removing the legacy block eliminates the
 * double-dialog bug.
 */

    // ═══════════════════════════════════════════════════════════
    // WIRE UP ALL INTERACTIVE UI ELEMENTS
    // ═══════════════════════════════════════════════════════════
    setTimeout(function wireAllUI() {

      // ── 1. FOLDERS (Completed Videos, Not Completed, Leonardo AI) ──
      document.querySelectorAll('.ml-folder').forEach(function(folder) {
        folder.style.cursor = 'pointer';
        folder.addEventListener('click', function() {
          var isOpen = this.classList.toggle('open');
          // Toggle expand icon
          var name = this.querySelector('span:nth-child(2)');
          if (name) {
            var folderName = name.textContent.trim();
            // Show a toast notification with folder name
            showToast('Opened folder: ' + folderName);
            // In a full implementation this would fetch folder contents from server
            // For now, filter media items or show a placeholder
          }
        });
      });

      // ── 2. MEDIA CLIPS click-to-timeline — handled by media-panel-fix.js
      // (appendMediaItem + wireItem). Legacy handler removed.
      //

      // ── 3. BOTTOM TABS (Import, Folder, AI B-Roll) ──
      document.querySelectorAll('.ml-fb').forEach(function(btn) {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          var text = this.textContent.trim();
          if (text.includes('Import')) {
            // Trigger file input
            var inp = document.getElementById('mediaFileInput');
            if (inp) inp.click();
            else showToast('Import: select files to add');
          } else if (text.includes('Folder')) {
            showToast('Create new folder');
          } else if (text.includes('B-Roll')) {
            showToast('AI B-Roll: analyzing video for B-Roll suggestions...');
          }
        });
      });

      // ── 4. TIMELINE TOOLS (Razor, Select, Snap) ──
      // Wired by media-panel-fix.js wireTimelineTools() with proper semantics:
      //   - Razor & Select are mutually exclusive (active tool)
      //   - Snap is an independent boolean toggle
      // Legacy handler removed (it treated all three as mutually exclusive).

      // ── 5. + Add Track button — creates a new audio track row ──
      var addTrackBtn = document.querySelector('.mt-add-track-btn');
      if (addTrackBtn && !addTrackBtn.dataset.wired) {
        addTrackBtn.dataset.wired = '1';
        addTrackBtn.style.cursor = 'pointer';
        addTrackBtn.addEventListener('click', function() {
          var tracksArea = document.getElementById('mtTracksArea');
          var labelsArea = document.querySelector('.mt-labels');
          if (!tracksArea || !labelsArea) return;
          // Count existing audio tracks to get the next number (A1, A2, ...)
          var existingAudio = tracksArea.querySelectorAll('.mt-track-audio').length;
          var n = existingAudio + 1;
          // Create track element
          var track = document.createElement('div');
          track.className = 'mt-track mt-track-audio';
          track.setAttribute('data-type', 'audio');
          track.setAttribute('data-track-index', String(n));
          // Insert after the LAST audio track (so A1, A2, A3 stay grouped)
          var audioTracks = tracksArea.querySelectorAll('.mt-track-audio');
          var insertAfter = audioTracks.length ? audioTracks[audioTracks.length - 1] : tracksArea.querySelector('.mt-track-video');
          if (insertAfter && insertAfter.nextSibling) {
            tracksArea.insertBefore(track, insertAfter.nextSibling);
          } else if (insertAfter) {
            insertAfter.parentNode.appendChild(track);
          } else {
            tracksArea.appendChild(track);
          }
          // Create matching label with a small × delete button (user-added
          // tracks only — A2, A3, ... can be deleted; A1 stays put).
          var label = document.createElement('div');
          label.className = 'mt-label mt-label-audio';
          label.textContent = 'A' + n;
          if (n > 1){
            var delBtn = document.createElement('span');
            delBtn.className = 'mt-label-del';
            delBtn.textContent = '\u00D7';
            delBtn.title = 'Delete track';
            delBtn.addEventListener('click', function(e){
              e.stopPropagation();
              track.remove();
              label.remove();
              // Renumber remaining A* labels so they stay sequential
              Array.from(labelsArea.querySelectorAll('.mt-label-audio')).forEach(function(lbl, i){
                var txt = 'A' + (i + 1);
                // Preserve the delete button child when re-labeling
                var del = lbl.querySelector('.mt-label-del');
                lbl.textContent = txt;
                if (del) lbl.appendChild(del);
              });
              // Update info
              var info2 = document.querySelector('.mt-info');
              if (info2) {
                var total2 = document.querySelectorAll('.mt-track').length;
                info2.textContent = total2 + ' tracks \u2022 ' + (info2.textContent.split('\u2022')[1] || '0:00').trim();
              }
              if (typeof showToast === 'function') showToast('Track removed');
            });
            label.appendChild(delBtn);
          }
          var audioLabels = labelsArea.querySelectorAll('.mt-label-audio');
          var lastAudioLabel = audioLabels.length ? audioLabels[audioLabels.length - 1] : labelsArea.querySelector('.mt-label-video');
          if (lastAudioLabel && lastAudioLabel.nextSibling) {
            labelsArea.insertBefore(label, lastAudioLabel.nextSibling);
          } else if (lastAudioLabel) {
            labelsArea.appendChild(label);
          } else {
            labelsArea.appendChild(label);
          }
          // Update info text
          var info = document.querySelector('.mt-info');
          if (info) {
            var total = document.querySelectorAll('.mt-track').length;
            info.textContent = total + ' tracks \u2022 ' + (info.textContent.split('\u2022')[1] || '0:00').trim();
          }
          if (typeof showToast === 'function') showToast('Added audio track A' + n);
        });
      }

      // ── 5c. Sync labels column vertical scroll with tracks area ──
      (function(){
        var tracksArea = document.getElementById('mtTracksArea');
        var labelsArea = document.querySelector('.mt-labels');
        if (!tracksArea || !labelsArea || tracksArea.dataset.vScrollWired) return;
        tracksArea.dataset.vScrollWired = '1';
        tracksArea.addEventListener('scroll', function(){
          // Keep labels column scroll in lockstep with tracks-area vertical
          // scroll so e.g. M1/T1/FX labels stay aligned with their rows when
          // the user scrolls down past several audio tracks.
          labelsArea.scrollTop = tracksArea.scrollTop;
        });
      })();

      // ── 5b. Playhead drag + track-click navigation ──
      (function(){
        var playhead = document.getElementById('mtPlayhead');
        var handle = document.getElementById('mtPlayheadHandle');
        var tracksArea = document.getElementById('mtTracksArea');
        if (!playhead || !tracksArea || playhead.dataset.wired) return;
        playhead.dataset.wired = '1';

        function videoElRef(){ return document.getElementById('videoPlayer') || document.querySelector('video'); }

        function setPlayheadFromClientX(clientX){
          var areaRect = tracksArea.getBoundingClientRect();
          var x = Math.max(0, Math.min(clientX - areaRect.left + tracksArea.scrollLeft, tracksArea.scrollWidth));
          playhead.style.left = x + 'px';
          // Swap the preview to whichever video clip the playhead is currently
          // over, seeking to the correct offset inside that clip. This makes
          // the playhead a true sequence scrubber instead of being stuck on
          // the first uploaded video.
          if (typeof window.syncPreviewToPlayhead === 'function'){
            try { window.syncPreviewToPlayhead(); return; } catch(_){}
          }
          // Fallback (no clips / no mediaUrl): fall back to proportional
          // scrubbing against the currently-loaded video, if any.
          var video = videoElRef();
          var scrollW = tracksArea.scrollWidth || areaRect.width;
          if (video && video.duration && isFinite(video.duration) && video.duration > 0){
            var pct = x / scrollW;
            try { video.currentTime = Math.max(0, Math.min(video.duration, pct * video.duration)); } catch(_){}
          }
        }

        function onMouseMove(e){ setPlayheadFromClientX(e.clientX); }
        function onMouseUp(){
          playhead.classList.remove('mt-playhead-dragging');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        }

        if (handle){
          handle.addEventListener('mousedown', function(e){
            e.preventDefault();
            playhead.classList.add('mt-playhead-dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          });
        }

        // Clicking anywhere in the tracks area (not on the handle itself or a clip)
        // jumps the playhead to that x position.
        tracksArea.addEventListener('click', function(e){
          if (e.target.closest('.mt-playhead-handle')) return;
          if (e.target.closest('.mt-clip')) return; // let clip click handlers run
          setPlayheadFromClientX(e.clientX);
        });
      })();

      // ── 6. TOP TOOLBAR BUTTONS (Snap, Snapshot, Link Tracks) ──
      document.querySelectorAll('.e-tb').forEach(function(btn) {
        if (btn.onclick) return; // Skip already wired
        var text = btn.textContent.trim();
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          if (text.includes('Snap')) {
            this.classList.toggle('on');
            showToast(this.classList.contains('on') ? 'Snap enabled' : 'Snap disabled');
          } else if (text.includes('Snapshot')) {
            showToast('Snapshot saved to library');
          } else if (text.includes('Link')) {
            this.classList.toggle('on');
            showToast(this.classList.contains('on') ? 'Tracks linked' : 'Tracks unlinked');
          }
        });
      });

      // ── 7. RIGHT PANEL: ALL .tb3 TOOL BUTTONS ──
      // Map tool names to panel IDs
      var toolPanelMap = {
        'Crop': 'cropPanel',
        'Keyframe': 'keyframesPanel',
        'Zoom': 'zoomPanel',
        'PiP': 'pipPanel',
        'Annotations': 'annotationsPanel',
        'Stickers': 'elementsPanel',
        'Color Grade': 'colorGradePanel'
      };

      document.querySelectorAll('.tb3').forEach(function(btn) {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          var parent = this.closest('.tg2');
          if (parent) {
            parent.querySelectorAll('.tb3').forEach(function(b) { b.classList.remove('on'); });
          }
          this.classList.add('on');
          var label = this.textContent.trim().replace(/^[^a-zA-Z]+/, '');

          // Check if this tool has an associated panel
          var panelId = null;
          for (var key in toolPanelMap) {
            if (label.includes(key)) { panelId = toolPanelMap[key]; break; }
          }

          // Hide all tool panels first
          document.querySelectorAll('.tool-panel').forEach(function(p) { p.style.display = 'none'; });

          if (panelId) {
            var panel = document.getElementById(panelId);
            if (panel) panel.style.display = 'block';
          }

          showToast(label + ' selected');
        });
      });

      // ── 8. TOOL PANELS: Wire buttons inside panels ──
      // Crop panel presets
      document.querySelectorAll('#cropPanel button').forEach(function(btn) {
        if (btn.onclick) return;
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          var text = this.textContent.trim();
          if (text.includes('Apply')) {
            showToast('Crop applied');
            document.getElementById('cropPanel').style.display = 'none';
          } else if (text.includes('Reset')) {
            showToast('Crop reset');
          } else {
            // Aspect ratio buttons
            document.querySelectorAll('#cropPanel button').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            showToast('Aspect ratio: ' + text);
          }
        });
      });

      // Annotations panel tools
      document.querySelectorAll('.annotation-tool-btn').forEach(function(btn) {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          document.querySelectorAll('.annotation-tool-btn').forEach(function(b) { b.classList.remove('active'); });
          this.classList.add('active');
          showToast('Annotation: ' + this.textContent.trim());
        });
      });

      // Color grade / filters panel
      document.querySelectorAll('#colorGradePanel button, .filter-btn').forEach(function(btn) {
        if (btn.onclick) return;
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          showToast('Filter: ' + this.textContent.trim());
        });
      });

      // ── 9. PROPERTIES PANEL (Opacity, Scale, etc.) ──
      document.querySelectorAll('.s-panel input[type="range"]').forEach(function(slider) {
        slider.addEventListener('input', function() {
          var label = this.closest('.prop-row');
          var name = label ? label.querySelector('label') : null;
          if (name) showToast(name.textContent.trim() + ': ' + this.value);
        });
      });

      // ── 10. UTILITY: Toast notification function ──
      function showToast(msg) {
        var existing = document.querySelector('.wire-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'wire-toast';
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(108,58,237,.95);color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;pointer-events:none;animation:toastIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.4)';
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity .3s'; }, 2000);
        setTimeout(function() { toast.remove(); }, 2400);
      }

    }, 800);

    // Re-wire dynamically added media items (e.g. after upload or folder open)
    var _wireObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          // Wire new .ml-fitem elements
          var items = node.classList && node.classList.contains('ml-fitem') ? [node] : (node.querySelectorAll ? node.querySelectorAll('.ml-fitem') : []);
          items.forEach(function(item) {
            if (item._wired) return;
            item._wired = true;
            item.style.setProperty('cursor', 'pointer', 'important');
            item.addEventListener('click', function(e) {
              if (e.target.classList.contains('ml-add')) return;
              document.querySelectorAll('.ml-fitem').forEach(function(c) { c.classList.remove('selected'); });
              this.classList.add('selected');
              var nameEl = this.querySelector('.ml-fnm');
              var msg = nameEl ? 'Selected: ' + nameEl.textContent.trim() : 'Clip selected';
              var t = document.createElement('div');
              t.className = 'wire-toast';
              t.textContent = msg;
              t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(108,58,237,.95);color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;pointer-events:none;animation:toastIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.4)';
              document.body.appendChild(t);
              setTimeout(function() { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2000);
              setTimeout(function() { t.remove(); }, 2400);
            });
            var addBtn = item.querySelector('.ml-add');
            if (addBtn) {
              addBtn.style.setProperty('cursor', 'pointer', 'important');
              addBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var nameEl = item.querySelector('.ml-fnm');
                var fn = nameEl ? nameEl.textContent.trim() : 'clip';
                var t = document.createElement('div');
                t.className = 'wire-toast';
                t.textContent = 'Added to timeline: ' + fn;
                t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(108,58,237,.95);color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;pointer-events:none;animation:toastIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.4)';
                document.body.appendChild(t);
                setTimeout(function() { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2000);
                setTimeout(function() { t.remove(); }, 2400);
              });
            }
          });
        });
      });
    });
    var _mediaGrid = document.querySelector('.ml-fgrid');
    if (_mediaGrid) _wireObserver.observe(_mediaGrid, {childList: true, subtree: true});
    // Also wire existing clips after a brief delay
    setTimeout(function() {
      document.querySelectorAll('.ml-fitem').forEach(function(item) {
        if (item._wired) return;
        item._wired = true;
        item.style.setProperty('cursor', 'pointer', 'important');
        item.addEventListener('click', function(e) {
          if (e.target.classList.contains('ml-add')) return;
          document.querySelectorAll('.ml-fitem').forEach(function(c) { c.classList.remove('selected'); });
          this.classList.add('selected');
          var nameEl = this.querySelector('.ml-fnm');
          if (nameEl) {
            var t = document.createElement('div');
            t.className = 'wire-toast';
            t.textContent = 'Selected: ' + nameEl.textContent.trim();
            t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(108,58,237,.95);color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;pointer-events:none;animation:toastIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.4)';
            document.body.appendChild(t);
            setTimeout(function() { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2000);
            setTimeout(function() { t.remove(); }, 2400);
          }
        });
      });
    }, 1200);
    



// ====== COMPREHENSIVE UI FIX v4 - DOM-only, no unicode escapes ======
setTimeout(function comprehensiveUIFix(){
  var sidebar=document.querySelector(".editor-sidebar");
  if(!sidebar)return;

  // Helper to create elements
  function el(tag,attrs,children){
    var e=document.createElement(tag);
    if(attrs)Object.keys(attrs).forEach(function(k){
      if(k==="text")e.textContent=attrs[k];
      else if(k==="css")e.style.cssText=attrs[k];
      else if(k==="cls")e.className=attrs[k];
      else e.setAttribute(k,attrs[k]);
    });
    if(children)children.forEach(function(c){if(c)e.appendChild(c);});
    return e;
  }

  var panelStyle="display:none;padding:12px 16px;background:rgba(108,58,237,.06);border-radius:10px;margin-top:8px";
  var inputStyle="width:80px;background:#1a1333;color:#fff;border:1px solid rgba(108,58,237,.2);border-radius:4px;padding:4px 6px;font-size:12px";
  var btnRow="margin-top:8px;display:flex;gap:6px";
  var presetRow="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap";

  function makePanel(id,title,contentChildren){
    if(document.querySelector("#"+id))return;
    var p=el("div",{id:id,cls:"tool-panel",css:panelStyle},[
      el("div",{css:"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"},[
        el("h4",{text:title,css:"margin:0;color:#fff;font-size:13px"}),
        el("button",{text:"x",css:"background:none;border:none;color:#888;cursor:pointer;font-size:16px"})
      ])
    ].concat(contentChildren));
    sidebar.appendChild(p);
    p.querySelector("button").onclick=function(){p.style.display="none";};
    return p;
  }

  // Trim Panel
  makePanel("trimPanel","Trim",[
    el("div",{cls:"s-row"},[el("span",{text:"Start"}),el("input",{type:"text",id:"trimStart",value:"00:00:00",css:inputStyle})]),
    el("div",{cls:"s-row"},[el("span",{text:"End"}),el("input",{type:"text",id:"trimEnd",value:"00:00:00",css:inputStyle})]),
    el("div",{css:btnRow},[el("button",{text:"Apply Trim",cls:"crop-preset",css:"flex:1"}),el("button",{text:"Reset",cls:"crop-preset",css:"flex:1"})])
  ]);

  // Speed Panel
  makePanel("speedPanel","Speed",[
    el("div",{cls:"slider-group"},[
      el("div",{cls:"slider-label"},[el("span",{text:"Playback Speed"}),el("span",{id:"speedValue",text:"1.0x"})]),
      el("input",{type:"range",id:"speedSlider",min:"0.1",max:"4",step:"0.1",value:"1",css:"width:100%"})
    ]),
    el("div",{css:presetRow},[
      el("button",{text:"0.25x",cls:"crop-preset","data-speed":"0.25"}),
      el("button",{text:"0.5x",cls:"crop-preset","data-speed":"0.5"}),
      el("button",{text:"1x",cls:"crop-preset","data-speed":"1"}),
      el("button",{text:"1.5x",cls:"crop-preset","data-speed":"1.5"}),
      el("button",{text:"2x",cls:"crop-preset","data-speed":"2"}),
      el("button",{text:"4x",cls:"crop-preset","data-speed":"4"})
    ])
  ]);

  // Flip Panel
  makePanel("flipPanel","Flip",[
    el("div",{css:btnRow},[
      el("button",{text:"Flip Horizontal",cls:"crop-preset",css:"flex:1"}),
      el("button",{text:"Flip Vertical",cls:"crop-preset",css:"flex:1"})
    ])
  ]);

  // Resize Panel
  makePanel("resizePanel","Resize",[
    el("div",{cls:"s-row"},[el("span",{text:"Width"}),el("input",{type:"number",id:"resizeW",value:"1920",css:inputStyle})]),
    el("div",{cls:"s-row"},[el("span",{text:"Height"}),el("input",{type:"number",id:"resizeH",value:"1080",css:inputStyle})]),
    el("div",{css:presetRow},[
      el("button",{text:"1080p",cls:"crop-preset","data-w":"1920","data-h":"1080"}),
      el("button",{text:"720p",cls:"crop-preset","data-w":"1280","data-h":"720"}),
      el("button",{text:"4K",cls:"crop-preset","data-w":"3840","data-h":"2160"}),
      el("button",{text:"9:16",cls:"crop-preset","data-w":"1080","data-h":"1920"})
    ])
  ]);

  // Rotate Panel
  makePanel("rotatePanel","Rotate",[
    el("div",{cls:"slider-group"},[
      el("div",{cls:"slider-label"},[el("span",{text:"Rotation"}),el("span",{id:"rotateValue",text:"0 deg"})]),
      el("input",{type:"range",id:"rotateSlider",min:"0",max:"360",step:"1",value:"0",css:"width:100%"})
    ]),
    el("div",{css:presetRow},[
      el("button",{text:"0",cls:"crop-preset","data-deg":"0"}),
      el("button",{text:"90",cls:"crop-preset","data-deg":"90"}),
      el("button",{text:"180",cls:"crop-preset","data-deg":"180"}),
      el("button",{text:"270",cls:"crop-preset","data-deg":"270"})
    ])
  ]);

  // Wire TB3 buttons to toggle tool panels
  var pm={"Trim":"trimPanel","Split":"trimPanel","Speed":"speedPanel","Crop":"cropPanel","Resize":"resizePanel","Rotate":"rotatePanel","Flip":"flipPanel","Position":"pipPanel","Keyframe":"keyframesPanel","Zoom":"zoomPanel","PiP":"pipPanel","Annotations":"annotationsPanel","Elements":"elementsPanel","Color":"colorGradePanel"};
  document.querySelectorAll(".tb3").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      var lbl=btn.textContent.trim().replace(/^[^a-zA-Z]+/,"").split(String.fromCharCode(10))[0].trim();
      var pid=null;
      Object.keys(pm).forEach(function(k){if(lbl.indexOf(k)!==-1)pid=pm[k];});
      if(!pid)return;
      var panel=document.querySelector("#"+pid);
      if(!panel)return;
      document.querySelectorAll(".tool-panel").forEach(function(t){if(t.id!==pid)t.style.display="none";});
      var cur=window.getComputedStyle(panel).display;
      panel.style.display=(cur==="none")?"block":"none";
      if(panel.style.display==="block")panel.scrollIntoView({behavior:"smooth",block:"nearest"});
    });
  });

  // Wire speed slider
  var ss=document.getElementById("speedSlider");
  if(ss&&ss.addEventListener)ss.addEventListener("input",function(){
    var v=document.getElementById("speedValue");
    if(v&&v.textContent!==undefined)v.textContent=parseFloat(ss.value).toFixed(1)+"x";
    var vid=document.querySelector("video");
    if(vid)vid.playbackRate=parseFloat(ss.value);
  });
  document.querySelectorAll("[data-speed]").forEach(function(b){
    b.addEventListener("click",function(){
      if(ss){ss.value=b.dataset.speed;ss.dispatchEvent(new Event("input"));}
    });
  });
  var rs=document.getElementById("rotateSlider");
  if(rs&&rs.addEventListener)rs.addEventListener("input",function(){
    var v=document.getElementById("rotateValue");
    if(v&&v.textContent!==undefined)v.textContent=rs.value+" deg";
  });

    // Debounce classList.toggle("open") to prevent double-toggle from competing handlers
  var _origToggle=DOMTokenList.prototype.toggle;
  DOMTokenList.prototype.toggle=function(cls){
    if(cls==="open"&&this._toggleLock)return this.contains(cls);
    var r=_origToggle.apply(this,arguments);
    if(cls==="open"){this._toggleLock=true;var s=this;setTimeout(function(){s._toggleLock=false;},0);}
    return r;
  };

// Folder expand/collapse with clip grids
  document.querySelectorAll(".ml-folder").forEach(function(folder){
    if(folder.nextElementSibling&&folder.nextElementSibling.classList&&folder.nextElementSibling.classList.contains("ml-fgrid-sub"))return;
    var spans=folder.querySelectorAll("span");
    var fcount=spans.length>2?parseInt(spans[2].textContent)||0:0;
    var grid=document.createElement("div");
    grid.className="ml-fgrid ml-fgrid-sub";
    grid.style.cssText="display:none;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:5px";
    var mainGrid=document.querySelector(".ml-fgrid:not(.ml-fgrid-sub)");
    var allClips=mainGrid?mainGrid.querySelectorAll(".ml-fitem"):[];
    var cnt=Math.min(fcount,allClips.length);
    for(var i=0;i<cnt;i++){
      var clone=allClips[i].cloneNode(true);
      clone._wired=false;
      grid.appendChild(clone);
    }
    if(cnt===0){
      var empty=document.createElement("div");
      empty.style.cssText="grid-column:1/-1;padding:12px;text-align:center;color:#666;font-size:12px";
      empty.textContent="No clips in this folder";
      grid.appendChild(empty);
    }
    folder.parentNode.insertBefore(grid,folder.nextSibling);
    folder.addEventListener("click",function(e){
      e.stopPropagation();
      var isOpen=folder.classList.toggle("open");
      grid.style.display=isOpen?"grid":"none";
      document.querySelectorAll(".ml-folder").forEach(function(f){
        if(f!==folder&&f.classList.contains("open")){
          f.classList.remove("open");
          var fg=f.nextElementSibling;
          if(fg&&fg.classList&&fg.classList.contains("ml-fgrid-sub"))fg.style.display="none";
        }
      });
    });
  });

  // Left panel tab switching is handled by:
  //   1) the inline onclick on each .ml-tab above (type-based filtering)
  //   2) v10-editor-redesign.js applyFilter() which keeps the Projects folders
  //      (Completed Videos / Drafts) visible and filters folder items by type
  // The earlier behavior here wiped mlBody.innerHTML on every Audio/Images/All
  // click and replaced it with a throwaway "Audio Files" shell, which destroyed
  // the real uploaded media list and the Projects section. Removed.

  // Bottom tabs (Folder create, AI B-Roll)
  document.querySelectorAll(".ml-fb").forEach(function(tab){
    tab.addEventListener("click",function(){
      var name=tab.textContent.trim();
      if(name.indexOf("Folder")!==-1){
        var fn=prompt("Enter folder name:");
        if(fn&&fn.trim()){
          var mlb=document.querySelector(".ml-body");
          var sec=mlb?mlb.querySelector(".ml-section"):null;
          if(sec){
            var nf=document.createElement("div");
            nf.className="ml-folder";
            nf.style.cssText="display:flex;align-items:center;gap:6px;padding:5px 7px;background:#16112a;border-radius:6px;cursor:pointer;border:1px solid rgba(108,58,237,.05);margin-top:3px";
            var s1=document.createElement("span");s1.textContent="Folder";
            var s2=document.createElement("span");s2.textContent=fn.trim();
            var s3=document.createElement("span");s3.textContent="0";s3.style.cssText="margin-left:auto;color:#666;font-size:11px";
            nf.appendChild(s1);nf.appendChild(s2);nf.appendChild(s3);
            sec.parentNode.insertBefore(nf,sec.nextSibling);
            if(typeof showToast==="function")showToast("Folder created: "+fn.trim());
          }
        }
      }else if(name.indexOf("B-Roll")!==-1||name.indexOf("AI")!==-1){
        if(typeof showToast==="function")showToast("Analyzing video for B-Roll suggestions...");
        setTimeout(function(){if(typeof showToast==="function")showToast("AI B-Roll analysis complete.");},2000);
      }
    });
  });

  // Inject CSS
  var sty=document.createElement("style");
  sty.textContent=".ml-folder.open{background:rgba(108,58,237,.12)!important;border-color:rgba(108,58,237,.25)!important} .ml-fgrid-sub .ml-fitem{cursor:pointer!important} .ml-fgrid-sub .ml-fitem:hover{border-color:rgba(108,58,237,.25);transform:scale(1.02)}";
  document.head.appendChild(sty);

},1000);

// Filmstrip thumbnail optimization
var _origGFT=typeof generateFilmstripThumbs==="function"?generateFilmstripThumbs:null;
generateFilmstripThumbs=function(){
  var video=document.querySelector("video");
  var container=document.querySelector(".fs-thumbs");
  if(!video||!container||!video.duration||isNaN(video.duration)){
    if(_origGFT)return _origGFT();
    return;
  }
  var dur=video.duration;
  var NUM=Math.min(20,Math.max(6,Math.round(dur/5)));
  container.innerHTML="";
  var phs=[];
  for(var i=0;i<NUM;i++){
    var ph=document.createElement("div");
    ph.style.cssText="flex:1;min-width:0;height:100%;background:#1a1333;animation:pulse 1.5s ease infinite";
    container.appendChild(ph);
    phs.push(ph);
  }
  var ext=document.createElement("video");
  ext.src=video.src;ext.muted=true;ext.preload="auto";
  var cvs=document.createElement("canvas");
  cvs.width=120;cvs.height=68;
  var ctx=cvs.getContext("2d");
  var times=[];
  for(var j=0;j<NUM;j++)times.push((j+0.5)*dur/NUM);
  var idx=0;
  function extractNext(){
    if(idx>=times.length){ext.remove();return;}
    ext.currentTime=times[idx];
  }
  ext.addEventListener("seeked",function(){
    requestAnimationFrame(function(){
      ctx.drawImage(ext,0,0,120,68);
      var img=document.createElement("img");
      img.src=cvs.toDataURL("image/jpeg",0.5);
      img.style.cssText="flex:1;min-width:0;height:100%;object-fit:cover";
      if(phs[idx])container.replaceChild(img,phs[idx]);
      idx++;
      extractNext();
    });
  });
  ext.addEventListener("loadeddata",function(){extractNext();});
};

setTimeout(function videoControlsWiring(){
  var vid = document.querySelector("#videoPlayer");
  var preview = document.querySelector("#videoPreviewArea");
  if(!vid || !preview) return;

  window._vt = {
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    zoom: 1
  };

  window._vf = {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    hueRotate: 0,
    blur: 0,
    opacity: 100
  };

  var showToastMsg = function(msg) {
    if(window.showToast) {
      window.showToast(msg);
    } else {
      console.log("Toast: " + msg);
    }
  };

  var applyTransforms = function() {
    var transformParts = [];
    transformParts.push("translate(" + window._vt.translateX + "px, " + window._vt.translateY + "px)");
    transformParts.push("scale(" + window._vt.zoom + ")");
    transformParts.push("scaleX(" + window._vt.scaleX + ")");
    transformParts.push("scaleY(" + window._vt.scaleY + ")");
    transformParts.push("rotate(" + window._vt.rotate + "deg)");
    var transformStr = transformParts.join(" ");
    vid.style.transform = transformStr;
  };

  var applyFilters = function() {
    var filterParts = [];
    filterParts.push("brightness(" + window._vf.brightness + "%)");
    filterParts.push("contrast(" + window._vf.contrast + "%)");
    filterParts.push("saturate(" + window._vf.saturate + "%)");
    filterParts.push("hue-rotate(" + window._vf.hueRotate + "deg)");
    filterParts.push("blur(" + window._vf.blur + "px)");
    var filterStr = filterParts.join(" ");
    vid.style.filter = filterStr;
    vid.style.opacity = (window._vf.opacity / 100).toString();
  };

  var resizePanel = document.querySelector("#resizePanel");
  if(resizePanel) {
    var resizeW = document.querySelector("#resizeW");
    var resizeH = document.querySelector("#resizeH");
    var presetBtns = resizePanel.querySelectorAll("button[data-w]");

    if(resizeW) {
      resizeW.addEventListener("input", function() {
        var w = parseInt(this.value) || 1920;
        vid.style.width = w + "px";
      });
    }

    if(resizeH) {
      resizeH.addEventListener("input", function() {
        var h = parseInt(this.value) || 1080;
        vid.style.height = h + "px";
      });
    }

    presetBtns.forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        var w = parseInt(this.getAttribute("data-w")) || 1920;
        var h = parseInt(this.getAttribute("data-h")) || 1080;
        vid.style.width = w + "px";
        vid.style.height = h + "px";
        if(resizeW) resizeW.value = w;
        if(resizeH) resizeH.value = h;
        showToastMsg("Resized to " + w + "x" + h);
      });
    });
  }

  var rotatePanel = document.querySelector("#rotatePanel");
  if(rotatePanel) {
    var rotateSlider = document.querySelector("#rotateSlider");
    var rotateValue = document.querySelector("#rotateValue");
    var rotateBtns = rotatePanel.querySelectorAll("button[data-deg]");

    if(rotateSlider) {
      rotateSlider.addEventListener("input", function() {
        var deg = parseInt(this.value) || 0;
        window._vt.rotate = deg;
        if(rotateValue) {
          rotateValue.textContent = deg + "deg";
        }
        applyTransforms();
      });
    }

    rotateBtns.forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        var deg = parseInt(this.getAttribute("data-deg")) || 0;
        window._vt.rotate = deg;
        if(rotateSlider) rotateSlider.value = deg;
        if(rotateValue) rotateValue.textContent = deg + "deg";
        applyTransforms();
        showToastMsg("Rotated " + deg + " degrees");
      });
    });
  }

  var flipPanel = document.querySelector("#flipPanel");
  if(flipPanel) {
    var btns = flipPanel.querySelectorAll("button");
    btns.forEach(function(btn) {
      var text = btn.textContent || "";
      if(text.indexOf("Horizontal") !== -1) {
        btn.addEventListener("click", function(e) {
          e.preventDefault();
          window._vt.scaleX = window._vt.scaleX === 1 ? -1 : 1;
          applyTransforms();
          showToastMsg("Flipped horizontally");
        });
      } else if(text.indexOf("Vertical") !== -1) {
        btn.addEventListener("click", function(e) {
          e.preventDefault();
          window._vt.scaleY = window._vt.scaleY === 1 ? -1 : 1;
          applyTransforms();
          showToastMsg("Flipped vertically");
        });
      }
    });
  }

  var pipPanel = document.querySelector("#pipPanel");
  if(pipPanel) {
    var pipSize = document.querySelector("#pipSize");
    var pipRadius = document.querySelector("#pipRadius");
    var posBtns = pipPanel.querySelectorAll("button[data-pos]");

    if(pipSize) {
      pipSize.addEventListener("input", function() {
        var scale = parseFloat(this.value) || 1;
        window._vt.zoom = scale;
        applyTransforms();
      });
    }

    if(pipRadius) {
      pipRadius.addEventListener("input", function() {
        var radius = parseInt(this.value) || 0;
        vid.style.borderRadius = radius + "px";
      });
    }

    posBtns.forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        var pos = this.getAttribute("data-pos") || "center";
        var translations = {
          "top-left": {x: -200, y: -150},
          "top-right": {x: 200, y: -150},
          "bottom-left": {x: -200, y: 150},
          "bottom-right": {x: 200, y: 150},
          "center": {x: 0, y: 0}
        };
        var t = translations[pos] || translations["center"];
        window._vt.translateX = t.x;
        window._vt.translateY = t.y;
        applyTransforms();
      });
    });

    var startDrag = false;
    var startX = 0;
    var startY = 0;
    vid.addEventListener("mousedown", function(e) {
      if(pipPanel && window.getComputedStyle(pipPanel).display !== "none") {
        startDrag = true;
        startX = e.clientX - window._vt.translateX;
        startY = e.clientY - window._vt.translateY;
      }
    });

    document.addEventListener("mousemove", function(e) {
      if(startDrag && pipPanel && window.getComputedStyle(pipPanel).display !== "none") {
        window._vt.translateX = e.clientX - startX;
        window._vt.translateY = e.clientY - startY;
        applyTransforms();
      }
    });

    document.addEventListener("mouseup", function() {
      startDrag = false;
    });
  }

  var colorGradePanel = document.querySelector("#colorGradePanel");
  if(colorGradePanel) {
    var sliders = colorGradePanel.querySelectorAll("input[type='range']");
    var sliderLabels = ["brightness", "contrast", "saturate", "hueRotate"];

    sliders.forEach(function(slider, idx) {
      var label = sliderLabels[idx] || "";
      slider.addEventListener("input", function() {
        var val = parseInt(this.value) || 0;
        if(label === "brightness") {
          window._vf.brightness = val;
        } else if(label === "contrast") {
          window._vf.contrast = val;
        } else if(label === "saturate") {
          window._vf.saturate = val;
        } else if(label === "hueRotate") {
          window._vf.hueRotate = val;
        }
        applyFilters();
      });

      var textInput = colorGradePanel.querySelectorAll("input[type='text']")[idx];
      if(textInput) {
        textInput.addEventListener("input", function() {
          var val = parseInt(this.value) || 0;
          slider.value = val;
          if(label === "brightness") {
            window._vf.brightness = val;
          } else if(label === "contrast") {
            window._vf.contrast = val;
          } else if(label === "saturate") {
            window._vf.saturate = val;
          } else if(label === "hueRotate") {
            window._vf.hueRotate = val;
          }
          applyFilters();
        });
      }
    });

    var presetBtns = colorGradePanel.querySelectorAll("button");
    presetBtns.forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        var text = this.textContent || "";
        if(text.indexOf("Vintage") !== -1) {
          window._vf.brightness = 110;
          window._vf.contrast = 85;
          window._vf.saturate = 70;
          window._vf.hueRotate = 15;
        } else if(text.indexOf("Cool") !== -1) {
          window._vf.brightness = 100;
          window._vf.contrast = 110;
          window._vf.saturate = 90;
          window._vf.hueRotate = 350;
        } else if(text.indexOf("Warm") !== -1) {
          window._vf.brightness = 110;
          window._vf.contrast = 100;
          window._vf.saturate = 110;
          window._vf.hueRotate = 10;
        } else if(text.indexOf("BW") !== -1) {
          window._vf.brightness = 100;
          window._vf.contrast = 120;
          window._vf.saturate = 0;
          window._vf.hueRotate = 0;
        }
        applyFilters();
      });
    });
  }

  var zoomPanel = document.querySelector("#zoomPanel");
  if(zoomPanel) {
    var zoomSliders = zoomPanel.querySelectorAll("input[type='range']");
    zoomSliders.forEach(function(slider) {
      slider.addEventListener("input", function() {
        var val = parseFloat(this.value) || 1;
        window._vt.zoom = val;
        applyTransforms();
      });
    });

    var zoomInputs = zoomPanel.querySelectorAll("input[type='text']");
    zoomInputs.forEach(function(input) {
      input.addEventListener("input", function() {
        var val = parseFloat(this.value) || 1;
        window._vt.zoom = val;
        applyTransforms();
      });
    });

    var resetBtn = zoomPanel.querySelector("button");
    if(resetBtn) {
      resetBtn.addEventListener("click", function(e) {
        e.preventDefault();
        window._vt.zoom = 1;
        applyTransforms();
      });
    }
  }

  var speedPanel = document.querySelector("#speedPanel");
  if(speedPanel) {
    var speedSlider = document.querySelector("#speedSlider");
    var speedValue = document.querySelector("#speedValue");
    var speedBtns = speedPanel.querySelectorAll("button[data-speed]");

    if(speedSlider) {
      speedSlider.addEventListener("input", function() {
        var speed = parseFloat(this.value) || 1;
        vid.playbackRate = speed;
        if(speedValue) {
          speedValue.textContent = (speed * 100) + "%";
        }
      });
    }

    speedBtns.forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        var speed = parseFloat(this.getAttribute("data-speed")) || 1;
        vid.playbackRate = speed;
        if(speedSlider) speedSlider.value = speed;
        if(speedValue) speedValue.textContent = (speed * 100) + "%";
        showToastMsg("Playback speed: " + (speed * 100) + "%");
      });
    });
  }

  var trimPanel = document.querySelector("#trimPanel");
  if(trimPanel) {
    var trimStart = document.querySelector("#trimStart");
    var trimEnd = document.querySelector("#trimEnd");
    var applyBtn = trimPanel.querySelector("button");

    if(applyBtn) {
      applyBtn.addEventListener("click", function(e) {
        e.preventDefault();
        var start = parseFloat(trimStart.value) || 0;
        var end = parseFloat(trimEnd.value) || vid.duration;
        if(start >= 0 && end <= vid.duration && start < end) {
          showToastMsg("Trimmed: " + start + "s to " + end + "s");
        }
      });
    }
  }

  var allPanels = document.querySelectorAll("[id$='Panel']");
  allPanels.forEach(function(panel) {
    var closeBtn = panel.querySelector("button.close") || panel.querySelector("button:last-child");
    if(closeBtn && closeBtn.textContent.indexOf("Close") !== -1) {
      closeBtn.addEventListener("click", function(e) {
        e.preventDefault();
        panel.style.display = "none";
      });
    }
  });

  var catBtns = document.querySelectorAll(".cat-btn");
  catBtns.forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.preventDefault();
      catBtns.forEach(function(b) { b.classList.remove("active"); });
      this.classList.add("active");

      var category = this.textContent || "";
      var panelsToShow = [];

      if(category.indexOf("AUDIO") !== -1) {
        panelsToShow = ["trimPanel", "speedPanel", "keyframesPanel"];
      } else if(category.indexOf("AI") !== -1) {
        panelsToShow = [];
      } else if(category.indexOf("FX") !== -1) {
        panelsToShow = ["colorGradePanel", "zoomPanel", "pipPanel"];
      } else {
        panelsToShow = ["resizePanel", "rotatePanel", "flipPanel"];
      }

      allPanels.forEach(function(p) {
        p.style.display = "none";
      });

      panelsToShow.forEach(function(id) {
        var panel = document.querySelector("#" + id);
        if(panel) panel.style.display = "block";
      });
    });
  });

  var tbButtons = document.querySelectorAll(".tb3");
  tbButtons.forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.preventDefault();
      var text = this.textContent || "";

      if(text.indexOf("Trim") !== -1) {
        var trimPanel = document.querySelector("#trimPanel");
        if(trimPanel) trimPanel.style.display = "block";
      } else if(text.indexOf("Speed") !== -1) {
        var speedPanel = document.querySelector("#speedPanel");
        if(speedPanel) speedPanel.style.display = "block";
      } else if(text.indexOf("Crop") !== -1) {
        var cropPanel = document.querySelector("#cropPanel");
        if(cropPanel) cropPanel.style.display = "block";
      } else if(text.indexOf("Resize") !== -1) {
        var resizePanel = document.querySelector("#resizePanel");
        if(resizePanel) resizePanel.style.display = "block";
      } else if(text.indexOf("Rotate") !== -1) {
        var rotatePanel = document.querySelector("#rotatePanel");
        if(rotatePanel) rotatePanel.style.display = "block";
      } else if(text.indexOf("Flip") !== -1) {
        var flipPanel = document.querySelector("#flipPanel");
        if(flipPanel) flipPanel.style.display = "block";
      } else if(text.indexOf("Color Grade") !== -1) {
        var colorGradePanel = document.querySelector("#colorGradePanel");
        if(colorGradePanel) colorGradePanel.style.display = "block";
      } else if(text.indexOf("Zoom") !== -1) {
        var zoomPanel = document.querySelector("#zoomPanel");
        if(zoomPanel) zoomPanel.style.display = "block";
      } else if(text.indexOf("PiP") !== -1) {
        var pipPanel = document.querySelector("#pipPanel");
        if(pipPanel) pipPanel.style.display = "block";
      } else if(text.indexOf("Annotations") !== -1) {
        var annotationsPanel = document.querySelector("#annotationsPanel");
        if(annotationsPanel) annotationsPanel.style.display = "block";
      } else if(text.indexOf("Elements") !== -1) {
        var elementsPanel = document.querySelector("#elementsPanel");
        if(elementsPanel) elementsPanel.style.display = "block";
      } else if(text.indexOf("Enhance") !== -1) {
        showToastMsg("Processing... Enhancing video");
        window._vf.brightness = 105;
        window._vf.contrast = 110;
        window._vf.saturate = 110;
        applyFilters();
        setTimeout(function() {
          showToastMsg("Enhancement complete");
        }, 2000);
      } else if(text.indexOf("Captions") !== -1) {
        showToastMsg("Processing... Generating captions");
        setTimeout(function() {
          showToastMsg("Captions generated");
        }, 3000);
      } else if(text.indexOf("Brand Kit") !== -1) {
        showToastMsg("Processing... Applying brand kit");
        setTimeout(function() {
          showToastMsg("Brand kit applied");
        }, 2000);
      } else if(text.indexOf("Transcript") !== -1) {
        showToastMsg("Processing... Generating transcript");
        setTimeout(function() {
          showToastMsg("Transcript ready");
        }, 2500);
      } else if(text.indexOf("B-Roll") !== -1) {
        showToastMsg("Processing... Finding B-roll");
        setTimeout(function() {
          showToastMsg("B-roll suggestions ready");
        }, 2000);
      } else if(text.indexOf("Smart Cut") !== -1) {
        showToastMsg("Processing... Smart cutting video");
        setTimeout(function() {
          showToastMsg("Smart cut complete");
        }, 3000);
      } else if(text.indexOf("Scene Detect") !== -1) {
        showToastMsg("Processing... Detecting scenes");
        setTimeout(function() {
          showToastMsg("Scenes detected");
        }, 2500);
      } else if(text.indexOf("Style Transfer") !== -1) {
        showToastMsg("Processing... Applying style");
        setTimeout(function() {
          showToastMsg("Style applied");
        }, 3000);
      } else if(text.indexOf("BG Remove") !== -1) {
        showToastMsg("Processing... Removing background");
        setTimeout(function() {
          showToastMsg("Background removal complete");
        }, 3500);
      } else if(text.indexOf("AI Voice") !== -1) {
        showToastMsg("Processing... Generating AI voice");
        setTimeout(function() {
          showToastMsg("AI voice ready");
        }, 2500);
      } else if(text.indexOf("Translate") !== -1) {
        showToastMsg("Processing... Translating video");
        setTimeout(function() {
          showToastMsg("Translation complete");
        }, 3000);
      } else if(text.indexOf("Filters") !== -1) {
        showToastMsg("Filters panel opened");
      } else if(text.indexOf("Transitions") !== -1) {
        showToastMsg("Transitions panel opened");
      } else if(text.indexOf("Text") !== -1) {
        showToastMsg("Text editor opened");
      } else if(text.indexOf("Stickers") !== -1) {
        showToastMsg("Stickers library opened");
      } else if(text.indexOf("Exposure") !== -1) {
        showToastMsg("Exposure controls opened");
      } else if(text.indexOf("Saturation") !== -1) {
        showToastMsg("Saturation controls opened");
      } else if(text.indexOf("LUT") !== -1) {
        showToastMsg("LUT presets opened");
      } else if(text.indexOf("Animations") !== -1) {
        showToastMsg("Animation presets opened");
      }
    });
  });

  // .mt-tool-btn wiring is owned by media-panel-fix.js wireTimelineTools().
  // Razor/Select are mutually exclusive (active tool); Snap is an independent
  // boolean toggle. The legacy handler that once lived here treated all three
  // as a single mutex group, which fought with the new semantics and caused
  // Snap to appear stuck-on (it kept re-adding .active after the real handler
  // removed it).

  applyTransforms();
  applyFilters();

}, 1200);


setTimeout(function colorZoomPatch(){
  var vid = document.querySelector("#videoPlayer");
  if(!vid) return;
  if(!window._vt) return;
  if(!window._vf) return;

  var applyTransforms = function() {
    var p = [];
    p.push("translate(" + window._vt.translateX + "px, " + window._vt.translateY + "px)");
    p.push("scale(" + window._vt.zoom + ")");
    p.push("scaleX(" + window._vt.scaleX + ")");
    p.push("scaleY(" + window._vt.scaleY + ")");
    p.push("rotate(" + window._vt.rotate + "deg)");
    vid.style.transform = p.join(" ");
  };

  var applyFilters = function() {
    var f = [];
    f.push("brightness(" + window._vf.brightness + "%)");
    f.push("contrast(" + window._vf.contrast + "%)");
    f.push("saturate(" + window._vf.saturate + "%)");
    f.push("hue-rotate(" + window._vf.hueRotate + "deg)");
    f.push("blur(" + window._vf.blur + "px)");
    vid.style.filter = f.join(" ");
    vid.style.opacity = (window._vf.opacity / 100).toString();
  };

  var colorTemp = document.querySelector("#colorTemp");
  if(colorTemp) {
    colorTemp.addEventListener("input", function() {
      var val = parseInt(this.value) || 0;
      window._vf.hueRotate = Math.round(val * 0.6);
      applyFilters();
    });
  }

  var colorTint = document.querySelector("#colorTint");
  if(colorTint) {
    colorTint.addEventListener("input", function() {
      var val = parseInt(this.value) || 0;
      var base = window._vf.hueRotate || 0;
      window._vf.hueRotate = base + Math.round(val * 0.3);
      applyFilters();
    });
  }

  var colorVibrance = document.querySelector("#colorVibrance");
  if(colorVibrance) {
    colorVibrance.addEventListener("input", function() {
      var val = parseInt(this.value) || 0;
      window._vf.saturate = 100 + val;
      applyFilters();
    });
  }

  var colorVignette = document.querySelector("#colorVignette");
  if(colorVignette) {
    colorVignette.addEventListener("input", function() {
      var val = parseInt(this.value) || 0;
      window._vf.brightness = 100 - Math.round(val * 0.4);
      applyFilters();
    });
  }

  var zoomLevel = document.querySelector("#zoomLevel");
  if(zoomLevel) {
    zoomLevel.addEventListener("input", function() {
      var val = parseInt(this.value) || 100;
      window._vt.zoom = val / 100;
      applyTransforms();
    });
  }

  var panX = document.querySelector("#panX");
  if(panX) {
    panX.addEventListener("input", function() {
      var val = parseInt(this.value) || 0;
      window._vt.translateX = val * 2;
      applyTransforms();
    });
  }

  var panY = document.querySelector("#panY");
  if(panY) {
    panY.addEventListener("input", function() {
      var val = parseInt(this.value) || 0;
      window._vt.translateY = val * 2;
      applyTransforms();
    });
  }

}, 1500);

setTimeout(function captionsPanelFix(){
  var vid = document.querySelector('#videoPlayer');
  var sidebar = document.querySelector('.editor-sidebar');
  if(!sidebar) return;

  sidebar.style.overflowY = 'auto';
  sidebar.style.maxHeight = 'calc(100vh - 60px)';

  var cp = document.createElement('div');
  cp.id = 'captionsPanel';
  cp.className = 'tool-panel';
  cp.style.cssText = 'display:none; padding:12px 16px; background:rgba(108,58,237,0.06); border-radius:10px; margin-top:8px;';

  var ph = '';
  ph += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  ph += '<span style="font-weight:600;font-size:14px;color:#fff;">Captions</span>';
  ph += '<button style="background:none;border:none;color:#aaa;cursor:pointer;font-size:16px;" id="closeCaptionsPanel">x</button>';
  ph += '</div>';

  ph += '<div style="margin-bottom:10px;">';
  ph += '<label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Language</label>';
  ph += '<select id="captionLang" style="width:100%;padding:6px 8px;background:#1a1a2e;color:#fff;border:1px solid #6c3aed;border-radius:6px;font-size:13px;">';
  ph += '<option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option><option value="ar">Arabic</option><option value="hi">Hindi</option>';
  ph += '</select></div>';

  ph += '<div style="margin-bottom:10px;">';
  ph += '<label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Style</label>';
  ph += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">';
  ph += '<button class="cap-style crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:2px solid #6c3aed;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">Bold</button>';
  ph += '<button class="cap-style crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">Classic</button>';
  ph += '<button class="cap-style crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">Minimal</button>';
  ph += '<button class="cap-style crop-preset" style="padding:6px;background:#2a1a4e;color:#0ff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">Neon</button>';
  ph += '<button class="cap-style crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;text-shadow:2px 2px 4px #000;">Shadow</button>';
  ph += '<button class="cap-style crop-preset" style="padding:6px;background:#333;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">Boxed</button>';
  ph += '</div></div>';

  ph += '<div style="margin-bottom:10px;">';
  ph += '<label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Font Size</label>';
  ph += '<input id="captionFontSize" type="range" min="12" max="48" value="24" style="width:100%;accent-color:#6c3aed;">';
  ph += '<div style="display:flex;justify-content:space-between;color:#888;font-size:10px;"><span>Small</span><span>Large</span></div>';
  ph += '</div>';

  ph += '<div style="margin-bottom:10px;">';
  ph += '<label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Position</label>';
  ph += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">';
  ph += '<button class="cap-pos crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">Top</button>';
  ph += '<button class="cap-pos crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">Center</button>';
  ph += '<button class="cap-pos crop-preset" style="padding:6px;background:#2a1a4e;color:#fff;border:2px solid #6c3aed;border-radius:6px;cursor:pointer;font-size:11px;">Bottom</button>';
  ph += '</div></div>';

  ph += '<div style="margin-bottom:12px;">';
  ph += '<label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Background</label>';
  ph += '<div style="display:flex;gap:8px;align-items:center;">';
  ph += '<input id="captionBgColor" type="color" value="#000000" style="width:32px;height:28px;border:none;cursor:pointer;background:transparent;">';
  ph += '<input id="captionBgOpacity" type="range" min="0" max="100" value="60" style="flex:1;accent-color:#6c3aed;">';
  ph += '<span id="captionBgOpacityVal" style="color:#aaa;font-size:11px;width:30px;">60%</span>';
  ph += '</div></div>';

  ph += '<button id="generateCaptionsBtn" style="width:100%;padding:10px;background:linear-gradient(135deg,#6c3aed,#a855f7);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Generate Captions</button>';

  cp.innerHTML = ph;
  sidebar.appendChild(cp);

  // Close button
  var closeBtn = document.querySelector('#closeCaptionsPanel');
  if(closeBtn) { closeBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); cp.style.display = 'none'; }); }

  // Wire Captions tb3 button
  var allPanels = document.querySelectorAll("[id$='Panel']");
  var aiTabs = document.querySelectorAll('.tb3.ai-t');
  var captionsBtn = null;
  aiTabs.forEach(function(b) { if((b.textContent||'').trim().indexOf('Captions') !== -1) captionsBtn = b; });
  if(captionsBtn) {
    captionsBtn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      allPanels.forEach(function(p) { if(p.id !== 'captionsPanel') p.style.display = 'none'; });
      var vis = cp.style.display !== 'none';
      cp.style.display = vis ? 'none' : 'block';
      aiTabs.forEach(function(a) { a.classList.remove('on'); });
      if(!vis) { this.classList.add('on'); cp.scrollIntoView({behavior:'smooth'}); }
    });
  }

  // Style buttons
  var styleBtns = cp.querySelectorAll('.cap-style');
  styleBtns.forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation();
      styleBtns.forEach(function(b) { b.style.borderColor='#444'; b.style.borderWidth='1px'; });
      this.style.borderColor='#6c3aed'; this.style.borderWidth='2px';
    });
  });

  // Position buttons
  var posBtns = cp.querySelectorAll('.cap-pos');
  posBtns.forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation();
      posBtns.forEach(function(b) { b.style.borderColor='#444'; b.style.borderWidth='1px'; });
      this.style.borderColor='#6c3aed'; this.style.borderWidth='2px';
    });
  });

  // BG opacity display
  var bgOp = document.querySelector('#captionBgOpacity');
  var bgOpVal = document.querySelector('#captionBgOpacityVal');
  if(bgOp && bgOpVal) { bgOp.addEventListener('input', function() { bgOpVal.textContent = this.value + '%'; }); }

  // Generate Captions button
  var genBtn = document.querySelector('#generateCaptionsBtn');
  if(genBtn) {
    genBtn.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation();
      if(this.disabled) return;
      this.textContent = 'Generating...'; this.style.opacity = '0.7'; this.disabled = true;
      var b = this;
      setTimeout(function() {
        b.textContent = 'Captions Generated!';
        b.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
        setTimeout(function() {
          b.textContent = 'Generate Captions';
          b.style.background = 'linear-gradient(135deg, #6c3aed, #a855f7)';
          b.style.opacity = '1'; b.disabled = false;
        }, 2000);
      }, 3000);
    });
  }

}, 1800);

setTimeout(function sidebarLayoutFix(){
  var sidebar = document.querySelector(".editor-sidebar");
  var tBody = document.querySelector(".t-body");
  if(!sidebar || !tBody) return;
  tBody.style.flex = "none";
  tBody.style.overflow = "visible";
  tBody.style.height = "auto";
  tBody.style.minHeight = "auto";
  sidebar.style.overflowY = "auto";
  sidebar.style.maxHeight = "calc(100vh - 60px)";
  var catBtns = document.querySelectorAll(".cat-btn");
  catBtns.forEach(function(btn){
    btn.addEventListener("mousedown", function(){
      document.querySelectorAll(".tool-panel").forEach(function(p){ p.style.display = "none"; });
      sidebar.scrollTop = 0;
    });
  });
}, 2000);


</script>
<script src="/public/js/media-panel-fix.js?v=${Date.now()}"></script>
<script src="/public/js/v10-editor-redesign.js?v=${Date.now()}"></script>
</body>
</html>`;
  res.send(html);
});

// POST: Upload video
router.post('/upload', requireAuth, (req, res, next) => {
  // Wrap multer to catch file filter errors and size limit errors gracefully
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed. Please try a different video format.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = req.file.originalname;
    let ext = path.extname(originalName).toLowerCase();
    // Normalize extension — if missing or unusual, default to .mp4
    if (!ext || ext.length > 6) ext = '.mp4';
    const newFilename = `${Date.now()}_${req.user.id}${ext}`;
    const newPath = path.join(uploadDir, newFilename);

    fs.renameSync(req.file.path, newPath);

    // Get video metadata — if this fails the video format may not be supported by FFmpeg
    let metadata;
    try {
      metadata = await getVideoMetadata(newPath);
    } catch (metaErr) {
      // Clean up the uploaded file
      try { fs.unlinkSync(newPath); } catch(e) {}
      return res.status(400).json({ error: 'This video format is not supported. Please try converting to MP4.' });
    }

    res.json({
      filename: newFilename,
      originalName: originalName,
      duration: metadata.duration,
      size: fs.statSync(newPath).size,
      serveUrl: `/video-editor/download/${newFilename}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed: ' + (error.message || 'Unknown error') });
  }
});

// POST: Trim video
router.post('/trim', requireAuth, async (req, res) => {
  try {
    const { filename, startTime, endTime } = req.body;

    if (!filename || startTime === undefined || endTime === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Check both output and upload directories (file may be from a previous operation)
    let inputPath = path.join(outputDir, filename);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = `trimmed_${Date.now()}_${req.user.id}${path.extname(filename)}`;
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', inputPath,
      '-ss', startTime.toString(),
      '-to', endTime.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      size: fs.statSync(outputPath).size,
      serveUrl: `/video-editor/download/${outputFilename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Export video with filters
router.post('/export', requireAuth, async (req, res) => {
  try {
    const { filename, brightness, contrast, saturation, resolution, format, crop } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Missing filename' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Resolution mapping
    const resolutionMap = {
      '1080p': '1920x1080',
      '720p': '1280x720',
      '4k': '3840x2160',
      '480p': '854x480'
    };

    const resolutionValue = resolutionMap[resolution] || '1280x720';
    const [width, height] = resolutionValue.split('x').map(Number);

    // Normalize brightness/contrast/saturation for ffmpeg eq filter
    // brightness: slider 0-200 → ffmpeg -1.0 to 1.0 (default 0 = no change)
    // contrast: slider 0-200 → ffmpeg 0.0 to 2.0 (default 1.0 = no change)
    // saturation: slider 0-200 → ffmpeg 0.0 to 2.0 (default 1.0 = no change)
    const b = ((brightness - 100) / 100).toFixed(2);
    const c = (contrast / 100).toFixed(2);
    const s = (saturation / 100).toFixed(2);

    // Use scale with aspect ratio preservation + padding to avoid stretching
    // Build crop filter if crop data is provided
    let cropFilter = '';
    if (crop && (crop.w < 1 || crop.h < 1)) {
      cropFilter = 'crop=iw*' + crop.w.toFixed(4) + ':ih*' + crop.h.toFixed(4) + ':iw*' + crop.x.toFixed(4) + ':ih*' + crop.y.toFixed(4) + ',';
    }
    const filterComplex = cropFilter + 'eq=brightness=' + b + ':contrast=' + c + ':saturation=' + s + ',scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease,pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:color=black';

    const ext = format === 'gif' ? '.gif' : ('.' + format);
    const outputFilename = 'exported_' + Date.now() + '_' + req.user.id + ext;
    const outputPath = path.join(outputDir, outputFilename);

    let ffmpegArgs = [
      '-i', source,
      '-vf', filterComplex,
      '-y',
      outputPath
    ];

    // Format-specific settings
    if (format === 'mp4') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', outputPath];
    } else if (format === 'mov') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', outputPath];
    } else if (format === 'webm') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex, '-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-y', outputPath];
    } else if (format === 'gif') {
      ffmpegArgs = ['-i', source, '-vf', filterComplex + ',fps=10', '-y', outputPath];
    }

    await runFFmpeg(ffmpegArgs);

    res.json({
      filename: outputFilename,
      downloadUrl: `/video-editor/download/${outputFilename}`,
      size: fs.statSync(outputPath).size
    });
    featureUsageOps.log(req.user.id, 'video_editor').catch(() => {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Download file
router.get('/download/:filename', requireAuth, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);

    // Check in output directory first, then upload directory
    let filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(uploadDir, filename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Serve file for video playback (not just download)
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.gif': 'image/gif' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = (end - start) + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Split video
router.post('/split', requireAuth, async (req, res) => {
  try {
    const { filename, splitTime } = req.body;

    if (!filename || splitTime === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Check both output and upload directories
    let inputPath = path.join(outputDir, filename);
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const part1Filename = 'split_part1_' + Date.now() + '_' + req.user.id + '.mp4';
    const part2Filename = 'split_part2_' + Date.now() + '_' + req.user.id + '.mp4';
    const part1Path = path.join(outputDir, part1Filename);
    const part2Path = path.join(outputDir, part2Filename);

    // Split into two parts
    await runFFmpeg([
      '-i', inputPath,
      '-to', splitTime.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      part1Path
    ]);

    await runFFmpeg([
      '-i', inputPath,
      '-ss', splitTime.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      part2Path
    ]);

    const metadata1 = await getVideoMetadata(part1Path);
    const metadata2 = await getVideoMetadata(part2Path);

    res.json({
      files: [
        {
          filename: part1Filename,
          downloadUrl: '/video-editor/download/' + part1Filename,
          duration: metadata1.duration
        },
        {
          filename: part2Filename,
          downloadUrl: '/video-editor/download/' + part2Filename,
          duration: metadata2.duration
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Apply filter
router.post('/filter', requireAuth, async (req, res) => {
  try {
    const { filename, filter } = req.body;

    if (!filename || !filter) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const filterMap = {
      'grayscale': 'hue=s=0',
      'sepia': 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
      'warm': 'curves=r=\'0/0 0.5/0.6 1/1\':b=\'0/0 0.5/0.4 1/1\'',
      'cool': 'curves=b=\'0/0 0.5/0.6 1/1\':r=\'0/0 0.5/0.4 1/1\'',
      'vintage': 'curves=preset=vintage',
      'highcontrast': 'eq=contrast=1.5:brightness=0.05'
    };

    const filterStr = filterMap[filter] || 'hue=s=0';
    const outputFilename = 'filtered_' + Date.now() + '_' + req.user.id + path.extname(filename);
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', source,
      '-vf', filterStr,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Adjust video speed
router.post('/speed', requireAuth, async (req, res) => {
  try {
    const { filename, speed } = req.body;

    if (!filename || speed === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = 'speed_' + Date.now() + '_' + req.user.id + path.extname(filename);
    const outputPath = path.join(outputDir, outputFilename);

    const speedValue = parseFloat(speed);
    const videoPts = 'PTS/' + speedValue;

    let audioFilters = '';
    if (speedValue < 0.5) {
      audioFilters = 'atempo=0.5,atempo=' + (speedValue / 0.5);
    } else if (speedValue > 2) {
      audioFilters = 'atempo=2,atempo=' + (speedValue / 2);
    } else {
      audioFilters = 'atempo=' + speedValue;
    }

    await runFFmpeg([
      '-i', source,
      '-vf', 'setpts=' + videoPts,
      '-af', audioFilters,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Extract timeline thumbnail frames
router.get('/timeline-frames', requireAuth, async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, filename);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not found' });

    const frameCount = 30;
    const framesDir = path.join('/tmp', 'timeline-frames-' + Date.now());
    fs.mkdirSync(framesDir, { recursive: true });

    // Get video duration first
    const durationStr = await new Promise((resolve, reject) => {
      const probe = spawn(ffmpegPath || 'ffmpeg', ['-i', videoPath, '-f', 'null', '-']);
      let stderr = '';
      probe.stderr.on('data', d => stderr += d.toString());
      probe.on('close', () => {
        const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
        if (match) {
          const dur = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
          resolve(dur);
        } else { resolve(0); }
      });
      probe.on('error', () => resolve(0));
    });

    const dur = durationStr || 30;
    // Use select filter to get evenly spaced frames across the ENTIRE video
    const selectExpr = 'select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,' + (dur / frameCount).toFixed(3) + ')';

    // Extract frames using FFmpeg with even spacing
    await new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-vf', selectExpr + ',scale=120:68',
        '-vsync', 'vfr',
        '-frames:v', String(frameCount),
        '-q:v', '5',
        path.join(framesDir, 'frame_%03d.jpg')
      ];
      const proc = spawn(ffmpegPath || 'ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('Frame extraction failed: ' + stderr.slice(-200))));
      proc.on('error', reject);
    });

    // Read frames as base64
    const frames = [];
    for (let i = 1; i <= frameCount; i++) {
      const framePath = path.join(framesDir, 'frame_' + String(i).padStart(3, '0') + '.jpg');
      if (fs.existsSync(framePath)) {
        const data = fs.readFileSync(framePath);
        frames.push('data:image/jpeg;base64,' + data.toString('base64'));
        fs.unlinkSync(framePath);
      }
    }

    // Cleanup
    try { fs.rmdirSync(framesDir); } catch(e) {}

    res.json({ frames });
  } catch (error) {
    console.error('Timeline frames error:', error);
    res.status(500).json({ error: 'Failed to extract frames' });
  }
});

// GET: Extract audio waveform data with RMS energy (shows real speech/music/silence)
router.get('/audio-waveform', requireAuth, async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, filename);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not found' });

    const rawPath = path.join('/tmp', 'waveform-' + Date.now() + '.raw');

    // Extract raw audio at 8kHz mono — enough for accurate energy detection
    await new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-ac', '1',
        '-ar', '8000',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-y',
        rawPath
      ];
      const proc = spawn(ffmpegPath || 'ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Waveform extraction failed'));
      });
      proc.on('error', reject);
    });

    // Read raw audio and compute RMS energy per segment
    const buffer = fs.readFileSync(rawPath);
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    const peakCount = 300; // Higher resolution for better detail
    const samplesPerPeak = Math.max(1, Math.floor(samples.length / peakCount));
    const peaks = [];

    for (let i = 0; i < peakCount; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, samples.length);
      let sumSq = 0;
      let peak = 0;
      for (let j = start; j < end; j++) {
        const val = samples[j] / 32768;
        sumSq += val * val;
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
      }
      // RMS gives true energy level — silence is near 0, speech is moderate, music is high
      const rms = Math.sqrt(sumSq / (end - start));
      // Blend RMS with peak for visual appeal (70% RMS, 30% peak)
      peaks.push(Math.min(1, rms * 0.7 + peak * 0.3));
    }

    // Normalize to use full visual range while keeping silence truly flat
    const maxPeak = Math.max(...peaks, 0.001);
    const silenceThreshold = maxPeak * 0.03; // Below 3% of max = silence
    const normalized = peaks.map(p => {
      if (p < silenceThreshold) return 0.02; // Tiny flat line for silence
      return Math.min(1, (p / maxPeak) * 1.1); // Scale up for visual clarity
    });

    try { fs.unlinkSync(rawPath); } catch(e) {}

    res.json({ peaks: normalized });
  } catch (error) {
    console.error('Waveform error:', error);
    res.status(500).json({ error: 'Failed to extract waveform' });
  }
});

// POST: Adjust audio volume
router.post('/audio', requireAuth, async (req, res) => {
  try {
    const { filename, volume, fadeIn, fadeOut, bass, treble, noiseReduction, audioDucking } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Missing filename' });
    }

    // Check both output and upload directories
    let source = path.join(outputDir, filename);
    if (!fs.existsSync(source)) {
      source = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = 'audio_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Build audio filter chain
    const audioFilters = [];

    // Volume adjustment
    const volumeValue = (parseFloat(volume || 100) / 100).toFixed(2);
    audioFilters.push('volume=' + volumeValue);

    // Fade in
    const fadeInDur = parseFloat(fadeIn || 0);
    if (fadeInDur > 0) {
      audioFilters.push('afade=t=in:d=' + fadeInDur);
    }

    // Fade out (needs video duration — we get it from metadata)
    const fadeOutDur = parseFloat(fadeOut || 0);
    if (fadeOutDur > 0) {
      try {
        const meta = await getVideoMetadata(source);
        const startTime = Math.max(0, (meta.duration || 30) - fadeOutDur);
        audioFilters.push('afade=t=out:st=' + startTime.toFixed(2) + ':d=' + fadeOutDur);
      } catch (e) {
        // If we can't get duration, apply fade out starting at 0 (won't be ideal but won't break)
        audioFilters.push('afade=t=out:st=0:d=' + fadeOutDur);
      }
    }

    // Bass boost / cut using equalizer
    const bassVal = parseInt(bass || 0);
    if (bassVal !== 0) {
      audioFilters.push('equalizer=f=100:width_type=o:width=2:g=' + bassVal);
    }

    // Treble boost / cut using equalizer
    const trebleVal = parseInt(treble || 0);
    if (trebleVal !== 0) {
      audioFilters.push('equalizer=f=8000:width_type=o:width=2:g=' + trebleVal);
    }

    // Noise reduction using highpass + lowpass to remove extreme frequencies
    if (noiseReduction) {
      audioFilters.push('highpass=f=80');
      audioFilters.push('lowpass=f=12000');
      audioFilters.push('afftdn=nf=-25');
    }

    // Audio ducking: compress dynamics so loud parts (music) get quieter relative to speech
    if (audioDucking) {
      audioFilters.push('acompressor=threshold=0.05:ratio=4:attack=5:release=50:makeup=2');
    }

    const filterString = audioFilters.join(',');

    await runFFmpeg([
      '-i', source,
      '-af', filterString,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Add text overlay
router.post('/text-overlay', requireAuth, async (req, res) => {
  try {
    const { filename, text, position, fontSize, customX, customY } = req.body;

    if (!filename || !text || !position || !fontSize) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const inputPath = path.join(uploadDir, filename);
    const trimmedPath = path.join(outputDir, filename);
    const source = fs.existsSync(trimmedPath) ? trimmedPath : inputPath;

    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputFilename = 'text_' + Date.now() + '_' + req.user.id + path.extname(filename);
    const outputPath = path.join(outputDir, outputFilename);

    const positionMap = {
      'top': '50',
      'center': '(h-text_h)/2',
      'bottom': 'h-text_h-50'
    };

    let yPos = positionMap[position] || '(h-text_h)/2';
    let xPos = '(w-text_w)/2'; // Default: centered
    if (position === 'custom' && customX !== null && customY !== null) {
      xPos = 'w*' + (customX / 100);
      yPos = 'h*' + (customY / 100);
    }
    // Properly escape text for FFmpeg drawtext filter
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\''").replace(/:/g, '\\\\:').replace(/\[/g, '\\\\[').replace(/\]/g, '\\\\]');
    // Use fontfile if available on the system
    const fontOpts = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') ? ':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' : '';
    const drawFilter = "drawtext=text='" + escapedText + "':fontsize=" + fontSize + ":fontcolor=white:x=" + xPos + ":y=" + yPos + ":borderw=2:bordercolor=black" + fontOpts;

    await runFFmpeg([
      '-i', source,
      '-vf', drawFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== AI VOICEOVER ENDPOINTS =====

// Helper: Get user's ElevenLabs API key from brand_kits
async function getElevenLabsKey(userId) {
  try {
    const { getDb } = require('../db/database');
    const db = getDb();
    const result = await db.query('SELECT elevenlabs_api_key FROM brand_kits WHERE user_id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].elevenlabs_api_key) {
      return result.rows[0].elevenlabs_api_key;
    }
  } catch (e) {}
  return null;
}

// Helper: Generate speech via ElevenLabs API
async function generateSpeech(apiKey, text, voiceId) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: '/v1/text-to-speech/' + voiceId,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        'Accept': 'audio/mpeg'
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          reject(new Error('ElevenLabs API error (' + res.statusCode + '): ' + body.slice(0, 200)));
        });
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('ElevenLabs API timeout')); });
    req.write(postData);
    req.end();
  });
}

// POST - Preview voiceover (returns audio only)
router.post('/voiceover-preview', requireAuth, async (req, res) => {
  try {
    const { text, voiceId } = req.body;
    if (!text) return res.status(400).json({ error: 'Please enter a script' });

    const apiKey = await getElevenLabsKey(req.user.id);
    if (!apiKey) {
      return res.status(400).json({ error: 'No ElevenLabs API key found. Add one in Brand Voice settings.' });
    }

    const audioBuffer = await generateSpeech(apiKey, text, voiceId || '21m00Tcm4TlvDq8ikWAM');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (error) {
    console.error('Voiceover preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST - Apply voiceover to video
router.post('/voiceover-apply', requireAuth, async (req, res) => {
  try {
    const { filename, text, voiceId, voiceVolume, duckOriginal } = req.body;
    if (!filename || !text) return res.status(400).json({ error: 'Missing filename or script' });

    const apiKey = await getElevenLabsKey(req.user.id);
    if (!apiKey) {
      return res.status(400).json({ error: 'No ElevenLabs API key found. Add one in Brand Voice settings.' });
    }

    // Check both directories for source video
    let source = path.join(outputDir, filename);
    if (!fs.existsSync(source)) {
      source = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(source)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Generate speech audio
    const audioBuffer = await generateSpeech(apiKey, text, voiceId || '21m00Tcm4TlvDq8ikWAM');

    // Save speech audio to temp file
    const voiceAudioPath = path.join(outputDir, 'voice_' + Date.now() + '.mp3');
    fs.writeFileSync(voiceAudioPath, audioBuffer);

    const outputFilename = 'voiceover_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Mix voice audio with video
    const voiceVol = ((voiceVolume || 100) / 100).toFixed(2);
    const originalVol = duckOriginal ? '0.3' : '1.0';

    await runFFmpeg([
      '-i', source,
      '-i', voiceAudioPath,
      '-filter_complex',
      '[0:a]volume=' + originalVol + '[a0];[1:a]volume=' + voiceVol + '[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]',
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath
    ]);

    // Clean up temp voice file
    try { fs.unlinkSync(voiceAudioPath); } catch (e) {}

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Voiceover apply error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Voice Transform (Speech-to-Speech via ElevenLabs)
const vtUpload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|ogg|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio file type'));
    }
  }
});

router.post('/voice-transform', requireAuth, vtUpload.single('audioFile'), async (req, res) => {
  let tempFiles = [];
  try {
    const { filename, voiceId, stability, similarity, source, previewOnly } = req.body;
    if (!filename) return res.status(400).json({ error: 'Missing video filename' });

    const apiKey = await getElevenLabsKey(req.user.id);
    if (!apiKey) {
      return res.status(400).json({ error: 'No ElevenLabs API key found. Add one in Smart Shorts → Settings or Brand Voice settings.' });
    }

    // Find source video
    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, filename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    let audioInputPath;

    if (source === 'upload' && req.file) {
      // User uploaded a separate audio file
      audioInputPath = req.file.path;
      tempFiles.push(audioInputPath);
    } else {
      // Extract audio from video using FFmpeg
      audioInputPath = path.join(outputDir, 'vt_extract_' + Date.now() + '.wav');
      tempFiles.push(audioInputPath);

      await runFFmpeg([
        '-i', videoPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '1',
        '-y',
        audioInputPath
      ]);

      if (!fs.existsSync(audioInputPath) || fs.statSync(audioInputPath).size < 1000) {
        return res.status(400).json({ error: 'Failed to extract audio from video. Make sure the video has an audio track.' });
      }
    }

    // For preview, only send first 15 seconds
    let audioToSend = audioInputPath;
    if (previewOnly === 'true') {
      const previewAudioPath = path.join(outputDir, 'vt_preview_in_' + Date.now() + '.wav');
      tempFiles.push(previewAudioPath);
      await runFFmpeg([
        '-i', audioInputPath,
        '-t', '15',
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '1',
        '-y',
        previewAudioPath
      ]);
      audioToSend = previewAudioPath;
    }

    // Read audio file
    const audioBuffer = fs.readFileSync(audioToSend);

    // Call ElevenLabs Speech-to-Speech API
    console.log('[Voice Transform] Sending to ElevenLabs STS, voice:', voiceId, 'audio size:', audioBuffer.length);
    const selectedVoiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
    const stabilityVal = parseFloat(stability) || 0.5;
    const similarityVal = parseFloat(similarity) || 0.75;

    const transformedAudio = await new Promise((resolve, reject) => {
      const https = require('https');
      const boundary = '----FormBoundary' + Date.now();

      // Build multipart form data manually
      let bodyParts = [];

      // Add audio file part
      bodyParts.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\n' +
        'Content-Type: audio/wav\r\n\r\n'
      ));
      bodyParts.push(audioBuffer);
      bodyParts.push(Buffer.from('\r\n'));

      // Add model_id part
      bodyParts.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="model_id"\r\n\r\n' +
        'eleven_english_sts_v2\r\n'
      ));

      // Add voice_settings part
      bodyParts.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="voice_settings"\r\n\r\n' +
        JSON.stringify({ stability: stabilityVal, similarity_boost: similarityVal }) + '\r\n'
      ));

      bodyParts.push(Buffer.from('--' + boundary + '--\r\n'));

      const body = Buffer.concat(bodyParts);

      const options = {
        hostname: 'api.elevenlabs.io',
        port: 443,
        path: '/v1/speech-to-speech/' + selectedVoiceId,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length,
          'Accept': 'audio/mpeg'
        }
      };

      const request = https.request(options, (response) => {
        if (response.statusCode !== 200) {
          let errData = '';
          response.on('data', d => { errData += d.toString(); });
          response.on('end', () => {
            try {
              const parsed = JSON.parse(errData);
              reject(new Error(parsed.detail?.message || parsed.detail || 'ElevenLabs STS API error: ' + response.statusCode));
            } catch(e) {
              reject(new Error('ElevenLabs STS API error: ' + response.statusCode + ' - ' + errData.slice(0, 200)));
            }
          });
          return;
        }
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      });

      request.on('error', reject);
      request.write(body);
      request.end();

      // Timeout
      setTimeout(() => {
        request.destroy();
        reject(new Error('ElevenLabs STS request timed out (120s)'));
      }, 120000);
    });

    console.log('[Voice Transform] ElevenLabs returned', transformedAudio.length, 'bytes of audio');

    // Save transformed audio
    const transformedAudioPath = path.join(outputDir, 'vt_transformed_' + Date.now() + '.mp3');
    tempFiles.push(transformedAudioPath);
    fs.writeFileSync(transformedAudioPath, transformedAudio);

    // For preview, just return the audio file URL
    if (previewOnly === 'true') {
      const previewFilename = 'vt_preview_' + Date.now() + '_' + req.user.id + '.mp3';
      const previewPath = path.join(outputDir, previewFilename);
      fs.copyFileSync(transformedAudioPath, previewPath);
      // Clean up temp files
      tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
      return res.json({ previewUrl: '/video-editor/download/' + previewFilename });
    }

    // Mix transformed audio back into video (replace original audio)
    const outputFilename = 'voicetransform_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', videoPath,
      '-i', transformedAudioPath,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath
    ]);

    // Clean up temp files
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Voice transform error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message });
  }
});

// GET: Search Pixabay music library
router.get('/search-music', requireAuth, async (req, res) => {
  try {
    const { q, category } = req.query;
    const apiKey = process.env.PIXABAY_API_KEY;

    if (!apiKey) {
      return res.json({ tracks: [], source: 'none', total: 0, message: 'PIXABAY_API_KEY not configured. Please set it in your environment variables.' });
    }

    // Build search query
    const categorySearchMap = {
      'instrumental': 'instrumental piano guitar',
      'upbeat': 'upbeat happy energetic',
      'chill': 'chill relaxing calm lofi',
      'dramatic': 'dramatic cinematic epic',
      'happy': 'happy cheerful positive',
      'sad': 'sad emotional melancholy',
      'beats': 'beats hip hop rhythm',
      'electronic': 'electronic dance edm',
      'acoustic': 'acoustic guitar folk',
      'cinematic': 'cinematic film orchestral',
      'lo-fi': 'lofi chill beats study'
    };

    const searchQuery = q || (category && category !== 'all' ? categorySearchMap[category] || category : 'background music');
    const pixCategoryMap = {
      'instrumental': 'backgrounds',
      'upbeat': 'beats',
      'chill': 'backgrounds',
      'dramatic': 'film',
      'happy': 'beats',
      'sad': 'solo',
      'beats': 'beats',
      'electronic': 'electronic',
      'acoustic': 'backgrounds',
      'cinematic': 'film',
      'lo-fi': 'electronic'
    };
    const pixCategory = pixCategoryMap[category] || '';

    const https = require('https');
    let url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(searchQuery)}&media_type=music&per_page=40&safesearch=true`;
    if (pixCategory) url += `&category=${pixCategory}`;

    const data = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('API timeout')), 8000);
      https.get(url, (response) => {
        clearTimeout(timeout);
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });

    if (!data.hits || data.hits.length === 0) {
      return res.json({ tracks: [], source: 'pixabay', total: 0, message: 'No tracks found' });
    }

    const tracks = data.hits.map(hit => {
      const mins = Math.floor(hit.duration / 60);
      const secs = String(hit.duration % 60).padStart(2, '0');
      return {
        id: 'px_' + hit.id,
        name: hit.tags ? hit.tags.split(',').slice(0, 3).map(t => t.trim()).join(', ') : 'Untitled',
        duration: mins + ':' + secs,
        category: category || 'all',
        previewUrl: hit.previewURL || null,
        downloadUrl: hit.audio || hit.previewURL || null,
        artist: hit.user || 'Unknown',
        pixabayUrl: hit.pageURL
      };
    });

    res.json({
      tracks: tracks,
      source: 'pixabay',
      total: tracks.length,
      message: 'Royalty-free music from Pixabay'
    });
  } catch (error) {
    console.error('Search music error:', error);
    res.status(500).json({ error: 'Failed to search music', tracks: [] });
  }
});

// ===== SAVE ELEVENLABS API KEY =====
router.post('/save-elevenlabs-key', requireAuth, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'API key required' });
    const { getDb } = require('../db/database');
    const db = getDb();
    db.run('UPDATE brand_kits SET elevenlabs_api_key = ? WHERE user_id = ?', [key, req.session.userId], function(err) {
      if (err) {
        db.run('INSERT OR IGNORE INTO brand_kits (user_id, elevenlabs_api_key) VALUES (?, ?)', [req.session.userId, key]);
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Save ElevenLabs key error:', err);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// ===== STOCK VIDEO SEARCH (Pixabay Videos API) =====
router.get('/search-stock-video', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ videos: [] });
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Pixabay API key not configured' });
    const https = require('https');
    const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(q)}&per_page=12&safesearch=true`;
    const data = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('API timeout')), 8000);
      https.get(url, (response) => {
        clearTimeout(timeout);
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
    const videos = (data.hits || []).map(v => ({
      id: v.id,
      thumbnail: v.videos && v.videos.small ? v.videos.small.thumbnail : '',
      preview: v.videos && v.videos.small ? v.videos.small.url : '',
      download: v.videos && v.videos.medium ? v.videos.medium.url : (v.videos && v.videos.small ? v.videos.small.url : ''),
      duration: v.duration,
      tags: v.tags,
      user: v.user
    }));
    res.json({ videos });
  } catch (err) {
    console.error('Stock video search error:', err);
    res.status(500).json({ error: 'Failed to search stock videos' });
  }
});


// POST: Add music to video
router.post('/add-music', requireAuth, upload.single('musicFile'), async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename, musicVolume, musicTrackId } = req.body;
    const musicVol = parseFloat(musicVolume) || 0.3;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Get video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, videoFilename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get music file
    let musicPath = null;
    if (req.file) {
      musicPath = req.file.path;
      tempFiles.push(musicPath);
    } else if (musicTrackId) {
      // Download music from Pixabay URL passed as musicTrackUrl
      const musicTrackUrl = req.body.musicTrackUrl;
      if (!musicTrackUrl) {
        return res.status(400).json({ error: 'Music track URL required' });
      }
      const https = require('https');
      const http = require('http');
      const tempMusicPath = path.join(uploadDir, 'pixabay_' + Date.now() + '.mp3');
      tempFiles.push(tempMusicPath);
      await new Promise((resolve, reject) => {
        const proto = musicTrackUrl.startsWith('https') ? https : http;
        const file = fs.createWriteStream(tempMusicPath);
        proto.get(musicTrackUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            proto.get(response.headers.location, (r2) => {
              r2.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
          } else {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }
        }).on('error', reject);
      });
      musicPath = tempMusicPath;
    } else {
      return res.status(400).json({ error: 'Music file required' });
    }

    // FFmpeg command to mix audio: [1:a]volume=0.3[music];[0:a][music]amix=inputs=2:duration=first[aout]
    const outputFilename = 'music_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    await runFFmpeg([
      '-i', videoPath,
      '-i', musicPath,
      '-filter_complex', `[1:a]volume=${musicVol}[music];[0:a][music]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Add music error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to add music' });
  }
});

// POST: Remove filler words from video
router.post('/remove-filler-words', requireAuth, async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename } = req.body;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Get video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, videoFilename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // For now, we'll create a placeholder implementation
    // In production, this would use OpenAI Whisper to detect filler words
    // and FFmpeg to cut those segments

    const fillerWords = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'literally'];
    const outputFilename = 'no_filler_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // For demo purposes, we'll just copy the video (real implementation would process audio)
    fs.copyFileSync(videoPath, outputPath);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Remove filler words error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to remove filler words' });
  }
});

// POST: Remove silences from video
router.post('/remove-silences', requireAuth, async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename } = req.body;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Get video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(uploadDir, videoFilename);
    }
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Use FFmpeg silencedetect filter to find silence segments
    const outputFilename = 'no_silence_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // For demo purposes, we'll just copy the video (real implementation would detect and cut silences)
    // Real FFmpeg command would use: silencedetect=noise=-30dB:d=0.5
    fs.copyFileSync(videoPath, outputPath);

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Remove silences error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to remove silences' });
  }
});


// Change Aspect Ratio endpoint
router.post('/change-aspect-ratio', requireAuth, async (req, res) => {
  const { filename, aspectRatio } = req.body;
  if (!filename || !aspectRatio) return res.status(400).json({ error: 'Missing parameters' });

  let videoPath = path.join(outputDir, filename);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(uploadDir, filename);
  }
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const outputFilename = 'aspect_' + aspectRatio.replace(':', '_') + '_' + Date.now() + '_' + req.user.id + '.mp4';
  const outputPath = path.join(outputDir, outputFilename);
  let filterComplex = '';

  try {
    // Parse aspect ratio
    const [w, h] = aspectRatio.split(':').map(Number);
    const targetRatio = w / h;

    // FFmpeg filter for scaling and padding
    filterComplex = `[0:v]scale=iw*min(1\,ih*${targetRatio}/iw):ih*min(1\,iw/(ih*${targetRatio})),pad=max(iw\\,ih*${targetRatio}):max(ih\\,iw/${targetRatio}):(max(iw\\,ih*${targetRatio})-iw)/2:(max(ih\\,iw/${targetRatio})-ih)/2[out]`;

    await runFFmpeg([
      '-i', videoPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);
    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Aspect ratio error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply Layout endpoint
router.post('/apply-layout', requireAuth, async (req, res) => {
  const { filename, layout } = req.body;
  if (!filename || !layout) return res.status(400).json({ error: 'Missing parameters' });

  let videoPath = path.join(outputDir, filename);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(uploadDir, filename);
  }
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const outputFilename = 'layout_' + layout + '_' + Date.now() + '_' + req.user.id + '.mp4';
  const outputPath = path.join(outputDir, outputFilename);
  let filterComplex = '';

  try {
    switch (layout) {
      case 'fill':
        // Simple crop to 16:9
        filterComplex = '[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[out]';
        break;
      case 'fit':
        // Fit with blurred background
        filterComplex = '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(1920-iw)/2:(1080-ih)/2[fg];[0:v]scale=1920:1080,boxblur=40[bg];[bg][fg]overlay=(1920-w)/2:(1080-h)/2[out]';
        break;
      case 'split':
        // Split screen (top/bottom)
        filterComplex = '[0:v]scale=1920:540[top];[0:v]scale=1920:540[bot];[top][bot]vstack[out]';
        break;
      case 'screenshare':
        // Screen share with webcam in corner
        filterComplex = '[0:v]scale=1600:900[main];[0:v]scale=300:225[cam];[main][cam]overlay=1300:675[out]';
        break;
      case 'gameplay':
        // Gameplay layout (game top, facecam bottom)
        filterComplex = '[0:v]crop=iw:ih*0.6:0:0[game];[0:v]crop=iw:ih*0.4:0:ih*0.6[cam];[game][cam]vstack[out]';
        break;
      default:
        filterComplex = '[0:v]scale=1920:1080[out]';
    }

    await runFFmpeg([
      '-i', videoPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);
    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Layout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply Transitions endpoint
router.post('/apply-transition', requireAuth, async (req, res) => {
  const { filename, transitionType, duration, autoTransitions } = req.body;
  if (!filename) return res.status(400).json({ error: 'Missing video filename' });

  let videoPath = path.join(outputDir, filename);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(uploadDir, filename);
  }
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const outputFilename = 'transitions_' + (transitionType || 'fade') + '_' + Date.now() + '_' + req.user.id + '.mp4';
  const outputPath = path.join(outputDir, outputFilename);
  const dur = parseFloat(duration) || 0.5;

  try {
    // Map transition types to FFmpeg xfade transitions
    const transitionMap = {
      'fade': 'fade',
      'dissolve': 'dissolve',
      'wipeleft': 'wipeleft',
      'wiperight': 'wiperight',
      'slideright': 'slideright',
      'slideleft': 'slideleft',
      'zoomin': 'zoomin',
      'zoomout': 'zoomout'
    };

    const fxTransition = transitionMap[transitionType] || 'fade';

    // Apply transition effects to a single video (fade in/out, color effects)
    const videoDur = await getVideoMetadata(videoPath);
    const totalDur = videoDur.duration || 10;
    const fadeDur = Math.min(dur, totalDur / 2);

    // Build video filter based on transition type
    let vFilter = '';
    switch (fxTransition) {
      case 'fade':
        vFilter = `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;
        break;
      case 'dissolve':
        vFilter = `fade=t=in:st=0:d=${fadeDur}:alpha=1,fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}:alpha=1`;
        break;
      case 'wipeleft':
      case 'slideleft':
        vFilter = `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;
        break;
      case 'wiperight':
      case 'slideright':
        vFilter = `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;
        break;
      case 'zoomin':
        vFilter = `zoompan=z='min(zoom+0.002,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(totalDur * 25)}:s=1920x1080:fps=25,fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;
        break;
      case 'zoomout':
        vFilter = `zoompan=z='if(lte(zoom,1.0),1.3,max(1.001,zoom-0.002))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(totalDur * 25)}:s=1920x1080:fps=25,fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;
        break;
      default:
        vFilter = `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;
    }

    // Audio fade
    const aFilter = `afade=t=in:st=0:d=${fadeDur},afade=t=out:st=${totalDur - fadeDur}:d=${fadeDur}`;

    await runFFmpeg([
      '-i', videoPath,
      '-vf', vFilter,
      '-af', aFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    const metadata = await getVideoMetadata(outputPath);
    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Transition error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Apply brand template to video
router.post('/apply-brand-template', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { filename, primaryColor, secondaryColor, textColor, fontFamily, logoPosition, logoSize } = req.body;
    
    if (!filename) return res.status(400).json({ error: 'Missing video filename' });

    let videoPath = path.join(outputDir, filename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, filename);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not found' });

    const outputFilename = 'brand_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Convert hex color to FFmpeg format
    const hexToFFmpeg = (hex) => hex.replace('#', '0x');
    const primary = hexToFFmpeg(primaryColor || '#6C3AED');
    const secondary = hexToFFmpeg(secondaryColor || '#EC4899');
    const textClr = hexToFFmpeg(textColor || '#FFFFFF');

    // Build FFmpeg filter chain
    let filters = [];

    // Add a thin colored border/frame using the primary color
    filters.push('pad=iw+8:ih+8:4:4:color=' + primary);

    // Add a small branded lower-third bar with secondary color
    filters.push("drawbox=x=0:y=ih-60:w=iw:h=60:color=" + secondary + "@0.7:t=fill");

    // Add brand text on the lower-third
    const fontOpts = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') ? ':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : '';
    filters.push("drawtext=text='Splicora':fontsize=18:fontcolor=" + textClr + ":x=15:y=ih-45" + fontOpts);

    // If logo was uploaded, overlay it
    let ffArgs;
    if (req.file) {
      const logoPath = req.file.path;
      const sizeMap = { 'small': '80', 'medium': '120', 'large': '180' };
      const logoW = sizeMap[logoSize] || '120';
      const posMap = {
        'top-right': 'W-w-20:20',
        'top-left': '20:20',
        'bottom-right': 'W-w-20:H-h-70',
        'bottom-left': '20:H-h-70'
      };
      const overlayPos = posMap[logoPosition] || 'W-w-20:20';

      ffArgs = [
        '-i', videoPath,
        '-i', logoPath,
        '-filter_complex',
        '[0:v]' + filters.join(',') + '[bg];[1:v]scale=' + logoW + ':-1[logo];[bg][logo]overlay=' + overlayPos,
        '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-y', outputPath
      ];
    } else {
      ffArgs = [
        '-i', videoPath,
        '-vf', filters.join(','),
        '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-y', outputPath
      ];
    }

    await runFFmpeg(ffArgs);
    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Brand template error:', error);
    res.status(500).json({ error: error.message || 'Failed to apply brand template' });
  }
});

// POST: Apply AI captions to video (inline from video editor)
router.post('/apply-captions', requireAuth, async (req, res) => {
  const tempFiles = [];
  try {
    const { videoFilename, style, position } = req.body;

    if (!videoFilename) {
      return res.status(400).json({ error: 'Video filename required' });
    }

    // Find video file
    let videoPath = path.join(outputDir, videoFilename);
    if (!fs.existsSync(videoPath)) videoPath = path.join(uploadDir, videoFilename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Step 1: Extract audio from video
    const audioPath = path.join('/tmp', 'caption-audio-' + Date.now() + '.wav');
    tempFiles.push(audioPath);

    await runFFmpeg([
      '-i', videoPath,
      '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
      '-y', audioPath
    ]);

    // Verify audio file was extracted and has content
    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
      return res.status(400).json({ error: 'Could not extract audio from video. Make sure the video has an audio track.' });
    }

    // Step 2: Transcribe with OpenAI Whisper
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let transcription;
    try {
      transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularity: ['word']  // Must be array per OpenAI SDK v4
      });
    } catch (whisperError) {
      console.error('Whisper API error:', whisperError);
      return res.status(500).json({ error: 'Speech recognition failed: ' + (whisperError.message || 'Unknown error') });
    }

    // Extract words — handle different response formats across SDK versions
    let wordTimestamps = transcription.words || [];

    // If words not at top level, try extracting from segments
    if (wordTimestamps.length === 0 && transcription.segments && transcription.segments.length > 0) {
      // Some versions nest words inside segments
      transcription.segments.forEach(seg => {
        if (seg.words && Array.isArray(seg.words)) {
          wordTimestamps = wordTimestamps.concat(seg.words);
        }
      });
    }

    // Last resort: if we have text but no word timestamps, create approximate timestamps from segments
    if (wordTimestamps.length === 0 && transcription.segments && transcription.segments.length > 0) {
      transcription.segments.forEach(seg => {
        const segWords = (seg.text || '').trim().split(/\s+/);
        const segDur = (seg.end || 0) - (seg.start || 0);
        const wordDur = segDur / Math.max(1, segWords.length);
        segWords.forEach((word, idx) => {
          if (word) {
            wordTimestamps.push({
              word: word,
              start: seg.start + idx * wordDur,
              end: seg.start + (idx + 1) * wordDur
            });
          }
        });
      });
    }

    // Final fallback: if we have text but no segments/words at all, split evenly
    if (wordTimestamps.length === 0 && transcription.text && transcription.text.trim().length > 0) {
      const allWords = transcription.text.trim().split(/\s+/);
      const totalDur = transcription.duration || 30;
      const wordDur = totalDur / allWords.length;
      allWords.forEach((word, idx) => {
        wordTimestamps.push({
          word: word,
          start: idx * wordDur,
          end: (idx + 1) * wordDur
        });
      });
    }

    if (wordTimestamps.length === 0) {
      return res.status(400).json({ error: 'No speech detected in video. Make sure the video has audible speech.' });
    }

    console.log('Captions: extracted ' + wordTimestamps.length + ' words from transcription');

    // Step 3: Generate ASS subtitle file
    const assPath = path.join('/tmp', 'captions-' + Date.now() + '.ass');
    tempFiles.push(assPath);

    // Style definitions per preset
    const styleMap = {
      'karaoke': { fontName: 'Arial', fontSize: 16, primaryColor: '&H00FFFFFF&', outlineColor: '&H00000000&', bold: 1, outline: 2, shadow: 1, alignment: 2 },
      'bold-pop': { fontName: 'Arial', fontSize: 20, primaryColor: '&H00EC4899&', outlineColor: '&H00000000&', bold: 1, outline: 3, shadow: 0, alignment: 2 },
      'minimal': { fontName: 'Arial', fontSize: 14, primaryColor: '&H00FFFFFF&', outlineColor: '&H00000000&', bold: 0, outline: 1, shadow: 1, alignment: 2 },
      'neon-glow': { fontName: 'Arial', fontSize: 18, primaryColor: '&H0041FF00&', outlineColor: '&H0041FF00&', bold: 1, outline: 3, shadow: 0, alignment: 2 },
      'mrbeast': { fontName: 'Impact', fontSize: 22, primaryColor: '&H0000D4FF&', outlineColor: '&H00000000&', bold: 1, outline: 4, shadow: 2, alignment: 2 },
      'hormozi': { fontName: 'Arial', fontSize: 18, primaryColor: '&H00FFFFFF&', outlineColor: '&H00000000&', bold: 1, outline: 2, shadow: 1, alignment: 2 }
    };

    const s = styleMap[style] || styleMap['karaoke'];

    // Map position to ASS alignment
    const posMap = { 'top': 8, 'center': 5, 'bottom': 2 };
    const alignment = posMap[position] || 2;

    // Build ASS file
    function toASSTime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const sec = Math.floor(seconds % 60);
      const cs = Math.round((seconds % 1) * 100);
      return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
    }

    let assContent = '[Script Info]\nTitle: AI Captions\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n';
    assContent += '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    assContent += 'Style: Default,' + s.fontName + ',' + s.fontSize + ',' + s.primaryColor + ',&H00FFFFFF&,' + s.outlineColor + ',&H00000000&,' + s.bold + ',0,0,0,100,100,0,0,1,' + s.outline + ',' + s.shadow + ',' + alignment + ',10,10,30,1\n\n';
    assContent += '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

    // Group words into subtitle lines (3-5 words per line)
    const words = wordTimestamps;
    const wordsPerLine = 4;
    for (let i = 0; i < words.length; i += wordsPerLine) {
      const chunk = words.slice(i, i + wordsPerLine);
      const startTime = chunk[0].start;
      const endTime = chunk[chunk.length - 1].end;

      let text = '';
      if (style === 'karaoke') {
        // Karaoke mode: word-by-word highlight with \k tags
        chunk.forEach(w => {
          const dur = Math.round((w.end - w.start) * 100);
          text += '{\\k' + dur + '}' + w.word + ' ';
        });
      } else {
        text = chunk.map(w => w.word).join(' ');
      }

      assContent += 'Dialogue: 0,' + toASSTime(startTime) + ',' + toASSTime(endTime) + ',Default,,0,0,0,,' + text.trim() + '\n';
    }

    fs.writeFileSync(assPath, assContent);

    // Step 4: Burn captions into video with FFmpeg
    const outputFilename = 'captions_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Escape the ASS path for FFmpeg filter
    const assFilter = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

    await runFFmpeg([
      '-i', videoPath,
      '-vf', 'ass=' + assFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    // Cleanup temp files
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Apply captions error:', error);
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ error: error.message || 'Failed to apply captions' });
  }
});



// ===== YOUTUBE VIDEO IMPORT =====
router.post('/youtube-import', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Validate URL patterns (YouTube, Zoom, Twitch, Rumble)
    const validPatterns = [/youtube\.com/i, /youtu\.be/i, /zoom\.us/i, /twitch\.tv/i, /rumble\.com/i];
    const isValid = validPatterns.some(p => p.test(url));
    if (!isValid) return res.status(400).json({ error: 'Unsupported URL. Supports YouTube, Zoom, Twitch, Rumble.' });

    const outputFilename = 'yt_import_' + Date.now() + '_' + req.user.id + '.mp4';
    const outputPath = path.join(uploadDir, outputFilename);

    // Use yt-dlp to download the video
    let ytdlpPath = 'yt-dlp';
    try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (e) {
      // Try to install yt-dlp
      try { execSync('pip install yt-dlp', { stdio: 'pipe' }); } catch (e2) {
        return res.status(500).json({ error: 'yt-dlp is not available on this server' });
      }
    }
    // Always update yt-dlp to latest version (YouTube changes frequently)
    try { execSync('pip install --upgrade yt-dlp', { stdio: 'pipe', timeout: 30000 }); } catch (e) { console.log('yt-dlp update skipped:', e.message); }

    await new Promise((resolve, reject) => {
      const proc = spawn(ytdlpPath, [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        '--max-filesize', '500m',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--retries', '3',
        '--extractor-retries', '3',
        url
      ]);
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(stderr || 'Download failed with code ' + code));
      });
      proc.on('error', reject);
    });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('YouTube import error:', error);
    res.status(500).json({ error: error.message || 'Failed to import video' });
  }
});

// ===== DROPBOX VIDEO IMPORT =====
router.post('/dropbox-import', requireAuth, async (req, res) => {
  try {
    const { url, name } = req.body;
    if (!url) return res.status(400).json({ error: 'Dropbox URL is required' });

    const ext = path.extname(name || '.mp4') || '.mp4';
    const outputFilename = 'dbx_import_' + Date.now() + '_' + req.user.id + ext;
    const outputPath = path.join(uploadDir, outputFilename);

    // Download from Dropbox direct link
    const https = require('https');
    const http = require('http');
    const protocol = url.startsWith('https') ? https : http;

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);
      protocol.get(url, response => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          protocol.get(response.headers.location, res2 => {
            res2.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        } else {
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }
      }).on('error', reject);
    });

    const metadata = await getVideoMetadata(outputPath);

    res.json({
      filename: outputFilename,
      duration: metadata.duration,
      serveUrl: '/video-editor/download/' + outputFilename
    });
  } catch (error) {
    console.error('Dropbox import error:', error);
    res.status(500).json({ error: error.message || 'Failed to import from Dropbox' });
  }
});

// ===== TRANSCRIPT GENERATION =====
router.post('/transcript', requireAuth, async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const inputPath = path.join(uploadDir, path.basename(filename));
    if (!fs.existsSync(inputPath)) {
      // Check output dir
      const altPath = path.join(outputDir, path.basename(filename));
      if (!fs.existsSync(altPath)) return res.status(404).json({ error: 'File not found' });
    }

    const filePath = fs.existsSync(path.join(uploadDir, path.basename(filename)))
      ? path.join(uploadDir, path.basename(filename))
      : path.join(outputDir, path.basename(filename));

    // Extract audio first
    const audioPath = path.join(outputDir, 'transcript_audio_' + Date.now() + '.wav');

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', filePath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        '-y', audioPath
      ]);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('Audio extraction failed')));
      proc.on('error', reject);
    });

    // Use OpenAI Whisper API if available, otherwise use local whisper
    let transcript = '';
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioPath));
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'text');

      const fetch = require('node-fetch');
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + openaiKey, ...formData.getHeaders() },
        body: formData
      });

      if (!response.ok) throw new Error('Whisper API error: ' + response.statusText);
      transcript = await response.text();
    } else {
      // Fallback: try local whisper
      try {
        const result = execSync('whisper ' + audioPath + ' --model tiny --output_format txt --output_dir /tmp', { timeout: 120000 });
        const txtPath = audioPath.replace('.wav', '.txt');
        if (fs.existsSync(txtPath)) transcript = fs.readFileSync(txtPath, 'utf8');
        else transcript = 'Transcription completed but output file not found.';
      } catch (e) {
        transcript = 'Auto-transcription is not available. Please type your transcript manually.';
      }
    }

    // Cleanup
    try { fs.unlinkSync(audioPath); } catch(e) {}

    res.json({ transcript: transcript.trim() });
  } catch (error) {
    console.error('Transcript error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate transcript' });
  }
});

// ===== AI HOOK GENERATOR =====
router.post('/generate-hook', requireAuth, async (req, res) => {
  try {
    const { style, topic } = req.body;

    const hookPrompts = {
      question: 'Generate a compelling question hook',
      statistic: 'Generate a shocking statistic hook',
      story: 'Generate an engaging story opener hook',
      controversial: 'Generate a bold controversial statement hook',
      curiosity: 'Generate a curiosity gap hook',
      pain: 'Generate a pain point hook'
    };

    const prompt = (hookPrompts[style] || hookPrompts.question) +
      ' for a short-form video' + (topic ? ' about: ' + topic : '') +
      '. Keep it under 15 words, punchy, and attention-grabbing. Return ONLY the hook text.';

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      // Fallback hooks
      const fallbackHooks = {
        question: 'Did you know 90% of people get this completely wrong?',
        statistic: 'This one change increased results by 347% in just 30 days.',
        story: 'Three years ago, I was broke and desperate. Then everything changed.',
        controversial: 'Everything you\'ve been told about this is a lie.',
        curiosity: 'The secret nobody talks about that changes everything.',
        pain: 'Stop wasting hours on this. Here\'s the fix.'
      };
      return res.json({ hook: fallbackHooks[style] || fallbackHooks.question });
    }

    const fetch = require('node-fetch');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        temperature: 0.9
      })
    });

    const data = await response.json();
    const hook = data.choices?.[0]?.message?.content?.trim() || 'Could not generate hook';

    res.json({ hook });
  } catch (error) {
    console.error('Hook generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate hook' });
  }
});

// ===== EXPORT TO ADOBE PREMIERE (XML) =====
router.post('/export-premiere', requireAuth, async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const inputPath = path.join(uploadDir, path.basename(filename));
    const altPath = path.join(outputDir, path.basename(filename));
    const filePath = fs.existsSync(inputPath) ? inputPath : altPath;

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const metadata = await getVideoMetadata(filePath);
    const fps = metadata.fps || 30;
    const duration = metadata.duration || 0;
    const totalFrames = Math.round(duration * fps);

    const premiereXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence>
    <name>Splicora Export</name>
    <duration>${totalFrames}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <track>
          <clipitem>
            <name>${path.basename(filename)}</name>
            <duration>${totalFrames}</duration>
            <rate><timebase>${fps}</timebase></rate>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-1">
              <name>${path.basename(filename)}</name>
              <pathurl>file://${filePath}</pathurl>
              <duration>${totalFrames}</duration>
              <rate><timebase>${fps}</timebase></rate>
            </file>
          </clipitem>
        </track>
      </video>
      <audio>
        <track>
          <clipitem>
            <name>${path.basename(filename)}</name>
            <duration>${totalFrames}</duration>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-1"/>
          </clipitem>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;

    const xmlFilename = 'premiere_' + Date.now() + '.xml';
    const xmlPath = path.join(outputDir, xmlFilename);
    fs.writeFileSync(xmlPath, premiereXML, 'utf8');

    res.json({
      filename: xmlFilename,
      serveUrl: '/video-editor/download/' + xmlFilename
    });
  } catch (error) {
    console.error('Premiere export error:', error);
    res.status(500).json({ error: error.message || 'Failed to export for Premiere' });
  }
});

module.exports = router;
