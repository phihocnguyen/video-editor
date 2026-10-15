import type { Clip, ProjectDocument } from "./project";
import {
  getRampProfile,
  rampDurationTicks,
  sourceOffsetForTimelineOffset,
} from "./speedRamp";

function durationTicksOf(clip: Clip): number {
  const source = Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
  if (clip.speedRamp && getRampProfile(clip.speedRamp)) {
    return rampDurationTicks(clip.speedRamp, source);
  }
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, Math.round(source / speed));
}

/** Simple fade-family transitions between adjacent clips. */
export type TransitionType = "none" | "dissolve" | "fade" | "fadeWhite";

export interface ClipTransition {
  type: TransitionType;
  /** Transition length in ticks (1s = 1_000_000). */
  durationTicks: number;
}

export const DEFAULT_CLIP_TRANSITION: ClipTransition = {
  type: "none",
  /** 0.6s default — a bit longer reads smoother with eased opacity. */
  durationTicks: 600_000,
};

export type TransitionGroup = "cut" | "fade";

export interface TransitionDef {
  type: TransitionType;
  label: string;
  hint: string;
  group: TransitionGroup;
  /** FFmpeg xfade name (null = custom / hard cut). */
  xfade: string | null;
}

export const TRANSITION_DEFS: TransitionDef[] = [
  { type: "none", label: "Cut", hint: "Hard cut", group: "cut", xfade: null },
  { type: "dissolve", label: "Dissolve", hint: "Crossfade", group: "fade", xfade: "fade" },
  { type: "fade", label: "Fade", hint: "Through black", group: "fade", xfade: "fadeblack" },
  { type: "fadeWhite", label: "Fade trắng", hint: "Through white", group: "fade", xfade: "fadewhite" },
];

export const TRANSITION_OPTIONS: {
  type: TransitionType;
  label: string;
  hint: string;
}[] = TRANSITION_DEFS.map(({ type, label, hint }) => ({ type, label, hint }));

export const TRANSITION_GROUPS: { id: TransitionGroup; label: string }[] = [
  { id: "cut", label: "Cắt" },
  { id: "fade", label: "Mờ" },
];

export function transitionDef(type: TransitionType): TransitionDef {
  return TRANSITION_DEFS.find((d) => d.type === type) ?? TRANSITION_DEFS[0]!;
}

export function normalizeClipTransition(
  input?: Partial<ClipTransition> | null,
): ClipTransition {
  const type = isTransitionType(input?.type) ? input!.type! : "none";
  const durationTicks =
    typeof input?.durationTicks === "number" && Number.isFinite(input.durationTicks)
      ? Math.min(5_000_000, Math.max(100_000, Math.round(input.durationTicks)))
      : DEFAULT_CLIP_TRANSITION.durationTicks;
  return { type, durationTicks };
}

function isTransitionType(value: unknown): value is TransitionType {
  return TRANSITION_DEFS.some((d) => d.type === value);
}

export function transitionDurationSec(t: ClipTransition): number {
  if (t.type === "none") return 0;
  return Math.max(0.1, t.durationTicks / 1_000_000);
}

/** Half of the transition — used to center the effect on the cut. */
export function transitionHalfTicks(t: ClipTransition): number {
  if (t.type === "none") return 0;
  return Math.max(50_000, Math.round(t.durationTicks / 2));
}

export function transitionHalfSec(t: ClipTransition): number {
  return transitionHalfTicks(t) / 1_000_000;
}

/** Previous media/text visual clip on the same track (by timeline order). */
export function findPreviousClipOnTrack(
  project: ProjectDocument,
  clipId: string,
): Clip | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const ordered = project.clips
    .filter((c) => c.trackId === clip.trackId)
    .sort((a, b) => a.startTicks - b.startTicks || durationTicksOf(a) - durationTicksOf(b));
  const idx = ordered.findIndex((c) => c.id === clipId);
  if (idx <= 0) return null;
  return ordered[idx - 1] ?? null;
}

/** Next clip on the same track. */
export function findNextClipOnTrack(
  project: ProjectDocument,
  clipId: string,
): Clip | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const ordered = project.clips
    .filter((c) => c.trackId === clip.trackId)
    .sort((a, b) => a.startTicks - b.startTicks);
  const idx = ordered.findIndex((c) => c.id === clipId);
  if (idx < 0 || idx >= ordered.length - 1) return null;
  return ordered[idx + 1] ?? null;
}

/**
 * Transition is centered on the cut (clip start / diamond):
 * window [cut − D/2, cut + D/2], so at the marker progress ≈ 0.5 (mid-blend).
 */
export function incomingTransitionProgress(
  clip: Clip,
  playheadTicks: number,
): { progress: number; transition: ClipTransition } | null {
  const transition = normalizeClipTransition(clip.transitionIn);
  if (transition.type === "none") return null;
  const d = transition.durationTicks;
  const half = transitionHalfTicks(transition);
  const cut = clip.startTicks;
  const windowStart = cut - half;
  const windowEnd = cut + half;
  if (playheadTicks < windowStart || playheadTicks > windowEnd) return null;
  const progress = (playheadTicks - windowStart) / d;
  return { progress: Math.min(1, Math.max(0, progress)), transition };
}

/** Hermite smoothstep — removes the linear “steppy” look on dissolves. */
export function easeTransition(progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  return x * x * (3 - 2 * x);
}

/**
 * Opacity multipliers for prev/current during incoming transition on `current`.
 * `progress` 0 = only prev, 1 = only current (dissolve).
 */
export function transitionOpacityPair(
  type: TransitionType,
  progress: number,
): { prev: number; curr: number } {
  const p = Math.min(1, Math.max(0, progress));
  switch (type) {
    case "fade":
    case "fadeWhite": {
      if (p < 0.5) {
        const a = easeTransition(p * 2);
        return { prev: 1 - a, curr: 0 };
      }
      const a = easeTransition((p - 0.5) * 2);
      return { prev: 0, curr: a };
    }
    case "none":
      return { prev: 1, curr: 1 };
    default: {
      const a = easeTransition(p);
      return { prev: 1 - a, curr: a };
    }
  }
}

/** Preview visual for the incoming clip — opacity only (fade family). */
export function transitionPreview(
  type: TransitionType,
  progress: number,
): { opacity: number } {
  const p = Math.min(1, Math.max(0, progress));
  const { curr } = transitionOpacityPair(type, p);
  return { opacity: curr };
}

/**
 * Eased alpha fade-in (matches preview `easeTransition`) over [startSec, startSec+duration].
 * Stream PTS must start at 0 (`setpts=PTS-STARTPTS`).
 */
export function ffmpegSmoothFadeInAlpha(durationSec: number, startSec = 0): string {
  const d = Math.max(0.05, durationSec);
  const st = Math.max(0, startSec);
  const en = st + d;
  const p = clampedProgress("T", st, d);
  const a = `if(lt(T\\,${st.toFixed(3)})\\,0\\,if(gte(T\\,${en.toFixed(3)})\\,255\\,255*${eased01(p)}))`;
  return geqRgbAlpha(a);
}

/** Eased alpha fade-out starting at `startSec` for `durationSec`. */
export function ffmpegSmoothFadeOutAlpha(startSec: number, durationSec: number): string {
  const d = Math.max(0.05, durationSec);
  const st = Math.max(0, startSec);
  const en = st + d;
  const p = clampedProgress("T", st, d);
  const a = `if(lt(T\\,${st.toFixed(3)})\\,255\\,if(gte(T\\,${en.toFixed(3)})\\,0\\,255*(1-${eased01(p)})))`;
  return geqRgbAlpha(a);
}

/**
 * Media timeline → source seconds.
 * Incoming transition pre-rolls by D/2 so the cut lands mid-transition
 * without rewinding after the diamond.
 */
export function transitionAwareMediaTimeSec(
  clip: Clip,
  playheadTicks: number,
): number {
  const sourceIn = clip.sourceInTicks / 1_000_000;
  const sourceOut = clip.sourceOutTicks / 1_000_000;
  const end = clip.startTicks + durationTicksOf(clip);
  // Hold last frame while outgoing clip is extended past its end (centered tx).
  if (playheadTicks >= end) {
    return Math.max(0, sourceOut - 0.01);
  }
  const tin = normalizeClipTransition(clip.transitionIn);
  const halfTicks =
    tin.type === "none"
      ? 0
      : Math.min(transitionHalfTicks(tin), Math.max(0, durationTicksOf(clip) - 100_000));
  const extendedStart = clip.startTicks - halfTicks;
  const localOffsetTicks = Math.max(0, playheadTicks - extendedStart);

  // Ramp-aware: integrate 1/v across the source range instead of scaling by a
  // constant speed, so slow/fast sections resolve to the right source frame.
  if (clip.speedRamp && getRampProfile(clip.speedRamp)) {
    const span = Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
    const sourceOffsetTicks = sourceOffsetForTimelineOffset(
      clip.speedRamp,
      span,
      localOffsetTicks,
    );
    const t = sourceIn + sourceOffsetTicks / 1_000_000;
    return Math.min(Math.max(0, t), Math.max(0, sourceOut - 0.01));
  }

  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const localFromExtended = localOffsetTicks / 1_000_000;
  const t = sourceIn + localFromExtended * speed;
  return Math.min(Math.max(0, t), Math.max(0, sourceOut - 0.01));
}

/** Playback speed multiplier at an absolute timeline tick (ramp-aware). */
export function mediaSpeedAtTimelineTicks(clip: Clip, playheadTicks: number): number {
  if (clip.speedRamp) {
    const profile = getRampProfile(clip.speedRamp);
    if (profile) {
      const span = Math.max(1, clip.sourceOutTicks - clip.sourceInTicks);
      const local = Math.max(
        0,
        Math.min(durationTicksOf(clip), playheadTicks - clip.startTicks),
      );
      const progress = Math.min(
        1,
        Math.max(0, profile.progressAtIntegralFactor(local / span)),
      );
      return profile.speedAtProgress(progress);
    }
  }
  return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

/**
 * Visible if inside nominal range, early half of an incoming transition,
 * or while held as the outgoing side of the *next* clip's centered transition.
 *
 * The cut is always `next.startTicks` (diamond), not necessarily this clip's end
 * — that keeps preview aligned when clips have a small gap/overlap.
 */
export function clipVisibleWithTransition(
  clip: Clip,
  playheadTicks: number,
  project?: ProjectDocument,
): boolean {
  const end = clip.startTicks + durationTicksOf(clip);
  const tin = normalizeClipTransition(clip.transitionIn);
  const early =
    tin.type !== "none"
      ? Math.min(transitionHalfTicks(tin), durationTicksOf(clip))
      : 0;
  if (playheadTicks >= clip.startTicks - early && playheadTicks < end) {
    return true;
  }
  if (!project) return playheadTicks === end;
  const next = findNextClipOnTrack(project, clip.id);
  if (!next) return false;
  const nextTin = normalizeClipTransition(next.transitionIn);
  if (nextTin.type === "none") return false;
  const half = transitionHalfTicks(nextTin);
  const cut = next.startTicks;
  // Outgoing hold for the full centered window, but only after this clip ended.
  return (
    playheadTicks >= end &&
    playheadTicks >= cut - half &&
    playheadTicks <= cut + half
  );
}

/** True when playhead is inside any centered transition window on the project. */
export function playheadInTransitionWindow(
  project: ProjectDocument,
  playheadTicks: number,
): boolean {
  for (const clip of project.clips) {
    if (clip.kind !== "media" && clip.kind !== "text") continue;
    if (incomingTransitionProgress(clip, playheadTicks)) return true;
  }
  return false;
}

/**
 * Pass RGB through; rewrite alpha only.
 * Commas inside expressions must be `\,` or filter_complex splits the graph.
 */
function geqRgbAlpha(alphaExpr: string): string {
  return `geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${alphaExpr}'`;
}

/** Hermite smoothstep in an FFmpeg expression, given a 0..1 progress term `pExpr`. */
function eased01(pExpr: string): string {
  return `(${pExpr})*(${pExpr})*(3-2*(${pExpr}))`;
}

function clampedProgress(tExpr: string, startSec: number, durationSec: number): string {
  const st = startSec.toFixed(3);
  const d = durationSec.toFixed(3);
  return `min(1\\,max(0\\,((${tExpr})-${st})/${d}))`;
}
