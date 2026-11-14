// Sample handwritings. Each one is an open-licensed handwriting FONT (not a real person's writing),
// drawn into the template as a crooked, unevenly lit "photo" and pushed through the same scan
// pipeline as a real sheet. Useful for trying the app, or when you do not want to use your own.
import { PAGE, CHARS, cellRect, drawTemplate } from './template.js';
import { mulberry32 } from './render.js';

const SYSTEM_SCRIPT =
  '"Segoe Script","Ink Free","Bradley Hand","Snell Roundhand","Noteworthy","Comic Sans MS","Brush Script MT",cursive';

// `google` names a family on Google Fonts (all under the SIL Open Font License); it is fetched only
// when that sample is chosen. The first entry uses fonts already on the device and works offline.
export const SAMPLE_STYLES = [
  { id: 'system', name: 'Casual script (works offline)' },
  { id: 'caveat', name: 'Quick and neat (Caveat)', google: 'Caveat' },
  { id: 'patrick', name: 'Clear print (Patrick Hand)', google: 'Patrick Hand' },
  { id: 'indie', name: 'Round and friendly (Indie Flower)', google: 'Indie Flower' },
  { id: 'kalam', name: 'Everyday notes (Kalam)', google: 'Kalam' },
  { id: 'shadows', name: 'Tall and light (Shadows Into Light)', google: 'Shadows Into Light' },
  { id: 'architect', name: 'Capital-style block (Architects Daughter)', google: 'Architects Daughter' },
  { id: 'gloria', name: 'Bold marker (Gloria Hallelujah)', google: 'Gloria Hallelujah' },
  { id: 'apple', name: 'Joined cursive (Homemade Apple)', google: 'Homemade Apple' },
  { id: 'reenie', name: 'Fast scrawl (Reenie Beanie)', google: 'Reenie Beanie' },
];

/** Make sure the sample's font is ready; returns the CSS font-family to draw with. */
export async function loadSampleFont(style) {
  if (!style.google) return SYSTEM_SCRIPT;
  const id = `sample-font-${style.id}`;
  if (!document.getElementById(id)) {
    await new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${style.google.replace(/ /g, '+')}&display=swap`;
      link.onload = resolve;
      link.onerror = () => {
        link.remove();
        reject(new Error('That sample needs an internet connection to load its font. "Casual script" works offline.'));
      };
      document.head.appendChild(link);
    });
  }
  const spec = `48px "${style.google}"`;
  await document.fonts.load(spec, CHARS.join(''));
  if (!document.fonts.check(spec)) {
    throw new Error('The font for that sample could not be loaded. Try again, or pick "Casual script".');
  }
  return `"${style.google}"`;
}

export function makeDemoScan(variant = 0, family = SYSTEM_SCRIPT) {
  const rand = mulberry32(100 + variant);
  const sheet = document.createElement('canvas');
  sheet.width = PAGE.w;
  sheet.height = PAGE.h;
  const sctx = sheet.getContext('2d');
  drawTemplate(sctx, 'sample');
  sctx.fillStyle = '#1b2760';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'alphabetic';

  // Fonts differ a lot in size: pick the largest size at which every character fits its box.
  let size = 60;
  sctx.font = `${size}px ${family}`;
  let w = 1;
  let up = 1;
  let down = 1;
  for (const ch of CHARS) {
    const m = sctx.measureText(ch);
    w = Math.max(w, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    up = Math.max(up, m.actualBoundingBoxAscent);
    down = Math.max(down, m.actualBoundingBoxDescent);
  }
  size *= Math.min(1.15, 84 / w, 84 / up, 36 / down);

  CHARS.forEach((ch, i) => {
    const r = cellRect(i);
    sctx.save();
    sctx.translate(r.x + r.w / 2 + (rand() - 0.5) * 8, r.baseline + (rand() - 0.5) * 6);
    sctx.rotate((rand() - 0.5) * 0.14);
    sctx.font = `${size * (0.95 + rand() * 0.1)}px ${family}`;
    sctx.fillText(ch, 0, 0);
    sctx.restore();
  });

  // Simulate a slightly crooked, unevenly lit photo of the page.
  const photo = document.createElement('canvas');
  photo.width = 1500;
  photo.height = 2000;
  const pctx = photo.getContext('2d');
  pctx.fillStyle = '#7d7468';
  pctx.fillRect(0, 0, photo.width, photo.height);
  pctx.save();
  pctx.translate(750, 1000);
  pctx.rotate(variant ? -0.025 : 0.02);
  pctx.drawImage(sheet, -PAGE.w / 2, -PAGE.h / 2, PAGE.w, PAGE.h);
  pctx.restore();
  const grad = pctx.createLinearGradient(0, 0, photo.width, photo.height);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(190,190,190,1)');
  pctx.globalCompositeOperation = 'multiply';
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, photo.width, photo.height);
  return photo;
}
