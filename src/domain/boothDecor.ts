/**
 * Scrapbook stickers around the photo-booth card. Each piece is an SVG
 * drawing rasterized to PNG on apply (FFmpeg's SVG path is unreliable).
 * Pieces stay ordinary image clips, so they can be moved after the template
 * is created.
 */

import { BOOTH_CANVAS } from "./boothStrip";

export const BOOTH_DECOR_PREFIX = "__booth-decor-";
export const BOOTH_SCRAP_BACKGROUND = "#6B1E2A";

export type BoothDecorAnchor =
  | "backdrop"
  | "top-left"
  | "top-right"
  | "mid-right"
  | "bottom-right"
  | "bottom-left";

export interface BoothDecor {
  id: string;
  name: string;
  /** UI group. Toggling a group includes every piece in it. */
  group: string;
  svg: string;
  width: number;
  height: number;
  /** Where the sticker sits relative to the upright card. */
  anchor: BoothDecorAnchor;
  rotation: number;
}

export const BOOTH_DECOR_GROUPS: { id: BoothDecor["group"]; label: string }[] = [
  { id: "notes", label: "Torn letters" },
  { id: "daisy", label: "Pressed flower" },
  { id: "bouquet", label: "Dried flowers" },
  { id: "dots", label: "Dot paper" },
];

function tornOutline(w: number, h: number, seed: number): string {
  const amp = Math.min(w, h) * 0.04;
  const n = 16;
  const pts: string[] = [];
  const push = (x: number, y: number) => pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  const wobble = (i: number) =>
    Math.sin(seed + i * 1.65) * amp + Math.sin(seed * 0.4 + i * 0.55) * amp * 0.4;
  for (let i = 0; i <= n; i += 1) push((w * i) / n, 10 + wobble(i));
  for (let i = 1; i <= n; i += 1) push(w - 10 - wobble(i + 3), (h * i) / n);
  for (let i = n - 1; i >= 0; i -= 1) push((w * i) / n, h - 10 - wobble(i + 7));
  for (let i = n - 1; i >= 1; i -= 1) push(10 + wobble(i + 11), (h * i) / n);
  return pts.join(" ");
}

function scriptStrokes(w: number, h: number, seed: number): string {
  const ink = "#5A4334";
  const lines: string[] = [];
  const rows = 5;
  for (let row = 0; row < rows; row += 1) {
    const y = h * (0.22 + row * 0.13);
    const x0 = w * 0.12;
    const x1 = w * (0.78 + (row % 2) * 0.08);
    let d = `M ${x0.toFixed(1)} ${y.toFixed(1)}`;
    const steps = 7;
    for (let i = 1; i <= steps; i += 1) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const lift = Math.sin(seed + row * 2 + i) * (h * 0.035);
      d += ` Q ${(x - (x1 - x0) / steps / 2).toFixed(1)} ${(y - lift).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    lines.push(
      `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" opacity="0.72"/>`,
    );
  }
  return lines.join("");
}

export function tornNoteSvg(w: number, h: number, seed: number, extra = ""): string {
  const outline = tornOutline(w, h, seed);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polygon points="${outline}" fill="#F4E7D2"/>
    <polygon points="${outline}" fill="none" stroke="#E4D3B6" stroke-width="3"/>
    ${scriptStrokes(w, h, seed)}
    ${extra}
  </svg>`;
}

function daisySvg(size: number): string {
  const c = size / 2;
  const petals: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const rot = i * 30;
    petals.push(
      `<ellipse cx="${c}" cy="${(c * 0.42).toFixed(1)}" rx="${(size * 0.16).toFixed(1)}" ry="${(size * 0.28).toFixed(1)}" fill="${i % 2 ? "#E6D2B0" : "#F3E4C8"}" stroke="#CDB892" stroke-width="1.5" transform="rotate(${rot} ${c} ${c})"/>`,
    );
  }
  const edge = tornOutline(size, size, 2.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <polygon points="${edge}" fill="#F7F1E6"/>
    <g>${petals.join("")}</g>
    <circle cx="${c}" cy="${c}" r="${(size * 0.16).toFixed(1)}" fill="#E0B15A" stroke="#C4923E" stroke-width="2"/>
    <circle cx="${c}" cy="${c}" r="${(size * 0.08).toFixed(1)}" fill="#F0D48A"/>
  </svg>`;
}

function bouquetSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <g fill="none" stroke="#8C7044" stroke-width="3" stroke-linecap="round">
      <path d="M70 40 C 90 120, 40 180, 120 250"/>
      <path d="M150 30 C 140 110, 180 170, 130 260"/>
      <path d="M210 55 C 200 130, 230 190, 170 255"/>
    </g>
    <ellipse cx="78" cy="210" rx="70" ry="28" fill="#C4A36A" transform="rotate(-28 78 210)"/>
    <ellipse cx="210" cy="188" rx="64" ry="24" fill="#A98450" transform="rotate(24 210 188)"/>
    <g fill="#F0E0C0" stroke="#D9C7A2" stroke-width="1">
      <circle cx="92" cy="78" r="16"/>
      <circle cx="118" cy="62" r="13"/>
      <circle cx="70" cy="96" r="12"/>
      <circle cx="168" cy="70" r="15"/>
      <circle cx="196" cy="88" r="12"/>
      <circle cx="150" cy="96" r="11"/>
      <circle cx="230" cy="74" r="14"/>
    </g>
    <g transform="rotate(-18 150 300)">
      <rect x="40" y="268" width="250" height="46" rx="4" fill="#C47B45" opacity="0.78"/>
      <rect x="40" y="268" width="250" height="46" rx="4" fill="none" stroke="#A86532" stroke-width="1.5" opacity="0.5"/>
    </g>
  </svg>`;
}

function dotsSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <pattern id="booth-dots" width="26" height="26" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.15" fill="#ffffff" opacity="0.22"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#booth-dots)"/>
  </svg>`;
}

export const BOOTH_DECORS: BoothDecor[] = [
  {
    id: `${BOOTH_DECOR_PREFIX}dots`,
    name: "Dot paper",
    group: "dots",
    svg: dotsSvg(BOOTH_CANVAS.width, BOOTH_CANVAS.height),
    width: BOOTH_CANVAS.width,
    height: BOOTH_CANVAS.height,
    anchor: "backdrop",
    rotation: 0,
  },
  {
    id: `${BOOTH_DECOR_PREFIX}note-a`,
    name: "Letter",
    group: "notes",
    svg: tornNoteSvg(500, 340, 1.1),
    width: 500,
    height: 340,
    anchor: "top-left",
    rotation: -11,
  },
  {
    id: `${BOOTH_DECOR_PREFIX}note-b`,
    name: "Letter",
    group: "notes",
    svg: tornNoteSvg(480, 400, 4.4),
    width: 480,
    height: 400,
    anchor: "bottom-right",
    rotation: 9,
  },
  {
    id: `${BOOTH_DECOR_PREFIX}note-c`,
    name: "Letter",
    group: "notes",
    svg: tornNoteSvg(260, 320, 7.7),
    width: 260,
    height: 320,
    anchor: "mid-right",
    rotation: 16,
  },
  {
    id: `${BOOTH_DECOR_PREFIX}daisy`,
    name: "Pressed flower",
    group: "daisy",
    svg: daisySvg(320),
    width: 320,
    height: 320,
    anchor: "top-right",
    rotation: 14,
  },
  {
    id: `${BOOTH_DECOR_PREFIX}bouquet`,
    name: "Dried flowers",
    group: "bouquet",
    svg: bouquetSvg(440, 380),
    width: 440,
    height: 380,
    anchor: "bottom-left",
    rotation: -8,
  },
];

/**
 * Sticker center in canvas pixels. Pieces tuck a little under the card and
 * the rest stays in the margin, so the photos stay clear.
 */
export function boothDecorCenter(
  decor: Pick<BoothDecor, "width" | "height" | "anchor">,
  paper: { x: number; y: number; w: number; h: number },
  canvas: { width: number; height: number },
): { x: number; y: number } {
  const sw = decor.width;
  const sh = decor.height;
  const right = paper.x + paper.w;
  const bottom = paper.y + paper.h;
  switch (decor.anchor) {
    case "backdrop":
      return { x: canvas.width / 2, y: canvas.height / 2 };
    case "top-left":
      return { x: paper.x - sw * 0.12, y: paper.y - sh * 0.22 };
    case "top-right":
      return { x: right + sw * 0.08, y: paper.y - sh * 0.12 };
    case "mid-right":
      return { x: right + sw * 0.32, y: paper.y + paper.h * 0.46 };
    case "bottom-right":
      return { x: right - sw * 0.05, y: bottom + sh * 0.08 };
    case "bottom-left":
      return { x: paper.x - sw * 0.18, y: bottom + sh * 0.02 };
  }
}

export function isBoothDecorAsset(id: string): boolean {
  return id.startsWith(BOOTH_DECOR_PREFIX);
}

export function boothDecorsForGroups(groups: readonly string[]): BoothDecor[] {
  const wanted = new Set(groups);
  return BOOTH_DECORS.filter((decor) => wanted.has(decor.group));
}
