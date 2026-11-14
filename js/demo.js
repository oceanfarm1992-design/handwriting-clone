// Fabricates a "photo" of a filled-in template using a script font, so visitors can try the
// whole pipeline (corner detection, perspective fix, glyph cutting) without printing anything.
import { PAGE, CHARS, cellRect, drawTemplate } from './template.js';
import { mulberry32 } from './render.js';

const SCRIPT_FONTS =
  '"Segoe Script","Ink Free","Bradley Hand","Snell Roundhand","Noteworthy","Comic Sans MS","Brush Script MT",cursive';

export function makeDemoScan(variant = 0) {
  const rand = mulberry32(100 + variant);
  const sheet = document.createElement('canvas');
  sheet.width = PAGE.w;
  sheet.height = PAGE.h;
  const sctx = sheet.getContext('2d');
  drawTemplate(sctx, 'demo');
  sctx.fillStyle = '#1b2760';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'alphabetic';
  CHARS.forEach((ch, i) => {
    const r = cellRect(i);
    sctx.save();
    sctx.translate(r.x + r.w / 2 + (rand() - 0.5) * 8, r.baseline + (rand() - 0.5) * 6);
    sctx.rotate((rand() - 0.5) * 0.14);
    sctx.font = `${52 + rand() * 6}px ${SCRIPT_FONTS}`;
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
  const w = PAGE.w * 1.0;
  const h = PAGE.h * 1.0;
  pctx.drawImage(sheet, -w / 2, -h / 2, w, h);
  pctx.restore();
  const grad = pctx.createLinearGradient(0, 0, photo.width, photo.height);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(190,190,190,1)');
  pctx.globalCompositeOperation = 'multiply';
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, photo.width, photo.height);
  return photo;
}
