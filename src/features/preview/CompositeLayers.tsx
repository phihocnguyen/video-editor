import { useEffect, useRef } from "react";
import {
  clipDurationTicks,
  cssFilterFromEffects,
  fadeOpacityMultiplier,
  findNextClipOnTrack,
  getRampProfile,
  hasActiveRamp,
  incomingTransitionProgress,
  clipMediaGeometry,
  normalizeClipEffects,
  normalizeClipTransition,
  layerStackZ,
  mediaSpeedAtTimelineTicks,
  ticksToSeconds,
  timelineOffsetForSourceOffset,
  transitionAwareMediaTimeSec,
  transitionHalfTicks,
  transitionOpacityPair,
  transitionPreview,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { acquireMediaVideo, releaseMediaVideo } from "../../lib/mediaVideoPool";
import { setRampClockActive } from "../../lib/rampClock";
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

function transitionVisualMul(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): number {
  let opacityMul = 1;

  const incoming = incomingTransitionProgress(clip, playheadTicks);
  if (incoming) {
    opacityMul *= transitionPreview(incoming.transition.type, incoming.progress).opacity;
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
        const pair = transitionOpacityPair(tin.type, progress);
        opacityMul *= pair.prev;
      }
    }
  }

  return opacityMul;
}

/** Later clips on the same track stack above earlier ones during overlap. */
function mediaZ(trackOrder: number, stackIndex: number): number {
  return layerStackZ(trackOrder, "media") + stackIndex;
}

interface LayerStyle {
  zIndex: number;
  opacity: number;
  filter?: string;
  /** Geometry box in percentages of the canvas. */
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  /** CSS transform for the whole layer (centring + scale + rotation). */
  transform: string;
}

function layerVisualStyle(
  project: ProjectDocument,
  clip: Clip,
  asset: MediaAsset | null,
  canvasWidth: number,
  canvasHeight: number,
  playheadTicks: number,
  zIndex: number,
): LayerStyle {
  const effects = normalizeClipEffects(clip.effects);
  const durationSec = ticksToSeconds(clipDurationTicks(clip));
  const localSec = Math.max(0, ticksToSeconds(playheadTicks - clip.startTicks));
  const fadeMul = fadeOpacityMultiplier(effects, localSec, durationSec);
  const opacityMul = transitionVisualMul(project, clip, playheadTicks);
  const filter = cssFilterFromEffects(effects) || undefined;

  const geom = clipMediaGeometry(clip, canvasWidth, canvasHeight, asset);
  const parts = [
    "translate(-50%, -50%)",
    `rotate(${geom.rotation}deg)`,
    `scale(${geom.scaleX}, ${geom.scaleY})`,
  ];

  return {
    zIndex,
    opacity: clip.transform.opacity * fadeMul * opacityMul,
    filter,
    leftPct: (geom.centerX / Math.max(1, canvasWidth)) * 100,
    topPct: (geom.centerY / Math.max(1, canvasHeight)) * 100,
    widthPct: (geom.fitWidth / Math.max(1, canvasWidth)) * 100,
    heightPct: (geom.fitHeight / Math.max(1, canvasHeight)) * 100,
    transform: parts.join(" "),
  };
}

type StyleCache = {
  zIndex: number;
  opacity: number;
  filter: string;
  transform: string;
  left: string;
  top: string;
  width: string;
  height: string;
};

const styleCache = new WeakMap<HTMLElement, StyleCache>();

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
  const style = layerVisualStyle(
    project,
    clip,
    asset,
    canvasWidth,
    canvasHeight,
    playheadTicks,
    zIndex,
  );
  // Pooled videos sit inside a host div — style the host so geometry/stacking work.
  const target =
    el.parentElement?.hasAttribute("data-layer-host") ? el.parentElement : el;
  const filter = style.filter ?? "";
  const left = `${style.leftPct}%`;
  const top = `${style.topPct}%`;
  const width = `${style.widthPct}%`;
  const height = `${style.heightPct}%`;
  const transform = style.transform;
  const prev = styleCache.get(target);
  if (
    prev &&
    prev.zIndex === style.zIndex &&
    prev.opacity === style.opacity &&
    prev.filter === filter &&
    prev.transform === transform &&
    prev.left === left &&
    prev.top === top &&
    prev.width === width &&
    prev.height === height
  ) {
    return;
  }
  styleCache.set(target, {
    zIndex: style.zIndex,
    opacity: style.opacity,
    filter,
    transform,
    left,
    top,
    width,
    height,
  });
  target.style.zIndex = String(style.zIndex);
  target.style.opacity = String(style.opacity);
  target.style.filter = filter;
  target.style.left = left;
  target.style.top = top;
  target.style.width = width;
  target.style.height = height;
  target.style.transform = transform;
}

/** True when opacity is still changing this frame (fade / transition). */
function needsPerFrameVisual(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): boolean {
  const effects = normalizeClipEffects(clip.effects);
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
  const primedVideosRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());
  const lastSeekAtRef = useRef(0);
  /** Per-clip last applied playbackRate — avoid resetting the decoder every frame. */
  const lastRateByClipRef = useRef(new Map<string, number>());
  const wakePendingRef = useRef(new WeakSet<HTMLVideoElement>());
  /** One-shot seek when a ramped clip first becomes the clock master. */
  const rampArmedRef = useRef(new Set<string>());
  /** Throttle timeline playhead writes from the ramp video-clock. */
  const lastRampPlayheadWriteRef = useRef(0);
  const layersRef = useRef(layers);
  const projectRef = useRef(project);
  const isPlayingRef = useRef(isPlaying);
  const isScrubbingRef = useRef(isScrubbing);
  const playbackRateRef = useRef(playbackRate);
  const syncRef = useRef<(playheadTicks: number) => void>(() => undefined);
  layersRef.current = layers;
  projectRef.current = project;
  isPlayingRef.current = isPlaying;
  isScrubbingRef.current = isScrubbing;
  playbackRateRef.current = playbackRate;

  const ensurePlaying = (video: HTMLVideoElement) => {
    if (!isPlayingRef.current || isScrubbingRef.current) return;
    // Still seeking from an earlier scrub — play() after seeked (listener below).
    // Don't early-return when paused+seeking: we still want play() queued.
    if (!video.paused && !video.ended && !video.seeking) return;
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
    // Seek when paused, or once when mounting into an active transition.
    if (!playing || transitioning) {
      safeSeek(video, target);
    }
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      try {
        video.load();
      } catch {
        /* ignore */
      }
    }
    ensurePlaying(video);
  };

  const attachVideo = (clipId: string, el: HTMLVideoElement | null) => {
    if (!el) {
      videoRefs.current.delete(clipId);
      releaseMediaVideo(clipId);
      return;
    }
    videoRefs.current.set(clipId, el);
    if (primedVideosRef.current.has(el)) {
      // Re-used pooled element: still prime for this clip (playhead/source may differ).
      primeVideo(clipId, el);
      return;
    }
    primedVideosRef.current.add(el);

    const onReady = () => {
      primeVideo(clipId, el);
      ensurePlaying(el);
    };
    el.addEventListener("loadedmetadata", onReady);
    el.addEventListener("canplay", onReady);
    el.addEventListener("seeked", () => {
      wakePendingRef.current.delete(el);
      ensurePlaying(el);
    });

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
    if (video.parentElement !== host) {
      host.replaceChildren(video);
    }
    attachVideo(clipId, video);
  };

  // Start/stop decoder when transport changes.
  // IMPORTANT:
  //  - do NOT depend on `layers` (remount mid-play freezes the frame)
  //  - pause only in the effect *cleanup*, and only if transport actually
  //    stopped. React Strict Mode runs play→cleanup→play; pausing in cleanup
  //    while isPlaying is still true caused the "tiny jerk, need 2–3 clicks" bug.
  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      setRampClockActive(false);
      rampArmedRef.current.clear();
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
      rampArmedRef.current.delete(layer.clip.id);

      // Resume must NOT seek. UHD seeks often never finish, leaving a stuck
      // frame while the software playhead keeps advancing.
      const speed = mediaSpeedAtTimelineTicks(layer.clip, ticks);
      video.playbackRate = Math.min(16, Math.max(0.0625, speed * (shuttle || 1)));
      lastRateByClipRef.current.set(layer.clip.id, video.playbackRate);
      ensurePlaying(video);
    });

    return () => {
      // Strict Mode re-runs this effect while still playing — do not pause then.
      if (useEditorUiStore.getState().isPlaying && !useEditorUiStore.getState().isScrubbing) {
        return;
      }
      setRampClockActive(false);
      rampArmedRef.current.clear();
      for (const video of videoRefs.current.values()) {
        video.pause();
        wakePendingRef.current.delete(video);
      }
    };
  }, [isPlaying, isScrubbing]);

  // Watchdog: re-issue play() while transport is live but the element is paused.
  // Do NOT nudge currentTime here — a +0.001s seek looks like a tiny glitch and
  // can abort the first play() on UHD.
  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let raf = 0;
    const tick = () => {
      for (const video of videoRefs.current.values()) {
        if (video.paused || video.ended) ensurePlaying(video);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, isScrubbing]);

  /**
   * Speed-ramp clock: the video element is master. We set playbackRate from the
   * ramp at the video's current source position and push the timeline playhead
   * from currentTime — so 4× actually looks 4×, without seek-thrashing UHD.
   */
  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      setRampClockActive(false);
      return;
    }
    let raf = 0;
    const tick = () => {
      const shuttle = Number.isFinite(playbackRateRef.current)
        ? playbackRateRef.current
        : 1;
      if (shuttle < 0) {
        setRampClockActive(false);
        raf = requestAnimationFrame(tick);
        return;
      }

      const playhead = useEditorUiStore.getState().playheadTicks;
      let driven = false;

      for (const layer of layersRef.current) {
        if (layer.asset.kind !== "video") continue;
        if (!hasActiveRamp(layer.clip.speedRamp)) continue;
        const profile = getRampProfile(layer.clip.speedRamp);
        if (!profile) continue;

        const dur = clipDurationTicks(layer.clip);
        const inClip =
          playhead >= layer.clip.startTicks - 50_000 &&
          playhead < layer.clip.startTicks + dur + 50_000;
        // Also keep driving if we already armed this clip (playhead follows video).
        const armed = rampArmedRef.current.has(layer.clip.id);
        if (!inClip && !armed) continue;

        const video = videoRefs.current.get(layer.clip.id);
        if (!video) continue;

        const sourceIn = layer.clip.sourceInTicks / 1_000_000;
        const sourceOut = layer.clip.sourceOutTicks / 1_000_000;
        const spanTicks = Math.max(1, layer.clip.sourceOutTicks - layer.clip.sourceInTicks);
        const spanSec = Math.max(1e-6, sourceOut - sourceIn);

        if (!armed) {
          // Do not seek on arm — resume seek freezes UHD. Just mark armed + play.
          rampArmedRef.current.add(layer.clip.id);
        }

        const progress = Math.min(
          1,
          Math.max(0, (video.currentTime - sourceIn) / spanSec),
        );
        const speed = profile.speedAtProgress(progress);
        const rate = Math.min(16, Math.max(0.0625, speed * Math.abs(shuttle)));
        if (Math.abs(video.playbackRate - rate) > 0.015) {
          video.playbackRate = rate;
          lastRateByClipRef.current.set(layer.clip.id, rate);
        }

        ensurePlaying(video);

        const sourceOffsetTicks = (video.currentTime - sourceIn) * 1_000_000;
        const local = timelineOffsetForSourceOffset(
          layer.clip.speedRamp!,
          spanTicks,
          sourceOffsetTicks,
        );
        const nextTicks = Math.round(layer.clip.startTicks + local);
        // ~30Hz UI playhead is enough; writing Zustand 60×/s wakes every subscriber.
        const nowWrite = performance.now();
        if (nowWrite - lastRampPlayheadWriteRef.current >= 32) {
          lastRampPlayheadWriteRef.current = nowWrite;
          useEditorUiStore.getState().setPlayheadTicks(nextTicks);
        }

        // Past the clip / source — hand clock back to wall-time.
        if (
          video.currentTime >= sourceOut - 0.02 ||
          local >= dur - 1_000
        ) {
          rampArmedRef.current.delete(layer.clip.id);
          setRampClockActive(false);
        } else {
          setRampClockActive(true);
          driven = true;
        }
        break;
      }

      if (!driven) setRampClockActive(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setRampClockActive(false);
    };
  }, [isPlaying, isScrubbing, layers]);

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

      const live = new Set(liveLayers.map((l) => l.clip.id));
      for (const [id, el] of videoRefs.current) {
        if (!live.has(id)) {
          el.pause();
          videoRefs.current.delete(id);
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

        const ramped = hasActiveRamp(layer.clip.speedRamp);
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
        if (liveVisual) {
          applyMediaStyle(video, proj, layer.clip, layer.asset, cw, ch, playheadTicks, z);
        }

        const muted =
          !layer.isTopVideo || layer.track.muted || !layer.asset.hasAudio;
        if (video.muted !== muted) video.muted = muted;
        const vol = Math.min(
          1,
          Math.max(0, layer.clip.volume * layer.track.volume),
        );
        if (video.volume !== vol) video.volume = vol;

        const target = transitionAwareMediaTimeSec(layer.clip, playheadTicks);

        // Ramped clips are driven by their own video clock (see effect below) —
        // don't seek/rate-fight them from the wall-clock playhead.
        if (playing && !scrubbing && !reverse && ramped) {
          ensurePlaying(video);
          return;
        }

        const speed = mediaSpeedAtTimelineTicks(layer.clip, playheadTicks);
        const desiredRate = Math.min(
          16,
          Math.max(0.0625, speed * Math.abs(shuttle || 1)),
        );
        const prevRate = lastRateByClipRef.current.get(layer.clip.id);
        const rateDelta =
          prevRate == null || prevRate <= 0
            ? Infinity
            : Math.abs(desiredRate - prevRate) / prevRate;
        if (prevRate == null || rateDelta > 0.04) {
          video.playbackRate = desiredRate;
          lastRateByClipRef.current.set(layer.clip.id, desiredRate);
        }

        if (playing && !scrubbing && !reverse) {
          // Incoming clip often mounts mid-transition with a cold currentTime —
          // one catch-up seek so it doesn't stay on the wrong frame under clip 1.
          if (transitioning && Math.abs(video.currentTime - target) > 0.12) {
            const now = performance.now();
            if (now - lastSeekAtRef.current >= 16) {
              lastSeekAtRef.current = now;
              safeSeek(video, target);
            }
          }
          ensurePlaying(video);
          return;
        }

        video.pause();
        rampArmedRef.current.delete(layer.clip.id);
        // Plain pause: never seek. Pause-time seeks on UHD often never finish,
        // so the next Play leaves a stuck frame while the timeline runs.
        // Only scrub / reverse shuttle need to re-anchor the decoder.
        if (!scrubbing && !reverse) return;
        const now = performance.now();
        const minGap = transitioning ? 16 : 40;
        if (now - lastSeekAtRef.current < minGap) return;
        if (Math.abs(video.currentTime - target) < (transitioning ? 0.02 : 0.04)) {
          return;
        }
        lastSeekAtRef.current = now;
        safeSeek(video, target);
      });
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
  useEffect(() => {
    const ticks = useEditorUiStore.getState().playheadTicks;
    const playing = isPlayingRef.current && !isScrubbingRef.current;
    const { width: cw, height: ch } = project.canvas;
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
      applyMediaStyle(video, project, layer.clip, layer.asset, cw, ch, ticks, z);
      const target = transitionAwareMediaTimeSec(layer.clip, ticks);
      if (playing) {
        if (
          inTransitionWindow(project, layer.clip, ticks) &&
          Math.abs(video.currentTime - target) > 0.12
        ) {
          safeSeek(video, target);
        }
        ensurePlaying(video);
        return;
      }
      safeSeek(video, target);
    });
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
          filter: style.filter,
        } as const;
        if (layer.asset.kind === "image") {
          return (
            <img
              key={layer.clip.id}
              ref={(el) => {
                if (el) imageRefs.current.set(layer.clip.id, el);
                else imageRefs.current.delete(layer.clip.id);
              }}
              className={styles.layerMedia}
              src={url}
              alt=""
              style={boxStyle}
            />
          );
        }
        if (layer.asset.kind !== "video") return null;
        // Host mounts a pooled <video> warmed at media-bin import — same element,
        // so Play after add-to-timeline does not wait for a cold UHD decode.
        return (
          <div
            key={`${layer.asset.id}:${layer.clip.id}`}
            className={styles.layerHost}
            data-layer-host
            style={boxStyle}
            ref={(host) => mountPooledVideo(host, layer.clip.id, url)}
          />
        );
      })}
    </>
  );
}
