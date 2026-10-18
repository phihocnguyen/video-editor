/**
 * Photo-booth themes. Each theme is a background plus SVG stickers that sit
 * around the upright card. Classic is the tilted booth with no stickers.
 */

import {
  BOOTH_DECOR_GROUPS,
  BOOTH_DECOR_PREFIX,
  BOOTH_DECORS,
  BOOTH_SCRAP_BACKGROUND,
  tornNoteSvg,
  type BoothDecor,
} from "./boothDecor";
import { BOOTH_DEFAULT_BACKGROUND } from "./boothStrip";

export interface BoothTheme {
  id: string;
  label: string;
  background: string;
  /** Upright card with margin for stickers. Classic stays tilted. */
  upright: boolean;
  grayscale: boolean;
  groups: { id: string; label: string }[];
  decors: readonly BoothDecor[];
  /** Default colour of the caption printed on the card. */
  titleColor: string;
  /** Suggested background-pattern id (from BOOTH_PATTERNS) for the theme. */
  pattern?: string;
  /** Suggested card-frame id (from BOOTH_FRAMES) for the theme. */
  frame?: string;
}

const HEART =
  "M50,88 C18,66 6,48 6,32 C6,16 18,6 34,6 C43,6 48,12 50,20 C52,12 57,6 66,6 C82,6 94,16 94,32 C94,48 82,66 50,88 Z";

function svgDoc(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

function piece(
  theme: string,
  slug: string,
  name: string,
  group: string,
  svg: string,
  width: number,
  height: number,
  anchor: BoothDecor["anchor"],
  rotation: number,
): BoothDecor {
  return {
    id: `${BOOTH_DECOR_PREFIX}${theme}-${slug}`,
    name,
    group,
    svg,
    width,
    height,
    anchor,
    rotation,
  };
}

function patternSvg(id: string, shape: string): string {
  return svgDoc(
    1080,
    1350,
    `<defs><pattern id="${id}" width="34" height="34" patternUnits="userSpaceOnUse">${shape}</pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/>`,
  );
}

function heartSvg(size: number): string {
  return svgDoc(
    size,
    size,
    `<path d="${HEART}" fill="#F6D5DE" transform="translate(36,18) scale(2.15)"/>
     <path d="${HEART}" fill="#E7A3B6" transform="translate(150,78) scale(1.35)"/>
     <path d="${HEART}" fill="#F8E7EC" transform="translate(78,150) scale(1.15)"/>`,
  );
}

function roseSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<g fill="none" stroke="#8C5A62" stroke-width="3" stroke-linecap="round">
       <path d="M70 40 C 100 120, 40 190, 130 280"/>
       <path d="M180 36 C 160 120, 210 180, 150 270"/>
     </g>
     <ellipse cx="86" cy="210" rx="62" ry="22" fill="#C47A86" transform="rotate(-24 86 210)"/>
     <ellipse cx="196" cy="188" rx="54" ry="18" fill="#A86470" transform="rotate(20 196 188)"/>
     <g fill="#E7A3B4" stroke="#C97B8C" stroke-width="1">
       <circle cx="118" cy="78" r="28"/>
       <circle cx="96" cy="96" r="20"/>
       <circle cx="140" cy="98" r="18"/>
       <circle cx="118" cy="112" r="14" fill="#F3C9D4"/>
     </g>`,
  );
}

function bowSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<ellipse cx="70" cy="70" rx="62" ry="36" fill="#E7A3B6" transform="rotate(-18 70 70)"/>
     <ellipse cx="190" cy="70" rx="62" ry="36" fill="#E7A3B6" transform="rotate(18 190 70)"/>
     <circle cx="130" cy="74" r="18" fill="#C45B74"/>
     <path d="M118 88 L90 150 L130 120 Z" fill="#D9899C"/>
     <path d="M142 88 L176 154 L128 122 Z" fill="#C96B82"/>`,
  );
}

function capSvg(size: number): string {
  return svgDoc(
    size,
    size,
    `<polygon points="160,70 300,130 160,190 20,130" fill="#1A2744" stroke="#C6A15B" stroke-width="3"/>
     <rect x="148" y="118" width="24" height="18" fill="#C6A15B"/>
     <path d="M172 136 C 210 150, 230 190, 200 230" fill="none" stroke="#C6A15B" stroke-width="3"/>
     <circle cx="200" cy="236" r="8" fill="#C6A15B"/>`,
  );
}

function diplomaSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<rect x="70" y="70" width="280" height="150" rx="8" fill="#F4E7D2" stroke="#C6A15B" stroke-width="3"/>
     <circle cx="70" cy="145" r="36" fill="#E7D3A8" stroke="#C6A15B" stroke-width="3"/>
     <circle cx="350" cy="145" r="36" fill="#E7D3A8" stroke="#C6A15B" stroke-width="3"/>
     <path d="M110 120 H300 M110 150 H280 M110 180 H250" fill="none" stroke="#8C7044" stroke-width="2" opacity="0.7"/>`,
  );
}

function laurelSvg(w: number, h: number): string {
  const leaves: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const y = 40 + i * 36;
    leaves.push(
      `<ellipse cx="70" cy="${y}" rx="28" ry="12" fill="#C6A15B" transform="rotate(${-30 + i * 4} 70 ${y})"/>`,
      `<ellipse cx="190" cy="${y}" rx="28" ry="12" fill="#C6A15B" transform="rotate(${30 - i * 4} 190 ${y})"/>`,
    );
  }
  return svgDoc(w, h, `${leaves.join("")}<circle cx="130" cy="40" r="10" fill="#E7D3A8"/>`);
}

function pencilSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<g transform="rotate(-28 140 160)">
       <rect x="40" y="120" width="200" height="36" rx="4" fill="#F2C14E"/>
       <rect x="40" y="120" width="28" height="36" fill="#E7A3B6"/>
       <rect x="68" y="120" width="10" height="36" fill="#C9CED6"/>
       <polygon points="240,120 280,138 240,156" fill="#E7D3A8"/>
       <polygon points="268,132 280,138 268,144" fill="#2A2A2A"/>
     </g>`,
  );
}

function appleSvg(size: number): string {
  return svgDoc(
    size,
    size,
    `<circle cx="150" cy="170" r="90" fill="#C44536"/>
     <ellipse cx="118" cy="140" rx="22" ry="14" fill="#E07A6A" opacity="0.7"/>
     <path d="M150 80 C 150 50, 180 40, 190 28" fill="none" stroke="#6B4A32" stroke-width="6" stroke-linecap="round"/>
     <ellipse cx="188" cy="70" rx="28" ry="14" fill="#6E8F5B" transform="rotate(-20 188 70)"/>`,
  );
}

function notebookSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<rect x="24" y="20" width="${w - 48}" height="${h - 40}" rx="10" fill="#F7F3EA" stroke="#E4D3B6" stroke-width="3"/>
     <path d="M70 20 V${h - 20}" stroke="#E07A6A" stroke-width="2" opacity="0.8"/>
     <path d="M40 70 H${w - 40} M40 110 H${w - 40} M40 150 H${w - 40} M40 190 H${w - 40} M40 230 H${w - 40}" fill="none" stroke="#9BB4D0" stroke-width="1.5"/>`,
  );
}

function starStickersSvg(w: number, h: number): string {
  const star =
    "M0,-18 L4,-5 L18,-5 L7,3 L11,16 L0,8 L-11,16 L-7,3 L-18,-5 L-4,-5 Z";
  return svgDoc(
    w,
    h,
    `<path d="${star}" fill="#F2C14E" transform="translate(70,70)"/>
     <path d="${star}" fill="#F7F3EA" transform="translate(150,120) scale(0.7)"/>
     <path d="${star}" fill="#E07A6A" transform="translate(90,170) scale(0.55)"/>`,
  );
}

function graduateFlowersSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<g fill="none" stroke="#5C7A52" stroke-width="3" stroke-linecap="round">
       <path d="M90 300 C 120 220, 80 160, 120 70"/>
       <path d="M182 300 C 160 220, 200 150, 176 82"/>
     </g>
     <g fill="#6E8F5B">
       <ellipse cx="86" cy="210" rx="34" ry="14" transform="rotate(-30 86 210)"/>
       <ellipse cx="116" cy="150" rx="30" ry="13" transform="rotate(26 116 150)"/>
       <ellipse cx="186" cy="206" rx="34" ry="14" transform="rotate(30 186 206)"/>
       <ellipse cx="150" cy="142" rx="30" ry="13" transform="rotate(-24 150 142)"/>
     </g>
     <g fill="#F3E4C8" stroke="#D9C7A2" stroke-width="1.5">
       <circle cx="124" cy="52" r="32"/>
       <circle cx="92" cy="80" r="24"/>
       <circle cx="156" cy="78" r="22"/>
       <circle cx="124" cy="100" r="16" fill="#F0D48A"/>
     </g>
     <g fill="#E9C97E" stroke="#C6A15B" stroke-width="1.5">
       <circle cx="192" cy="60" r="22"/>
       <circle cx="216" cy="84" r="15"/>
       <circle cx="168" cy="86" r="13"/>
     </g>`,
  );
}

function leafSprigSvg(w: number, h: number): string {
  const cx = w / 2;
  const leaves: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const y = 26 + i * 44;
    const side = i % 2 === 0 ? 1 : -1;
    const lx = cx + side * 36;
    leaves.push(
      `<ellipse cx="${lx}" cy="${y}" rx="32" ry="12" fill="${i % 2 ? "#8AA06A" : "#6E8F5B"}" transform="rotate(${side * 36} ${lx} ${y})"/>`,
    );
  }
  return svgDoc(
    w,
    h,
    `<path d="M${cx} 10 V${h - 10}" stroke="#5C7A52" stroke-width="4" stroke-linecap="round" fill="none"/>
     ${leaves.join("")}`,
  );
}

function balloonSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<path d="M90 250 C 110 180, 70 150, 90 40" fill="none" stroke="#F7F3EA" stroke-width="2"/>
     <path d="M170 260 C 150 180, 190 140, 170 30" fill="none" stroke="#F7F3EA" stroke-width="2"/>
     <path d="M250 250 C 230 170, 270 150, 240 50" fill="none" stroke="#F7F3EA" stroke-width="2"/>
     <ellipse cx="90" cy="90" rx="48" ry="62" fill="#E07A6A"/>
     <ellipse cx="170" cy="78" rx="52" ry="66" fill="#F2C14E"/>
     <ellipse cx="246" cy="96" rx="46" ry="60" fill="#7EB6D6"/>`,
  );
}

function cakeSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<rect x="40" y="160" width="280" height="90" rx="8" fill="#F4E7D2"/>
     <rect x="60" y="120" width="240" height="50" rx="8" fill="#E7A3B6"/>
     <rect x="80" y="90" width="200" height="40" rx="8" fill="#F7F3EA"/>
     <rect x="120" y="48" width="6" height="42" fill="#C6A15B"/>
     <rect x="180" y="40" width="6" height="50" fill="#C6A15B"/>
     <rect x="230" y="52" width="6" height="38" fill="#C6A15B"/>
     <circle cx="123" cy="44" r="6" fill="#E07A6A"/>
     <circle cx="183" cy="36" r="6" fill="#F2C14E"/>
     <circle cx="233" cy="48" r="6" fill="#7EB6D6"/>`,
  );
}

function giftSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<rect x="40" y="90" width="200" height="150" rx="8" fill="#E07A6A"/>
     <rect x="120" y="90" width="28" height="150" fill="#F2C14E"/>
     <rect x="40" y="140" width="200" height="24" fill="#F2C14E"/>
     <ellipse cx="110" cy="78" rx="36" ry="20" fill="#F2C14E"/>
     <ellipse cx="168" cy="78" rx="36" ry="20" fill="#F2C14E"/>
     <circle cx="140" cy="86" r="12" fill="#C6A15B"/>`,
  );
}

function buntingSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<path d="M20 40 Q ${w / 2} 90, ${w - 20} 36" fill="none" stroke="#F7F3EA" stroke-width="3"/>
     <polygon points="70,58 110,58 90,120" fill="#E07A6A"/>
     <polygon points="150,70 196,70 173,138" fill="#F2C14E"/>
     <polygon points="230,60 274,58 252,124" fill="#7EB6D6"/>
     <polygon points="310,48 350,46 330,108" fill="#E7A3B6"/>`,
  );
}

const loveDecors: BoothDecor[] = [
  piece("love", "hearts", "Hearts", "pattern", patternSvg("love-hearts", `<path d="${HEART}" fill="#ffffff" opacity="0.28" transform="scale(0.16)"/>`), 1080, 1350, "backdrop", 0),
  piece("love", "note", "Love note", "note", tornNoteSvg(500, 340, 2.4, `<path d="${HEART}" fill="#C45B74" transform="translate(340,36) scale(1.15)"/>`), 500, 340, "top-left", -8),
  piece("love", "heart", "Hearts", "hearts", heartSvg(320), 320, 320, "top-right", 8),
  piece("love", "bow", "Bow", "bow", bowSvg(260, 200), 260, 200, "mid-right", 12),
  piece("love", "rose", "Rose", "rose", roseSvg(360, 340), 360, 340, "bottom-left", -10),
];

const graduationDecors: BoothDecor[] = [
  piece("graduation", "stars", "Stars", "pattern", patternSvg("grad-stars", `<path d="M8,2 L9.2,6 H13 L10,8.2 L11,12 L8,9.8 L5,12 L6,8.2 L3,6 H6.8 Z" fill="#C6A15B" opacity="0.45"/>`), 1080, 1350, "backdrop", 0),
  piece("graduation", "laurel", "Laurel", "laurel", laurelSvg(260, 240), 260, 240, "top-left", -8),
  piece("graduation", "cap", "Cap", "cap", capSvg(320), 320, 320, "top-right", 6),
  piece("graduation", "diploma", "Diploma", "diploma", diplomaSvg(420, 260), 420, 260, "bottom-left", -6),
  piece("graduation", "spark", "Gold stars", "spark", starStickersSvg(220, 220), 220, 220, "mid-right", 14),
  piece("graduation", "flowers", "Flowers", "flowers", graduateFlowersSvg(300, 320), 300, 320, "bottom-right", -10),
  piece("graduation", "leaves", "Gold leaves", "flowers", leafSprigSvg(220, 300), 220, 300, "mid-right", 8),
];

const schoolDecors: BoothDecor[] = [
  piece("school", "grid", "Grid", "pattern", patternSvg("school-grid", `<path d="M4 16 H28 M16 4 V28" stroke="#ffffff" stroke-width="1.2" opacity="0.22"/>`), 1080, 1350, "backdrop", 0),
  piece("school", "notebook", "Notebook", "notebook", notebookSvg(420, 280), 420, 280, "top-left", -6),
  piece("school", "pencil", "Pencil", "pencil", pencilSvg(320, 280), 320, 280, "top-right", 8),
  piece("school", "apple", "Apple", "apple", appleSvg(300), 300, 300, "bottom-left", -4),
  piece("school", "stars", "Stickers", "stars", starStickersSvg(220, 220), 220, 220, "mid-right", 12),
];

const birthdayDecors: BoothDecor[] = [
  piece(
    "birthday",
    "confetti",
    "Confetti",
    "pattern",
    patternSvg(
      "bday-confetti",
      `<rect x="4" y="8" width="8" height="3" rx="1" fill="#F2C14E" opacity="0.55" transform="rotate(18 8 9)"/>
       <circle cx="22" cy="18" r="1.6" fill="#ffffff" opacity="0.4"/>
       <rect x="16" y="4" width="6" height="2.4" rx="1" fill="#E07A6A" opacity="0.5" transform="rotate(-20 19 5)"/>`,
    ),
    1080,
    1350,
    "backdrop",
    0,
  ),
  piece("birthday", "bunting", "Bunting", "bunting", buntingSvg(420, 180), 420, 180, "top-left", -4),
  piece("birthday", "balloons", "Balloons", "balloons", balloonSvg(320, 340), 320, 340, "top-right", 6),
  piece("birthday", "cake", "Cake", "cake", cakeSvg(360, 280), 360, 280, "bottom-left", -6),
  piece("birthday", "gift", "Gift", "gift", giftSvg(280, 260), 280, 260, "mid-right", 10),
];

function snowflakeSvg(size: number): string {
  const c = size / 2;
  const arms: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    arms.push(
      `<g transform="rotate(${i * 60} ${c} ${c})">
         <line x1="${c}" y1="${c}" x2="${c}" y2="${size * 0.06}" stroke="#EAF2FB" stroke-width="${size * 0.045}" stroke-linecap="round"/>
         <line x1="${c}" y1="${size * 0.26}" x2="${c - size * 0.13}" y2="${size * 0.16}" stroke="#EAF2FB" stroke-width="${size * 0.03}" stroke-linecap="round"/>
         <line x1="${c}" y1="${size * 0.26}" x2="${c + size * 0.13}" y2="${size * 0.16}" stroke="#EAF2FB" stroke-width="${size * 0.03}" stroke-linecap="round"/>
       </g>`,
    );
  }
  return svgDoc(size, size, `${arms.join("")}<circle cx="${c}" cy="${c}" r="${size * 0.06}" fill="#FFFFFF"/>`);
}

function treeSvg(w: number, h: number): string {
  const cx = w / 2;
  const lights: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    lights.push(
      `<circle cx="${(cx + Math.sin(i * 2.3) * w * 0.2).toFixed(1)}" cy="${(h * (0.34 + t * 0.44)).toFixed(1)}" r="${w * 0.028}" fill="${i % 2 ? "#F2C14E" : "#E07A6A"}"/>`,
    );
  }
  return svgDoc(
    w,
    h,
    `<rect x="${cx - w * 0.05}" y="${h * 0.78}" width="${w * 0.1}" height="${h * 0.18}" fill="#6B4A32"/>
     <polygon points="${cx},${h * 0.04} ${cx - w * 0.32},${h * 0.4} ${cx + w * 0.32},${h * 0.4}" fill="#2E7D4F"/>
     <polygon points="${cx},${h * 0.28} ${cx - w * 0.4},${h * 0.64} ${cx + w * 0.4},${h * 0.64}" fill="#2A6E46"/>
     <polygon points="${cx},${h * 0.5} ${cx - w * 0.46},${h * 0.82} ${cx + w * 0.46},${h * 0.82}" fill="#25603E"/>
     ${lights.join("")}
     <circle cx="${cx}" cy="${h * 0.08}" r="${w * 0.05}" fill="#F2C14E"/>`,
  );
}

function bellSvg(w: number, h: number): string {
  const cx = w / 2;
  return svgDoc(
    w,
    h,
    `<path d="M${cx - w * 0.3} ${h * 0.72} C ${cx - w * 0.3} ${h * 0.3}, ${cx - w * 0.16} ${h * 0.14}, ${cx} ${h * 0.14} C ${cx + w * 0.16} ${h * 0.14}, ${cx + w * 0.3} ${h * 0.3}, ${cx + w * 0.3} ${h * 0.72} Z" fill="#F2C14E" stroke="#C6A15B" stroke-width="3"/>
     <rect x="${cx - w * 0.34}" y="${h * 0.72}" width="${w * 0.68}" height="${h * 0.08}" rx="6" fill="#E0A93E"/>
     <circle cx="${cx}" cy="${h * 0.87}" r="${h * 0.06}" fill="#C6A15B"/>
     <circle cx="${cx}" cy="${h * 0.09}" r="${h * 0.04}" fill="#C6A15B"/>`,
  );
}

function lanternSvg(w: number, h: number): string {
  const cx = w / 2;
  return svgDoc(
    w,
    h,
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${h * 0.12}" stroke="#F2C14E" stroke-width="4"/>
     <ellipse cx="${cx}" cy="${h * 0.5}" rx="${w * 0.4}" ry="${h * 0.34}" fill="#C9302C" stroke="#F2C14E" stroke-width="3"/>
     <rect x="${cx - w * 0.3}" y="${h * 0.14}" width="${w * 0.6}" height="${h * 0.06}" rx="3" fill="#F2C14E"/>
     <rect x="${cx - w * 0.32}" y="${h * 0.42}" width="${w * 0.64}" height="${h * 0.05}" fill="#F2C14E" opacity="0.85"/>
     <path d="M${cx} ${h * 0.84} v${h * 0.14}" stroke="#F2C14E" stroke-width="3"/>`,
  );
}

function flower(cx: number, cy: number, r: number, petal: string, core: string): string {
  const petals: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    petals.push(
      `<circle cx="${(cx + Math.cos(a) * r * 0.9).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.9).toFixed(1)}" r="${(r * 0.72).toFixed(1)}" fill="${petal}"/>`,
    );
  }
  return `<g>${petals.join("")}<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.5).toFixed(1)}" fill="${core}"/></g>`;
}

function blossomSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<path d="M${w * 0.06} ${h * 0.92} C ${w * 0.3} ${h * 0.62}, ${w * 0.5} ${h * 0.52}, ${w * 0.92} ${h * 0.12}" fill="none" stroke="#6B4A32" stroke-width="6" stroke-linecap="round"/>
     <path d="M${w * 0.44} ${h * 0.6} L${w * 0.6} ${h * 0.72}" fill="none" stroke="#6B4A32" stroke-width="4" stroke-linecap="round"/>
     ${flower(w * 0.62, h * 0.4, w * 0.14, "#F6C9D2", "#E0868F")}
     ${flower(w * 0.86, h * 0.16, w * 0.11, "#F8D8DE", "#E0868F")}
     ${flower(w * 0.4, h * 0.68, w * 0.12, "#F6C9D2", "#E0868F")}`,
  );
}

function envelopeSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<rect x="${w * 0.08}" y="${h * 0.1}" width="${w * 0.84}" height="${h * 0.8}" rx="12" fill="#C9302C" stroke="#F2C14E" stroke-width="4"/>
     <circle cx="${w * 0.5}" cy="${h * 0.5}" r="${w * 0.19}" fill="#F2C14E"/>
     <circle cx="${w * 0.5}" cy="${h * 0.5}" r="${w * 0.13}" fill="none" stroke="#C9302C" stroke-width="3"/>`,
  );
}

function cloudSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<g fill="#FFFFFF" opacity="0.96">
       <circle cx="${w * 0.3}" cy="${h * 0.62}" r="${h * 0.24}"/>
       <circle cx="${w * 0.5}" cy="${h * 0.48}" r="${h * 0.32}"/>
       <circle cx="${w * 0.7}" cy="${h * 0.62}" r="${h * 0.22}"/>
       <rect x="${w * 0.26}" y="${h * 0.6}" width="${w * 0.48}" height="${h * 0.26}" rx="${h * 0.13}"/>
     </g>`,
  );
}

function onesieSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<path d="M${w * 0.3} ${h * 0.12} L${w * 0.44} ${h * 0.05} L${w * 0.56} ${h * 0.05} L${w * 0.7} ${h * 0.12} L${w * 0.86} ${h * 0.3} L${w * 0.72} ${h * 0.42} L${w * 0.72} ${h * 0.9} L${w * 0.28} ${h * 0.9} L${w * 0.28} ${h * 0.42} L${w * 0.14} ${h * 0.3} Z" fill="#EAF2FB" stroke="#9BB4D0" stroke-width="3"/>
     <circle cx="${w * 0.5}" cy="${h * 0.44}" r="${w * 0.12}" fill="#F6D5DE"/>
     <circle cx="${w * 0.5}" cy="${h * 0.62}" r="${w * 0.035}" fill="#9BB4D0"/>`,
  );
}

function cameraSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<rect x="${w * 0.08}" y="${h * 0.28}" width="${w * 0.84}" height="${h * 0.56}" rx="14" fill="#2E3A46" stroke="#C9CED6" stroke-width="3"/>
     <rect x="${w * 0.3}" y="${h * 0.16}" width="${w * 0.3}" height="${h * 0.16}" rx="6" fill="#2E3A46"/>
     <circle cx="${w * 0.5}" cy="${h * 0.56}" r="${h * 0.2}" fill="#1A222B" stroke="#C9CED6" stroke-width="3"/>
     <circle cx="${w * 0.5}" cy="${h * 0.56}" r="${h * 0.1}" fill="#7EB6D6"/>
     <circle cx="${w * 0.82}" cy="${h * 0.36}" r="${h * 0.04}" fill="#F2C14E"/>`,
  );
}

function planeSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<path d="M${w * 0.06} ${h * 0.6} L${w * 0.94} ${h * 0.2} L${w * 0.6} ${h * 0.62} L${w * 0.72} ${h * 0.9} L${w * 0.54} ${h * 0.64} L${w * 0.28} ${h * 0.78} Z" fill="#EAF2FB" stroke="#9BB4D0" stroke-width="3" stroke-linejoin="round"/>`,
  );
}

function sunSvg(size: number): string {
  const c = size / 2;
  const rays: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    rays.push(
      `<line x1="${c}" y1="${size * 0.18}" x2="${c}" y2="${size * 0.03}" stroke="#F2C14E" stroke-width="${size * 0.04}" stroke-linecap="round" transform="rotate(${i * 30} ${c} ${c})"/>`,
    );
  }
  return svgDoc(size, size, `${rays.join("")}<circle cx="${c}" cy="${c}" r="${size * 0.24}" fill="#F2C14E"/>`);
}

function mapleLeafSvg(w: number, h: number): string {
  return svgDoc(
    w,
    h,
    `<path d="M${w * 0.5} ${h * 0.06} L${w * 0.6} ${h * 0.3} L${w * 0.8} ${h * 0.22} L${w * 0.72} ${h * 0.46} L${w * 0.94} ${h * 0.5} L${w * 0.7} ${h * 0.62} L${w * 0.78} ${h * 0.86} L${w * 0.5} ${h * 0.72} L${w * 0.22} ${h * 0.86} L${w * 0.3} ${h * 0.62} L${w * 0.06} ${h * 0.5} L${w * 0.28} ${h * 0.46} L${w * 0.2} ${h * 0.22} L${w * 0.4} ${h * 0.3} Z" fill="#C9622F" stroke="#9C451C" stroke-width="2"/>
     <path d="M${w * 0.5} ${h * 0.72} V${h * 0.98}" stroke="#9C451C" stroke-width="3"/>`,
  );
}

function pumpkinSvg(w: number, h: number): string {
  const cx = w / 2;
  return svgDoc(
    w,
    h,
    `<ellipse cx="${cx}" cy="${h * 0.6}" rx="${w * 0.34}" ry="${h * 0.3}" fill="#E07A2A"/>
     <ellipse cx="${cx - w * 0.2}" cy="${h * 0.6}" rx="${w * 0.2}" ry="${h * 0.3}" fill="#C96A1E"/>
     <ellipse cx="${cx + w * 0.2}" cy="${h * 0.6}" rx="${w * 0.2}" ry="${h * 0.3}" fill="#C96A1E"/>
     <rect x="${cx - w * 0.05}" y="${h * 0.2}" width="${w * 0.1}" height="${h * 0.14}" fill="#6E8F5B"/>
     <path d="M${cx} ${h * 0.2} C ${cx + w * 0.14} ${h * 0.08}, ${cx + w * 0.24} ${h * 0.1}, ${cx + w * 0.26} ${h * 0.16}" fill="none" stroke="#6E8F5B" stroke-width="4"/>`,
  );
}

const christmasDecors: BoothDecor[] = [
  piece("christmas", "snow", "Snow dots", "pattern", patternSvg("xmas-snow", `<circle cx="4" cy="4" r="1.5" fill="#ffffff" opacity="0.3"/>`), 1080, 1350, "backdrop", 0),
  piece("christmas", "flake", "Snowflake", "flake", snowflakeSvg(280), 280, 280, "top-left", -10),
  piece("christmas", "tree", "Tree", "tree", treeSvg(300, 360), 300, 360, "bottom-right", -6),
  piece("christmas", "gift", "Gift", "gift", giftSvg(280, 260), 280, 260, "mid-right", 10),
  piece("christmas", "bell", "Bell", "bell", bellSvg(260, 260), 260, 260, "top-right", 8),
];

const newYearDecors: BoothDecor[] = [
  piece("newyear", "gold", "Gold confetti", "pattern", patternSvg("tet-gold", `<circle cx="4" cy="4" r="1.3" fill="#F2C14E" opacity="0.42"/>`), 1080, 1350, "backdrop", 0),
  piece("newyear", "lantern", "Lantern", "lantern", lanternSvg(260, 340), 260, 340, "top-left", -8),
  piece("newyear", "blossom", "Blossom", "blossom", blossomSvg(340, 320), 340, 320, "bottom-right", -10),
  piece("newyear", "envelope", "Lucky envelope", "envelope", envelopeSvg(280, 220), 280, 220, "mid-right", 12),
];

const babyDecors: BoothDecor[] = [
  piece("baby", "dots", "Soft dots", "pattern", patternSvg("baby-dots", `<circle cx="4" cy="4" r="1.5" fill="#ffffff" opacity="0.28"/>`), 1080, 1350, "backdrop", 0),
  piece("baby", "cloud", "Cloud", "cloud", cloudSvg(320, 200), 320, 200, "top-left", -6),
  piece("baby", "star", "Stars", "star", starStickersSvg(220, 220), 220, 220, "top-right", 12),
  piece("baby", "onesie", "Onesie", "onesie", onesieSvg(280, 320), 280, 320, "mid-right", 8),
  piece("baby", "balloon", "Balloons", "balloon", balloonSvg(300, 320), 300, 320, "bottom-left", -8),
];

const travelDecors: BoothDecor[] = [
  piece("travel", "dots", "Map dots", "pattern", patternSvg("travel-dots", `<circle cx="4" cy="4" r="1.3" fill="#ffffff" opacity="0.24"/>`), 1080, 1350, "backdrop", 0),
  piece("travel", "plane", "Paper plane", "plane", planeSvg(320, 240), 320, 240, "top-right", 10),
  piece("travel", "sun", "Sun", "sun", sunSvg(260), 260, 260, "top-left", -6),
  piece("travel", "camera", "Camera", "camera", cameraSvg(320, 260), 320, 260, "bottom-left", -8),
];

const autumnDecors: BoothDecor[] = [
  piece("autumn", "leaves", "Fallen leaves", "pattern", patternSvg("autumn-leaves", `<ellipse cx="8" cy="10" rx="6" ry="2.6" fill="#C9622F" opacity="0.5" transform="rotate(-24 8 10)"/>`), 1080, 1350, "backdrop", 0),
  piece("autumn", "maple", "Maple leaf", "maple", mapleLeafSvg(280, 280), 280, 280, "top-right", -10),
  piece("autumn", "spray", "Leaf spray", "spray", leafSprigSvg(220, 300), 220, 300, "mid-right", 8),
  piece("autumn", "pumpkin", "Pumpkin", "pumpkin", pumpkinSvg(280, 260), 280, 260, "bottom-left", -6),
];

export const BOOTH_THEMES: BoothTheme[] = [
  {
    id: "love",
    label: "Love",
    background: "#9B2C4A",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Heart paper" },
      { id: "note", label: "Love note" },
      { id: "hearts", label: "Hearts" },
      { id: "bow", label: "Bow" },
      { id: "rose", label: "Rose" },
    ],
    decors: loveDecors,
    titleColor: "#FFFFFF",
    pattern: "__booth-pattern-hearts",
    frame: "__booth-frame-hearts",
  },
  {
    id: "graduation",
    label: "Graduation",
    background: "#1B2A4A",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Star paper" },
      { id: "laurel", label: "Laurel" },
      { id: "cap", label: "Cap" },
      { id: "diploma", label: "Diploma" },
      { id: "spark", label: "Gold stars" },
      { id: "flowers", label: "Flowers & leaves" },
    ],
    decors: graduationDecors,
    titleColor: "#F2C14E",
    pattern: "__booth-pattern-stars",
    frame: "__booth-frame-gold",
  },
  {
    id: "school",
    label: "School",
    background: "#1F4E79",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Grid paper" },
      { id: "notebook", label: "Notebook" },
      { id: "pencil", label: "Pencil" },
      { id: "apple", label: "Apple" },
      { id: "stars", label: "Stickers" },
    ],
    decors: schoolDecors,
    titleColor: "#FFFFFF",
    pattern: "__booth-pattern-grid",
  },
  {
    id: "birthday",
    label: "Birthday",
    background: "#6B2D5B",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Confetti" },
      { id: "bunting", label: "Bunting" },
      { id: "balloons", label: "Balloons" },
      { id: "cake", label: "Cake" },
      { id: "gift", label: "Gift" },
    ],
    decors: birthdayDecors,
    titleColor: "#F2C14E",
    pattern: "__booth-pattern-confetti",
  },
  {
    id: "christmas",
    label: "Christmas",
    background: "#1E4B3A",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Snow dots" },
      { id: "flake", label: "Snowflake" },
      { id: "tree", label: "Tree" },
      { id: "gift", label: "Gift" },
      { id: "bell", label: "Bell" },
    ],
    decors: christmasDecors,
    titleColor: "#F2C14E",
    pattern: "__booth-pattern-dots",
    frame: "__booth-frame-snow",
  },
  {
    id: "newyear",
    label: "New year",
    background: "#8C1D2C",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Gold paper" },
      { id: "lantern", label: "Lantern" },
      { id: "blossom", label: "Blossom" },
      { id: "envelope", label: "Lucky envelope" },
    ],
    decors: newYearDecors,
    titleColor: "#F2C14E",
    pattern: "__booth-pattern-stars",
    frame: "__booth-frame-gold",
  },
  {
    id: "baby",
    label: "Baby",
    background: "#6FA3C8",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Soft dots" },
      { id: "cloud", label: "Cloud" },
      { id: "star", label: "Stars" },
      { id: "onesie", label: "Onesie" },
      { id: "balloon", label: "Balloons" },
    ],
    decors: babyDecors,
    titleColor: "#FFFFFF",
    pattern: "__booth-pattern-dots",
  },
  {
    id: "travel",
    label: "Travel",
    background: "#2E7D8A",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Map dots" },
      { id: "plane", label: "Paper plane" },
      { id: "sun", label: "Sun" },
      { id: "camera", label: "Camera" },
    ],
    decors: travelDecors,
    titleColor: "#FFFFFF",
    pattern: "__booth-pattern-grid",
  },
  {
    id: "autumn",
    label: "Autumn",
    background: "#7A4A24",
    upright: true,
    grayscale: false,
    groups: [
      { id: "pattern", label: "Fallen leaves" },
      { id: "maple", label: "Maple leaf" },
      { id: "spray", label: "Leaf spray" },
      { id: "pumpkin", label: "Pumpkin" },
    ],
    decors: autumnDecors,
    titleColor: "#F7E4C0",
    pattern: "__booth-pattern-leaves",
    frame: "__booth-frame-rope",
  },
  {
    id: "scrapbook",
    label: "Scrapbook",
    background: BOOTH_SCRAP_BACKGROUND,
    upright: true,
    grayscale: false,
    groups: BOOTH_DECOR_GROUPS.map((group) => ({ id: group.id, label: group.label })),
    decors: BOOTH_DECORS,
    titleColor: "#F3E4C8",
    pattern: "__booth-pattern-dots",
  },
  {
    id: "classic",
    label: "Classic",
    background: BOOTH_DEFAULT_BACKGROUND,
    upright: true,
    grayscale: false,
    groups: [],
    decors: [],
    titleColor: "#FFFFFF",
  },
];

export function boothThemeById(id: string | undefined): BoothTheme {
  return BOOTH_THEMES.find((theme) => theme.id === id) ?? BOOTH_THEMES.find((theme) => theme.id === "scrapbook")!;
}

export function boothDecorsForTheme(themeId: string, groups: readonly string[]): BoothDecor[] {
  const theme = boothThemeById(themeId);
  const wanted = new Set(groups);
  return theme.decors.filter((decor) => wanted.has(decor.group));
}
