/**
 * Linear opacity / transform keyframes.
 *
 * Progress is clip timeline duration (0 = start, 1 = end), same as effect
 * keyframes, but values blend between points instead of holding. Before the
 * first point the base `clip.transform` value is used. A keyframed x/y axis is
 * absolute canvas pixels — callers must not treat 0,0 as canvas centre.
 */

import type { ClipTransform } from "./project";
import type { Tick } from "./time";

export type TransformParamKey =
  | "opacity"
  | "x"
  | "y"
  | "scaleX"
  | "scaleY"
  | "rotation";

export const TRANSFORM_PARAM_KEYS: TransformParamKey[] = [
  "opacity",
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
];

export const GEOMETRY_PARAM_KEYS: TransformParamKey[] = [
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
];

export interface TransformKeyframe {
  id: string;
  /** 0 = clip start, 1 = clip end (timeline). */
  atProgress: number;
  value: number;
}

export interface TransformParamTrack {
  param: TransformParamKey;
  points: TransformKeyframe[];
}

export interface TransformKeyframes {
  tracks: TransformParamTrack[];
}

const MIN_POINT_GAP = 0.008;
export const TRANSFORM_NEAR_PROGRESS = 0.02;

export function createTransformKeyframe(atProgress: number, value: number): TransformKeyframe {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tk-${Math.random().toString(36).slice(2)}`,
    atProgress: clamp01(atProgress),
    value,
  };
}

export function clampTransformParamValue(param: TransformParamKey, value: number): number {
  if (!Number.isFinite(value)) return defaultTransformParam(param);
  switch (param) {
    case "opacity":
      return clamp(value, 0, 1);
    case "scaleX":
    case "scaleY": {
      if (value === 0) return value < 0 ? -1 : 1;
      const sign = value < 0 ? -1 : 1;
      return sign * clamp(Math.abs(value), 0.02, 20);
    }
    case "rotation":
      return clamp(value, -3600, 3600);
    case "x":
    case "y":
      return clamp(value, -100000, 100000);
  }
}

function defaultTransformParam(param: TransformParamKey): number {
  if (param === "opacity" || param === "scaleX" || param === "scaleY") return 1;
  return 0;
}

export function normalizeTransformKeyframes(
  input?: TransformKeyframes | null,
): TransformKeyframes | null {
  if (!input?.tracks?.length) return null;
  const tracks: TransformParamTrack[] = [];
  for (const raw of input.tracks) {
    if (!raw || !TRANSFORM_PARAM_KEYS.includes(raw.param)) continue;
    const points = normalizePoints(raw.param, raw.points);
    if (points.length > 0) tracks.push({ param: raw.param, points });
  }
  return tracks.length > 0 ? { tracks } : null;
}

function normalizePoints(
  param: TransformParamKey,
  raw: TransformKeyframe[] | undefined,
): TransformKeyframe[] {
  if (!Array.isArray(raw)) return [];
  const sorted = raw
    .filter((p) => p && Number.isFinite(p.atProgress) && Number.isFinite(p.value))
    .map((p) => ({
      id: typeof p.id === "string" && p.id ? p.id : createTransformKeyframe(0, 0).id,
      atProgress: clamp01(p.atProgress),
      value: clampTransformParamValue(param, p.value),
    }))
    .sort((a, b) => a.atProgress - b.atProgress);
  const points: TransformKeyframe[] = [];
  for (const point of sorted) {
    const prev = points[points.length - 1];
    if (prev && point.atProgress - prev.atProgress < MIN_POINT_GAP) {
      points[points.length - 1] = point;
      continue;
    }
    points.push(point);
  }
  return points;
}

export function hasTransformKeyframes(
  kf: TransformKeyframes | null | undefined,
): boolean {
  return Boolean(normalizeTransformKeyframes(kf ?? null));
}

export function hasGeometryKeyframes(
  kf: TransformKeyframes | null | undefined,
): boolean {
  const normalized = normalizeTransformKeyframes(kf ?? null);
  if (!normalized) return false;
  return normalized.tracks.some((t) => GEOMETRY_PARAM_KEYS.includes(t.param));
}

export function paramHasTransformKeyframes(
  kf: TransformKeyframes | null | undefined,
  param: TransformParamKey,
): boolean {
  return Boolean(getTransformTrack(kf, param));
}

export function getTransformTrack(
  kf: TransformKeyframes | null | undefined,
  param: TransformParamKey,
): TransformParamTrack | null {
  const normalized = normalizeTransformKeyframes(kf ?? null);
  return normalized?.tracks.find((t) => t.param === param) ?? null;
}

/** Linear blend. Before the first point, `fallback` (the base transform). */
export function interpolateTransformParam(
  points: TransformKeyframe[],
  progress: number,
  fallback: number,
): number {
  if (!points.length) return fallback;
  const p = clamp01(progress);
  const first = points[0]!;
  if (p <= first.atProgress) {
    if (p === first.atProgress) return first.value;
    return fallback;
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (p >= a.atProgress && p <= b.atProgress) {
      const span = b.atProgress - a.atProgress;
      if (span <= 1e-9) return b.value;
      const t = (p - a.atProgress) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return points[points.length - 1]!.value;
}

export function readTransformParam(transform: ClipTransform, param: TransformParamKey): number {
  const value = transform[param];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : defaultTransformParam(param);
}

export function transformAtProgress(
  base: ClipTransform,
  keyframes: TransformKeyframes | null | undefined,
  progress: number,
): ClipTransform {
  const next: ClipTransform = { ...base };
  const kf = normalizeTransformKeyframes(keyframes ?? null);
  if (!kf) return next;
  for (const track of kf.tracks) {
    const fallback = readTransformParam(base, track.param);
    const value = interpolateTransformParam(track.points, progress, fallback);
    next[track.param] = clampTransformParamValue(track.param, value);
  }
  return next;
}

export function findTransformKeyframeNear(
  points: TransformKeyframe[],
  progress: number,
  eps = TRANSFORM_NEAR_PROGRESS,
): TransformKeyframe | null {
  const p = clamp01(progress);
  let best: TransformKeyframe | null = null;
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

export function upsertTransformKeyframe(
  kf: TransformKeyframes | null | undefined,
  param: TransformParamKey,
  atProgress: number,
  value: number,
): TransformKeyframes {
  const normalized = normalizeTransformKeyframes(kf ?? null);
  const tracks = normalized ? normalized.tracks.map((t) => ({ ...t, points: [...t.points] })) : [];
  const progress = clamp01(atProgress);
  const point = createTransformKeyframe(progress, clampTransformParamValue(param, value));
  const existing = tracks.find((t) => t.param === param);
  if (!existing) {
    tracks.push({ param, points: [point] });
  } else {
    const near = findTransformKeyframeNear(existing.points, progress);
    if (near) {
      existing.points = existing.points.map((p) =>
        p.id === near.id ? { ...p, atProgress: progress, value: point.value } : p,
      );
    } else {
      existing.points = [...existing.points, point];
    }
  }
  return normalizeTransformKeyframes({ tracks }) ?? { tracks: [] };
}

export function removeTransformKeyframeNear(
  kf: TransformKeyframes | null | undefined,
  param: TransformParamKey,
  atProgress: number,
): TransformKeyframes | null {
  const normalized = normalizeTransformKeyframes(kf ?? null);
  if (!normalized) return null;
  const tracks: TransformParamTrack[] = [];
  for (const track of normalized.tracks) {
    if (track.param !== param) {
      tracks.push(track);
      continue;
    }
    const near = findTransformKeyframeNear(track.points, atProgress);
    if (!near) {
      tracks.push(track);
      continue;
    }
    const points = track.points.filter((p) => p.id !== near.id);
    if (points.length > 0) tracks.push({ param, points });
  }
  return tracks.length > 0 ? { tracks } : null;
}

/** Remap keyframe progress when splitting a clip at `splitProgress`. */
export function sliceTransformKeyframes(
  kf: TransformKeyframes | null | undefined,
  from: number,
  to: number,
): TransformKeyframes | null {
  const normalized = normalizeTransformKeyframes(kf ?? null);
  if (!normalized) return null;
  const lo = clamp01(Math.min(from, to));
  const hi = clamp01(Math.max(from, to));
  const span = Math.max(1e-9, hi - lo);
  const tracks: TransformParamTrack[] = [];
  for (const track of normalized.tracks) {
    const points: TransformKeyframe[] = [];
    for (const p of track.points) {
      if (p.atProgress < lo - 1e-9 || p.atProgress > hi + 1e-9) continue;
      points.push(createTransformKeyframe((p.atProgress - lo) / span, p.value));
    }
    const startVal = interpolateTransformParam(track.points, lo, track.points[0]!.value);
    const endVal = interpolateTransformParam(track.points, hi, track.points[0]!.value);
    if (!points.some((p) => p.atProgress < 0.02)) {
      points.unshift(createTransformKeyframe(0, startVal));
    }
    if (!points.some((p) => p.atProgress > 0.98)) {
      points.push(createTransformKeyframe(1, endVal));
    }
    const cleaned = normalizePoints(track.param, points);
    if (cleaned.length > 0) tracks.push({ param: track.param, points: cleaned });
  }
  return tracks.length > 0 ? { tracks } : null;
}

export function cloneTransformKeyframes(
  kf: TransformKeyframes | null | undefined,
): TransformKeyframes | null {
  const normalized = normalizeTransformKeyframes(kf ?? null);
  if (!normalized) return null;
  return {
    tracks: normalized.tracks.map((t) => ({
      param: t.param,
      points: t.points.map((p) => ({ ...p })),
    })),
  };
}

export function progressFromTransformTicks(
  startTicks: Tick,
  durationTicks: Tick,
  playheadTicks: Tick,
): number {
  if (durationTicks <= 0) return 0;
  return clamp01((playheadTicks - startTicks) / durationTicks);
}

/**
 * Linear FFmpeg expression. Commas are escaped for filter_complex.
 * `timeVar` is `t` for scale/rotate/pad/drawtext and `T` for geq.
 * `tOrigin` is the timestamp of progress 0 (0 after setpts, timeline start for drawtext).
 */
export function ffmpegLinearExpr(
  points: TransformKeyframe[],
  clipDurationSec: number,
  beforeValue: number,
  tOrigin = 0,
  timeVar = "t",
): string | null {
  const dur = Math.max(0.01, clipDurationSec);
  const mapped = [...points]
    .filter((p) => p && Number.isFinite(p.atProgress) && Number.isFinite(p.value))
    .map((p) => ({
      t: tOrigin + clamp01(p.atProgress) * dur,
      v: p.value,
    }))
    .sort((a, b) => a.t - b.t);
  if (!mapped.length) return null;
  const n = (v: number) => v.toFixed(4);
  if (mapped.length === 1) {
    const only = mapped[0]!;
    if (Math.abs(beforeValue - only.v) < 1e-6) return n(only.v);
    return `if(lt(${timeVar}\\,${n(only.t)})\\,${n(beforeValue)}\\,${n(only.v)})`;
  }

  let expr = n(mapped[mapped.length - 1]!.v);
  for (let i = mapped.length - 2; i >= 0; i -= 1) {
    const a = mapped[i]!;
    const b = mapped[i + 1]!;
    const span = Math.max(0.0001, b.t - a.t);
    const blend = `${n(a.v)}+(${n(b.v)}-${n(a.v)})*(${timeVar}-${n(a.t)})/${n(span)}`;
    expr = `if(lt(${timeVar}\\,${n(b.t)})\\,${blend}\\,${expr})`;
  }
  const first = mapped[0]!;
  return `if(lt(${timeVar}\\,${n(first.t)})\\,${n(beforeValue)}\\,${expr})`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
