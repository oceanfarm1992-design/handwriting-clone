// Save / load a handwriting profile (glyph PNGs + metrics) as JSON.
import { newGlyphId } from './extract.js';

const KEY = 'handwriting-clone-profile-v1';

export function serialize(glyphs) {
  return JSON.stringify({
    app: 'handwriting-clone',
    version: 1,
    glyphs: glyphs.map((g) => ({ ch: g.ch, yOff: g.yOff, pad: g.pad, inkH: g.inkH, inkW: g.inkW, png: g.canvas.toDataURL('image/png') })),
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Corrupt glyph image'));
    img.src = src;
  });
}

export async function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.app !== 'handwriting-clone' || !Array.isArray(data.glyphs)) throw new Error('This is not a handwriting profile file.');
  const out = [];
  for (const g of data.glyphs) {
    if (typeof g.ch !== 'string' || typeof g.png !== 'string' || !g.png.startsWith('data:image/png')) continue;
    const img = await loadImage(g.png);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    out.push({ id: newGlyphId(), ch: g.ch, canvas, yOff: +g.yOff || 0, pad: +g.pad || 0, inkH: +g.inkH || img.height, inkW: +g.inkW || img.width });
  }
  return out;
}

export function saveLocal(glyphs) {
  try {
    if (!glyphs.length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, serialize(glyphs));
  } catch {
    /* storage unavailable or full: the profile can still be exported manually */
  }
}

export async function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? await deserialize(raw) : [];
  } catch {
    return [];
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
