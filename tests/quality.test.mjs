import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, positionProblems, signature, reviewSamples, usableSamples } from '../js/quality.js';

const XH = 20;
const m = (inkH, yOff, inkW = 16) => metrics({ inkH, inkW, yOff }, XH);

test('metrics measure from the baseline in x-heights', () => {
  assert.deepEqual(m(20, 0), { up: 1, dn: 0, hT: 1, wT: 0.8 });
  assert.deepEqual(m(30, 10), { up: 1, dn: 0.5, hT: 1.5, wT: 0.8 });
});

test('a "2" floating above the line is flagged; one on the line is not', () => {
  assert.deepEqual(positionProblems('2', m(30, 0)), []);
  assert.match(positionProblems('2', m(14, -16)).join(), /floats above the line/);
});

test('a "p" without a tail and a tiny capital are flagged', () => {
  assert.match(positionProblems('p', m(28, 0)).join(), /missing its tail/);
  assert.deepEqual(positionProblems('p', m(30, 10)), []);
  assert.match(positionProblems('K', m(12, 2)).join(), /too small for a capital/);
});

test('a "b" no taller than an "o" is flagged', () => {
  assert.match(positionProblems('b', m(20, 0)).join(), /no taller than a small letter/);
  assert.deepEqual(positionProblems('b', m(34, 0)), []);
});

test('punctuation and joined pairs are not judged on position', () => {
  assert.deepEqual(positionProblems(',', m(10, 6)), []);
  assert.deepEqual(positionProblems('th', m(40, -30)), []);
});

function shape(draw) {
  const w = 24;
  const h = 24;
  const a = new Float32Array(w * h);
  draw((x, y) => (a[y * w + x] = 1));
  return signature(a, w, h);
}
const ring = shape((set) => {
  for (let t = 0; t < 360; t += 3) set(Math.round(12 + 9 * Math.cos((t * Math.PI) / 180)), Math.round(12 + 9 * Math.sin((t * Math.PI) / 180)));
});
const ring2 = shape((set) => {
  for (let t = 0; t < 360; t += 3) set(Math.round(12 + 8 * Math.cos((t * Math.PI) / 180)), Math.round(12 + 10 * Math.sin((t * Math.PI) / 180)));
});
const cross = shape((set) => {
  for (let i = 2; i < 22; i++) set(i, 12), set(12, i);
});

test('the odd one out among several samples of a character is flagged', () => {
  const s = [ring, ring2, ring, cross].map((sig) => ({ ch: 'o', m: m(20, 0), sig }));
  const r = reviewSamples(s);
  assert.deepEqual(r.map((x) => x.length > 0), [false, false, false, true]);
  assert.match(r[3].join(), /looks different/);
});

test('two disagreeing samples: the one that also sits wrongly is the suspect', () => {
  const r = reviewSamples([
    { ch: '0', m: m(30, 0), sig: ring },
    { ch: '0', m: m(30, -16), sig: cross },
  ]);
  assert.equal(r[0].length, 0);
  assert.ok(r[1].some((x) => /floats/.test(x)) && r[1].some((x) => /look different/.test(x)));
});

test('a sample far smaller than its siblings is flagged', () => {
  const s = [20, 21, 19, 9].map((hgt) => ({ ch: 'a', m: m(hgt, 0), sig: ring }));
  const r = reviewSamples(s);
  assert.match(r[3].join(), /different size/);
  assert.equal(r[0].length, 0);
});

test('usableSamples drops flagged samples unless that would leave a character with none', () => {
  const g = [{ ch: 'a' }, { ch: 'a' }, { ch: 'b' }];
  assert.deepEqual(usableSamples(g, [[], ['bad'], ['bad']]).map((x) => x.ch), ['a', 'b']);
});

test('a "b" that is only a stick is flagged as too narrow, and so is a much narrower sibling', () => {
  assert.match(positionProblems('b', m(34, 0, 3)).join(), /too narrow/);
  const s = [16, 15, 17, 6].map((w) => ({ ch: 'h', m: m(34, 0, w), sig: ring }));
  assert.match(reviewSamples(s)[3].join(), /much narrower/);
});
