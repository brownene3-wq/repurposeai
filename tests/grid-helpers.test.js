// Ad-hoc unit tests for the Deploy 2 grid helpers.
// Intentionally does NOT require the full route module (which imports
// express/multer/etc. and has side-effects). Instead we extract the pure
// helpers with a tiny self-contained shim.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Pull the helpers out of ai-reframe.js by stripping the rest of the file.
// Cheap-and-cheerful: eval the file after stubbing `express`, `multer`, etc.
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ai-reframe.js'), 'utf8');

// Build a sandboxed module scope with minimal stubs.
const sandbox = {
  require: (name) => {
    if (name === 'express') return { Router: () => ({ get: () => {}, post: () => {} }) };
    if (name === 'multer') { const m = () => ({ single: () => (req, res, next) => next() }); m.diskStorage = () => ({}); return m; }
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    if (name === 'child_process') return require('child_process');
    if (name === 'axios') return () => {};
    return {};
  },
  module: { exports: {} },
  exports: {},
  console, process, Buffer, setInterval: () => ({ unref(){} }), setTimeout, clearTimeout,
};

// Execute the file in the sandbox and capture helpers by name. We do this by
// appending an `module.exports` block at the end of the source that re-exports
// the helper names we want to test.
const probe = `\nmodule.exports = { normalizeHexColor, computeGridCells, computeSubjectCropExpr, buildGridFilterGraph, GRID_OUT_W, GRID_OUT_H };\n`;
const wrapped = `(function(require, module, exports){\n${src}\n${probe}\n})`;

const factory = eval(wrapped);
factory(sandbox.require, sandbox.module, sandbox.exports);
const H = sandbox.module.exports;

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else    { fail++; console.log(`  FAIL ${name}${detail ? '  ('+detail+')' : ''}`); }
}

// ---------- normalizeHexColor ----------
t('normalizeHexColor: #rrggbb',  H.normalizeHexColor('#aabbcc', 'FALLBACK') === '0xaabbcc');
t('normalizeHexColor: rrggbb',   H.normalizeHexColor('AABBCC',  'FALLBACK') === '0xaabbcc');
t('normalizeHexColor: 0xrrggbb', H.normalizeHexColor('0x112233','FALLBACK') === '0x112233');
t('normalizeHexColor: bad',      H.normalizeHexColor('notacolor','FALLBACK') === 'FALLBACK');
t('normalizeHexColor: empty',    H.normalizeHexColor('',         'FALLBACK') === 'FALLBACK');

// ---------- computeGridCells ----------
const W = H.GRID_OUT_W, Hh = H.GRID_OUT_H;
function inside(c) { return c.x>=0 && c.y>=0 && c.x+c.w<=W && c.y+c.h<=Hh && c.w>20 && c.h>20; }
function noOverlap(cells) {
  for (let i=0;i<cells.length;i++) for (let j=i+1;j<cells.length;j++){
    const a=cells[i], b=cells[j];
    if (a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h) return false;
  }
  return true;
}

for (const pad of [0, 8, 16, 24]) {
  for (const n of [1,2,3,4]) {
    const cells = H.computeGridCells(n, pad);
    t(`cells n=${n} pad=${pad}: count`, cells.length === n);
    t(`cells n=${n} pad=${pad}: all inside viewport`, cells.every(inside));
    t(`cells n=${n} pad=${pad}: no overlap`, noOverlap(cells));
  }
}

// Spec-specific layout checks
const c2 = H.computeGridCells(2, 16);
t('n=2: cells are 1:1 squares', Math.abs(c2[0].w - c2[0].h) <= 1 && Math.abs(c2[1].w - c2[1].h) <= 1);
t('n=2: same width',            c2[0].w === c2[1].w);
t('n=2: stacked vertically',    c2[0].y < c2[1].y && Math.abs(c2[0].x - c2[1].x) <= 1);

const c3 = H.computeGridCells(3, 16);
t('n=3: top is wide (span close to full width)', c3[0].w > W * 0.9);
t('n=3: bottom two are squares',                 Math.abs(c3[1].w - c3[1].h) <= 1 && Math.abs(c3[2].w - c3[2].h) <= 1);
t('n=3: bottom two same size',                   c3[1].w === c3[2].w && c3[1].h === c3[2].h);

const c4 = H.computeGridCells(4, 16);
t('n=4: 2x2 - all same size',  c4.every(c => c.w === c4[0].w && c.h === c4[0].h));
t('n=4: row 1 y matches',      c4[0].y === c4[1].y);
t('n=4: row 2 y matches',      c4[2].y === c4[3].y);
t('n=4: col 1 x matches',      c4[0].x === c4[2].x);
t('n=4: col 2 x matches',      c4[1].x === c4[3].x);

// ---------- computeSubjectCropExpr ----------
function fakeSubject(samples) { return { id: 0, samples }; }
const subj = fakeSubject([
  { time: 0.0, cx: 0.4, cy: 0.5, w: 0.2, h: 0.25 },
  { time: 0.2, cx: 0.5, cy: 0.5, w: 0.2, h: 0.25 },
  { time: 0.4, cx: 0.6, cy: 0.5, w: 0.2, h: 0.25 },
  { time: 0.6, cx: 0.7, cy: 0.5, w: 0.2, h: 0.25 },
]);
const sub1 = H.computeSubjectCropExpr(subj, 1920, 1080, 500, 500);
t('subjectCrop: even crop dims', sub1.cropW % 2 === 0 && sub1.cropH % 2 === 0);
t('subjectCrop: crop dims > 0',  sub1.cropW > 0 && sub1.cropH > 0);
t('subjectCrop: xExpr is string and non-empty', typeof sub1.xExpr === 'string' && sub1.xExpr.length > 0);
t('subjectCrop: yExpr contains "if(between" for piecewise', sub1.yExpr.includes('if(between'));

// Subject with NO samples -> should return static center crop
const subEmpty = fakeSubject([]);
const subE = H.computeSubjectCropExpr(subEmpty, 1920, 1080, 500, 500);
t('subjectCrop: empty -> numeric xExpr', !isNaN(Number(subE.xExpr)));
t('subjectCrop: empty -> numeric yExpr', !isNaN(Number(subE.yExpr)));

// --- Multi-subject overlap guard (regression: both cells showed same person) ---
// Two subjects ~400px apart (cx=0.35 and cx=0.56 on a 1920px frame).
// The two crops must NOT overlap — if they do, both cells show the same
// middle-of-frame content.
const subjA = fakeSubject([
  { time: 0, cx: 0.35, cy: 0.5, w: 0.15, h: 0.2 },
  { time: 0.2, cx: 0.35, cy: 0.5, w: 0.15, h: 0.2 },
]);
const subjB = fakeSubject([
  { time: 0, cx: 0.56, cy: 0.5, w: 0.15, h: 0.2 },
  { time: 0.2, cx: 0.56, cy: 0.5, w: 0.15, h: 0.2 },
]);
const pxGap = Math.abs(0.56 - 0.35) * 1920; // ~403px

const clampedA = H.computeSubjectCropExpr(subjA, 1920, 1080, 540, 540, { neighborCx: 0.56 });
const clampedB = H.computeSubjectCropExpr(subjB, 1920, 1080, 540, 540, { neighborCx: 0.35 });
t('neighbor-clamp: A cropW < gap to neighbor', clampedA.cropW < pxGap,
  `cropW=${clampedA.cropW} gap=${pxGap.toFixed(0)}`);
t('neighbor-clamp: B cropW < gap to neighbor', clampedB.cropW < pxGap);

// Hard non-overlap: the right edge of A's crop must be STRICTLY LEFT of
// the left edge of B's crop (anything less and both cells show middle).
const centerA = 0.35 * 1920;
const centerB = 0.56 * 1920;
const aRight = centerA + clampedA.cropW / 2;
const bLeft  = centerB - clampedB.cropW / 2;
t('neighbor-clamp: NO overlap between A and B crops',
  aRight < bLeft,
  `aRight=${aRight.toFixed(0)} bLeft=${bLeft.toFixed(0)} overlap=${(aRight-bLeft).toFixed(0)}px`);

// Solo crop should be allowed to be larger than neighbor-clamped crop.
const solo = H.computeSubjectCropExpr(subjA, 1920, 1080, 540, 540);
t('solo mode: cropW >= clamped cropW', solo.cropW >= clampedA.cropW);

// --- Shoulder-up composition (regression: face was at ~62% from top, now ~30%) ---
// A single face at (0.5, 0.5), face size 0.15w/0.20h, cell is 1080x1920 (9:16).
// The computed y-position for the crop should place the face center at ~30% from top.
const soloTallCell = H.computeSubjectCropExpr(
  fakeSubject([{ time: 0, cx: 0.5, cy: 0.5, w: 0.15, h: 0.20 }]),
  1920, 1080, 1080, 1920
);
const yExprNum = Number(soloTallCell.yExpr);
// Face center in source = 0.5 * 1080 = 540px. Face center in crop = 540 - y.
// That should equal ~0.30 * cropH.
const faceCenterInCrop = 540 - yExprNum;
const faceFraction = faceCenterInCrop / soloTallCell.cropH;
t('shoulder-up: face center at ~30% from top of crop',
  faceFraction > 0.20 && faceFraction < 0.40,
  `faceFraction=${faceFraction.toFixed(3)} (y=${yExprNum} cropH=${soloTallCell.cropH})`);

// --- Shoulder-up actually sees shoulders: cropH should include space below face ---
// Face at cy=0.5 occupies 20% of frame height. Below the face, the crop
// should extend by at least ~0.7 * cropH (from the 30% face_top_fraction).
// That "below face" span must be much larger than the face itself.
t('shoulder-up: crop extends below face by more than the face itself',
  (soloTallCell.cropH - faceCenterInCrop) > 0.20 * 1080 * 1.2,
  `below=${soloTallCell.cropH - faceCenterInCrop} face=${(0.20*1080).toFixed(0)}`);

// --- Min-size floor (regression: tiny faces in wide shots produced pixelated cells) ---
const tinyFace = H.computeSubjectCropExpr(
  fakeSubject([{ time: 0, cx: 0.3, cy: 0.5, w: 0.04, h: 0.05 }]),
  1920, 1080, 540, 540
);
t('min-size: tiny face wide-shot crop not smaller than cell/2.5',
  tinyFace.cropW >= Math.round(540/2.5) - 2 && tinyFace.cropH >= Math.round(540/2.5) - 2,
  `cropW=${tinyFace.cropW} cropH=${tinyFace.cropH}`);

// Back-compat: passing a numeric 6th arg (used to be tightness) still works.
const legacy = H.computeSubjectCropExpr(subjA, 1920, 1080, 540, 540, 2.5);
t('back-compat: numeric 6th arg still accepted', legacy.cropW > 0);

// --- Decimation (regression: 192-sample clip produced 12KB expressions,
// ffmpeg failed with "Failed to configure input pad / Error reinitializing filters!") ---
// Build a synthetic subject with 250 samples and verify the generated
// expression stays under a sane length budget.
const bigSamples = [];
for (let i = 0; i < 250; i++) {
  bigSamples.push({ time: i * 0.25, cx: 0.5 + 0.1 * Math.sin(i / 10), cy: 0.5, w: 0.12, h: 0.16 });
}
const bigSubj = fakeSubject(bigSamples);
const bigRes = H.computeSubjectCropExpr(bigSubj, 1920, 1080, 540, 540);
t('decimation: 250-sample expression stays under 20k chars',
  bigRes.xExpr.length < 20000,
  `xExpr length=${bigRes.xExpr.length}`);
// Count nested if() as a proxy for keyframes
const ifCount = (bigRes.xExpr.match(/if\(between/g) || []).length;
t('decimation: at most 60 keyframes (nested if()s) in expression',
  ifCount <= 60,
  `ifCount=${ifCount}`);

// ---------- buildGridFilterGraph ----------
const subs = [subj, subj];
const cells2 = H.computeGridCells(2, 16);
const graph = H.buildGridFilterGraph(subs, cells2, { width: 1920, height: 1080 }, {
  padding: 16,
  border: { enabled: true, width: 4, color: '#ffffff' },
  background: { mode: 'blur' },
});
t('buildGraph: contains split filter',      graph.includes('split='));
t('buildGraph: contains overlay',           graph.includes('overlay='));
t('buildGraph: contains pad for border',    graph.includes('pad=') && graph.includes('color=0xffffff'));
t('buildGraph: contains blur path',         graph.includes('boxblur='));
t('buildGraph: produces [vout] final label',graph.includes('[vout]'));

// Verify graph syntax is at least parseable by ffmpeg by dry-running each variant.
function ffmpegParses(label, subjectsArr, cellsArr, cfg) {
  const g = H.buildGridFilterGraph(subjectsArr, cellsArr, { width: 1920, height: 1080 }, cfg);
  const tmp = '/tmp/_grid_graph.txt';
  fs.writeFileSync(tmp, g);
  try {
    execSync(
      `ffmpeg -hide_banner -v error -f lavfi -i testsrc2=size=1920x1080:rate=1:duration=0.2 -filter_complex_script ${tmp} -map '[vout]' -frames:v 1 -f null - 2>&1`,
      { stdio: 'pipe', timeout: 30000 }
    );
    t(`ffmpeg parses: ${label}`, true);
  } catch (e) {
    t(`ffmpeg parses: ${label}`, false, String(e.stdout || e.stderr || e.message).slice(0, 500));
  }
}

try {
  execSync('which ffmpeg', { stdio: 'ignore' });
  ffmpegParses('n=2 blur bg + border',   [subj, subj],                  H.computeGridCells(2, 16), { padding: 16, border: { enabled: true, width: 4, color: '#ffffff' }, background: { mode: 'blur' } });
  ffmpegParses('n=2 solid bg, no border',[subj, subj],                  H.computeGridCells(2, 16), { padding: 16, border: { enabled: false },                           background: { mode: 'solid', color: '#181426' } });
  ffmpegParses('n=3 solid bg + border',  [subj, subj, subj],            H.computeGridCells(3, 16), { padding: 16, border: { enabled: true, width: 3, color: '#6c3aed' }, background: { mode: 'solid', color: '#181426' } });
  ffmpegParses('n=4 blur bg + border',   [subj, subj, subj, subj],      H.computeGridCells(4, 16), { padding: 16, border: { enabled: true, width: 5, color: '#6c3aed' }, background: { mode: 'blur' } });
  ffmpegParses('n=1 solid bg no border', [subj],                        H.computeGridCells(1, 16), { padding: 16, border: { enabled: false },                           background: { mode: 'solid' } });
} catch {
  console.log('  skip ffmpeg graph parse (ffmpeg not installed)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
