import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHsv, printRisk, PEN_PRESETS, TEST_INKS } from '../js/inkcolor.js';

test('hex and HSV conversions', () => {
  assert.deepEqual(hexToRgb('#212394'), [33, 35, 148]);
  assert.equal(hexToRgb('nope'), null);
  const { h, s, v } = rgbToHsv([33, 35, 148]);
  assert.ok(Math.abs(h - 239) < 2 && s > 0.75 && Math.abs(v - 0.58) < 0.01);
});

test('the bright blue from the real print is flagged; the default navy is not', () => {
  assert.match(printRisk('#212394'), /print lighter and greyer/); // looked vivid on screen, printed as #3f5c79
  assert.equal(printRisk('#1f2a6b'), null);
});

test('very light ink is flagged as faint', () => {
  assert.match(printRisk('#d8dde6'), /faint/);
});

test('every pen preset prints reliably', () => {
  for (const p of PEN_PRESETS) assert.equal(printRisk(p.hex), null, `${p.name} ${p.hex}`);
});

test('the ink test page has distinct lines A-G', () => {
  assert.deepEqual(TEST_INKS.map((t) => t.label).join(''), 'ABCDEFG');
  assert.equal(new Set(TEST_INKS.map((t) => t.hex)).size, TEST_INKS.length);
});
