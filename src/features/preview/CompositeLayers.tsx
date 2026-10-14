import { useEffect, useRef } from "react";
import {
  clipDurationTicks,
  cssFilterFromEffects,
  fadeOpacityMultiplier,
  findNextClipOnTrack,
  incomingTransitionProgress,
  normalizeClipEffects,
  normalizeClipTransition,
  ticksToSeconds,
  transitionAwareMediaTimeSec,
  transitionHalfTicks,
  transitionOpacityPair,
  wipeClipPath,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
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
  const end = clip.startTicks + clipDurationTicks(clip);
  const half = transitionHalfTicks(tin);
  return playheadTicks >= end - half && playheadTicks <= end + half;
}

function transitionVisualMul(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
): { opacityMul: number; clipPath?: string } {
  let opacityMul = 1;
  let clipPath: string | undefined;

  const incoming = incomingTransitionProgress(clip, playheadTicks);
  if (incoming) {
    const pair = transitionOpacityPair(incoming.transition.type, incoming.progress);
    opacityMul *= pair.curr;
    clipPath = wipeClipPath(incoming.transition.type, incoming.progress);
  }

  const next = findNextClipOnTrack(project, clip.id);
  if (next) {
    const tin = normalizeClipTransition(next.transitionIn);
    if (tin.type !== "none") {
      const cut = clip.startTicks + clipDurationTicks(clip);
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

  return { opacityMul, clipPath };
}

function layerVisualStyle(
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
  zIndex: number,
) {
  const effects = normalizeClipEffects(clip.effects);
  const durationSec = ticksToSeconds(clipDurationTicks(clip));
  const localSec = Math.max(0, ticksToSeconds(playheadTicks - clip.startTicks));
  const fadeMul = fadeOpacityMultiplier(effects, localSec, durationSec);
  const { opacityMul, clipPath } = transitionVisualMul(project, clip, playheadTicks);
  const filter = cssFilterFromEffects(effects);
  return {
    zIndex,
    opacity: clip.transform.opacity * fadeMul * opacityMul,
    filter: filter || undefined,
    clipPath,
  };
}

function applyMediaStyle(
  el: HTMLElement,
  project: ProjectDocument,
  clip: Clip,
  playheadTicks: number,
  zIndex: number,
) {
  const style = layerVisualStyle(project, clip, playheadTicks, zIndex);
  el.style.zIndex = String(style.zIndex);
  el.style.opacity = String(style.opacity);
  el.style.filter = style.filter ?? "";
  el.style.clipPath = style.clipPath ?? "none";
}

function safeSeek(video: HTMLVideoElement, timeSec: number) {
  if (!Number.isFinite(timeSec) || timeSec < 0) return;
  try {
    // Nudge off exact 0 — some decoders stall until the first seek after load.
    const t = timeSec === 0 ? 0.001 : timeSec;
    if (Math.abs(video.currentTime - t) < 0.001) return;
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
  const playStartedRef = useRef(false);
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
    if (!playStartedRef.current) return;
    if (isScrubbingRef.current) return;
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    void video.play().catch(() => undefined);
  };

  const primeVideo = (clipId: string, video: HTMLVideoElement) => {
    const layer = layersRef.current.find((l) => l.clip.id === clipId);
    if (!layer || layer.asset.kind !== "video") return;
    const ticks = useEditorUiStore.getState().playheadTicks;
    const target = transitionAwareMediaTimeSec(layer.clip, ticks);
    applyMediaStyle(video, projectRef.current, layer.clip, ticks, 1);
    safeSeek(video, target);
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
      return;
    }
    videoRefs.current.set(clipId, el);
    if (primedVideosRef.current.has(el)) {
      // Ref re-fired on re-render — keep mapping, don't re-bind listeners.
      return;
    }
    primedVideosRef.current.add(el);

    const onReady = () => {
      primeVideo(clipId, el);
      ensurePlaying(el);
    };
    el.addEventListener("loadedmetadata", onReady);
    el.addEventListener("canplay", onReady);
    el.addEventListener("seeked", () => ensurePlaying(el));

    // Kick decoder so Play at t=0 isn't stuck on HAVE_NOTHING (scrub used to do this).
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
      try {
        el.load();
      } catch {
        /* ignore */
      }
    }
    primeVideo(clipId, el);
  };

  // Start/stop decoder when transport changes.
  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      playStartedRef.current = false;
      for (const video of videoRefs.current.values()) {
        video.pause();
      }
      return;
    }
    playStartedRef.current = true;
    const ticks = useEditorUiStore.getState().playheadTicks;
    for (const layer of layersRef.current) {
      if (layer.asset.kind !== "video") continue;
      const video = videoRefs.current.get(layer.clip.id);
      if (!video) continue;
      const target = transitionAwareMediaTimeSec(layer.clip, ticks);
      // Seek first so the decoder has a frame — then play (scrub-then-play path).
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        safeSeek(video, target);
      } else {
        const drift = Math.abs(video.currentTime - target);
        if (drift > 0.35) safeSeek(video, target);
      }
      void video.play().catch(() => undefined);
    }
    // If refs weren't ready yet, sync on next playhead tick / canplay will retry.
    syncRef.current(ticks);
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

      const live = new Set(liveLayers.map((l) => l.clip.id));
      for (const [id, el] of videoRefs.current) {
        if (!live.has(id)) {
          el.pause();
          videoRefs.current.delete(id);
        }
      }
      for (const [id] of imageRefs.current) {
        if (!live.has(id)) imageRefs.current.delete(id);
      }

      liveLayers.forEach((layer, index) => {
        const z = index + 1;
        if (layer.asset.kind === "image") {
          const img = imageRefs.current.get(layer.clip.id);
          if (img) applyMediaStyle(img, proj, layer.clip, playheadTicks, z);
          return;
        }
        if (layer.asset.kind !== "video") return;
        const video = videoRefs.current.get(layer.clip.id);
        if (!video) return;

        applyMediaStyle(video, proj, layer.clip, playheadTicks, z);

        const speed =
          Number.isFinite(layer.clip.speed) && layer.clip.speed > 0
            ? layer.clip.speed
            : 1;
        const muted =
          !layer.isTopVideo || layer.track.muted || !layer.asset.hasAudio;
        video.muted = muted;
        video.volume = Math.min(
          1,
          Math.max(0, layer.clip.volume * layer.track.volume),
        );
        video.playbackRate = Math.min(
          16,
          Math.max(0.0625, speed * Math.abs(shuttle || 1)),
        );

        const target = transitionAwareMediaTimeSec(layer.clip, playheadTicks);
        const transitioning = inTransitionWindow(proj, layer.clip, playheadTicks);
        const tin = normalizeClipTransition(layer.clip.transitionIn);
        const justAfterCut =
          tin.type !== "none" &&
          playheadTicks >= layer.clip.startTicks &&
          playheadTicks < layer.clip.startTicks + tin.durationTicks;
        const driftLimit = transitioning || justAfterCut ? 0.55 : 0.35;

        if (playing && !scrubbing && !reverse) {
          // No frames yet — seek to wake the decoder (same as scrubbing).
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            safeSeek(video, target);
            ensurePlaying(video);
            return;
          }
          ensurePlaying(video);
          const drift = video.currentTime - target;
          const shouldSeek =
            drift < -driftLimit ||
            (drift > driftLimit &&
              !(transitioning || justAfterCut) &&
              drift > 0.7);
          if (shouldSeek) safeSeek(video, target);
          return;
        }

        video.pause();
        const now = performance.now();
        const minGap = scrubbing || reverse ? (transitioning ? 16 : 40) : 48;
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

  // New clip on stage — prime seek even if playhead hasn't moved.
  useEffect(() => {
    const ticks = useEditorUiStore.getState().playheadTicks;
    layers.forEach((layer, index) => {
      const z = index + 1;
      if (layer.asset.kind === "image") {
        const img = imageRefs.current.get(layer.clip.id);
        if (img) applyMediaStyle(img, project, layer.clip, ticks, z);
        return;
      }
      if (layer.asset.kind !== "video") return;
      const video = videoRefs.current.get(layer.clip.id);
      if (!video) return;
      applyMediaStyle(video, project, layer.clip, ticks, z);
      const target = transitionAwareMediaTimeSec(layer.clip, ticks);
      safeSeek(video, target);
      if (isPlayingRef.current && !isScrubbingRef.current) {
        ensurePlaying(video);
      }
    });
    syncRef.current(ticks);
  }, [layers, project]);

  if (layers.length === 0) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.badge}>Preview</div>
        <p>Import media and add clips to the timeline.</p>
        <span>Visible video tracks stack bottom → top by track order</span>
      </div>
    );
  }

  const seedTicks = useEditorUiStore.getState().playheadTicks;

  return (
    <>
      {layers.map((layer, index) => {
        const url = resolveMediaUrl(layer.asset.path, layer.asset.id);
        if (!url) return null;
        const z = index + 1;
        const style = layerVisualStyle(project, layer.clip, seedTicks, z);
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
              style={style}
            />
          );
        }
        if (layer.asset.kind !== "video") return null;
        return (
          <video
            key={`${layer.asset.id}:${layer.clip.id}`}
            ref={(el) => attachVideo(layer.clip.id, el)}
            className={styles.layerMedia}
            src={url}
            playsInline
            preload="auto"
            style={style}
          />
        );
      })}
    </>
  );
}
