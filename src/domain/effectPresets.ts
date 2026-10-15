import {
  DEFAULT_CLIP_EFFECTS,
  normalizeClipEffects,
  type ClipEffects,
} from "./effects";

/** CapCut-style one-tap looks (color fields only; fades are preserved by apply). */
export interface EffectPreset {
  id: string;
  label: string;
  /** CSS background for the inspector swatch button. */
  swatch: string;
  /** Patch applied on top of current effects (fades kept by caller). */
  patch: Partial<ClipEffects>;
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: "none",
    label: "None",
    swatch:
      "linear-gradient(145deg, #d8d8dc 0%, #b8b8be 55%, #9a9aa2 100%)",
    patch: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      blur: 0,
      grayscale: false,
      vignette: 0,
      sharpen: 0,
    },
  },
  {
    id: "warm",
    label: "Warm",
    swatch:
      "linear-gradient(145deg, #ffe0b8 0%, #f0a46a 45%, #c45c2a 100%)",
    patch: {
      brightness: 1.05,
      contrast: 1.08,
      saturation: 1.25,
      blur: 0,
      grayscale: false,
      vignette: 0.25,
      sharpen: 0.15,
    },
  },
  {
    id: "cool",
    label: "Cool",
    swatch:
      "linear-gradient(145deg, #c8e4f8 0%, #6a9ec8 48%, #2a4a78 100%)",
    patch: {
      brightness: 1.02,
      contrast: 1.1,
      saturation: 0.85,
      blur: 0,
      grayscale: false,
      vignette: 0.2,
      sharpen: 0.2,
    },
  },
  {
    id: "vivid",
    label: "Vivid",
    swatch:
      "linear-gradient(145deg, #ffd36a 0%, #ff5e7a 42%, #5b6cff 100%)",
    patch: {
      brightness: 1.08,
      contrast: 1.25,
      saturation: 1.55,
      blur: 0,
      grayscale: false,
      vignette: 0.15,
      sharpen: 0.45,
    },
  },
  {
    id: "soft",
    label: "Soft",
    swatch:
      "linear-gradient(145deg, #f3e8ef 0%, #d4b8c8 50%, #a88898 100%)",
    patch: {
      brightness: 1.06,
      contrast: 0.92,
      saturation: 1.05,
      blur: 1.2,
      grayscale: false,
      vignette: 0.35,
      sharpen: 0,
    },
  },
  {
    id: "bw",
    label: "B&W",
    swatch:
      "linear-gradient(145deg, #f0f0f0 0%, #888888 50%, #1a1a1a 100%)",
    patch: {
      brightness: 1.02,
      contrast: 1.15,
      saturation: 1,
      blur: 0,
      grayscale: true,
      vignette: 0.3,
      sharpen: 0.25,
    },
  },
  {
    id: "film",
    label: "Film",
    swatch:
      "linear-gradient(145deg, #e8dcc8 0%, #8a7a5c 48%, #2c2418 100%)",
    patch: {
      brightness: 0.98,
      contrast: 1.18,
      saturation: 0.9,
      blur: 0.3,
      grayscale: false,
      vignette: 0.55,
      sharpen: 0.35,
    },
  },
];

const COLOR_KEYS = [
  "brightness",
  "contrast",
  "saturation",
  "blur",
  "grayscale",
  "vignette",
  "sharpen",
] as const;

function near(a: number, b: number, eps = 0.04): boolean {
  return Math.abs(a - b) < eps;
}

/** True when color/look fields match a preset (ignores fade in/out). */
export function effectsMatchPreset(
  effects: ClipEffects,
  preset: EffectPreset,
): boolean {
  const e = normalizeClipEffects(effects);
  const p = normalizeClipEffects({ ...DEFAULT_CLIP_EFFECTS, ...preset.patch });
  for (const key of COLOR_KEYS) {
    const ev = e[key];
    const pv = p[key];
    if (typeof ev === "boolean" || typeof pv === "boolean") {
      if (ev !== pv) return false;
    } else if (!near(ev as number, pv as number)) {
      return false;
    }
  }
  return true;
}

export function findMatchingEffectPreset(
  effects: ClipEffects,
): EffectPreset | null {
  // Prefer named looks over "None" when both could match.
  for (const preset of EFFECT_PRESETS) {
    if (preset.id === "none") continue;
    if (effectsMatchPreset(effects, preset)) return preset;
  }
  if (effectsMatchPreset(effects, EFFECT_PRESETS[0]!)) return EFFECT_PRESETS[0]!;
  return null;
}

/** Apply preset color fields while preserving fade in/out. */
export function applyEffectPreset(
  current: ClipEffects,
  preset: EffectPreset,
): ClipEffects {
  return normalizeClipEffects({
    ...current,
    ...preset.patch,
    fadeInSec: current.fadeInSec,
    fadeOutSec: current.fadeOutSec,
  });
}
