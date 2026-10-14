import { useEffect, useMemo, useRef } from "react";
import { clipDurationTicks, ticksToSeconds, type Clip, type MediaAsset, type Track } from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";

interface ActiveAudio {
  clip: Clip;
  asset: MediaAsset;
  url: string;
}

function findActiveAudioClips(
  clips: Clip[],
  tracks: Track[],
  assets: MediaAsset[],
  playheadTicks: number,
): ActiveAudio[] {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const out: ActiveAudio[] = [];

  for (const clip of clips) {
    if (clip.kind !== "media" || !clip.assetId) continue;
    const track = trackById.get(clip.trackId);
    if (!track || track.muted) continue;
    if (playheadTicks < clip.startTicks) continue;
    if (playheadTicks >= clip.startTicks + clipDurationTicks(clip)) continue;

    const asset = assetById.get(clip.assetId);
    if (!asset || asset.missing || !asset.hasAudio) continue;
    // Video preview element already plays video audio — only drive dedicated audio clips here.
    if (asset.kind !== "audio") continue;

    const url = resolveMediaUrl(asset.path, asset.id);
    if (!url) continue;
    out.push({ clip, asset, url });
  }
  return out;
}

export function useTimelineAudio(options: {
  clips: Clip[];
  tracks: Track[];
  assets: MediaAsset[];
  playheadTicks: number;
  isPlaying: boolean;
  isScrubbing: boolean;
}) {
  const { clips, tracks, assets, playheadTicks, isPlaying, isScrubbing } = options;
  const elementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const active = useMemo(
    () => findActiveAudioClips(clips, tracks, assets, playheadTicks),
    [assets, clips, playheadTicks, tracks],
  );

  useEffect(() => {
    const live = new Set(active.map((a) => a.clip.id));
    const map = elementsRef.current;

    for (const [id, el] of map) {
      if (!live.has(id)) {
        el.pause();
        el.src = "";
        map.delete(id);
      }
    }

    for (const item of active) {
      let el = map.get(item.clip.id);
      if (!el) {
        el = new Audio();
        el.preload = "auto";
        map.set(item.clip.id, el);
      }
      if (el.src !== item.url) {
        el.src = item.url;
      }
      el.volume = Math.min(1, Math.max(0, item.clip.volume * (tracks.find((t) => t.id === item.clip.trackId)?.volume ?? 1)));

      const localSec =
        ticksToSeconds(playheadTicks - item.clip.startTicks) +
        ticksToSeconds(item.clip.sourceInTicks);
      const target = Math.max(0, localSec);
      if (Math.abs(el.currentTime - target) > 0.08) {
        try {
          el.currentTime = target;
        } catch {
          /* ignore */
        }
      }

      if (isPlaying && !isScrubbing) {
        void el.play().catch(() => undefined);
      } else {
        el.pause();
      }
    }
  }, [active, isPlaying, isScrubbing, playheadTicks, tracks]);

  useEffect(() => {
    return () => {
      for (const el of elementsRef.current.values()) {
        el.pause();
        el.src = "";
      }
      elementsRef.current.clear();
    };
  }, []);
}
