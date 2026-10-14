import { useEffect, useMemo, useRef } from "react";
import { clipDurationTicks, ticksToSeconds } from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
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
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const videoRef = useRef<HTMLVideoElement>(null);

  const active = useMemo(() => {
    const videoTracks = tracks
      .filter((t) => t.kind === "video" && t.visible)
      .sort((a, b) => b.order - a.order);
    for (const track of videoTracks) {
      const hit = clips.find(
        (c) =>
          c.trackId === track.id &&
          c.kind === "media" &&
          playheadTicks >= c.startTicks &&
          playheadTicks < c.startTicks + clipDurationTicks(c),
      );
      if (hit?.assetId) {
        const asset = assets.find((a) => a.id === hit.assetId);
        if (asset && !asset.missing) {
          return { clip: hit, asset };
        }
      }
    }
    return null;
  }, [assets, clips, playheadTicks, tracks]);

  const mediaUrl = active
    ? resolveMediaUrl(active.asset.path, active.asset.id)
    : null;

  const activeTexts = useMemo(() => {
    return clips.filter(
      (c) =>
        c.kind === "text" &&
        c.text &&
        playheadTicks >= c.startTicks &&
        playheadTicks < c.startTicks + clipDurationTicks(c),
    );
  }, [clips, playheadTicks]);

  useEffect(() => {
    if (!isPlaying) return;
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
  }, [durationTicks, isPlaying, setPlayheadTicks, setPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    const localSec =
      ticksToSeconds(playheadTicks - active.clip.startTicks) +
      ticksToSeconds(active.clip.sourceInTicks);
    if (Math.abs(video.currentTime - localSec) > 0.12) {
      video.currentTime = Math.max(0, localSec);
    }
    if (isPlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active, isPlaying, playheadTicks]);

  return (
    <div className={styles.panel}>
      <div className={styles.stageWrap}>
        <div
          className={styles.stage}
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
        >
          {mediaUrl && active?.asset.kind === "video" ? (
            <video ref={videoRef} className={styles.media} src={mediaUrl} playsInline />
          ) : mediaUrl && active?.asset.kind === "image" ? (
            <img className={styles.media} src={mediaUrl} alt="" />
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.badge}>Preview</div>
              <p>Import media and add clips to the timeline.</p>
              <span>Active-clip preview — multi-track compositing still limited</span>
            </div>
          )}
          {activeTexts.map((clip) => {
            const style = clip.text!;
            return (
              <div
                key={clip.id}
                className={styles.textOverlay}
                style={{
                  left: `${(clip.transform.x / canvas.width) * 100}%`,
                  top: `${(clip.transform.y / canvas.height) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  fontFamily: `"${style.fontFamily}", sans-serif`,
                  fontSize: `${Math.max(12, Math.round(style.fontSize * 0.4))}px`,
                  color: style.color,
                  textAlign: style.align,
                  opacity: clip.transform.opacity,
                }}
              >
                {style.content}
              </div>
            );
          })}
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
