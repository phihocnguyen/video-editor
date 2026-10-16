/** Per-clip visual effects (preview CSS + FFmpeg export). */

/** How a color wash mixes over the graded picture. */
export type TintBlend = "normal" | "soft-light" | "overlay" | "multiply" | "screen";

export const TINT_BLENDS: readonly TintBlend[] = [
  "normal",
  "soft-light",
  "overlay",
  "multiply",
  "screen",
];

export interface ClipEffects {
  /** Multiplier; 1 = neutral. Range ~0..2 */
  brightness: number;
  /** Multiplier; 1 = neutral. Range ~0..2 */
  contrast: number;
  /** Multiplier; 1 = neutral. Range ~0..3 */
  saturation: number;
  /** Blur radius (px for preview; sigma for FFmpeg). 0 = off */
  blur: number;
  grayscale: boolean;
  /** Corner darkening intensity; 0 = off, 1 = strong. */
  vignette: number;
  /** Sharpen strength; 0 = off, ~2 = strong. */
  sharpen: number;
  /** 0 = off, 1 = full sepia. Applied before the tint wash. */
  sepia: number;
  /** Hue shift in degrees. 0 = off. */
  hueRotate: number;
  /** Solid wash mixed over the picture. Ignored when `tintAmount` is 0. */
  tintColor: string;
  /**
   * Vertical wash, top to bottom. Two or more stops replace the solid
   * `tintColor` (Instagram story gradients). Empty = solid tint.
   */
  tintGradient: string[];
  /** 0 = off, 1 = full wash. */
  tintAmount: number;
  tintBlend: TintBlend;
  /**
   * Sony Vegas-style frame strobe. 0 = off.
   * N = flash 1 frame of `strobeColor` every N frames (N=1 → every other frame).
   */
  strobeFrames: number;
  /** Solid flash colour when a strobe frame hits (hex). */
  strobeColor: string;
  /** Seconds of fade-in from clip start */
  fadeInSec: number;
  /** Seconds of fade-out to clip end */
  fadeOutSec: number;
}

export const DEFAULT_CLIP_EFFECTS: ClipEffects = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  blur: 0,
  grayscale: false,
  vignette: 0,
  sharpen: 0,
  sepia: 0,
  hueRotate: 0,
  tintColor: "#000000",
  tintGradient: [],
  tintAmount: 0,
  tintBlend: "soft-light",
  strobeFrames: 0,
  strobeColor: "#000000",
  fadeInSec: 0,
  fadeOutSec: 0,
};

export function normalizeClipEffects(
  input?: Partial<ClipEffects> | null,
): ClipEffects {
  const src = input ?? {};
  return {
    brightness: clamp(finite(src.brightness, 1), 0, 2),
    contrast: clamp(finite(src.contrast, 1), 0, 2),
    saturation: clamp(finite(src.saturation, 1), 0, 3),
    blur: clamp(finite(src.blur, 0), 0, 40),
    grayscale: Boolean(src.grayscale),
    vignette: clamp(finite(src.vignette, 0), 0, 1),
    sharpen: clamp(finite(src.sharpen, 0), 0, 2),
    sepia: clamp(finite(src.sepia, 0), 0, 1),
    hueRotate: clamp(finite(src.hueRotate, 0), -180, 180),
    tintColor: normalizeHexColor(src.tintColor, DEFAULT_CLIP_EFFECTS.tintColor),
    tintGradient: normalizeTintGradient(src.tintGradient),
    tintAmount: clamp(finite(src.tintAmount, 0), 0, 1),
    tintBlend: normalizeTintBlend(src.tintBlend),
    strobeFrames: Math.round(clamp(finite(src.strobeFrames, 0), 0, 60)),
    strobeColor: normalizeHexColor(src.strobeColor, DEFAULT_CLIP_EFFECTS.strobeColor),
    fadeInSec: clamp(finite(src.fadeInSec, 0), 0, 60),
    fadeOutSec: clamp(finite(src.fadeOutSec, 0), 0, 60),
  };
}

export function effectsAreDefault(effects: ClipEffects): boolean {
  const d = DEFAULT_CLIP_EFFECTS;
  return (
    near(effects.brightness, d.brightness) &&
    near(effects.contrast, d.contrast) &&
    near(effects.saturation, d.saturation) &&
    near(effects.blur, d.blur) &&
    effects.grayscale === d.grayscale &&
    near(effects.vignette, d.vignette) &&
    near(effects.sharpen, d.sharpen) &&
    near(effects.sepia, d.sepia) &&
    near(effects.hueRotate, d.hueRotate) &&
    effects.tintGradient.length === 0 &&
    near(effects.tintAmount, d.tintAmount) &&
    effects.strobeFrames === d.strobeFrames &&
    effects.strobeColor.toLowerCase() === d.strobeColor.toLowerCase() &&
    near(effects.fadeInSec, d.fadeInSec) &&
    near(effects.fadeOutSec, d.fadeOutSec)
  );
}

/**
 * True on flash frames: 1 frame of `strobeColor` every `strobeFrames` frames.
 * Example: 5f → frames 4, 9, 14… flash (0-based); other frames stay normal.
 */
export function strobeIsFlashFrame(
  effects: ClipEffects,
  localSec: number,
  frameRate: number,
): boolean {
  const period = Math.round(effects.strobeFrames);
  if (period <= 0) return false;
  const fps = Math.max(1, frameRate);
  const frame = Math.max(0, Math.floor(localSec * fps + 1e-9));
  return frame % period === period - 1;
}

/** @deprecated use strobeIsFlashFrame — kept for older call sites. */
export function strobeOpacityMultiplier(
  effects: ClipEffects,
  localSec: number,
  frameRate: number,
): number {
  return strobeIsFlashFrame(effects, localSec, frameRate) ? 0 : 1;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

/**
 * CSS filter string for preview layers (empty if neutral aside from fades).
 * Vignette is applied separately as a radial overlay in CompositeLayers.
 * Sharpen uses a contrast bump as a lightweight approximation of unsharp.
 *
 * `pxScale` = stage px per canvas px (stageWidth / canvasWidth). CSS blur px
 * are stage px, so the value is scaled to match canvas-px semantics in export
 * (`gblur` sigma). Without this, preview on a small stage over-blurs ~3×.
 */
export function cssFilterFromEffects(effects: ClipEffects, pxScale = 1): string {
  const parts: string[] = [];
  if (!near(effects.brightness, 1)) parts.push(`brightness(${effects.brightness})`);
  let contrast = effects.contrast;
  if (effects.sharpen > 0.02) {
    // Map 0..2 sharpen → up to +0.35 contrast for a snappier look in preview.
    contrast = clamp(contrast * (1 + effects.sharpen * 0.175), 0, 3);
  }
  if (!near(contrast, 1)) parts.push(`contrast(${contrast})`);
  if (!near(effects.saturation, 1)) parts.push(`saturate(${effects.saturation})`);
  if (effects.blur > 0.05) {
    const px = Math.max(0.1, effects.blur * (Number.isFinite(pxScale) && pxScale > 0 ? pxScale : 1));
    parts.push(`blur(${px.toFixed(1)}px)`);
  }
  if (effects.grayscale) parts.push("grayscale(1)");
  if (effects.sepia > 0.02) parts.push(`sepia(${effects.sepia.toFixed(2)})`);
  if (Math.abs(effects.hueRotate) > 0.5) {
    parts.push(`hue-rotate(${effects.hueRotate.toFixed(1)}deg)`);
  }
  return parts.join(" ");
}

export interface TintOverlay {
  color: string;
  opacity: number;
  blend: TintBlend;
}

/**
 * Color wash drawn above the filtered media (preview). Export uses the same
 * blend as a `geq` mix so the wash is not hue-shifted with the picture.
 */
export function tintOverlayFromEffects(effects: ClipEffects): TintOverlay | null {
  if (effects.tintAmount < 0.02) return null;
  const stops = effects.tintGradient;
  return {
    color:
      stops.length >= 2
        ? `linear-gradient(to bottom, ${stops.join(", ")})`
        : effects.tintColor,
    opacity: clamp(effects.tintAmount, 0, 1),
    blend: effects.tintBlend,
  };
}

/**
 * Opacity of the dark vignette overlay (0..1) for preview compositing.
 * Center stays clear; corners darken with intensity.
 */
export function vignetteOverlayOpacity(effects: ClipEffects): number {
  if (effects.vignette < 0.02) return 0;
  return clamp(effects.vignette * 0.85, 0, 0.85);
}

/**
 * Opacity multiplier from fade in/out at local timeline time within the clip.
 * `localSec` is seconds from clip start; `durationSec` is clip duration on timeline.
 */
export function fadeOpacityMultiplier(
  effects: ClipEffects,
  localSec: number,
  durationSec: number,
): number {
  const dur = Math.max(0.01, durationSec);
  const t = Math.max(0, Math.min(dur, localSec));
  let mul = 1;
  const fadeIn = Math.min(effects.fadeInSec, dur);
  if (fadeIn > 0.001 && t < fadeIn) {
    mul = Math.min(mul, t / fadeIn);
  }
  const fadeOut = Math.min(effects.fadeOutSec, dur);
  if (fadeOut > 0.001 && t > dur - fadeOut) {
    mul = Math.min(mul, (dur - t) / fadeOut);
  }
  return clamp(mul, 0, 1);
}

/**
 * FFmpeg filter chain fragment (no leading/trailing commas) applied after setpts
 * on a visual clip whose PTS starts at 0.
 * `clipDurationSec` = nominal timeline duration (not including transition overlap).
 * `delaySec` shifts effect fades so they match preview (relative to nominal start,
 * ignoring early transition pre-roll).
 */
export function ffmpegVideoEffectsChain(
  effects: ClipEffects,
  clipDurationSec: number,
  options?: { delaySec?: number },
): string {
  const parts: string[] = [];
  const delay = Math.max(0, options?.delaySec ?? 0);
  const eqBright = clamp(effects.brightness - 1, -1, 1);
  const needEq =
    !near(eqBright, 0) ||
    !near(effects.contrast, 1) ||
    !near(effects.saturation, 1);
  if (needEq) {
    parts.push(
      `eq=brightness=${eqBright.toFixed(3)}:contrast=${effects.contrast.toFixed(3)}:saturation=${effects.saturation.toFixed(3)}`,
    );
  }
  const grade = ffmpegColorGradeChain(effects);
  if (grade) parts.push(grade);
  if (effects.blur > 0.05) {
    parts.push(`gblur=sigma=${Math.min(40, effects.blur).toFixed(2)}`);
  }
  if (effects.grayscale) {
    parts.push("hue=s=0");
  }
  if (effects.sharpen > 0.02) {
    const amount = clamp(0.5 + effects.sharpen, 0.5, 2.5);
    parts.push(`unsharp=5:5:${amount.toFixed(2)}:5:5:0.0`);
  }
  if (effects.vignette > 0.02) {
    const angle = Math.PI / 5 + (1 - effects.vignette) * (Math.PI / 4);
    parts.push(`vignette=angle=${angle.toFixed(4)}:mode=backward`);
  }
  // Frame strobe: solid flash colour 1 frame every N frames (`n` = frame index).
  const strobe = Math.round(effects.strobeFrames);
  if (strobe > 0) {
    const color = effects.strobeColor.replace("#", "");
    parts.push(
      `drawbox=x=0:y=0:w=iw:h=ih:color=${color}@1:t=fill:enable='eq(mod(n\\,${strobe})\\,${strobe - 1})'`,
    );
  }

  const dur = Math.max(0.01, clipDurationSec);
  const fadeIn = Math.min(effects.fadeInSec, dur);
  if (fadeIn > 0.001) {
    parts.push(
      `fade=t=in:st=${delay.toFixed(3)}:d=${fadeIn.toFixed(3)}:alpha=1`,
    );
  }
  const fadeOut = Math.min(effects.fadeOutSec, dur);
  if (fadeOut > 0.001) {
    const st = delay + Math.max(0, dur - fadeOut);
    parts.push(`fade=t=out:st=${st.toFixed(3)}:d=${fadeOut.toFixed(3)}:alpha=1`);
  }

  return parts.join(",");
}

/**
 * Sepia, hue shift, and tint wash. Single-input so it drops into the existing
 * comma chain. Tint matches preview blend modes via `geq`.
 */
export function ffmpegColorGradeChain(effects: ClipEffects): string {
  const parts: string[] = [];
  if (effects.sepia > 0.02) {
    const t = clamp(effects.sepia, 0, 1);
    const mix = (identity: number, sepia: number) =>
      (identity * (1 - t) + sepia * t).toFixed(3);
    parts.push(
      `colorchannelmixer=rr=${mix(1, 0.393)}:rg=${mix(0, 0.769)}:rb=${mix(0, 0.189)}:gr=${mix(0, 0.349)}:gg=${mix(1, 0.686)}:gb=${mix(0, 0.168)}:br=${mix(0, 0.272)}:bg=${mix(0, 0.534)}:bb=${mix(1, 0.131)}`,
    );
  }
  if (Math.abs(effects.hueRotate) > 0.5) {
    parts.push(`hue=h=${clamp(effects.hueRotate, -180, 180).toFixed(1)}`);
  }
  const tint = ffmpegTintGeq(effects);
  if (tint) parts.push(tint);
  return parts.join(",");
}

/**
 * Full-frame color plate for a filter-track overlay. Alpha is the wash amount.
 * Empty when the wash is off.
 */
export function ffmpegWashPlate(
  effects: ClipEffects,
  width: number,
  height: number,
  durationSec: number,
  fps: number,
): string {
  if (effects.tintAmount < 0.02) return "";
  const alpha = Math.round(clamp(effects.tintAmount, 0, 1) * 255);
  const dur = Math.max(0.01, durationSec);
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const expr = (channel: "r" | "g" | "b") => escapeCommas(washSourceExpr(effects, channel));
  return `color=c=black:s=${Math.max(2, Math.round(width))}x${Math.max(2, Math.round(height))}:r=${rate}:d=${dur.toFixed(3)},format=rgba,geq=r='${expr("r")}':g='${expr("g")}':b='${expr("b")}':a='${alpha}'`;
}

function ffmpegTintGeq(effects: ClipEffects): string {
  if (effects.tintAmount < 0.02) return "";
  const amount = clamp(effects.tintAmount, 0, 1);
  const expr = (name: "r" | "g" | "b") =>
    escapeCommas(
      tintChannelExpr(washSourceExpr(effects, name), name, amount, effects.tintBlend),
    );
  return `geq=r='${expr("r")}':g='${expr("g")}':b='${expr("b")}':a='alpha(X\\,Y)'`;
}

/** Solid tint, or a top-to-bottom gradient sampled with `Y/H`. */
function washSourceExpr(effects: ClipEffects, channel: "r" | "g" | "b"): string {
  const stops = effects.tintGradient;
  if (stops.length >= 2) {
    return gradientChannelExpr(stops.map(hexToRgb), channel);
  }
  return hexToRgb(effects.tintColor)[channel].toFixed(2);
}

function gradientChannelExpr(
  stops: { r: number; g: number; b: number }[],
  channel: "r" | "g" | "b",
): string {
  const n = stops.length;
  const span = 1 / (n - 1);
  const t = "(Y/H)";
  let expr = stops[n - 1]![channel].toFixed(2);
  for (let i = n - 2; i >= 0; i--) {
    const t0 = (i * span).toFixed(4);
    const t1 = ((i + 1) * span).toFixed(4);
    const c0 = stops[i]![channel].toFixed(2);
    const c1 = stops[i + 1]![channel].toFixed(2);
    const lerp = `(${c0}+(${c1}-${c0})*((${t}-${t0})/${span.toFixed(4)}))`;
    expr = `if(lt(${t},${t1}),${lerp},${expr})`;
  }
  return expr;
}

/** Preview blend, evaluated in 0..255, then mixed by `amount`. */
function tintChannelExpr(
  cs: string,
  name: "r" | "g" | "b",
  amount: number,
  blend: TintBlend,
): string {
  const cb = `${name}(X,Y)`;
  const a = amount.toFixed(3);
  let blended: string;
  switch (blend) {
    case "normal":
      blended = `(${cs})`;
      break;
    case "multiply":
      blended = `(${cb})*(${cs})/255`;
      break;
    case "screen":
      blended = `255-(255-${cb})*(255-${cs})/255`;
      break;
    case "overlay":
      blended = `if(lt(${cb},128),2*(${cb})*(${cs})/255,255-2*(255-${cb})*(255-${cs})/255)`;
      break;
    default:
      blended = `((255-2*(${cs}))*(${cb})*(${cb})/65025+2*(${cs})*(${cb})/255)`;
  }
  return `clip((${cb})*(1-${a})+(${blended})*${a},0,255)`;
}

function escapeCommas(expr: string): string {
  return expr.replace(/,/g, "\\,");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function normalizeTintBlend(value: unknown): TintBlend {
  return TINT_BLENDS.includes(value as TintBlend) ? (value as TintBlend) : "soft-light";
}

function normalizeTintGradient(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const stops = value
    .slice(0, 6)
    .map((stop) => normalizeHexColor(stop, ""))
    .filter((stop) => stop.length === 7);
  return stops.length >= 2 ? stops : [];
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function near(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}
