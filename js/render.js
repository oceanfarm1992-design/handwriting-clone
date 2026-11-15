// Lays text out on A4 pages using the captured glyph library.
import { PAGE } from './template.js';
import { joinPoints } from './joins.js';
import { traceStrokes, strokeAnchors, blendStrokes, bendStrokes, smoothPath, coverage } from './strokes.js';

export const DEFAULTS = {
  ink: '#1f2a6b',
  xHeight: 22, // target x-height in px (150 dpi page)
  lineHeight: 58,
  letterSpacing: 0.12, // fraction of x-height
  wordSpacing: 1.0,
  jitter: 0.5, // 0..1 natural variation
  slant: 0, // degrees, positive leans right
  paper: 'ruled', // ruled | grid | dotted | plain
  paperColor: '#fdfcf6',
  marginLine: true,
  maxPages: 40,
  underlineHeadings: true, // pen-underline headings and labels like "Meaning :-"
  mistakes: false, // occasionally scribble out a false start
  photo: false, // make pages look like a phone photo of paper
  paragraphSpacing: 1, // height of a blank line between paragraphs, in lines
  fitPages: 0, // shrink writing to fit at most this many pages (0 = no limit); applied by the UI
  columns: 1, // 1, 2 or 3 columns per page
  margins: 'normal', // normal | narrow | minimal
  columnRule: false, // thin pen line between columns
  highlight: '#fff176', // highlighter colour for ==marked== text
  joins: 'off', // joined writing: off | some | most | all
  reshape: true, // gently bend and stretch letters so repeats are never identical
  drawMode: 'ink', // ink: the letters as captured | pen: redrawn from pen strokes (crisp, joins flow)
  pixelRatio: 1, // 1 = 150 dpi (screen preview); 2 = 300 dpi (printing)
  onPage: null, // optional callback(canvas, index): pages are handed over one at a time and not kept
  onlyPage: -1, // when >= 0, lay out everything but draw only this page (fast single-page export)
};

const MARGINS = {
  normal: { left: 140, right: 90, top: 150, bottom: 110 },
  narrow: { left: 80, right: 55, top: 95, bottom: 70 },
  minimal: { left: 40, right: 30, top: 50, bottom: 40 },
};
const marginsFor = (o) => MARGINS[o.margins] || MARGINS.normal;
const X_LETTERS = 'acemnorsuvwxz';
const LIST_RE = /^\s*(-|\d{1,3}[.)]|[a-zA-Z][.)])\s+\S/;

const CHAR_MAP = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  ' ': ' ', '•': '-', '×': '*', '÷': '/', '·': '.',
  '…': '...', '©': '(c)', '→': '->', '←': '<-',
};

export function normalizeText(text) {
  let out = '';
  for (const raw of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    if (CHAR_MAP[raw] !== undefined) {
      out += CHAR_MAP[raw];
    } else if (raw.charCodeAt(0) > 127) {
      const base = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base;
    } else {
      out += raw;
    }
  }
  return out;
}

export function buildFont(glyphs) {
  const byChar = new Map();
  for (const g of glyphs) {
    if (!byChar.has(g.ch)) byChar.set(g.ch, []);
    byChar.get(g.ch).push(g);
  }
  // Scanned and on-screen samples are captured at different sizes. Measure each source's
  // x-height separately and give every glyph a factor (g.norm) that brings it to a common size.
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const sourceXh = (list) =>
    median(list.filter((g) => g.ch.length === 1 && X_LETTERS.includes(g.ch)).map((g) => g.inkH)) ??
    median(list.filter((g) => g.ch.length === 1).map((g) => g.inkH)) ??
    median(list.map((g) => g.inkH));
  const groups = new Map();
  for (const g of glyphs) {
    const k = g.src || 'scan';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  let xHeight = 30;
  let biggest = 0;
  for (const list of groups.values()) {
    if (list.length > biggest) {
      biggest = list.length;
      xHeight = sourceXh(list) || 30;
    }
  }
  for (const list of groups.values()) {
    const xh = sourceXh(list) || xHeight;
    for (const g of list) g.norm = xHeight / xh;
  }
  return { byChar, xHeight };
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tintCache = new WeakMap();
function tinted(glyph, color) {
  let m = tintCache.get(glyph);
  if (!m) tintCache.set(glyph, (m = new Map()));
  let c = m.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = glyph.canvas.width;
    c.height = glyph.canvas.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(glyph.canvas, 0, 0);
    m.set(color, c);
  }
  return c;
}


// ---------- joined writing ----------
const JOIN_P = { off: 0, some: 0.4, most: 0.75, all: 1 };
const joinable = (ch) => /^[a-z]{1,2}$/.test(ch);

/** Entry/exit points of a sample (cached). xhSrc is the x-height in the sample's own pixels. */
const anchorCache = new WeakMap();
function anchorsOf(g, xhSrc) {
  if (!anchorCache.has(g)) {
    const { width: w, height: h } = g.canvas;
    const data = g.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    anchorCache.set(g, joinPoints(alpha, w, h, { base: h - g.pad - g.yOff, xh: xhSrc, scaleMax: 255 }));
  }
  return anchorCache.get(g);
}

/**
 * Two reshaped copies of a sample: rows sway sideways, columns sway up and down, and the width
 * changes a little, the way the same letter never comes out quite the same twice.
 * Each copy keeps a `map` from original to reshaped coordinates so join points follow the ink.
 */
const variantCache = new WeakMap();
function variantsOf(g) {
  if (!variantCache.has(g)) {
    const r = mulberry32(((g.id || 1) * 7919) ^ 0x5bd1);
    const list = [];
    for (let k = 0; k < 2; k++) {
      const { width: w, height: h } = g.canvas;
      const A = (0.5 + r()) * Math.min(2.2, h * 0.03);
      const B = (0.5 + r()) * Math.min(1.6, h * 0.02);
      const f1 = 0.6 + r() * 0.8;
      const f2 = 0.6 + r() * 0.8;
      const p1 = r() * Math.PI * 2;
      const p2 = r() * Math.PI * 2;
      const sx = 1 + (r() - 0.5) * 0.12;
      const M = 3;
      const W = Math.ceil(w * Math.max(1, sx)) + 2 * M;
      const H = h + 2 * M;
      const dx = (y) => A * Math.sin(p1 + (y / h) * Math.PI * 2 * f1);
      const dy = (x) => B * Math.sin(p2 + (x / W) * Math.PI * 2 * f2);
      const c1 = document.createElement('canvas');
      c1.width = W;
      c1.height = H;
      const x1c = c1.getContext('2d');
      for (let y = 0; y < h; y++) x1c.drawImage(g.canvas, 0, y, w, 1, M + g.pad * (1 - sx) + dx(y), y + M, w * sx, 1);
      const c2 = document.createElement('canvas');
      c2.width = W;
      c2.height = H;
      const x2c = c2.getContext('2d');
      for (let x = 0; x < W; x++) x2c.drawImage(c1, x, 0, 1, H, x, dy(x), 1, H);
      const map = (x, y) => {
        const nx = M + g.pad + (x - g.pad) * sx + dx(y);
        return [nx, y + M + dy(nx)];
      };
      list.push({ ...g, canvas: c2, pad: g.pad + M, inkW: g.inkW * sx, base: g, map });
    }
    variantCache.set(g, list);
  }
  return variantCache.get(g);
}


// ---------- letters as pen strokes ----------
const PEN_W = 4; // on-screen pen width in pad units (same as drawpad.js)

/**
 * A sample's pen strokes in reference units: baseline at y = 0, left of the ink at x = 0, scaled by
 * g.norm to the common size. On-screen samples use the strokes as written (with pen pressure);
 * scanned and photographed samples are traced from their image.
 */
const refCache = new WeakMap();
function refStrokesOf(g) {
  const k = g.norm || 1;
  const hit = refCache.get(g);
  if (hit && hit.k === k) return hit.ref;
  const { width: w, height: h } = g.canvas;
  const base = h - g.pad - g.yOff;
  let strokes;
  if (Array.isArray(g.strokes) && g.strokes.length) {
    // pad units -> sample pixels, with the same origin glyphFromStrokes used for the image
    const pts = g.strokes.flat();
    const half = (PEN_W * 1.45) / 2 + 0.5;
    const ox = Math.floor(Math.min(...pts.map((q) => q.x)) - half) - g.pad;
    const oy = Math.floor(Math.min(...pts.map((q) => q.y)) - half) - g.pad;
    strokes = g.strokes.filter((st) => st.length).map((st) => ({ pts: st.map((q) => ({ x: q.x - ox, y: q.y - oy, w: PEN_W * (0.55 + 0.9 * (q.p ?? 0.5)) })) }));
  } else {
    const data = g.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    strokes = traceStrokes(alpha, w, h, { scaleMax: 255 });
    // a trace that misses part of the letter would change what it says: use the ink instead
    if (coverage(strokes, alpha, w, h, { scaleMax: 255 }) < 0.85) strokes = [];
  }
  const ref = strokes.map((st) => ({ pts: st.pts.map((q) => ({ x: (q.x - g.pad) * k, y: (q.y - base) * k, w: q.w * k })) }));
  refCache.set(g, { k, ref });
  return ref;
}

function drawPaper(ctx, o) {
  const MARGIN = marginsFor(o);
  ctx.fillStyle = o.paperColor;
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  const first = MARGIN.top + o.lineHeight;
  const lastY = PAGE.h - MARGIN.bottom + 20;
  ctx.lineWidth = 1.5;
  if (o.paper === 'ruled') {
    ctx.strokeStyle = 'rgba(70,115,175,0.38)';
    for (let y = first + 8; y < lastY; y += o.lineHeight) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PAGE.w, y);
      ctx.stroke();
    }
  } else if (o.paper === 'grid') {
    ctx.strokeStyle = 'rgba(70,115,175,0.25)';
    const step = o.lineHeight / 2;
    for (let y = first + 8 - o.lineHeight * Math.floor((first + 8) / o.lineHeight); y < PAGE.h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PAGE.w, y);
      ctx.stroke();
    }
    for (let x = 0; x < PAGE.w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PAGE.h);
      ctx.stroke();
    }
  } else if (o.paper === 'dotted') {
    ctx.fillStyle = 'rgba(70,115,175,0.45)';
    const step = o.lineHeight / 2;
    for (let y = first + 8; y < lastY; y += step) {
      for (let x = MARGIN.left - 20; x < PAGE.w - 40; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (o.marginLine && o.paper !== 'plain' && MARGIN.left >= 60) {
    ctx.strokeStyle = 'rgba(200,70,70,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left - 26, 0);
    ctx.lineTo(MARGIN.left - 26, PAGE.h);
    ctx.stroke();
  }
}

// Drawing calls on pages that are not wanted go nowhere: the layout (and every random choice) is
// computed exactly as usual, so the wanted page comes out identical, but nothing is painted.
const NOOP_CTX = new Proxy({}, { get: () => () => {}, set: () => true });
const NOOP_PAGE = { canvas: null, ctx: NOOP_CTX };

function newPage(o) {
  const k = o.pixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE.w * k);
  canvas.height = Math.round(PAGE.h * k);
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k); // everything is drawn in page units; higher ratios just add pixels
  drawPaper(ctx, o);
  return { canvas, ctx };
}

/**
 * Render `text` into pages. Returns { pages: HTMLCanvasElement[], missing: string[], truncated: boolean }.
 */
export function renderDocument(text, font, options = {}, seed = 1) {
  const o = { ...DEFAULTS, ...options };
  const rand = mulberry32(seed);
  const scale = o.xHeight / font.xHeight;
  const xh = o.xHeight;
  const MARGIN = marginsFor(o);
  const columns = Math.max(1, Math.min(3, Math.round(o.columns) || 1));
  const colGap = columns > 1 ? Math.max(30, xh * 1.8) : 0;
  // every paragraph and table is laid out at the width of one column
  const maxW = (PAGE.w - MARGIN.left - MARGIN.right - colGap * (columns - 1)) / columns;
  const missing = new Set();
  const last = new Map();
  const slantTan = Math.tan((o.slant * Math.PI) / 180);

  const joinP = JOIN_P[o.joins] ?? 0;
  const pen = o.drawMode === 'pen';
  function placeWord(str) {
    const chars = [...str];
    const items = [];
    const map = []; // character index -> item index, or -1 when there is no sample for it
    let w = 0;
    const j = o.jitter;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      // the writer's own joined pair (th, he, in...) when there is one
      const pairKey = joinP > 0 && i + 1 < chars.length ? c + chars[i + 1] : null;
      const pair = pairKey && font.byChar.get(pairKey);
      const usePair = pair && rand() < 0.8;
      const key = usePair ? pairKey : c;
      const variants = usePair ? pair : font.byChar.get(c);
      if (!variants) {
        missing.add(c);
        map.push(-1);
        continue;
      }
      let g = variants[Math.floor(rand() * variants.length)];
      if (variants.length > 1 && last.get(key) === g) g = variants[(variants.indexOf(g) + 1) % variants.length];
      last.set(key, g);
      let shape = null;
      if (pen) {
        let st = refStrokesOf(g);
        if (st.length && o.reshape && j > 0) {
          // a new in-between shape from two of the writer's samples, then a gentle bend
          const others = variants.filter((v) => v !== g);
          if (others.length && rand() < 0.7) {
            const mixed = blendStrokes(st, refStrokesOf(others[Math.floor(rand() * others.length)]), 0.2 + rand() * 0.6, font.xHeight);
            if (mixed) st = mixed;
          }
          st = bendStrokes(st, font.xHeight, rand, j);
        }
        if (st.length) shape = { strokes: st, anchors: joinable(g.ch) ? strokeAnchors(st, font.xHeight) : null };
      } else if (o.reshape && j > 0 && rand() < 0.35 + 0.5 * j) g = variantsOf(g)[rand() < 0.5 ? 0 : 1];
      const s = scale * (g.norm || 1) * (1 + (rand() - 0.5) * 0.14 * j);
      const prev = items[items.length - 1];
      const join = !!prev && joinP > 0 && prev.ci === i - 1 && joinable(prev.g.ch) && joinable(g.ch) && rand() < joinP;
      // joined letters keep a short visible stroke between them, like real joined writing
      if (prev) w += join ? Math.max(o.letterSpacing, 0.28) * xh * (1 + (rand() - 0.5) * 0.4 * j) : o.letterSpacing * xh * (1 + (rand() - 0.5) * 0.7 * j);
      items.push({ g, s, shape, rot: (rand() - 0.5) * 0.08 * j, dy: (rand() - 0.5) * xh * 0.14 * j, x: w, join, ci: i + (usePair ? 1 : 0) });
      map.push(items.length - 1);
      if (usePair) {
        map.push(items.length - 1);
        i++;
      }
      w += g.inkW * s;
    }
    return { items, w, map };
  }

  const spaceW = () => xh * 1.05 * o.wordSpacing * (1 + (rand() - 0.5) * 0.3 * o.jitter);

  // Inline marks: __underlined__ and ~~crossed out~~ become private control characters while wrapping.
  const U0 = '\u0001';
  const U1 = '\u0002';
  const S0 = '\u0003';
  const S1 = '\u0004';
  const H0 = '\u0005';
  const H1 = '\u0006';
  const marks = (s) =>
    s.replace(/__(.+?)__/g, `${U0}$1${U1}`).replace(/~~(.+?)~~/g, `${S0}$1${S1}`).replace(/==(.+?)==/g, `${H0}$1${H1}`);

  // Wrap one paragraph into lines no wider than `width`. List items ("- ", "1. ", "a) ") get a
  // hanging indent so wrapped lines line up under the text, not under the number.
  function wrapPara(para, width, opts = {}) {
    const out = [];
    para = marks(para);
    const lead = para.match(/^ */)[0].length;
    const hang = LIST_RE.test(para);
    let hangX = 0;
    let cur = { words: [], x: Math.min(lead * xh * 0.4, width / 3) };
    const newLine = () => {
      out.push(cur);
      cur = { words: [], x: hangX };
    };
    const used = () => cur.words.reduce((acc, wd) => acc + wd.gap + wd.w, 0) + cur.x;

    function addWord(word, flags) {
      // very long word: split it across lines
      while (word.items.length && word.w > width - cur.x) {
        if (cur.words.length) {
          newLine();
          continue;
        }
        const avail = width - cur.x;
        let cut = word.items.length;
        while (cut > 1 && word.items[cut - 1].x + word.items[cut - 1].g.inkW * word.items[cut - 1].s > avail) cut--;
        const head = word.items.slice(0, cut);
        const tail = word.items.slice(cut);
        cur.words.push({ items: head, w: tail.length ? tail[0].x : word.w, gap: 0, ...flags });
        newLine();
        if (!tail.length) return;
        const off = tail[0].x;
        word = { items: tail.map((it) => ({ ...it, x: it.x - off })), w: word.w - off };
      }
      if (!word.items.length) return;
      const gap = cur.words.length ? spaceW() : 0;
      if (cur.words.length && used() + gap + word.w > width) {
        newLine();
        cur.words.push({ ...word, gap: 0, ...flags });
        return;
      }
      if (hang && !out.length && cur.words.length === 1 && !hangX) hangX = Math.min(used() + gap, width / 2);
      cur.words.push({ ...word, gap, ...flags });
    }

    let inU = false;
    let inS = false;
    let inH = false;
    for (const raw of para.trim().split(/ +/)) {
      let text = '';
      // [from, to) character ranges of the word that are underlined / crossed out
      const u = [Infinity, -1];
      const s = [Infinity, -1];
      const hl = [Infinity, -1];
      for (const c of raw) {
        if (c === U0) inU = true;
        else if (c === U1) inU = false;
        else if (c === S0) inS = true;
        else if (c === S1) inS = false;
        else if (c === H0) inH = true;
        else if (c === H1) inH = false;
        else {
          if (inU) (u[0] = Math.min(u[0], text.length)), (u[1] = text.length + 1);
          if (inS) (s[0] = Math.min(s[0], text.length)), (s[1] = text.length + 1);
          if (inH) (hl[0] = Math.min(hl[0], text.length)), (hl[1] = text.length + 1);
          text += c;
        }
      }
      if (!text) continue;
      // Occasional slip: start the word, scribble it out, write it again.
      if (opts.mistakes && o.mistakes && s[1] < 0 && text.length >= 4 && /^[a-zA-Z]+$/.test(text) && rand() < 0.012) {
        const part = text.slice(0, 2 + Math.floor(rand() * Math.min(3, text.length - 3)));
        addWord(placeWord(part), { s: [0, part.length] });
      }
      // Map character ranges onto placed glyphs (characters without a glyph were skipped).
      const word = placeWord(text);
      const toItems = ([a, b]) => {
        if (b < 0) return null;
        const idx = word.map.slice(a, b).filter((k) => k >= 0);
        return idx.length ? [Math.min(...idx), Math.max(...idx) + 1] : null;
      };
      addWord(word, { u: toItems(u), s: toItems(s), h: toItems(hl) });
    }
    if (cur.words.length) out.push(cur);
    return out;
  }

  // ---- tables ----
  const allGlyphs = [...font.byChar.values()].flat();
  const avgAdv =
    ((allGlyphs.reduce((a, g) => a + g.inkW * (g.norm || 1), 0) / Math.max(1, allGlyphs.length)) * scale + o.letterSpacing * xh) * 0.95;
  const charAdv = new Map();
  for (const [c, gs] of font.byChar) {
    charAdv.set(c, (gs.reduce((a, g) => a + g.inkW * (g.norm || 1), 0) / gs.length) * scale * 1.06 + o.letterSpacing * xh * 1.1);
  }
  const textW = (str) =>
    [...str].reduce((a, c) => a + (c === ' ' ? xh * 1.05 * o.wordSpacing * 1.15 : charAdv.get(c) ?? avgAdv), 0);
  const CELL_PAD = 12;

  function buildTable(rows) {
    const nc = Math.max(...rows.map((r) => r.length));
    const want = new Array(nc).fill(0);
    const min = new Array(nc).fill(0);
    for (const r of rows) {
      for (let c = 0; c < nc; c++) {
        const t = normalizeText(r[c] || '').trim();
        want[c] = Math.max(want[c], textW(t) + 2 * CELL_PAD);
        const longest = Math.max(0, ...t.split(/ +/).map((w) => textW(w)));
        min[c] = Math.max(min[c], longest + 2 * CELL_PAD, 60);
      }
    }
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    let widths;
    if (sum(want) <= maxW) {
      const k = Math.min(1.4, maxW / sum(want));
      widths = want.map((w) => w * k);
    } else if (sum(min) >= maxW) {
      const k = maxW / sum(min);
      widths = min.map((w) => w * k);
    } else {
      const spare = maxW - sum(min);
      const extra = want.map((w, i) => Math.max(0, w - min[i]));
      const tot = sum(extra) || 1;
      widths = min.map((w, i) => w + (spare * extra[i]) / tot);
    }
    const colX = [0];
    widths.forEach((w, i) => colX.push(colX[i] + w));
    const built = rows.map((r) => {
      const cells = [];
      for (let c = 0; c < nc; c++) {
        cells.push(wrapPara(normalizeText(r[c] || '').trim(), Math.max(20, widths[c] - 2 * CELL_PAD)));
      }
      return { cells, n: Math.max(1, ...cells.map((l) => l.length)) };
    });
    return { type: 'table', colX, rows: built };
  }

  const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSeparator = (l) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l);
  const splitRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  // ---- parse into blocks ----
  // Headings: "# Title" always; "Label:" / "Label :-" lines and short "Label :- text" labels when
  // underlineHeadings is on (the way people mark headings in handwritten notes).
  function decorate(para) {
    const h = para.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) return o.underlineHeadings ? `__${h[1].trim()}__` : h[1];
    if (!o.underlineHeadings || LIST_RE.test(para)) return para;
    let m = para.match(/^(\s*)([^:|_~#=]{1,50}?)(\s*:-?)\s*$/);
    if (m && m[2].trim()) return `${m[1]}__${m[2].trim()}__${m[3]}`;
    m = para.match(/^(\s*)([^:|_~#]{1,30}?)(\s*:-\s.*)$/);
    if (m && m[2].trim() && m[2].trim().split(/\s+/).length <= 4) return `${m[1]}__${m[2].trim()}__${m[3]}`;
    return para;
  }

  const src = normalizeText(text).split('\n');
  const blocks = [];
  for (let i = 0; i < src.length; ) {
    if (isTableLine(src[i])) {
      const rows = [];
      while (i < src.length && isTableLine(src[i])) {
        if (!isSeparator(src[i])) rows.push(splitRow(src[i]));
        i++;
      }
      if (rows.length) blocks.push(buildTable(rows));
      continue;
    }
    const para = src[i++];
    if (!para.trim()) blocks.push({ type: 'blank' });
    else for (const line of wrapPara(decorate(para), maxW, { mistakes: true })) blocks.push({ type: 'line', line });
  }

  // ---- paint ----
  const pages = [];
  let page = null;
  let y = 0;
  let truncated = false;
  let pageSlope = 0;
  let col = 0;
  const colLeft = () => MARGIN.left + col * (maxW + colGap);
  const plain = o.paper === 'plain';
  const firstBaseline = MARGIN.top + o.lineHeight;
  const bottom = PAGE.h - MARGIN.bottom;
  const lh = o.lineHeight;
  // A finished page gets its photo finish, then (when exporting) is handed over and released,
  // so a long print-quality document never holds every high-resolution page in memory at once.
  const finish = () => {
    const i = pages.length - 1;
    if (!page || page === NOOP_PAGE || pages[i] === null) return;
    if (o.photo) photoFinish(page.ctx, seed + i);
    if (o.onPage) {
      o.onPage(page.canvas, i);
      pages[i] = null;
    }
  };
  const start = () => {
    if (pages.length >= o.maxPages) {
      truncated = true;
      return false;
    }
    finish();
    page = o.onlyPage >= 0 && pages.length !== o.onlyPage ? NOOP_PAGE : newPage(o);
    pages.push(page.canvas);
    y = firstBaseline;
    col = 0;
    if (o.columnRule && columns > 1) {
      for (let c = 1; c < columns; c++) {
        const x = MARGIN.left + c * (maxW + colGap) - colGap / 2;
        penLine(x, MARGIN.top + lh * 0.4, x, PAGE.h - MARGIN.bottom);
      }
    }
    // Without printed lines people drift: each page gets its own gentle upward tilt.
    pageSlope = plain ? -(0.003 + rand() * 0.008) * o.jitter : 0;
    return true;
  };

  function paintLine(line, x0, by, wander = false) {
    const slope = pageSlope + (rand() - 0.5) * 0.012 * o.jitter;
    const wobble = (rand() - 0.5) * xh * 0.18 * o.jitter;
    if (wander) x0 += (rand() - 0.5) * xh * (plain ? 0.45 : 0.25) * o.jitter;
    let x = x0 + line.x;
    const ctx = page.ctx;
    const deco = [];
    // highlighter first, underneath the ink
    {
      let hx = x0 + line.x;
      const bands = [];
      line.words.forEach((word, idx) => {
        hx += word.gap;
        if (word.h) {
          const a = word.items[word.h[0]];
          const b = word.items[word.h[1] - 1];
          if (a && b) {
            const x1 = hx + a.x;
            const x2 = hx + b.x + b.g.inkW * b.s;
            const prev = bands[bands.length - 1];
            if (prev && prev.idx === idx - 1) Object.assign(prev, { x2, idx });
            else bands.push({ x1, x2, idx });
          }
        }
        hx += word.w;
      });
      for (const band of bands) highlighter(band.x1 - xh * 0.2, band.x2 + xh * 0.2, (gx) => by + wobble + slope * (gx - x0));
    }
    ctx.globalCompositeOperation = 'multiply';
    const joins = [];
    line.words.forEach((word, idx) => {
      x += word.gap;
      const wx = x;
      let prevExit = null;
      for (const it of word.items) {
        const gx = x + it.x;
        const baseY = by + wobble + it.dy + slope * (gx - x0);
        const g = it.g;
        if (it.shape) {
          // reference units -> page: scale, slant, rotation, position (as the image would be drawn)
          const k2 = it.s / (g.norm || 1);
          const c = Math.cos(it.rot);
          const sn = Math.sin(it.rot);
          const toPage = (xr, yr) => {
            let lx = xr * k2;
            const ly = yr * k2;
            if (slantTan) lx -= slantTan * ly;
            return [gx + lx * c - ly * sn, baseY + lx * sn + ly * c];
          };
          penLetter(it.shape.strokes, toPage, k2);
          const an = it.shape.anchors;
          const at = (pt) => {
            const [px, py] = toPage(pt.x, pt.y);
            const [qx, qy] = toPage(pt.x + pt.tx, pt.y + pt.ty);
            const n = Math.hypot(qx - px, qy - py) || 1;
            return { x: px, y: py, tx: (qx - px) / n, ty: (qy - py) / n };
          };
          const avgW = (st) => {
            const all = st.flatMap((q) => q.pts);
            return (all.reduce((m, q) => m + q.w, 0) / Math.max(1, all.length)) * k2;
          };
          if (joinP > 0) {
            if (an && it.join && prevExit) joins.push({ from: prevExit.p, to: at(an.entry), w: (prevExit.w + avgW(it.shape.strokes)) / 2, flow: true });
            prevExit = an ? { p: at(an.exit), w: avgW(it.shape.strokes) } : null;
          }
          continue;
        }
        if (joinP > 0) {
          // sample pixel -> page, exactly as the glyph is drawn below (scale, slant, rotation)
          const toPage = (px, py) => {
            let lx = (px - g.pad) * it.s;
            const ly = (g.yOff - (g.canvas.height - g.pad) + py) * it.s;
            if (slantTan) lx -= slantTan * ly;
            const c = Math.cos(it.rot);
            const sn = Math.sin(it.rot);
            return [gx + lx * c - ly * sn, baseY + lx * sn + ly * c];
          };
          const src = g.base || g;
          const an = joinable(g.ch) ? anchorsOf(src, font.xHeight / (src.norm || 1)) : null;
          const place = (pt) => toPage(...(g.map ? g.map(pt.x, pt.y) : [pt.x, pt.y]));
          if (an && it.join && prevExit) joins.push({ from: prevExit.p, to: place(an.entry), w: (prevExit.w + an.width * it.s) / 2 });
          prevExit = an ? { p: place(an.exit), w: an.width * it.s } : null;
        }
        ctx.save();
        ctx.translate(gx, baseY);
        ctx.rotate(it.rot);
        if (slantTan) ctx.transform(1, 0, -slantTan, 1, 0, 0);
        ctx.drawImage(
          tinted(g, o.ink),
          -g.pad * it.s,
          (g.yOff - (g.canvas.height - g.pad)) * it.s,
          g.canvas.width * it.s,
          g.canvas.height * it.s,
        );
        ctx.restore();
      }
      x += word.w;
      // pixel span of glyphs [a, b) of this word
      const span = (r) => {
        const first = word.items[r[0]];
        const last = word.items[r[1] - 1];
        return first && last ? [wx + first.x, wx + last.x + last.g.inkW * last.s] : null;
      };
      for (const kind of ['u', 's']) {
        const sp = word[kind] && span(word[kind]);
        if (sp) deco.push({ idx, kind, x1: sp[0], x2: sp[1], whole: word[kind][0] === 0 && word[kind][1] === word.items.length });
      }
    });
    // a join may run between a pen-stroke letter and one drawn from ink (when its trace was poor):
    // follow the pen's direction only when both ends know it
    const xy = (q) => (Array.isArray(q) ? q : [q.x, q.y]);
    for (const jn of joins) {
      if (jn.from.tx !== undefined && jn.to.tx !== undefined) flowJoin(jn.from, jn.to, jn.w);
      else connector(xy(jn.from), xy(jn.to), jn.w);
    }
    ctx.globalCompositeOperation = 'source-over';

    const yAt = (gx) => by + wobble + slope * (gx - x0);
    for (const kind of ['u', 's']) {
      const runs = [];
      for (const d of deco.filter((e) => e.kind === kind)) {
        const last = runs[runs.length - 1];
        // join neighbouring words into one stroke (only when the earlier one is marked to its end)
        if (last && last.idx === d.idx - 1 && last.whole) {
          last.x2 = d.x2;
          last.idx = d.idx;
          last.whole = d.whole;
        } else runs.push({ ...d });
      }
      for (const r of runs) {
        if (kind === 'u') {
          const a = r.x1 - xh * 0.15;
          const b = r.x2 + xh * 0.15;
          penLine(a, yAt(a) + xh * 0.32, b, yAt(b) + xh * 0.32 + (rand() - 0.5) * xh * 0.12);
        } else {
          scribble(r.x1, r.x2, yAt);
        }
      }
    }
  }

  // Draw one letter from its pen strokes: smooth curves whose width follows the ink.
  function penLetter(strokes, toPage, k2) {
    const ctx = page.ctx;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = o.ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of strokes) {
      ctx.globalAlpha = 0.86 + rand() * 0.08;
      if (st.pts.length === 1) {
        const [px, py] = toPage(st.pts[0].x, st.pts[0].y);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.8, (st.pts[0].w * k2) / 2), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const pts = smoothPath(st.pts, 5).map((q) => ({ p: toPage(q.x, q.y), w: Math.max(0.8, q.w * k2) }));
      // runs of similar width share one path, so long strokes stay fast to draw
      let i = 0;
      while (i < pts.length - 1) {
        const w0 = pts[i].w;
        ctx.lineWidth = w0;
        ctx.beginPath();
        ctx.moveTo(...pts[i].p);
        let jj = i + 1;
        while (jj < pts.length && Math.abs(pts[jj].w - w0) < 0.35) ctx.lineTo(...pts[jj++].p);
        if (jj === i + 1) ctx.lineTo(...pts[jj++].p);
        ctx.stroke();
        i = jj - 1;
      }
    }
    ctx.restore();
  }

  // A join that leaves along the pen's direction at the end of one letter and arrives along the
  // direction it starts the next one: the way a real joined hand moves.
  function flowJoin(a, b, width) {
    const dx = b.x - a.x;
    const L = Math.hypot(dx, b.y - a.y);
    if (dx < -xh * 0.2 || L > xh * 2.4) return; // not a sensible join
    const ctx = page.ctx;
    ctx.save();
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.88;
    ctx.lineWidth = Math.max(0.8, width * 0.85);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + a.tx * L * 0.45, a.y + a.ty * L * 0.45, b.x - b.tx * L * 0.45, b.y - b.ty * L * 0.45, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  // The pen stroke that joins one letter to the next: a smooth curve that dips slightly, in the
  // same ink and about the same width as the letters it joins.
  function connector([x1, y1], [x2, y2], width) {
    const ctx = page.ctx;
    const dx = x2 - x1;
    if (dx < -xh * 0.2 || dx > xh * 2.2 || Math.abs(y2 - y1) > xh * 1.4) return; // not a sensible join
    ctx.save();
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.88;
    ctx.lineWidth = Math.max(1, width * 0.8);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const sag = xh * (0.06 + rand() * 0.08);
    ctx.bezierCurveTo(x1 + dx * 0.45, Math.max(y1, y2) + sag, x2 - dx * 0.35, y2 + sag * 0.3, x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // A highlighter pass: a broad translucent band with slightly uneven edges, laid behind the ink.
  function highlighter(x1, x2, yAt) {
    const ctx = page.ctx;
    const n = Math.max(2, Math.round((x2 - x1) / 30));
    const top = (x) => yAt(x) - xh * (1.15 + (rand() - 0.5) * 0.12);
    const bot = (x) => yAt(x) + xh * (0.3 + (rand() - 0.5) * 0.12);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = o.highlight;
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const x = x1 + ((x2 - x1) * k) / n;
      if (k) ctx.lineTo(x, top(x));
      else ctx.moveTo(x, top(x));
    }
    for (let k = n; k >= 0; k--) {
      const x = x1 + ((x2 - x1) * k) / n;
      ctx.lineTo(x, bot(x));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // A pen-drawn straight line: short segments with a little wobble.
  function penLine(x1, y1, x2, y2) {
    const ctx = page.ctx;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.round(len / 45));
    const j = 1.3 * o.jitter;
    ctx.save();
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 + (rand() - 0.5) * j, y1 + (rand() - 0.5) * j);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      ctx.lineTo(x1 + (x2 - x1) * t + (rand() - 0.5) * j * 2, y1 + (y2 - y1) * t + (rand() - 0.5) * j * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Scribble over a word to cross it out, like a real slip of the pen.
  function scribble(x1, x2, yAt) {
    const ctx = page.ctx;
    ctx.save();
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // two quick back-and-forth passes of tight loops, like scribbling a word out
    for (const [from, to, dir] of [[x1 - 4, x2 + 4, 1], [x2 + 4, x1 - 4, -1]]) {
      ctx.beginPath();
      ctx.moveTo(from, yAt(from) - xh * 0.45);
      let up = dir > 0;
      for (let x = from; dir > 0 ? x <= to : x >= to; x += dir * xh * 0.13 * (0.7 + rand() * 0.6)) {
        ctx.lineTo(x, yAt(x) - (up ? xh * (0.9 + rand() * 0.2) : xh * (rand() * 0.12 - 0.05)));
        up = !up;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Move on when a column is full: next column on the same page, or a new page.
  const advance = () => {
    if (col < columns - 1) {
      col++;
      y = firstBaseline;
      return true;
    }
    return start();
  };

  if (!start()) return { pages, missing: [...missing], truncated };

  outer: for (const b of blocks) {
    if (b.type === 'table') {
      let first = true;
      for (const row of b.rows) {
        if (y > bottom || y + (row.n - 1) * lh > bottom + lh * 0.5) {
          if (!advance()) break outer;
          first = true;
        }
        const left = colLeft();
        const right = left + b.colX[b.colX.length - 1];
        const top = y - lh + 8;
        const bot = top + row.n * lh;
        row.cells.forEach((lines, c) => {
          lines.forEach((line, k) => paintLine(line, left + b.colX[c] + CELL_PAD, y + k * lh));
        });
        if (first) penLine(left, top, right, top);
        penLine(left, bot, right, bot);
        for (const cx of b.colX) penLine(left + cx, top, left + cx, bot);
        y += row.n * lh;
        first = false;
      }
      continue;
    }
    if (y > bottom) {
      if (!advance()) break;
    }
    if (b.type === 'line') {
      paintLine(b.line, colLeft(), y, true);
      y += plain ? lh * (1 + (rand() - 0.5) * 0.1 * o.jitter) : lh;
    } else if (y > firstBaseline) {
      // Blank line between paragraphs. Printed lines only allow whole-line gaps; plain paper allows any.
      y += lh * (plain ? o.paragraphSpacing : Math.round(o.paragraphSpacing));
    }
  }
  finish();
  return { pages, missing: [...missing], truncated };
}

/** Make a page look like a phone photo of paper: uneven light, soft vignette, fine grain. */
function photoFinish(ctx, seed) {
  const rand = mulberry32(seed * 7919 + 13);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const lx = PAGE.w * (0.2 + rand() * 0.6);
  const ly = PAGE.h * (0.2 + rand() * 0.4);
  const light = ctx.createRadialGradient(lx, ly, PAGE.h * 0.1, lx, ly, PAGE.h * 1.1);
  light.addColorStop(0, '#ffffff');
  light.addColorStop(0.6, '#f1efeb');
  light.addColorStop(1, '#d6d2cb');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  const n = document.createElement('canvas');
  n.width = n.height = 160;
  const nctx = n.getContext('2d');
  const img = nctx.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 255 - Math.floor(rand() * 16);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  ctx.fillStyle = ctx.createPattern(n, 'repeat');
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  ctx.restore();
}
