/**
 * CapCut-style blend modes for visual layers (video / image / text).
 * CSS `mix-blend-mode` drives preview; FFmpeg `blend` covers export where possible.
 */

export type BlendMode =
  | "passThrough"
  | "normal"
  | "darken"
  | "multiply"
  | "colorBurn"
  | "linearBurn"
  | "lighten"
  | "screen"
  | "colorDodge"
  | "linearDodge"
  | "overlay"
  | "softLight"
  | "hardLight"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const DEFAULT_BLEND_MODE: BlendMode = "normal";

export const BLEND_MODE_OPTIONS: { id: BlendMode; label: string }[] = [
  { id: "passThrough", label: "Pass Through" },
  { id: "normal", label: "Normal" },
  { id: "darken", label: "Darken" },
  { id: "multiply", label: "Multiply" },
  { id: "colorBurn", label: "Color Burn" },
  { id: "linearBurn", label: "Linear Burn" },
  { id: "lighten", label: "Lighten" },
  { id: "screen", label: "Screen" },
  { id: "colorDodge", label: "Color Dodge" },
  { id: "linearDodge", label: "Linear Dodge" },
  { id: "overlay", label: "Overlay" },
  { id: "softLight", label: "Soft Light" },
  { id: "hardLight", label: "Hard Light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
  { id: "hue", label: "Hue" },
  { id: "saturation", label: "Saturation" },
  { id: "color", label: "Color" },
  { id: "luminosity", label: "Luminosity" },
];

const BLEND_IDS = new Set(BLEND_MODE_OPTIONS.map((o) => o.id));

export function normalizeBlendMode(value: unknown): BlendMode {
  if (typeof value === "string" && BLEND_IDS.has(value as BlendMode)) {
    return value as BlendMode;
  }
  return DEFAULT_BLEND_MODE;
}

/** CSS `mix-blend-mode` — Pass Through / Linear Burn map to closest CSS. */
export function blendModeToCss(mode: BlendMode | null | undefined): string {
  switch (normalizeBlendMode(mode)) {
    case "passThrough":
    case "normal":
      return "normal";
    case "darken":
      return "darken";
    case "multiply":
      return "multiply";
    case "colorBurn":
    case "linearBurn":
      return "color-burn";
    case "lighten":
      return "lighten";
    case "screen":
      return "screen";
    case "colorDodge":
      return "color-dodge";
    case "linearDodge":
      return "plus-lighter";
    case "overlay":
      return "overlay";
    case "softLight":
      return "soft-light";
    case "hardLight":
      return "hard-light";
    case "difference":
      return "difference";
    case "exclusion":
      return "exclusion";
    case "hue":
      return "hue";
    case "saturation":
      return "saturation";
    case "color":
      return "color";
    case "luminosity":
      return "luminosity";
    default:
      return "normal";
  }
}

/**
 * FFmpeg `blend=all_mode=` name, or null → use plain `overlay` (alpha-correct).
 * Hue/sat/color/luminosity have no reliable blend mode in FFmpeg — fall back to overlay.
 */
export function blendModeToFfmpeg(mode: BlendMode | null | undefined): string | null {
  switch (normalizeBlendMode(mode)) {
    case "passThrough":
    case "normal":
    case "hue":
    case "saturation":
    case "color":
    case "luminosity":
      return null;
    case "darken":
      return "darken";
    case "multiply":
      return "multiply";
    case "colorBurn":
    case "linearBurn":
      return "burn";
    case "lighten":
      return "lighten";
    case "screen":
      return "screen";
    case "colorDodge":
      return "dodge";
    case "linearDodge":
      return "addition";
    case "overlay":
      return "overlay";
    case "softLight":
      return "softlight";
    case "hardLight":
      return "hardlight";
    case "difference":
      return "difference";
    case "exclusion":
      return "exclusion";
    default:
      return null;
  }
}

export function blendModeLabel(mode: BlendMode | null | undefined): string {
  const id = normalizeBlendMode(mode);
  return BLEND_MODE_OPTIONS.find((o) => o.id === id)?.label ?? "Normal";
}
