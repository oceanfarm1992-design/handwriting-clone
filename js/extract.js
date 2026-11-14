// Turns a scan/photo of a filled-in template into a library of glyph images.
import { PAGE, CHARS, GRID, MARKERS, cellRect } from './template.js';
import {
  findCornerMarkers,
  solveHomography,
  warpLuma,
  normalizeBackground,
  labelComponents,
} from './cv.js';

let nextId = 1;
const INSET = 7; // ignore the printed box border
const INK_PAPER = 200; // normalised luma at/above which a pixel is paper
const INK_FULL = 110; // normalised luma at/below which a pixel is solid ink
const PAD = 2;

function drawScaled(source, maxSide) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s));
  c.height = Math.max(1, Math.round(sh * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function lumaOf(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return out;
}

/** Rectify the page using the corner squares. Returns normalised luma at template size. */
export function rectifyPage(source) {
  const full = drawScaled(source, 3000);
  const small = drawScaled(full, 800);
  const markers = findCornerMarkers(lumaOf(small), small.width, small.height);
  const fullLuma = lumaOf(full);
  let H = null;
  if (markers) {
    const k = full.width / small.width;
    const srcPts = markers.map(([x, y]) => [x * k, y * k]);
    H = solveHomography(MARKERS.centers, srcPts);
  }
  const warped = warpLuma(fullLuma, full.width, full.height, H, PAGE.w, PAGE.h);
  return { luma: normalizeBackground(warped, PAGE.w, PAGE.h), foundMarkers: !!(markers && H) };
}

/** Cut every template cell into a glyph (soft-edged black ink on transparent canvas). */
export function glyphsFromLuma(luma) {
  const glyphs = [];
  const missing = [];
  CHARS.forEach((ch, i) => {
    const r = cellRect(i);
    const x0 = r.x + INSET;
    const y0 = r.y + INSET;
    const cw = r.w - 2 * INSET;
    const chh = r.h - 2 * INSET;
    const alpha = new Float32Array(cw * chh);
    const mask = new Uint8Array(cw * chh);
    for (let yy = 0; yy < chh; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        const n = luma[(y0 + yy) * PAGE.w + x0 + xx];
        const a = Math.min(1, Math.max(0, (INK_PAPER - n) / (INK_PAPER - INK_FULL)));
        alpha[yy * cw + xx] = a;
        mask[yy * cw + xx] = a > 0.28 ? 1 : 0;
      }
    }
    const { labels, comps } = labelComponents(mask, cw, chh, true);
    const kept = comps.filter((c) => {
      const bw = c.maxx - c.minx + 1;
      const bh = c.maxy - c.miny + 1;
      if (c.area < 10) return false;
      if (c.area > 0.6 * cw * chh) return false;
      const spans = bw >= 0.9 * cw || bh >= 0.9 * chh;
      return !(spans && Math.min(bw, bh) < 0.12 * Math.max(bw, bh)); // stray box border
    });
    if (!kept.length) {
      missing.push(ch);
      return;
    }
    const keepIds = new Set(kept.map((c) => c.id));
    const minx = Math.min(...kept.map((c) => c.minx));
    const maxx = Math.max(...kept.map((c) => c.maxx));
    const miny = Math.min(...kept.map((c) => c.miny));
    const maxy = Math.max(...kept.map((c) => c.maxy));
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;

    const canvas = document.createElement('canvas');
    canvas.width = bw + 2 * PAD;
    canvas.height = bh + 2 * PAD;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(canvas.width, canvas.height);
    const isKept = (x, y) => x >= 0 && y >= 0 && x < cw && y < chh && keepIds.has(labels[y * cw + x]);
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const a = alpha[y * cw + x];
        let on = isKept(x, y);
        if (!on && a > 0.02) {
          for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) on = isKept(x + dx, y + dy);
        }
        if (!on) continue;
        const o = ((y - miny + PAD) * canvas.width + (x - minx + PAD)) * 4;
        img.data[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    glyphs.push({
      id: nextId++,
      ch,
      canvas,
      pad: PAD,
      inkH: bh,
      inkW: bw,
      // distance of the ink bottom below the guide line (negative = floats above it)
      yOff: y0 + maxy + 1 - r.baseline,
    });
  });
  return { glyphs, missing };
}

export function extractGlyphs(source) {
  const { luma, foundMarkers } = rectifyPage(source);
  return { ...glyphsFromLuma(luma), foundMarkers };
}

export function newGlyphId() {
  return nextId++;
}

export { GRID };
