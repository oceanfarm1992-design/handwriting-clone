// Small DOM-free computer-vision helpers (grayscale arrays in, arrays out).

/** Otsu threshold: pixels <= result are "dark". */
export function otsu(luma) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  const total = luma.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) {
      best = v;
      thr = t;
    }
  }
  return thr;
}

/** Connected-component labelling of a binary mask. Label 0 is background. */
export function labelComponents(mask, w, h, eight = true) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = comps.length + 1;
    const c = { id, area: 0, minx: w, miny: h, maxx: -1, maxy: -1, sx: 0, sy: 0 };
    let sp = 0;
    stack[sp++] = s;
    labels[s] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p / w) | 0;
      c.area++;
      c.sx += x;
      c.sy += y;
      if (x < c.minx) c.minx = x;
      if (x > c.maxx) c.maxx = x;
      if (y < c.miny) c.miny = y;
      if (y > c.maxy) c.maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!eight && dx && dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

function gauss(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Homography (8 params, h33 = 1) mapping each `from` point to its `to` point. */
export function solveHomography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return gauss(A, b);
}

export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + 1;
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Resample `src` into a dw x dh image; H maps destination pixels to source pixels. */
export function warpLuma(src, sw, sh, H, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const [u, v] = H ? applyHomography(H, x, y) : [(x * sw) / dw, (y * sh) / dh];
      let val = 255;
      if (u >= 0 && v >= 0 && u < sw - 1 && v < sh - 1) {
        const x0 = u | 0;
        const y0 = v | 0;
        const fx = u - x0;
        const fy = v - y0;
        const i = y0 * sw + x0;
        val =
          src[i] * (1 - fx) * (1 - fy) +
          src[i + 1] * fx * (1 - fy) +
          src[i + sw] * (1 - fx) * fy +
          src[i + sw + 1] * fx * fy;
      }
      out[y * dw + x] = val;
    }
  }
  return out;
}

/** Divide out uneven lighting: estimate paper brightness per tile and normalise to white. */
export function normalizeBackground(luma, w, h, tile = 32, pct = 0.8) {
  const tx = Math.ceil(w / tile);
  const ty = Math.ceil(h / tile);
  const bg = new Float32Array(tx * ty);
  const hist = new Uint32Array(256);
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      hist.fill(0);
      let n = 0;
      for (let y = j * tile; y < Math.min(h, (j + 1) * tile); y++) {
        for (let x = i * tile; x < Math.min(w, (i + 1) * tile); x++) {
          hist[luma[y * w + x]]++;
          n++;
        }
      }
      let acc = 0;
      let v = 255;
      for (let t = 0; t < 256; t++) {
        acc += hist[t];
        if (acc >= n * pct) {
          v = t;
          break;
        }
      }
      bg[j * tx + i] = v;
    }
  }
  // Tiles dominated by ink read too dark: lift them to the brighter of their 4-neighbours
  // only when they are clearly darker than both opposite neighbours.
  const bg2 = Float32Array.from(bg);
  for (let j = 1; j < ty - 1; j++) {
    for (let i = 1; i < tx - 1; i++) {
      const k = j * tx + i;
      const horiz = Math.min(bg[k - 1], bg[k + 1]);
      const vert = Math.min(bg[k - tx], bg[k + tx]);
      const ref = Math.max(horiz, vert);
      if (bg[k] < ref - 35) bg2[k] = ref;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ty - 1, Math.max(0, y / tile - 0.5));
    const j0 = fy | 0;
    const j1 = Math.min(ty - 1, j0 + 1);
    const wy = fy - j0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tx - 1, Math.max(0, x / tile - 0.5));
      const i0 = fx | 0;
      const i1 = Math.min(tx - 1, i0 + 1);
      const wx = fx - i0;
      const b =
        bg2[j0 * tx + i0] * (1 - wx) * (1 - wy) +
        bg2[j0 * tx + i1] * wx * (1 - wy) +
        bg2[j1 * tx + i0] * (1 - wx) * wy +
        bg2[j1 * tx + i1] * wx * wy;
      out[y * w + x] = Math.min(255, (luma[y * w + x] * 255) / Math.max(b, 80));
    }
  }
  return out;
}

/**
 * Find the four solid black corner squares in a (downscaled) grayscale image.
 * Returns centroids [TL, TR, BL, BR] or null.
 */
export function findCornerMarkers(luma, w, h) {
  const thr = Math.min(170, Math.max(60, otsu(luma)));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = luma[i] <= thr ? 1 : 0;
  const { comps } = labelComponents(mask, w, h, false);
  const big = Math.max(w, h);
  const cands = comps.filter((c) => {
    const bw = c.maxx - c.minx + 1;
    const bh = c.maxy - c.miny + 1;
    if (bw < 0.015 * big || bw > 0.12 * big || bh < 0.015 * big || bh > 0.12 * big) return false;
    const aspect = bw / bh;
    if (aspect < 0.6 || aspect > 1.6) return false;
    return c.area / (bw * bh) > 0.75;
  });
  if (cands.length < 4) return null;
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const picked = corners.map(([cx, cy]) => {
    let best = null;
    let bd = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.sx / c.area - cx, c.sy / c.area - cy);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  });
  if (new Set(picked.map((c) => c.id)).size !== 4) return null;
  return picked.map((c) => [c.sx / c.area, c.sy / c.area]);
}
