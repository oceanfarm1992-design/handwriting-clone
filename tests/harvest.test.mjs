import test from 'node:test';
import assert from 'node:assert/strict';
import { segment, align, plausible, harvest } from '../js/harvest.js';

// Draw a fake page: every letter is a filled box. 'x'-type letters are 20 tall, tall letters 34,
// letters with tails hang 10 below the line. Lines can slope like real handwriting on plain paper.
const TALL = 'bdhklt';
const TAIL = 'gpqy';
function page(lines, { slope = 0, letterGap = 6, wordGap = 34 } = {}) {
  const w = 700;
  const h = 90 + lines.length * 80;
  const img = new Uint8ClampedArray(w * h).fill(245);
  lines.forEach((text, li) => {
    let x = 40;
    for (const word of text.split(' ')) {
      for (const ch of word) {
        const base = Math.round(90 + li * 80 + slope * x);
        const top = base - (TALL.includes(ch) ? 34 : 20);
        const bot = base + (TAIL.includes(ch) ? 10 : 0);
        const wd = ch === 'm' ? 26 : 14;
        for (let y = top; y < bot; y++) for (let xx = x; xx < x + wd; xx++) img[y * w + xx] = 20;
        x += wd + letterGap;
      }
      x += wordGap - letterGap;
    }
  });
  return { img, w, h };
}

test('segment finds lines, words and letters', () => {
  const { img, w, h } = page(['the cat sat', 'on a mat']);
  const seg = segment(img, w, h);
  assert.equal(seg.lines.length, 2);
  assert.deepEqual(seg.lines.map((L) => L.words.map((wd) => wd.units.length)), [[3, 3, 3], [2, 1, 3]]);
  assert.ok(Math.abs(seg.xh - 20) <= 2, `x-height ${seg.xh}`);
});

test('segment follows sloping lines', () => {
  const { img, w, h } = page(['one two three four five', 'six seven eight nine ten'], { slope: -0.05 });
  const seg = segment(img, w, h);
  assert.equal(seg.lines.length, 2);
  assert.deepEqual(seg.lines.map((L) => L.words.length), [5, 5]);
});

test('align skips an extra blob and still pairs the real words', () => {
  const word = (n) => ({ units: new Array(n).fill({}), width: n * 20 });
  const words = [word(3), word(5), word(1), word(2)]; // the 1-blob word is a stray mark
  const tokens = ['the', 'quick', 'ox'].map((t) => [...t]);
  const pairs = align(words, tokens).filter(Boolean);
  assert.deepEqual(pairs.map((p) => p.token.join('')), ['the', 'quick', 'ox']);
  assert.deepEqual(pairs.map((p) => p.word.units.length), [3, 5, 2]);
});

test('plausible rejects shapes that cannot be the letter', () => {
  const x = { up: 1, dn: 0, hT: 1, wT: 0.8 };
  assert.ok(plausible('a', x));
  assert.ok(!plausible('d', x)); // d must be tall
  assert.ok(!plausible('g', x)); // g must have a tail
  assert.ok(!plausible('a', { ...x, wT: 2 })); // too wide for one letter
  assert.ok(plausible('g', { up: 1, dn: 0.5, hT: 1.5, wT: 0.8 }));
});

test('harvest labels letters from the transcript and learns spacing', () => {
  const lines = ['the cat sat on the mat', 'a dog and a goat ate that'];
  const { img, w, h } = page(lines);
  const { glyphs, stats } = harvest(img, w, h, lines.join('\n'));
  const by = {};
  for (const g of glyphs) (by[g.ch] ||= []).push(g);
  assert.equal(stats.matchedWords, 13);
  for (const ch of 'thecasondgm') assert.ok(by[ch]?.length, `missing ${ch}`);
  assert.ok(by.a.length <= 4);
  // tall and tailed letters keep their geometry relative to the baseline
  const t = by.t[0];
  const g = by.g[0];
  assert.ok(t.baseline - t.miny > 30, 'tall letter height');
  assert.ok(g.maxy + 1 - g.baseline >= 8, 'tail below the baseline');
  assert.ok(Math.abs(stats.letterSpacing - 6 / 20) < 0.08, `letter spacing ${stats.letterSpacing}`);
  assert.ok(stats.wordSpacing > 1.3 && stats.wordSpacing < 1.9, `word spacing ${stats.wordSpacing}`);
});

test('harvest refuses a transcript that does not fit the page', () => {
  const { img, w, h } = page(['the cat sat on the mat']);
  const { glyphs } = harvest(img, w, h, 'completely different words about something else entirely here');
  assert.ok(glyphs.length <= 2, `harvested ${glyphs.length} from a wrong transcript`);
});
