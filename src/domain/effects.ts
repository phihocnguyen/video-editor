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
    near(effects.fadeInSec, d.fadeInSec) &&
    near(effects.fadeOutSec, d.fadeOutSec)
  );
}

/** CSS filter string for preview layers (empty if neutral aside from fades). */
export function cssFilterFromEffects(effects: ClipEffects): string {
  const parts: string[] = [];
  if (!near(effects.brightness, 1)) parts.push(`brightness(${effects.brightness})`);
  if (!near(effects.contrast, 1)) parts.push(`contrast(${effects.contrast})`);
  if (!near(effects.saturation, 1)) parts.push(`saturate(${effects.saturation})`);
  if (effects.blur > 0.05) parts.push(`blur(${effects.blur.toFixed(1)}px)`);
  if (effects.grayscale) parts.push("grayscale(1)");
  return parts.join(" ");
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
