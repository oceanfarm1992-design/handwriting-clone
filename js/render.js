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

  // Tokenise into lines of words.
  const paragraphs = normalizeText(text).split('\n');
  const lines = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push(null);
      continue;
    }
    const lead = para.match(/^ */)[0].length;
    let cur = { words: [], x: lead * xh * 0.4 };
    const spaceW = () => xh * 1.05 * o.wordSpacing * (1 + (rand() - 0.5) * 0.3 * o.jitter);
    for (const tok of para.trim().split(/ +/)) {
      let word = placeWord(tok);
      // very long word: split it across lines
      while (word.w > maxW) {
        let cut = word.items.length;
        while (cut > 1 && word.items[cut - 1].x + word.items[cut - 1].g.inkW * word.items[cut - 1].s > maxW) cut--;
        const head = word.items.slice(0, cut);
        const tail = word.items.slice(cut);
        const headW = tail.length ? tail[0].x : word.w;
        if (cur.words.length) {
          lines.push(cur);
          cur = { words: [], x: 0 };
        }
        cur.words.push({ items: head, w: headW, gap: 0 });
        lines.push(cur);
        cur = { words: [], x: 0 };
        const off = tail.length ? tail[0].x : 0;
        word = { items: tail.map((it) => ({ ...it, x: it.x - off })), w: word.w - off };
        if (!tail.length) break;
      }
      if (!word.items.length) continue;
      const gap = cur.words.length ? spaceW() : 0;
      const used = cur.words.length
        ? cur.words.reduce((acc, wd) => acc + wd.gap + wd.w, 0) + cur.x
        : cur.x;
      if (cur.words.length && used + gap + word.w > maxW) {
        lines.push(cur);
        cur = { words: [], x: 0 };
        cur.words.push({ ...word, gap: 0 });
      } else {
        cur.words.push({ ...word, gap });
      }
    }
    if (cur.words.length) lines.push(cur);
  }

  // Paint lines onto pages.
  const pages = [];
  let page = null;
  let y = 0;
  let truncated = false;
  const firstBaseline = MARGIN.top + o.lineHeight;
  const bottom = PAGE.h - MARGIN.bottom;
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
  if (!start()) return { pages, missing: [...missing], truncated };

  for (const line of lines) {
    if (y > bottom) {
      if (!start()) break;
    }
    if (line) {
      const slope = (rand() - 0.5) * 0.012 * o.jitter;
      const wobble = (rand() - 0.5) * xh * 0.18 * o.jitter;
      let x = MARGIN.left + line.x;
      const ctx = page.ctx;
      ctx.globalCompositeOperation = 'multiply';
      for (const word of line.words) {
        x += word.gap;
        for (const it of word.items) {
          const gx = x + it.x;
          const by = y + wobble + it.dy + slope * (gx - MARGIN.left);
          const g = it.g;
          const t = tinted(g, o.ink);
          ctx.save();
          ctx.translate(gx, by);
          ctx.rotate(it.rot);
          if (slantTan) ctx.transform(1, 0, -slantTan, 1, 0, 0);
          ctx.drawImage(
            t,
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
    y += o.lineHeight;
  }
  return { pages, missing: [...missing], truncated };
}
