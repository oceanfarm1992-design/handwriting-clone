// Learn handwriting from a photo of ordinary writing plus the text it says. No template needed.
//
//   1. segment()  finds ink blobs, groups them into lines, letters ("units") and words
//   2. align()    lines the detected words up with the words of the transcript
//   3. harvest()  takes letters from words whose letters are written separately, rejects
//                 implausible ones, and lets samples of the same letter vote out the odd ones
//
// DOM-free: works on grayscale arrays so it can be unit tested in Node.
import { labelComponents, normalizeBackground } from './cv.js';

const med = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const X_LETTERS = 'acemnorsuvwxz';

/** Robust straight-line fit of a text baseline through the bottoms of letters. */
function fitBaseline(items, H0) {
  const pts = items.map((c) => ({ x: c.cx, y: c.maxy + 1 }));
  let a = 0;
  let b = med(pts.map((p) => p.y));
  for (let it = 0; it < 4; it++) {
    const inl = pts.filter((p) => Math.abs(p.y - (a * p.x + b)) < 0.35 * H0);
    if (inl.length < 4) break;
    const mx = inl.reduce((s, p) => s + p.x, 0) / inl.length;
    const my = inl.reduce((s, p) => s + p.y, 0) / inl.length;
    const sxx = inl.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const sxy = inl.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    a = sxx > H0 * H0 * 4 ? clamp(sxy / sxx, -0.25, 0.25) : 0;
    b = my - a * mx;
  }
  return (x) => a * x + b;
}

/** Find lines, letter units and words in a grayscale photo of handwriting. */
export function segment(luma, w, h) {
  const norm = normalizeBackground(luma, w, h, 32, 0.8);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = norm[i] < 165 ? 1 : 0;
  const { labels, comps: raw } = labelComponents(mask, w, h, true);
  let comps = raw
    .map((c) => ({
      id: c.id, area: c.area, minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy,
      bw: c.maxx - c.minx + 1, bh: c.maxy - c.miny + 1, cx: (c.minx + c.maxx) / 2, cy: (c.miny + c.maxy) / 2,
    }))
    .filter((c) => c.area >= 4 && c.bw < 0.3 * w && c.bh < 0.2 * h);
  const H0 = med(comps.filter((c) => c.area >= 12).map((c) => c.bh)) || 10;
  // drop specks, and long thin strokes (underlines, ruled lines)
  comps = comps.filter((c) => c.area >= Math.max(4, 0.008 * H0 * H0) && !(c.bw >= 3 * H0 && c.bh <= 0.6 * H0));

  // ---- lines: chain each letter-sized blob to its best right-hand neighbour (the one it overlaps
  // most vertically, preferring near ones). Chains follow sloping lines, which a fixed band cannot.
  const bodies = comps.filter((c) => c.bh >= 0.45 * H0).sort((a, b) => a.minx - b.minx);
  const root = bodies.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    let best = -1;
    let bs = -Infinity;
    for (let j = i + 1; j < bodies.length; j++) {
      const c = bodies[j];
      const gap = c.minx - a.maxx;
      if (gap > 7 * H0) break;
      const ov = Math.min(a.maxy, c.maxy) - Math.max(a.miny, c.miny) + 1;
      const frac = ov / Math.min(a.bh, c.bh);
      if (frac < 0.5) continue;
      const score = frac - 0.08 * Math.max(0, gap) / H0;
      if (score > bs) {
        bs = score;
        best = j;
      }
    }
    if (best >= 0) root[find(i)] = find(best);
  }
  const chains = new Map();
  bodies.forEach((c, i) => {
    const r = find(i);
    if (!chains.has(r)) chains.set(r, { items: [] });
    chains.get(r).items.push(c);
  });
  let lines = [...chains.values()];
  for (const L of lines) L.base = fitBaseline(L.items, H0);
  // short fragments (a lone number, a word after a wide gap) join the line whose baseline passes through them
  lines.sort((p, q) => q.items.length - p.items.length);
  for (let i = lines.length - 1; i > 0; i--) {
    const small = lines[i];
    const sx = med(small.items.map((c) => c.cx));
    const sy = small.base(sx);
    let best = null;
    let bd = 0.5 * H0;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(lines[j].base(sx) - sy);
      if (d < bd) {
        bd = d;
        best = lines[j];
      }
    }
    if (best) {
      best.items.push(...small.items);
      best.base = fitBaseline(best.items, H0);
      lines.splice(i, 1);
    }
  }

  // x-height: letters sitting on the baseline are either x-height or ascender height; take the lower group
  const lineXh = [];
  for (const L of lines) {
    const hs = L.items.filter((c) => Math.abs(c.maxy + 1 - L.base(c.cx)) < 0.3 * H0 && c.bw < 2.5 * H0).map((c) => L.base(c.cx) - c.miny);
    if (hs.length >= 4) lineXh.push(pct(hs, 0.3));
  }
  const xh = med(lineXh) || H0 * 0.8;

  // ---- small blobs (dots, commas, ticks) join the line whose baseline they sit sensibly against
  for (const s of comps) {
    if (s.bh >= 0.45 * H0) continue;
    let best = null;
    let bd = Infinity;
    for (const L of lines) {
      const near = L.items.some((b) => Math.abs(b.cx - s.cx) < 8 * H0);
      if (!near) continue;
      const rel = (L.base(s.cx) - s.cy) / xh; // + above the baseline
      if (rel < -0.7 || rel > 2.0) continue;
      const d = Math.abs(rel - 0.65);
      if (d < bd) {
        bd = d;
        best = L;
      }
    }
    if (best) best.items.push(s);
  }
  lines = lines.filter((L) => L.items.length).sort((a, b) => a.base(w / 2) - b.base(w / 2));

  // ---- units: merge the parts of one character (i/j dots, : ; = ! ? ")
  const allGaps = [];
  for (const L of lines) {
    const cs = L.items;
    const parent = new Map(cs.map((c) => [c.id, c.id]));
    const top = (i) => (parent.get(i) === i ? i : (parent.set(i, top(parent.get(i))), parent.get(i)));
    const union = (p, q) => parent.set(top(p.id), top(q.id));
    const small = (c) => c.bh < 0.5 * xh && c.bw < 0.55 * xh;
    const tick = (c) => c.bh > 0.3 * xh && c.bh > 1.4 * c.bw && c.maxy < L.base(c.cx) - 0.5 * xh;
    const merged = new Set();
    // dot above an x-height stem (i, j)
    for (const s of cs) {
      if (!small(s) || tick(s) || s.maxy > L.base(s.cx) - 0.85 * xh) continue;
      let best = null;
      let bd = Infinity;
      for (const b of cs) {
        if (b === s || small(b)) continue;
        const up = L.base(b.cx) - b.miny;
        if (up > 1.3 * xh && b.bw < 1.5 * xh) continue; // a single tall letter (l, t, d) takes no dot
        const gap = b.miny - s.maxy;
        if (gap < -0.1 * xh || gap > 0.9 * xh) continue;
        if (s.cx < b.minx - 0.45 * xh || s.cx > b.maxx + 0.45 * xh) continue;
        const d = Math.abs(s.cx - clamp(s.cx, b.minx, b.maxx)) + 0.01 * Math.abs(s.cx - b.cx);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) {
        union(s, best);
        merged.add(s.id);
      }
    }
    for (const p of cs) {
      if (merged.has(p.id)) continue;
      for (const q of cs) {
        if (q === p || merged.has(q.id)) continue;
        const gap = q.miny - p.maxy; // q below p
        const base = L.base(q.cx);
        // colon / semicolon: a dot inside the x-height over a dot or comma on the baseline
        if (small(p) && q.bh < 0.8 * xh && q.bw < 0.6 * xh && Math.abs(p.cx - q.cx) < 0.6 * xh && gap > 0 && gap < 0.9 * xh &&
            Math.abs(q.miny - base) < 0.7 * xh && p.miny > base - 1.25 * xh && p.maxy < base - 0.2 * xh) union(p, q);
        // equals sign: two short flat strokes
        const ov = Math.min(p.maxx, q.maxx) - Math.max(p.minx, q.minx);
        if (p.bh < 0.3 * xh && q.bh < 0.3 * xh && p.bw > 0.3 * xh && q.bw > 0.3 * xh && p.bw < 1.3 * xh &&
            ov > 0.5 * Math.min(p.bw, q.bw) && gap > 0 && gap < 0.6 * xh) union(p, q);
        // ! and ?: a tall stroke that stops short of the baseline, with a dot under it
        if (small(q) && Math.abs(q.maxy + 1 - base) < 0.3 * xh && p.bh >= 0.9 * xh && p.bw < 1.2 * xh &&
            q.cx > p.minx - 0.2 * xh && q.cx < p.maxx + 0.2 * xh && gap > 0.05 * xh && gap < 0.7 * xh && p.maxy < base - 0.2 * xh) union(p, q);
        // double quote: two ticks side by side
        if (tick(p) && tick(q) && q.minx > p.minx && q.minx - p.maxx < 0.4 * xh) union(p, q);
      }
    }
    const groups = new Map();
    for (const c of cs) {
      const r = top(c.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(c);
    }
    L.units = [...groups.values()]
      .map((g) => {
        const u = {
          ids: g.map((c) => c.id),
          minx: Math.min(...g.map((c) => c.minx)), maxx: Math.max(...g.map((c) => c.maxx)),
          miny: Math.min(...g.map((c) => c.miny)), maxy: Math.max(...g.map((c) => c.maxy)),
        };
        u.cx = (u.minx + u.maxx) / 2;
        return u;
      })
      .sort((a, b) => a.minx - b.minx);
    let right = -Infinity;
    for (const u of L.units) {
      u.gap = right === -Infinity ? null : u.minx - right - 1;
      if (u.gap !== null && u.gap >= 0) allGaps.push(u.gap / xh);
      right = Math.max(right, u.maxx);
    }
  }

  // ---- words: gaps fall into two groups (between letters, between words); split between them
  let lo = 0.15;
  let hi = 1.0;
  for (let it = 0; it < 12; it++) {
    const t = (lo + hi) / 2;
    const A = allGaps.filter((g) => g <= t);
    const B = allGaps.filter((g) => g > t && g < 3);
    if (!A.length || !B.length) break;
    lo = A.reduce((s, g) => s + g, 0) / A.length;
    hi = B.reduce((s, g) => s + g, 0) / B.length;
  }
  const wordGap = clamp((lo + hi) / 2, 0.35, 1.6) * xh;
  for (const L of lines) {
    L.words = [];
    let cur = null;
    for (const u of L.units) {
      if (!cur || u.gap > wordGap) {
        cur = { units: [], line: L, gapBefore: cur ? u.gap : null };
        L.words.push(cur);
      }
      cur.units.push(u);
    }
    for (const wd of L.words) {
      wd.minx = wd.units[0].minx;
      wd.maxx = Math.max(...wd.units.map((u) => u.maxx));
      wd.width = wd.maxx - wd.minx + 1;
    }
  }
  return { norm, labels, lines, xh, w, h };
}

/** Align detected words with transcript tokens (edit-distance style). Returns [{ word, token }] matches. */
export function align(words, tokens) {
  const n = words.length;
  const m = tokens.length;
  if (!n || !m) return [];
  const totalChars = tokens.reduce((s, t) => s + t.length, 0);
  const cw = Math.abs(n - m) <= 0.15 * m
    ? words.reduce((s, wd) => s + wd.width, 0) / totalChars
    : med(words.map((wd) => wd.width / wd.units.length));
  const cost = (i, j) => {
    const u = words[i].units.length;
    const c = tokens[j].length;
    const count = u === c ? 0 : Math.min(1, Math.abs(u - c) / Math.max(u, c)) + 0.15;
    const r = words[i].width / (c * cw);
    return count + 0.6 * Math.min(1, Math.abs(Math.log(r)));
  };
  const GAP = 0.9;
  const W = m + 1;
  const D = new Float32Array((n + 1) * W);
  const from = new Uint8Array((n + 1) * W); // 1 diag, 2 up (skip word), 3 left (skip token)
  for (let i = 1; i <= n; i++) (D[i * W] = i * GAP), (from[i * W] = 2);
  for (let j = 1; j <= m; j++) (D[j] = j * GAP), (from[j] = 3);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = D[(i - 1) * W + j - 1] + cost(i - 1, j - 1);
      const up = D[(i - 1) * W + j] + GAP;
      const left = D[i * W + j - 1] + GAP;
      const k = i * W + j;
      if (d <= up && d <= left) (D[k] = d), (from[k] = 1);
      else if (up <= left) (D[k] = up), (from[k] = 2);
      else (D[k] = left), (from[k] = 3);
    }
  }
  const out = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const f = from[i * W + j];
    if (f === 1) {
      out.push({ word: words[i - 1], token: tokens[j - 1], cost: cost(i - 1, j - 1), ratio: words[i - 1].width / (tokens[j - 1].length * cw) });
      i--;
      j--;
    } else if (f === 2) {
      out.push(null);
      i--;
    } else {
      out.push(null);
      j--;
    }
  }
  return out.reverse();
}

/** Is this blob a believable shape for the character? Sizes are in x-heights. */
export function plausible(ch, c) {
  const { up, dn, hT, wT } = c; // height above baseline, depth below it, total height, total width
  if (X_LETTERS.includes(ch)) return up > 0.55 && up < 1.5 && dn < 0.4 && dn > -0.35 && wT < ('mw'.includes(ch) ? 2.6 : 1.6);
  if ('bdhkl'.includes(ch)) return up > 1.15 && dn < 0.5 && dn > -0.35 && wT < 1.5;
  if (ch === 't') return up > 0.95 && dn < 0.5 && dn > -0.35;
  if (/[A-Z]/.test(ch)) return up > 1.1 && dn < 0.9 && dn > -0.35 && wT < ('MW'.includes(ch) ? 3 : 2.2);
  if (/[0-9]/.test(ch)) return up > 0.9 && dn < 0.6 && dn > -0.35 && wT < 1.5;
  if ('gpqy'.includes(ch)) return dn > 0.2 && up > 0.5;
  if (ch === 'j') return dn > 0.2;
  if (ch === 'f') return up > 1.0;
  if (ch === 'i') return up > 0.6 && dn < 0.4 && wT < 0.9;
  if (ch === '.') return hT < 0.5 && wT < 0.5 && dn > -0.35 && dn < 0.3;
  if (ch === ',') return hT < 1.0 && wT < 0.7 && dn > -0.3 && up < 0.6;
  if (ch === '-') return wT > hT * 1.2 && hT < 0.5 && dn < -0.1;
  if (ch === ':') return wT < 0.6 && up < 1.3 && hT > 0.3;
  if (ch === ';') return wT < 0.7 && hT > 0.4;
  if (ch === "'" || ch === '"') return up > 0.9 && dn < -0.4;
  if (ch === '(' || ch === ')') return hT > 1.2 && wT < 2.0 && hT > wT * 1.2;
  if (ch === '!' || ch === '?') return up > 1.1 && wT < 1.2;
  return true;
}

/** Blurred 12x12 picture of a unit, used to compare samples of the same character. */
function signature(seg, unit) {
  const N = 12;
  let sig = new Float32Array(N * N);
  const ids = new Set(unit.ids);
  const bw = unit.maxx - unit.minx + 1;
  const bh = unit.maxy - unit.miny + 1;
  for (let y = unit.miny; y <= unit.maxy; y++) {
    for (let x = unit.minx; x <= unit.maxx; x++) {
      if (!ids.has(seg.labels[y * seg.w + x])) continue;
      sig[Math.min(N - 1, Math.floor(((y - unit.miny) / bh) * N)) * N + Math.min(N - 1, Math.floor(((x - unit.minx) / bw) * N))]++;
    }
  }
  // thin pen strokes shifted by a pixel should still match: blur before comparing
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < N && xx >= 0 && xx < N) v += sig[yy * N + xx];
          }
        }
        out[y * N + x] = v;
      }
    }
    sig = out;
  }
  let norm = 0;
  for (const v of sig) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < sig.length; i++) sig[i] /= norm;
  return sig;
}

function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.sig.length; i++) dot += a.sig[i] * b.sig[i];
  return dot - 0.5 * Math.abs(Math.log((a.wT / a.hT) / (b.wT / b.hT))) - 0.4 * Math.abs(a.hT - b.hT);
}

/** Typical width of a character in x-heights, before any of the writer's own samples are known. */
function defaultWidth(ch) {
  if ("ijl.,;:!'|".includes(ch)) return 0.35;
  if ('mwMW'.includes(ch)) return 1.45;
  if ('ft1-()'.includes(ch)) return 0.6;
  if (/[A-Z]/.test(ch)) return 1.1;
  return 0.85;
}

/** A piece of a blob between two columns (used when two joined letters are cut apart). */
function slice(seg, unit, x0, x1) {
  const ids = new Set(unit.ids);
  let miny = Infinity;
  let maxy = -1;
  let minx = Infinity;
  let maxx = -1;
  for (let y = unit.miny; y <= unit.maxy; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!ids.has(seg.labels[y * seg.w + x])) continue;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
    }
  }
  if (maxy < 0) return null;
  return { ids: unit.ids, minx, maxx, miny, maxy, cx: (minx + maxx) / 2, gap: null, clip: [x0, x1] };
}

/**
 * Harvest letters from a photo given what it says.
 *
 * Pass 1 takes words whose letters are all written separately and lets samples of each letter
 * vote. Pass 2 uses the letters learned in pass 1 to decode words with joined letters: it works
 * out which blobs are single letters from their widths, cuts two-letter blobs at the thin joining
 * stroke, and keeps only pieces that look like the letters already confirmed.
 *
 * Returns { glyphs: [{ ch, ids, minx, miny, maxx, maxy, baseline, clip?, score }], stats, seg }.
 */
export function harvest(luma, w, h, transcript, { maxVariants = 4 } = {}) {
  const seg = segment(luma, w, h);
  const { xh } = seg;
  const words = seg.lines.flatMap((L) => L.words);
  const tokens = transcript.split(/\s+/).filter(Boolean).map((t) => [...t]);
  const pairs = align(words, tokens);

  const measure = (ch, unit, line) => {
    const base = line.base(unit.cx);
    return {
      ch, unit, baseline: base,
      up: (base - unit.miny) / xh, dn: (unit.maxy + 1 - base) / xh,
      hT: (unit.maxy - unit.miny + 1) / xh, wT: (unit.maxx - unit.minx + 1) / xh,
    };
  };
  const trusted = (k) => {
    const ok = (q) => q && q.cost < 0.9;
    return ok(pairs[k - 1]) || ok(pairs[k + 1]); // a neighbouring word also lines up
  };

  // ---- pass 1: words with one blob per letter
  const cands = new Map();
  const add = (map, c) => {
    if (!map.has(c.ch)) map.set(c.ch, []);
    map.get(c.ch).push(c);
  };
  let matched = 0;
  const joinedPairs = [];
  const letterGaps = [];
  pairs.forEach((p, k) => {
    if (!p) return;
    const u = p.word.units.length;
    const c = p.token.length;
    if (u !== c) {
      if (u < c && p.cost < 0.9 && trusted(k)) joinedPairs.push(p);
      return;
    }
    if (c > 1 && (p.ratio < 0.45 || p.ratio > 2.2)) return;
    if (!trusted(k)) return;
    matched++;
    p.word.units.forEach((unit, i) => {
      const cand = measure(p.token[i], unit, p.word.line);
      if (i > 0 && unit.gap !== null) letterGaps.push(unit.gap / xh);
      if (plausible(cand.ch, cand)) add(cands, cand);
    });
  });

  let rejected = 0;
  const kept = new Map();
  for (const [ch, list] of cands) {
    for (const c of list) c.sig = signature(seg, c.unit);
    let keep = list;
    if (list.length >= 3) {
      for (const c of list) c.score = med(list.filter((o) => o !== c).map((o) => similarity(c, o)));
      const cut = Math.max(0.4, med(list.map((c) => c.score)) - 0.25);
      keep = list.filter((c) => c.score >= cut).sort((a, b) => b.score - a.score);
    } else if (list.length === 2 && similarity(list[0], list[1]) < 0.5) {
      keep = []; // two samples that disagree: cannot tell which is right
    }
    rejected += list.length - keep.length;
    if (keep.length) kept.set(ch, keep);
  }

  // What each confirmed letter looks like, for checking pieces cut from joined words.
  const consensus = new Map();
  for (const [ch, list] of kept) {
    if (list.length < 2) continue;
    const sig = new Float32Array(list[0].sig.length);
    for (const c of list) for (let i = 0; i < sig.length; i++) sig[i] += c.sig[i];
    let n = 0;
    for (const v of sig) n += v * v;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < sig.length; i++) sig[i] /= n;
    consensus.set(ch, { sig, wT: med(list.map((c) => c.wT)), hT: med(list.map((c) => c.hT)) });
  }
  const widthOf = (ch) => (consensus.get(ch)?.wT ?? defaultWidth(ch)) * xh;

  // ---- pass 2: words with joined letters
  const second = new Map();
  const pairCands = []; // whole two-letter blobs, kept only if both cut pieces are confirmed
  let decoded = 0;
  for (const p of joinedPairs) {
    const units = p.word.units;
    const chars = p.token;
    const U = units.length;
    const C = chars.length;
    if (C > 16) continue;
    // best[i][j]: cheapest way for the first i blobs to hold the first j letters
    const best = Array.from({ length: U + 1 }, () => new Array(C + 1).fill(Infinity));
    const back = Array.from({ length: U + 1 }, () => new Array(C + 1).fill(0));
    best[0][0] = 0;
    for (let i = 1; i <= U; i++) {
      const W = units[i - 1].maxx - units[i - 1].minx + 1;
      for (let j = i; j <= C; j++) {
        for (let n = 1; n <= Math.min(4, j - i + 1); n++) {
          let E = 0;
          for (let t = j - n; t < j; t++) E += widthOf(chars[t]);
          const cost = best[i - 1][j - n] + ((W - E) / E) ** 2;
          if (cost < best[i][j]) {
            best[i][j] = cost;
            back[i][j] = n;
          }
        }
      }
    }
    if (!Number.isFinite(best[U][C]) || best[U][C] / U > 0.12) continue;
    decoded++;
    let j = C;
    for (let i = U; i >= 1; i--) {
      const n = back[i][j];
      const unit = units[i - 1];
      const W = unit.maxx - unit.minx + 1;
      const run = chars.slice(j - n, j);
      const E = run.reduce((s, ch) => s + widthOf(ch), 0);
      const err = Math.abs(W - E) / E;
      // spacing evidence: letters inside one blob touch; blobs in a word have a measured gap
      for (let t = 1; t < n; t++) letterGaps.push(0);
      if (i > 1 && unit.gap !== null) letterGaps.push(unit.gap / xh);
      if (n === 1 && err < 0.35) {
        const cand = measure(run[0], unit, p.word.line);
        cand.joined = true;
        if (plausible(cand.ch, cand)) add(second, cand);
      } else if (n === 2 && err < 0.25) {
        // cut at the thinnest column near where the two letters should meet
        const ids = new Set(unit.ids);
        const xb = unit.minx + (W * widthOf(run[0])) / E;
        let cutX = -1;
        let ink = Infinity;
        for (let x = Math.round(xb - 0.22 * W); x <= Math.round(xb + 0.22 * W); x++) {
          if (x <= unit.minx || x >= unit.maxx) continue;
          let n2 = 0;
          for (let y = unit.miny; y <= unit.maxy; y++) if (ids.has(seg.labels[y * seg.w + x])) n2++;
          if (n2 < ink || (n2 === ink && Math.abs(x - xb) < Math.abs(cutX - xb))) {
            ink = n2;
            cutX = x;
          }
        }
        if (cutX > 0 && ink <= Math.max(2, 0.2 * xh)) {
          const parts = [slice(seg, unit, unit.minx, cutX), slice(seg, unit, cutX + 1, unit.maxx)];
          const pieces = parts.map((part, t) => {
            if (!part || !consensus.has(run[t])) return null; // a cut piece must match a known letter
            const cand = measure(run[t], part, p.word.line);
            cand.split = cand.joined = true;
            if (!plausible(cand.ch, cand)) return null;
            add(second, cand);
            return cand;
          });
          // the uncut blob is a real joined pair in the writer's own hand
          if (pieces[0] && pieces[1] && /^[a-z]{2}$/.test(run.join(''))) {
            pairCands.push({ ch: run.join(''), unit, baseline: p.word.line.base(unit.cx), pieces, joined: true });
          }
        }
      }
      j -= n;
    }
  }
  for (const [ch, list] of second) {
    for (const c of list) c.sig = signature(seg, c.unit);
    const con = consensus.get(ch);
    let keep;
    if (con) {
      for (const c of list) c.score = similarity(c, con);
      keep = list.filter((c) => c.score >= (c.split ? 0.7 : 0.6));
    } else if (list.length >= 3) {
      for (const c of list) c.score = med(list.filter((o) => o !== c).map((o) => similarity(c, o)));
      keep = list.filter((c) => c.score >= Math.max(0.5, med(list.map((c) => c.score)) - 0.2));
    } else keep = []; // nothing to check a lone guess against
    rejected += list.length - keep.length;
    if (!keep.length) continue;
    keep.sort((a, b) => b.score - a.score);
    kept.set(ch, [...(kept.get(ch) || []), ...keep]);
  }

  // a pair survives only when both of its pieces passed the shape check above
  const confirmed = new Set([...kept.values()].flat());
  const pairGlyphs = new Map();
  for (const pc of pairCands) {
    if (!pc.pieces.every((c) => confirmed.has(c))) continue;
    pc.score = Math.min(...pc.pieces.map((c) => c.score ?? 0.6));
    if (!pairGlyphs.has(pc.ch)) pairGlyphs.set(pc.ch, []);
    pairGlyphs.get(pc.ch).push(pc);
  }
  for (const [ch, list] of pairGlyphs) kept.set(ch, list.sort((a, b) => b.score - a.score));

  const glyphs = [];
  for (const [ch, list] of kept) {
    for (const c of list.slice(0, maxVariants)) {
      glyphs.push({
        ch, ids: c.unit.ids, minx: c.unit.minx, miny: c.unit.miny, maxx: c.unit.maxx, maxy: c.unit.maxy,
        baseline: c.baseline, score: c.score ?? null, ...(c.unit.clip ? { clip: c.unit.clip } : {}), ...(c.joined ? { joined: true } : {}),
      });
    }
  }

  const wordGaps = words.filter((wd) => wd.gapBefore !== null).map((wd) => wd.gapBefore / xh);
  const stats = {
    lines: seg.lines.length,
    words: words.length,
    tokens: tokens.length,
    matchedWords: matched,
    decodedJoinedWords: decoded,
    joinedWords: joinedPairs.length,
    fromJoined: glyphs.filter((g) => g.joined && g.ch.length === 1).length,
    joinedPairs: glyphs.filter((g) => g.ch.length === 2).length,
    rejected,
    xHeight: xh,
    wordSpacing: wordGaps.length >= 5 ? +clamp(med(wordGaps) / 1.05, 0.5, 2).toFixed(2) : null,
    letterSpacing: letterGaps.length >= 10 ? +clamp(med(letterGaps), -0.1, 0.6).toFixed(2) : null,
  };
  return { glyphs, stats, seg };
}
