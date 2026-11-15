// Sample checker: find handwriting samples that will print wrongly — a "2" floating above the
// line, a "p" without its tail, a capital as small as a lower-case letter, or a sample that looks
// nothing like the writer's other samples of the same character (usually a mislabelled one).
// DOM-free so it can be unit tested. Sizes are measured in x-heights of the writer's own letters.

const X_LETTERS = 'acemnorsuvwxz';
const TALL = 'bdhkl';
const TAILS = 'gjpqy';

/**
 * Size and position of a sample relative to the baseline, in x-heights.
 *   up: how far the top is above the baseline    dn: how far the bottom is below it (negative = above)
 *   hT / wT: height and width
 * g: { inkH, inkW, yOff } in the sample's own pixels; xh: x-height in those pixels.
 */
export function metrics(g, xh) {
  return { up: (g.inkH - g.yOff) / xh, dn: g.yOff / xh, hT: g.inkH / xh, wT: g.inkW / xh };
}

const show = (ch) => (ch === ' ' ? 'space' : `"${ch}"`);

/** Problems with where a sample sits and how big it is, given what character it should be. */
export function positionProblems(ch, m) {
  if (ch.length !== 1) return [];
  const out = [];
  const letterLike = /[A-Za-z0-9]/.test(ch);
  if (!letterLike) return out; // punctuation varies too much between writers to judge
  const tail = TAILS.includes(ch);
  if (m.dn < -0.45) out.push(`${show(ch)} floats above the line`);
  else if (!tail && m.dn > 0.6) out.push(`${show(ch)} hangs below the line`);
  if (tail && m.dn < 0.12) out.push(`${show(ch)} is missing its tail below the line`);
  if (/[A-Z0-9]/.test(ch) && m.up < 0.85) out.push(`${show(ch)} is too small for a ${/[0-9]/.test(ch) ? 'number' : 'capital'}`);
  if (TALL.includes(ch) && m.up < 1.05) out.push(`${show(ch)} is no taller than a small letter`);
  if (ch === 't' && m.up < 0.85) out.push(`${show(ch)} is too short`);
  // letters with a bowl or arch cannot be a thin line: part of the letter is missing
  if ('abcdeghkmnopqsuvwxyz'.includes(ch) && m.wT < 0.3) out.push(`${show(ch)} is too narrow (part of the letter may be missing)`);
  if (X_LETTERS.includes(ch)) {
    if (m.up > 1.75) out.push(`${show(ch)} is as tall as a capital`);
    else if (m.up < 0.4) out.push(`${show(ch)} is very small`);
  }
  return out;
}

/** A small, blurred picture of a sample, for comparing shapes. alpha is 0..scaleMax, w x h. */
export function signature(alpha, w, h, scaleMax = 1, N = 12) {
  let sig = new Float32Array(N * N);
  let minx = w;
  let maxx = -1;
  let miny = h;
  let maxy = -1;
  const thr = 0.35 * scaleMax;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < thr) continue;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (maxx < 0) return sig;
  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      if (alpha[y * w + x] < thr) continue;
      sig[Math.min(N - 1, Math.floor(((y - miny) / bh) * N)) * N + Math.min(N - 1, Math.floor(((x - minx) / bw) * N))]++;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < N && xx >= 0 && xx < N) v += sig[yy * N + xx];
        }
        out[y * N + x] = v;
      }
    }
    sig = out;
  }
  let n = 0;
  for (const v of sig) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < sig.length; i++) sig[i] /= n;
  return sig;
}

const sim = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * Review every sample. samples: [{ ch, m, sig }]. Returns an array of reason lists, one per
 * sample (empty when it looks fine).
 */
export function reviewSamples(samples) {
  const reasons = samples.map((s) => positionProblems(s.ch, s.m));
  const byChar = new Map();
  samples.forEach((s, i) => {
    if (!byChar.has(s.ch)) byChar.set(s.ch, []);
    byChar.get(s.ch).push(i);
  });
  for (const [ch, idx] of byChar) {
    if (idx.length < 2) continue;
    // size compared with the writer's other samples of the same character
    const hs = idx.map((i) => samples[i].m.hT);
    const mh = median(hs);
    if (idx.length >= 3) {
      idx.forEach((i) => {
        const r = samples[i].m.hT / mh;
        if (r < 0.6 || r > 1.65) reasons[i].push(`this ${show(ch)} is a different size from your other ${show(ch)}`);
      });
      const mw = median(idx.map((i) => samples[i].m.wT));
      idx.forEach((i) => {
        const r = samples[i].m.wT / mw;
        if (r < 0.5 || r > 2) reasons[i].push(`this ${show(ch)} is ${r < 1 ? 'much narrower' : 'much wider'} than your other ${show(ch)}`);
      });
    }
    // shape compared with the others
    if (idx.length === 2) {
      const [a, b] = idx;
      if (sim(samples[a].sig, samples[b].sig) < 0.45) {
        // when one of them also sits wrongly, that one is the suspect; otherwise flag both
        const bad = [a, b].filter((i) => reasons[i].length);
        for (const i of bad.length === 1 ? bad : [a, b]) reasons[i].push(`your two ${show(ch)} samples look different from each other`);
      }
    } else {
      const score = idx.map((i) => median(idx.filter((j) => j !== i).map((j) => sim(samples[i].sig, samples[j].sig))));
      const typical = median(score);
      idx.forEach((i, k) => {
        if (score[k] < 0.45 && score[k] < typical - 0.2) reasons[i].push(`this ${show(ch)} looks different from your other ${show(ch)} samples`);
      });
    }
  }
  return reasons;
}

/**
 * Which samples to use when writing: leave out flagged ones, except when every sample of a
 * character is flagged (a doubtful letter is better than a missing one).
 */
export function usableSamples(glyphs, reasons) {
  const okChars = new Set(glyphs.filter((g, i) => !reasons[i].length).map((g) => g.ch));
  return glyphs.filter((g, i) => !reasons[i].length || !okChars.has(g.ch));
}
