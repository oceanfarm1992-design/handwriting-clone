import test from 'node:test';
import assert from 'node:assert/strict';
import { measureLine, learnSpacing, measureXHeight } from '../js/spacing.js';

// A "letter" is one vertical stroke at x; letters inside a word are 10 apart, words 50 apart.
function writeLine(words, letterGap = 10, wordGap = 50) {
  const strokes = [];
  let x = 0;
  words.forEach((w, wi) => {
    if (wi) x += wordGap;
    [...w].forEach((_, li) => {
      if (li) x += letterGap;
      strokes.push([{ x, y: 70, p: 0.5 }, { x, y: 110, p: 0.5 }]);
    });
  });
  return strokes;
}

test('measureLine finds word gaps and widths', () => {
  const m = measureLine(writeLine(['ab', 'cde']), 2, 0, 4);
  assert.deepEqual(m.gaps, [50]);
  assert.deepEqual(m.widths, [10, 20]);
});

test('measureLine gives up when words touch', () => {
  assert.equal(measureLine([[{ x: 0, y: 0, p: 0.5 }, { x: 100, y: 0, p: 0.5 }]], 3), null);
});

test('learnSpacing converts gaps to x-height units', () => {
  const strokes = writeLine(['the', 'quick'], 10, 42);
  const xh = measureXHeight(strokes);
  const r = learnSpacing([{ phrase: 'the quick', strokes }], () => 0, 40, 0);
  assert.equal(r.wordSpacing, +(42 / xh / 1.05).toFixed(2));
  assert.equal(r.letterSpacing, +(10 / xh).toFixed(2));
});

test('measureXHeight finds the dense ink band, ignoring a tall ascender', () => {
  const strokes = [];
  for (let x = 0; x < 200; x += 10) strokes.push([{ x, y: 70, p: 0.5 }, { x: x + 5, y: 110, p: 0.5 }, { x, y: 70, p: 0.5 }]);
  strokes.push([{ x: 300, y: 30, p: 0.5 }, { x: 300, y: 110, p: 0.5 }]);
  const xh = measureXHeight(strokes);
  assert.ok(xh >= 38 && xh <= 44, String(xh));
});

test('learnSpacing does not depend on how big the sentence is written', () => {
  const tall = (strokes, k) => strokes.map((s) => s.map((p) => ({ ...p, x: p.x * k, y: 110 - (110 - p.y) * k })));
  const base = writeLine(['the', 'quick'], 10, 42);
  const a = learnSpacing([{ phrase: 'the quick', strokes: base }], () => 0, 40, 0);
  const b = learnSpacing([{ phrase: 'the quick', strokes: tall(base, 1.5) }], () => 0, 40, 0);
  assert.ok(Math.abs(a.wordSpacing - b.wordSpacing) <= 0.03, `${a.wordSpacing} vs ${b.wordSpacing}`);
  assert.ok(Math.abs(a.letterSpacing - b.letterSpacing) <= 0.03, `${a.letterSpacing} vs ${b.letterSpacing}`);
});

test('learnSpacing returns null without usable lines', () => {
  assert.equal(learnSpacing([{ phrase: 'a b c', strokes: [] }], () => null), null);
});
