// Learn letter and word spacing from a sentence written on screen. DOM-free so it can be unit tested.
// Strokes are arrays of {x, y, p} points in pad units, where the pad's x-height guide is `xh` tall.

export const SPACING_PHRASES = ['the quick brown fox', 'jumps over the lazy dog'];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Split one written line into words using horizontal gaps between strokes.
 * Returns { gaps, widths } (word gaps and word widths) or null when the words cannot be told apart.
 */
export function measureLine(strokes, wordCount, penHalf = 2, mergeGap = 4) {
  const spans = strokes
    .filter((s) => s.length)
    .map((s) => [Math.min(...s.map((p) => p.x)) - penHalf, Math.max(...s.map((p) => p.x)) + penHalf])
    .sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [a, b] of spans) {
    const last = runs[runs.length - 1];
    if (last && a <= last[1] + mergeGap) last[1] = Math.max(last[1], b);
    else runs.push([a, b]);
  }
  if (runs.length < wordCount) return null;
  const gaps = runs.slice(1).map((r, i) => ({ i, g: r[0] - runs[i][1] }));
  const wordGaps = [...gaps]
    .sort((a, b) => b.g - a.g)
    .slice(0, wordCount - 1)
    .sort((a, b) => a.i - b.i);
  const widths = [];
  let start = runs[0][0];
  for (const wg of wordGaps) {
    widths.push(runs[wg.i][1] - start);
    start = runs[wg.i + 1][0];
  }
  widths.push(runs[runs.length - 1][1] - start);
  return { gaps: wordGaps.map((w) => w.g), widths };
}

/**
 * Estimate the x-height of written text: most ink sits in the band between baseline and x-height,
 * so take the densest contiguous band of ink rows. Returns null if there is too little ink.
 */
export function measureXHeight(strokes) {
  const ys = [];
  for (const s of strokes) {
    for (let i = 0; i < s.length; i++) {
      if (i === 0) {
        ys.push(s[0].y);
        continue;
      }
      const a = s[i - 1];
      const b = s[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let k = 1; k <= n; k++) ys.push(a.y + ((b.y - a.y) * k) / n);
    }
  }
  if (ys.length < 30) return null;
  const lo = Math.floor(Math.min(...ys));
  const hist = new Array(Math.ceil(Math.max(...ys)) - lo + 2).fill(0);
  for (const y of ys) hist[Math.round(y) - lo]++;
  const sm = hist.map((_, i) => (hist[i - 1] || 0) + hist[i] + (hist[i + 1] || 0));
  const peak = sm.indexOf(Math.max(...sm));
  const cut = sm[peak] * 0.3;
  let top = peak;
  let bot = peak;
  while (top > 0 && sm[top - 1] >= cut) top--;
  while (bot < sm.length - 1 && sm[bot + 1] >= cut) bot++;
  return bot - top + 1;
}

/**
 * lines: [{ phrase, strokes }]
 * inkWidth(word): expected ink width of the word's letters placed edge to edge, measured in
 *   x-heights (so it does not matter how big the sentence was written), or null if unknown.
 * guideXh: the pad's x-height guide, used when the writing's own x-height cannot be measured.
 * Returns { wordSpacing, letterSpacing? } in the renderer's units (multiples of x-height), or null.
 */
export function learnSpacing(lines, inkWidth, guideXh = 40, penHalf = 2) {
  const gaps = [];
  const extra = [];
  for (const { phrase, strokes } of lines) {
    const words = phrase.split(' ');
    const measured = measureXHeight(strokes);
    const xh = measured && measured > guideXh * 0.4 && measured < guideXh * 2.5 ? measured : guideXh;
    const m = measureLine(strokes, words.length, penHalf, xh * 0.12);
    if (!m) continue;
    gaps.push(...m.gaps.map((g) => g / xh));
    words.forEach((w, i) => {
      const e = inkWidth(w);
      if (e != null && w.length > 1) extra.push((m.widths[i] - e * xh) / (w.length - 1) / xh);
    });
  }
  if (!gaps.length) return null;
  const out = { wordSpacing: +clamp(median(gaps) / 1.05, 0.5, 2).toFixed(2) };
  if (extra.length) out.letterSpacing = +clamp(median(extra), -0.1, 0.6).toFixed(2);
  return out;
}
