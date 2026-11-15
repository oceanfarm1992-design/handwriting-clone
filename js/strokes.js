// Pen strokes for every letter: recover them from images, describe where the pen enters and
// leaves, and make new shapes by blending and bending samples. DOM-free so it can be unit tested.
//
// A stroke is { pts: [{ x, y, w }] } — an ordered pen path with the ink width at each point.
// "Reference units" put the baseline at y = 0 (up is negative) and the left of the ink at x = 0.
import { thin } from './joins.js';

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Chamfer distance from each ink pixel to the nearest background pixel (in pixels). */
export function insideDistance(mask, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x - 1, y) + 1, get(x, y - 1) + 1, get(x - 1, y - 1) + 1.414, get(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x + 1, y) + 1, get(x, y + 1) + 1, get(x + 1, y + 1) + 1.414, get(x - 1, y + 1) + 1.414);
    }
  }
  return d;
}

/** Ramer–Douglas–Peucker: drop points that lie within `eps` of the line through their neighbours. */
export function simplify(pts, eps = 0.8) {
  if (pts.length < 3) return pts.slice();
  // a closed loop starts and ends at the same point: split it at its farthest point first
  if (dist2(pts[0], pts[pts.length - 1]) < 1e-6) {
    let far = 1;
    for (let i = 2; i < pts.length - 1; i++) if (dist2(pts[i], pts[0]) > dist2(pts[far], pts[0])) far = i;
    return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a];
    const B = pts[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let far = -1;
    let fd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((B.x - A.x) * (A.y - pts[i].y) - (A.x - pts[i].x) * (B.y - A.y)) / len;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Recover ordered pen strokes from a letter image (alpha 0..scaleMax).
 * Thin the ink to its centre line, then walk it: from free ends (left to right), going as
 * straight as possible through crossings, then round any closed loops that are left.
 */
export function traceStrokes(alpha, w, h, { scaleMax = 1 } = {}) {
  const thr = 0.35 * scaleMax;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= thr ? 1 : 0;
  const dist = insideDistance(mask, w, h);
  const sk = thin(mask, w, h);
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && sk[y * w + x] === 1;
  const NB = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]; // straight first
  const degree = (x, y) => NB.reduce((n, [dx, dy]) => n + (on(x + dx, y + dy) ? 1 : 0), 0);
  const seen = new Uint8Array(w * h);
  const widthAt = (x, y) => {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) m = Math.max(m, dist[(y + dy) * w + x + dx]);
    return Math.max(1, 2 * m - 1);
  };

  const walk = (sx, sy) => {
    const path = [];
    // a branch that starts beside a crossing starts AT the crossing, so it stays connected
    for (const [dx, dy] of NB) {
      const x = sx + dx;
      const y = sy + dy;
      if (on(x, y) && seen[y * w + x] && degree(x, y) >= 3) {
        path.push({ x, y, w: widthAt(x, y) });
        break;
      }
    }
    let x = sx;
    let y = sy;
    let dir = null;
    for (;;) {
      seen[y * w + x] = 1;
      path.push({ x, y, w: widthAt(x, y) });
      let best = null;
      let bs = -Infinity;
      for (const [dx, dy] of NB) {
        const nx = x + dx;
        const ny = y + dy;
        if (!on(nx, ny) || seen[ny * w + nx]) continue;
        const len = Math.hypot(dx, dy);
        const s = dir ? (dx * dir[0] + dy * dir[1]) / len : -len; // keep going the same way
        if (s > bs) {
          bs = s;
          best = [dx, dy];
        }
      }
      if (!best) break;
      // smooth the heading over a few steps so pixel zig-zags do not steer the walk
      dir = dir ? [dir[0] * 0.6 + best[0] * 0.4, dir[1] * 0.6 + best[1] * 0.4] : best;
      x += best[0];
      y += best[1];
    }
    return path;
  };

  // Thinning can leave "staircase" corners: a pixel whose neighbours already touch each other.
  // It holds nothing together but looks like a crossing, so remove it.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const nb = NB.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => on(nx, ny));
      if (nb.length < 2 || nb.length > 3) continue;
      // are the neighbours one connected group without this pixel?
      const group = [nb[0]];
      const rest = nb.slice(1);
      for (let grew = true; grew; ) {
        grew = false;
        for (let i = rest.length - 1; i >= 0; i--) {
          if (group.some(([gx, gy]) => Math.abs(gx - rest[i][0]) <= 1 && Math.abs(gy - rest[i][1]) <= 1)) {
            group.push(rest.splice(i, 1)[0]);
            grew = true;
          }
        }
      }
      if (!rest.length) sk[y * w + x] = 0;
    }
  }

  // Thinning leaves short spurs on corners and blobs; a branch that dead-ends within about one pen
  // width of a crossing is not a real stroke, so remove it before walking.
  const widths = [];
  for (let i = 0; i < sk.length; i++) if (sk[i]) widths.push(dist[i]);
  widths.sort((a, b) => a - b);
  const spur = Math.max(2, 1.2 * (widths[widths.length >> 1] || 1));
  const crumb = spur; // staircase corners are already gone, so only spur-sized leftovers are noise
  for (let pass = 0; pass < 3; pass++) {
    let removed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on(x, y) || degree(x, y) !== 1) continue;
        const branch = [[x, y]];
        let [cx, cy] = [x, y];
        let reached = false;
        while (branch.length <= spur) {
          const next = NB.map(([dx, dy]) => [cx + dx, cy + dy]).filter(([nx, ny]) => on(nx, ny) && !branch.some(([bx, by]) => bx === nx && by === ny));
          if (next.length !== 1) break;
          const [nx, ny] = next[0];
          if (degree(nx, ny) >= 3) {
            reached = true;
            break;
          }
          branch.push([nx, ny]);
          [cx, cy] = [nx, ny];
        }
        if (reached && branch.length <= spur) {
          for (const [bx, by] of branch) sk[by * w + bx] = 0;
          removed = true;
        }
      }
    }
    if (!removed) break;
  }

  const strokes = [];
  const pixels = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) pixels.push({ x, y });
  const ends = pixels.filter((p) => degree(p.x, p.y) === 1).sort((a, b) => a.x - b.x || a.y - b.y);
  const push = (path, attached = false) => {
    // pixels left over beside a stroke that was already walked are corners of the 1-pixel line,
    // not strokes of their own; isolated small marks (dots) are kept
    if (attached && pathLength(path) < crumb) return;
    if (path.length < 2) {
      if (path.length === 1 && path[0].w >= 1.5) strokes.push({ pts: path }); // a dot
      return;
    }
    // close a loop that ends next to where it started
    if (path.length > 6 && dist2(path[0], path[path.length - 1]) <= 4) path.push({ ...path[0] });
    strokes.push({ pts: simplify(path, 0.7) });
  };
  for (const e of ends) if (!seen[e.y * w + e.x]) push(walk(e.x, e.y));
  for (;;) {
    // loops and leftover branches: start at the left-most unvisited pixel
    const rest = pixels.filter((p) => !seen[p.y * w + p.x]);
    if (!rest.length) break;
    const s = rest.reduce((a, b) => (b.x < a.x || (b.x === a.x && b.y < a.y) ? b : a));
    const before = Uint8Array.from(seen);
    const path = walk(s.x, s.y);
    const touches = path.some((p) => NB.some(([dx, dy]) => {
      const x = p.x + dx;
      const y = p.y + dy;
      return x >= 0 && y >= 0 && x < w && y < h && before[y * w + x];
    }));
    push(path, touches);
  }
  // isolated blobs too small to leave a centre line (dots of i, j, full stops)
  if (!strokes.length) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) (n++, (sx += x), (sy += y));
    if (n) strokes.push({ pts: [{ x: sx / n, y: sy / n, w: Math.max(1.5, 2 * Math.sqrt(n / Math.PI)) }] });
  }
  return strokes;
}

/**
 * How much of the letter's ink the traced strokes explain (0..1): the share of ink pixels that lie
 * within half a pen width (plus a pixel) of some stroke. A poor trace is better not used at all.
 */
export function coverage(strokes, alpha, w, h, { scaleMax = 1 } = {}) {
  const thr = 0.5 * scaleMax;
  const near = new Uint8Array(w * h);
  for (const st of strokes) {
    const pts = st.pts.length > 1 ? resample(st.pts, Math.max(2, Math.ceil(pathLength(st.pts)) + 1)) : st.pts;
    for (const p of pts) {
      const r = p.w / 2 + 1.2;
      for (let y = Math.max(0, Math.floor(p.y - r)); y <= Math.min(h - 1, Math.ceil(p.y + r)); y++) {
        for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(w - 1, Math.ceil(p.x + r)); x++) {
          if ((x - p.x) ** 2 + (y - p.y) ** 2 <= r * r) near[y * w + x] = 1;
        }
      }
    }
  }
  let ink = 0;
  let hit = 0;
  for (let i = 0; i < near.length; i++) {
    if (alpha[i] < thr) continue;
    ink++;
    if (near[i]) hit++;
  }
  return ink ? hit / ink : 0;
}

/** A smooth Catmull-Rom curve through a path's points (with widths), `steps` points per segment. */
export function smoothPath(pts, steps = 6) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/** Arc length of a path. */
export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

/** Resample a path to n points evenly spaced along its length. */
export function resample(pts, n) {
  if (pts.length === 1 || n < 2) return Array.from({ length: Math.max(1, n) }, () => ({ ...pts[0] }));
  const L = pathLength(pts);
  if (!L) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const out = [];
  let seg = 1;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (L * k) / (n - 1);
    while (seg < pts.length - 1 && acc + Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y) < target) {
      acc += Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y);
      seg++;
    }
    const a = pts[seg - 1];
    const b = pts[seg];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(1, Math.max(0, (target - acc) / len));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t });
  }
  return out;
}

/**
 * Where the pen enters and leaves a letter, with the pen's direction there.
 * Strokes are in reference units (baseline y = 0, up negative); xh is the x-height in those units.
 * Prefers free stroke ends in the joining zone; closed shapes fall back to top-right / left points.
 * Returns { entry: { x, y, tx, ty }, exit: { x, y, tx, ty } } or null.
 */
export function strokeAnchors(strokes, xh) {
  const all = strokes.flatMap((s) => s.pts);
  const inZone = (p) => p.y >= -1.25 * xh && p.y <= 0.2 * xh;
  const zone = all.filter(inZone);
  if (!zone.length) return null;
  const minx = Math.min(...zone.map((p) => p.x));
  const maxx = Math.max(...zone.map((p) => p.x));
  const span = Math.max(1e-6, maxx - minx);
  const low = (p) => (p.y + xh) / xh; // 0 at x-height, 1 at the baseline
  const tangent = (pts, i) => {
    const a = pts[Math.max(0, i - 2)];
    const b = pts[Math.min(pts.length - 1, i + 2)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const n = Math.hypot(tx, ty) || 1;
    tx /= n;
    ty /= n;
    if (tx < 0) (tx = -tx), (ty = -ty); // joins travel left to right
    return { tx, ty };
  };
  const ends = [];
  strokes.forEach((s) => {
    if (s.pts.length < 2) return;
    ends.push({ p: s.pts[0], pts: s.pts, i: 0 }, { p: s.pts[s.pts.length - 1], pts: s.pts, i: s.pts.length - 1 });
  });
  const best = (cands, score) => cands.reduce((m, c) => (m === null || score(c) > score(m) ? c : m), null);
  let exit = best(ends.filter((e) => inZone(e.p) && e.p.x >= minx + 0.55 * span), (e) => (e.p.x - minx) / span + 0.35 * low(e.p));
  let entry = best(ends.filter((e) => inZone(e.p) && e.p.x <= minx + 0.45 * span), (e) => (maxx - e.p.x) / span + 0.35 * low(e.p));
  const everyPoint = strokes.flatMap((s) => s.pts.map((p, i) => ({ p, pts: s.pts, i })));
  exit ||= best(everyPoint.filter((e) => inZone(e.p) && e.p.x >= maxx - 0.25 * span), (e) => -e.p.y);
  entry ||= best(everyPoint.filter((e) => inZone(e.p) && e.p.x <= minx + 0.15 * span), (e) => -Math.abs(e.p.y + 0.55 * xh));
  if (!entry || !exit) return null;
  return {
    entry: { x: entry.p.x, y: entry.p.y, ...tangent(entry.pts, entry.i) },
    exit: { x: exit.p.x, y: exit.p.y, ...tangent(exit.pts, exit.i) },
  };
}

/** Points per stroke when resampling for blending: enough to keep curves, never too many. */
export const pointsFor = (len, xh) => Math.max(2, Math.min(40, Math.round(len / (0.12 * xh)) + 1));

/**
 * Blend two samples of the same character into an in-between shape (t = 0 → a, t = 1 → b).
 * Only possible when they were written with the same strokes in a matching order; strokes drawn
 * the other way round are reversed first. Returns null when the shapes do not correspond.
 */
export function blendStrokes(a, b, t, xh) {
  if (a.length !== b.length) return null;
  const out = [];
  for (let k = 0; k < a.length; k++) {
    let pa = a[k].pts;
    let pb = b[k].pts;
    const fwd = dist2(pa[0], pb[0]) + dist2(pa[pa.length - 1], pb[pb.length - 1]);
    const rev = dist2(pa[0], pb[pb.length - 1]) + dist2(pa[pa.length - 1], pb[0]);
    if (rev < fwd) pb = [...pb].reverse();
    // matching strokes start and end in roughly the same places and are about as long
    if (Math.min(fwd, rev) > (0.5 * xh) ** 2 * 2) return null;
    const ra = pathLength(pa);
    const rb = pathLength(pb);
    if (Math.max(ra, rb) > 0.3 * xh && (Math.min(ra, rb) || 1e-6) / Math.max(ra, rb) < 0.6) return null;
    const n = Math.max(pointsFor(pathLength(pa), xh), pointsFor(pathLength(pb), xh));
    pa = resample(pa, n);
    pb = resample(pb, n);
    out.push({ pts: pa.map((p, i) => ({ x: p.x + (pb[i].x - p.x) * t, y: p.y + (pb[i].y - p.y) * t, w: p.w + (pb[i].w - p.w) * t })) });
  }
  return out;
}

/** Gently bend strokes with smooth, low-frequency waves (amounts are in x-heights). */
export function bendStrokes(strokes, xh, rand, amount = 1) {
  const A = xh * 0.05 * amount * (0.5 + rand());
  const B = xh * 0.04 * amount * (0.5 + rand());
  const f1 = 0.4 + rand() * 0.6;
  const f2 = 0.4 + rand() * 0.6;
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const sx = 1 + (rand() - 0.5) * 0.1 * amount;
  const wk = 1 + (rand() - 0.5) * 0.25 * amount;
  return strokes.map((s) => ({
    pts: s.pts.map((p) => {
      const x = p.x * sx + A * Math.sin(p1 + (p.y / xh) * Math.PI * f1);
      return { x, y: p.y + B * Math.sin(p2 + (x / xh) * Math.PI * f2), w: p.w * wk };
    }),
  }));
}
