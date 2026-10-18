/**
 * Photo-booth strip: photo windows on a white card, rotated as one piece on a
 * flat background. The card is a still — videos contribute one frame and the
 * chosen duration is how long the export holds it.
 */

export const BOOTH_CANVAS = { width: 1080, height: 1920, frameRate: 30 } as const;
export const BOOTH_ROTATION_DEG = 34;
export const BOOTH_DEFAULT_BACKGROUND = "#9AA3AB";
export const BOOTH_PAPER_ID = "__booth-paper__";
/** Source sampled from a video before the slot holds that frame. */
export const BOOTH_STILL_TICKS = 100_000;

export const BOOTH_MIN_PHOTOS = 1;
export const BOOTH_MAX_PHOTOS = 12;

export interface BoothRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoothLayout {
  canvas: { width: number; height: number };
  rotationDeg: number;
  /** Upright white card, canvas pixels, before the shared rotation. */
  paper: BoothRect;
  /** Upright photo windows inside the card, row-major. */
  cells: BoothRect[];
  /** Photo windows requested (cells may be a few more in a partial grid). */
  photos: number;
  columns: number;
  rows: number;
  /** Blank strip reserved at the bottom of the card for a caption. */
  titleBand: number;
}

function even(n: number): number {
  return Math.max(2, Math.round(n) & ~1);
}

/** Clockwise rotation in screen space (y down), matching CSS `rotate()`. */
export function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  deg: number,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function measure(
  paperW: number,
  columns: number,
  rows: number,
  titleBand: number,
): {
  paperW: number;
  paperH: number;
  m: number;
  g: number;
  cellW: number;
  cellH: number;
} {
  const m = paperW * 0.07;
  const g = paperW * 0.042;
  const inner = paperW - 2 * m;
  const cellW = (inner - g * (columns - 1)) / columns;
  const cellH = cellW / 1.48;
  const paperH = rows * cellH + g * (rows - 1) + 2 * m + titleBand;
  return { paperW, paperH, m, g, cellW, cellH };
}

function fits(
  paperW: number,
  paperH: number,
  maxW: number,
  maxH: number,
  rotationDeg: number,
): boolean {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bbW = paperW * cos + paperH * sin;
  const bbH = paperW * sin + paperH * cos;
  return bbW <= maxW && bbH <= maxH;
}

/**
 * Largest white card that stays inside the 4:5 frame, with landscape photo
 * windows and an even white margin. `upright` drops the classic tilt;
 * `stickerMargin` shrinks the card so stickers can sit around it. `photos`
 * and `columns` shape the card (a vertical strip, or a grid when columns > 1).
 */
export function boothLayout(options?: {
  upright?: boolean;
  stickerMargin?: boolean;
  photos?: number;
  columns?: number;
  titleBand?: number;
}): BoothLayout {
  const upright = options?.upright === true;
  const rotationDeg = upright ? 0 : BOOTH_ROTATION_DEG;
  const cw = BOOTH_CANVAS.width;
  const ch = BOOTH_CANVAS.height;
  const loose = options?.stickerMargin === true;
  const marginX = loose ? 210 : 56;
  const marginY = loose ? 150 : 56;
  const maxW = cw - marginX * 2;
  const maxH = ch - marginY * 2;
  const photos = Math.min(
    BOOTH_MAX_PHOTOS,
    Math.max(BOOTH_MIN_PHOTOS, Math.round(options?.photos ?? 4)),
  );
  const columns = Math.min(3, Math.max(1, Math.round(options?.columns ?? 1)));
  const rows = Math.ceil(photos / columns);
  const titleBand = Math.max(0, Math.round(options?.titleBand ?? 0));

  let lo = 180;
  let hi = 860;
  let paperW = lo;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    const sized = measure(mid, columns, rows, titleBand);
    if (fits(sized.paperW, sized.paperH, maxW, maxH, rotationDeg)) {
      paperW = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const sized = measure(paperW, columns, rows, titleBand);
  const pw = even(sized.paperW);
  const m = even(sized.m);
  const g = even(Math.max(8, sized.g));
  const innerW = even(pw - 2 * m);
  const cellW = even((innerW - g * (columns - 1)) / columns);
  const cellH = even(cellW / 1.48);
  const ph = rows * cellH + g * (rows - 1) + 2 * m + titleBand;
  const px = (cw - pw) / 2;
  const py = (ch - ph) / 2;
  const cells: BoothRect[] = [];
  for (let i = 0; i < rows * columns; i += 1) {
    const r = Math.floor(i / columns);
    const c = i % columns;
    cells.push({
      x: px + m + c * (cellW + g),
      y: py + m + r * (cellH + g),
      w: cellW,
      h: cellH,
    });
  }
  return {
    canvas: { width: cw, height: ch },
    rotationDeg,
    paper: { x: px, y: py, w: pw, h: ph },
    cells,
    photos,
    columns,
    rows,
    titleBand,
  };
}
