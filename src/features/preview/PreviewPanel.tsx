import { useEffect, useMemo, useRef } from "react";
import { clipDurationTicks, ticksToSeconds } from "../../domain";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { CompositeLayers, type PreviewLayer } from "./CompositeLayers";
import { TextOverlayLayer } from "./TextOverlayLayer";
import { useTimelineAudio } from "./useTimelineAudio";
import styles from "./PreviewPanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function PreviewPanel() {
  const canvas = useProjectStore((s) => s.project.canvas);
  const clips = useProjectStore((s) => s.project.clips);
  const assets = useProjectStore((s) => s.project.assets);
  const tracks = useProjectStore((s) => s.project.tracks);
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const isScrubbing = useEditorUiStore((s) => s.isScrubbing);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const stageRef = useRef<HTMLDivElement>(null);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);

  const layers = useMemo((): PreviewLayer[] => {
    const videoTracks = tracks
      .filter((t) => t.kind === "video" && t.visible)
      .sort((a, b) => a.order - b.order);
    const out: PreviewLayer[] = [];
    for (const track of videoTracks) {
      for (const clip of clips) {
        if (clip.trackId !== track.id || clip.kind !== "media" || !clip.assetId) continue;
        if (
          playheadTicks < clip.startTicks ||
          playheadTicks >= clip.startTicks + clipDurationTicks(clip)
        ) {
          continue;
        }
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
  }, [assets, clips, playheadTicks, tracks]);

  const activeTexts = useMemo(() => {
    const hidden = new Set(
      tracks.filter((t) => t.kind === "video" && !t.visible).map((t) => t.id),
    );
    return clips.filter(
      (c) =>
        c.kind === "text" &&
        c.text &&
        !hidden.has(c.trackId) &&
        playheadTicks >= c.startTicks &&
        playheadTicks < c.startTicks + clipDurationTicks(c),
    );
  }, [clips, playheadTicks, tracks]);

  useTimelineAudio({
    clips,
    tracks,
    assets,
    playheadTicks,
    isPlaying,
    isScrubbing,
  });

  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useEditorUiStore.getState().playheadTicks + Math.round(dt * 1_000_000);
      if (next >= durationTicks) {
        setPlayheadTicks(durationTicks);
        setPlaying(false);
        return;
      }
      setPlayheadTicks(next);
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
            playheadTicks={playheadTicks}
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

      <div className={styles.transport}>
        <div className={styles.transportLeft}>
          <button
            type="button"
            onClick={() => setPlayheadTicks(Math.max(0, playheadTicks - 1_000_000))}
            title="Back 1s"
          >
            ⏮
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={() => setPlaying(!isPlaying)}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            onClick={() =>
              setPlayheadTicks(Math.min(durationTicks, playheadTicks + 1_000_000))
            }
            title="Forward 1s"
          >
            ⏭
          </button>
        </div>
        <div className={styles.clock}>
          {formatClock(ticksToSeconds(playheadTicks))}
          <span> / </span>
          {formatClock(ticksToSeconds(durationTicks))}
        </div>
        <button type="button" className={styles.fullscreen} disabled title="Fullscreen">
          ⛶
        </button>
      </div>
    </div>
  );
}
