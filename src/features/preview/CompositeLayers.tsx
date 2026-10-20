import { useEffect, useRef, type CSSProperties } from "react";
import {
  blendModeToCss,
  clipDurationTicks,
  cssFilterFromEffects,
  tintOverlayFromEffects,
  type TintOverlay,
  effectsAtProgress,
  fadeOpacityMultiplier,
  shakeAt,
  shakeScaleAt,
  strobeFlashOpacity,
  vignetteOverlayOpacity,
  zoomScaleAt,
  findNextClipOnTrack,
  findPreviousClipOnTrack,
  incomingTransitionProgress,
  clipMediaGeometry,
  hasTransformKeyframes,
  mediaCenter,
  paramHasTransformKeyframes,
  transformAtProgress,
  normalizeClipEffects,
  normalizeClipTransition,
  layerStackZ,
  cropClipPath,
  mediaSpeedAtTimelineTicks,
  phaseLockedRate,
  ticksToSeconds,
  transitionAwareMediaTimeSec,
  transitionHalfTicks,
  transitionVisualPair,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { acquireMediaVideo, releaseMediaVideo } from "../../lib/mediaVideoPool";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./PreviewPanel.module.css";

export interface PreviewLayer {
  clip: Clip;
  asset: MediaAsset;
  track: Track;
  /** Highest z plays audio from video element when unmuted. */
  isTopVideo: boolean;
}

interface CompositeLayersProps {
  layers: PreviewLayer[];
  isPlaying: boolean;
  isScrubbing: boolean;
}

function inTransitionWindow(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): boolean {
  if (incomingTransitionProgress(clip, playheadTicks)) return true;
  const next = findNextClipOnTrack(project, clip.id);
  if (!next) return false;
  const tin = normalizeClipTransition(next.transitionIn);
  if (tin.type === "none") return false;
  // Cut is the next clip's start (diamond), matching incomingTransitionProgress.
  const cut = next.startTicks;
  const half = transitionHalfTicks(tin);
  return playheadTicks >= cut - half && playheadTicks <= cut + half;
}

/**
 * True when this clip is the outgoing side being held past its nominal end
 * inside the next clip's centered transition window. Its preview frame must
 * freeze (hold last frame) — letting the decoder keep playing would drift
 * past `sourceOut` and force a yank-back seek every ~120ms (visible stutter).
 */
function isOutgoingHoldClip(
  clip: Clip,
  playheadTicks: number,
  project: ProjectDocument,
): boolean {
  const end = clip.startTicks + clipDurationTicks(clip);
  if (playheadTicks < end) return false;
  const next = findNextClipOnTrack(project, clip.id);
  if (!next) return false;
  const tin = normalizeClipTransition(next.transitionIn);
  if (tin.type === "none") return false;
  const half = transitionHalfTicks(tin);
  const cut = next.startTicks;
  return playheadTicks >= cut - half && playheadTicks <= cut + half;
}

/**
 * True when a video clip's source is exhausted at this playhead but its
 * timeline slot continues (strip cells: short video in a 10s slot).
 * The decoder should freeze on the last frame instead of looping.
 */
function isSourceExhaustedClip(clip: Clip, playheadTicks: number): boolean {
  if (clip.speedRamp) return false;
  const localSec = (playheadTicks - clip.startTicks) / 1_000_000;
  if (localSec < 0) return false;
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const sourceIn = clip.sourceInTicks / 1_000_000;
  const sourceOut = clip.sourceOutTicks / 1_000_000;
  return sourceIn + localSec * speed >= sourceOut - 0.03;
}

/**
 * Start of a real blend window (incoming transition with a previous clip on
 * the track), or null when this clip has no blend to pre-mount for.
 * Preview pre-mounts the incoming side ~1s early so replaying after a scrub
 * doesn't hitch on a cold decoder mount exactly at the window start.
 */
export function preTransitionWindowStart(
  project: ProjectDocument,
  clip: Clip,
): number | null {
  const tin = normalizeClipTransition(clip.transitionIn);
  if (tin.type === "none") return null;
  if (!findPreviousClipOnTrack(project, clip.id)) return null;
  return clip.startTicks - transitionHalfTicks(tin);
}

/** True while pre-mounted ahead of the blend window (must stay invisible + paused). */
export function isPreTransitionMount(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): boolean {
  const windowStart = preTransitionWindowStart(project, clip);
  return windowStart != null && playheadTicks < windowStart;
}

function transitionVisualMul(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): { opacity: number; clipPath?: string; offsetXPct: number; offsetYPct: number } {
  let opacityMul = 1;
  let clipPath: string | undefined;
  let offsetXPct = 0;
  let offsetYPct = 0;

  const incoming = incomingTransitionProgress(clip, playheadTicks);
  if (incoming) {
    const visual = transitionVisualPair(incoming.transition.type, incoming.progress);
    opacityMul *= visual.curr.opacity;
    if (visual.curr.clipPath) clipPath = visual.curr.clipPath;
    offsetXPct += visual.curr.offsetXPct;
    offsetYPct += visual.curr.offsetYPct;
  }

  const next = findNextClipOnTrack(project, clip.id);
  if (next) {
    const tin = normalizeClipTransition(next.transitionIn);
    if (tin.type !== "none") {
      const cut = next.startTicks;
      const half = transitionHalfTicks(tin);
      const windowStart = cut - half;
      const windowEnd = cut + half;
      if (playheadTicks >= windowStart && playheadTicks <= windowEnd) {
        const progress = (playheadTicks - windowStart) / tin.durationTicks;
        const visual = transitionVisualPair(tin.type, progress);
        opacityMul *= visual.prev.opacity;
        if (visual.prev.clipPath) clipPath = visual.prev.clipPath;
        offsetXPct += visual.prev.offsetXPct;
        offsetYPct += visual.prev.offsetYPct;
      }
    }
  }

  return { opacity: opacityMul, clipPath, offsetXPct, offsetYPct };
}

/** Later clips on the same track stack above earlier ones during overlap. */
function mediaZ(trackOrder: number, stackIndex: number): number {
  return layerStackZ(trackOrder, "media") + stackIndex;
}

interface LayerStyle {
  zIndex: number;
  opacity: number;
  filter?: string;
  clipPath?: string;
  /** Geometry box in percentages of the canvas. */
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  /** 0 = no vignette overlay; otherwise dark corner veil opacity. */
  vignetteOpacity: number;
  /** Color wash above the filtered media. Null = off. */
  tint: TintOverlay | null;
  /** Solid flash colour for Vegas-style strobe frame, or null. */
  strobeFlash: string | null;
  /** Smoothed flash strength (0..1) for the strobe tail. */
  strobeFlashOpacity: number;
  /** CSS transform for the whole layer (centring + scale + rotation). */
  transform: string;
  mixBlendMode: string;
}

function layerVisualStyle(
  project: ProjectDocument,
  clip: Clip,
  asset: MediaAsset | null,
  canvasWidth: number,
  canvasHeight: number,
  playheadTicks: number,
  zIndex: number,
  /** Stage px per canvas px — keeps CSS blur px canvas-true like export. */
  pxScale = 1,
): LayerStyle {
  const durationTicks = clipDurationTicks(clip);
  const durationSec = ticksToSeconds(durationTicks);
  const localSec = Math.max(0, ticksToSeconds(playheadTicks - clip.startTicks));
  const progress =
    durationTicks > 0
      ? Math.min(1, Math.max(0, (playheadTicks - clip.startTicks) / durationTicks))
      : 0;
  const effects = effectsAtProgress(clip.effects, clip.effectKeyframes, progress);
  const fps = project.canvas.frameRate;
  const fadeMul = fadeOpacityMultiplier(effects, localSec, durationSec);
  const flashOpacity = strobeFlashOpacity(effects, localSec, fps);
  const zoom = zoomScaleAt(effects, localSec, fps);
  const shake = shakeAt(effects, localSec);
  const baseGeom = geometryAtPlayhead(clip, asset, canvasWidth, canvasHeight, progress);
  const shakeScale = shakeScaleAt(
    effects,
    baseGeom.fitWidth > 0 && baseGeom.fitHeight > 0
      ? Math.max(canvasWidth / baseGeom.fitWidth, canvasHeight / baseGeom.fitHeight)
      : 1,
  );
  const txVisual = transitionVisualMul(project, clip, playheadTicks);
  const opacityMul = txVisual.opacity;
  // Pre-mounted ahead of the blend window: hold fully invisible until it opens.
  const preMount = isPreTransitionMount(project, clip, playheadTicks) ? 0 : 1;
  const filter = cssFilterFromEffects(effects, pxScale) || undefined;

  const geom = {
    ...baseGeom,
    centerX: baseGeom.centerX + shake.x * canvasWidth,
    centerY: baseGeom.centerY + shake.y * canvasHeight,
    rotation: baseGeom.rotation + shake.rotation,
    scaleX: baseGeom.scaleX * zoom * shakeScale,
    scaleY: baseGeom.scaleY * zoom * shakeScale,
  };
  const parts = [
    "translate(-50%, -50%)",
    `rotate(${geom.rotation}deg)`,
    `scale(${geom.scaleX}, ${geom.scaleY})`,
  ];
  // Strip cell hard crop: cover overflow must not spill into neighbours.
  // Strip clips carry no transitions, so the transition clipPath (when set)
  // wins and the crop applies otherwise.
  const cropPath = clip.crop
    ? cropClipPath(clip.crop, geom, canvasWidth, canvasHeight)
    : undefined;

  return {
    zIndex,
    opacity: geom.opacity * fadeMul * opacityMul * preMount,
    filter,
    clipPath: txVisual.clipPath ?? cropPath,
    leftPct: (geom.centerX / Math.max(1, canvasWidth)) * 100 + txVisual.offsetXPct,
    topPct: (geom.centerY / Math.max(1, canvasHeight)) * 100 + txVisual.offsetYPct,
    widthPct: (geom.fitWidth / Math.max(1, canvasWidth)) * 100,
    heightPct: (geom.fitHeight / Math.max(1, canvasHeight)) * 100,
    vignetteOpacity: vignetteOverlayOpacity(effects),
    tint: tintOverlayFromEffects(effects),
    strobeFlash: flashOpacity > 0.001 ? effects.strobeColor : null,
    strobeFlashOpacity: flashOpacity,
    transform: parts.join(" "),
    mixBlendMode: blendModeToCss(clip.transform.blendMode),
  };
}

function syncStrobeFlash(
  host: HTMLElement,
  color: string | null,
  opacity: number,
) {
  let flash = host.querySelector("[data-strobe]") as HTMLElement | null;
  if (!color) {
    flash?.remove();
    return;
  }
  if (!flash) {
    flash = document.createElement("div");
    flash.setAttribute("data-strobe", "");
    flash.className = styles.strobeFlash;
    host.appendChild(flash);
  }
  flash.style.background = color;
  flash.style.opacity = String(opacity);
}

function syncTintOverlay(host: HTMLElement, tint: TintOverlay | null) {
  let overlay = host.querySelector("[data-tint]") as HTMLElement | null;
  if (!tint) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.setAttribute("data-tint", "");
    overlay.className = styles.tintOverlay;
    const vignette = host.querySelector("[data-vignette]");
    if (vignette) host.insertBefore(overlay, vignette);
    else host.appendChild(overlay);
  }
  overlay.style.background = tint.color;
  overlay.style.opacity = String(tint.opacity);
  overlay.style.mixBlendMode = tint.blend;
}

function syncVignetteOverlay(host: HTMLElement, opacity: number) {
  let overlay = host.querySelector("[data-vignette]") as HTMLElement | null;
  if (opacity < 0.01) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.setAttribute("data-vignette", "");
    overlay.className = styles.vignetteOverlay;
    host.appendChild(overlay);
  }
  overlay.style.opacity = String(opacity);
}

type StyleCache = {
  zIndex: number;
  opacity: number;
  filter: string;
  clipPath: string;
  transform: string;
  left: string;
  top: string;
  width: string;
  height: string;
  vignetteOpacity: number;
  tintKey: string;
  strobeFlash: string | null;
  strobeFlashOpacity: number;
  mixBlendMode: string;
};

const styleCache = new WeakMap<HTMLElement, StyleCache>();

/**
 * Pooled <video> elements must never carry host geometry (width/height/%
 * transform). During transition remounts the element can briefly be orphaned;
 * applyMediaStyle used to paint those styles onto the video itself, and they
 * survived into the next host — looking like a permanent shrink on replay.
 */
function clearPooledVideoLayoutStyles(video: HTMLElement) {
  video.style.zIndex = "";
  video.style.opacity = "";
  video.style.clipPath = "";
  video.style.left = "";
  video.style.top = "";
  video.style.width = "";
  video.style.height = "";
  video.style.transform = "";
  video.style.mixBlendMode = "";
}

function applyMediaStyle(
  el: HTMLElement,
  project: ProjectDocument,
  clip: Clip,
  asset: MediaAsset | null,
  canvasWidth: number,
  canvasHeight: number,
  playheadTicks: number,
  zIndex: number,
) {
  // CSS blur px are stage px: measure the stage so the blur matches the
  // canvas-px sigma used by export (`gblur`). Falls back to 1:1 when the
  // host isn't mounted yet (seed style, corrected on mount).
  const stageEl = el.closest("[data-stage]");
  const stageW = stageEl instanceof HTMLElement ? stageEl.clientWidth : 0;
  const pxScale =
    stageW > 0
      ? Math.min(4, Math.max(0.05, stageW / Math.max(1, canvasWidth)))
      : 1;
  const style = layerVisualStyle(
    project,
    clip,
    asset,
    canvasWidth,
    canvasHeight,
    playheadTicks,
    zIndex,
    pxScale,
  );
  // Geometry always lives on the layer host. Never fall back to styling the
  // pooled <video> — orphan frames during remount would bake % size onto it.
  const host = el.closest("[data-layer-host]");
  if (!(host instanceof HTMLElement)) return;
  if (el !== host) {
    clearPooledVideoLayoutStyles(el);
    el.style.filter = "";
  }

  const target = host;
  const filter = style.filter ?? "";
  const clipPath = style.clipPath ?? "none";
  const left = `${style.leftPct}%`;
  const top = `${style.topPct}%`;
  const width = `${style.widthPct}%`;
  const height = `${style.heightPct}%`;
  const transform = style.transform;
  const vignetteOpacity = style.vignetteOpacity;
  const tintKey = style.tint
    ? `${style.tint.color}|${style.tint.opacity}|${style.tint.blend}`
    : "";
  const strobeFlash = style.strobeFlash;
  const strobeFlashOpacity = style.strobeFlashOpacity;
  const mixBlendMode = style.mixBlendMode;
  const prev = styleCache.get(target);
  if (
    prev &&
    prev.zIndex === style.zIndex &&
    prev.opacity === style.opacity &&
    prev.filter === filter &&
    prev.clipPath === clipPath &&
    prev.transform === transform &&
    prev.left === left &&
    prev.top === top &&
    prev.width === width &&
    prev.height === height &&
    prev.vignetteOpacity === vignetteOpacity &&
    prev.tintKey === tintKey &&
    prev.strobeFlash === strobeFlash &&
    prev.strobeFlashOpacity === strobeFlashOpacity &&
    prev.mixBlendMode === mixBlendMode
  ) {
    return;
  }
  styleCache.set(target, {
    zIndex: style.zIndex,
    opacity: style.opacity,
    filter,
    clipPath,
    transform,
    left,
    top,
    width,
    height,
    vignetteOpacity,
    tintKey,
    strobeFlash,
    strobeFlashOpacity,
    mixBlendMode,
  });
  target.style.zIndex = String(style.zIndex);
  target.style.opacity = String(style.opacity);
  target.style.filter = filter;
  target.style.clipPath = clipPath;
  target.style.left = left;
  target.style.top = top;
  target.style.width = width;
  target.style.height = height;
  target.style.transform = transform;
  target.style.mixBlendMode = mixBlendMode;
  // Filter a wrapper, not the <video>. A filter on the video element letterboxes
  // the frame and the color wash shows up as bars in the empty sides.
  target.style.filter = "";
  const grade = target.querySelector(":scope > [data-grade]");
  if (grade instanceof HTMLElement) grade.style.filter = filter;
  syncTintOverlay(target, style.tint);
  syncVignetteOverlay(target, vignetteOpacity);
  syncStrobeFlash(target, strobeFlash, strobeFlashOpacity);
}

/** True when opacity is still changing this frame (fade / transition). */
function geometryAtPlayhead(
  clip: Clip,
  asset: MediaAsset | null,
  canvasWidth: number,
  canvasHeight: number,
  progress: number,
) {
  const tr = transformAtProgress(clip.transform, clip.transformKeyframes, progress);
  const geom = clipMediaGeometry(
    { ...clip, transform: tr },
    canvasWidth,
    canvasHeight,
    asset,
  );
  const xAbs = paramHasTransformKeyframes(clip.transformKeyframes, "x");
  const yAbs = paramHasTransformKeyframes(clip.transformKeyframes, "y");
  if (!xAbs && !yAbs) return geom;
  const center = mediaCenter(clip.transform, canvasWidth, canvasHeight);
  return {
    ...geom,
    centerX: xAbs ? tr.x : center.x,
    centerY: yAbs ? tr.y : center.y,
  };
}

function needsPerFrameVisual(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): boolean {
  if (clip.effectKeyframes?.tracks?.length) return true;
  if (hasTransformKeyframes(clip.transformKeyframes)) return true;
  const effects = normalizeClipEffects(clip.effects);
  if (effects.strobeFrames > 0) return true;
  if (effects.zoom > 0.0001) return true;
  if (effects.shake > 0.0001) return true;
  const dur = ticksToSeconds(clipDurationTicks(clip));
  const local = Math.max(0, ticksToSeconds(playheadTicks - clip.startTicks));
  if (effects.fadeInSec > 0.001 && local <= effects.fadeInSec + 0.08) return true;
  if (effects.fadeOutSec > 0.001 && local >= dur - effects.fadeOutSec - 0.08) {
    return true;
  }
  return inTransitionWindow(project, clip, playheadTicks);
}

/** Skip re-seek when the warm/pooled decoder is already near the target. */
const SEEK_CLOSE_SEC = 0.08;
/** A seek pending longer than this never resolves — re-issue instead of freezing. */
const SEEK_STUCK_MS = 600;
/**
 * After a transition catch-up seek, let the decoder settle this long before
 * even considering another one. Without it, a seek that resolves slightly
 * off-target (keyframe-approximated frame) triggers an immediate re-seek
 * every frame — each aborting the last — which is the replay judder:
 * first play needs no catch-up (warm decoder, small drift), replay after a
 * scrub mounts mid-transition with a cold/stale position (big drift).
 */
const TRANSITION_RESEEK_MS = 320;
/** After one catch-up, accept keyframe snap within this delta (don't reseek). */
const TRANSITION_ACCEPT_SEC = 0.28;
/** Sustainable reverse cadence: backward seeks decode from the keyframe. */
const REVERSE_SEEK_MIN_GAP_MS = 150;
/** Scrub cadence for long files: each seek on a long-GOP source can take
 * 100ms+ to resolve — firing faster piles seeks that abort each other. */
const SCRUB_SEEK_MIN_GAP_MS = 120;
const DRIFT_HARD_SEC = 0.7;
const DRIFT_HARD_MIN_GAP_MS = 500;



function safeSeek(video: HTMLVideoElement, timeSec: number) {
  if (!Number.isFinite(timeSec) || timeSec < 0) return;
  try {
    const t = Math.max(0, timeSec);
    const delta = Math.abs(video.currentTime - t);
    // Already near the target with a painted frame — skip (avoids Play glitch).
    if (delta < SEEK_CLOSE_SEC && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    // Same timestamp but no frame yet — only then nudge to re-fire seeked.
    if (delta < 0.001 && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      video.currentTime = t + 0.04;
      return;
    }
    video.currentTime = t;
  } catch {
    /* ignore */
  }
}

export function CompositeLayers({
  layers,
  isPlaying,
  isScrubbing,
}: CompositeLayersProps) {
  const project = useProjectStore((s) => s.project);
  const playbackRate = useEditorUiStore((s) => s.playbackRate);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastSeekAtRef = useRef(0);
  /** Per-clip seek cadence so dual transition decoders don't block each other. */
  const lastSeekAtByClipRef = useRef(new Map<string, number>());
  /** After scrub, Play must re-anchor once (resume-without-seek leaves wrong frames). */
  const needsResyncAfterScrubRef = useRef(false);
  /** Previous sync's scrubbing flag — detects scrub end for one precise settle seek. */
  const prevScrubbingRef = useRef(false);
  /** Per-clip last applied playbackRate — avoid resetting the decoder every frame. */
  const lastRateByClipRef = useRef(new Map<string, number>());
  /** Was live-visual last frame — force one clean style pass after transition ends. */
  const liveVisualByClipRef = useRef(new Map<string, boolean>());
  const wakePendingRef = useRef(new WeakSet<HTMLVideoElement>());
  /**
   * When the current seek was issued per clip — a seek stuck longer than
   * SEEK_STUCK_MS never resolves (UHD), so a new one may be issued.
   */
  const seekStartRef = useRef(new Map<string, number>());
  /** Last transition catch-up seek per clip — survives resolve (settle window). */
  const lastCatchupRef = useRef(new Map<string, number>());
  const layersRef = useRef(layers);
  const projectRef = useRef(project);
  const isPlayingRef = useRef(isPlaying);
  const isScrubbingRef = useRef(isScrubbing);
  const playbackRateRef = useRef(playbackRate);
  const syncRef = useRef<(playheadTicks: number) => void>(() => undefined);
  /**
   * Stable host ref callbacks per clip. Inline `ref={(host) => ...}` creates a
   * new function every render, so React detaches (ref(null) → releaseMediaVideo
   * → video.pause() + DOM yank) and re-attaches on every frame while the
   * transition forces `listPlayhead` updates — that pause/yank/re-play cycle
   * every frame is the visible fade stutter. Cached callbacks keep identity
   * stable; the latest url is read from a map when (re)mounted.
   */
  const hostUrlsRef = useRef(new Map<string, string>());
  const hostCallbacksRef = useRef(new Map<string, (host: HTMLDivElement | null) => void>());
  /**
   * Clips pre-warmed ahead of their transition window (acquired + seeked, not
   * yet mounted). Adopted on mount; released if the window passes unplayed.
   */
  const warmedRef = useRef(new Set<string>());
  const lastWarmRef = useRef(0);
  layersRef.current = layers;
  projectRef.current = project;
  isPlayingRef.current = isPlaying;
  isScrubbingRef.current = isScrubbing;
  playbackRateRef.current = playbackRate;

  const ensurePlaying = (video: HTMLVideoElement, clipId?: string) => {
    if (!isPlayingRef.current || isScrubbingRef.current) return;
    if (clipId) {
      const layer = layersRef.current.find((l) => l.clip.id === clipId);
      if (layer) {
        const ticks = useEditorUiStore.getState().playheadTicks;
        // Pre-mounted blend side stays paused until its window opens.
        if (isPreTransitionMount(projectRef.current, layer.clip, ticks)) {
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          return;
        }
        // Outgoing hold side must stay frozen — never (re)play it, not even from
        // a seeked-event wakeup, or it drifts and gets yanked back every ~120ms.
        if (isOutgoingHoldClip(layer.clip, ticks, projectRef.current)) {
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          return;
        }
        // Source exhausted (short video in a longer slot): freeze last frame.
        if (isSourceExhaustedClip(layer.clip, ticks)) {
          if (Math.abs(video.currentTime - (layer.clip.sourceOutTicks / 1_000_000 - 0.01)) > 0.15) {
            safeSeek(video, transitionAwareMediaTimeSec(layer.clip, ticks));
          }
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          return;
        }
      }
    }
    // Already playing and not mid-seek — nothing to do.
    if (!video.paused && !video.ended && !video.seeking) return;
    // Never pile play() onto an in-flight seek: that is the post-scrub
    // transition judder (playhead freewheels, decoder keeps aborting seeks).
    // `seeked` listener below will call ensurePlaying once.
    if (video.seeking) return;
    // ended / near-end: must rewind before play() will advance frames again.
    if (video.ended) {
      try {
        video.currentTime = Math.max(0, video.currentTime - 0.05);
      } catch {
        /* ignore */
      }
    }
    const rate = Number.isFinite(playbackRateRef.current)
      ? Math.abs(playbackRateRef.current)
      : 1;
    if (!Number.isFinite(video.playbackRate) || video.playbackRate < 0.01) {
      video.playbackRate = Math.min(16, Math.max(0.0625, rate || 1));
    }
    void video.play().catch(() => undefined);
  };

  const primeVideo = (clipId: string, video: HTMLVideoElement) => {
    const layer = layersRef.current.find((l) => l.clip.id === clipId);
    if (!layer || layer.asset.kind !== "video") return;
    const ticks = useEditorUiStore.getState().playheadTicks;
    const target = transitionAwareMediaTimeSec(layer.clip, ticks);
    const { width: cw, height: ch } = projectRef.current.canvas;
    const stackIndex = Math.max(
      0,
      layersRef.current.findIndex((l) => l.clip.id === clipId),
    );
    applyMediaStyle(
      video,
      projectRef.current,
      layer.clip,
      layer.asset,
      cw,
      ch,
      ticks,
      mediaZ(layer.track.order, stackIndex),
    );
    const playing = isPlayingRef.current && !isScrubbingRef.current;
    const transitioning = inTransitionWindow(projectRef.current, layer.clip, ticks);
    // Mount MUST land on the right frame: a pooled element can carry a stale
    // position (or sit at EOF → frozen) from earlier use. Seek once when the
    // drift is large — one bounded seek per mount, not a per-frame fight.
    // Small drifts are left alone so warm UHD decodes are never disturbed.
    if (!playing || transitioning || Math.abs(video.currentTime - target) > 0.5) {
      safeSeek(video, target);
    }
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      try {
        video.load();
      } catch {
        /* ignore */
      }
    }
    // Pre-mounted blend side: buffer paused, never play early.
    if (playing && isPreTransitionMount(projectRef.current, layer.clip, ticks)) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    ensurePlaying(video, clipId);
  };

  /** Listeners bound per attach — an element moving between clips must not
   * keep firing closures over a stale clipId (wrong-target wakeups could
   * play a paused pre-mounted clip early). */
  const elListenersRef = useRef(
    new WeakMap<
      HTMLVideoElement,
      { ready: () => void; seeked: () => void }
    >(),
  );

  const attachVideo = (clipId: string, el: HTMLVideoElement | null) => {
    if (!el) {
      videoRefs.current.delete(clipId);
      releaseMediaVideo(clipId);
      return;
    }
    videoRefs.current.set(clipId, el);
    const prev = elListenersRef.current.get(el);
    if (prev) {
      el.removeEventListener("loadedmetadata", prev.ready);
      el.removeEventListener("canplay", prev.ready);
      el.removeEventListener("seeked", prev.seeked);
    }

    const onReady = () => {
      primeVideo(clipId, el);
      ensurePlaying(el, clipId);
    };
    const onSeeked = () => {
      wakePendingRef.current.delete(el);
      seekStartRef.current.delete(clipId);
      ensurePlaying(el, clipId);
    };
    el.addEventListener("loadedmetadata", onReady);
    el.addEventListener("canplay", onReady);
    el.addEventListener("seeked", onSeeked);
    elListenersRef.current.set(el, { ready: onReady, seeked: onSeeked });

    // Pooled/warmed videos are often already past metadata — don't call load()
    // (that would discard the warm decode). Only kick cold elements.
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
      try {
        el.load();
      } catch {
        /* ignore */
      }
    }
    primeVideo(clipId, el);
  };

  const mountPooledVideo = (
    host: HTMLDivElement | null,
    clipId: string,
    url: string,
  ) => {
    if (!host) {
      attachVideo(clipId, null);
      return;
    }
    const video = acquireMediaVideo(url, clipId);
    video.className = styles.layerMedia;
    video.playsInline = true;
    clearPooledVideoLayoutStyles(video);
    video.style.filter = "";
    let grade = host.querySelector(":scope > [data-grade]");
    if (!(grade instanceof HTMLElement)) {
      grade = document.createElement("div");
      grade.setAttribute("data-grade", "");
      grade.className = styles.gradeWrap;
      host.insertBefore(grade, host.firstChild);
    }
    if (video.parentElement !== grade) {
      grade.replaceChildren(video);
    }
    attachVideo(clipId, video);
  };

  const videoHostRef = (clipId: string, url: string) => {
    hostUrlsRef.current.set(clipId, url);
    let cb = hostCallbacksRef.current.get(clipId);
    if (!cb) {
      cb = (host: HTMLDivElement | null) => {
        if (host) {
          mountPooledVideo(host, clipId, hostUrlsRef.current.get(clipId) ?? url);
        } else {
          mountPooledVideo(null, clipId, "");
          hostUrlsRef.current.delete(clipId);
          hostCallbacksRef.current.delete(clipId);
        }
      };
      hostCallbacksRef.current.set(clipId, cb);
    }
    return cb;
  };

  // Scrub marks decoders dirty — next Play must re-anchor once.
  useEffect(() => {
    if (isScrubbing) needsResyncAfterScrubRef.current = true;
  }, [isScrubbing]);

  // Start/stop decoder when transport changes.
  // IMPORTANT:
  //  - do NOT depend on `layers` (remount mid-play freezes the frame)
  //  - pause only in the effect *cleanup*, and only if transport actually
  //    stopped. React Strict Mode runs play→cleanup→play; pausing in cleanup
  //    while isPlaying is still true caused the "tiny jerk, need 2–3 clicks" bug.
  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      // Pause here too — covers mount/stop paths that never installed a cleanup.
      for (const video of videoRefs.current.values()) {
        video.pause();
        wakePendingRef.current.delete(video);
      }
      return;
    }

    const ticks = useEditorUiStore.getState().playheadTicks;
    const proj = projectRef.current;
    const { width: cw, height: ch } = proj.canvas;
    const shuttle = Math.abs(
      Number.isFinite(playbackRateRef.current) ? playbackRateRef.current : 1,
    );

    // Do NOT snap the playhead to video.currentTime on Play — a stale decoder
    // time jumps the timeline a fraction of a second and looks like a glitch.
    // Exception: after scrub, decoders are often keyframe-snapped / unfinished —
    // one bounded re-anchor (especially in a transition) prevents judder.
    const resync = needsResyncAfterScrubRef.current;
    needsResyncAfterScrubRef.current = false;
    const nowPlay = performance.now();

    layersRef.current.forEach((layer, stackIndex) => {
      const z = mediaZ(layer.track.order, stackIndex);
      if (layer.asset.kind === "image") {
        const img = imageRefs.current.get(layer.clip.id);
        if (img) {
          applyMediaStyle(img, proj, layer.clip, layer.asset, cw, ch, ticks, z);
        }
        return;
      }
      if (layer.asset.kind !== "video") return;
      const video = videoRefs.current.get(layer.clip.id);
      if (!video) return;
      applyMediaStyle(video, proj, layer.clip, layer.asset, cw, ch, ticks, z);
      wakePendingRef.current.delete(video);

      const target = transitionAwareMediaTimeSec(layer.clip, ticks);
      const transitioning = inTransitionWindow(proj, layer.clip, ticks);
      const drift = Math.abs(video.currentTime - target);

      // Outgoing hold side stays frozen even at Play-from-transition.
      if (isOutgoingHoldClip(layer.clip, ticks, proj)) {
        if (drift > 0.08) {
          safeSeek(video, target);
        }
        try {
          video.pause();
        } catch {
          /* ignore */
        }
        return;
      }

      // Post-scrub: one seek if far off (or any mid-transition mismatch).
      if (
        resync &&
        !video.seeking &&
        (transitioning ? drift > 0.08 : drift > 0.25)
      ) {
        lastSeekAtByClipRef.current.set(layer.clip.id, nowPlay);
        seekStartRef.current.set(layer.clip.id, nowPlay);
        lastCatchupRef.current.set(layer.clip.id, nowPlay);
        safeSeek(video, target);
      }

      const speed = mediaSpeedAtTimelineTicks(layer.clip, ticks);
      video.playbackRate = Math.min(16, Math.max(0.0625, speed * (shuttle || 1)));
      lastRateByClipRef.current.set(layer.clip.id, video.playbackRate);
      ensurePlaying(video, layer.clip.id);
    });

    return () => {
      // Strict Mode re-runs this effect while still playing — do not pause then.
      if (useEditorUiStore.getState().isPlaying && !useEditorUiStore.getState().isScrubbing) {
        return;
      }
      for (const video of videoRefs.current.values()) {
        video.pause();
        wakePendingRef.current.delete(video);
      }
    };
  }, [isPlaying, isScrubbing]);

  // Watchdog: re-issue play() while transport is live but the element is paused.
  // Do NOT nudge currentTime here — a +0.001s seek looks like a tiny glitch and
  // can abort the first play() on UHD. Outgoing hold clips stay paused by
  // design (ensurePlaying pauses them instead of playing).
  // Cold elements with zero data (HAVE_NOTHING) can never start on their own —
  // kick load() at most once per 5s per clip so a stalled mount recovers
  // instead of sitting black.
  const coldKickRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      for (const [clipId, video] of videoRefs.current.entries()) {
        if (video.paused || video.ended) ensurePlaying(video, clipId);
        if (
          video.readyState < HTMLMediaElement.HAVE_METADATA &&
          now - (coldKickRef.current.get(clipId) ?? 0) > 5000
        ) {
          coldKickRef.current.set(clipId, now);
          try {
            video.load();
          } catch {
            /* ignore */
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, isScrubbing]);

  useEffect(() => {
    const sync = (playheadTicks: number) => {
      const liveLayers = layersRef.current;
      const proj = projectRef.current;
      const playing = isPlayingRef.current;
      const scrubbing = isScrubbingRef.current;
      const shuttle = Number.isFinite(playbackRateRef.current)
        ? playbackRateRef.current
        : 1;
      const reverse = shuttle < 0;
      const { width: cw, height: ch } = proj.canvas;
      const nowSync = performance.now();
      // True on the first sync ticks after a scrub ends — settle the exact
      // frame once (scrubbing itself uses fastSeek keyframe snaps).
      const wasScrubbing = prevScrubbingRef.current && !scrubbing;
      prevScrubbingRef.current = scrubbing;

      const live = new Set(liveLayers.map((l) => l.clip.id));
      for (const [id, el] of videoRefs.current) {
        if (!live.has(id)) {
          el.pause();
          videoRefs.current.delete(id);
          seekStartRef.current.delete(id);
          lastCatchupRef.current.delete(id);
          releaseMediaVideo(id);
        }
      }
      for (const [id] of imageRefs.current) {
        if (!live.has(id)) imageRefs.current.delete(id);
      }

      const layersOnTrack = new Map<string, number>();
      for (const layer of liveLayers) {
        layersOnTrack.set(
          layer.track.id,
          (layersOnTrack.get(layer.track.id) ?? 0) + 1,
        );
      }

      liveLayers.forEach((layer, stackIndex) => {
        const z = mediaZ(layer.track.order, stackIndex);
        if (layer.asset.kind === "image") {
          const img = imageRefs.current.get(layer.clip.id);
          if (img) {
            applyMediaStyle(img, proj, layer.clip, layer.asset, cw, ch, playheadTicks, z);
          }
          return;
        }
        if (layer.asset.kind !== "video") return;
        const video = videoRefs.current.get(layer.clip.id);
        if (!video) return;

        const overlapping = (layersOnTrack.get(layer.track.id) ?? 0) > 1;
        const transitioning = inTransitionWindow(proj, layer.clip, playheadTicks);
        // Keep opacity live for the whole overlap — otherwise the incoming clip
        // can freeze at opacity 0 after the transition window and never appear.
        const liveVisual =
          !playing ||
          scrubbing ||
          reverse ||
          overlapping ||
          needsPerFrameVisual(proj, layer.clip, playheadTicks);
        const wasLiveVisual =
          liveVisualByClipRef.current.get(layer.clip.id) ?? false;
        // One extra pass after leaving the transition so wipe/slide/opacity
        // snap back to full geometry instead of freezing mid-effect.
        if (liveVisual || wasLiveVisual) {
          applyMediaStyle(video, proj, layer.clip, layer.asset, cw, ch, playheadTicks, z);
        }
        liveVisualByClipRef.current.set(layer.clip.id, liveVisual);

        // NOTE: intentionally NOT gated on `asset.hasAudio` — that flag was
        // mis-detected at import for many files (Chrome reports no audio
        // tracks from metadata alone). An unmuted element with no audio track
        // plays silently anyway, so unmuting is harmless; muting on a wrong
        // flag is the "picture plays, no sound" bug. Detached soundtracks
        // (suppressEmbeddedAudio) still stay muted to avoid double audio.
        const muted =
          !layer.isTopVideo ||
          layer.track.muted ||
          Boolean(layer.clip.suppressEmbeddedAudio);
        if (video.muted !== muted) video.muted = muted;
        const durSec = Math.max(
          0.01,
          ticksToSeconds(clipDurationTicks(layer.clip)),
        );
        const localSec = Math.max(
          0,
          ticksToSeconds(playheadTicks - layer.clip.startTicks),
        );
        const vol =
          Math.min(1, Math.max(0, layer.clip.volume * layer.track.volume)) *
          fadeOpacityMultiplier(
            normalizeClipEffects(layer.clip.effects),
            localSec,
            durSec,
          );
        if (video.volume !== vol) video.volume = vol;

        const target = transitionAwareMediaTimeSec(layer.clip, playheadTicks);

        // Pre-mounted ahead of its blend window: buffer a single prime seek,
        // stay paused and invisible until the window opens (no early audio,
        // no decoder race at the cut).
        if (playing && !scrubbing && !reverse) {
          if (isPreTransitionMount(proj, layer.clip, playheadTicks)) {
            if (!video.seeking && Math.abs(video.currentTime - target) > 0.25) {
              safeSeek(video, target);
            }
            try {
              video.pause();
            } catch {
              /* ignore */
            }
            return;
          }
        }

        const speed = mediaSpeedAtTimelineTicks(layer.clip, playheadTicks);
        const nominalRate = speed * Math.abs(shuttle || 1);
        // Phase-lock the element to the timeline wall clock: trim playbackRate
        // by the drift instead of hard-seeking. A ramped clip then stays glued
        // to the playhead (and its audio) without decoder thrash.
        const driftSec = target - video.currentTime;
        const desiredRate = video.seeking
          ? video.playbackRate
          : phaseLockedRate(nominalRate, driftSec);
        const prevRate = lastRateByClipRef.current.get(layer.clip.id);
        const rateDelta =
          prevRate == null || prevRate <= 0
            ? Infinity
            : Math.abs(desiredRate - prevRate) / prevRate;
        if (prevRate == null || rateDelta > 0.02) {
          video.playbackRate = desiredRate;
          lastRateByClipRef.current.set(layer.clip.id, desiredRate);
        }

        if (playing && !scrubbing && !reverse) {
          // Outgoing hold side: freeze on the last frame instead of playing
          // past `sourceOut` and being yanked back (~120ms stutter loop).
          if (isOutgoingHoldClip(layer.clip, playheadTicks, proj)) {
            if (Math.abs(video.currentTime - target) > 0.08) {
              const now = performance.now();
              if (now - lastSeekAtRef.current >= 120) {
                lastSeekAtRef.current = now;
                safeSeek(video, target);
              }
            }
            try {
              video.pause();
            } catch {
              /* ignore */
            }
            return;
          }
          // Source exhausted (strip hold): freeze, don't loop.
          if (isSourceExhaustedClip(layer.clip, playheadTicks)) {
            if (Math.abs(video.currentTime - target) > 0.08) {
              safeSeek(video, target);
            }
            try {
              video.pause();
            } catch {
              /* ignore */
            }
            return;
          }
          // Incoming clip often mounts mid-transition with a cold currentTime —
          // one catch-up seek so it doesn't stay on the wrong frame under clip 1.
          // Never pile onto a pending seek: competing seeks abort each other
          // and the decoder shows nothing (black). After one catch-up, accept
          // keyframe snap within TRANSITION_ACCEPT_SEC (endless reseek = judder).
          if (transitioning) {
            const drift = Math.abs(video.currentTime - target);
            const now = performance.now();
            const lastCatch = lastCatchupRef.current.get(layer.clip.id) ?? 0;
            const recentlyCaught = now - lastCatch < TRANSITION_RESEEK_MS * 4;
            const acceptAfterCatch = recentlyCaught && drift <= TRANSITION_ACCEPT_SEC;
            if (drift > 0.12 && !acceptAfterCatch) {
              const started = seekStartRef.current.get(layer.clip.id);
              const stuck = started != null && now - started >= SEEK_STUCK_MS;
              if (stuck) seekStartRef.current.delete(layer.clip.id);
              if (!stuck && now - lastCatch < TRANSITION_RESEEK_MS) {
                // Settling — don't play() while still seeking.
                if (!video.seeking) ensurePlaying(video, layer.clip.id);
                return;
              }
              const lastClipSeek = lastSeekAtByClipRef.current.get(layer.clip.id) ?? 0;
              if (!video.seeking && now - lastClipSeek >= 16) {
                lastSeekAtByClipRef.current.set(layer.clip.id, now);
                lastSeekAtRef.current = now;
                seekStartRef.current.set(layer.clip.id, now);
                lastCatchupRef.current.set(layer.clip.id, now);
                safeSeek(video, target);
              }
              // Wait for seeked before play — avoids freewheel judder.
              return;
            }
          }
          // Genuinely lost (decoder stalled / seek missed): hard resync. The
          // phase-lock trim only handles small drift, so a big gap needs the
          // element put back on the right frame — throttled so seeks settle.
          const hardDrift = Math.abs(video.currentTime - target);
          if (hardDrift > DRIFT_HARD_SEC) {
            const now = performance.now();
            const lastClipSeek = lastSeekAtByClipRef.current.get(layer.clip.id) ?? 0;
            if (!video.seeking && now - lastClipSeek >= DRIFT_HARD_MIN_GAP_MS) {
              lastSeekAtByClipRef.current.set(layer.clip.id, now);
              seekStartRef.current.set(layer.clip.id, now);
              lastCatchupRef.current.set(layer.clip.id, now);
              safeSeek(video, target);
            }
          }
          ensurePlaying(video, layer.clip.id);
          return;
        }

        video.pause();
        // Plain pause: never seek. Pause-time seeks on UHD often never finish,
        // so the next Play leaves a stuck frame while the timeline runs.
        // Only scrub / reverse shuttle need to re-anchor the decoder.
        // Exception: right when a scrub ends, settle one precise seek —
        // scrubbing uses fastSeek (keyframe snap), so the held frame can sit
        // up to a GOP away from the playhead.
        if (!scrubbing && !reverse) {
          if (
            wasScrubbing &&
            !video.seeking &&
            Math.abs(video.currentTime - target) > 0.04
          ) {
            seekStartRef.current.set(layer.clip.id, nowSync);
            safeSeek(video, target);
          }
          return;
        }
        // Reverse/scrub seeks are expensive (backward = decode from keyframe).
        // Piling a new seek onto a pending one aborts both and yields black
        // frames: hold the last good frame instead, with an escape hatch for
        // seeks stuck so long they will never resolve.
        const now = performance.now();
        // A seek issued elsewhere (mount prime, transition catch-up) also
        // deserves a grace period before we consider it stuck.
        if (video.seeking) {
          const started = seekStartRef.current.get(layer.clip.id);
          if (started == null) {
            seekStartRef.current.set(layer.clip.id, now);
            return;
          }
          if (now - started < SEEK_STUCK_MS) return;
        } else {
          seekStartRef.current.delete(layer.clip.id);
        }
        // Per-clip cadence so both transition sides can seek; scrub and
        // reverse stay slower (long-GOP seeks take 100ms+ to resolve).
        const minGap = reverse
          ? REVERSE_SEEK_MIN_GAP_MS
          : transitioning
            ? 60
            : SCRUB_SEEK_MIN_GAP_MS;
        const lastClipSeek = lastSeekAtByClipRef.current.get(layer.clip.id) ?? 0;
        if (now - lastClipSeek < minGap) return;
        if (Math.abs(video.currentTime - target) < (transitioning ? 0.02 : 0.08)) {
          return;
        }
        lastSeekAtByClipRef.current.set(layer.clip.id, now);
        lastSeekAtRef.current = now;
        seekStartRef.current.set(layer.clip.id, now);
        // Scrub: prefer fastSeek (keyframe snap, resolves in ms) over a full
        // precise seek (long-GOP sources decode hundreds of frames per seek —
        // that pile-up is the scrub judder). The exact frame settles once via
        // the scrub-end seek above. Falls back to safeSeek where unsupported.
        if (!reverse) {
          const fastSeekFn = (
            video as HTMLVideoElement & { fastSeek?: (t: number) => void }
          ).fastSeek;
          if (typeof fastSeekFn === "function") {
            try {
              fastSeekFn.call(video, target);
              return;
            } catch {
              /* fall through to precise seek */
            }
          }
        }
        safeSeek(video, target);
      });

      // Transition look-ahead: warm the incoming decoder shortly BEFORE its
      // window so dissolve/fade doesn't start on a cold (black) element and
      // pop in late (perceived as cutting early). Warming = acquire (no DOM)
      // + one seek to the window-start frame, paused; the mount adopts the
      // warm element via the pool. Forward play only.
      const warmed = warmedRef.current;
      for (const id of [...warmed]) {
        if (videoRefs.current.has(id)) {
          warmed.delete(id); // adopted on mount
          continue;
        }
        const clip = proj.clips.find((c) => c.id === id);
        const tin = clip ? normalizeClipTransition(clip.transitionIn) : null;
        const windowStart =
          clip && tin && tin.type !== "none"
            ? clip.startTicks - transitionHalfTicks(tin)
            : null;
        // Missed (paused, stopped, scrubbed away): release the decoder.
        // Warmed elements are only useful while playing forward — pause and
        // scrub paths seek on their own, so don't hoard decoder slots idle.
        if (
          !playing ||
          windowStart == null ||
          playheadTicks > windowStart + 1_000_000
        ) {
          warmed.delete(id);
          releaseMediaVideo(id);
        }
      }
      if (playing && !scrubbing && !reverse) {
        const nowWarm = performance.now();
        if (nowWarm - lastWarmRef.current >= 300) {
          lastWarmRef.current = nowWarm;
          for (const clip of proj.clips) {
            if (clip.kind !== "media" || !clip.assetId) continue;
            const tin = normalizeClipTransition(clip.transitionIn);
            if (tin.type === "none") continue;
            const half = transitionHalfTicks(tin);
            const windowStart = clip.startTicks - half;
            // Warm only shortly before the window; inside it, mount+prime
            // takes over. Covers dissolve/fade (opacity) and wipe/slide.
            if (playheadTicks < windowStart - 750_000 || playheadTicks >= windowStart) {
              continue;
            }
            if (live.has(clip.id) || warmed.has(clip.id)) continue;
            const asset = proj.assets.find((a) => a.id === clip.assetId);
            if (!asset || asset.missing || asset.kind !== "video") continue;
            const url = resolveMediaUrl(asset.path, asset.id);
            if (!url) continue;
            try {
              const video = acquireMediaVideo(url, clip.id);
              video.className = styles.layerMedia;
              video.playsInline = true;
              video.muted = true;
              const target = transitionAwareMediaTimeSec(clip, windowStart);
              if (Math.abs(video.currentTime - target) > 0.15) {
                try {
                  video.currentTime = Math.max(0, target);
                } catch {
                  /* ignore */
                }
              }
              warmed.add(clip.id);
            } catch {
              /* ignore */
            }
          }
        }
      }
    };

    syncRef.current = sync;
    sync(useEditorUiStore.getState().playheadTicks);
    return useEditorUiStore.subscribe((s, prev) => {
      if (
        s.playheadTicks !== prev.playheadTicks ||
        s.isPlaying !== prev.isPlaying ||
        s.isScrubbing !== prev.isScrubbing
      ) {
        sync(s.playheadTicks);
      }
    });
  }, []);

  // New clip on stage — prime seek when paused; catch up once when mounting into a live transition.
  // NOTE: this effect re-runs on every layers-identity change (each frame
  // inside a transition), so the playing catch-up seek is restricted to
  // newly-mounted clips — otherwise it fights sync()'s settle-guarded seeks.
  const mountedIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const ticks = useEditorUiStore.getState().playheadTicks;
    const playing = isPlayingRef.current && !isScrubbingRef.current;
    const { width: cw, height: ch } = project.canvas;
    const seen = new Set<string>();
    layers.forEach((layer, stackIndex) => {
      const z = mediaZ(layer.track.order, stackIndex);
      if (layer.asset.kind === "image") {
        const img = imageRefs.current.get(layer.clip.id);
        if (img) {
          applyMediaStyle(img, project, layer.clip, layer.asset, cw, ch, ticks, z);
        }
        return;
      }
      if (layer.asset.kind !== "video") return;
      const video = videoRefs.current.get(layer.clip.id);
      if (!video) return;
      seen.add(layer.clip.id);
      const isNew = !mountedIdsRef.current.has(layer.clip.id);
      applyMediaStyle(video, project, layer.clip, layer.asset, cw, ch, ticks, z);
      const target = transitionAwareMediaTimeSec(layer.clip, ticks);
      if (playing) {
        if (isPreTransitionMount(project, layer.clip, ticks)) {
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          return;
        }
        if (isOutgoingHoldClip(layer.clip, ticks, project)) {
          if (isNew && Math.abs(video.currentTime - target) > 0.08) {
            safeSeek(video, target);
          }
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          return;
        }
        if (
          isNew &&
          !video.seeking &&
          inTransitionWindow(project, layer.clip, ticks) &&
          Math.abs(video.currentTime - target) > 0.12
        ) {
          const now = performance.now();
          lastCatchupRef.current.set(layer.clip.id, now);
          seekStartRef.current.set(layer.clip.id, now);
          lastSeekAtByClipRef.current.set(layer.clip.id, now);
          safeSeek(video, target);
          // seeked listener will call ensurePlaying — don't play mid-seek.
          return;
        }
        ensurePlaying(video, layer.clip.id);
        return;
      }
      safeSeek(video, target);
    });
    mountedIdsRef.current = seen;
    syncRef.current(ticks);
  }, [layers, project]);

  if (layers.length === 0) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.badge}>Preview</div>
        <p>Import media and add clips to the timeline.</p>
        <span>Tracks higher in the timeline draw on top</span>
      </div>
    );
  }

  const seedTicks = useEditorUiStore.getState().playheadTicks;
  const canvasW = project.canvas.width;
  const canvasH = project.canvas.height;

  return (
    <>
      {layers.map((layer, stackIndex) => {
        const url = resolveMediaUrl(layer.asset.path, layer.asset.id);
        if (!url) return null;
        const z = mediaZ(layer.track.order, stackIndex);
        const style = layerVisualStyle(
          project,
          layer.clip,
          layer.asset,
          canvasW,
          canvasH,
          seedTicks,
          z,
        );
        const boxStyle = {
          zIndex: style.zIndex,
          left: `${style.leftPct}%`,
          top: `${style.topPct}%`,
          width: `${style.widthPct}%`,
          height: `${style.heightPct}%`,
          transform: style.transform,
          opacity: style.opacity,
          // Explicit "none" so React clears a prior wipe clip-path on remount.
          clipPath: style.clipPath ?? "none",
          mixBlendMode: style.mixBlendMode as CSSProperties["mixBlendMode"],
        };
        if (layer.asset.kind === "image") {
          return (
            <div
              key={layer.clip.id}
              className={styles.layerHost}
              data-layer-host
              style={boxStyle}
            >
              <div className={styles.gradeWrap} data-grade style={{ filter: style.filter }}>
                <img
                  ref={(el) => {
                    if (el) imageRefs.current.set(layer.clip.id, el);
                    else imageRefs.current.delete(layer.clip.id);
                  }}
                  className={styles.layerMedia}
                  src={url}
                  alt=""
                />
              </div>
              {style.tint ? (
                <div
                  className={styles.tintOverlay}
                  data-tint
                  style={{
                    background: style.tint.color,
                    opacity: style.tint.opacity,
                    mixBlendMode: style.tint.blend,
                  }}
                />
              ) : null}
              {style.vignetteOpacity > 0.01 ? (
                <div
                  className={styles.vignetteOverlay}
                  data-vignette
                  style={{ opacity: style.vignetteOpacity }}
                />
              ) : null}
              {style.strobeFlash ? (
                <div
                  className={styles.strobeFlash}
                  data-strobe
                  style={{
                    background: style.strobeFlash,
                    opacity: style.strobeFlashOpacity,
                  }}
                />
              ) : null}
            </div>
          );
        }
        if (layer.asset.kind !== "video") return null;
        // Host mounts a pooled <video> warmed at media-bin import — same element,
        // so Play after add-to-timeline does not wait for a cold UHD decode.
        // The ref callback is cached per clip (stable identity): an inline ref
        // would detach/re-attach — pausing and yanking the decoder — on every
        // transition frame. Key includes url so replacing media still remounts.
        return (
          <div
            key={`${layer.asset.id}:${layer.clip.id}:${url}`}
            className={styles.layerHost}
            data-layer-host
            style={boxStyle}
            ref={videoHostRef(layer.clip.id, url)}
          />
        );
      })}
    </>
  );
}
