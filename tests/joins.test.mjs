import test from 'node:test';
import assert from 'node:assert/strict';
import { thin, joinPoints } from '../js/joins.js';

function canvas(w, h, draw) {
  const a = new Float32Array(w * h);
  const set = (x, y) => {
    if (x >= 0 && y >= 0 && x < w && y < h) a[y * w + x] = 1;
  };
  draw(set);
  return a;
}
const thick = (set, x, y, r = 2) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) set(x + dx, y + dy);
};

test('thin reduces a thick bar to a one-pixel line', () => {
  const w = 40;
  const h = 12;
  const a = canvas(w, h, (set) => {
    for (let x = 5; x < 35; x++) thick(set, x, 6);
  });
  const sk = thin(Uint8Array.from(a), w, h);
  for (let x = 8; x < 32; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) n += sk[y * w + x];
    assert.equal(n, 1, `column ${x} should hold exactly one pixel`);
  }
});

test('a "u" is entered at the top left and left at the top right', () => {
  // two stems joined at the bottom, x-height 20, baseline at y=30
  const w = 40;
  const h = 40;
  const a = canvas(w, h, (set) => {
    for (let y = 10; y < 28; y++) thick(set, 8, y), thick(set, 28, y);
    for (let x = 8; x <= 28; x++) thick(set, x, 28);
  });
  const j = joinPoints(a, w, h, { base: 30, xh: 20 });
  assert.ok(j.entry.x < 14 && j.entry.y < 16, `entry ${JSON.stringify(j.entry)}`);
  assert.ok(j.exit.x > 22 && j.exit.y < 16, `exit ${JSON.stringify(j.exit)}`);
  assert.ok(j.width >= 3 && j.width <= 6, `stroke width ${j.width}`);
});

test('a closed "o" is left from the top right and entered at the left', () => {
  const w = 40;
  const h = 40;
  const a = canvas(w, h, (set) => {
    for (let t = 0; t < 360; t += 2) {
      const r = (t * Math.PI) / 180;
      thick(set, Math.round(20 + 9 * Math.cos(r)), Math.round(20 + 9 * Math.sin(r)), 1);
    }
  });
  const j = joinPoints(a, w, h, { base: 30, xh: 20 });
  assert.ok(j.entry.x < 15, `entry ${JSON.stringify(j.entry)}`);
  assert.ok(j.exit.x > 22 && j.exit.y < 20, `exit ${JSON.stringify(j.exit)}`);
});

test('a "t" leaves from its foot, not from the end of its cross-bar', () => {
  // stem from y=4 to the baseline with a hook to the right, cross-bar at y=12
  const w = 40;
  const h = 40;
  const a = canvas(w, h, (set) => {
    for (let y = 4; y < 28; y++) thick(set, 14, y, 1);
    for (let x = 14; x < 24; x++) thick(set, x, 29 - Math.round((x - 14) * 0.3), 1);
    for (let x = 6; x < 22; x++) thick(set, x, 12, 1);
  });
  const j = joinPoints(a, w, h, { base: 30, xh: 20 });
  assert.ok(j.exit.y > 22, `exit should be low, got ${JSON.stringify(j.exit)}`);
});

test('no ink in the joining zone gives no join points', () => {
  const a = canvas(20, 40, (set) => thick(set, 10, 3, 1)); // an apostrophe high above the x-height
  assert.equal(joinPoints(a, 20, 40, { base: 35, xh: 15 }), null);
});
