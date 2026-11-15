import { PAGE, CHARS, drawTemplate } from './template.js';
import { extractGlyphs } from './extract.js';
import { buildFont, renderDocument, DEFAULTS } from './render.js';
import { importText, loadJsPdf } from './importers.js';
import { serialize, deserialize, saveLocal, loadLocal, clearLocal } from './profile.js';
import { makeDemoScan, loadSampleFont, SAMPLE_STYLES } from './demo.js';
import { initDrawing } from './drawui.js';
import { initPhoto } from './photoui.js';
import { metrics, signature, reviewSamples, usableSamples } from './quality.js';

const $ = (id) => document.getElementById(id);
// style = spacing learned from the user's own writing (saved with the profile)
const state = { glyphs: [], style: {}, seed: 1, opts: { ...DEFAULTS }, pages: [] };

function applyStyle(style) {
  state.style = { ...style };
  for (const [k, v] of Object.entries(style)) {
    const el = document.querySelector(`[data-opt="${k}"]`);
    if (el) el.value = v;
  }
  readOptions();
}

const SAMPLE_TEXT = `# 03. Photosynthesis

Meaning :- the process plants use to turn light, water and carbon dioxide into glucose (C6H12O6) and oxygen.

Main stages :-
1. Light reactions take place in the thylakoids and make ATP and NADPH.
2. The Calvin cycle uses that energy to fix carbon dioxide into sugar.

Factors that affect the rate :-
- Light intensity, carbon dioxide level and __temperature__.
- Water supply; results are checked weekly, ~~daily~~ or monthly.

| Subject | Hours | Topic |
| Biology | 4 | Photosynthesis and respiration |
| History | 3 | Key dates of the Middle Ages |
| Maths | 5 | Algebra |`;

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function setStatus(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.dataset.kind = kind;
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const canvasToBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));

/* ---------- Step 1: template + capture ---------- */

async function downloadTemplate(kind) {
  const c = document.createElement('canvas');
  c.width = PAGE.w;
  c.height = PAGE.h;
  const ctx = c.getContext('2d');
  try {
    if (kind === 'png') {
      drawTemplate(ctx, 'Set A');
      saveBlob(await canvasToBlob(c), 'handwriting-template.png');
    } else {
      setStatus('Preparing the PDF…');
      const jsPDF = await loadJsPdf();
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      ['Set A', 'Set B'].forEach((label, i) => {
        drawTemplate(ctx, label);
        if (i) pdf.addPage();
        pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297);
      });
      pdf.save('handwriting-template.pdf');
      setStatus('Template downloaded. Print both pages and fill them in.', 'ok');
    }
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

function addGlyphs(list) {
  state.glyphs.push(...list);
  onGlyphsChanged();
}

function onGlyphsChanged() {
  saveLocal(state.glyphs, state.style);
  renderGallery();
  schedulePreview(0);
}

async function handleScans(files) {
  let total = 0;
  for (const file of files) {
    setStatus(`Reading ${file.name}…`);
    await wait();
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error(`${file.name} is not an image the browser can open.`));
        im.src = url;
      });
      const { glyphs, missing, foundMarkers } = extractGlyphs(img);
      total += glyphs.length;
      addGlyphs(glyphs);
      const notes = [];
      if (!foundMarkers) notes.push('could not find the four black corner squares, so the page was only stretched to fit (results may be off)');
      if (missing.length) notes.push(`empty boxes: ${missing.join(' ')}`);
      setStatus(`${file.name}: captured ${glyphs.length} characters${notes.length ? ' - ' + notes.join('; ') : ''}.`, notes.length ? 'warn' : 'ok');
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return total;
}

async function useDemo() {
  const style = SAMPLE_STYLES.find((x) => x.id === $('sampleSelect').value) || SAMPLE_STYLES[0];
  setStatus(`Loading sample handwriting: ${style.name}…`);
  await wait();
  try {
    const family = await loadSampleFont(style);
    const glyphs = [];
    for (const v of [0, 1]) glyphs.push(...extractGlyphs(makeDemoScan(v, family)).glyphs);
    state.glyphs = glyphs;
    state.style = {};
    onGlyphsChanged();
    setStatus(`Sample handwriting loaded: ${style.name}. It is a handwriting font, not yours; capture your own to replace it.`, 'ok');
  } catch (e) {
    setStatus(e.message || 'Could not load that sample.', 'error');
  }
}

// ---- sample checker: flag samples that would print wrongly ----
const sigCache = new WeakMap();
function sigOf(g) {
  if (!sigCache.has(g)) {
    const { width: w, height: h } = g.canvas;
    const d = g.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    sigCache.set(g, signature(a, w, h, 255));
  }
  return sigCache.get(g);
}

/** Check every sample; returns a Map from sample to its list of problems (empty = fine). */
function reviewGlyphs() {
  const flags = new Map();
  if (!state.glyphs.length) return flags;
  const font = buildFont(state.glyphs);
  const reasons = reviewSamples(state.glyphs.map((g) => ({ ch: g.ch, m: metrics(g, font.xHeight / (g.norm || 1)), sig: sigOf(g) })));
  state.glyphs.forEach((g, i) => flags.set(g, reasons[i]));
  return flags;
}

/** The samples used for writing: flagged ones are left out where a better sample exists. */
function writingGlyphs() {
  if (!$('skipFlagged').checked || !state.flags) return state.glyphs;
  return usableSamples(state.glyphs, state.glyphs.map((g) => state.flags.get(g) || []));
}

function renderGallery() {
  const grid = $('glyphGrid');
  grid.textContent = '';
  state.flags = reviewGlyphs();
  const font = state.glyphs.length ? buildFont(state.glyphs) : null;
  const order = new Map(CHARS.map((c, i) => [c, i]));
  const sorted = [...state.glyphs].sort((a, b) => (order.get(a.ch) ?? 999) - (order.get(b.ch) ?? 999));
  for (const g of sorted) {
    const problems = state.flags.get(g) || [];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = problems.length ? 'tile flagged' : 'tile';
    b.title = problems.length ? `${problems.join('; ')}. Click to remove it.` : `Remove this "${g.ch}"`;
    b.setAttribute('aria-label', `${problems.length ? `Possible problem: ${problems.join('; ')}. ` : ''}Remove this sample of ${g.ch}`);
    // drawn at its real size on a baseline, so a letter that floats or lacks its tail is visible
    const c = document.createElement('canvas');
    c.width = 44;
    c.height = 44;
    const ctx = c.getContext('2d');
    const BASE = 30;
    const s = Math.min(12 / (font.xHeight / (g.norm || 1)), 40 / g.canvas.width);
    ctx.strokeStyle = 'rgba(70,115,175,0.45)';
    ctx.beginPath();
    ctx.moveTo(0, BASE + 0.5);
    ctx.lineTo(44, BASE + 0.5);
    ctx.stroke();
    ctx.drawImage(g.canvas, (44 - g.canvas.width * s) / 2, BASE + (g.yOff - (g.canvas.height - g.pad)) * s, g.canvas.width * s, g.canvas.height * s);
    b.append(c);
    b.addEventListener('click', () => {
      state.glyphs = state.glyphs.filter((x) => x !== g);
      onGlyphsChanged();
    });
    grid.append(b);
  }
  const have = new Set(state.glyphs.map((g) => g.ch));
  const n = CHARS.filter((c) => have.has(c)).length;
  $('glyphSummary').textContent = state.glyphs.length
    ? `${state.glyphs.length} samples covering ${n} of ${CHARS.length} characters. Click a sample to remove it.`
    : 'No handwriting yet.';
  const flagged = state.glyphs.filter((g) => (state.flags.get(g) || []).length);
  $('flagNote').hidden = !flagged.length;
  if (flagged.length) {
    const chars = [...new Set(flagged.map((g) => g.ch))].join(' ');
    $('flagText').textContent = `${flagged.length} sample${flagged.length > 1 ? 's' : ''} may print wrongly (red border; hover or long-press to see why): ${chars}`;
  }
  $('clearBtn').disabled = !state.glyphs.length;
  $('saveProfileBtn').disabled = !state.glyphs.length;
}

/* ---------- Step 2: document ---------- */

async function handleDocument(file) {
  setStatus(`Reading ${file.name}…`);
  try {
    const text = (await importText(file)).trim();
    if (!text) throw new Error('No text found. A scanned PDF has no text layer; try a PDF or Word file with selectable text.');
    $('text').value = text;
    setStatus(`Loaded ${file.name} (${text.length.toLocaleString()} characters).`, 'ok');
    schedulePreview(0);
  } catch (e) {
    setStatus(e.message || String(e), 'error');
  }
}

/* ---------- Step 3/4: style + preview ---------- */

function readOptions() {
  document.querySelectorAll('[data-opt]').forEach((el) => {
    const k = el.dataset.opt;
    state.opts[k] =
      el.type === 'checkbox' ? el.checked
      : el.type === 'range' ? parseFloat(el.value)
      : el.type === 'number' ? Math.max(0, parseInt(el.value, 10) || 0)
      : el.value;
    const out = document.querySelector(`[data-out="${k}"]`);
    if (out) out.textContent = el.value;
  });
}

let timer = 0;
function schedulePreview(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(renderPreview, delay);
}

function renderPreview() {
  const holder = $('pages');
  holder.textContent = '';
  state.pages = [];
  $('warn').textContent = '';
  const has = state.glyphs.length > 0;
  $('exportRow').hidden = !has;
  if (!has) {
    holder.innerHTML = '<p class="empty">Add your handwriting in step 1 (or load the demo) to see a preview here.</p>';
    return;
  }
  const text = $('text').value;
  if (!text.trim()) {
    holder.innerHTML = '<p class="empty">Type or upload some text in step 2.</p>';
    return;
  }
  const font = buildFont(writingGlyphs());
  let { pages, missing, truncated } = renderDocument(text, font, state.opts, state.seed);
  let usedOpts = state.opts; // the exact settings of what is shown, so printing can redraw it
  // Page limit: shrink the writing (size and line height together) just enough to fit.
  const target = state.opts.fitPages;
  let fitNote = '';
  if (target > 0 && (pages.length > target || truncated)) {
    const at = (f, quick) =>
      renderDocument(
        text,
        font,
        { ...state.opts, xHeight: state.opts.xHeight * f, lineHeight: state.opts.lineHeight * f, ...(quick ? { photo: false } : {}) },
        state.seed,
      );
    const fits = (r) => r.pages.length <= target && !r.truncated;
    const MIN = 0.55; // below this the writing stops being comfortably readable
    let f = MIN;
    if (fits(at(MIN, true))) {
      let lo = MIN;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (fits(at(mid, true))) lo = mid;
        else hi = mid;
      }
      f = lo;
      fitNote = `Writing shrunk to ${Math.round(f * 100)}% to fit ${target} page${target === 1 ? '' : 's'}.`;
    }
    ({ pages, missing, truncated } = at(f, false));
    usedOpts = { ...state.opts, xHeight: state.opts.xHeight * f, lineHeight: state.opts.lineHeight * f };
    if (!fitNote) {
      fitNote = `This needs ${pages.length}${truncated ? '+' : ''} pages even at the smallest readable size (${Math.round(MIN * 100)}%), more than your limit of ${target}.`;
    }
  }
  state.pages = pages;
  state.lastRender = { text, font, opts: usedOpts, seed: state.seed };
  pages.forEach((canvas, i) => {
    const fig = document.createElement('figure');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${i + 1} of ${pages.length}`);
    const cap = document.createElement('figcaption');
    const label = document.createElement('span');
    label.textContent = `Page ${i + 1} of ${pages.length}`;
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'link';
    dl.textContent = 'Save PNG';
    dl.addEventListener('click', () => savePagePng(i));
    cap.append(label, dl);
    fig.append(canvas, cap);
    holder.append(fig);
  });
  const notes = [];
  if (missing.length) notes.push(`No sample for: ${missing.join(' ')} (skipped).`);
  if (fitNote) notes.push(fitNote);
  if (truncated) notes.push(`Preview limited to ${state.opts.maxPages} pages.`);
  $('warn').textContent = notes.join(' ');
}

// Print quality: the pages are drawn again at 300 dpi (twice the preview) and stored as lossless
// PNG, so printed letters have clean edges with no blur or JPEG smudges around the strokes.
const PRINT_RATIO = 2;
function renderForPrint(onPage) {
  const r = state.lastRender;
  if (!r) return 0;
  let n = 0;
  renderDocument(r.text, r.font, { ...r.opts, pixelRatio: PRINT_RATIO, onPage: (c, i) => (n++, onPage(c, i)) }, r.seed);
  return n;
}

async function exportPdf() {
  if (!state.pages.length) return;
  setStatus('Building a print-quality PDF (300 dpi)…');
  await wait();
  try {
    const jsPDF = await loadJsPdf();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    renderForPrint((c, i) => {
      if (i) pdf.addPage();
      pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    });
    pdf.save('handwritten.pdf');
    setStatus('Print-quality PDF saved (300 dpi). Print at 100% / "Actual size" for the sharpest result.', 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function savePagePng(index) {
  setStatus('Saving page at 300 dpi…');
  await wait();
  let blob = null;
  renderForPrint((c, i) => {
    if (i === index) blob = canvasToBlob(c);
  });
  if (blob) saveBlob(await blob, `handwritten-page-${index + 1}.png`);
  setStatus('Page saved as a 300 dpi PNG.', 'ok');
}

// Apply spacing measured from the user's own writing (on-screen sentences or a photo).
function applyLearned(r, quiet = false) {
  applyStyle({ ...state.style, ...r });
  saveLocal(state.glyphs, state.style);
  schedulePreview(0);
  if (quiet) return;
  const parts = [`word spacing ${r.wordSpacing}`];
  if (r.letterSpacing !== undefined) parts.unshift(`letter spacing ${r.letterSpacing}`);
  else parts.push('(write your letters first to learn letter spacing too)');
  setStatus(`Learned from your writing: ${parts.join(', ')}.`, 'ok');
}

/* ---------- wiring ---------- */

function init() {
  $('tplPdf').addEventListener('click', () => downloadTemplate('pdf'));
  $('tplPng').addEventListener('click', () => downloadTemplate('png'));
  $('scanInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await handleScans(files);
  });
  $('demoBtn').addEventListener('click', useDemo);
  $('skipFlagged').addEventListener('change', () => schedulePreview(0));
  $('removeFlagged').addEventListener('click', () => {
    const before = state.glyphs.length;
    state.glyphs = state.glyphs.filter((g) => !(state.flags.get(g) || []).length);
    onGlyphsChanged();
    setStatus(`Removed ${before - state.glyphs.length} flagged samples. Write those characters again on screen to replace them.`, 'ok');
  });
  $('clearBtn').addEventListener('click', () => {
    state.glyphs = [];
    state.style = {};
    clearLocal();
    onGlyphsChanged();
    setStatus('Handwriting removed from this browser.', 'ok');
  });
  $('saveProfileBtn').addEventListener('click', () => {
    saveBlob(new Blob([serialize(state.glyphs, state.style)],{ type: 'application/json' }), 'my-handwriting.json');
  });
  $('loadProfileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { glyphs, style } = await deserialize(await file.text());
      state.glyphs = glyphs;
      applyStyle(style);
      onGlyphsChanged();
      setStatus(`Loaded ${state.glyphs.length} samples from ${file.name}.`, 'ok');
    } catch (err) {
      setStatus(err.message || 'Could not read that profile file.', 'error');
    }
  });
  $('docInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await handleDocument(file);
  });
  $('text').addEventListener('input', () => schedulePreview());
  document.querySelectorAll('[data-opt]').forEach((el) =>
    el.addEventListener('input', () => {
      readOptions();
      schedulePreview(120);
    }),
  );
  // One click to the look of real notes: plain white paper photographed with a phone.
  $('notesBtn').addEventListener('click', () => {
    const look = {
      paper: 'plain',
      paperColor: '#ffffff',
      ink: '#1c1d2b',
      jitter: 0.75,
      wordSpacing: Math.max(1.3, state.opts.wordSpacing),
      underlineHeadings: true,
      mistakes: true,
      photo: true,
    };
    for (const [k, v] of Object.entries(look)) {
      const el = document.querySelector(`[data-opt="${k}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
    readOptions();
    schedulePreview(0);
    setStatus('Study notes look applied: plain paper, dark ink, underlined headings, photo finish.', 'ok');
  });
  // Dense revision notes: two columns of small, tightly spaced writing that saves paper.
  $('saverBtn').addEventListener('click', () => {
    const look = {
      columns: '2',
      margins: 'narrow',
      paper: 'plain',
      paperColor: '#ffffff',
      marginLine: false,
      ink: '#1c1d2b',
      xHeight: 13,
      lineHeight: 33,
      letterSpacing: 0.06,
      wordSpacing: 0.85,
      paragraphSpacing: 0.25,
      jitter: 0.6,
      underlineHeadings: true,
    };
    for (const [k, v] of Object.entries(look)) {
      const el = document.querySelector(`[data-opt="${k}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
    readOptions();
    schedulePreview(0);
    setStatus('Paper saver applied: two columns of small, tightly spaced writing with narrow margins.', 'ok');
  });
  $('shuffleBtn').addEventListener('click', () => {
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    schedulePreview(0);
  });
  $('pdfBtn').addEventListener('click', exportPdf);
  $('resetBtn').addEventListener('click', () => {
    document.querySelectorAll('[data-opt]').forEach((el) => {
      const v = DEFAULTS[el.dataset.opt];
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    });
    state.style = {};
    saveLocal(state.glyphs, state.style);
    readOptions();
    schedulePreview(0);
  });

  initDrawing({
    getGlyphs: () => state.glyphs,
    addGlyph: (g) => {
      state.glyphs.push(g);
      onGlyphsChanged();
    },
    removeGlyph: (g) => {
      state.glyphs = state.glyphs.filter((x) => x !== g);
      onGlyphsChanged();
    },
    applyLearned,
    setStatus,
  });

  initPhoto({ addGlyphs, applyLearned });

  for (const st of SAMPLE_STYLES) $('sampleSelect').add(new Option(st.name, st.id));

  $('text').value = SAMPLE_TEXT;
  readOptions();
  renderGallery();
  renderPreview();
  loadLocal().then(({ glyphs, style }) => {
    if (glyphs.length) {
      state.glyphs = glyphs;
      applyStyle(style);
      renderGallery();
      renderPreview();
      setStatus(`Restored ${glyphs.length} saved samples from this browser.`, 'ok');
    }
  });
}

init();
