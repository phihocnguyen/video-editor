import { useEffect, useRef } from "react";
import {
  clipDurationTicks,
  hasActiveRamp,
  mediaSpeedAtTimelineTicks,
  normalizeSpeedRamp,
  sourceOffsetForTimelineOffset,
  ticksToSeconds,
  type Clip,
  type MediaAsset,
  type Track,
} from "../../domain";
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
      // Shuttle (J/L): reverse mutes timeline audio, fast/slow multiplies the
      // element rate so it tracks the playhead instead of seek-fighting it.
      const shuttle = Number.isFinite(useEditorUiStore.getState().playbackRate)
        ? useEditorUiStore.getState().playbackRate
        : 1;
      const reverse = shuttle < 0;
      const shuttleAbs = Math.abs(shuttle) || 1;
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

        // Map timeline → source honouring constant speed and speed ramps.
        // Without this, a ramped/sped audio clip drifts from the playhead and
        // re-seeks every sync (stutter). With it, the element glides at the
        // right rate and seeks only on real discontinuities (e.g. scrub).
        const spanTicks = Math.max(
          0,
          item.clip.sourceOutTicks - item.clip.sourceInTicks,
        );
        const localTicks = Math.max(0, playheadTicks - item.clip.startTicks);
        const constSpeed =
          Number.isFinite(item.clip.speed) && item.clip.speed > 0
            ? item.clip.speed
            : 1;
        const ramp = normalizeSpeedRamp(item.clip.speedRamp ?? null);
        const srcOffTicks = ramp
          ? sourceOffsetForTimelineOffset(ramp, spanTicks, localTicks)
          : Math.min(spanTicks, localTicks * constSpeed);
        const target = Math.max(
          0,
          ticksToSeconds(item.clip.sourceInTicks) + ticksToSeconds(srcOffTicks),
        );
        const wantRate =
          ramp && hasActiveRamp(ramp)
            ? mediaSpeedAtTimelineTicks(item.clip, playheadTicks)
            : constSpeed;
        const rate = Math.min(16, Math.max(0.0625, wantRate * shuttleAbs));
        if (Math.abs(el.playbackRate - rate) > 0.02) {
          try {
            el.playbackRate = rate;
          } catch {
            /* ignore */
          }
        }
        // Reverse shuttle: keep paused and don't chase the playhead — a paused
        // element seek-fighting backward would stutter. Position resyncs on
        // the next forward tick via the drift rule below.
        if (reverse) {
          el.pause();
          continue;
        }
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
        s.isScrubbing !== prev.isScrubbing ||
        s.playbackRate !== prev.playbackRate
      ) {
        sync(s.playheadTicks);
      }
    });
  }, []);

  useEffect(() => {
    // Transport flip without waiting for next playhead tick.
    const ticks = useEditorUiStore.getState().playheadTicks;
    const reverse = useEditorUiStore.getState().playbackRate < 0;
    const active = findActiveAudioClips(clips, tracks, assets, ticks);
    for (const item of active) {
      const el = elementsRef.current.get(item.clip.id);
      if (!el) continue;
      if (isPlaying && !isScrubbing && !reverse) void el.play().catch(() => undefined);
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
