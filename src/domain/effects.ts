/** Per-clip visual effects (preview CSS + FFmpeg export). */

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
  return parts.join(" ");
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

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function near(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}
