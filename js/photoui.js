// "Learn from a photo" dialog: harvest letters from a photo of ordinary handwriting plus its text.
import { CHARS } from './template.js';
import { harvest } from './harvest.js';
import { normalizeText } from './render.js';
import { newGlyphId } from './extract.js';

const $ = (id) => document.getElementById(id);

// Every one of the 82 characters, in short everyday words that are easy to copy by hand.
export const PRACTICE_TEXT = `Quick brown foxes jump over the lazy dog. Zoe and Jack packed my box with five dozen jugs. Xavier, Yusuf and William quizzed Hannah about Venus, Uranus and Earth. Did Adam, Carl, Grace, Isla, Kate, Lucy, Maya, Nora, Olivia, Paul, Rose, Sam, Tom or Fred call Dr Black? We saw 12 owls, 34 hens, 56 bees and 7890 ants! "Why not?" she asked. It's 50% off (cash only) - so pay by 6: no cheques; no cards. Email me@home_office or ring #7 & ask. Sums: 3 + 4 = 7, 6 * 2 = 12, 9 / 3 = 3.`;

const MAX_SIDE = 2400;

function lumaOf(img) {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const s = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s);
  c.height = Math.round(sh * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const luma = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; j < luma.length; i += 4, j++) luma[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  return { luma, w: c.width, h: c.height };
}

/** Cut one harvested letter out of the photo as soft black ink on a transparent canvas. */
function toGlyph(seg, g) {
  const ids = new Set(g.ids);
  const pad = 2;
  const [c0, c1] = g.clip || [0, seg.w - 1];
  const canvas = document.createElement('canvas');
  canvas.width = g.maxx - g.minx + 1 + 2 * pad;
  canvas.height = g.maxy - g.miny + 1 + 2 * pad;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const mine = (x, y) => x >= c0 && x <= c1 && x >= 0 && y >= 0 && x < seg.w && y < seg.h && ids.has(seg.labels[y * seg.w + x]);
  for (let y = g.miny - 1; y <= g.maxy + 1; y++) {
    for (let x = Math.max(c0, g.minx - 1); x <= Math.min(c1, g.maxx + 1); x++) {
      if (x < 0 || y < 0 || x >= seg.w || y >= seg.h) continue;
      const a = Math.min(1, Math.max(0, (200 - seg.norm[y * seg.w + x]) / 90));
      let on = mine(x, y);
      if (!on && a > 0.02) {
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) on = mine(x + dx, y + dy);
      }
      if (on) img.data[((y - g.miny + pad) * canvas.width + (x - g.minx + pad)) * 4 + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    id: newGlyphId(),
    ch: g.ch,
    canvas,
    pad,
    inkW: g.maxx - g.minx + 1,
    inkH: g.maxy - g.miny + 1,
    yOff: g.maxy + 1 - g.baseline,
    src: 'photo',
  };
}

export function initPhoto({ addGlyphs, applyLearned }) {
  const dlg = $('photoDlg');
  const say = (msg, kind = 'info') => {
    const el = $('photoResult');
    el.textContent = msg;
    el.dataset.kind = kind;
  };

  $('photoBtn').addEventListener('click', () => {
    if (!$('photoText').value.trim()) $('photoText').value = PRACTICE_TEXT;
    say('');
    dlg.showModal();
  });
  $('photoClose').addEventListener('click', () => dlg.close());
  $('photoPractice').addEventListener('click', () => {
    $('photoText').value = PRACTICE_TEXT;
    say('Practice paragraph restored. Copy it by hand onto paper, then photograph the page.');
  });
  $('photoClear').addEventListener('click', () => {
    $('photoText').value = '';
    $('photoText').focus();
  });

  $('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = normalizeText($('photoText').value).trim();
    if (!text) {
      say('Type what the page says first (or use the practice paragraph).', 'error');
      return;
    }
    say('Reading your handwriting…');
    await new Promise((r) => setTimeout(r, 40));
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('That file is not an image the browser can open.'));
        im.src = url;
      });
      const { luma, w, h } = lumaOf(img);
      const { glyphs, stats, seg } = harvest(luma, w, h, text);
      if (!glyphs.length) {
        const why = Math.abs(stats.words - stats.tokens) > 0.25 * stats.tokens
          ? `The photo has about ${stats.words} words but the text has ${stats.tokens}. Check that the text matches the page.`
          : 'No letters could be matched. Letters that are written separately, in a straight, well-lit photo, work best.';
        say(why, 'error');
        return;
      }
      addGlyphs(glyphs.map((g) => toGlyph(seg, g)));
      const learned = {};
      if (stats.letterSpacing !== null) learned.letterSpacing = stats.letterSpacing;
      if (stats.wordSpacing !== null) learned.wordSpacing = stats.wordSpacing;
      if (Object.keys(learned).length) applyLearned(learned, true);

      const got = new Set(glyphs.map((g) => g.ch));
      const inText = new Set(text.replace(/\s/g, ''));
      const missed = CHARS.filter((c) => inText.has(c) && !got.has(c));
      const parts = [
        `Read ${stats.lines} lines and ${stats.words} words.`,
        `Learned ${glyphs.length} letter samples covering ${got.size} characters` +
          (stats.fromJoined ? ` (${stats.fromJoined} recovered from words with joined letters).` : '.'),
      ];
      if (missed.length) parts.push(`In the text but not found cleanly: ${missed.join(' ')}`);
      if (Object.keys(learned).length) parts.push('Your letter and word spacing were learned too.');
      if (stats.xHeight < 9) parts.push('The writing is small in this photo, so letters may look soft. A closer or sharper photo helps.');
      say(parts.join(' '), missed.length ? 'warn' : 'ok');
    } catch (err) {
      say(err.message || 'Could not read that photo.', 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}
