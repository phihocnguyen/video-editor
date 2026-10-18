/**
 * Photo-booth overlays that are independent of the theme: a full-canvas
 * background pattern and a decorative frame drawn around the card. Both are
 * rasterized to PNG on apply (FFmpeg's SVG path is unreliable) and become
 * ordinary image clips, so they can be moved afterwards.
 */

import { BOOTH_CANVAS } from "./boothStrip";

export const BOOTH_PATTERN_PREFIX = "__booth-pattern-";
export const BOOTH_FRAME_PREFIX = "__booth-frame-";

export interface BoothPattern {
  id: string;
  label: string;
  /** Full-canvas, tiled. Generated at the booth canvas size. */
  svg: string;
}

export interface BoothFrame {
  id: string;
  label: string;
  /** Border for a card of `w` × `h` canvas pixels. */
  render: (w: number, h: number) => string;
}

function svgDoc(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

function tiled(id: string, tile: number, shape: string): string {
  return svgDoc(
    BOOTH_CANVAS.width,
    BOOTH_CANVAS.height,
    `<defs><pattern id="${id}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse">${shape}</pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/>`,
  );
}

const HEART =
  "M50,88 C18,66 6,48 6,32 C6,16 18,6 34,6 C43,6 48,12 50,20 C52,12 57,6 66,6 C82,6 94,16 94,32 C94,48 82,66 50,88 Z";
const STAR = "M8,2 L9.2,6 H13 L10,8.2 L11,12 L8,9.8 L5,12 L6,8.2 L3,6 H6.8 Z";

export const BOOTH_PATTERNS: BoothPattern[] = [
  {
    id: `${BOOTH_PATTERN_PREFIX}dots`,
    label: "Dots",
    svg: tiled(
      "bp-dots",
      30,
      `<circle cx="5" cy="5" r="1.7" fill="#ffffff" opacity="0.26"/>`,
    ),
  },
  {
    id: `${BOOTH_PATTERN_PREFIX}hearts`,
    label: "Hearts",
    svg: tiled(
      "bp-hearts",
      46,
      `<path d="${HEART}" fill="#ffffff" opacity="0.24" transform="translate(6,4) scale(0.32)"/>`,
    ),
  },
  {
    id: `${BOOTH_PATTERN_PREFIX}stars`,
    label: "Stars",
    svg: tiled(
      "bp-stars",
      40,
      `<path d="${STAR}" fill="#F2C14E" opacity="0.4" transform="translate(6,6) scale(1.6)"/>`,
    ),
  },
  {
    id: `${BOOTH_PATTERN_PREFIX}grid`,
    label: "Grid",
    svg: tiled(
      "bp-grid",
      36,
      `<path d="M4 18 H32 M18 4 V32" stroke="#ffffff" stroke-width="1.1" opacity="0.2"/>`,
    ),
  },
  {
    id: `${BOOTH_PATTERN_PREFIX}confetti`,
    label: "Confetti",
    svg: tiled(
      "bp-confetti",
      44,
      `<rect x="6" y="10" width="8" height="3" rx="1" fill="#F2C14E" opacity="0.55" transform="rotate(18 10 11)"/>
       <circle cx="30" cy="22" r="1.7" fill="#ffffff" opacity="0.4"/>
       <rect x="22" y="6" width="6" height="2.6" rx="1" fill="#E07A6A" opacity="0.5" transform="rotate(-22 25 7)"/>`,
    ),
  },
  {
    id: `${BOOTH_PATTERN_PREFIX}leaves`,
    label: "Leaves",
    svg: tiled(
      "bp-leaves",
      46,
      `<ellipse cx="10" cy="12" rx="7" ry="3" fill="#8AA06A" opacity="0.5" transform="rotate(-28 10 12)"/>
       <ellipse cx="32" cy="34" rx="8" ry="3.2" fill="#6E8F5B" opacity="0.5" transform="rotate(24 32 34)"/>`,
    ),
  },
];

function borderRect(w: number, h: number, inset: number, stroke: string, width: number): string {
  return `<rect x="${inset}" y="${inset}" width="${Math.max(0, w - inset * 2)}" height="${Math.max(0, h - inset * 2)}" rx="${Math.round(inset * 1.6)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
}

function cornerDots(w: number, h: number, inset: number, r: number, fill: string): string {
  return [
    [inset, inset],
    [w - inset, inset],
    [inset, h - inset],
    [w - inset, h - inset],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`)
    .join("");
}

export const BOOTH_FRAMES: BoothFrame[] = [
  {
    id: `${BOOTH_FRAME_PREFIX}gold`,
    label: "Gold",
    render: (w, h) => {
      const t = Math.max(6, Math.round(Math.min(w, h) * 0.02));
      return svgDoc(
        w,
        h,
        `${borderRect(w, h, t, "#C6A15B", t)}${borderRect(w, h, t * 3, "#E7D3A8", Math.max(2, t * 0.4))}`,
      );
    },
  },
  {
    id: `${BOOTH_FRAME_PREFIX}film`,
    label: "Film",
    render: (w, h) => {
      const bar = Math.max(18, Math.round(w * 0.09));
      const hole = Math.max(6, Math.round(bar * 0.36));
      const gap = bar * 1.9;
      const holes: string[] = [];
      for (let y = bar; y < h - bar * 0.5; y += gap) {
        holes.push(
          `<rect x="${(bar - hole * 1.4) / 2}" y="${y}" width="${hole * 1.4}" height="${hole}" rx="2" fill="#1A1A1A"/>`,
          `<rect x="${w - bar + (bar - hole * 1.4) / 2}" y="${y}" width="${hole * 1.4}" height="${hole}" rx="2" fill="#1A1A1A"/>`,
        );
      }
      return svgDoc(
        w,
        h,
        `<rect x="0" y="0" width="${bar}" height="${h}" fill="#111111"/>
         <rect x="${w - bar}" y="0" width="${bar}" height="${h}" fill="#111111"/>
         ${holes.join("")}`,
      );
    },
  },
  {
    id: `${BOOTH_FRAME_PREFIX}hearts`,
    label: "Hearts",
    render: (w, h) => {
      const t = Math.max(10, Math.round(Math.min(w, h) * 0.05));
      const step = Math.max(40, Math.round(w * 0.11));
      const hearts: string[] = [];
      for (let x = step / 2; x < w; x += step) {
        hearts.push(
          `<path d="${HEART}" fill="#E7A3B6" transform="translate(${x - 16},${t * 0.1}) scale(0.32)"/>`,
          `<path d="${HEART}" fill="#E7A3B6" transform="translate(${x - 16},${h - t * 0.1 - 32}) scale(0.32)"/>`,
        );
      }
      for (let y = step / 2; y < h; y += step) {
        hearts.push(
          `<path d="${HEART}" fill="#E7A3B6" transform="translate(${t * 0.1},${y - 16}) scale(0.32)"/>`,
          `<path d="${HEART}" fill="#E7A3B6" transform="translate(${w - t * 0.1 - 32},${y - 16}) scale(0.32)"/>`,
        );
      }
      return svgDoc(w, h, `${borderRect(w, h, t * 0.4, "#C45B74", Math.max(3, t * 0.24))}${hearts.join("")}`);
    },
  },
  {
    id: `${BOOTH_FRAME_PREFIX}snow`,
    label: "Snow",
    render: (w, h) => {
      const t = Math.max(8, Math.round(Math.min(w, h) * 0.03));
      return svgDoc(
        w,
        h,
        `${borderRect(w, h, t, "#9BB4D0", t * 0.6)}${cornerDots(w, h, t * 2, t * 0.9, "#EAF2FB")}`,
      );
    },
  },
  {
    id: `${BOOTH_FRAME_PREFIX}rope`,
    label: "Rope",
    render: (w, h) => {
      const t = Math.max(8, Math.round(Math.min(w, h) * 0.028));
      return svgDoc(
        w,
        h,
        `${borderRect(w, h, t, "#C47B45", t * 0.8)}<rect x="${t}" y="${t}" width="${Math.max(0, w - t * 2)}" height="${Math.max(0, h - t * 2)}" rx="${t}" fill="none" stroke="#F4E7D2" stroke-width="${Math.max(2, t * 0.28)}" stroke-dasharray="${t * 1.2} ${t * 0.9}"/>`,
      );
    },
  },
];

export function isBoothOverlayAsset(id: string): boolean {
  return id.startsWith(BOOTH_PATTERN_PREFIX) || id.startsWith(BOOTH_FRAME_PREFIX);
}
