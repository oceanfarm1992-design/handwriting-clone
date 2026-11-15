import test from 'node:test';
import assert from 'node:assert/strict';
import { traceStrokes, resample, pathLength, strokeAnchors, blendStrokes, bendStrokes, simplify } from '../js/strokes.js';
import { mulberry32 } from '../js/render.js';

function img(w, h, draw) {
  const a = new Float32Array(w * h);
  const dot = (x, y, r = 2) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = Math.round(x + dx);
      const Y = Math.round(y + dy);
      if (X >= 0 && Y >= 0 && X < w && Y < h && dx * dx + dy * dy <= r * r) a[Y * w + X] = 1;
    }
  };
  draw(dot);
  return a;
}

test('a straight thick stroke is traced as one path of about the right length and width', () => {
  const a = img(60, 20, (dot) => {
    for (let x = 8; x <= 52; x++) dot(x, 10, 3);
  });
  const s = traceStrokes(a, 60, 20);
  assert.equal(s.length, 1);
  const L = pathLength(s[0].pts);
  assert.ok(L > 36 && L < 50, `length ${L}`);
  const w = s[0].pts.reduce((m, p) => m + p.w, 0) / s[0].pts.length;
  assert.ok(w >= 4 && w <= 9, `width ${w}`);
});

test('a ring is traced as one closed loop', () => {
  const a = img(50, 50, (dot) => {
    for (let t = 0; t < 360; t += 1) dot(25 + 14 * Math.cos((t * Math.PI) / 180), 25 + 14 * Math.sin((t * Math.PI) / 180), 2);
  });
  const s = traceStrokes(a, 50, 50);
  assert.equal(s.length, 1);
  const p = s[0].pts;
  assert.ok(Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) < 3, 'loop should close');
  assert.ok(pathLength(p) > 70, `loop length ${pathLength(p)}`);
});

test('a "t" gives two strokes: the stem and the cross-bar', () => {
  const a = img(40, 50, (dot) => {
    for (let y = 5; y <= 42; y++) dot(18, y, 2);
    for (let x = 8; x <= 30; x++) dot(x, 16, 2);
  });
  const s = traceStrokes(a, 40, 50);
  assert.ok(s.length >= 2 && s.length <= 4, `strokes ${s.length}`);
  const total = s.reduce((m, k) => m + pathLength(k.pts), 0);
  assert.ok(total > 44, `total length ${total}`);
});

test('resample spaces points evenly and keeps the ends', () => {
  const r = resample([{ x: 0, y: 0, w: 1 }, { x: 10, y: 0, w: 3 }], 6);
  assert.equal(r.length, 6);
  assert.deepEqual(r.map((p) => Math.round(p.x)), [0, 2, 4, 6, 8, 10]);
  assert.equal(r[5].w, 3);
});

test('simplify keeps corners and drops points on straight runs', () => {
  const pts = [];
  for (let x = 0; x <= 10; x++) pts.push({ x, y: 0, w: 1 });
  for (let y = 1; y <= 10; y++) pts.push({ x: 10, y, w: 1 });
  const s = simplify(pts, 0.5);
  assert.equal(s.length, 3);
});

test('anchors: a "u" is entered top left, left top right, with rightward directions', () => {
  // reference units: baseline y = 0, x-height 20
  const u = [{ pts: [{ x: 0, y: -20, w: 2 }, { x: 0, y: -4, w: 2 }, { x: 6, y: 0, w: 2 }, { x: 14, y: -2, w: 2 }, { x: 16, y: -20, w: 2 }] }];
  const a = strokeAnchors(u, 20);
  assert.ok(a.entry.x < 4 && a.entry.y < -14, JSON.stringify(a.entry));
  assert.ok(a.exit.x > 12 && a.exit.y < -14, JSON.stringify(a.exit));
  assert.ok(a.entry.tx >= 0 && a.exit.tx >= 0);
});

test('blending two samples gives an in-between shape; mismatched shapes refuse', () => {
  const A = [{ pts: [{ x: 0, y: 0, w: 2 }, { x: 10, y: 0, w: 2 }] }];
  const B = [{ pts: [{ x: 10, y: 4, w: 4 }, { x: 0, y: 4, w: 4 }] }]; // same stroke, drawn the other way
  const m = blendStrokes(A, B, 0.5, 20);
  assert.ok(m);
  assert.equal(Math.round(m[0].pts[0].x), 0);
  assert.equal(Math.round(m[0].pts.at(-1).x), 10);
  assert.ok(m[0].pts.every((p) => Math.abs(p.y - 2) < 1e-9 && Math.abs(p.w - 3) < 1e-9));
  assert.equal(blendStrokes(A, [...B, ...B], 0.5, 20), null);
  const far = [{ pts: [{ x: 60, y: -60, w: 2 }, { x: 90, y: -60, w: 2 }] }];
  assert.equal(blendStrokes(A, far, 0.5, 20), null);
});

test('bending moves points a little, never a lot', () => {
  const s = [{ pts: Array.from({ length: 20 }, (_, i) => ({ x: i, y: -i, w: 2 })) }];
  const b = bendStrokes(s, 20, mulberry32(7));
  const moved = b[0].pts.map((p, i) => Math.hypot(p.x - s[0].pts[i].x, p.y - s[0].pts[i].y));
  assert.ok(Math.max(...moved) > 0.2, 'should change the shape');
  assert.ok(Math.max(...moved) < 4, `moved too far: ${Math.max(...moved)}`);
});

test('coverage: a good trace explains its ink, a broken one does not', async () => {
  const { coverage } = await import('../js/strokes.js');
  const a = img(60, 20, (dot) => {
    for (let x = 8; x <= 52; x++) dot(x, 10, 3);
  });
  const good = traceStrokes(a, 60, 20);
  assert.ok(coverage(good, a, 60, 20) > 0.9, `good ${coverage(good, a, 60, 20)}`);
  const half = [{ pts: good[0].pts.filter((p) => p.x < 30) }];
  assert.ok(coverage(half, a, 60, 20) < 0.7, `half ${coverage(half, a, 60, 20)}`);
});
