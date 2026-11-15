// Lays text out on A4 pages using the captured glyph library.
import { PAGE } from './template.js';

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
};

const MARGIN = { left: 140, right: 90, top: 150, bottom: 110 };
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
  const sourceXh = (list) => median(list.filter((g) => X_LETTERS.includes(g.ch)).map((g) => g.inkH)) ?? median(list.map((g) => g.inkH));
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

function drawPaper(ctx, o) {
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
  if (o.marginLine && o.paper !== 'plain') {
    ctx.strokeStyle = 'rgba(200,70,70,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left - 26, 0);
    ctx.lineTo(MARGIN.left - 26, PAGE.h);
    ctx.stroke();
  }
}

function newPage(o) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE.w;
  canvas.height = PAGE.h;
  const ctx = canvas.getContext('2d');
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
  const maxW = PAGE.w - MARGIN.left - MARGIN.right;
  const missing = new Set();
  const last = new Map();
  const slantTan = Math.tan((o.slant * Math.PI) / 180);

  function placeWord(str) {
    const items = [];
    let w = 0;
    for (const c of str) {
      const variants = font.byChar.get(c);
      if (!variants) {
        missing.add(c);
        continue;
      }
      let g = variants[Math.floor(rand() * variants.length)];
      if (variants.length > 1 && last.get(c) === g) g = variants[(variants.indexOf(g) + 1) % variants.length];
      last.set(c, g);
      const j = o.jitter;
      const s = scale * (g.norm || 1) * (1 + (rand() - 0.5) * 0.14 * j);
      const item = {
        g,
        s,
        rot: (rand() - 0.5) * 0.08 * j,
        dy: (rand() - 0.5) * xh * 0.14 * j,
        x: w,
      };
      w += g.inkW * s + o.letterSpacing * xh * (1 + (rand() - 0.5) * 0.7 * j);
      items.push(item);
    }
    return { items, w };
  }

  const spaceW = () => xh * 1.05 * o.wordSpacing * (1 + (rand() - 0.5) * 0.3 * o.jitter);

  // Inline marks: __underlined__ and ~~crossed out~~ become private control characters while wrapping.
  const U0 = '\u0001';
  const U1 = '\u0002';
  const S0 = '\u0003';
  const S1 = '\u0004';
  const marks = (s) => s.replace(/__(.+?)__/g, `${U0}$1${U1}`).replace(/~~(.+?)~~/g, `${S0}$1${S1}`);

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
    for (const raw of para.trim().split(/ +/)) {
      let text = '';
      // [from, to) character ranges of the word that are underlined / crossed out
      const u = [Infinity, -1];
      const s = [Infinity, -1];
      for (const c of raw) {
        if (c === U0) inU = true;
        else if (c === U1) inU = false;
        else if (c === S0) inS = true;
        else if (c === S1) inS = false;
        else {
          if (inU) (u[0] = Math.min(u[0], text.length)), (u[1] = text.length + 1);
          if (inS) (s[0] = Math.min(s[0], text.length)), (s[1] = text.length + 1);
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
      const kept = [...text].map((c) => font.byChar.has(c));
      const toItems = ([a, b]) => {
        if (b < 0) return null;
        const before = (n) => kept.slice(0, n).filter(Boolean).length;
        const r = [before(a), before(b)];
        return r[1] > r[0] ? r : null;
      };
      addWord(word, { u: toItems(u), s: toItems(s) });
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
    let m = para.match(/^(\s*)([^:|_~#]{1,50}?)(\s*:-?)\s*$/);
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
  const plain = o.paper === 'plain';
  const firstBaseline = MARGIN.top + o.lineHeight;
  const bottom = PAGE.h - MARGIN.bottom;
  const lh = o.lineHeight;
  const start = () => {
    if (pages.length >= o.maxPages) {
      truncated = true;
      return false;
    }
    page = newPage(o);
    pages.push(page.canvas);
    y = firstBaseline;
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
    ctx.globalCompositeOperation = 'multiply';
    line.words.forEach((word, idx) => {
      x += word.gap;
      const wx = x;
      for (const it of word.items) {
        const gx = x + it.x;
        const baseY = by + wobble + it.dy + slope * (gx - x0);
        const g = it.g;
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

  if (!start()) return { pages, missing: [...missing], truncated };

  outer: for (const b of blocks) {
    if (b.type === 'table') {
      let first = true;
      const left = MARGIN.left;
      const right = left + b.colX[b.colX.length - 1];
      for (const row of b.rows) {
        if (y > bottom || y + (row.n - 1) * lh > bottom + lh * 0.5) {
          if (!start()) break outer;
          first = true;
        }
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
      if (!start()) break;
    }
    if (b.type === 'line') {
      paintLine(b.line, MARGIN.left, y, true);
      y += plain ? lh * (1 + (rand() - 0.5) * 0.1 * o.jitter) : lh;
    } else if (y > firstBaseline) {
      // Blank line between paragraphs. Printed lines only allow whole-line gaps; plain paper allows any.
      y += lh * (plain ? o.paragraphSpacing : Math.round(o.paragraphSpacing));
    }
  }
  if (o.photo) pages.forEach((c, i) => photoFinish(c.getContext('2d'), seed + i));
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
