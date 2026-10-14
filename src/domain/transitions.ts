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

export type TransitionType =
  | "none"
  // Fade group
  | "dissolve"
  | "fade"
  | "fadeWhite"
  // Wipe group
  | "wipeLeft"
  | "wipeRight"
  | "wipeUp"
  | "wipeDown"
  // Slide group
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  // Circle group
  | "circleOpen"
  | "circleClose"
  // Zoom group
  | "zoomIn"
  | "zoomOut"
  // Blur group
  | "blurDissolve"
  // Glitch group
  | "glitch"
  // Whip group
  | "whipPan";

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

/** Coarse preview/export family a transition belongs to. */
export type TransitionGroup =
  | "cut"
  | "fade"
  | "wipe"
  | "slide"
  | "circle"
  | "zoom"
  | "blur"
  | "glitch"
  | "whip";

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
  { type: "wipeLeft", label: "Wipe ←", hint: "Wipe to the left", group: "wipe", xfade: "wipeleft" },
  { type: "wipeRight", label: "Wipe →", hint: "Wipe to the right", group: "wipe", xfade: "wiperight" },
  { type: "wipeUp", label: "Wipe ↑", hint: "Wipe upward", group: "wipe", xfade: "wipeup" },
  { type: "wipeDown", label: "Wipe ↓", hint: "Wipe downward", group: "wipe", xfade: "wipedown" },
  { type: "slideLeft", label: "Trượt ←", hint: "Slide in from the right", group: "slide", xfade: "slideleft" },
  { type: "slideRight", label: "Trượt →", hint: "Slide in from the left", group: "slide", xfade: "slideright" },
  { type: "slideUp", label: "Trượt ↑", hint: "Slide up", group: "slide", xfade: "slideup" },
  { type: "slideDown", label: "Trượt ↓", hint: "Slide down", group: "slide", xfade: "slidedown" },
  { type: "circleOpen", label: "Mở vòng", hint: "Circle opens", group: "circle", xfade: "circleopen" },
  { type: "circleClose", label: "Đóng vòng", hint: "Circle closes", group: "circle", xfade: "circleclose" },
  { type: "zoomIn", label: "Zoom vào", hint: "Zoom in", group: "zoom", xfade: "zoomin" },
  { type: "zoomOut", label: "Zoom ra", hint: "Zoom out", group: "zoom", xfade: "smoothright" },
  { type: "blurDissolve", label: "Mờ dần", hint: "Dissolve with blur", group: "blur", xfade: "hblur" },
  { type: "glitch", label: "Nhiễu", hint: "Glitch", group: "glitch", xfade: "pixelize" },
  { type: "whipPan", label: "Vung tay", hint: "Whip pan", group: "whip", xfade: "smoothleft" },
];

export const TRANSITION_OPTIONS: {
  type: TransitionType;
  label: string;
  hint: string;
}[] = TRANSITION_DEFS.map(({ type, label, hint }) => ({ type, label, hint }));

export const TRANSITION_GROUPS: { id: TransitionGroup; label: string }[] = [
  { id: "cut", label: "Cắt" },
  { id: "fade", label: "Mờ" },
  { id: "wipe", label: "Gạt" },
  { id: "slide", label: "Trượt" },
  { id: "circle", label: "Vòng" },
  { id: "zoom", label: "Zoom" },
  { id: "blur", label: "Mờ nhòe" },
  { id: "glitch", label: "Nhiễu" },
  { id: "whip", label: "Vung" },
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
  return { type, durationTicks: type === "none" ? durationTicks : durationTicks };
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
  const group = transitionDef(type).group;
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
      // Every non-fade transition crossfades opacity while its geometry animates.
      if (group === "slide" || group === "whip") {
        // Slides keep both layers opaque; the incoming layer slides in on top.
        return { prev: 1, curr: 1 };
      }
      const a = easeTransition(p);
      return { prev: 1 - a, curr: a };
    }
  }
}

/** CSS clip-path for wipe / circle / mask transitions on the incoming clip. */
export function wipeClipPath(
  type: TransitionType,
  progress: number,
): string | undefined {
  const p = easeTransition(Math.min(1, Math.max(0, progress)));
  const pct = (1 - p) * 100;
  switch (type) {
    case "wipeLeft":
      return `inset(0 0 0 ${pct}%)`;
    case "wipeRight":
      return `inset(0 ${pct}% 0 0)`;
    case "wipeUp":
      return `inset(${pct}% 0 0 0)`;
    case "wipeDown":
      return `inset(0 0 ${pct}% 0)`;
    case "circleOpen":
      return `circle(${(p * 75).toFixed(1)}% at 50% 50%)`;
    case "circleClose":
      return `circle(${(p * 75).toFixed(1)}% at 50% 50%)`;
    default:
      return undefined;
  }
}

/** CSS transform (relative to the layer's own box) for the incoming clip. */
export function transitionTransform(type: TransitionType, progress: number): string {
  const p = easeTransition(Math.min(1, Math.max(0, progress)));
  const off = (1 - p) * 100;
  switch (type) {
    case "slideLeft":
      // Incoming enters from the right, moving left.
      return `translateX(${off.toFixed(2)}%)`;
    case "slideRight":
      return `translateX(${(-off).toFixed(2)}%)`;
    case "slideUp":
      return `translateY(${off.toFixed(2)}%)`;
    case "slideDown":
      return `translateY(${(-off).toFixed(2)}%)`;
    case "zoomIn":
      return `scale(${(0.5 + 0.5 * p).toFixed(3)})`;
    case "zoomOut":
      return `scale(${(1.5 - 0.5 * p).toFixed(3)})`;
    case "whipPan":
      return `translateX(${(-off * 1.4).toFixed(2)}%) scale(${(1 + (1 - p) * 0.15).toFixed(3)})`;
    default:
      return "";
  }
}

/** Combined preview visual for the incoming clip of a transition. */
export function transitionPreview(
  type: TransitionType,
  progress: number,
): { opacity: number; transform?: string; clipPath?: string; filter?: string } {
  const p = Math.min(1, Math.max(0, progress));
  const { curr } = transitionOpacityPair(type, p);
  const transform = transitionTransform(type, p);
  const clipPath = wipeClipPath(type, p);
  const filter =
    type === "blurDissolve"
      ? `blur(${((1 - easeTransition(p)) * 18).toFixed(1)}px)`
      : type === "glitch"
        ? `hue-rotate(${Math.round((1 - p) * 40)}deg) contrast(${(1 + (1 - p) * 0.6).toFixed(2)})`
        : undefined;
  return {
    opacity: curr,
    transform: transform || undefined,
    clipPath,
    filter,
  };
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
 * Wipe crop+pad matching preview CSS `inset` reveal (transparent outside).
 * Stream time 0..durationSec maps progress 0→1 with the same ease as preview.
 */
export function ffmpegWipeReveal(
  type: "wipeLeft" | "wipeRight",
  durationSec: number,
  width: number,
  height: number,
): string {
  const d = Math.max(0.05, durationSec);
  const p = eased01(clampedProgress("T", 0, d));
  const w = Math.max(2, width);
  const h = Math.max(2, height);
  // wipeLeft: inset from left → show right portion growing leftward? Preview uses
  // inset(0 0 0 (1-p)%) so left is clipped; visible starts at x=(1-p)*W.
  if (type === "wipeLeft") {
    return [
      `crop=w='max(2\\,${w}*${p})':h=${h}:x='${w}-out_w':y=0`,
      `pad=${w}:${h}:(${w}-ow):0:black@0`,
    ].join(",");
  }
  // wipeRight: inset(0 (1-p)% 0 0) → clip from right; visible is left portion.
  return [
    `crop=w='max(2\\,${w}*${p})':h=${h}:x=0:y=0`,
    `pad=${w}:${h}:0:0:black@0`,
  ].join(",");
}

/**
 * Visible if inside nominal range, early half of an incoming transition,
 * or late half while the *next* clip's centered transition is finishing.
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
  const hold = transitionHalfTicks(nextTin);
  return playheadTicks >= end && playheadTicks <= end + hold;
}
