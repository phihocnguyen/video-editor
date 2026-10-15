/**
 * Speed ramp domain math.
 *
 * A ramp maps *source* progress s ∈ [0, 1] (sourceIn..sourceOut) to playback
 * speed v(s) > 0. Between anchors we use Premiere-style smoothstep Hermite
 * (zero end-tangents / auto-Bezier ease):
 *
 *     t' = t² (3 − 2t)
 *     v(t) = v₀ + (v₁ − v₀) t'
 *
 * so each ramp starts and ends flat (no corner jerk). Before the first anchor
 * we ease from default 1×; after the last we hold its speed.
 *
 * Timeline duration of a ramped clip is
 *
 *     T = span · ∫₀¹ ds / v(s)          (span = sourceOut − sourceIn, in ticks)
 *
 * Integral + inverse keep preview and FFmpeg `setpts` in lockstep.
 */

import type { Tick } from "./time";

export const MIN_RAMP_SPEED = 0.1;
/** Premiere-like ceiling — 8× was too extreme for editing. */
export const MAX_RAMP_SPEED = 3;

export interface SpeedPoint {
  id: string;
  /** Position along the source range, 0 (sourceIn) → 1 (sourceOut). */
  atProgress: number;
  /** Playback speed multiplier at this point. */
  speed: number;
}

export interface SpeedRamp {
  points: SpeedPoint[];
}

export function clampRampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_RAMP_SPEED, Math.max(MIN_RAMP_SPEED, speed));
}

export function createSpeedPoint(atProgress: number, speed: number): SpeedPoint {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sp-${Math.random().toString(36).slice(2)}`,
    atProgress: Math.min(1, Math.max(0, atProgress)),
    speed: clampRampSpeed(speed),
  };
}

/** Smallest allowed gap between two anchors, in progress units. */
const MIN_POINT_GAP = 0.005;

/**
 * Sort, clamp, and de-duplicate anchors. Does **not** invent clip-edge
 * endpoints — user anchors live between the first and last point. Playback
 * eases from 1× at progress 0 into the first anchor (Premiere-style), then
 * holds the last anchor’s speed after the final point (see RampProfile).
 * Returns null with fewer than 2 anchors (need a segment to form a curve).
 */
export function normalizeSpeedRamp(
  input: SpeedRamp | SpeedPoint[] | null | undefined,
): SpeedRamp | null {
  const raw = Array.isArray(input) ? input : input?.points;
  if (!raw || raw.length === 0) return null;

  const cleaned = raw
    .filter((p) => p && Number.isFinite(p.atProgress) && Number.isFinite(p.speed))
    .map((p) => ({
      id: p.id || createSpeedPoint(0, 1).id,
      atProgress: Math.min(1, Math.max(0, p.atProgress)),
      speed: clampRampSpeed(p.speed),
    }))
    .sort((a, b) => a.atProgress - b.atProgress);

  if (cleaned.length === 0) return null;

  // Drop anchors that crowd an earlier one (keep the first).
  const spaced: SpeedPoint[] = [];
  for (const point of cleaned) {
    const prev = spaced[spaced.length - 1];
    if (prev && point.atProgress - prev.atProgress < MIN_POINT_GAP) continue;
    spaced.push(point);
  }

  if (spaced.length < 2) return null;
  return { points: spaced };
}

/** Constant-speed Hermite segment (flat hold after the last user anchor). */
function constantSegment(x0: number, x1: number, speed: number): HermiteSegment {
  const width = Math.max(1e-9, x1 - x0);
  return { x0, x1, width, a: 0, b: 0, c: 0, d: clampRampSpeed(speed) };
}

/**
 * Smoothstep between two speeds (cubic Hermite with m₀ = m₁ = 0):
 *   t' = t²(3−2t),  v = v₀ + (v₁−v₀)t'
 * Same S-curve Premiere gets from auto-Bezier handles on a speed transition.
 */
function easeSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): HermiteSegment {
  const width = Math.max(1e-9, x1 - x0);
  const v0 = clampRampSpeed(y0);
  const v1 = clampRampSpeed(y1);
  // Power form of v₀ + (v₁−v₀)·t²(3−2t).
  return {
    x0,
    x1,
    width,
    a: 2 * v0 - 2 * v1,
    b: -3 * v0 + 3 * v1,
    c: 0,
    d: v0,
  };
}

/** True when every anchor sits at speed ≈ 1 (i.e. the ramp is a no-op). */
export function isFlatRamp(ramp: SpeedRamp | null | undefined): boolean {
  const normalized = normalizeSpeedRamp(ramp);
  if (!normalized) return true;
  return normalized.points.every((p) => Math.abs(p.speed - 1) < 0.001);
}

export function hasActiveRamp(ramp: SpeedRamp | null | undefined): boolean {
  return !isFlatRamp(ramp);
}

/* ------------------------------------------------------------------ spline */

interface HermiteSegment {
  x0: number;
  x1: number;
  width: number;
  /** Cubic coefficients in local t ∈ [0,1]: v(t) = a t³ + b t² + c t + d. */
  a: number;
  b: number;
  c: number;
  d: number;
}

function buildSegments(ramp: SpeedRamp): HermiteSegment[] {
  const pts = ramp.points;
  const segments: HermiteSegment[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    segments.push(
      easeSegment(
        pts[i].atProgress,
        pts[i].speed,
        pts[i + 1].atProgress,
        pts[i + 1].speed,
      ),
    );
  }
  return segments;
}

function evalSegment(seg: HermiteSegment, t: number): number {
  const v = ((seg.a * t + seg.b) * t + seg.c) * t + seg.d;
  return clampRampSpeed(v);
}

/* --------------------------------------------------------------- quadrature */

/**
 * 8-point Gauss–Legendre on [0, t]. Each ramp segment is smooth, so this
 * resolves the integral of 1/v to well below a millisecond of error per frame.
 */
const GL_X = [
  -0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498,
  0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363,
];
const GL_W = [
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362,
  0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
];

/** ∫₀ᵗ dτ / v(τ) for one segment (t ∈ [0,1]). */
function integrateSegment(seg: HermiteSegment, t: number): number {
  if (t <= 0) return 0;
  const half = t / 2;
  let sum = 0;
  for (let i = 0; i < GL_X.length; i += 1) {
    const tau = half * (GL_X[i] + 1);
    sum += GL_W[i] / evalSegment(seg, tau);
  }
  return half * sum;
}

/* ----------------------------------------------------------------- profile */

export class RampProfile {
  readonly ramp: SpeedRamp;
  /** Full [0,1] coverage: ease-in from 1× + user Hermite + trail hold. */
  private readonly segments: HermiteSegment[];
  /** Cumulative ∫₀^x ds/v(s) at each segment boundary (covers full [0,1]). */
  private readonly cumulative: number[];

  constructor(ramp: SpeedRamp) {
    this.ramp = ramp;
    const lo = ramp.points[0].atProgress;
    const hi = ramp.points[ramp.points.length - 1].atProgress;
    const leadSpeed = clampRampSpeed(ramp.points[0].speed);
    const trailSpeed = clampRampSpeed(ramp.points[ramp.points.length - 1].speed);
    const segments: HermiteSegment[] = [];
    // Premiere: before the first keyframe, ease from default 1× — not a hard step.
    if (lo > 0) segments.push(easeSegment(0, 1, lo, leadSpeed));
    segments.push(...buildSegments(ramp));
    if (hi < 1) segments.push(constantSegment(hi, 1, trailSpeed));
    this.segments = segments;
    this.cumulative = [0];
    for (const seg of this.segments) {
      const prev = this.cumulative[this.cumulative.length - 1];
      this.cumulative.push(prev + seg.width * integrateSegment(seg, 1));
    }
  }

  /** Dimensionless ∫₀¹ ds/v(s): timeline duration = sourceSpan · durationFactor. */
  get durationFactor(): number {
    return this.cumulative[this.cumulative.length - 1] || 1;
  }

  get averageSpeed(): number {
    const f = this.durationFactor;
    return f > 0 ? 1 / f : 1;
  }

  speedAtProgress(progress: number): number {
    const p = Math.min(1, Math.max(0, progress));
    const last = this.segments.length - 1;
    for (let i = 0; i < this.segments.length; i += 1) {
      const seg = this.segments[i];
      if (p <= seg.x1 || i === last) {
        const t = (p - seg.x0) / seg.width;
        return evalSegment(seg, Math.min(1, Math.max(0, t)));
      }
    }
    return this.ramp.points[this.ramp.points.length - 1]?.speed ?? 1;
  }

  /** ∫₀^p ds/v(s) — monotone increasing, dimensionless. */
  integralFactor(p: number): number {
    const clamped = Math.min(1, Math.max(0, p));
    const idx = this.segmentIndexAt(clamped);
    if (idx < 0) return this.durationFactor;
    const seg = this.segments[idx];
    const base = this.cumulative[idx];
    const t = (clamped - seg.x0) / seg.width;
    return base + seg.width * integrateSegment(seg, Math.min(1, Math.max(0, t)));
  }

  /** Inverse of integralFactor: progress p with ∫₀^p = factor. */
  progressAtIntegralFactor(factor: number): number {
    const total = this.durationFactor;
    if (factor <= 0) return 0;
    if (factor >= total) return 1;

    let idx = 0;
    for (let i = 0; i < this.segments.length; i += 1) {
      if (this.cumulative[i + 1] >= factor) {
        idx = i;
        break;
      }
    }
    const seg = this.segments[idx];
    const targetLocal = (factor - this.cumulative[idx]) / seg.width;
    if (targetLocal <= 0) return seg.x0;
    const full = integrateSegment(seg, 1);
    if (targetLocal >= full) return seg.x1;

    // Bisection (guaranteed, monotone) then a few Newton refinements.
    let lo = 0;
    let hi = 1;
    let t = 0.5;
    for (let i = 0; i < 26; i += 1) {
      const value = integrateSegment(seg, t);
      if (value < targetLocal) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    for (let i = 0; i < 5; i += 1) {
      const value = integrateSegment(seg, t) - targetLocal;
      const deriv = 1 / evalSegment(seg, t);
      if (!(deriv > 0)) break;
      const next = t - value / deriv;
      if (!Number.isFinite(next) || next < 0 || next > 1) break;
      if (Math.abs(next - t) < 1e-12) {
        t = next;
        break;
      }
      t = next;
    }
    return seg.x0 + seg.width * Math.min(1, Math.max(0, t));
  }

  private segmentIndexAt(progress: number): number {
    const last = this.segments.length - 1;
    for (let i = 0; i < this.segments.length; i += 1) {
      if (progress < this.segments[i].x1 || i === last) return i;
    }
    return last;
  }
}

/* Profile cache keyed by ramp object identity — ramps are immutable once stored. */
const profileCache = new WeakMap<SpeedRamp, RampProfile>();

export function getRampProfile(ramp: SpeedRamp | null | undefined): RampProfile | null {
  if (!ramp) return null;
  const normalized = normalizeSpeedRamp(ramp);
  if (!normalized) return null;
  const cached = profileCache.get(normalized);
  if (cached) return cached;
  const profile = new RampProfile(normalized);
  profileCache.set(normalized, profile);
  return profile;
}

/* ------------------------------------------------------------ clip mapping */

/** Timeline duration (ticks) of a source span under a ramp. */
export function rampDurationTicks(ramp: SpeedRamp, sourceSpanTicks: Tick): Tick {
  const profile = getRampProfile(ramp);
  if (!profile) return Math.max(0, Math.round(sourceSpanTicks));
  return Math.max(0, Math.round(sourceSpanTicks * profile.durationFactor));
}

/** Local timeline offset (ticks from clip start) → source offset (ticks from sourceIn). */
export function sourceOffsetForTimelineOffset(
  ramp: SpeedRamp,
  sourceSpanTicks: Tick,
  timelineOffsetTicks: number,
): number {
  if (sourceSpanTicks <= 0) return 0;
  const profile = getRampProfile(ramp);
  if (!profile) {
    return Math.min(sourceSpanTicks, Math.max(0, timelineOffsetTicks));
  }
  const total = sourceSpanTicks * profile.durationFactor;
  if (timelineOffsetTicks <= 0) return 0;
  if (timelineOffsetTicks >= total) return sourceSpanTicks;
  const factor = timelineOffsetTicks / sourceSpanTicks;
  return profile.progressAtIntegralFactor(factor) * sourceSpanTicks;
}

/** Source offset (ticks from sourceIn) → local timeline offset (ticks from clip start). */
export function timelineOffsetForSourceOffset(
  ramp: SpeedRamp,
  sourceSpanTicks: Tick,
  sourceOffsetTicks: number,
): number {
  if (sourceSpanTicks <= 0) return 0;
  const profile = getRampProfile(ramp);
  if (!profile) return Math.max(0, sourceOffsetTicks);
  const progress = Math.min(1, Math.max(0, sourceOffsetTicks / sourceSpanTicks));
  return sourceSpanTicks * profile.integralFactor(progress);
}

/** Playback speed at a source offset (ticks from sourceIn). */
export function speedAtSourceOffset(
  ramp: SpeedRamp,
  sourceSpanTicks: Tick,
  sourceOffsetTicks: number,
): number {
  const profile = getRampProfile(ramp);
  if (!profile || sourceSpanTicks <= 0) return 1;
  const progress = Math.min(1, Math.max(0, sourceOffsetTicks / sourceSpanTicks));
  return profile.speedAtProgress(progress);
}

/** Speed at an absolute source tick position. */
export function speedAtSourceTime(
  ramp: SpeedRamp,
  sourceSpanTicks: Tick,
  sourceInTicks: Tick,
  sourceTicks: number,
): number {
  return speedAtSourceOffset(ramp, sourceSpanTicks, sourceTicks - sourceInTicks);
}

/**
 * Copy a ramp onto a sub-range [fromProgress, toProgress] of the source, used
 * when splitting a ramped clip so both halves keep a continuous curve.
 *
 * The original curve is *resampled* (interior anchors plus midpoints) rather
 * than just clamped, so the cubic bend survives the split instead of collapsing
 * to a straight line.
 */
export function sliceRamp(
  ramp: SpeedRamp,
  fromProgress: number,
  toProgress: number,
): SpeedRamp | null {
  const normalized = normalizeSpeedRamp(ramp);
  if (!normalized) return null;
  const from = Math.min(fromProgress, toProgress);
  const to = Math.max(fromProgress, toProgress);
  const span = Math.max(1e-6, to - from);
  const profile = getRampProfile(normalized)!;

  // Candidate sample positions: slice edges + every original anchor inside.
  const positions = new Set<number>([from, to]);
  for (const p of normalized.points) {
    if (p.atProgress > from + 1e-6 && p.atProgress < to - 1e-6) {
      positions.add(p.atProgress);
    }
  }
  // Uniform densification so the cubic curvature (and its integral) survives,
  // capped so a split doesn't leave the user with a dozen stray anchors.
  const intervals = Math.max(3, Math.min(6, Math.ceil(span * 12)));
  for (let i = 1; i < intervals; i += 1) {
    positions.add(from + (span * i) / intervals);
  }

  const points = [...positions]
    .sort((a, b) => a - b)
    .map((p) => createSpeedPoint((p - from) / span, profile.speedAtProgress(p)));
  return normalizeSpeedRamp(points);
}

/** Compact human label for a ramp badge (e.g. "0.5–2.0×"). */
export function rampSpeedRangeLabel(ramp: SpeedRamp | null | undefined): string | null {
  const normalized = normalizeSpeedRamp(ramp);
  if (!normalized) return null;
  const speeds = normalized.points.map((p) => p.speed);
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const fmt = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
  return min === max ? `${fmt(min)}×` : `${fmt(min)}–${fmt(max)}×`;
}

/* --------------------------------------------------- export expression map */

export interface RampExprSegment {
  /** Upper bound of the local source offset (seconds) covered by this segment. */
  uEnd: number;
  /** Lower bound of the local source offset (seconds). */
  uStart: number;
  /** Accumulated timeline offset (seconds) at `uStart`. */
  tStart: number;
  /** Linear coefficient: G(u) = tStart + a·(u−uStart) + b·(u−uStart)². */
  a: number;
  /** Quadratic coefficient. */
  b: number;
}

/**
 * Discretise the integral mapping u → T(u) = ∫₀ᵘ dτ/v(τ) into piecewise
 * quadratics. Within a segment we approximate 1/v as linear in the local time,
 * whose integral is an exact quadratic — directly expressible in FFmpeg's
 * `setpts` expression language (no loops, no `let`), keeping the exported curve
 * aligned with the preview's analytic integral.
 */
export function rampTimeMapSegments(
  ramp: SpeedRamp,
  sourceSpanSec: number,
  segmentCount = 16,
): RampExprSegment[] {
  const profile = getRampProfile(ramp);
  const span = Math.max(1e-6, sourceSpanSec);
  const n = Math.max(2, Math.min(64, Math.round(segmentCount)));
  const segments: RampExprSegment[] = [];

  const wAt = (s: number) => 1 / Math.max(1e-6, profile ? profile.speedAtProgress(s) : 1);

  let tStart = 0;
  for (let j = 0; j < n; j += 1) {
    const s0 = j / n;
    const s1 = (j + 1) / n;
    const uStart = s0 * span;
    const uEnd = s1 * span;
    const hU = Math.max(1e-9, uEnd - uStart);
    const w0 = wAt(s0);
    const w1 = wAt(s1);
    segments.push({
      uStart,
      uEnd,
      tStart,
      a: w0,
      b: (w1 - w0) / (2 * hU),
    });
    // ∫ over the segment ≈ h·(w0 + w1)/2 (trapezoid = exact for linear 1/v).
    tStart += hU * ((w0 + w1) / 2);
  }
  // Anchor the accumulated duration to the analytic integral for exactness.
  const analytic = span * (profile ? profile.durationFactor : 1);
  const scale = tStart > 0 ? analytic / tStart : 1;
  for (const seg of segments) {
    seg.a *= scale;
    seg.b *= scale;
    seg.tStart *= scale;
  }
  return segments;
}

/** Total output duration (seconds) for a ramped source span. */
export function rampOutputDurationSec(
  ramp: SpeedRamp,
  sourceSpanSec: number,
): number {
  const profile = getRampProfile(ramp);
  if (!profile) return sourceSpanSec;
  return sourceSpanSec * profile.durationFactor;
}
