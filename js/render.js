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
};

const MARGIN = { left: 140, right: 90, top: 150, bottom: 110 };
const X_LETTERS = 'acemnorsuvwxz';

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
  let hs = glyphs.filter((g) => X_LETTERS.includes(g.ch)).map((g) => g.inkH);
  if (!hs.length) hs = glyphs.map((g) => g.inkH);
  hs.sort((a, b) => a - b);
  const xHeight = hs.length ? hs[Math.floor(hs.length / 2)] : 30;
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
      const s = scale * (1 + (rand() - 0.5) * 0.14 * j);
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

  // Wrap one paragraph into lines no wider than `width`.
  function wrapPara(para, width) {
    const out = [];
    const lead = para.match(/^ */)[0].length;
    let cur = { words: [], x: Math.min(lead * xh * 0.4, width / 3) };
    for (const tok of para.trim().split(/ +/)) {
      if (!tok) continue;
      let word = placeWord(tok);
      // very long word: split it across lines
      while (word.w > width) {
        let cut = word.items.length;
        while (cut > 1 && word.items[cut - 1].x + word.items[cut - 1].g.inkW * word.items[cut - 1].s > width) cut--;
        const head = word.items.slice(0, cut);
        const tail = word.items.slice(cut);
        const headW = tail.length ? tail[0].x : word.w;
        if (cur.words.length) {
          out.push(cur);
          cur = { words: [], x: 0 };
        }
        cur.words.push({ items: head, w: headW, gap: 0 });
        out.push(cur);
        cur = { words: [], x: 0 };
        if (!tail.length) {
          word = { items: [], w: 0 };
          break;
        }
        const off = tail[0].x;
        word = { items: tail.map((it) => ({ ...it, x: it.x - off })), w: word.w - off };
      }
      if (!word.items.length) continue;
      const gap = cur.words.length ? spaceW() : 0;
      const used = cur.words.reduce((acc, wd) => acc + wd.gap + wd.w, 0) + cur.x;
      if (cur.words.length && used + gap + word.w > width) {
        out.push(cur);
        cur = { words: [{ ...word, gap: 0 }], x: 0 };
      } else {
        cur.words.push({ ...word, gap });
      }
    }
    if (cur.words.length) out.push(cur);
    return out;
  }

  // ---- tables ----
  const allGlyphs = [...font.byChar.values()].flat();
  const avgAdv =
    ((allGlyphs.reduce((a, g) => a + g.inkW, 0) / Math.max(1, allGlyphs.length)) * scale + o.letterSpacing * xh) * 0.95;
  const charAdv = new Map();
  for (const [c, gs] of font.byChar) {
    charAdv.set(c, (gs.reduce((a, g) => a + g.inkW, 0) / gs.length) * scale * 1.06 + o.letterSpacing * xh * 1.1);
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
    else for (const line of wrapPara(para, maxW)) blocks.push({ type: 'line', line });
  }

  // ---- paint ----
  const pages = [];
  let page = null;
  let y = 0;
  let truncated = false;
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
    return true;
  };

  function paintLine(line, x0, by) {
    const slope = (rand() - 0.5) * 0.012 * o.jitter;
    const wobble = (rand() - 0.5) * xh * 0.18 * o.jitter;
    let x = x0 + line.x;
    const ctx = page.ctx;
    ctx.globalCompositeOperation = 'multiply';
    for (const word of line.words) {
      x += word.gap;
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
    }
    ctx.globalCompositeOperation = 'source-over';
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
    if (b.type === 'line') paintLine(b.line, MARGIN.left, y);
    y += lh;
  }
  return { pages, missing: [...missing], truncated };
}
