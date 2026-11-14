import test from 'node:test';
import assert from 'node:assert/strict';
import { otsu, labelComponents, solveHomography, applyHomography, findCornerMarkers, normalizeBackground } from '../js/cv.js';

test('otsu separates dark from light', () => {
  const a = new Uint8ClampedArray(1000).fill(240);
  for (let i = 0; i < 200; i++) a[i] = 20;
  const t = otsu(a);
  assert.ok(t >= 20 && t < 240);
});

test('labelComponents counts separate blobs', () => {
  const w = 10;
  const h = 4;
  const m = new Uint8Array(w * h);
  [0, 1, 10, 11, 8, 18].forEach((i) => (m[i] = 1)); // block of 4 + pair
  const { comps } = labelComponents(m, w, h);
  assert.equal(comps.length, 2);
  assert.deepEqual(comps.map((c) => c.area).sort(), [2, 4]);
});

test('homography maps the four corners exactly and round-trips', () => {
  const from = [[0, 0], [100, 0], [0, 200], [100, 200]];
  const to = [[10, 5], [120, 20], [-5, 230], [130, 250]];
  const H = solveHomography(from, to);
  from.forEach(([x, y], i) => {
    const [u, v] = applyHomography(H, x, y);
    assert.ok(Math.abs(u - to[i][0]) < 1e-6 && Math.abs(v - to[i][1]) < 1e-6);
  });
});

test('findCornerMarkers locates four solid squares', () => {
  const w = 200;
  const h = 280;
  const img = new Uint8ClampedArray(w * h).fill(250);
  const sq = (cx, cy) => {
    for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) img[y * w + x] = 0;
  };
  sq(12, 12); sq(188, 12); sq(12, 268); sq(188, 268);
  // handwriting-like stroke that must not be mistaken for a marker
  for (let x = 60; x < 140; x++) img[140 * w + x] = 0;
  const pts = findCornerMarkers(img, w, h);
  assert.ok(pts);
  assert.deepEqual(pts.map((p) => p.map(Math.round)), [[12, 12], [188, 12], [12, 268], [188, 268]]);
});

test('normalizeBackground evens out a lighting gradient', () => {
  const w = 128;
  const h = 128;
  const img = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = 150 + (x / w) * 100;
  const out = normalizeBackground(img, w, h);
  const lo = out[64 * w + 4];
  const hi = out[64 * w + 123];
  assert.ok(Math.abs(lo - hi) < 30, `${lo} vs ${hi}`);
});
