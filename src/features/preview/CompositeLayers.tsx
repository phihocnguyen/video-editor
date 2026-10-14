import { useEffect, useRef } from "react";
import { ticksToSeconds, type Clip, type MediaAsset, type Track } from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
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
  playheadTicks: number;
  isPlaying: boolean;
  isScrubbing: boolean;
}

export function CompositeLayers({
  layers,
  playheadTicks,
  isPlaying,
  isScrubbing,
}: CompositeLayersProps) {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastSeekAtRef = useRef(0);

  useEffect(() => {
    const live = new Set(layers.map((l) => l.clip.id));
    for (const [id, el] of videoRefs.current) {
      if (!live.has(id)) {
        el.pause();
        videoRefs.current.delete(id);
      }
    }

    for (const layer of layers) {
      if (layer.asset.kind !== "video") continue;
      const video = videoRefs.current.get(layer.clip.id);
      if (!video) continue;

      const speed =
        Number.isFinite(layer.clip.speed) && layer.clip.speed > 0 ? layer.clip.speed : 1;
      const muted =
        !layer.isTopVideo ||
        layer.track.muted ||
        !layer.asset.hasAudio;
      video.muted = muted;
      video.volume = Math.min(
        1,
        Math.max(0, layer.clip.volume * layer.track.volume),
      );
      video.playbackRate = speed;
      video.style.opacity = String(layer.clip.transform.opacity);

      const timelineLocal = ticksToSeconds(playheadTicks - layer.clip.startTicks);
      const target = Math.max(
        0,
        timelineLocal * speed + ticksToSeconds(layer.clip.sourceInTicks),
      );

      if (isPlaying && !isScrubbing) {
        void video.play().catch(() => undefined);
        if (Math.abs(video.currentTime - target) > 0.35) {
          video.currentTime = target;
        }
        continue;
      }

      video.pause();
      const now = performance.now();
      if (now - lastSeekAtRef.current < (isScrubbing ? 40 : 0)) continue;
      if (Math.abs(video.currentTime - target) < 0.04) continue;
      lastSeekAtRef.current = now;
      try {
        video.currentTime = target;
      } catch {
        /* ignore */
      }
    }
  }, [isPlaying, isScrubbing, layers, playheadTicks]);

  if (layers.length === 0) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.badge}>Preview</div>
        <p>Import media and add clips to the timeline.</p>
        <span>Visible video tracks stack bottom → top by track order</span>
      </div>
    );
  }

  return (
    <>
      {layers.map((layer, index) => {
        const url = resolveMediaUrl(layer.asset.path, layer.asset.id);
        if (!url) return null;
        const z = index + 1;
        if (layer.asset.kind === "image") {
          return (
            <img
              key={layer.clip.id}
              className={styles.layerMedia}
              src={url}
              alt=""
              style={{
                zIndex: z,
                opacity: layer.clip.transform.opacity,
              }}
            />
          );
        }
        if (layer.asset.kind !== "video") return null;
        return (
          <video
            key={`${layer.asset.id}:${layer.clip.id}`}
            ref={(el) => {
              if (el) videoRefs.current.set(layer.clip.id, el);
              else videoRefs.current.delete(layer.clip.id);
            }}
            className={styles.layerMedia}
            src={url}
            playsInline
            preload="auto"
            style={{ zIndex: z }}
          />
        );
      })}
    </>
  );
}
