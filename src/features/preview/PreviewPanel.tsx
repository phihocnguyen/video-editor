import { useEffect, useMemo, useRef, useState } from "react";
import {
  clipDurationTicks,
  clipVisibleWithTransition,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "../../domain";
import {
  beginPlaybackDecodeHold,
  endPlaybackDecodeHold,
  setPlaybackHoldStartHook,
} from "../../lib/mediaDecodeGate";
import { releaseFilmstripDecoders } from "../../lib/mediaFilmstrip";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { CompositeLayers, type PreviewLayer } from "./CompositeLayers";
import { TextOverlayLayer } from "./TextOverlayLayer";
import { TransportBar } from "./TransportBar";
import { useTimelineAudio } from "./useTimelineAudio";
import styles from "./PreviewPanel.module.css";

function visibleLayerKey(
  tracks: Track[],
  clips: Clip[],
  assets: MediaAsset[],
  project: ProjectDocument,
  playheadTicks: number,
): string {
  const ids: string[] = [];
  const videoTracks = tracks
    .filter((t) => t.kind === "video" && t.visible)
    .sort((a, b) => a.order - b.order);
  for (const track of videoTracks) {
    for (const clip of clips) {
      if (clip.trackId !== track.id || clip.kind !== "media" || !clip.assetId) continue;
      if (!clipVisibleWithTransition(clip, playheadTicks, project)) continue;
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.missing) continue;
      if (asset.kind !== "video" && asset.kind !== "image") continue;
      ids.push(clip.id);
    }
  }
  return ids.join("|");
}

function activeTextKey(clips: Clip[], tracks: Track[], playheadTicks: number): string {
  const hidden = new Set(
    tracks.filter((t) => t.kind === "video" && !t.visible).map((t) => t.id),
  );
  return clips
    .filter(
      (c) =>
        c.kind === "text" &&
        c.text &&
        !hidden.has(c.trackId) &&
        playheadTicks >= c.startTicks &&
        playheadTicks < c.startTicks + clipDurationTicks(c),
    )
    .map((c) => c.id)
    .join("|");
}

export function PreviewPanel() {
  const project = useProjectStore((s) => s.project);
  const canvas = project.canvas;
  const clips = project.clips;
  const assets = project.assets;
  const tracks = project.tracks;
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const isScrubbing = useEditorUiStore((s) => s.isScrubbing);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const stageRef = useRef<HTMLDivElement>(null);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);

  // React list playhead — only advances when visible layers/texts change (or scrub/pause).
  const [listPlayhead, setListPlayhead] = useState(
    () => useEditorUiStore.getState().playheadTicks,
  );
  const lastVisKeyRef = useRef("");
  const lastTextKeyRef = useRef("");
  const projectRef = useRef(project);
  projectRef.current = project;

  const bumpListPlayhead = (ticks: number, force: boolean) => {
    const { tracks: tr, clips: cl, assets: as } = projectRef.current;
    const vis = visibleLayerKey(tr, cl, as, projectRef.current, ticks);
    const text = activeTextKey(cl, tr, ticks);
    if (force || vis !== lastVisKeyRef.current || text !== lastTextKeyRef.current) {
      lastVisKeyRef.current = vis;
      lastTextKeyRef.current = text;
      setListPlayhead(ticks);
    }
  };

  useEffect(() => {
    const ticks = useEditorUiStore.getState().playheadTicks;
    lastVisKeyRef.current = visibleLayerKey(tracks, clips, assets, project, ticks);
    lastTextKeyRef.current = activeTextKey(clips, tracks, ticks);
    setListPlayhead(ticks);
  }, [assets, clips, project, tracks]);

  useEffect(() => {
    return useEditorUiStore.subscribe((s, prev) => {
      if (s.playheadTicks === prev.playheadTicks) return;
      if (s.isPlaying && !s.isScrubbing) return;
      bumpListPlayhead(s.playheadTicks, true);
    });
  }, []);

  const layers = useMemo((): PreviewLayer[] => {
    const videoTracks = tracks
      .filter((t) => t.kind === "video" && t.visible)
      .sort((a, b) => a.order - b.order);
    const out: PreviewLayer[] = [];
    for (const track of videoTracks) {
      const trackClips = clips
        .filter((c) => c.trackId === track.id && c.kind === "media" && c.assetId)
        .sort((a, b) => a.startTicks - b.startTicks);
      for (const clip of trackClips) {
        if (!clipVisibleWithTransition(clip, listPlayhead, project)) continue;
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset || asset.missing) continue;
        if (asset.kind !== "video" && asset.kind !== "image") continue;
        out.push({ clip, asset, track, isTopVideo: false });
      }
    }
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i].asset.kind === "video") {
        out[i] = { ...out[i], isTopVideo: true };
        break;
      }
    }
    return out;
  }, [assets, clips, listPlayhead, project, tracks]);

  const activeTexts = useMemo(() => {
    const hidden = new Set(
      tracks.filter((t) => t.kind === "video" && !t.visible).map((t) => t.id),
    );
    return clips.filter(
      (c) =>
        c.kind === "text" &&
        c.text &&
        !hidden.has(c.trackId) &&
        listPlayhead >= c.startTicks &&
        listPlayhead < c.startTicks + clipDurationTicks(c),
    );
  }, [clips, listPlayhead, tracks]);

  useTimelineAudio({
    clips,
    tracks,
    assets,
    isPlaying,
    isScrubbing,
  });

  useEffect(() => {
    setPlaybackHoldStartHook(() => releaseFilmstripDecoders());
    return () => setPlaybackHoldStartHook(null);
  }, []);

  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    releaseFilmstripDecoders();
    beginPlaybackDecodeHold();
    return () => endPlaybackDecodeHold();
  }, [isPlaying, isScrubbing]);

  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const rate = useEditorUiStore.getState().playbackRate;
      const delta = Math.round(dt * 1_000_000 * rate);
      if (delta === 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const cur = useEditorUiStore.getState().playheadTicks;
      const next = cur + delta;
      if (next >= durationTicks) {
        setPlayheadTicks(durationTicks);
        setPlaying(false);
        bumpListPlayhead(durationTicks, true);
        return;
      }
      if (next <= 0) {
        setPlayheadTicks(0);
        setPlaying(false);
        bumpListPlayhead(0, true);
        return;
      }
      setPlayheadTicks(next);
      bumpListPlayhead(next, false);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationTicks, isPlaying, isScrubbing, setPlayheadTicks, setPlaying]);

  return (
    <div className={styles.panel}>
      <div className={styles.stageWrap}>
        <div
          ref={stageRef}
          className={styles.stage}
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
          onPointerDown={(e) => {
            if (
              e.target === e.currentTarget ||
              (e.target as HTMLElement).tagName === "VIDEO" ||
              (e.target as HTMLElement).tagName === "IMG"
            ) {
              if (selectedClipIds.length > 0) setSelectedClipIds([]);
            }
          }}
        >
          <CompositeLayers
            layers={layers}
            isPlaying={isPlaying}
            isScrubbing={isScrubbing}
          />
          <TextOverlayLayer
            clips={activeTexts}
            canvasWidth={canvas.width}
            canvasHeight={canvas.height}
            stageRef={stageRef}
          />
        </div>
      </div>

      <TransportBar />
    </div>
  );
}
