// Where does the pen enter and leave a letter? Works on any sample (written on screen, scanned or
// cut from a photo) by thinning the ink to a one-pixel centre line and looking at its ends.
// DOM-free so it can be unit tested.

/** Zhang-Suen thinning: reduce a binary mask (1 = ink) to its one-pixel-wide centre line. */
export function thin(mask, w, h) {
  const m = Uint8Array.from(mask);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  let changed = true;
  const del = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!m[y * w + x]) continue;
          // neighbours clockwise from north: p2..p9
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          del.push(y * w + x);
        }
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

/**
 * Entry and exit points of a letter, in the sample's own pixel coordinates.
 *   alpha: Float32Array/Uint8 ink coverage (0..1 or 0..255), w x h
 *   base:  y of the baseline;  xh: x-height in the same pixels
 * Returns { entry: {x, y}, exit: {x, y}, width } or null when there is no ink in the joining zone.
 * Joins happen between the baseline and a little above the x-height, so only that zone is used.
 */
export function joinPoints(alpha, w, h, { base, xh, scaleMax = 1 }) {
  const thr = 0.35 * scaleMax;
  const mask = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < mask.length; i++) if (alpha[i] >= thr) (mask[i] = 1), area++;
  if (!area) return null;
  const sk = thin(mask, w, h);
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sk[y * w + x]) pts.push({ x, y });
  if (!pts.length) return null;
  const width = Math.min(Math.max(area / pts.length, 1), xh * 0.4);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? sk[y * w + x] : 0);
  const ends = pts.filter(({ x, y }) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy)) n++;
    return n === 1;
  });
  const top = base - 1.25 * xh;
  const bottom = base + 0.2 * xh;
  const zone = pts.filter((p) => p.y >= top && p.y <= bottom);
  if (!zone.length) return null;
  const minx = Math.min(...zone.map((p) => p.x));
  const maxx = Math.max(...zone.map((p) => p.x));
  const span = Math.max(1, maxx - minx);
  const low = (p) => (p.y - (base - xh)) / xh; // 0 at x-height, 1 at the baseline

  // An open stroke end on the right (left) half is where the pen leaves (arrives); lower is likelier.
  const pick = (cands, score) => cands.reduce((best, p) => (best === null || score(p) > score(best) ? p : best), null);
  const exitEnds = ends.filter((p) => p.y >= top && p.y <= bottom && p.x >= minx + 0.55 * span);
  const entryEnds = ends.filter((p) => p.y >= top && p.y <= bottom && p.x <= minx + 0.45 * span);
  // Closed shapes (o, a) have no free end: leave from the top right, arrive at the left.
  const exit = pick(exitEnds, (p) => (p.x - minx) / span + 0.35 * low(p)) ||
    pick(zone.filter((p) => p.x >= maxx - 0.25 * span), (p) => -p.y);
  const entry = pick(entryEnds, (p) => (maxx - p.x) / span + 0.35 * low(p)) ||
    pick(zone.filter((p) => p.x <= minx + 0.15 * span), (p) => -Math.abs(p.y - (base - 0.55 * xh)));
  if (!entry || !exit) return null;
  return { entry, exit, width };
}
