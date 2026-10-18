/**
 * Photo-booth strip: four landscape frames on a white card, rotated as one
 * piece on a flat background. The card is a still — videos contribute one
 * frame and the chosen duration is how long the export holds it.
 */

export const BOOTH_CANVAS = { width: 1080, height: 1350, frameRate: 30 } as const;
export const BOOTH_ROTATION_DEG = 34;
export const BOOTH_DEFAULT_BACKGROUND = "#9AA3AB";
export const BOOTH_PAPER_ID = "__booth-paper__";
/** Source sampled from a video before the slot holds that frame. */
export const BOOTH_STILL_TICKS = 100_000;

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
  /** Upright photo windows inside the card. */
  cells: BoothRect[];
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

function measure(paperW: number): {
  paperW: number;
  paperH: number;
  m: number;
  g: number;
  photoW: number;
  photoH: number;
} {
  const m = paperW * 0.07;
  const g = paperW * 0.042;
  const photoW = paperW - 2 * m;
  const photoH = photoW / 1.48;
  const paperH = 4 * photoH + 3 * g + 2 * m;
  return { paperW, paperH, m, g, photoW, photoH };
}

function fits(paperW: number, paperH: number, maxW: number, maxH: number): boolean {
  const rad = (BOOTH_ROTATION_DEG * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const bbW = paperW * cos + paperH * sin;
  const bbH = paperW * sin + paperH * cos;
  return bbW <= maxW && bbH <= maxH;
}

/**
 * Largest white card that stays inside the 4:5 frame after rotation, with
 * four landscape windows and an even white margin.
 */
export function boothLayout(): BoothLayout {
  const cw = BOOTH_CANVAS.width;
  const ch = BOOTH_CANVAS.height;
  const margin = 56;
  const maxW = cw - margin * 2;
  const maxH = ch - margin * 2;
  let lo = 180;
  let hi = 860;
  let paperW = lo;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    const sized = measure(mid);
    if (fits(sized.paperW, sized.paperH, maxW, maxH)) {
      paperW = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const sized = measure(paperW);
  const pw = even(sized.paperW);
  const m = even(sized.m);
  const g = even(Math.max(8, sized.g));
  const photoW = even(pw - 2 * m);
  const photoH = even(photoW / 1.48);
  const ph = 4 * photoH + 3 * g + 2 * m;
  const px = (cw - pw) / 2;
  const py = (ch - ph) / 2;
  const cells: BoothRect[] = [];
  for (let i = 0; i < 4; i += 1) {
    cells.push({
      x: px + m,
      y: py + m + i * (photoH + g),
      w: photoW,
      h: photoH,
    });
  }
  return {
    canvas: { width: cw, height: ch },
    rotationDeg: BOOTH_ROTATION_DEG,
    paper: { x: px, y: py, w: pw, h: ph },
    cells,
  };
}
