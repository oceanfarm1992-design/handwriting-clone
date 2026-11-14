// Geometry and drawing of the printable handwriting template.
// All coordinates are in pixels of an A4 page rendered at 150 dpi.

export const PAGE = { w: 1240, h: 1754 };

export const CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...'.,;:!?\'"-()/&@%+=*#_',
];

export const GRID = {
  left: 100,
  top: 160,
  cols: 9,
  rows: 10,
  cellW: 115,
  cellH: 150,
  baseline: 0.68, // guide line position inside a cell (fraction of height)
};

// Corner registration squares: top-left, top-right, bottom-left, bottom-right.
export const MARKERS = {
  size: 56,
  centers: [
    [60, 60],
    [PAGE.w - 60, 60],
    [60, PAGE.h - 60],
    [PAGE.w - 60, PAGE.h - 60],
  ],
};

export function cellRect(i) {
  const col = i % GRID.cols;
  const row = Math.floor(i / GRID.cols);
  const x = GRID.left + col * GRID.cellW;
  const y = GRID.top + row * GRID.cellH;
  return { x, y, w: GRID.cellW, h: GRID.cellH, baseline: y + GRID.baseline * GRID.cellH };
}

export function drawTemplate(ctx, label = 'Set A') {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);

  ctx.fillStyle = '#000';
  const half = MARKERS.size / 2;
  for (const [cx, cy] of MARKERS.centers) ctx.fillRect(cx - half, cy - half, MARKERS.size, MARKERS.size);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#222';
  ctx.font = '600 26px Arial, sans-serif';
  ctx.fillText(`Handwriting template - ${label}`, PAGE.w / 2, 62);
  ctx.fillStyle = '#555';
  ctx.font = '17px Arial, sans-serif';
  ctx.fillText(
    'Write one character per box, resting on the dashed line. Use a dark pen and your normal size.',
    PAGE.w / 2,
    100,
  );
  ctx.fillText('Keep all four black squares visible when you scan or photograph this page.', PAGE.w / 2, 126);

  ctx.textAlign = 'left';
  CHARS.forEach((ch, i) => {
    const r = cellRect(i);
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#cfcfcf';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r.x + 4, r.baseline);
    ctx.lineTo(r.x + r.w - 4, r.baseline);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#bdbdbd';
    ctx.font = '15px Arial, sans-serif';
    ctx.fillText(ch, r.x + 6, r.y + 16);
  });
  ctx.restore();
}
