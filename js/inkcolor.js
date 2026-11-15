// Ink colours that survive printing. Screens make blue with pure blue light; printers mix cyan and
// magenta ink and cannot reach bright, saturated blues and violets, so those print lighter, greyer
// and shifted towards cyan (measured on a real print: #212394 on screen came out about #3f5c79).
// DOM-free so it can be unit tested.

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Hue (degrees), saturation and value (0..1). */
export function rgbToHsv([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/**
 * Will this ink print noticeably differently from how it looks on screen?
 * Returns null when it should print close to the screen, or a short explanation.
 */
export function printRisk(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s, v } = rgbToHsv(rgb);
  if (v > 0.75 && s < 0.25) return 'This ink is very light, so printed writing will be faint and hard to read.';
  if (h >= 200 && h <= 290 && s > 0.55 && v > 0.5) {
    return 'Bright, saturated blues and violets are outside what printers can mix, so this will print lighter and greyer than on screen. Pick a pen colour below, or print the ink test page to match your printer.';
  }
  if (s > 0.7 && v > 0.75) return 'Very bright colours print duller than on screen.';
  return null;
}

/** Pen colours that print close to how they look. */
export const PEN_PRESETS = [
  { name: 'Ballpoint blue', hex: '#1f3a7a' },
  { name: 'Dark blue', hex: '#1a2a5e' },
  { name: 'Blue-black', hex: '#1c2236' },
  { name: 'Black', hex: '#1b1b1f' },
  { name: 'Red', hex: '#9b1c1c' },
  { name: 'Green', hex: '#1f5a32' },
];

/**
 * Ink test page lines A–G: a ladder of pen blues from very dark to bright. Printed once, the line that
 * looks like the writer's real pen gives the ink to use for that printer (H is the current ink).
 */
export const TEST_INKS = [
  { label: 'A', hex: '#172552' },
  { label: 'B', hex: '#1c2f6a' },
  { label: 'C', hex: '#213a80' },
  { label: 'D', hex: '#264594' },
  { label: 'E', hex: '#2c51a6' },
  { label: 'F', hex: '#345cb4' },
  { label: 'G', hex: '#2a3a5c' },
];
