// On-screen handwriting capture: a pad with school-style guide lines, and conversion of
// pen strokes into glyphs that the renderer treats exactly like scanned ones.
import { newGlyphId } from './extract.js';

// Pad geometry in pad units. The pad keeps its proportions; only its on-screen size changes.
export const PAD = { w: 220, h: 160, base: 110, xh: 40, asc: 80, desc: 38 };
export const PEN = 4; // pen width in pad units (one tenth of the x-height guide)

const width = (p) => PEN * (0.55 + 0.9 * p);

/** Paint strokes. k = pixels per pad unit; (ox, oy) = pad point drawn at the canvas origin. */
export function drawStrokes(ctx, strokes, k = 1, ox = 0, oy = 0) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.length) continue;
    if (s.length === 1) {
      const p = s[0];
      ctx.beginPath();
      ctx.arc((p.x - ox) * k, (p.y - oy) * k, (width(p.p) / 2) * k, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      ctx.lineWidth = width((a.p + b.p) / 2) * k;
      ctx.beginPath();
      ctx.moveTo((a.x - ox) * k, (a.y - oy) * k);
      ctx.lineTo((b.x - ox) * k, (b.y - oy) * k);
      ctx.stroke();
    }
  }
}

/** Turn the strokes for one character into a glyph (black ink on a transparent canvas). */
export function glyphFromStrokes(ch, strokes) {
  const pts = strokes.flat();
  if (!pts.length) return null;
  const half = width(1) / 2 + 0.5;
  const minx = Math.floor(Math.min(...pts.map((p) => p.x)) - half);
  const miny = Math.floor(Math.min(...pts.map((p) => p.y)) - half);
  const maxx = Math.ceil(Math.max(...pts.map((p) => p.x)) + half);
  const maxy = Math.ceil(Math.max(...pts.map((p) => p.y)) + half);
  const pad = 2;
  const canvas = document.createElement('canvas');
  canvas.width = maxx - minx + 2 * pad;
  canvas.height = maxy - miny + 2 * pad;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ctx.strokeStyle = '#000';
  drawStrokes(ctx, strokes, 1, minx - pad, miny - pad);
  return {
    id: newGlyphId(),
    ch,
    canvas,
    pad,
    inkW: maxx - minx,
    inkH: maxy - miny,
    yOff: maxy - PAD.base,
    src: 'draw',
    strokes: strokes.map((s) => s.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), p: +p.p.toFixed(2) }))),
  };
}

/** A drawing surface with guide lines, pointer input (mouse, finger, stylus with pressure) and undo. */
export class Pad {
  constructor(canvas, onChange = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.lw = PAD.w;
    this.strokes = [];
    this.cur = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety; drawing still works without it */
      }
      this.cur = [];
      this.strokes.push(this.cur);
      this.add(e);
      this.redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) this.add(ev);
      this.redraw();
    });
    const end = () => {
      if (!this.cur) return;
      this.cur = null;
      this.onChange();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.resize());
  }

  add(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.lw;
    const y = ((e.clientY - r.top) / r.height) * PAD.h;
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    const last = this.cur[this.cur.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 0.4) return;
    this.cur.push({ x, y, p });
  }

  setLogicalWidth(w) {
    this.lw = w;
    this.resize();
  }

  resize() {
    const avail = this.canvas.parentElement?.clientWidth || 0;
    if (!avail) return;
    // keep the whole pad and its buttons on screen: at most half the window height
    const cssW = Math.floor(Math.min(avail, (window.innerHeight * 0.5 * this.lw) / PAD.h));
    this.canvas.style.width = `${cssW}px`;
    const cssH = (cssW * PAD.h) / this.lw;
    this.canvas.style.height = `${cssH}px`;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.redraw();
  }

  redraw() {
    const { ctx, canvas } = this;
    const k = canvas.width / this.lw;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const line = (y, color, dash) => {
      ctx.setLineDash(dash.map((d) => d * k));
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 0.6 * k);
      ctx.beginPath();
      ctx.moveTo(0, y * k);
      ctx.lineTo(canvas.width, y * k);
      ctx.stroke();
    };
    line(PAD.base - PAD.asc, '#d5dbe6', [4, 4]);
    line(PAD.base - PAD.xh, '#c3cde0', [4, 4]);
    line(PAD.base, '#6f8fc4', []);
    line(PAD.base + PAD.desc, '#d5dbe6', [4, 4]);
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle = '#1b2240';
    drawStrokes(ctx, this.strokes, k);
  }

  undo() {
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.onChange();
  }

  load(strokes) {
    this.strokes = strokes.map((s) => s.map((p) => ({ ...p })));
    this.redraw();
    this.onChange();
  }
}
