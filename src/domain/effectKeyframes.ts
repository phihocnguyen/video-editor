/**
 * CapCut-style per-parameter effect keyframes.
 *
 * Progress is along the clip's *timeline* duration (0 = clip start, 1 = clip end),
 * matching playhead-relative editing. Base `clip.effects` values apply when a
 * parameter has no keyframe track; otherwise CapCut-style hold (step): each
 * keyframe's value applies from that point until the next keyframe.
 */

import {
  DEFAULT_CLIP_EFFECTS,
  ffmpegVideoEffectsChain,
  normalizeClipEffects,
  type ClipEffects,
} from "./effects";
import type { Tick } from "./time";

export type EffectParamKey =
  | "brightness"
  | "contrast"
  | "saturation"
  | "blur"
  | "vignette"
  | "sharpen"
  | "grayscale"
  | "strobeFrames";

export const EFFECT_PARAM_KEYS: EffectParamKey[] = [
  "brightness",
  "contrast",
  "saturation",
  "blur",
  "vignette",
  "sharpen",
  "grayscale",
  "strobeFrames",
];

/** Numeric params shown with ◇ in Adjustment (not fade in/out). */
export const KEYFRAMEABLE_STEPPER_PARAMS: EffectParamKey[] = [
  "brightness",
  "contrast",
  "saturation",
  "blur",
  "vignette",
  "sharpen",
  "strobeFrames",
];

export interface EffectKeyframe {
  id: string;
  /** 0 = clip start, 1 = clip end (timeline). */
  atProgress: number;
  value: number;
}

export interface EffectParamTrack {
  param: EffectParamKey;
  points: EffectKeyframe[];
}

export interface EffectKeyframes {
  tracks: EffectParamTrack[];
}

const MIN_POINT_GAP = 0.008;
const NEAR_PROGRESS = 0.02;

export function createEffectKeyframe(atProgress: number, value: number): EffectKeyframe {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ek-${Math.random().toString(36).slice(2)}`,
    atProgress: clamp01(atProgress),
    value,
  };
}

export function clampEffectParamValue(param: EffectParamKey, value: number): number {
  if (!Number.isFinite(value)) return baseDefault(param);
  switch (param) {
    case "brightness":
    case "contrast":
      return clamp(value, 0, 2);
    case "saturation":
      return clamp(value, 0, 3);
    case "blur":
      return clamp(value, 0, 40);
    case "vignette":
      return clamp(value, 0, 1);
    case "sharpen":
      return clamp(value, 0, 2);
    case "grayscale":
      return value >= 0.5 ? 1 : 0;
    case "strobeFrames":
      return Math.round(clamp(value, 0, 60));
  }
}

function baseDefault(param: EffectParamKey): number {
  const d = DEFAULT_CLIP_EFFECTS;
  if (param === "grayscale") return d.grayscale ? 1 : 0;
  return d[param];
}

export function normalizeEffectKeyframes(
  input?: EffectKeyframes | null,
): EffectKeyframes | null {
  if (!input?.tracks?.length) return null;
  const tracks: EffectParamTrack[] = [];
  for (const raw of input.tracks) {
    if (!raw || !EFFECT_PARAM_KEYS.includes(raw.param)) continue;
    const points = normalizePoints(raw.param, raw.points);
    if (points.length > 0) tracks.push({ param: raw.param, points });
  }
  return tracks.length > 0 ? { tracks } : null;
}

function normalizePoints(
  param: EffectParamKey,
  raw: EffectKeyframe[] | undefined,
): EffectKeyframe[] {
  if (!raw?.length) return [];
  const cleaned = raw
    .filter((p) => p && Number.isFinite(p.atProgress) && Number.isFinite(p.value))
    .map((p) => ({
      id: p.id || createEffectKeyframe(0, 0).id,
      atProgress: clamp01(p.atProgress),
      value: clampEffectParamValue(param, p.value),
    }))
    .sort((a, b) => a.atProgress - b.atProgress);

  const spaced: EffectKeyframe[] = [];
  for (const point of cleaned) {
    const prev = spaced[spaced.length - 1];
    if (prev && point.atProgress - prev.atProgress < MIN_POINT_GAP) {
      spaced[spaced.length - 1] = point;
      continue;
    }
    spaced.push(point);
  }
  return spaced;
}

export function hasEffectKeyframes(kf: EffectKeyframes | null | undefined): boolean {
  return Boolean(normalizeEffectKeyframes(kf ?? null));
}

export function getParamTrack(
  kf: EffectKeyframes | null | undefined,
  param: EffectParamKey,
): EffectParamTrack | null {
  const normalized = normalizeEffectKeyframes(kf ?? null);
  if (!normalized) return null;
  return normalized.tracks.find((t) => t.param === param) ?? null;
}

export function paramHasKeyframes(
  kf: EffectKeyframes | null | undefined,
  param: EffectParamKey,
): boolean {
  return Boolean(getParamTrack(kf, param)?.points.length);
}

/** Progress of playhead within a clip's timeline span (0..1). */
export function progressFromTicks(
  startTicks: Tick,
  durationTicks: Tick,
  playheadTicks: Tick,
): number {
  const dur = Math.max(1, durationTicks);
  return clamp01((playheadTicks - startTicks) / dur);
}

/**
 * CapCut hold (step) interpolation.
 * - Before the first keyframe → `fallback` (base effect; effect not yet applied)
 * - From a keyframe until the next → that keyframe's value
 */
export function interpolateParam(
  points: EffectKeyframe[],
  progress: number,
  fallback: number,
): number {
  if (!points.length) return fallback;
  const p = clamp01(progress);
  const first = points[0]!;
  if (p < first.atProgress) return fallback;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (p >= points[i]!.atProgress) return points[i]!.value;
  }
  return fallback;
}

export function readBaseParam(effects: ClipEffects, param: EffectParamKey): number {
  const e = normalizeClipEffects(effects);
  if (param === "grayscale") return e.grayscale ? 1 : 0;
  return e[param];
}

export function writeBaseParam(
  _effects: ClipEffects,
  param: EffectParamKey,
  value: number,
): Partial<ClipEffects> {
  const v = clampEffectParamValue(param, value);
  if (param === "grayscale") return { grayscale: v >= 0.5 };
  return { [param]: v } as Partial<ClipEffects>;
}

/** Resolve full effects at a clip-local progress (0..1). */
export function effectsAtProgress(
  base: ClipEffects | null | undefined,
  keyframes: EffectKeyframes | null | undefined,
  progress: number,
): ClipEffects {
  const effects = normalizeClipEffects(base);
  const kf = normalizeEffectKeyframes(keyframes ?? null);
  if (!kf) return effects;

  const next = { ...effects };
  for (const track of kf.tracks) {
    const fallback = readBaseParam(effects, track.param);
    const value = interpolateParam(track.points, progress, fallback);
    if (track.param === "grayscale") {
      next.grayscale = value >= 0.5;
    } else if (track.param === "brightness") {
      next.brightness = clampEffectParamValue(track.param, value);
    } else if (track.param === "contrast") {
      next.contrast = clampEffectParamValue(track.param, value);
    } else if (track.param === "saturation") {
      next.saturation = clampEffectParamValue(track.param, value);
    } else if (track.param === "blur") {
      next.blur = clampEffectParamValue(track.param, value);
    } else if (track.param === "vignette") {
      next.vignette = clampEffectParamValue(track.param, value);
    } else if (track.param === "sharpen") {
      next.sharpen = clampEffectParamValue(track.param, value);
    } else if (track.param === "strobeFrames") {
      next.strobeFrames = clampEffectParamValue(track.param, value);
    }
  }
  return next;
}

export function findKeyframeNear(
  points: EffectKeyframe[],
  progress: number,
  eps = NEAR_PROGRESS,
): EffectKeyframe | null {
  const p = clamp01(progress);
  let best: EffectKeyframe | null = null;
  let bestDist = eps;
  for (const point of points) {
    const d = Math.abs(point.atProgress - p);
    if (d <= bestDist) {
      best = point;
      bestDist = d;
    }
  }
  return best;
}

export function upsertParamKeyframe(
  kf: EffectKeyframes | null | undefined,
  param: EffectParamKey,
  atProgress: number,
  value: number,
): EffectKeyframes {
  const normalized = normalizeEffectKeyframes(kf ?? null);
  const tracks = normalized ? [...normalized.tracks] : [];
  const idx = tracks.findIndex((t) => t.param === param);
  const existing = idx >= 0 ? tracks[idx]!.points : [];
  const near = findKeyframeNear(existing, atProgress);
  const nextPoint = createEffectKeyframe(
    near ? near.atProgress : atProgress,
    clampEffectParamValue(param, value),
  );
  if (near) nextPoint.id = near.id;

  const points = near
    ? existing.map((p) => (p.id === near.id ? nextPoint : p))
    : normalizePoints(param, [...existing, nextPoint]);

  const track: EffectParamTrack = { param, points };
  if (idx >= 0) tracks[idx] = track;
  else tracks.push(track);
  return normalizeEffectKeyframes({ tracks }) ?? { tracks: [track] };
}

export function removeParamKeyframeNear(
  kf: EffectKeyframes | null | undefined,
  param: EffectParamKey,
  atProgress: number,
): EffectKeyframes | null {
  const normalized = normalizeEffectKeyframes(kf ?? null);
  if (!normalized) return null;
  const tracks: EffectParamTrack[] = [];
  for (const track of normalized.tracks) {
    if (track.param !== param) {
      tracks.push(track);
      continue;
    }
    const near = findKeyframeNear(track.points, atProgress);
    if (!near) {
      tracks.push(track);
      continue;
    }
    const points = track.points.filter((p) => p.id !== near.id);
    if (points.length > 0) tracks.push({ param, points });
  }
  return tracks.length > 0 ? { tracks } : null;
}

export function clearParamKeyframes(
  kf: EffectKeyframes | null | undefined,
  param: EffectParamKey,
): EffectKeyframes | null {
  const normalized = normalizeEffectKeyframes(kf ?? null);
  if (!normalized) return null;
  const tracks = normalized.tracks.filter((t) => t.param !== param);
  return tracks.length > 0 ? { tracks } : null;
}

/** Remap keyframe progress when splitting a clip at `splitProgress`. */
export function sliceEffectKeyframes(
  kf: EffectKeyframes | null | undefined,
  from: number,
  to: number,
): EffectKeyframes | null {
  const normalized = normalizeEffectKeyframes(kf ?? null);
  if (!normalized) return null;
  const lo = clamp01(Math.min(from, to));
  const hi = clamp01(Math.max(from, to));
  const span = Math.max(1e-9, hi - lo);
  const tracks: EffectParamTrack[] = [];
  for (const track of normalized.tracks) {
    const points: EffectKeyframe[] = [];
    for (const p of track.points) {
      if (p.atProgress < lo - 1e-9 || p.atProgress > hi + 1e-9) continue;
      points.push(
        createEffectKeyframe((p.atProgress - lo) / span, p.value),
      );
    }
    // Ensure edge samples so the slice keeps the look at cut.
    const startVal = interpolateParam(track.points, lo, track.points[0]!.value);
    const endVal = interpolateParam(track.points, hi, track.points[0]!.value);
    if (!points.some((p) => p.atProgress < 0.02)) {
      points.unshift(createEffectKeyframe(0, startVal));
    }
    if (!points.some((p) => p.atProgress > 0.98)) {
      points.push(createEffectKeyframe(1, endVal));
    }
    const cleaned = normalizePoints(track.param, points);
    if (cleaned.length > 0) tracks.push({ param: track.param, points: cleaned });
  }
  return tracks.length > 0 ? { tracks } : null;
}

export function cloneEffectKeyframes(
  kf: EffectKeyframes | null | undefined,
): EffectKeyframes | null {
  const normalized = normalizeEffectKeyframes(kf ?? null);
  if (!normalized) return null;
  return {
    tracks: normalized.tracks.map((t) => ({
      param: t.param,
      points: t.points.map((p) => ({ ...p })),
    })),
  };
}

/**
 * Build an FFmpeg expression in `t` (seconds) for CapCut hold keyframes.
 * Commas are escaped for `filter_complex`. `t0` = time of progress 0.
 * Before the first keyframe the expression uses the first mapped value's
 * pre-roll via `beforeValue` (defaults to first keyframe value).
 */
export function ffmpegKeyframeExpr(
  points: EffectKeyframe[],
  clipDurationSec: number,
  t0: number,
  mapValue: (v: number) => number = (v) => v,
  beforeValue?: number,
): string | null {
  const dur = Math.max(0.01, clipDurationSec);
  const mapped = [...points]
    .filter((p) => p && Number.isFinite(p.atProgress) && Number.isFinite(p.value))
    .map((p) => ({
      t: t0 + clamp01(p.atProgress) * dur,
      v: mapValue(p.value),
    }))
    .sort((a, b) => a.t - b.t);
  if (!mapped.length) return null;
  if (mapped.length === 1) {
    const only = mapped[0]!;
    const before =
      beforeValue !== undefined ? mapValue(beforeValue) : only.v;
    if (Math.abs(before - only.v) < 1e-6) return only.v.toFixed(4);
    return `if(lt(t\\,${only.t.toFixed(4)})\\,${before.toFixed(4)}\\,${only.v.toFixed(4)})`;
  }

  const before =
    beforeValue !== undefined ? mapValue(beforeValue) : mapped[0]!.v;

  function build(i: number): string {
    if (i >= mapped.length - 1) return mapped[mapped.length - 1]!.v.toFixed(4);
    const a = mapped[i]!;
    const b = mapped[i + 1]!;
    const rest = build(i + 1);
    // Hold `a.v` until `b.t`, then continue.
    return `if(lt(t\\,${b.t.toFixed(4)})\\,${a.v.toFixed(4)}\\,${rest})`;
  }
  const fromFirst = build(0);
  const first = mapped[0]!;
  return `if(lt(t\\,${first.t.toFixed(4)})\\,${before.toFixed(4)}\\,${fromFirst})`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Hold-style on-ranges from keyframes for filters that cannot take exprs. */
export function steppedOnWindows(
  points: { atProgress: number; value: number }[],
  clipDurationSec: number,
  t0: number,
  threshold: number,
): { t0: number; t1: number; sigma: number }[] {
  const dur = Math.max(0.01, clipDurationSec);
  const sorted = [...points].sort((a, b) => a.atProgress - b.atProgress);
  if (!sorted.length) return [];
  const samples = sorted.map((p) => ({
    t: t0 + clamp01(p.atProgress) * dur,
    v: p.value,
  }));
  const edge = [
    { t: t0, v: samples[0]!.v },
    ...samples,
    { t: t0 + dur, v: samples[samples.length - 1]!.v },
  ];
  const windows: { t0: number; t1: number; sigma: number }[] = [];
  for (let i = 0; i < edge.length - 1; i += 1) {
    const a = edge[i]!;
    const b = edge[i + 1]!;
    if (a.v <= threshold) continue;
    const last = windows[windows.length - 1];
    if (last && Math.abs(last.sigma - a.v) < 0.05 && Math.abs(last.t1 - a.t) < 0.02) {
      last.t1 = b.t;
      continue;
    }
    windows.push({ t0: a.t, t1: b.t, sigma: a.v });
  }
  return windows;
}

/**
 * FFmpeg filter fragment with CapCut-style animated params when keyframes exist.
 * Falls back to static `ffmpegVideoEffectsChain` when there are no tracks.
 */
export function ffmpegVideoEffectsChainAnimated(
  effects: ClipEffects,
  clipDurationSec: number,
  options?: { delaySec?: number; keyframes?: EffectKeyframes | null },
): string {
  const kf = normalizeEffectKeyframes(options?.keyframes ?? null);
  if (!hasEffectKeyframes(kf)) {
    return ffmpegVideoEffectsChain(effects, clipDurationSec, {
      delaySec: options?.delaySec,
    });
  }

  const parts: string[] = [];
  const delay = Math.max(0, options?.delaySec ?? 0);
  const dur = Math.max(0.01, clipDurationSec);
  const e = normalizeClipEffects(effects);

  const brightTrack = getParamTrack(kf, "brightness");
  const contrastTrack = getParamTrack(kf, "contrast");
  const satTrack = getParamTrack(kf, "saturation");
  if (brightTrack || contrastTrack || satTrack) {
    const bExpr =
      brightTrack &&
      ffmpegKeyframeExpr(
        brightTrack.points,
        dur,
        delay,
        (v) => clamp(v - 1, -1, 1),
        e.brightness,
      );
    const cExpr =
      contrastTrack &&
      ffmpegKeyframeExpr(contrastTrack.points, dur, delay, (v) => v, e.contrast);
    const sExpr =
      satTrack &&
      ffmpegKeyframeExpr(satTrack.points, dur, delay, (v) => v, e.saturation);
    const b = bExpr ?? clamp(e.brightness - 1, -1, 1).toFixed(4);
    const c = cExpr ?? e.contrast.toFixed(4);
    const s = sExpr ?? e.saturation.toFixed(4);
    parts.push(`eq=brightness='${b}':contrast='${c}':saturation='${s}':eval=frame`);
  } else {
    const staticEq = ffmpegVideoEffectsChain(
      {
        ...e,
        blur: 0,
        grayscale: false,
        vignette: 0,
        sharpen: 0,
        strobeFrames: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
      },
      dur,
      { delaySec: delay },
    );
    if (staticEq) parts.push(staticEq);
  }

  const blurTrack = getParamTrack(kf, "blur");
  if (blurTrack && blurTrack.points.some((p) => p.value > 0.05)) {
    for (const w of steppedOnWindows(blurTrack.points, dur, delay, 0.05)) {
      parts.push(
        `gblur=sigma=${Math.min(40, w.sigma).toFixed(2)}:enable='between(t\\,${w.t0.toFixed(3)}\\,${w.t1.toFixed(3)})'`,
      );
    }
  } else if (e.blur > 0.05) {
    parts.push(`gblur=sigma=${Math.min(40, e.blur).toFixed(2)}`);
  }

  const grayTrack = getParamTrack(kf, "grayscale");
  if (grayTrack) {
    for (const w of steppedOnWindows(grayTrack.points, dur, delay, 0.5)) {
      parts.push(
        `hue=s=0:enable='between(t\\,${w.t0.toFixed(3)}\\,${w.t1.toFixed(3)})'`,
      );
    }
  } else if (e.grayscale) {
    parts.push("hue=s=0");
  }

  const sharpenTrack = getParamTrack(kf, "sharpen");
  if (sharpenTrack && sharpenTrack.points.some((p) => p.value > 0.02)) {
    for (const w of steppedOnWindows(sharpenTrack.points, dur, delay, 0.02)) {
      const amount = clamp(0.5 + w.sigma, 0.5, 2.5);
      parts.push(
        `unsharp=5:5:${amount.toFixed(2)}:5:5:0.0:enable='between(t\\,${w.t0.toFixed(3)}\\,${w.t1.toFixed(3)})'`,
      );
    }
  } else if (e.sharpen > 0.02) {
    const amount = clamp(0.5 + e.sharpen, 0.5, 2.5);
    parts.push(`unsharp=5:5:${amount.toFixed(2)}:5:5:0.0`);
  }

  const vigTrack = getParamTrack(kf, "vignette");
  if (vigTrack && vigTrack.points.some((p) => p.value > 0.02)) {
    for (const w of steppedOnWindows(vigTrack.points, dur, delay, 0.02)) {
      const angle = Math.PI / 5 + (1 - clamp(w.sigma, 0, 1)) * (Math.PI / 4);
      parts.push(
        `vignette=angle=${angle.toFixed(4)}:mode=backward:enable='between(t\\,${w.t0.toFixed(3)}\\,${w.t1.toFixed(3)})'`,
      );
    }
  } else if (e.vignette > 0.02) {
    const angle = Math.PI / 5 + (1 - e.vignette) * (Math.PI / 4);
    parts.push(`vignette=angle=${angle.toFixed(4)}:mode=backward`);
  }

  const color = e.strobeColor.replace("#", "");
  const strobeTrack = getParamTrack(kf, "strobeFrames");
  if (strobeTrack && strobeTrack.points.some((p) => p.value >= 0.5)) {
    for (const w of steppedOnWindows(strobeTrack.points, dur, delay, 0.5)) {
      const period = Math.max(1, Math.round(w.sigma));
      parts.push(
        `drawbox=x=0:y=0:w=iw:h=ih:color=${color}@1:t=fill:enable='between(t\\,${w.t0.toFixed(3)}\\,${w.t1.toFixed(3)})*eq(mod(n\\,${period})\\,${period - 1})'`,
      );
    }
  } else if (Math.round(e.strobeFrames) > 0) {
    const strobe = Math.round(e.strobeFrames);
    parts.push(
      `drawbox=x=0:y=0:w=iw:h=ih:color=${color}@1:t=fill:enable='eq(mod(n\\,${strobe})\\,${strobe - 1})'`,
    );
  }

  const fadeIn = Math.min(e.fadeInSec, dur);
  if (fadeIn > 0.001) {
    parts.push(`fade=t=in:st=${delay.toFixed(3)}:d=${fadeIn.toFixed(3)}:alpha=1`);
  }
  const fadeOut = Math.min(e.fadeOutSec, dur);
  if (fadeOut > 0.001) {
    const st = delay + Math.max(0, dur - fadeOut);
    parts.push(`fade=t=out:st=${st.toFixed(3)}:d=${fadeOut.toFixed(3)}:alpha=1`);
  }

  return parts.join(",");
}
