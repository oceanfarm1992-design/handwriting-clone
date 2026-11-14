import { PAGE, CHARS, drawTemplate } from './template.js';
import { extractGlyphs } from './extract.js';
import { buildFont, renderDocument, DEFAULTS } from './render.js';
import { importText, loadJsPdf } from './importers.js';
import { serialize, deserialize, saveLocal, loadLocal, clearLocal } from './profile.js';
import { makeDemoScan } from './demo.js';

const $ = (id) => document.getElementById(id);
const state = { glyphs: [], seed: 1, opts: { ...DEFAULTS }, pages: [] };

const SAMPLE_TEXT = `Notes for the exam

The quick brown fox jumps over the lazy dog. Photosynthesis turns light, water and carbon dioxide into glucose (C6H12O6) and oxygen.

Key dates: 1066, 1492, 1789 & 1969!
Remember - revision works best when you write it yourself.`;

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
  saveLocal(state.glyphs);
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
  setStatus('Building demo handwriting…');
  await wait();
  state.glyphs = [];
  for (const v of [0, 1]) {
    const { glyphs } = extractGlyphs(makeDemoScan(v));
    state.glyphs.push(...glyphs);
  }
  onGlyphsChanged();
  setStatus('Demo handwriting loaded (a script font, not yours). Upload your own scans to replace it.', 'ok');
}

function renderGallery() {
  const grid = $('glyphGrid');
  grid.textContent = '';
  const order = new Map(CHARS.map((c, i) => [c, i]));
  const sorted = [...state.glyphs].sort((a, b) => (order.get(a.ch) ?? 999) - (order.get(b.ch) ?? 999));
  for (const g of sorted) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.title = `Remove this "${g.ch}"`;
    b.setAttribute('aria-label', `Remove this sample of ${g.ch}`);
    const c = document.createElement('canvas');
    c.width = 44;
    c.height = 44;
    const s = Math.min(38 / g.canvas.width, 38 / g.canvas.height, 1);
    const ctx = c.getContext('2d');
    ctx.drawImage(g.canvas, (44 - g.canvas.width * s) / 2, (44 - g.canvas.height * s) / 2, g.canvas.width * s, g.canvas.height * s);
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
    state.opts[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
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
  const font = buildFont(state.glyphs);
  const { pages, missing, truncated } = renderDocument(text, font, state.opts, state.seed);
  state.pages = pages;
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
    dl.addEventListener('click', async () => saveBlob(await canvasToBlob(canvas), `handwritten-page-${i + 1}.png`));
    cap.append(label, dl);
    fig.append(canvas, cap);
    holder.append(fig);
  });
  const notes = [];
  if (missing.length) notes.push(`No sample for: ${missing.join(' ')} (skipped).`);
  if (truncated) notes.push(`Preview limited to ${state.opts.maxPages} pages.`);
  $('warn').textContent = notes.join(' ');
}

async function exportPdf() {
  if (!state.pages.length) return;
  setStatus('Building PDF…');
  try {
    const jsPDF = await loadJsPdf();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    state.pages.forEach((c, i) => {
      if (i) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    });
    pdf.save('handwritten.pdf');
    setStatus('PDF saved.', 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
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
  $('clearBtn').addEventListener('click', () => {
    state.glyphs = [];
    clearLocal();
    onGlyphsChanged();
    setStatus('Handwriting removed from this browser.', 'ok');
  });
  $('saveProfileBtn').addEventListener('click', () => {
    saveBlob(new Blob([serialize(state.glyphs)], { type: 'application/json' }), 'my-handwriting.json');
  });
  $('loadProfileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.glyphs = await deserialize(await file.text());
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
    readOptions();
    schedulePreview(0);
  });

  $('text').value = SAMPLE_TEXT;
  readOptions();
  renderGallery();
  renderPreview();
  loadLocal().then((glyphs) => {
    if (glyphs.length) {
      state.glyphs = glyphs;
      renderGallery();
      renderPreview();
      setStatus(`Restored ${glyphs.length} saved samples from this browser.`, 'ok');
    }
  });
}

init();
