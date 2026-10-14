import { useEffect, useRef } from "react";
import { clipDurationTicks, ticksToSeconds, type Clip, type MediaAsset, type Track } from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { useEditorUiStore } from "../../stores/editorUiStore";

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
  isPlaying: boolean;
  isScrubbing: boolean;
}) {
  const { clips, tracks, assets, isPlaying, isScrubbing } = options;
  const elementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const clipsRef = useRef(clips);
  const tracksRef = useRef(tracks);
  const assetsRef = useRef(assets);
  const isPlayingRef = useRef(isPlaying);
  const isScrubbingRef = useRef(isScrubbing);
  const lastActiveKeyRef = useRef("");
  clipsRef.current = clips;
  tracksRef.current = tracks;
  assetsRef.current = assets;
  isPlayingRef.current = isPlaying;
  isScrubbingRef.current = isScrubbing;

  useEffect(() => {
    const sync = (playheadTicks: number) => {
      const active = findActiveAudioClips(
        clipsRef.current,
        tracksRef.current,
        assetsRef.current,
        playheadTicks,
      );
      const key = active.map((a) => a.clip.id).join("|");
      const playing = isPlayingRef.current;
      const scrubbing = isScrubbingRef.current;
      const map = elementsRef.current;
      const live = new Set(active.map((a) => a.clip.id));

      if (key !== lastActiveKeyRef.current) {
        lastActiveKeyRef.current = key;
        for (const [id, el] of map) {
          if (!live.has(id)) {
            el.pause();
            el.src = "";
            map.delete(id);
          }
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
        el.volume = Math.min(
          1,
          Math.max(
            0,
            item.clip.volume *
              (tracksRef.current.find((t) => t.id === item.clip.trackId)?.volume ?? 1),
          ),
        );

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

        if (playing && !scrubbing) {
          if (el.paused) void el.play().catch(() => undefined);
        } else {
          el.pause();
        }
      }
    };

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

  useEffect(() => {
    // Transport flip without waiting for next playhead tick.
    const ticks = useEditorUiStore.getState().playheadTicks;
    const active = findActiveAudioClips(clips, tracks, assets, ticks);
    for (const item of active) {
      const el = elementsRef.current.get(item.clip.id);
      if (!el) continue;
      if (isPlaying && !isScrubbing) void el.play().catch(() => undefined);
      else el.pause();
    }
  }, [assets, clips, isPlaying, isScrubbing, tracks]);

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
